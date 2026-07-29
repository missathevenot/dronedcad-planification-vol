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
    theme: 'sombre',
    superficieManuelleHa: 50,
    nomZone: ''
  };

  let dernierResultats = null;
  let dernieresMissions = [];
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
    initCharts();

    Carto.on('zoneChanged', () => recalculer());
    Carto.on('exclusionsChanged', () => { renderExclusions(); recalculer(); });
    Carto.on('decollageChanged', () => recalculer());

    remplirFormulaireDepuisEtat();
    genererZoneTest(); // zone de démonstration au chargement
    recalculer();
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
        if (target === 'panel-carto') Carto.invalidateSize();
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
    ['superficieManuelle', 'superficieManuelleHa', Number],
    ['nomZone', 'nomZone', String]
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
        if (type === Number) v = parseFloat(v) || 0;
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

    document.getElementById('btnGenererZoneTest').addEventListener('click', genererZoneTest);
    document.getElementById('btnEffacerZone').addEventListener('click', () => Carto.effacerTout());
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

    document.getElementById('detailStockage').innerHTML = `
      <div><span>Taille totale des produits</span><b>${Utils.fmtBytes(r.tailleTotaleMo * 1024 * 1024)}</b></div>
      <div><span>Capacité minimale recommandée (+30 %)</span><b>${Utils.fmtBytes(r.stockageRecommandeMo * 1024 * 1024)}</b></div>
    `;
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
