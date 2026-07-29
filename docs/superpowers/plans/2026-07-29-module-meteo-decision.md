# Module Météo + Décision (Bloc C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic weather retrieval (Open-Meteo) and a mission-feasibility decision engine to DroneDCAD-Planification-Vol-PWA, plus deep links to 4 complementary weather services, in a new "Conditions météo" tab.

**Architecture:** One new IIFE module `meteo.js` (name mandated by the cahier des charges) holding both weather data handling and the decision engine, split internally into pure/testable functions (`construireUrlOpenMeteo`, `extraireDonneesHeure`, `analyserFaisabilite`, `construireLiensExternes`) and a single impure network function (`recupererMeteo`). `app.js` wires it into a new tab; no other existing module (`calculs.js`, `batteries.js`, `performance.js`, `traitement.js`) is touched — this is the app's first network dependency, isolated so the rest of the PWA stays fully offline-capable.

**Tech Stack:** Vanilla JS (no bundler, no framework), native `fetch()`, Node.js built-in test runner (`node:test` + `node:assert/strict`) for all pure logic, matching the established pattern from Blocs A/B.

Design reference: `docs/superpowers/specs/2026-07-29-module-meteo-decision-design.md`

---

## Design decisions locked in during planning (read before starting)

1. **Coordinates auto-fill happens once, on first navigation to the "Conditions météo" tab**, only if `state.meteo.latitude`/`longitude` are both still `null` and a zone exists (`Carto.getCentroid()` returns non-null). A "Recentrer sur la zone" button lets the user resync at any time afterward. This is implemented as a small addition to the existing `bindNavigation()` click handler, guarded by a one-time `meteoAutoRempliFait` flag so it never fights with a value the user typed manually.
2. **`heure` values are matched to Open-Meteo's hourly timestamps by truncating to the hour** (`extraireDonneesHeure` takes the `HH` part of an `HH:mm` string and looks for `{date}T{HH}:00` in `hourly.time`). This matches the native `<input type="time">` value format exactly.
3. **`state.meteo` (the input fields) is saved/restored with the project JSON** like `state.batteries`/`state.performance`; the fetched weather result and verdict are kept in a local `App` variable (`dernierResultatMeteo`), never written to `state`, so they don't survive a project reload — the user must click "Actualiser la météo" again after reopening a project, which is correct since weather goes stale over time regardless of when the project was saved.
4. **Test input numbers use realistic Abidjan-area coordinates** (`5.3364, -4.0267`) with exactly 4 decimal places so `toFixed(4)` round-trips produce the same string, keeping the `construireLiensExternes` test assertions exact-string-equality rather than needing tolerance.
5. **No changes to `export.js` in this bloc** — the design doc's scope explicitly excludes exporting weather data into PDF/Excel reports; that aggregation is Bloc D's job (final synthesis dashboard).

---

## Task 1: Test harness + failing tests for `meteo.js` data-handling functions

**Files:**
- Create: `drone-mission-app/tests/meteo.test.js`

- [ ] **Step 1: Write the failing tests**

