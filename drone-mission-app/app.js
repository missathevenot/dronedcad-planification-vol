/**
 * app.js
 * Orchestration générale : état de l'application, liaison des formulaires,
 * tableau de bord, tableau des missions, graphiques et validations.
 */

'use strict';

const App = (() => {
  const state = {
    drone: { ...Calc.DEFAULTS.drone },
    camera: { ...Calc.DEFAULTS.camera },
    vol: { ...Calc.DEFAULTS.vol },
    couts: { ...Calc.DEFAULTS.couts },
    limites: { ...Calc.DEFAULTS.limites },
    batteries: { ...Batteries.DEFAULTS },
    performance: { ...Performance.DEFAULTS },
    meteo: { date: new Date().toISOString().slice(0, 10), heure: '09:00', commune: '', latitude: null, longitude: null },
    theme: 'sombre',
    superficieManuelleHa: 50,
    zone: { id: null, nom: '', commune: '', description: '' }
  };

  let dernierResultats = null;
  let dernieresMissions = [];
  let dernierResultatMeteo = null;
  let meteoAutoRempliFait = false;
  let suiviInitFait = false;
  let meteoRequeteEnCours = 0;
  let suiviListeRequeteEnCours = 0;
  let suiviTableauDeBordRequeteEnCours = 0;
  let suiviZoneRequeteEnCours = 0;
  let scenarios = [];
  const charts = {};

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------
  function init() {
    Carto.initMap('map');
    bindNavigation();
    bindTheme();
    bindFormulaires();
    bindDessin();
    bindImportExport();
    bindScenarios();
    bindMeteo();
    bindEnvoiVersSuivi();
    bindFiltresSuivi();
    bindSelectionZone();
    bindEnregistrerSupprimerZone();
    initCharts();

    Carto.on('zoneChanged', () => recalculer());
    Carto.on('exclusionsChanged', () => { renderExclusions(); recalculer(); });
    Carto.on('decollageChanged', () => recalculer());

    remplirFormulaireDepuisEtat();
    genererZoneTest(); // zone de démonstration au chargement
    recalculer();
    initialiserOngletZones();
  }

  // ------------------------------------------------------------------
  // Navigation latérale
  // ------------------------------------------------------------------
  function bindNavigation() {
    document.querySelectorAll('.nav__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav__item').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const target = btn.dataset.target;
        document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('is-active', p.id === target));
        if (target === 'panel-carto') {
          Carto.invalidateSize();
        }
        if (target === 'panel-meteo' && !meteoAutoRempliFait) {
          meteoAutoRempliFait = true;
          if (state.meteo.latitude == null && state.meteo.longitude == null) recentrerMeteoSurZone();
        }
        if (target === 'panel-suivi' && !suiviInitFait) {
          suiviInitFait = true;
          initialiserOngletSuivi();
        }
        document.getElementById('appShell').classList.remove('nav-open');
      });
    });
    document.getElementById('btnMenu').addEventListener('click', () => {
      document.getElementById('appShell').classList.toggle('nav-open');
    });
  }

  function bindTheme() {
    const toggle = document.getElementById('themeToggle');
    toggle.addEventListener('click', () => {
      state.theme = state.theme === 'sombre' ? 'clair' : 'sombre';
      appliquerTheme();
    });
    appliquerTheme();
  }

  function appliquerTheme() {
    document.body.classList.toggle('theme-clair', state.theme === 'clair');
    document.body.classList.toggle('theme-sombre', state.theme !== 'clair');
    document.getElementById('themeToggle').textContent = state.theme === 'sombre' ? '☀ Mode clair' : '☾ Mode sombre';
    Carto.setTheme(state.theme);
    Object.values(charts).forEach((c) => { if (c) { majCouleursChart(c); c.update(); } });
  }

  // ------------------------------------------------------------------
  // Formulaires — liaison bidirectionnelle avec l'état
  // ------------------------------------------------------------------
  const champs = [
    ['droneVitesse', 'drone.vitesseCartographie', Number],
    ['droneAltMax', 'drone.altitudeMax', Number],
    ['droneAutonomie', 'batteries.autonomieParPaireMin', Number],
    ['droneSecu', 'batteries.reserveSecuritePct', Number],
    ['droneSwap', 'batteries.tempsChangementBatterieMin', Number],
    ['battDecollage', 'batteries.tempsDecollageMin', Number],
    ['battRetour', 'batteries.tempsRetourMin', Number],
    ['droneVitesseMax', 'drone.vitesseMax', Number],
    ['droneNb', 'drone.nombreDrones', Number],
    ['volAltitude', 'vol.altitude', Number],
    ['volRecouvLong', 'vol.recouvrementLong', Number],
    ['volRecouvLat', 'vol.recouvrementLat', Number],
    ['volVitesse', 'vol.vitesse', Number],
    ['volFocale', 'vol.focale', Number],
    ['volMarge', 'vol.margeSecurite', Number],
    ['volFormat', 'vol.formatCapture', String],
    ['volOrientationAuto', 'vol.orientationAuto', Boolean],
    ['volOrientation', 'vol.orientationLignes', Number],
    ['coutOperateur', 'couts.tauxHoraireOperateur', Number],
    ['coutBatterie', 'couts.coutCycleBatterie', Number],
    ['coutTraitement', 'couts.coutTraitementParHa', Number],
    ['pcType', 'performance.typeSelectionne', String],
    ['meteoDate', 'meteo.date', String],
    ['meteoHeure', 'meteo.heure', String],
    ['meteoCommune', 'meteo.commune', String],
    ['meteoLatitude', 'meteo.latitude', Number],
    ['meteoLongitude', 'meteo.longitude', Number]
  ];

  function set(path, value) {
    const parts = path.split('.');
    let obj = state;
    while (parts.length > 1) obj = obj[parts.shift()];
    obj[parts[0]] = value;
  }
  function get(path) {
    return path.split('.').reduce((o, k) => o[k], state);
  }

  function bindFormulaires() {
    champs.forEach(([id, path, type]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, Utils.debounce(() => {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (type === Number) {
          v = (v === '' && (path === 'meteo.latitude' || path === 'meteo.longitude')) ? null : (parseFloat(v) || 0);
        }
        set(path, v);
        if (path === 'vol.orientationAuto') {
          document.getElementById('volOrientation').closest('.field').classList.toggle('is-hidden', v);
        }
        if (path === 'performance.typeSelectionne') {
          majPCTypeHint();
        }
        recalculer();
      }, 200));
    });
  }

  function majPCTypeHint() {
    const type = state.performance.types[state.performance.typeSelectionne];
    document.getElementById('pcTypeConfig').textContent = type ? type.config : '';
  }

  function remplirFormulaireDepuisEtat() {
    champs.forEach(([id, path]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = get(path);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    document.getElementById('volOrientation').closest('.field').classList.toggle('is-hidden', state.vol.orientationAuto);
    document.getElementById('droneModele').textContent = state.drone.modele;
    document.getElementById('cameraModele').textContent = state.camera.modele;
    document.getElementById('cameraRes').textContent = `${state.camera.largeurPx} × ${state.camera.hauteurPx} px (${state.camera.megapixels} MP)`;
    majPCTypeHint();
    majCoordsAffichage();
    document.getElementById('zoneNom').value = state.zone.nom || '';
    document.getElementById('zoneDescription').value = state.zone.description || '';
    document.getElementById('zoneCommune').value = state.zone.commune || '';
  }

  function genererZoneTest() {
    const centre = Carto.getMap().getCenter();
    const surfaceM2 = Utils.haToM2(state.superficieManuelleHa || 50);
    const cote = Math.sqrt(surfaceM2);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((centre.lat * Math.PI) / 180);
    const dLat = (cote / 2) / mPerDegLat;
    const dLng = (cote / 2) / mPerDegLng;
    const poly = [
      [centre.lat - dLat, centre.lng - dLng],
      [centre.lat - dLat, centre.lng + dLng],
      [centre.lat + dLat, centre.lng + dLng],
      [centre.lat + dLat, centre.lng - dLng]
    ];
    Carto.setZone(poly);
    if (!Carto.getDecollage()) {
      Carto.setDecollage([centre.lat - dLat - 0.0008, centre.lng - dLng]);
    }
  }

  function bindDessin() {
    document.getElementById('btnDessinerZone').addEventListener('click', () => {
      Carto.startDraw('zone');
      Utils.toast('Cliquez sur la carte pour placer les sommets, double-cliquez pour fermer la zone.', 'info');
    });
    document.getElementById('btnDessinerExclusion').addEventListener('click', () => {
      Carto.startDraw('exclusion');
      Utils.toast('Dessinez la zone d\'exclusion, double-cliquez pour terminer.', 'info');
    });
    document.getElementById('btnPointDecollage').addEventListener('click', () => {
      Carto.startDraw('decollage');
      Utils.toast('Cliquez sur la carte pour placer le point de décollage.', 'info');
    });
    document.getElementById('fichierImport').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) Carto.importFile(f);
      e.target.value = '';
    });
    document.querySelectorAll('[data-layer]').forEach((cb) => {
      cb.addEventListener('change', () => Carto.toggleLayer(cb.dataset.layer, cb.checked));
    });
  }

  function renderExclusions() {
    const list = document.getElementById('listeExclusions');
    const ex = Carto.getExclusions();
    list.innerHTML = ex.length ? '' : '<li class="muted">Aucune zone d\'exclusion définie.</li>';
    ex.forEach((_, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>Exclusion ${i + 1}</span> <button class="btn-mini" data-i="${i}">Supprimer</button>`;
      li.querySelector('button').addEventListener('click', () => Carto.supprimerExclusion(i));
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------------
  // Calcul principal
  // ------------------------------------------------------------------
  function recalculer() {
    const zone = Carto.getZone();
    if (zone.length < 3) {
      Utils.toast('Définissez une zone (dessin, import ou zone de test) pour lancer les calculs.', 'warning');
      return;
    }
    const centre = Utils.centroid(zone);
    const surfaceM2 = Utils.polygonAreaM2(zone);

    const angle = state.vol.orientationAuto ? Calc.orientationOptimale(zone, centre) : state.vol.orientationLignes;
    const geometrie = Calc.bboxOriente(zone, centre, angle);

    const decollage = Carto.getDecollage();
    const distanceDecollageAuCentre = decollage ? Utils.haversine(decollage, centre) : 0;

    const params = {
      surfaceM2, geometrie, distanceDecollageAuCentre,
      drone: state.drone, camera: state.camera, vol: state.vol, couts: state.couts, limites: state.limites
    };

    const gsdTemp = Calc.calcGSD(state.vol.altitude, state.vol.focale, state.camera.capteurLargeurMm, state.camera.largeurPx);
    const empreinteTemp = Calc.calcEmpreinte(gsdTemp, state.camera.largeurPx, state.camera.hauteurPx);
    const espacementLignes = empreinteTemp.largeur * (1 - state.vol.recouvrementLat / 100);

    const resultatsGeo = Calc.calculerMission(params);
    const resultatsBatt = Batteries.calculerAutonomie({
      tempsVolGeometriqueMin: resultatsGeo.tempsVolParDroneMin,
      surfaceHa: resultatsGeo.surfaceHa,
      batterie: state.batteries
    });
    // Batteries.calculerAutonomie() raisonne "par drone" (tempsVolGeometriqueMin lui est déjà
    // transmis divisé par nbDrones). On remet à l'échelle de la flotte complète toutes les
    // grandeurs qui représentent un total réel de ressources/événements (batteries, rotations,
    // décollages, missions, coût, surface par vol) avant affichage/export.
    const nbDrones = resultatsGeo.nbDrones;
    const nbPairesMinimales = resultatsBatt.nbPairesMinimales * nbDrones;
    const nbBatteriesTB65 = nbPairesMinimales * 2;
    const nbMissionsAutomatiques = resultatsBatt.nbMissionsAutomatiques * nbDrones;
    const nbRotations = resultatsBatt.nbRotations * nbDrones;
    const nbDecollages = resultatsBatt.nbDecollages * nbDrones;
    const nbVolsFlotte = resultatsBatt.nbVols * nbDrones;
    const surfaceParBatterieHa = nbVolsFlotte > 0 ? resultatsGeo.surfaceHa / nbVolsFlotte : 0;
    const coefficientPC = Performance.coefficientDe(state.performance.types, state.performance.typeSelectionne);
    const empreintePx = state.camera.largeurPx * state.camera.hauteurPx;
    const resultatsTraitement = Traitement.calculerTraitement({
      nombrePhotos: resultatsGeo.nombrePhotos,
      empreintePx,
      surfaceM2: resultatsGeo.surfaceM2,
      gsd: resultatsGeo.gsd,
      formatCapture: state.vol.formatCapture,
      limites: state.limites,
      coefficientPC
    });

    const coutOperateur = (resultatsBatt.tempsTerrainTotalMin / 60) * (state.couts.tauxHoraireOperateur || 0);
    const coutBatteries = nbMissionsAutomatiques * (state.couts.coutCycleBatterie || 0);
    const coutTotal = coutOperateur + coutBatteries + resultatsGeo.coutTraitement;
    const resultats = {
      ...resultatsGeo, ...resultatsBatt, ...resultatsTraitement,
      nbPairesMinimales, nbBatteriesTB65, nbMissionsAutomatiques, nbRotations, nbDecollages,
      surfaceParBatterieHa, coutOperateur, coutBatteries, coutTotal, coefficientPC
    };
    dernierResultats = resultats;

    const plan = Carto.genererLignesDeVol(angle, espacementLignes, state.vol.margeSecurite);
    dernieresMissions = Batteries.genererPlanVols(resultatsGeo, resultatsBatt.nbVols, resultatsGeo.nombreLignes);

    majDashboard(resultats);
    majTraitement(resultats);
    majTableauMissions(dernieresMissions);
    majGraphiques(resultats, dernieresMissions);
    majValidation(params, resultatsBatt.alertes);
    document.getElementById('coutBloc').classList.toggle('is-hidden', resultats.coutTotal <= 0);
  }

  // ------------------------------------------------------------------
  // Tableau de bord
  // ------------------------------------------------------------------
  function majDashboard(r) {
    const cartes = {
      cardTempsVol: Utils.fmtDuration(r.tempsVolMin),
      cardBatteries: r.nbPairesMinimales,
      cardMissions: r.nbMissionsAutomatiques,
      cardRotations: r.nbRotations,
      cardDecollages: r.nbDecollages,
      cardDistance: `${Utils.fmt(r.distanceTotale / 1000, 2)} km`,
      cardPhotos: Utils.fmt(r.nombrePhotos, 0),
      cardRendement: `${Utils.fmt(r.rendementHaH, 2)} ha/h`,
      cardGSD: `${Utils.fmt(r.gsd, 2)} cm/px`,
      cardSurface: `${Utils.fmt(r.surfaceHa, 2)} ha`
    };
    Object.entries(cartes).forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    });

    document.getElementById('detailGeometrie').innerHTML = `
      <div><span>Empreinte photo</span><b>${Utils.fmt(r.empreinte.largeur, 1)} × ${Utils.fmt(r.empreinte.hauteur, 1)} m</b></div>
      <div><span>Espacement des lignes</span><b>${Utils.fmt(r.espacementLignes, 1)} m</b></div>
      <div><span>Espacement des photos</span><b>${Utils.fmt(r.espacementPhotos, 1)} m</b></div>
      <div><span>Intervalle de déclenchement</span><b>${Utils.fmt(r.intervalleDeclenchement, 2)} s</b></div>
      <div><span>Nombre de lignes</span><b>${r.nombreLignes}</b></div>
      <div><span>Longueur d'une ligne</span><b>${Utils.fmt(r.longueurLigne, 0)} m</b></div>
      <div><span>Surface par vol</span><b>${Utils.fmt(r.surfaceParBatterieHa, 2)} ha</b></div>
      <div><span>Temps total terrain</span><b>${Utils.fmtDuration(r.tempsTerrainTotalMin)}</b></div>
      <div><span>Batteries TB65 (unités)</span><b>${r.nbBatteriesTB65}</b></div>
      <div><span>Temps utile par paire</span><b>${Utils.fmtDuration(r.tempsUtileParPaireMin)}</b></div>
      <div><span>Autonomie restante (dernier vol)</span><b>${Utils.fmtDuration(r.autonomieRestanteMin)}</b></div>
    `;

    if (r.coutTotal > 0) {
      document.getElementById('detailCouts').innerHTML = `
        <div><span>Opérateur</span><b>${Utils.fmt(r.coutOperateur, 0)}</b></div>
        <div><span>Batteries</span><b>${Utils.fmt(r.coutBatteries, 0)}</b></div>
        <div><span>Traitement</span><b>${Utils.fmt(r.coutTraitement, 0)}</b></div>
        <div><span>Total</span><b>${Utils.fmt(r.coutTotal, 0)}</b></div>
      `;
    }
  }

  // ------------------------------------------------------------------
  // Estimation des traitements
  // ------------------------------------------------------------------
  function majTraitement(r) {
    const cartesTraitement = {
      cardTempsAlignement: `${Utils.fmt(r.tempsAlignementH, 2)} h`,
      cardTempsNuage: `${Utils.fmt(r.tempsNuageH, 2)} h`,
      cardTempsMNS: `${Utils.fmt(r.tempsMNSH, 2)} h`,
      cardTempsMNT: `${Utils.fmt(r.tempsMNTH, 2)} h`,
      cardTempsOrtho: `${Utils.fmt(r.tempsOrthophotoH, 2)} h`,
      cardTempsTotal: `${Utils.fmt(r.tempsTotalH, 2)} h`
    };
    Object.entries(cartesTraitement).forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    });

    document.getElementById('detailTaillesProduits').innerHTML = `
      <div><span>Images brutes</span><b>${Utils.fmtBytes(r.volumeImagesMo * 1024 * 1024)}</b></div>
      <div><span>Nuage de points</span><b>${Utils.fmtBytes(r.nuagePointsMo * 1024 * 1024)}</b></div>
      <div><span>MNS</span><b>${Utils.fmtBytes(r.mnsMo * 1024 * 1024)}</b></div>
      <div><span>MNT</span><b>${Utils.fmtBytes(r.mntMo * 1024 * 1024)}</b></div>
      <div><span>Orthophoto</span><b>${Utils.fmtBytes(r.orthophotoMo * 1024 * 1024)}</b></div>
    `;

    const margeStockagePct = Math.round((Traitement.DEFAULTS.margeStockage - 1) * 100);
    document.getElementById('detailStockage').innerHTML = `
      <div><span>Taille totale des produits</span><b>${Utils.fmtBytes(r.tailleTotaleMo * 1024 * 1024)}</b></div>
      <div><span>Capacité minimale recommandée (+${margeStockagePct} %)</span><b>${Utils.fmtBytes(r.stockageRecommandeMo * 1024 * 1024)}</b></div>
    `;
  }

  // ------------------------------------------------------------------
  // Conditions météo
  // ------------------------------------------------------------------
  function bindMeteo() {
    document.getElementById('btnMeteoRecentrer').addEventListener('click', recentrerMeteoSurZone);
    document.getElementById('btnActualiserMeteo').addEventListener('click', actualiserMeteo);
    document.getElementById('btnOuvrirVentusky').addEventListener('click', () => ouvrirLienMeteo('ventusky'));
    document.getElementById('btnOuvrirWindy').addEventListener('click', () => ouvrirLienMeteo('windy'));
    document.getElementById('btnOuvrirZoomEarth').addEventListener('click', () => ouvrirLienMeteo('zoomEarth'));
    document.getElementById('btnOuvrirUAVForecast').addEventListener('click', () => ouvrirLienMeteo('uavForecast'));
  }

  function recentrerMeteoSurZone() {
    const centre = Carto.getCentroid();
    if (!centre) {
      Utils.toast('Définissez une zone pour récupérer ses coordonnées.', 'warning');
      return;
    }
    state.meteo.latitude = +centre[0].toFixed(4);
    state.meteo.longitude = +centre[1].toFixed(4);
    document.getElementById('meteoLatitude').value = state.meteo.latitude;
    document.getElementById('meteoLongitude').value = state.meteo.longitude;
    majCoordsAffichage();
  }

  function majCoordsAffichage() {
    const el = document.getElementById('meteoCoordsAffichage');
    if (!el) return;
    el.textContent = (state.meteo.latitude != null && state.meteo.longitude != null)
      ? `${state.meteo.latitude}, ${state.meteo.longitude}`
      : '—';
  }

  async function actualiserMeteo() {
    if (state.meteo.latitude == null || state.meteo.longitude == null) {
      Utils.toast('Renseignez ou recentrez les coordonnées avant d\'actualiser la météo.', 'warning');
      return;
    }
    if (!state.meteo.date || !state.meteo.heure) {
      Utils.toast('Renseignez une date et une heure.', 'warning');
      return;
    }
    const requeteId = ++meteoRequeteEnCours;
    Utils.toast('Récupération des données météo…', 'info');
    try {
      const donnees = await Meteo.recupererMeteo({
        latitude: state.meteo.latitude, longitude: state.meteo.longitude,
        date: state.meteo.date, heure: state.meteo.heure
      });
      if (requeteId !== meteoRequeteEnCours) return;
      dernierResultatMeteo = Meteo.analyserFaisabilite(donnees);
      majMeteo(donnees, dernierResultatMeteo);
      Utils.toast('Météo actualisée.', 'success');
    } catch (err) {
      if (requeteId !== meteoRequeteEnCours) return;
      Utils.toast(`Échec de la récupération météo : ${err.message}`, 'danger');
    }
  }

  function ouvrirLienMeteo(service) {
    if (state.meteo.latitude == null || state.meteo.longitude == null) {
      Utils.toast('Renseignez ou recentrez les coordonnées avant d\'ouvrir un service météo.', 'warning');
      return;
    }
    const liens = Meteo.construireLiensExternes({ latitude: state.meteo.latitude, longitude: state.meteo.longitude });
    window.open(liens[service], '_blank', 'noopener');
  }

  function majMeteo(donnees, resultatFaisabilite) {
    document.getElementById('meteoCardVent').textContent = `${Utils.fmt(donnees.ventKmh, 1)} km/h`;
    document.getElementById('meteoCardRafales').textContent = `${Utils.fmt(donnees.rafalesKmh, 1)} km/h`;
    document.getElementById('meteoCardPrecipitations').textContent = `${Utils.fmt(donnees.precipitationMm, 1)} mm`;
    document.getElementById('meteoCardNuages').textContent = `${Utils.fmt(donnees.couvertureNuageusePct, 0)} %`;
    document.getElementById('meteoCardVisibilite').textContent = `${Utils.fmt(donnees.visibiliteKm, 1)} km`;
    document.getElementById('meteoCardBrouillard').textContent = donnees.brouillard ? 'Oui' : 'Non';
    document.getElementById('meteoCardHumidite').textContent = `${Utils.fmt(donnees.humiditePct, 0)} %`;
    document.getElementById('meteoCardOrage').textContent = donnees.orage ? 'Oui' : 'Non';

    const libelles = {
      autorisee: '🟢 MISSION AUTORISÉE',
      deconseillee: '🟠 MISSION DÉCONSEILLÉE',
      annulee: '🔴 MISSION ANNULÉE'
    };
    const raisonsHtml = resultatFaisabilite.raisons.length
      ? `<ul class="verdict-panel__raisons">${resultatFaisabilite.raisons.map((r) => `<li>${r}</li>`).join('')}</ul>`
      : '<p class="verdict-panel__raisons">Aucune restriction : tous les critères sont dans les seuils recommandés.</p>';
    document.getElementById('meteoVerdictHost').innerHTML = `
      <div class="verdict-panel verdict-panel--${resultatFaisabilite.verdict}">
        <div class="verdict-panel__titre">${libelles[resultatFaisabilite.verdict]}</div>
        ${raisonsHtml}
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Suivi post levé par drone — envoi d'un projet planifié
  // ------------------------------------------------------------------
  function bindEnvoiVersSuivi() {
    document.getElementById('btnEnvoyerVersSuivi').addEventListener('click', envoyerVersSuivi);
  }

  async function envoyerVersSuivi() {
    const zone = Carto.getZone();
    if (zone.length < 3) {
      Utils.toast('Définissez une zone avant d\'envoyer vers le suivi.', 'warning');
      return;
    }
    if (!dernierResultats) {
      Utils.toast('Aucun résultat de mission calculé pour le moment.', 'warning');
      return;
    }
    if (!dernierResultats.nbMissionsAutomatiques) {
      Utils.toast('La configuration actuelle ne permet aucun vol (vérifiez les paramètres batteries). Corrigez avant d\'envoyer vers le suivi.', 'warning');
      return;
    }
    const btn = document.getElementById('btnEnvoyerVersSuivi');
    btn.disabled = true;
    Utils.toast('Envoi du dossier vers le suivi…', 'info');
    try {
      await Suivi.creerDossierMission({
        nomZone: state.zone.nom || 'Zone sans nom',
        commune: state.zone.commune,
        superficieHa: dernierResultats.surfaceHa,
        nombreMissionsPrevues: dernierResultats.nbMissionsAutomatiques,
        agentReferentId: null,
        donneesPlanification: { etat: state, resultats: dernierResultats },
        zoneId: state.zone.id
      });
      Utils.toast('Dossier envoyé vers le Suivi post levé par drone.', 'success');
    } catch (err) {
      Utils.toast(`Échec de l'envoi vers le suivi : ${err.message}`, 'danger');
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Suivi post levé par drone — navigation de l'onglet (accès libre, sans authentification)
  // ------------------------------------------------------------------
  async function initialiserOngletSuivi() {
    peuplerCommunesSuivi();
    peuplerDatalistZonesSuivi();
  }

  const LIBELLES_STATUT_DOSSIER = { planifiee: 'Planifiée', en_cours: 'En cours', terminee: 'Terminée' };
  const BADGE_STATUT_DOSSIER = { planifiee: 'muted', en_cours: 'warning', terminee: 'success' };

  function bindFiltresSuivi() {
    document.getElementById('suiviZoneCommune').addEventListener('change', peuplerDatalistZonesSuivi);
    document.getElementById('suiviZoneNom').addEventListener('change', async (e) => {
      const zoneCorrespondante = zonesEnCache.find((z) => z.nom === e.target.value);
      if (!zoneCorrespondante) return;
      await chargerDossiersDeZoneSuivi(zoneCorrespondante.id);
    });
    document.getElementById('suiviDossierSelecteur').addEventListener('change', (e) => {
      if (e.target.value) afficherDetailSuivi(e.target.value);
    });
  }

  function peuplerDatalistZonesSuivi() {
    const communeFiltre = document.getElementById('suiviZoneCommune').value.trim();
    const zonesFiltrees = communeFiltre ? zonesEnCache.filter((z) => z.commune === communeFiltre) : zonesEnCache;
    document.getElementById('suiviZonesDatalist').innerHTML =
      zonesFiltrees.map((z) => `<option value="${Utils.escapeHtml(z.nom)}"></option>`).join('');
  }

  function peuplerCommunesSuivi() {
    const communes = Zones.communesDistinctes(zonesEnCache);
    document.getElementById('suiviCommunesDatalist').innerHTML =
      communes.map((c) => `<option value="${Utils.escapeHtml(c)}"></option>`).join('');
  }

  async function chargerDossiersDeZoneSuivi(zoneId) {
    suiviSousOngletActif = 'planification';
    const requeteId = ++suiviZoneRequeteEnCours;
    document.getElementById('suiviDetailHost').classList.add('is-hidden');
    const selecteurHost = document.getElementById('suiviDossierSelecteurHost');
    const selecteur = document.getElementById('suiviDossierSelecteur');
    const aucunMsg = document.getElementById('suiviZoneAucunDossier');
    selecteurHost.classList.add('is-hidden');
    aucunMsg.classList.add('is-hidden');
    try {
      const dossiers = await Suivi.listerDossiers({ zoneId });
      if (requeteId !== suiviZoneRequeteEnCours) return;
      if (dossiers.length === 0) {
        aucunMsg.classList.remove('is-hidden');
        return;
      }
      if (dossiers.length === 1) {
        await afficherDetailSuivi(dossiers[0].id);
        return;
      }
      selecteur.innerHTML = '<option value="">Choisir…</option>' +
        dossiers.map((d) => `<option value="${d.id}">${d.datePlanification} — ${LIBELLES_STATUT_DOSSIER[d.statutGlobal] || d.statutGlobal}</option>`).join('');
      selecteurHost.classList.remove('is-hidden');
    } catch (err) {
      if (requeteId !== suiviZoneRequeteEnCours) return;
      Utils.toast(`Échec du chargement des dossiers de la zone : ${err.message}`, 'danger');
    }
  }

  // ------------------------------------------------------------------
  // Zone & Cartographie — bibliothèque de zones partagées
  // ------------------------------------------------------------------
  let zonesEnCache = [];

  async function initialiserOngletZones() {
    try {
      zonesEnCache = await Zones.listerZones();
      peuplerCommunes();
      peuplerDatalistZones();
    } catch (err) {
      Utils.toast(`Échec du chargement des zones enregistrées : ${err.message}`, 'danger');
    }
  }

  function peuplerCommunes() {
    const communes = Zones.communesDistinctes(zonesEnCache);
    document.getElementById('communesDatalist').innerHTML =
      communes.map((c) => `<option value="${Utils.escapeHtml(c)}"></option>`).join('');
  }

  function peuplerDatalistZones() {
    const communeFiltre = document.getElementById('zoneCommune').value.trim();
    const zonesFiltrees = communeFiltre ? zonesEnCache.filter((z) => z.commune === communeFiltre) : zonesEnCache;
    document.getElementById('zonesDatalist').innerHTML =
      zonesFiltrees.map((z) => `<option value="${Utils.escapeHtml(z.nom)}"></option>`).join('');
  }

  function bindSelectionZone() {
    document.getElementById('zoneCommune').addEventListener('change', peuplerDatalistZones);
    document.getElementById('zoneNom').addEventListener('change', (e) => {
      const zoneCorrespondante = zonesEnCache.find((z) => z.nom === e.target.value);
      if (!zoneCorrespondante) return;
      chargerZone(zoneCorrespondante);
    });
  }

  function chargerZone(zone) {
    state.zone = { id: zone.id, nom: zone.nom, commune: zone.commune, description: zone.description };
    document.getElementById('zoneNom').value = zone.nom;
    document.getElementById('zoneDescription').value = zone.description || '';
    document.getElementById('zoneCommune').value = zone.commune || '';
    if (zone.geometrie && zone.geometrie.length >= 3) Carto.setZone(zone.geometrie);
  }

  function bindEnregistrerSupprimerZone() {
    document.getElementById('btnEnregistrerZone').addEventListener('click', enregistrerZone);
    document.getElementById('btnSupprimerZone').addEventListener('click', supprimerZoneActuelle);
  }

  async function enregistrerZone() {
    const zone = Carto.getZone();
    if (zone.length < 3) {
      Utils.toast('Dessinez une zone avant de l\'enregistrer.', 'warning');
      return;
    }
    const nom = document.getElementById('zoneNom').value.trim();
    if (!nom) {
      Utils.toast('Donnez un nom à la zone avant de l\'enregistrer.', 'warning');
      return;
    }
    const btn = document.getElementById('btnEnregistrerZone');
    btn.disabled = true;
    try {
      const donnees = {
        nom,
        commune: document.getElementById('zoneCommune').value.trim(),
        description: document.getElementById('zoneDescription').value,
        geometrie: zone
      };
      // Match volontairement par nom courant (pas par state.zone.id) : si l'utilisateur a
      // chargé une zone puis tape un nom différent avant d'enregistrer, cela crée une
      // nouvelle zone plutôt que de renommer/écraser silencieusement celle qui était
      // chargée — plus sûr pour une bibliothèque partagée entre plusieurs agents, au prix
      // de ne pas permettre de renommer une zone existante en un seul clic (il faudrait la
      // supprimer et l'enregistrer à nouveau sous le nouveau nom).
      const zoneCorrespondante = zonesEnCache.find((z) => z.nom === nom);
      const zoneEnregistree = zoneCorrespondante
        ? await Zones.mettreAJourZone(zoneCorrespondante.id, donnees)
        : await Zones.creerZone(donnees);
      state.zone = { id: zoneEnregistree.id, nom: zoneEnregistree.nom, commune: zoneEnregistree.commune, description: zoneEnregistree.description };
      zonesEnCache = await Zones.listerZones();
      peuplerCommunes();
      peuplerDatalistZones();
      Utils.toast('Zone enregistrée.', 'success');
    } catch (err) {
      Utils.toast(`Échec de l'enregistrement de la zone : ${err.message}`, 'danger');
    } finally {
      btn.disabled = false;
    }
  }

  async function supprimerZoneActuelle() {
    if (!state.zone.id) {
      Utils.toast('Aucune zone de la bibliothèque n\'est chargée.', 'warning');
      return;
    }
    const btn = document.getElementById('btnSupprimerZone');
    btn.disabled = true;
    try {
      await Zones.supprimerZone(state.zone.id);
      state.zone = { id: null, nom: '', commune: '', description: '' };
      document.getElementById('zoneNom').value = '';
      document.getElementById('zoneDescription').value = '';
      document.getElementById('zoneCommune').value = '';
      zonesEnCache = await Zones.listerZones();
      peuplerCommunes();
      peuplerDatalistZones();
      Utils.toast('Zone supprimée.', 'success');
    } catch (err) {
      Utils.toast(`Échec de la suppression de la zone : ${err.message}`, 'danger');
    } finally {
      btn.disabled = false;
    }
  }

  const LIBELLES_STATUT_VOL = { planifiee: 'Planifiée', executee: 'Exécutée', reportee: 'Reportée', incident: 'Incident', annulee: 'Annulée' };
  const BADGE_STATUT_VOL = { planifiee: 'muted', executee: 'success', reportee: 'warning', incident: 'danger', annulee: 'danger' };
  const LIBELLES_ETAPE = {
    alignement: 'Alignement', nuage_clairseme: 'Nuage clairsemé', nuage_dense: 'Nuage dense',
    mns: 'MNS', mnt: 'MNT', orthophoto: 'Orthophoto', modele_3d: 'Modèle 3D'
  };
  const LIBELLES_STATUT_ETAPE = { a_faire: 'À faire', en_cours: 'En cours', terminee: 'Terminée' };
  const BADGE_STATUT_ETAPE = { a_faire: 'muted', en_cours: 'warning', terminee: 'success' };
  const LIBELLES_LIVRABLE = { orthophoto: 'Orthophoto', mns: 'MNS', mnt: 'MNT', nuage_points: 'Nuage de points' };
  const LIBELLES_RESULTAT_QUALITE = { conforme: 'Conforme', rejete: 'Rejeté', a_reprendre: 'À reprendre' };
  const BADGE_RESULTAT_QUALITE = { conforme: 'success', rejete: 'danger', a_reprendre: 'warning' };
  const LIBELLES_TYPE_CHANGEMENT = {
    nouvelle_construction: 'Nouvelle construction', extension: 'Extension', demolition: 'Démolition',
    changement_occupation_sol: "Changement d'occupation du sol",
    anomalie_cadastrale: 'Anomalie cadastrale', anomalie_fiscale: 'Anomalie fiscale'
  };
  const LIBELLES_PRIORITE_CHANGEMENT = { faible: 'Faible', moyenne: 'Moyenne', haute: 'Haute' };
  const BADGE_PRIORITE_CHANGEMENT = { faible: 'success', moyenne: 'warning', haute: 'danger' };
  const LIBELLES_TYPE_OBJET_CADASTRAL = { parcelle: 'Parcelle', batiment: 'Bâtiment' };
  const LIBELLES_STATUT_CADASTRAL = { en_attente: 'En attente', valide: 'Validé', rejete: 'Rejeté' };
  const BADGE_STATUT_CADASTRAL = { en_attente: 'muted', valide: 'success', rejete: 'danger' };

  let suiviDossierActuel = null;
  let suiviSousOngletActif = 'planification';

  function bindSousOngletsSuivi() {
    document.querySelectorAll('.suivi-sous-onglet').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.suivi-sous-onglet').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const cible = btn.dataset.sousOnglet;
        suiviSousOngletActif = cible;
        document.getElementById('suiviSousOngletPlanification').classList.toggle('is-hidden', cible !== 'planification');
        document.getElementById('suiviSousOngletExecution').classList.toggle('is-hidden', cible !== 'execution');
        document.getElementById('suiviSousOngletTraitement').classList.toggle('is-hidden', cible !== 'traitement');
        document.getElementById('suiviSousOngletQualite').classList.toggle('is-hidden', cible !== 'qualite');
        document.getElementById('suiviSousOngletChangements').classList.toggle('is-hidden', cible !== 'changements');
        document.getElementById('suiviSousOngletCadastre').classList.toggle('is-hidden', cible !== 'cadastre');
      });
    });
  }

  async function afficherDetailSuivi(id) {
    const hote = document.getElementById('suiviDetailHost');
    hote.classList.remove('is-hidden');
    try {
      suiviDossierActuel = await Suivi.recupererDossier(id);
      majAffichageDetailSuivi();
    } catch (err) {
      hote.classList.add('is-hidden');
      Utils.toast(`Échec du chargement du dossier : ${err.message}`, 'danger');
    }
  }

  function majAffichageDetailSuivi() {
    const { dossier, executions, etapes, controles, equipe, autorisations } = suiviDossierActuel;
    const avancement = Suivi.calculerAvancementDossier(executions, etapes);

    document.getElementById('suiviDetailHost').innerHTML = `
      <div class="panel-box">
        <h3 id="suiviDetailTitre">${Utils.escapeHtml(dossier.nomZone)}</h3>
        <div id="suiviDetailInfos" class="kv-list">
          <div><span>Commune</span><b>${Utils.escapeHtml(dossier.commune) || '—'}</b></div>
          <div><span>Superficie</span><b>${dossier.superficieHa} ha</b></div>
          <div><span>Statut global</span><b>${LIBELLES_STATUT_DOSSIER[dossier.statutGlobal]}</b></div>
          <div><span>Avancement</span><b>${avancement} %</b></div>
        </div>
      </div>

      <div class="panel-box">
        <div class="btn-row">
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'planification' ? ' is-active' : ''}" data-sous-onglet="planification">Planification</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'execution' ? ' is-active' : ''}" data-sous-onglet="execution">Acquisition</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'traitement' ? ' is-active' : ''}" data-sous-onglet="traitement">Traitement</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'qualite' ? ' is-active' : ''}" data-sous-onglet="qualite">Contrôle qualité</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'changements' ? ' is-active' : ''}" data-sous-onglet="changements">Détection des changements</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'cadastre' ? ' is-active' : ''}" data-sous-onglet="cadastre">Mise à jour du cadastre</button>
        </div>
      </div>

      <div id="suiviSousOngletPlanification" class="suivi-sous-panel${suiviSousOngletActif === 'planification' ? '' : ' is-hidden'}">${rendreSousOngletPlanification(dossier, equipe, autorisations)}</div>
      <div id="suiviSousOngletExecution" class="suivi-sous-panel${suiviSousOngletActif === 'execution' ? '' : ' is-hidden'}">${rendreCartesExecutions(executions)}</div>
      <div id="suiviSousOngletTraitement" class="suivi-sous-panel${suiviSousOngletActif === 'traitement' ? '' : ' is-hidden'}">${rendreCartesEtapes(etapes)}</div>
      <div id="suiviSousOngletQualite" class="suivi-sous-panel${suiviSousOngletActif === 'qualite' ? '' : ' is-hidden'}">${rendreCartesQualite(controles)}</div>
      <div id="suiviSousOngletChangements" class="suivi-sous-panel${suiviSousOngletActif === 'changements' ? '' : ' is-hidden'}">${rendreSousOngletChangements(dossier)}</div>
      <div id="suiviSousOngletCadastre" class="suivi-sous-panel${suiviSousOngletActif === 'cadastre' ? '' : ' is-hidden'}">${rendreSousOngletCadastre(dossier)}</div>
    `;

    bindSousOngletsSuivi();
    bindFormulairesDetailSuivi();
  }

  function rendreCartesExecutions(executions) {
    if (executions.length === 0) return '<p class="hint">Aucun vol pour ce dossier.</p>';
    return executions.map((e) => `
      <div class="suivi-tache-carte" data-execution-id="${e.id}">
        <div class="suivi-tache-carte__entete">
          <b>Vol n°${e.numeroMission}</b>
          <span class="badge badge--${BADGE_STATUT_VOL[e.statut]}">${LIBELLES_STATUT_VOL[e.statut]}</span>
        </div>
        <div class="field-row">
          <div class="field"><label>Statut</label>
            <select class="suivi-vol-statut">
              ${Object.keys(LIBELLES_STATUT_VOL).map((v) => `<option value="${v}" ${v === e.statut ? 'selected' : ''}>${LIBELLES_STATUT_VOL[v]}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Date réelle</label><input type="date" class="suivi-vol-date" value="${e.dateReelle || ''}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Durée réelle (min)</label><input type="number" class="suivi-vol-duree" value="${e.dureeReelleMin ?? ''}"></div>
          <div class="field"><label>Photos réelles</label><input type="number" class="suivi-vol-photos" value="${e.photosReelles ?? ''}"></div>
        </div>
        <button class="btn btn--accent suivi-vol-enregistrer">Enregistrer</button>
        <button class="btn btn--ghost suivi-vol-couverture-reelle" data-execution-couverture="${e.id}">📍 Enregistrer la couverture réelle depuis la carte</button>
        ${e.couvertureReelle ? '<p class="hint">Couverture réelle déjà enregistrée pour ce vol.</p>' : ''}
        <div class="suivi-registre-host" data-registre-incidents="${e.id}">Chargement des incidents…</div>
        <div class="suivi-pieces-jointes-host" data-pieces-jointes="executions_vol:${e.id}">Chargement des pièces jointes…</div>
      </div>
    `).join('');
  }

  async function chargerRegistreIncidents(executionVolId) {
    const hote = document.querySelector(`[data-registre-incidents="${executionVolId}"]`);
    if (!hote) return;
    try {
      const incidents = await Suivi.listerIncidentsVol(executionVolId);
      hote.innerHTML = `
        <h4 class="mt">Registre des incidents</h4>
        ${incidents.length === 0 ? '<p class="hint">Aucun incident enregistré.</p>' : incidents.map((i) => `
          <p class="hint">${i.dateIncident} — <b>${Utils.escapeHtml(i.gravite)}</b> — ${Utils.escapeHtml(i.description)}</p>
        `).join('')}
        <div class="field-row">
          <div class="field"><label>Description</label><input type="text" class="suivi-incident-description" placeholder="Décrire l'incident"></div>
          <div class="field"><label>Gravité</label>
            <select class="suivi-incident-gravite">
              <option value="mineure">Mineure</option>
              <option value="majeure">Majeure</option>
              <option value="critique">Critique</option>
            </select>
          </div>
        </div>
        <button class="btn btn--accent suivi-incident-ajouter">Ajouter l'incident</button>
      `;
      const btnAjouterIncident = hote.querySelector('.suivi-incident-ajouter');
      btnAjouterIncident.addEventListener('click', async () => {
        const description = hote.querySelector('.suivi-incident-description').value.trim();
        if (!description) {
          Utils.toast('Décrivez l\'incident avant de l\'ajouter.', 'warning');
          return;
        }
        btnAjouterIncident.disabled = true;
        try {
          await Suivi.enregistrerIncidentVol(executionVolId, { description, gravite: hote.querySelector('.suivi-incident-gravite').value });
          Utils.toast('Incident enregistré.', 'success');
          await chargerRegistreIncidents(executionVolId);
        } catch (err) {
          Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
          btnAjouterIncident.disabled = false;
        }
      });
    } catch (err) {
      hote.innerHTML = `<p class="hint">Échec du chargement des incidents : ${Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async function chargerPiecesJointes(tableLiee, ligneId, hote) {
    try {
      const pieces = await Suivi.listerPiecesJointes(tableLiee, ligneId);
      hote.innerHTML = `
        <h4 class="mt">Pièces jointes</h4>
        ${pieces.length === 0 ? '<p class="hint">Aucun fichier.</p>' : pieces.map((p) => `
          <div class="suivi-piece-jointe" data-piece-id="${p.id}" data-chemin="${Utils.escapeHtml(p.cheminStorage)}">
            <span>${Utils.escapeHtml(p.nomOriginal)}</span>
            <button class="btn btn--ghost suivi-piece-telecharger">Télécharger</button>
            <button class="btn btn--ghost suivi-piece-supprimer">Supprimer</button>
          </div>
        `).join('')}
        <label class="btn btn--ghost btn--file">
          ⭱ Ajouter un fichier
          <input type="file" class="suivi-piece-fichier" hidden>
        </label>
      `;
      hote.querySelectorAll('.suivi-piece-telecharger').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const chemin = btn.closest('[data-chemin]').dataset.chemin;
          btn.disabled = true;
          try {
            const url = await Suivi.obtenirUrlSigneePieceJointe(chemin);
            window.open(url, '_blank');
          } catch (err) {
            Utils.toast(`Échec du téléchargement : ${err.message}`, 'danger');
          } finally {
            btn.disabled = false;
          }
        });
      });
      hote.querySelectorAll('.suivi-piece-supprimer').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('[data-piece-id]').dataset.pieceId;
          btn.disabled = true;
          try {
            await Suivi.supprimerPieceJointe(id);
            Utils.toast('Pièce jointe supprimée.', 'success');
            await chargerPiecesJointes(tableLiee, ligneId, hote);
          } catch (err) {
            Utils.toast(`Échec de la suppression : ${err.message}`, 'danger');
            btn.disabled = false;
          }
        });
      });
      const inputFichier = hote.querySelector('.suivi-piece-fichier');
      inputFichier.addEventListener('change', async () => {
        const fichier = inputFichier.files[0];
        if (!fichier) return;
        inputFichier.disabled = true;
        try {
          await Suivi.uploaderPieceJointe(tableLiee, ligneId, fichier, fichier.type || 'document');
          Utils.toast('Fichier ajouté.', 'success');
          await chargerPiecesJointes(tableLiee, ligneId, hote);
        } catch (err) {
          Utils.toast(`Échec du téléversement : ${err.message}`, 'danger');
          inputFichier.disabled = false;
          inputFichier.value = '';
        }
      });
    } catch (err) {
      hote.innerHTML = `<p class="hint">Échec du chargement des pièces jointes : ${Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async function chargerRegistreAnomalies(controleId) {
    const hote = document.querySelector(`[data-registre-anomalies="${controleId}"]`);
    if (!hote) return;
    try {
      const [anomalies, corrections] = await Promise.all([
        Suivi.listerAnomaliesQualite(controleId),
        Suivi.listerCorrections(controleId)
      ]);
      hote.innerHTML = `
        <h4 class="mt">Anomalies</h4>
        ${anomalies.length === 0 ? '<p class="hint">Aucune anomalie signalée.</p>' : anomalies.map((a) => `
          <div class="suivi-anomalie" data-anomalie-id="${a.id}">
            <span>${a.dateSignalement} — ${Utils.escapeHtml(a.description)}</span>
            <span class="badge badge--${a.statut === 'corrigee' ? 'success' : 'warning'}">${Utils.escapeHtml(a.statut)}</span>
            ${a.statut === 'ouverte' ? '<button class="btn btn--ghost suivi-anomalie-corriger">Marquer corrigée</button>' : ''}
          </div>
        `).join('')}
        <div class="field-row">
          <div class="field"><label>Nouvelle anomalie</label><input type="text" class="suivi-anomalie-description" placeholder="Décrire l'anomalie"></div>
        </div>
        <button class="btn btn--accent suivi-anomalie-ajouter">Signaler</button>

        <h4 class="mt">Historique des corrections</h4>
        ${corrections.length === 0 ? '<p class="hint">Aucune correction enregistrée.</p>' : corrections.map((c) => `
          <p class="hint">${c.dateCorrection} — ${Utils.escapeHtml(c.description)}</p>
        `).join('')}
        <div class="field-row">
          <div class="field"><label>Nouvelle correction</label><input type="text" class="suivi-correction-description" placeholder="Décrire la correction"></div>
        </div>
        <button class="btn btn--accent suivi-correction-ajouter">Enregistrer</button>
      `;
      hote.querySelectorAll('.suivi-anomalie-corriger').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('[data-anomalie-id]').dataset.anomalieId;
          btn.disabled = true;
          try {
            await Suivi.mettreAJourAnomalieQualite(id, 'corrigee');
            await chargerRegistreAnomalies(controleId);
          } catch (err) {
            Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
            btn.disabled = false;
          }
        });
      });
      const btnAjouterAnomalie = hote.querySelector('.suivi-anomalie-ajouter');
      btnAjouterAnomalie.addEventListener('click', async () => {
        const description = hote.querySelector('.suivi-anomalie-description').value.trim();
        if (!description) {
          Utils.toast('Décrivez l\'anomalie avant de la signaler.', 'warning');
          return;
        }
        btnAjouterAnomalie.disabled = true;
        try {
          await Suivi.signalerAnomalieQualite(controleId, description);
          Utils.toast('Anomalie signalée.', 'success');
          await chargerRegistreAnomalies(controleId);
        } catch (err) {
          Utils.toast(`Échec du signalement : ${err.message}`, 'danger');
          btnAjouterAnomalie.disabled = false;
        }
      });
      const btnAjouterCorrection = hote.querySelector('.suivi-correction-ajouter');
      btnAjouterCorrection.addEventListener('click', async () => {
        const description = hote.querySelector('.suivi-correction-description').value.trim();
        if (!description) {
          Utils.toast('Décrivez la correction avant de l\'enregistrer.', 'warning');
          return;
        }
        btnAjouterCorrection.disabled = true;
        try {
          await Suivi.enregistrerCorrection(controleId, description);
          Utils.toast('Correction enregistrée.', 'success');
          await chargerRegistreAnomalies(controleId);
        } catch (err) {
          Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
          btnAjouterCorrection.disabled = false;
        }
      });
    } catch (err) {
      hote.innerHTML = `<p class="hint">Échec du chargement des anomalies et corrections : ${Utils.escapeHtml(err.message)}</p>`;
    }
  }

  function rendreCartesEtapes(etapes) {
    if (etapes.length === 0) return '<p class="hint">Aucune étape de traitement pour ce dossier.</p>';
    return etapes.map((e) => `
      <div class="suivi-tache-carte" data-etape-id="${e.id}">
        <div class="suivi-tache-carte__entete">
          <b>${LIBELLES_ETAPE[e.etape]}</b>
          <span class="badge badge--${BADGE_STATUT_ETAPE[e.statut]}">${LIBELLES_STATUT_ETAPE[e.statut]}</span>
        </div>
        <div class="field-row">
          <div class="field"><label>Statut</label>
            <select class="suivi-etape-statut">
              ${Object.keys(LIBELLES_STATUT_ETAPE).map((v) => `<option value="${v}" ${v === e.statut ? 'selected' : ''}>${LIBELLES_STATUT_ETAPE[v]}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Durée réelle (min)</label><input type="number" class="suivi-etape-duree" value="${e.dureeReelleMin ?? ''}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Date début</label><input type="date" class="suivi-etape-debut" value="${e.dateDebut || ''}"></div>
          <div class="field"><label>Date fin</label><input type="date" class="suivi-etape-fin" value="${e.dateFin || ''}"></div>
        </div>
        <div class="field"><label>Taille produite (Mo)</label><input type="number" class="suivi-etape-taille" value="${e.tailleReelleMo ?? ''}"></div>
        <button class="btn btn--accent suivi-etape-enregistrer">Enregistrer</button>
        <div class="suivi-pieces-jointes-host" data-pieces-jointes="etapes_traitement:${e.id}">Chargement des pièces jointes…</div>
      </div>
    `).join('');
  }

  function rendreCartesQualite(controles) {
    const historique = controles.length === 0 ? '<p class="hint">Aucun contrôle enregistré.</p>' : controles.map((c) => `
      <div class="suivi-tache-carte">
        <div class="suivi-tache-carte__entete">
          <b>${LIBELLES_LIVRABLE[c.livrable]}</b>
          <span class="badge badge--${BADGE_RESULTAT_QUALITE[c.resultat]}">${LIBELLES_RESULTAT_QUALITE[c.resultat]}</span>
        </div>
        <p class="hint">${Utils.escapeHtml(c.commentaire) || 'Aucun commentaire.'} — ${c.dateControle}</p>
        <div class="suivi-registre-host" data-registre-anomalies="${c.id}">Chargement des anomalies…</div>
        <div class="suivi-pieces-jointes-host" data-pieces-jointes="controles_qualite:${c.id}">Chargement des pièces jointes…</div>
      </div>
    `).join('');

    return `
      ${historique}
      <div class="suivi-tache-carte">
        <b>Nouveau contrôle</b>
        <div class="field-row">
          <div class="field"><label>Livrable</label>
            <select id="suiviNouveauLivrable">
              ${Object.keys(LIBELLES_LIVRABLE).map((v) => `<option value="${v}">${LIBELLES_LIVRABLE[v]}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Résultat</label>
            <select id="suiviNouveauResultat">
              ${Object.keys(LIBELLES_RESULTAT_QUALITE).map((v) => `<option value="${v}">${LIBELLES_RESULTAT_QUALITE[v]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label>Commentaire</label><textarea id="suiviNouveauCommentaire" rows="2"></textarea></div>
        <button id="btnSuiviEnregistrerQualite" class="btn btn--accent">Enregistrer le contrôle</button>
      </div>
    `;
  }

  function rendreSousOngletChangements(dossier) {
    return `
      <div class="panel-box">
        <h3>Dossier de référence</h3>
        <p class="hint">Le levé antérieur de la même zone servant de comparaison "avant". Laisser vide pour un premier levé.</p>
        <div class="field">
          <label>Dossier de référence</label>
          <select id="changementsDossierReference"><option value="">Chargement…</option></select>
        </div>
      </div>

      <div class="panel-box">
        <h3>Carte des changements</h3>
        <div class="btn-row">
          <button id="btnChangementsDessiner" class="btn btn--accent">✎ Dessiner un changement</button>
          <button id="btnChangementsRapport" class="btn btn--ghost">⭳ Générer le rapport d'analyse territoriale</button>
        </div>
        <div class="suivi-mini-carte"><div id="changementsCarte"></div></div>

        <div id="changementsFormulaireHost" class="suivi-tache-carte is-hidden">
          <b>Nouveau changement</b>
          <div class="field-row">
            <div class="field"><label>Type</label>
              <select id="changementsNouveauType">
                ${Object.keys(LIBELLES_TYPE_CHANGEMENT).map((v) => `<option value="${v}">${LIBELLES_TYPE_CHANGEMENT[v]}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Priorité</label>
              <select id="changementsNouvellePriorite">
                ${Object.keys(LIBELLES_PRIORITE_CHANGEMENT).map((v) => `<option value="${v}" ${v === 'moyenne' ? 'selected' : ''}>${LIBELLES_PRIORITE_CHANGEMENT[v]}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Description</label><textarea id="changementsNouvelleDescription" rows="2"></textarea></div>
          <div class="btn-row">
            <button id="btnChangementsEnregistrer" class="btn btn--accent">Enregistrer</button>
            <button id="btnChangementsAnnuler" class="btn btn--ghost">Annuler</button>
          </div>
        </div>
      </div>

      <div class="panel-box" data-changements-liste="${dossier.id}:${dossier.zoneId || ''}">
        <h3>Changements enregistrés</h3>
        <p class="hint">Chargement…</p>
      </div>
    `;
  }

  function rendreSousOngletCadastre(dossier) {
    return `
      <div class="panel-box" data-cadastre-liste="${dossier.id}">
        <h3>Objets cadastraux</h3>
        <p class="hint">Chargement…</p>
      </div>
    `;
  }

  function rendreSousOngletPlanification(dossier, equipe, autorisations) {
    const indicateurs = Suivi.calculerIndicateursCharge([dossier]);
    return `
      <div class="panel-box">
        <h3 class="mt">Informations</h3>
        <div class="kv-list">
          <div><span>Drones affectés</span><b>${dossier.dronesAffectes.length ? dossier.dronesAffectes.map(Utils.escapeHtml).join(', ') : '—'}</b></div>
          <div><span>Budget prévisionnel</span><b>${dossier.budgetPrevisionnelFcfa != null ? dossier.budgetPrevisionnelFcfa.toLocaleString('fr-FR') + ' FCFA' : '—'}</b></div>
          <div><span>Missions actives</span><b>${indicateurs.missionsActives}</b></div>
        </div>
      </div>
      <div class="panel-box">
        <h3 class="mt">Équipe affectée</h3>
        ${equipe.length === 0 ? '<p class="hint">Aucun agent affecté.</p>' : equipe.map((m) => `
          <div class="suivi-tache-carte" data-membre-id="${m.id}">
            <div class="suivi-tache-carte__entete"><b>${Utils.escapeHtml(m.roleSurMission) || 'Membre'}</b>
              <button class="btn btn--ghost suivi-equipe-retirer">Retirer</button>
            </div>
          </div>
        `).join('')}
        <div class="suivi-tache-carte">
          <b>Affecter un agent</b>
          <div class="field-row">
            <div class="field"><label>Agent</label>
              <select id="suiviAffectationAgent"></select>
            </div>
            <div class="field"><label>Rôle sur la mission</label><input type="text" id="suiviAffectationRole" placeholder="Ex : Télépilote"></div>
          </div>
          <button id="btnSuiviAffecterAgent" class="btn btn--accent">Affecter</button>
        </div>
      </div>
      <div class="panel-box">
        <h3 class="mt">Autorisations à solliciter</h3>
        ${autorisations.length === 0 ? '<p class="hint">Aucune autorisation enregistrée.</p>' : autorisations.map((a) => `
          <div class="suivi-tache-carte" data-autorisation-id="${a.id}">
            <div class="suivi-tache-carte__entete"><b>${Utils.escapeHtml(a.intitule)}</b>
              <span class="badge badge--${a.statut === 'obtenue' ? 'success' : a.statut === 'refusee' ? 'danger' : 'muted'}">${Utils.escapeHtml(a.statut)}</span>
            </div>
            <div class="field-row">
              <div class="field"><label>Statut</label>
                <select class="suivi-autorisation-statut">
                  <option value="a_solliciter" ${a.statut === 'a_solliciter' ? 'selected' : ''}>À solliciter</option>
                  <option value="obtenue" ${a.statut === 'obtenue' ? 'selected' : ''}>Obtenue</option>
                  <option value="refusee" ${a.statut === 'refusee' ? 'selected' : ''}>Refusée</option>
                </select>
              </div>
              <div class="field"><label>Date d'obtention</label><input type="date" class="suivi-autorisation-date" value="${a.dateObtention || ''}"></div>
            </div>
            <button class="btn btn--accent suivi-autorisation-enregistrer">Enregistrer</button>
          </div>
        `).join('')}
        <div class="suivi-tache-carte">
          <b>Nouvelle autorisation</b>
          <div class="field"><label>Intitulé</label><input type="text" id="suiviNouvelleAutorisationIntitule" placeholder="Ex : Autorisation ANAC"></div>
          <button id="btnSuiviAjouterAutorisation" class="btn btn--accent">Ajouter</button>
        </div>
      </div>
    `;
  }

  async function chargerAgentsPourAffectation() {
    const select = document.getElementById('suiviAffectationAgent');
    if (!select) return;
    try {
      const agents = await Suivi.listerAgentsActifs();
      select.innerHTML = agents.map((agent) => `<option value="${agent.id}">${Utils.escapeHtml(agent.nomComplet)}</option>`).join('');
    } catch (err) {
      Utils.toast(`Échec du chargement des agents : ${err.message}`, 'danger');
    }
  }

  async function chargerDossiersReferencePourChangements(zoneId, dossierActuelId) {
    const select = document.getElementById('changementsDossierReference');
    if (!select) return;
    if (!zoneId) {
      select.innerHTML = '<option value="">Aucun (zone non rattachée à la bibliothèque)</option>';
      return;
    }
    try {
      const dossiers = await Suivi.listerDossiers({ zoneId });
      const autres = dossiers.filter((d) => d.id !== dossierActuelId);
      select.innerHTML = '<option value="">Aucun (premier levé)</option>' +
        autres.map((d) => `<option value="${d.id}">${d.datePlanification} — ${LIBELLES_STATUT_DOSSIER[d.statutGlobal] || d.statutGlobal}</option>`).join('');
    } catch (err) {
      select.innerHTML = '<option value="">Échec du chargement</option>';
      Utils.toast(`Échec du chargement des dossiers de référence : ${err.message}`, 'danger');
    }
  }

  let changementGeometrieEnAttente = null;
  let changementsActuelsPourRapport = [];
  let changementsFiltresActuels = { type: '', priorite: '' };

  async function chargerListeEtCarteChangements(dossierId, zoneId, hoteListe) {
    try {
      changementsFiltresActuels = { type: '', priorite: '' };
      CartoChangements.initMap('changementsCarte');
      bindFormulaireChangements(dossierId, zoneId, hoteListe);
      await rafraichirChangements(dossierId, zoneId, hoteListe);
    } catch (err) {
      hoteListe.innerHTML = `<h3>Changements enregistrés</h3><p class="hint">Échec du chargement : ${Utils.escapeHtml(err.message)}</p>`;
      Utils.toast(`Échec du chargement des changements : ${err.message}`, 'danger');
    }
  }

  async function rafraichirChangements(dossierId, zoneId, hoteListe) {
    const changements = await Suivi.listerChangements(dossierId);
    changementsActuelsPourRapport = changements;
    const objetsCadastraux = await Suivi.listerObjetsCadastraux(dossierId);
    const changementsOfficialises = new Set(objetsCadastraux.map((o) => o.changementId));
    CartoChangements.afficherChangements(changements);
    CartoChangements.invalidateSize();
    renderListeChangements(hoteListe, changements, changementsOfficialises);
    await chargerDossiersReferencePourChangements(zoneId, dossierId);
    return changements;
  }

  function bindFormulaireChangements(dossierId, zoneId, hoteListe) {
    const btnDessiner = document.getElementById('btnChangementsDessiner');
    const formulaireHost = document.getElementById('changementsFormulaireHost');
    const btnEnregistrer = document.getElementById('btnChangementsEnregistrer');
    const btnAnnuler = document.getElementById('btnChangementsAnnuler');
    const btnRapport = document.getElementById('btnChangementsRapport');
    if (!btnDessiner) return;

    changementGeometrieEnAttente = null;
    formulaireHost.classList.add('is-hidden');

    CartoChangements.on('polygoneTermine', (points) => {
      changementGeometrieEnAttente = points;
      formulaireHost.classList.remove('is-hidden');
    });

    btnDessiner.addEventListener('click', () => {
      formulaireHost.classList.add('is-hidden');
      changementGeometrieEnAttente = null;
      CartoChangements.startDraw();
      Utils.toast('Cliquez sur la carte pour placer les sommets du polygone, double-cliquez pour terminer.', 'info');
    });

    btnAnnuler.addEventListener('click', () => {
      CartoChangements.stopDraw();
      changementGeometrieEnAttente = null;
      formulaireHost.classList.add('is-hidden');
    });

    btnEnregistrer.addEventListener('click', async () => {
      if (!changementGeometrieEnAttente || changementGeometrieEnAttente.length < 3) {
        Utils.toast('Dessinez un polygone avant d\'enregistrer.', 'warning');
        return;
      }
      btnEnregistrer.disabled = true;
      try {
        await Suivi.enregistrerChangement(dossierId, {
          dossierReferenceId: document.getElementById('changementsDossierReference').value || null,
          type: document.getElementById('changementsNouveauType').value,
          priorite: document.getElementById('changementsNouvellePriorite').value,
          description: document.getElementById('changementsNouvelleDescription').value.trim(),
          geometrie: changementGeometrieEnAttente
        });
        Utils.toast('Changement enregistré.', 'success');
        changementGeometrieEnAttente = null;
        formulaireHost.classList.add('is-hidden');
        document.getElementById('changementsNouvelleDescription').value = '';
        await rafraichirChangements(dossierId, zoneId, hoteListe);
      } catch (err) {
        Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
      } finally {
        btnEnregistrer.disabled = false;
      }
    });

    if (btnRapport) {
      btnRapport.addEventListener('click', async () => {
        btnRapport.disabled = true;
        try {
          const select = document.getElementById('changementsDossierReference');
          const nomReference = select.selectedIndex > 0 ? select.options[select.selectedIndex].text : null;
          const stats = Suivi.calculerStatsChangements(changementsActuelsPourRapport);
          Exporter.exportRapportChangements(suiviDossierActuel.dossier, changementsActuelsPourRapport, nomReference, stats);
        } catch (err) {
          Utils.toast(`Échec de la génération du rapport : ${err.message}`, 'danger');
        } finally {
          btnRapport.disabled = false;
        }
      });
    }
  }

  function renderListeChangements(hoteListe, changements, changementsOfficialises, filtres = changementsFiltresActuels) {
    const filtres_actuels = { type: filtres.type || '', priorite: filtres.priorite || '' };
    changementsFiltresActuels = filtres_actuels;
    const visibles = Suivi.filtrerChangements(changements, filtres_actuels);
    hoteListe.innerHTML = `
      <h3>Changements enregistrés</h3>
      <div class="field-row">
        <div class="field"><label>Type</label>
          <select id="changementsFiltreType">
            <option value="">Tous</option>
            ${Object.keys(LIBELLES_TYPE_CHANGEMENT).map((v) => `<option value="${v}" ${v === filtres_actuels.type ? 'selected' : ''}>${LIBELLES_TYPE_CHANGEMENT[v]}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Priorité</label>
          <select id="changementsFiltrePriorite">
            <option value="">Toutes</option>
            ${Object.keys(LIBELLES_PRIORITE_CHANGEMENT).map((v) => `<option value="${v}" ${v === filtres_actuels.priorite ? 'selected' : ''}>${LIBELLES_PRIORITE_CHANGEMENT[v]}</option>`).join('')}
          </select>
        </div>
      </div>
      ${visibles.length === 0 ? '<p class="hint">Aucun changement pour ce filtre.</p>' : visibles.map((c) => `
        <div class="suivi-tache-carte" data-changement-id="${c.id}">
          <div class="suivi-tache-carte__entete">
            <b>${LIBELLES_TYPE_CHANGEMENT[c.type]}</b>
            <span class="badge badge--${BADGE_PRIORITE_CHANGEMENT[c.priorite]}">${LIBELLES_PRIORITE_CHANGEMENT[c.priorite]}</span>
          </div>
          <p class="hint">${Utils.escapeHtml(c.description) || 'Aucune description.'} — ${c.dateDetection}</p>
          ${changementsOfficialises.has(c.id) ? '<p><span class="badge badge--muted">Déjà officialisé — non supprimable</span></p>' : `
            <button class="btn btn--ghost suivi-changement-officialiser">Officialiser en objet cadastral</button>
            <div class="suivi-officialisation-host is-hidden">
              <div class="field-row">
                <div class="field"><label>Type</label>
                  <select class="suivi-officialisation-type">
                    <option value="parcelle">Parcelle</option>
                    <option value="batiment">Bâtiment</option>
                  </select>
                </div>
                <div class="field"><label>Référence</label><input type="text" class="suivi-officialisation-reference" placeholder="Ex : P-2026-014"></div>
              </div>
              <div class="field"><label>Description</label><textarea class="suivi-officialisation-description" rows="2">${Utils.escapeHtml(c.description)}</textarea></div>
              <div class="btn-row">
                <button class="btn btn--accent suivi-officialisation-confirmer">Confirmer</button>
                <button class="btn btn--ghost suivi-officialisation-annuler">Annuler</button>
              </div>
            </div>
            <button class="btn btn--ghost suivi-changement-supprimer">Supprimer</button>
          `}
        </div>
      `).join('')}
    `;

    const selectType = document.getElementById('changementsFiltreType');
    const selectPriorite = document.getElementById('changementsFiltrePriorite');
    selectType.addEventListener('change', () => renderListeChangements(hoteListe, changements, changementsOfficialises, { type: selectType.value, priorite: selectPriorite.value }));
    selectPriorite.addEventListener('change', () => renderListeChangements(hoteListe, changements, changementsOfficialises, { type: selectType.value, priorite: selectPriorite.value }));

    hoteListe.querySelectorAll('.suivi-changement-supprimer').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const carte = btn.closest('[data-changement-id]');
        const id = carte.dataset.changementId;
        btn.disabled = true;
        try {
          await Suivi.supprimerChangement(id);
          Utils.toast('Changement supprimé.', 'success');
          const dossierId = suiviDossierActuel.dossier.id;
          const zoneId = suiviDossierActuel.dossier.zoneId;
          await rafraichirChangements(dossierId, zoneId, hoteListe);
        } catch (err) {
          Utils.toast(`Échec de la suppression : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });

    hoteListe.querySelectorAll('.suivi-changement-officialiser').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.suivi-tache-carte').querySelector('.suivi-officialisation-host').classList.remove('is-hidden');
      });
    });

    hoteListe.querySelectorAll('.suivi-officialisation-annuler').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.suivi-officialisation-host').classList.add('is-hidden');
      });
    });

    hoteListe.querySelectorAll('.suivi-officialisation-confirmer').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const carte = btn.closest('[data-changement-id]');
        const changementId = carte.dataset.changementId;
        const host = carte.querySelector('.suivi-officialisation-host');
        const reference = host.querySelector('.suivi-officialisation-reference').value.trim();
        if (!reference) {
          Utils.toast('Indiquez une référence avant de confirmer.', 'warning');
          return;
        }
        const changement = changements.find((c) => c.id === changementId);
        btn.disabled = true;
        try {
          const dossierId = suiviDossierActuel.dossier.id;
          const zoneId = suiviDossierActuel.dossier.zoneId;
          await Suivi.officialiserChangement(changementId, dossierId, {
            type: host.querySelector('.suivi-officialisation-type').value,
            reference,
            description: host.querySelector('.suivi-officialisation-description').value.trim(),
            geometrie: changement.geometrie
          });
          Utils.toast('Objet cadastral créé.', 'success');
          await rafraichirChangements(dossierId, zoneId, hoteListe);
          await chargerRegistreCadastre(dossierId);
        } catch (err) {
          Utils.toast(`Échec de l'officialisation : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });
  }

  function bindFormulairesDetailSuivi() {
    document.querySelectorAll('[data-execution-id]').forEach((carte) => {
      const btn = carte.querySelector('.suivi-vol-enregistrer');
      btn.addEventListener('click', async () => {
        const id = carte.dataset.executionId;
        btn.disabled = true;
        try {
          await Suivi.mettreAJourExecutionVol(id, {
            statut: carte.querySelector('.suivi-vol-statut').value,
            dateReelle: carte.querySelector('.suivi-vol-date').value || null,
            dureeReelleMin: carte.querySelector('.suivi-vol-duree').value ? Number(carte.querySelector('.suivi-vol-duree').value) : null,
            photosReelles: carte.querySelector('.suivi-vol-photos').value ? Number(carte.querySelector('.suivi-vol-photos').value) : null
          });
          Utils.toast('Vol mis à jour.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-registre-incidents]').forEach((hote) => {
      chargerRegistreIncidents(hote.dataset.registreIncidents);
    });
    document.querySelectorAll('[data-execution-couverture]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const zoneActuelle = Carto.getZone();
        if (zoneActuelle.length < 3) {
          Utils.toast('Dessinez la couverture réelle sur la carte (onglet Zone & Cartographie) avant de l\'enregistrer ici.', 'warning');
          return;
        }
        btn.disabled = true;
        try {
          await Suivi.mettreAJourCouvertureReelle(btn.dataset.executionCouverture, zoneActuelle);
          Utils.toast('Couverture réelle enregistrée.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });
    document.querySelectorAll('[data-pieces-jointes]').forEach((hote) => {
      const [tableLiee, ligneId] = hote.dataset.piecesJointes.split(':');
      chargerPiecesJointes(tableLiee, ligneId, hote);
    });
    document.querySelectorAll('[data-registre-anomalies]').forEach((hote) => {
      chargerRegistreAnomalies(hote.dataset.registreAnomalies);
    });

    document.querySelectorAll('[data-changements-liste]').forEach((hote) => {
      const [dossierId, zoneId] = hote.dataset.changementsListe.split(':');
      chargerListeEtCarteChangements(dossierId, zoneId || null, hote);
    });

    document.querySelectorAll('[data-etape-id]').forEach((carte) => {
      const btn = carte.querySelector('.suivi-etape-enregistrer');
      btn.addEventListener('click', async () => {
        const id = carte.dataset.etapeId;
        btn.disabled = true;
        try {
          await Suivi.mettreAJourEtapeTraitement(id, {
            statut: carte.querySelector('.suivi-etape-statut').value,
            dateDebut: carte.querySelector('.suivi-etape-debut').value || null,
            dateFin: carte.querySelector('.suivi-etape-fin').value || null,
            dureeReelleMin: carte.querySelector('.suivi-etape-duree').value ? Number(carte.querySelector('.suivi-etape-duree').value) : null,
            tailleReelleMo: carte.querySelector('.suivi-etape-taille').value ? Number(carte.querySelector('.suivi-etape-taille').value) : null
          });
          Utils.toast('Étape mise à jour.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });

    const btnQualite = document.getElementById('btnSuiviEnregistrerQualite');
    if (btnQualite) {
      btnQualite.addEventListener('click', async () => {
        btnQualite.disabled = true;
        try {
          await Suivi.enregistrerControleQualite({
            missionSuiviId: suiviDossierActuel.dossier.id,
            livrable: document.getElementById('suiviNouveauLivrable').value,
            resultat: document.getElementById('suiviNouveauResultat').value,
            commentaire: document.getElementById('suiviNouveauCommentaire').value
          });
          Utils.toast('Contrôle qualité enregistré.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
          btnQualite.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-membre-id]').forEach((carte) => {
      const btn = carte.querySelector('.suivi-equipe-retirer');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await Suivi.retirerMembreEquipe(carte.dataset.membreId);
          Utils.toast('Membre retiré de l\'équipe.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec du retrait : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });

    chargerAgentsPourAffectation();
    const btnAffecterAgent = document.getElementById('btnSuiviAffecterAgent');
    if (btnAffecterAgent) {
      btnAffecterAgent.addEventListener('click', async () => {
        const agentId = document.getElementById('suiviAffectationAgent').value;
        const roleSurMission = document.getElementById('suiviAffectationRole').value.trim();
        if (!agentId || !roleSurMission) {
          Utils.toast('Choisissez un agent et indiquez son rôle sur la mission.', 'warning');
          return;
        }
        btnAffecterAgent.disabled = true;
        try {
          await Suivi.ajouterMembreEquipe(suiviDossierActuel.dossier.id, agentId, roleSurMission);
          Utils.toast('Agent affecté.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de l'affectation : ${err.message}`, 'danger');
          btnAffecterAgent.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-autorisation-id]').forEach((carte) => {
      const btn = carte.querySelector('.suivi-autorisation-enregistrer');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await Suivi.mettreAJourAutorisation(carte.dataset.autorisationId, {
            statut: carte.querySelector('.suivi-autorisation-statut').value,
            dateObtention: carte.querySelector('.suivi-autorisation-date').value || null
          });
          Utils.toast('Autorisation mise à jour.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
    });

    const btnAjouterAutorisation = document.getElementById('btnSuiviAjouterAutorisation');
    if (btnAjouterAutorisation) {
      btnAjouterAutorisation.addEventListener('click', async () => {
        const intitule = document.getElementById('suiviNouvelleAutorisationIntitule').value.trim();
        if (!intitule) {
          Utils.toast('Donnez un intitulé à l\'autorisation.', 'warning');
          return;
        }
        btnAjouterAutorisation.disabled = true;
        try {
          await Suivi.creerAutorisation(suiviDossierActuel.dossier.id, intitule);
          Utils.toast('Autorisation ajoutée.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de l'ajout : ${err.message}`, 'danger');
          btnAjouterAutorisation.disabled = false;
        }
      });
    }
  }

  function majTableauMissions(missions) {
    const tbody = document.querySelector('#tableMissions tbody');
    tbody.innerHTML = '';
    missions.forEach((m) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${m.id}</td><td>${m.batterie}</td>
        <td>${Utils.fmt(m.surfaceHa, 2)}</td>
        <td>${Utils.fmt(m.distance, 0)}</td>
        <td>${Utils.fmt(m.tempsMin, 1)}</td>
        <td>${m.photos}</td>
        <td><span class="badge badge--info">${m.statut}</span></td>`;
      tbody.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------
  function majValidation(params, alertesBatterie = []) {
    const alertes = Calc.validerParametres(params).concat(alertesBatterie);
    const host = document.getElementById('alertesHost');
    const badge = document.getElementById('navAlertBadge');
    host.innerHTML = '';
    if (!alertes.length) {
      host.innerHTML = '<div class="alerte alerte--success">✔ Aucune anomalie détectée : les paramètres respectent les seuils recommandés.</div>';
      badge.classList.add('is-hidden');
    } else {
      alertes.forEach((a) => {
        const div = document.createElement('div');
        div.className = `alerte alerte--${a.type}`;
        div.textContent = (a.type === 'danger' ? '✖ ' : '⚠ ') + a.msg;
        host.appendChild(div);
      });
      badge.classList.remove('is-hidden');
      badge.textContent = alertes.length;
    }
  }

  // ------------------------------------------------------------------
  // Graphiques (Chart.js)
  // ------------------------------------------------------------------
  function coul() {
    const clair = state.theme === 'clair';
    return {
      grille: clair ? '#D8DEE9' : '#223049',
      texte: clair ? '#33415C' : '#B9C6DC',
      accent: '#F0A84E', accent2: '#4FD1C5', accent3: '#7C9CF2', danger: '#F2545B', succes: '#4ADE80'
    };
  }

  function initCharts() {
    const c = coul();
    const communs = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: c.texte } } },
      scales: {
        x: { ticks: { color: c.texte }, grid: { color: c.grille } },
        y: { ticks: { color: c.texte }, grid: { color: c.grille } }
      }
    };

    charts.batteries = new Chart(document.getElementById('chartBatteries'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Temps de vol par batterie (min)', data: [], backgroundColor: c.accent }] },
      options: communs
    });
    charts.temps = new Chart(document.getElementById('chartTemps'), {
      type: 'doughnut',
      data: {
        labels: ['Décollage', 'Mission', 'Retour', 'Réserve'],
        datasets: [{ data: [0, 0, 0, 0], backgroundColor: [c.accent3, c.accent2, c.accent, c.danger] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: c.texte } } } }
    });
    charts.surface = new Chart(document.getElementById('chartSurface'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Surface par mission (ha)', data: [], backgroundColor: c.accent3 }] },
      options: communs
    });
    charts.photos = new Chart(document.getElementById('chartPhotos'), {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Photos par mission', data: [], borderColor: c.accent, backgroundColor: 'transparent', tension: 0.35 }] },
      options: communs
    });
    charts.distance = new Chart(document.getElementById('chartDistance'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Distance parcourue par mission (m)', data: [], backgroundColor: c.accent2 }] },
      options: communs
    });

    charts.traitementTemps = new Chart(document.getElementById('chartTraitementTemps'), {
      type: 'bar',
      data: {
        labels: ['Alignement', 'Nuage', 'MNS', 'MNT', 'Orthophoto'],
        datasets: [{ label: 'Temps (h)', data: [0, 0, 0, 0, 0], backgroundColor: c.accent3 }]
      },
      options: communs
    });
    charts.traitementTailles = new Chart(document.getElementById('chartTraitementTailles'), {
      type: 'doughnut',
      data: {
        labels: ['Images brutes', 'Nuage de points', 'MNS', 'MNT', 'Orthophoto'],
        datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: [c.accent, c.accent2, c.accent3, c.succes, c.danger] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: c.texte } } } }
    });
  }

  function majCouleursChart(chart) {
    const c = coul();
    if (chart.options.scales) {
      chart.options.scales.x.ticks.color = c.texte; chart.options.scales.x.grid.color = c.grille;
      chart.options.scales.y.ticks.color = c.texte; chart.options.scales.y.grid.color = c.grille;
    }
    if (chart.options.plugins?.legend) chart.options.plugins.legend.labels.color = c.texte;
  }

  function majGraphiques(r, missions) {
    const labels = missions.map((m) => m.batterie);
    charts.batteries.data.labels = labels;
    charts.batteries.data.datasets[0].data = missions.map((m) => +m.tempsMin.toFixed(1));
    charts.batteries.update();

    const reserveMin = state.batteries.autonomieParPaireMin - r.autonomieUtileMin;
    charts.temps.data.datasets[0].data = [
      +Math.max(0, state.batteries.tempsDecollageMin).toFixed(1),
      +Math.max(0, r.tempsUtileParPaireMin).toFixed(1),
      +Math.max(0, state.batteries.tempsRetourMin).toFixed(1),
      +Math.max(0, reserveMin).toFixed(1)
    ];
    charts.temps.update();

    charts.surface.data.labels = labels;
    charts.surface.data.datasets[0].data = missions.map((m) => +m.surfaceHa.toFixed(2));
    charts.surface.update();

    charts.photos.data.labels = labels;
    charts.photos.data.datasets[0].data = missions.map((m) => m.photos);
    charts.photos.update();

    charts.distance.data.labels = labels;
    charts.distance.data.datasets[0].data = missions.map((m) => Math.round(m.distance));
    charts.distance.update();

    charts.traitementTemps.data.datasets[0].data = [
      +r.tempsAlignementH.toFixed(2), +r.tempsNuageH.toFixed(2), +r.tempsMNSH.toFixed(2),
      +r.tempsMNTH.toFixed(2), +r.tempsOrthophotoH.toFixed(2)
    ];
    charts.traitementTemps.update();

    charts.traitementTailles.data.datasets[0].data = [
      +r.volumeImagesMo.toFixed(1), +r.nuagePointsMo.toFixed(1), +r.mnsMo.toFixed(1),
      +r.mntMo.toFixed(1), +r.orthophotoMo.toFixed(1)
    ];
    charts.traitementTailles.update();
  }

  // ------------------------------------------------------------------
  // Import / Export
  // ------------------------------------------------------------------
  function bindImportExport() {
    document.getElementById('btnExportCSV').addEventListener('click', () => {
      if (!dernieresMissions.length) return Utils.toast('Aucune mission calculée.', 'warning');
      Exporter.exportCSV(dernieresMissions, dernierResultats);
    });
    document.getElementById('btnExportExcel').addEventListener('click', () => {
      if (!dernieresMissions.length) return Utils.toast('Aucune mission calculée.', 'warning');
      Exporter.exportExcel(dernieresMissions, dernierResultats, state);
    });
    document.getElementById('btnExportPDF').addEventListener('click', () => {
      if (!dernieresMissions.length) return Utils.toast('Aucune mission calculée.', 'warning');
      const canvases = {
        'Temps de vol par batterie': charts.batteries.canvas,
        'Répartition du temps': charts.temps.canvas,
        'Surface par mission': charts.surface.canvas,
        'Photos par mission': charts.photos.canvas,
        'Temps par étape de traitement': charts.traitementTemps.canvas,
        'Répartition des tailles des produits': charts.traitementTailles.canvas
      };
      Exporter.exportPDF(dernieresMissions, dernierResultats, state, canvases);
    });
    document.getElementById('btnExportKML').addEventListener('click', () => {
      const zone = Carto.getZone();
      if (zone.length < 3) return Utils.toast('Aucune zone définie.', 'warning');
      const angle = state.vol.orientationAuto ? Calc.orientationOptimale(zone, Utils.centroid(zone)) : state.vol.orientationLignes;
      const gsdTemp = Calc.calcGSD(state.vol.altitude, state.vol.focale, state.camera.capteurLargeurMm, state.camera.largeurPx);
      const empreinteTemp = Calc.calcEmpreinte(gsdTemp, state.camera.largeurPx, state.camera.hauteurPx);
      const espacementLignes = empreinteTemp.largeur * (1 - state.vol.recouvrementLat / 100);
      const { lignes } = Carto.genererLignesDeVol(angle, espacementLignes, state.vol.margeSecurite);
      Utils.download(`plan_de_vol_${Date.now()}.kml`, Carto.exportWaypointsKML(lignes), 'application/vnd.google-earth.kml+xml');
      Utils.toast('Export KML des lignes de vol généré (compatible import DJI Pilot 2 / DJI Terra via conversion).', 'success');
    });

    document.getElementById('btnSauvegarderProjet').addEventListener('click', () => {
      Exporter.sauvegarderProjet({
        state, zone: Carto.getZone(), exclusions: Carto.getExclusions(), decollage: Carto.getDecollage()
      });
    });
    document.getElementById('fichierProjet').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = await Exporter.chargerProjet(f);
        Object.assign(state, data.state);
        if (!data.state.zone && data.state.nomZone) {
          state.zone = { id: null, nom: data.state.nomZone, commune: '', description: '' };
        }
        remplirFormulaireDepuisEtat();
        appliquerTheme();
        if (data.zone?.length) Carto.setZone(data.zone);
        if (data.decollage) Carto.setDecollage(data.decollage);
        renderExclusions();
        recalculer();
        Utils.toast('Projet rechargé.', 'success');
      } catch (err) {
        Utils.toast('Fichier projet invalide.', 'danger');
      }
    });
  }

  // ------------------------------------------------------------------
  // Comparaison de scénarios
  // ------------------------------------------------------------------
  function bindScenarios() {
    document.getElementById('btnAjouterScenario').addEventListener('click', () => {
      if (!dernierResultats) return;
      const nom = `Scénario ${scenarios.length + 1} (${state.vol.altitude} m, ${state.vol.focale} mm)`;
      scenarios.push({
        nom, altitude: state.vol.altitude, focale: state.vol.focale,
        gsd: dernierResultats.gsd, temps: dernierResultats.tempsVolMin,
        batteries: dernierResultats.nbPairesMinimales, photos: dernierResultats.nombrePhotos,
        rendement: dernierResultats.rendementHaH
      });
      renderScenarios();
    });
    document.getElementById('btnViderScenarios').addEventListener('click', () => {
      scenarios = []; renderScenarios();
    });
  }

  function renderScenarios() {
    const tbody = document.querySelector('#tableScenarios tbody');
    tbody.innerHTML = scenarios.length ? '' : '';
    document.getElementById('scenariosVide').classList.toggle('is-hidden', scenarios.length > 0);
    scenarios.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.nom}</td><td>${s.altitude}</td><td>${s.focale}</td>
        <td>${Utils.fmt(s.gsd, 2)}</td><td>${Utils.fmtDuration(s.temps)}</td>
        <td>${s.batteries}</td><td>${s.photos}</td><td>${Utils.fmt(s.rendement, 2)}</td>`;
      tbody.appendChild(tr);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
