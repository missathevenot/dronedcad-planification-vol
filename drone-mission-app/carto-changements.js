/**
 * carto-changements.js
 * Petite carte Leaflet dédiée au sous-onglet "Détection des changements" de
 * Suivi : un seul outil de dessin (polygone de changement), affichage des
 * polygones déjà enregistrés colorés par priorité. Instance de carte
 * indépendante de celle de cartographie.js (Carto), recréée à chaque rendu
 * du sous-onglet puisque son conteneur DOM est lui-même recréé à chaque
 * rendu de `suiviDetailHost` (voir app.js, majAffichageDetailSuivi).
 */

'use strict';

const CartoChangements = (() => {
  let map = null;
  let coucheChangements = null;
  let modeDessin = false;
  let dessinCourant = [];
  let dessinLayer = null;

  const COULEURS_PRIORITE = { faible: '#4FD1C5', moyenne: '#F0A84E', haute: '#F2545B' };

  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => fn(payload)); }

  /** (Ré)initialise la carte sur le conteneur donné. Supprime l'instance précédente si besoin.
   * Réinitialise aussi les écouteurs `on(...)` : ce module est recréé à chaque rendu du
   * sous-onglet (Task 8, `chargerListeEtCarteChangements`), qui rebranche systématiquement
   * un écouteur `polygoneTermine` — sans ce reset, les écouteurs des rendus précédents
   * s'accumuleraient et un seul dessin déclencherait plusieurs callbacks. */
  function initMap(elementId) {
    if (map) { map.remove(); map = null; }
    map = L.map(elementId, { zoomControl: false }).setView([5.35, -4.0], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);
    coucheChangements = L.layerGroup().addTo(map);
    modeDessin = false;
    dessinCourant = [];
    dessinLayer = null;
    Object.keys(listeners).forEach((evt) => { listeners[evt] = []; });
    map.on('click', onMapClick);
    map.on('dblclick', onMapDblClick);
    return map;
  }

  function startDraw() {
    if (!map) return;
    modeDessin = true;
    dessinCourant = [];
    if (dessinLayer) { map.removeLayer(dessinLayer); dessinLayer = null; }
    map.getContainer().style.cursor = 'crosshair';
  }

  function stopDraw() {
    if (!map) return;
    modeDessin = false;
    map.getContainer().style.cursor = '';
    if (dessinLayer) { map.removeLayer(dessinLayer); dessinLayer = null; }
    dessinCourant = [];
  }

  function onMapClick(e) {
    if (!modeDessin) return;
    dessinCourant.push([e.latlng.lat, e.latlng.lng]);
    if (dessinLayer) map.removeLayer(dessinLayer);
    dessinLayer = L.polygon(dessinCourant, {
      color: '#F0A84E', weight: 2, dashArray: '4 4', fillOpacity: 0.1
    }).addTo(map);
  }

  function onMapDblClick(e) {
    if (!modeDessin) return;
    L.DomEvent.stopPropagation(e);
    if (dessinCourant.length < 3) {
      Utils.toast('Il faut au moins 3 points pour fermer un polygone de changement.', 'warning');
      return;
    }
    const points = dessinCourant.slice();
    stopDraw();
    emit('polygoneTermine', points);
  }

  /** Affiche la liste des changements déjà enregistrés, colorés par priorité. */
  function afficherChangements(changements) {
    if (!coucheChangements) return;
    coucheChangements.clearLayers();
    changements.forEach((c) => {
      L.polygon(c.geometrie, {
        color: COULEURS_PRIORITE[c.priorite] || COULEURS_PRIORITE.moyenne,
        weight: 2, fillOpacity: 0.25
      }).bindTooltip(`${c.type} — ${c.priorite}`).addTo(coucheChangements);
    });
  }

  function invalidateSize() { if (map) setTimeout(() => map.invalidateSize(), 200); }

  return { initMap, startDraw, stopDraw, on, afficherChangements, invalidateSize };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CartoChangements;