Create `drone-mission-app/tests/meteo.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Meteo = require('../meteo.js');

test('construireUrlOpenMeteo: builds the exact expected Open-Meteo forecast URL', () => {
  const url = Meteo.construireUrlOpenMeteo({ latitude: 5.3364, longitude: -4.0267, date: '2026-08-01' });
  assert.equal(
    url,
    'https://api.open-meteo.com/v1/forecast?latitude=5.3364&longitude=-4.0267' +
    '&hourly=wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,visibility,relative_humidity_2m,weather_code' +
    '&start_date=2026-08-01&end_date=2026-08-01&wind_speed_unit=kmh'
  );
});

test('extraireDonneesHeure: extracts and converts the fields for the matching hour', () => {
  const reponseApi = {
    hourly: {
      time: ['2026-08-01T13:00', '2026-08-01T14:00'],
      wind_speed_10m: [15, 25],
      wind_gusts_10m: [20, 35],
      precipitation: [0, 0],
      cloud_cover: [40, 60],
      visibility: [15000, 8000],
      relative_humidity_2m: [55, 70],
      weather_code: [1, 45]
    }
  };
  const donnees = Meteo.extraireDonneesHeure(reponseApi, '2026-08-01', '14:00');
  assert.equal(donnees.ventKmh, 25);
  assert.equal(donnees.rafalesKmh, 35);
  assert.equal(donnees.precipitationMm, 0);
  assert.equal(donnees.couvertureNuageusePct, 60);
  assert.equal(donnees.visibiliteKm, 8);
  assert.equal(donnees.humiditePct, 70);
  assert.equal(donnees.codeTemps, 45);
  assert.equal(donnees.orage, false);
  assert.equal(donnees.brouillard, true);
});

test('extraireDonneesHeure: throws a clear error when the hour is outside the forecast range', () => {
  const reponseApi = {
    hourly: {
      time: ['2026-08-01T13:00'], wind_speed_10m: [15], wind_gusts_10m: [20],
      precipitation: [0], cloud_cover: [40], visibility: [15000],
      relative_humidity_2m: [55], weather_code: [1]
    }
  };
  assert.throws(() => Meteo.extraireDonneesHeure(reponseApi, '2026-08-01', '23:00'), /hors plage de prévision/);
});

test('construireLiensExternes: builds verified deep links for Ventusky/Windy and safe homepage links for the other two', () => {
  const liens = Meteo.construireLiensExternes({ latitude: 5.3364, longitude: -4.0267 });
  assert.equal(liens.ventusky, 'https://www.ventusky.com/5.3364;-4.0267');
  assert.equal(liens.windy, 'https://www.windy.com/?5.3364,-4.0267,10,d:picker');
  assert.equal(liens.zoomEarth, 'https://zoom.earth/');
  assert.equal(liens.uavForecast, 'https://www.uavforecast.com/');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/meteo.test.js`
Expected: FAIL — `Cannot find module '../meteo.js'` (file does not exist yet).

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/tests/meteo.test.js
git commit -m "test: add failing tests for Meteo data-handling functions"
```

---

## Task 2: Implement `meteo.js` data-handling functions

**Files:**
- Create: `drone-mission-app/meteo.js`

- [ ] **Step 1: Write the implementation**

Create `drone-mission-app/meteo.js`:

```js
/**
 * meteo.js
 * Récupération des conditions météo (Open-Meteo) pour une position/date/heure
 * données, moteur de décision de faisabilité de mission, et construction de
 * liens vers des services météo complémentaires (Ventusky, Windy, Zoom Earth,
 * UAV Forecast). Seule fonction impure du module : recupererMeteo() (fetch
 * réseau) ; tout le reste est pur et testable indépendamment.
 */

'use strict';

