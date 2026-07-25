/**
 * cartographie.js
 * Gestion de la carte Leaflet : import/dessin de la zone, point de décollage,
 * zones d'exclusion, zones sensibles, génération et affichage des lignes de vol.
 */

'use strict';

const Carto = (() => {
  let map = null;
  let baseLayerClair, baseLayerSombre, calqueActif;

  const layers = {
    zone: L.layerGroup(),
    exclusions: L.layerGroup(),
    sensibles: L.layerGroup(),
    decollage: L.layerGroup(),
    lignes: L.layerGroup(),
    photos: L.layerGroup()
  };

  let zonePoints = [];         // [[lat,lng], ...]
  let exclusionsPolys = [];    // [ [[lat,lng],...], ... ]
  let decollagePoint = null;   // [lat,lng]

  let modeDessin = null;       // null | 'zone' | 'exclusion' | 'decollage'
  let dessinCourant = [];
  let dessinLayer = null;

  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => fn(payload)); }

  // Quelques repères publics indicatifs pour illustrer la notion de "zone sensible"
  // (aéroport, infrastructures d'État). À vérifier systématiquement auprès de la DGAC/
  // des autorités compétentes avant tout vol réel : ce ne sont PAS des périmètres officiels.
  const ZONES_SENSIBLES_INDICATIVES = [
    { nom: "Aéroport Félix-Houphouët-Boigny (Abidjan)", lat: 5.2614, lng: -3.9263, rayon: 5000 },
    { nom: "Zone administrative du Plateau (Abidjan)", lat: 5.3230, lng: -4.0219, rayon: 1500 }
  ];

  function initMap(elementId) {
    map = L.map(elementId, { zoomControl: false, attributionControl: true }).setView([5.35, -4.0], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    baseLayerClair = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors'
    });
    baseLayerSombre = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });

    calqueActif = baseLayerSombre.addTo(map);
    Object.values(layers).forEach((l) => l.addTo(map));

    map.on('click', onMapClick);
    map.on('dblclick', onMapDblClick);

    afficherZonesSensibles();
    return map;
  }

  function setTheme(theme) {
    if (!map) return;
    map.removeLayer(calqueActif);
    calqueActif = (theme === 'clair' ? baseLayerClair : baseLayerSombre).addTo(map);
    calqueActif.bringToBack();
  }

  function afficherZonesSensibles() {
    layers.sensibles.clearLayers();
    ZONES_SENSIBLES_INDICATIVES.forEach((z) => {
      L.circle([z.lat, z.lng], {
        radius: z.rayon, className: 'zone-sensible', color: '#F2545B',
        weight: 1.5, fillOpacity: 0.06, dashArray: '6 6'
      }).bindTooltip(`⚠ ${z.nom} (indicatif — à vérifier)`, { sticky: true }).addTo(layers.sensibles);
    });
  }

  // ------------------------------------------------------------------
  // Dessin interactif (zone / exclusion / point de décollage)
  // ------------------------------------------------------------------
  function startDraw(type) {
    modeDessin = type;
    dessinCourant = [];
    if (dessinLayer) { map.removeLayer(dessinLayer); dessinLayer = null; }
    map.getContainer().style.cursor = 'crosshair';
  }

  function stopDraw() {
    modeDessin = null;
    map.getContainer().style.cursor = '';
    if (dessinLayer) { map.removeLayer(dessinLayer); dessinLayer = null; }
    dessinCourant = [];
  }

  function onMapClick(e) {
    if (!modeDessin) return;
    const ll = [e.latlng.lat, e.latlng.lng];

    if (modeDessin === 'decollage') {
      setDecollage(ll);
      stopDraw();
      return;
    }

    dessinCourant.push(ll);
    if (dessinLayer) map.removeLayer(dessinLayer);
    dessinLayer = L.polygon(dessinCourant, {
      color: modeDessin === 'zone' ? '#4FD1C5' : '#F0A84E',
      weight: 2, dashArray: '4 4', fillOpacity: 0.08
    }).addTo(map);
  }

  function onMapDblClick(e) {
    if (!modeDessin || modeDessin === 'decollage') return;
    L.DomEvent.stopPropagation(e);
    if (dessinCourant.length < 3) { Utils.toast('Il faut au moins 3 points pour fermer une zone.', 'warning'); return; }
    if (modeDessin === 'zone') {
      setZone(dessinCourant.slice());
    } else if (modeDessin === 'exclusion') {
      exclusionsPolys.push(dessinCourant.slice());
      redessinerExclusions();
      emit('exclusionsChanged', exclusionsPolys);
    }
    stopDraw();
  }

  function setZone(latlngs) {
    zonePoints = latlngs;
    layers.zone.clearLayers();
    L.polygon(zonePoints, {
      color: '#4FD1C5', weight: 2.5, fillOpacity: 0.1, fillColor: '#4FD1C5'
    }).addTo(layers.zone);
    map.fitBounds(L.polygon(zonePoints).getBounds(), { padding: [40, 40] });
    emit('zoneChanged', zonePoints);
  }

  function redessinerExclusions() {
    layers.exclusions.clearLayers();
    exclusionsPolys.forEach((poly, i) => {
      L.polygon(poly, { color: '#F2545B', weight: 2, fillOpacity: 0.15, dashArray: '3 5' })
        .bindTooltip(`Exclusion ${i + 1}`)
        .addTo(layers.exclusions);
    });
  }

  function supprimerExclusion(i) {
    exclusionsPolys.splice(i, 1);
    redessinerExclusions();
    emit('exclusionsChanged', exclusionsPolys);
  }

  function setDecollage(latlng) {
    decollagePoint = latlng;
    layers.decollage.clearLayers();
    L.marker(decollagePoint, {
      icon: L.divIcon({ className: 'marker-decollage', html: '🛫', iconSize: [26, 26] })
    }).bindTooltip('Point de décollage').addTo(layers.decollage);
    emit('decollageChanged', decollagePoint);
  }

  function effacerTout() {
    zonePoints = []; exclusionsPolys = []; decollagePoint = null;
    Object.values(layers).forEach((l) => l.clearLayers());
    afficherZonesSensibles();
    emit('zoneChanged', zonePoints);
  }

  // ------------------------------------------------------------------
  // Import de fichiers (GeoJSON / KML / SHP-zip)
  // ------------------------------------------------------------------
  async function importFile(file) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.geojson') || name.endsWith('.json')) {
        const text = await file.text();
        const gj = JSON.parse(text);
        const latlngs = premierPolygoneDepuisGeoJSON(gj);
        if (latlngs) setZone(latlngs); else throw new Error('Aucun polygone trouvé dans le GeoJSON.');
      } else if (name.endsWith('.kml')) {
        const text = await file.text();
        const latlngs = parserKML(text);
        if (latlngs) setZone(latlngs); else throw new Error('Aucun polygone trouvé dans le KML.');
      } else if (name.endsWith('.zip')) {
        const buf = await file.arrayBuffer();
        const gj = await shp(buf);
        const collection = Array.isArray(gj) ? gj[0] : gj;
        const latlngs = premierPolygoneDepuisGeoJSON(collection);
        if (latlngs) setZone(latlngs); else throw new Error('Aucun polygone trouvé dans le Shapefile.');
      } else {
        throw new Error('Format non pris en charge (utiliser .geojson, .kml ou .zip contenant un Shapefile).');
      }
      Utils.toast('Zone importée avec succès.', 'success');
    } catch (err) {
      console.error(err);
      Utils.toast(`Échec de l'import : ${err.message}`, 'danger');
    }
  }

  function premierPolygoneDepuisGeoJSON(gj) {
    const feats = gj.type === 'FeatureCollection' ? gj.features : (gj.type === 'Feature' ? [gj] : [{ geometry: gj }]);
    for (const f of feats) {
      const geom = f.geometry || f;
      if (!geom) continue;
      let coords = null;
      if (geom.type === 'Polygon') coords = geom.coordinates[0];
      else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0][0];
      if (coords) return coords.map(([lng, lat]) => [lat, lng]);
    }
    return null;
  }

  function parserKML(text) {
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const coordEl = dom.querySelector('Polygon outerBoundaryIs coordinates, Polygon coordinates');
    if (!coordEl) return null;
    const raw = coordEl.textContent.trim().split(/\s+/);
    return raw.map((triplet) => {
      const [lng, lat] = triplet.split(',').map(Number);
      return [lat, lng];
    }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }

  // ------------------------------------------------------------------
  // Génération du plan de vol
  // ------------------------------------------------------------------
  /**
   * Calcule les lignes de vol (grand axe = direction de vol) et les affiche.
   * Retourne { lignes: [[ [lat,lng], [lat,lng] ], ...], points: [[lat,lng],...] }
   */
  function genererLignesDeVol(angleDeg, espacementLignesM, margeM) {
    if (zonePoints.length < 3) return { lignes: [], points: [] };
    const centre = Utils.centroid(zonePoints);
    const b = Calc.bboxOriente(zonePoints, centre, angleDeg);
    const toRad = (d) => (d * Math.PI) / 180;
    const a = toRad(angleDeg);
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const { mPerDegLat, mPerDegLng } = b;

    const rotToLatLng = (x, y) => {
      // (x,y) exprimés dans le repère tourné -> repère local m -> lat/lng
      const x0 = x * cosA - y * sinA;
      const y0 = x * sinA + y * cosA;
      return [centre[0] + y0 / mPerDegLat, centre[1] + x0 / mPerDegLng];
    };

    const nbLignes = Math.max(1, Math.ceil(b.largeur / espacementLignesM) + 1);
    const largeurTotale = (nbLignes - 1) * espacementLignesM;
    const decalage = (b.largeur - largeurTotale) / 2;

    const lignes = [];
    const points = [];
    for (let i = 0; i < nbLignes; i++) {
      const x = b.minX + decalage + i * espacementLignesM;
      const y0 = b.minY - margeM;
      const y1 = b.maxY + margeM;
      const inverse = i % 2 === 1; // aller-retour (boustrophédon)
      const p0 = rotToLatLng(x, inverse ? y1 : y0);
      const p1 = rotToLatLng(x, inverse ? y0 : y1);
      lignes.push([p0, p1]);
    }

    layers.lignes.clearLayers();
    layers.photos.clearLayers();
    lignes.forEach((ligne, i) => {
      const poly = L.polyline(ligne, { color: '#F0A84E', weight: 2.5, opacity: 0.9 }).addTo(layers.lignes);
      const mid = [(ligne[0][0] + ligne[1][0]) / 2, (ligne[0][1] + ligne[1][1]) / 2];
      const brg = bearing(ligne[0], ligne[1]);
      L.marker(mid, {
        icon: L.divIcon({
          className: 'fleche-vol', html: `<div style="transform:rotate(${brg}deg)">➤</div>`, iconSize: [18, 18]
        })
      }).bindTooltip(`Ligne ${i + 1}`).addTo(layers.lignes);
    });

    if (decollagePoint) {
      L.polyline([decollagePoint, lignes[0] ? lignes[0][0] : decollagePoint], {
        color: '#8CA0BF', weight: 1.5, dashArray: '2 6'
      }).addTo(layers.lignes);
    }

    return { lignes, points };
  }

  function bearing(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
    const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
      Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function exportWaypointsKML(lignes) {
    let placemarks = '';
    lignes.forEach((ligne, i) => {
      const coords = ligne.map(([lat, lng]) => `${lng},${lat},0`).join(' ');
      placemarks += `<Placemark><name>Ligne ${i + 1}</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark>\n`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>Plan de vol - Mission drone</name>
${placemarks}
</Document></kml>`;
  }

  function toggleLayer(name, visible) {
    if (!layers[name]) return;
    if (visible) map.addLayer(layers[name]); else map.removeLayer(layers[name]);
  }

  function invalidateSize() { if (map) setTimeout(() => map.invalidateSize(), 200); }

  return {
    initMap, setTheme, startDraw, stopDraw, effacerTout, importFile,
    setZone, setDecollage, supprimerExclusion, genererLignesDeVol, exportWaypointsKML,
    toggleLayer, invalidateSize, on,
    getZone: () => zonePoints, getExclusions: () => exclusionsPolys,
    getDecollage: () => decollagePoint, getCentroid: () => zonePoints.length ? Utils.centroid(zonePoints) : null,
    getMap: () => map
  };
})();
