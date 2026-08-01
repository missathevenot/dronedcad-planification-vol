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
    bindSuivi();
    bindFiltresSuivi();
    initCharts();

    Carto.on('zoneChanged', () => recalculer());
    Carto.on('exclusionsChanged', () => { renderExclusions(); recalculer(); });
    Carto.on('decollageChanged', () => recalculer());

    remplirFormulaireDepuisEtat();
    genererZoneTest(); // zone de démonstration au chargement
    recalculer();
    zonesChargeesFait = true;
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
    const session = await Suivi.sessionActuelle();
    if (!session) {
      Utils.toast('Connectez-vous dans l\'onglet « Suivi post levé par drone » avant d\'envoyer un dossier.', 'warning');
      document.querySelector('.nav__item[data-target="panel-suivi"]').click();
      return;
    }
    const btn = document.getElementById('btnEnvoyerVersSuivi');
    btn.disabled = true;
    Utils.toast('Envoi du dossier vers le suivi…', 'info');
    try {
      const profil = await Suivi.profilConnecte();
      await Suivi.creerDossierMission({
        nomZone: state.nomZone || 'Zone sans nom',
        commune: state.meteo.commune,
        superficieHa: dernierResultats.surfaceHa,
        nombreMissionsPrevues: dernierResultats.nbMissionsAutomatiques,
        agentReferentId: profil ? profil.id : null,
        donneesPlanification: state
      });
      Utils.toast('Dossier envoyé vers le Suivi post levé par drone.', 'success');
    } catch (err) {
      Utils.toast(`Échec de l'envoi vers le suivi : ${err.message}`, 'danger');
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Suivi post levé par drone — connexion et navigation de l'onglet
  // ------------------------------------------------------------------
  function bindSuivi() {
    document.getElementById('btnSuiviConnexion').addEventListener('click', connecterSuivi);
    document.getElementById('btnSuiviDeconnexion').addEventListener('click', deconnecterSuivi);
    document.getElementById('btnSuiviRetourListe')?.addEventListener('click', afficherListeSuivi);
  }

  async function initialiserOngletSuivi() {
    const session = await Suivi.sessionActuelle();
    if (session) {
      await afficherContenuSuiviConnecte();
    } else {
      document.getElementById('suiviConnexionHost').classList.remove('is-hidden');
      document.getElementById('suiviContenuHost').classList.add('is-hidden');
    }
  }

  async function connecterSuivi() {
    const email = document.getElementById('suiviEmail').value.trim();
    const motDePasse = document.getElementById('suiviMotDePasse').value;
    const erreurHost = document.getElementById('suiviConnexionErreur');
    erreurHost.classList.add('is-hidden');
    if (!email || !motDePasse) {
      erreurHost.textContent = 'Renseignez votre email et votre mot de passe.';
      erreurHost.classList.remove('is-hidden');
      return;
    }
    const btn = document.getElementById('btnSuiviConnexion');
    btn.disabled = true;
    try {
      await Suivi.connexion(email, motDePasse);
      document.getElementById('suiviMotDePasse').value = '';
      await afficherContenuSuiviConnecte();
    } catch (err) {
      erreurHost.textContent = err.message;
      erreurHost.classList.remove('is-hidden');
    } finally {
      btn.disabled = false;
    }
  }

  async function deconnecterSuivi() {
    const btn = document.getElementById('btnSuiviDeconnexion');
    btn.disabled = true;
    try {
      await Suivi.deconnexion();
      document.getElementById('suiviEmail').value = '';
      document.getElementById('suiviMotDePasse').value = '';
      document.getElementById('suiviConnexionHost').classList.remove('is-hidden');
      document.getElementById('suiviContenuHost').classList.add('is-hidden');
    } finally {
      btn.disabled = false;
    }
  }

  async function afficherContenuSuiviConnecte() {
    document.getElementById('suiviConnexionHost').classList.add('is-hidden');
    document.getElementById('suiviContenuHost').classList.remove('is-hidden');
    const profil = await Suivi.profilConnecte();
    document.getElementById('suiviUtilisateurConnecte').textContent =
      profil ? `Connecté : ${profil.nomComplet} (${profil.role})` : 'Connecté';
    await afficherListeSuivi();
  }

  const LIBELLES_STATUT_DOSSIER = { planifiee: 'Planifiée', en_cours: 'En cours', terminee: 'Terminée' };
  const BADGE_STATUT_DOSSIER = { planifiee: 'muted', en_cours: 'warning', terminee: 'success' };

  function bindFiltresSuivi() {
    document.getElementById('suiviFiltreStatut').addEventListener('change', afficherListeSuivi);
    document.getElementById('suiviFiltreCommune').addEventListener('input', Utils.debounce(afficherListeSuivi, 300));
  }

  // ------------------------------------------------------------------
  // Zone & Cartographie — bibliothèque de zones partagées
  // ------------------------------------------------------------------
  let zonesChargeesFait = false;
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

  async function afficherListeSuivi() {
    suiviSousOngletActif = 'execution';
    document.getElementById('suiviDetailHost').classList.add('is-hidden');
    document.getElementById('suiviListeHost').classList.remove('is-hidden');
    await Promise.all([majTableauDeBordSuivi(), rafraichirListeDossiers()]);
  }

  async function majTableauDeBordSuivi() {
    const requeteId = ++suiviTableauDeBordRequeteEnCours;
    try {
      const stats = await Suivi.recupererTableauDeBord();
      if (requeteId !== suiviTableauDeBordRequeteEnCours) return;
      document.getElementById('suiviStatTotal').textContent = stats.total;
      document.getElementById('suiviStatTermines').textContent = stats.termines;
      document.getElementById('suiviStatEnCours').textContent = stats.enCours;
      document.getElementById('suiviStatIncidents').textContent = stats.incidents;
      document.getElementById('suiviStatVolumetrie').textContent = Utils.fmtBytes(stats.volumetrieTotaleMo * 1024 * 1024);
    } catch (err) {
      if (requeteId !== suiviTableauDeBordRequeteEnCours) return;
      Utils.toast(`Échec du chargement du tableau de bord : ${err.message}`, 'danger');
    }
  }

  async function rafraichirListeDossiers() {
    const requeteId = ++suiviListeRequeteEnCours;
    const hote = document.getElementById('suiviListeDossiers');
    try {
      const filtres = {
        statut: document.getElementById('suiviFiltreStatut').value,
        commune: document.getElementById('suiviFiltreCommune').value.trim()
      };
      const dossiers = await Suivi.listerDossiers(filtres);
      if (requeteId !== suiviListeRequeteEnCours) return;
      if (dossiers.length === 0) {
        hote.innerHTML = '<p class="hint">Aucun dossier pour ces filtres.</p>';
        return;
      }
      hote.innerHTML = dossiers.map((d) => {
        const statutBadge = BADGE_STATUT_DOSSIER[d.statutGlobal] || 'muted';
        const statutLabel = LIBELLES_STATUT_DOSSIER[d.statutGlobal] || d.statutGlobal;
        return `
        <div class="suivi-carte-dossier" data-id="${d.id}">
          <div class="suivi-carte-dossier__ligne1">
            <span class="suivi-carte-dossier__titre">${Utils.escapeHtml(d.nomZone)}</span>
            <span class="badge badge--${statutBadge}">${statutLabel}</span>
          </div>
          <div class="suivi-carte-dossier__meta">${Utils.escapeHtml(d.commune) || 'Commune non renseignée'} · ${d.datePlanification} · ${d.superficieHa} ha</div>
        </div>
      `;
      }).join('');
      hote.querySelectorAll('.suivi-carte-dossier').forEach((carte) => {
        carte.addEventListener('click', () => afficherDetailSuivi(carte.dataset.id));
      });
    } catch (err) {
      if (requeteId !== suiviListeRequeteEnCours) return;
      hote.innerHTML = '';
      Utils.toast(`Échec du chargement des dossiers : ${err.message}`, 'danger');
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

  let suiviDossierActuel = null;
  let suiviSousOngletActif = 'execution';

  function bindSousOngletsSuivi() {
    document.querySelectorAll('.suivi-sous-onglet').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.suivi-sous-onglet').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const cible = btn.dataset.sousOnglet;
        suiviSousOngletActif = cible;
        document.getElementById('suiviSousOngletExecution').classList.toggle('is-hidden', cible !== 'execution');
        document.getElementById('suiviSousOngletTraitement').classList.toggle('is-hidden', cible !== 'traitement');
        document.getElementById('suiviSousOngletQualite').classList.toggle('is-hidden', cible !== 'qualite');
      });
    });
  }

  async function afficherDetailSuivi(id) {
    document.getElementById('suiviListeHost').classList.add('is-hidden');
    const hote = document.getElementById('suiviDetailHost');
    hote.classList.remove('is-hidden');
    try {
      suiviDossierActuel = await Suivi.recupererDossier(id);
      majAffichageDetailSuivi();
    } catch (err) {
      hote.classList.add('is-hidden');
      document.getElementById('suiviListeHost').classList.remove('is-hidden');
      Utils.toast(`Échec du chargement du dossier : ${err.message}`, 'danger');
    }
  }

  function majAffichageDetailSuivi() {
    const { dossier, executions, etapes, controles } = suiviDossierActuel;
    const avancement = Suivi.calculerAvancementDossier(executions, etapes);

    document.getElementById('suiviDetailHost').innerHTML = `
      <div class="panel-box">
        <button id="btnSuiviRetourListe" class="btn btn--ghost">← Retour à la liste</button>
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
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'execution' ? ' is-active' : ''}" data-sous-onglet="execution">Exécution des vols</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'traitement' ? ' is-active' : ''}" data-sous-onglet="traitement">Traitement</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'qualite' ? ' is-active' : ''}" data-sous-onglet="qualite">Contrôle qualité</button>
        </div>
      </div>

      <div id="suiviSousOngletExecution" class="suivi-sous-panel${suiviSousOngletActif === 'execution' ? '' : ' is-hidden'}">${rendreCartesExecutions(executions)}</div>
      <div id="suiviSousOngletTraitement" class="suivi-sous-panel${suiviSousOngletActif === 'traitement' ? '' : ' is-hidden'}">${rendreCartesEtapes(etapes)}</div>
      <div id="suiviSousOngletQualite" class="suivi-sous-panel${suiviSousOngletActif === 'qualite' ? '' : ' is-hidden'}">${rendreCartesQualite(controles)}</div>
    `;

    document.getElementById('btnSuiviRetourListe').addEventListener('click', afficherListeSuivi);
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
        <div class="field"><label>Incident (si applicable)</label><textarea class="suivi-vol-incident" rows="2">${Utils.escapeHtml(e.descriptionIncident) || ''}</textarea></div>
        <button class="btn btn--accent suivi-vol-enregistrer">Enregistrer</button>
      </div>
    `).join('');
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
            photosReelles: carte.querySelector('.suivi-vol-photos').value ? Number(carte.querySelector('.suivi-vol-photos').value) : null,
            descriptionIncident: carte.querySelector('.suivi-vol-incident').value
          });
          Utils.toast('Vol mis à jour.', 'success');
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
          btn.disabled = false;
        }
      });
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