const Meteo = (() => {

  const DEFAULTS = {
    seuils: {
      ventAlerteKmh: 20,        // ≤20 OK, ]20,30] Alerte, >30 Annulation
      ventAnnulationKmh: 30,
      rafalesAlerteKmh: 30,     // ≤30 OK, >30 Alerte (pas de palier annulation)
      visibiliteAlerteKm: 10    // ≥10 OK, <10 Alerte
    },
    codesOrage: [95, 96, 99],       // codes météo WMO
    codesBrouillard: [45, 48]       // codes météo WMO
  };

  /** Construit l'URL de la requête Open-Meteo pour une position et une date. */
  function construireUrlOpenMeteo({ latitude, longitude, date }) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&hourly=wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,visibility,relative_humidity_2m,weather_code` +
      `&start_date=${date}&end_date=${date}&wind_speed_unit=kmh`;
  }

  /** Extrait et convertit les données de l'heure demandée depuis une réponse Open-Meteo. */
  function extraireDonneesHeure(reponseApi, date, heure) {
    const heureHH = heure.split(':')[0].padStart(2, '0');
    const cle = `${date}T${heureHH}:00`;
    const index = reponseApi.hourly.time.indexOf(cle);
    if (index === -1) {
      throw new Error(`Aucune donnée météo disponible pour ${date} à ${heureHH}:00 (hors plage de prévision Open-Meteo, ~16 jours).`);
    }
    const h = reponseApi.hourly;
    const codeTemps = h.weather_code[index];
    return {
      ventKmh: h.wind_speed_10m[index],
      rafalesKmh: h.wind_gusts_10m[index],
      precipitationMm: h.precipitation[index],
      couvertureNuageusePct: h.cloud_cover[index],
      visibiliteKm: h.visibility[index] / 1000,
      humiditePct: h.relative_humidity_2m[index],
      codeTemps,
      orage: DEFAULTS.codesOrage.includes(codeTemps),
      brouillard: DEFAULTS.codesBrouillard.includes(codeTemps)
    };
  }

  /** Construit les liens vers les services météo complémentaires pour une position donnée. */
  function construireLiensExternes({ latitude, longitude }) {
    const lat = Number(latitude).toFixed(4);
    const lon = Number(longitude).toFixed(4);
    return {
      ventusky: `https://www.ventusky.com/${lat};${lon}`,
      windy: `https://www.windy.com/?${lat},${lon},10,d:picker`,
      zoomEarth: 'https://zoom.earth/',
      uavForecast: 'https://www.uavforecast.com/'
    };
  }

  /** Récupère et extrait les données météo réelles pour une position/date/heure (impur, fetch réseau). */
  async function recupererMeteo({ latitude, longitude, date, heure }) {
    const url = construireUrlOpenMeteo({ latitude, longitude, date });
    const reponse = await fetch(url);
    if (!reponse.ok) {
      throw new Error(`Le service météo a répondu avec une erreur (HTTP ${reponse.status}).`);
    }
    const donneesApi = await reponse.json();
    return extraireDonneesHeure(donneesApi, date, heure);
  }

  return {
    DEFAULTS, construireUrlOpenMeteo, extraireDonneesHeure,
    construireLiensExternes, recupererMeteo
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Meteo;
```

Note: `analyserFaisabilite` is intentionally NOT in this file yet — it's added in Task 4. The `return` statement here will be extended in Task 4 to also export it.

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/meteo.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/meteo.js
git commit -m "feat: implement Meteo data-handling functions (Open-Meteo fetch/parse, external links)"
```

---

## Task 3: Test harness + failing tests for `Meteo.analyserFaisabilite`

**Files:**
- Modify: `drone-mission-app/tests/meteo.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `drone-mission-app/tests/meteo.test.js` (after the existing 4 tests, do not modify them):

```js
function donneesBase(overrides = {}) {
  return {
    ventKmh: 15, rafalesKmh: 20, precipitationMm: 0, couvertureNuageusePct: 40,
    visibiliteKm: 15, humiditePct: 55, codeTemps: 1, orage: false, brouillard: false,
    ...overrides
  };
}

test('analyserFaisabilite: fully OK conditions produce verdict autorisee with no raisons', () => {
  const r = Meteo.analyserFaisabilite(donneesBase());
  assert.equal(r.verdict, 'autorisee');
  assert.deepEqual(r.raisons, []);
});

test('analyserFaisabilite: vent boundary — 20 km/h is OK, 20.1 is alerte, 30 is alerte, 30.1 is annulation', () => {
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 20 })).verdict, 'autorisee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 20.1 })).verdict, 'deconseillee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 30 })).verdict, 'deconseillee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 30.1 })).verdict, 'annulee');
});

test('analyserFaisabilite: rafales boundary — 30 km/h is OK, 30.1 is alerte (no annulation tier)', () => {
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ rafalesKmh: 30 })).verdict, 'autorisee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ rafalesKmh: 30.1 })).verdict, 'deconseillee');
});

test('analyserFaisabilite: any precipitation triggers annulation', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ precipitationMm: 0.5 }));
  assert.equal(r.verdict, 'annulee');
  assert.ok(r.raisons.some((x) => /Précipitations/.test(x)));
});

test('analyserFaisabilite: thunderstorm (orage) triggers annulation', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ orage: true }));
  assert.equal(r.verdict, 'annulee');
  assert.ok(r.raisons.some((x) => /Orage/.test(x)));
});

test('analyserFaisabilite: visibilite boundary — 10 km is OK, 9.9 is alerte', () => {
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ visibiliteKm: 10 })).verdict, 'autorisee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ visibiliteKm: 9.9 })).verdict, 'deconseillee');
});

test('analyserFaisabilite: fog (brouillard) triggers annulation', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ brouillard: true }));
  assert.equal(r.verdict, 'annulee');
  assert.ok(r.raisons.some((x) => /Brouillard/.test(x)));
});

test('analyserFaisabilite: worst criterion wins — one annulation overrides multiple alertes', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ ventKmh: 25, rafalesKmh: 35, visibiliteKm: 8, brouillard: true }));
  assert.equal(r.verdict, 'annulee');
  assert.equal(r.raisons.length, 4);
});

test('analyserFaisabilite: couverture nuageuse and humidite are informational only (never affect verdict)', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ couvertureNuageusePct: 100, humiditePct: 100 }));
  assert.equal(r.verdict, 'autorisee');
  assert.deepEqual(r.raisons, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/meteo.test.js`
Expected: FAIL — the 9 new tests fail with `TypeError: Meteo.analyserFaisabilite is not a function` (the 4 pre-existing tests still pass).

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/tests/meteo.test.js
git commit -m "test: add failing tests for Meteo.analyserFaisabilite decision engine"
```

---

## Task 4: Implement `Meteo.analyserFaisabilite`

**Files:**
- Modify: `drone-mission-app/meteo.js`

- [ ] **Step 1: Add the decision engine function**

In `drone-mission-app/meteo.js`, add this function right after `extraireDonneesHeure` (before `construireLiensExternes`):

```js
  /**
   * Applique les règles de faisabilité à des données météo déjà extraites et
   * retourne le verdict global (le pire critère l'emporte) avec le détail par
   * critère et la liste des raisons pour les critères non-OK.
   */
  function analyserFaisabilite(donnees) {
    const s = DEFAULTS.seuils;
    const criteres = [];

    let statutVent = 'ok';
    if (donnees.ventKmh > s.ventAnnulationKmh) statutVent = 'annulation';
    else if (donnees.ventKmh > s.ventAlerteKmh) statutVent = 'alerte';
    criteres.push({ nom: 'Vent', valeur: `${donnees.ventKmh} km/h`, statut: statutVent });

    const statutRafales = donnees.rafalesKmh > s.rafalesAlerteKmh ? 'alerte' : 'ok';
    criteres.push({ nom: 'Rafales', valeur: `${donnees.rafalesKmh} km/h`, statut: statutRafales });

    const statutPrecipitations = donnees.precipitationMm > 0 ? 'annulation' : 'ok';
    criteres.push({ nom: 'Précipitations', valeur: `${donnees.precipitationMm} mm`, statut: statutPrecipitations });

    const statutOrage = donnees.orage ? 'annulation' : 'ok';
    criteres.push({ nom: 'Orage', valeur: donnees.orage ? 'Présent' : 'Absent', statut: statutOrage });

    const statutVisibilite = donnees.visibiliteKm < s.visibiliteAlerteKm ? 'alerte' : 'ok';
    criteres.push({ nom: 'Visibilité', valeur: `${donnees.visibiliteKm} km`, statut: statutVisibilite });

    const statutBrouillard = donnees.brouillard ? 'annulation' : 'ok';
    criteres.push({ nom: 'Brouillard', valeur: donnees.brouillard ? 'Présent' : 'Absent', statut: statutBrouillard });

    criteres.push({ nom: 'Couverture nuageuse', valeur: `${donnees.couvertureNuageusePct} %`, statut: 'ok' });
    criteres.push({ nom: 'Humidité', valeur: `${donnees.humiditePct} %`, statut: 'ok' });

    const pireStatut = criteres.some((c) => c.statut === 'annulation') ? 'annulation'
      : criteres.some((c) => c.statut === 'alerte') ? 'alerte' : 'ok';
    const verdict = pireStatut === 'annulation' ? 'annulee' : pireStatut === 'alerte' ? 'deconseillee' : 'autorisee';

    const raisons = criteres
      .filter((c) => c.statut !== 'ok')
      .map((c) => `${c.nom} : ${c.valeur} (${c.statut === 'annulation' ? "seuil d'annulation dépassé" : 'hors plage recommandée'})`);

    return { verdict, criteres, raisons };
  }
```

- [ ] **Step 2: Update the module's return statement**

Replace:

```js
  return {
    DEFAULTS, construireUrlOpenMeteo, extraireDonneesHeure,
    construireLiensExternes, recupererMeteo
  };
})();
```

with:

```js
  return {
    DEFAULTS, construireUrlOpenMeteo, extraireDonneesHeure, analyserFaisabilite,
    construireLiensExternes, recupererMeteo
  };
})();
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/meteo.test.js`
Expected: PASS — all 13 tests green (4 from Task 1 + 9 from Task 3).

Also re-run the full suite to confirm no cross-contamination:
Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 41 tests total (10 batteries + 7 calculs + 4 performance + 7 traitement + 13 meteo). If the reported count differs, what matters is 0 failures.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/meteo.js
git commit -m "feat: implement Meteo.analyserFaisabilite mission feasibility decision engine"
```

---

## Task 5: Wire `meteo.js` into `index.html` and `style.css`

**Files:**
- Modify: `drone-mission-app/index.html`
- Modify: `drone-mission-app/style.css`

- [ ] **Step 1: Load the new module**

In `drone-mission-app/index.html`, replace:

```html
<script src="traitement.js"></script>
<script src="cartographie.js"></script>
```

with:

```html
<script src="traitement.js"></script>
<script src="meteo.js"></script>
<script src="cartographie.js"></script>
```

- [ ] **Step 2: Add the new nav tab**

Replace:

```html
      <button class="nav__item" data-target="panel-traitement">
        <span class="nav__ico">🖥</span> Estimation des traitements
      </button>
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
```

with:

```html
      <button class="nav__item" data-target="panel-traitement">
        <span class="nav__ico">🖥</span> Estimation des traitements
      </button>
      <button class="nav__item" data-target="panel-meteo">
        <span class="nav__ico">☁</span> Conditions météo
      </button>
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
```

- [ ] **Step 3: Add the "Conditions météo" panel**

Replace:

```html
    <!-- ============ PANEL: EXPORT ============ -->
    <section id="panel-export" class="panel">
```

with:

```html
    <!-- ============ PANEL: METEO ============ -->
    <section id="panel-meteo" class="panel">
      <div class="panel-box">
        <h3>Paramètres de la prévision</h3>
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" id="meteoDate"></div>
          <div class="field"><label>Heure</label><input type="time" id="meteoHeure"></div>
        </div>
        <div class="field">
          <label>Commune</label>
          <input type="text" id="meteoCommune" placeholder="Ex : Yopougon">
        </div>
        <div class="field-row">
          <div class="field"><label>Latitude</label><input type="number" id="meteoLatitude" step="0.0001"></div>
          <div class="field"><label>Longitude</label><input type="number" id="meteoLongitude" step="0.0001"></div>
        </div>
        <div class="btn-row">
          <button id="btnMeteoRecentrer" class="btn btn--ghost">↺ Recentrer sur la zone</button>
          <button id="btnActualiserMeteo" class="btn btn--accent">Actualiser la météo</button>
        </div>
      </div>

      <div id="meteoVerdictHost"></div>

      <div class="cards-grid">
        <div class="card"><span class="card__label">Vent</span><span class="card__value" id="meteoCardVent">—</span></div>
        <div class="card"><span class="card__label">Rafales</span><span class="card__value" id="meteoCardRafales">—</span></div>
        <div class="card"><span class="card__label">Précipitations</span><span class="card__value" id="meteoCardPrecipitations">—</span></div>
        <div class="card"><span class="card__label">Couverture nuageuse</span><span class="card__value" id="meteoCardNuages">—</span></div>
        <div class="card"><span class="card__label">Visibilité</span><span class="card__value" id="meteoCardVisibilite">—</span></div>
        <div class="card"><span class="card__label">Brouillard</span><span class="card__value" id="meteoCardBrouillard">—</span></div>
        <div class="card"><span class="card__label">Humidité</span><span class="card__value" id="meteoCardHumidite">—</span></div>
        <div class="card"><span class="card__label">Risque d'orage</span><span class="card__value" id="meteoCardOrage">—</span></div>
      </div>

      <div class="panel-box">
        <h3>Contrôle visuel complémentaire</h3>
        <div class="btn-row">
          <button id="btnOuvrirVentusky" class="btn btn--ghost">Ouvrir dans Ventusky</button>
          <button id="btnOuvrirWindy" class="btn btn--ghost">Ouvrir dans Windy</button>
          <button id="btnOuvrirZoomEarth" class="btn btn--ghost">Ouvrir Zoom Earth</button>
          <button id="btnOuvrirUAVForecast" class="btn btn--ghost">Ouvrir UAV Forecast</button>
        </div>
        <p class="hint">Zoom Earth et UAV Forecast s'ouvrent sur leur page d'accueil ; coordonnées de la mission à coller sur place : <b id="meteoCoordsAffichage">—</b></p>
      </div>
    </section>

    <!-- ============ PANEL: EXPORT ============ -->
    <section id="panel-export" class="panel">
```

- [ ] **Step 4: Add the verdict panel CSS**

In `drone-mission-app/style.css`, replace:

```css
.alerte--success{background:rgba(74,222,128,.1); border-color:rgba(74,222,128,.35); color:var(--success);}

/* ---------------------------------- Cartographie ---------------------------------- */
```

with:

```css
.alerte--success{background:rgba(74,222,128,.1); border-color:rgba(74,222,128,.35); color:var(--success);}

/* ---------------------------------- Météo / verdict de faisabilité ---------------------------------- */
.verdict-panel{padding:20px 24px; border-radius:12px; border:1px solid transparent; margin-bottom:18px;}
.verdict-panel--autorisee{background:rgba(74,222,128,.1); border-color:rgba(74,222,128,.35); color:var(--success);}
.verdict-panel--deconseillee{background:rgba(240,168,78,.12); border-color:rgba(240,168,78,.4); color:var(--amber);}
.verdict-panel--annulee{background:rgba(242,84,91,.12); border-color:rgba(242,84,91,.4); color:#FF8A90;}
.verdict-panel__titre{font-size:1.3rem; font-weight:700; margin-bottom:8px;}
.verdict-panel__raisons{margin:0; padding-left:20px; font-size:.88rem; line-height:1.5;}

/* ---------------------------------- Cartographie ---------------------------------- */
```

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/index.html drone-mission-app/style.css
git commit -m "feat: add Conditions météo tab and verdict panel styling"
```

(No automated test for this step — static markup/CSS with no logic. Verified visually in Task 7.)

---

## Task 6: Update `app.js` to consume `Meteo`

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add `meteo` to `state`**

Replace:

```js
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
```

with:

```js
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
    nomZone: ''
  };
```

- [ ] **Step 2: Add module-local weather state**

Replace:

```js
  let dernierResultats = null;
  let dernieresMissions = [];
  let scenarios = [];
  const charts = {};
```

with:

```js
  let dernierResultats = null;
  let dernieresMissions = [];
  let dernierResultatMeteo = null;
  let meteoAutoRempliFait = false;
  let scenarios = [];
  const charts = {};
```

- [ ] **Step 3: Call `bindMeteo()` from `init()`**

Replace:

```js
  function init() {
    Carto.initMap('map');
    bindNavigation();
    bindTheme();
    bindFormulaires();
    bindDessin();
    bindImportExport();
    bindScenarios();
    initCharts();
```

with:

```js
  function init() {
    Carto.initMap('map');
    bindNavigation();
    bindTheme();
    bindFormulaires();
    bindDessin();
    bindImportExport();
    bindScenarios();
    bindMeteo();
    initCharts();
```

- [ ] **Step 4: Auto-fill coordinates on first visit to the météo tab**

Replace:

```js
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
```

with:

```js
  function bindNavigation() {
    document.querySelectorAll('.nav__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav__item').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const target = btn.dataset.target;
        document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('is-active', p.id === target));
        if (target === 'panel-carto') Carto.invalidateSize();
        if (target === 'panel-meteo' && !meteoAutoRempliFait) {
          meteoAutoRempliFait = true;
          if (state.meteo.latitude == null && state.meteo.longitude == null) recentrerMeteoSurZone();
        }
        document.getElementById('appShell').classList.remove('nav-open');
      });
    });
    document.getElementById('btnMenu').addEventListener('click', () => {
      document.getElementById('appShell').classList.toggle('nav-open');
    });
  }
```

- [ ] **Step 5: Add `meteo` fields to the `champs` binding table**

Replace:

```js
    ['pcType', 'performance.typeSelectionne', String],
    ['superficieManuelle', 'superficieManuelleHa', Number],
    ['nomZone', 'nomZone', String]
  ];
```

with:

```js
    ['pcType', 'performance.typeSelectionne', String],
    ['meteoDate', 'meteo.date', String],
    ['meteoHeure', 'meteo.heure', String],
    ['meteoCommune', 'meteo.commune', String],
    ['meteoLatitude', 'meteo.latitude', Number],
    ['meteoLongitude', 'meteo.longitude', Number],
    ['superficieManuelle', 'superficieManuelleHa', Number],
    ['nomZone', 'nomZone', String]
  ];
```

- [ ] **Step 6: Refresh the coordinates display on project reload**

Replace:

```js
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
```

with:

```js
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
```

- [ ] **Step 7: Add the météo functions block**

Replace:

```js
    const margeStockagePct = Math.round((Traitement.DEFAULTS.margeStockage - 1) * 100);
    document.getElementById('detailStockage').innerHTML = `
      <div><span>Taille totale des produits</span><b>${Utils.fmtBytes(r.tailleTotaleMo * 1024 * 1024)}</b></div>
      <div><span>Capacité minimale recommandée (+${margeStockagePct} %)</span><b>${Utils.fmtBytes(r.stockageRecommandeMo * 1024 * 1024)}</b></div>
    `;
  }

  function majTableauMissions(missions) {
```

with:

```js
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
    Utils.toast('Récupération des données météo…', 'info');
    try {
      const donnees = await Meteo.recupererMeteo({
        latitude: state.meteo.latitude, longitude: state.meteo.longitude,
        date: state.meteo.date, heure: state.meteo.heure
      });
      dernierResultatMeteo = Meteo.analyserFaisabilite(donnees);
      majMeteo(donnees, dernierResultatMeteo);
      Utils.toast('Météo actualisée.', 'success');
    } catch (err) {
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

  function majTableauMissions(missions) {
```

- [ ] **Step 8: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: wire Meteo module into app.js — new Conditions météo tab logic"
```

(No automated test for this step — `app.js` is pure DOM orchestration with no exported logic. Verified visually in Task 7.)

---

## Task 7: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve the app locally**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 2: Open in browser and check the new tab appears**

Open `http://localhost:8080`. Confirm no console errors. Click the new "Conditions météo" nav item. Confirm:
- Date field defaults to today, heure defaults to `09:00`.
- Latitude/longitude auto-fill from the demo zone's centroid (the app generates a demo zone on load) the first time this tab is opened.
- 8 weather cards show `—` placeholders, verdict panel is empty (no fetch yet).

- [ ] **Step 3: Test "Recentrer sur la zone"**

Go to "Zone & paramètres", change "Superficie de référence" to a different value, click "Générer une zone carrée" (this moves the zone). Go back to "Conditions météo", click "Recentrer sur la zone". Confirm latitude/longitude update to match the new zone.

- [ ] **Step 4: Test "Actualiser la météo" with a real network call**

With coordinates and today's date/an hour a few hours from now set, click "Actualiser la météo". Confirm:
- A toast confirms success.
- All 8 cards populate with real numeric values (not `NaN`/`undefined`).
- The verdict panel shows a colored banner (🟢/🟠/🔴 depending on actual current conditions) with a title and either "Aucune restriction..." or a bulleted reasons list.
- No console errors.

- [ ] **Step 5: Test the external link buttons**

Click "Ouvrir dans Ventusky" and "Ouvrir dans Windy" — confirm they open in a new tab at the correct coordinates (URL should contain the same lat/lon shown in the app). Click "Ouvrir Zoom Earth" and "Ouvrir UAV Forecast" — confirm they open the real homepages, and confirm the coordinates text next to the buttons matches what's in the latitude/longitude fields.

- [ ] **Step 6: Test error handling**

Pick a date more than ~16 days in the future in "Date", click "Actualiser la météo". Confirm a clear error toast appears (not a silent failure or a raw stack trace) and the app doesn't crash. Then pick today's date again to restore normal operation.

- [ ] **Step 7: Test project save/reload**

Go to "Export & projet", click "Sauvegarder le projet (.json)". Reload the page, reopen the saved project file. Confirm the météo tab's date/heure/commune/latitude/longitude are restored from the file, but the weather cards and verdict panel are back to empty placeholders (fetched results are correctly NOT persisted).

- [ ] **Step 8: Regression-check unrelated features**

Confirm the dashboard, batteries tab, estimation des traitements tab, missions table, exports, and PWA offline behavior (check the browser's dev tools Application/Service Worker panel still shows the service worker registered) are all unaffected.

- [ ] **Step 9: Run the full automated suite one last time**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — all tests green (use the actual reported count; see the note in Task 4 Step 3).

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "chore: manual verification pass for météo/decision module (Bloc C)"
```

(Only commit if verification uncovered fixes; if nothing changed, skip this step — there is nothing to commit.)
