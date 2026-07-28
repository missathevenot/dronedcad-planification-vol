# Module Batterie (Bloc B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the approximate battery/mission-count logic currently embedded in `calculs.js` with a dedicated, accurate `batteries.js` module modeling the DJI Matrice 350 RTK's TB65 battery pair (decollage/mission/retour/reserve breakdown, rotations, missions, decollages), and wire it into the existing dashboard, charts, validations and exports.

**Architecture:** New IIFE module `Batteries` (`drone-mission-app/batteries.js`), following the exact pattern of the existing `Calc`/`Utils`/`Exporter` modules. `calculs.js` keeps sole ownership of flight geometry (distance, lines, geometric flight time); `batteries.js` owns everything derived from battery autonomy (vol count, batteries needed, rotations, decollages, ground-swap time, rendement). `app.js` calls both modules in `recalculer()` and merges their outputs before rendering.

**Tech Stack:** Vanilla JS (no bundler, no framework), Node.js built-in test runner (`node:test` + `node:assert/strict`) for the two new pure-logic modules — zero new dependencies, consistent with this project having no build tooling. Manual browser verification for DOM/UI wiring, matching the project's existing (non-automated) verification approach.

Design reference: `docs/superpowers/specs/2026-07-25-module-batterie-design.md`

---

## Design decisions locked in during planning (read before starting)

These resolve ambiguities in the design doc that came up while writing exact code:

1. **`*PctReel` validation ratios are computed against the total `autonomieParPaireMin`** (not against the reserve-adjusted usable time), so that `decollagePct + missionPct + retourPct + reservePct` sum to exactly 100% by construction. This makes the four ranges from the spec (5-10 / 65-75 / 10-15 / 10-20) mutually satisfiable at defaults `tempsDecollageMin=2` (5%), `tempsRetourMin=4` (10%), `reserveSecuritePct=20` (fixed per the original cahier des charges), giving `missionPctReel=65%` — all four land exactly on their boundary, which is a valid (inclusive) pass. Comparisons use strict `<` / `>` so boundary values do not trigger a warning.
2. **`genererPlanMissions` moves from `calculs.js` to `batteries.js`**, renamed `genererPlanVols`, because it fundamentally splits flight lines across battery-flights (a battery concept), not geometry. It keeps taking the geometry result (`calcResultats`) as a parameter, plus the new `nbVols` count from `Batteries.calculerAutonomie`.
3. **`rendementHaH` and `surfaceParBatterieHa` move to `batteries.js`** (they divide by battery/vol count, so they're battery-derived, not geometry-derived), alongside `tempsChangementsMin` and `tempsTerrainTotalMin` as stated in the design doc.
4. **The existing `droneSwap` field (id unchanged) is repointed** from `drone.tempsChangementBatterie` to `batteries.tempsChangementBatterieMin` — no new DOM node needed for it, only its state binding changes.
5. **The existing `droneSecu` field is repurposed** from "Temps de sécurité RTB (min)" to "Réserve de sécurité (%)", repointed to `batteries.reserveSecuritePct` — again reusing the DOM node instead of adding a new one, per the approved design ("Autonomie" field relabeled, no mention of removing `droneSecu`).
6. **Old project JSON files** (saved via "Sauvegarder le projet") that predate this change and lack a `state.batteries` key will silently fall back to `Batteries.DEFAULTS` on reload (JS `Object.assign` only overwrites keys present in the loaded file) — no migration code needed, this is inherent to how `chargerProjet` already works for any new state key.
7. **(Added during Task 4 execution) `coutOperateur`/`coutBatteries`/`coutTotal` must be recomputed in Task 6.** Task 4's removal of `tempsTerrainTotalMin`/`nbBatteriesTotal` from `calculs.js` broke the pre-existing "coûts" block, which depended on them. As an interim fix, `calculs.js` now hardcodes `coutBatteries = 0` and computes `coutOperateur` from `tempsVolParDroneMin` (geometric only, undercounts battery-swap ground time) — see the `TODO(Task 6)` comment left in `calculs.js`. **Task 6 must fix this properly**: after merging `resultatsGeo`/`resultatsBatt` in `recalculer()`, recompute `coutOperateur = (resultatsBatt.tempsTerrainTotalMin / 60) * (state.couts.tauxHoraireOperateur || 0)` and `coutBatteries = resultatsBatt.nbMissionsAutomatiques * resultatsGeo.nbDrones * (state.couts.coutCycleBatterie || 0)`, then `coutTotal = coutOperateur + coutBatteries + resultatsGeo.coutTraitement`, overriding the stopgap values from `calculs.js` in the merged `resultats` object before `majDashboard`/`majValidation`/exports read it.

---

## Task 1: Test harness + failing tests for `Batteries.calculerAutonomie`

**Files:**
- Create: `drone-mission-app/tests/batteries.test.js`

- [ ] **Step 1: Write the failing tests**

Create `drone-mission-app/tests/batteries.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Batteries = require('../batteries.js');

const defaultBatterie = () => ({ ...Batteries.DEFAULTS });

test('calculerAutonomie: mission fitting in a single flight, defaults produce zero alertes', () => {
  const r = Batteries.calculerAutonomie({
    tempsVolGeometriqueMin: 20,
    surfaceHa: 10,
    batterie: defaultBatterie()
  });
  assert.equal(r.nbVols, 1);
  assert.equal(r.nbPairesMinimales, 1);
  assert.equal(r.nbBatteriesTB65, 2);
  assert.equal(r.nbRotations, 0);
  assert.equal(r.nbMissionsAutomatiques, 1);
  assert.equal(r.nbDecollages, 1);
  assert.equal(r.tempsUtileParPaireMin, 26); // 40*0.8 - 2 - 4
  assert.equal(r.autonomieRestanteMin, 6); // 26 - 20
  assert.deepEqual(r.alertes, []);
});

test('calculerAutonomie: mission requiring multiple flights', () => {
  const r = Batteries.calculerAutonomie({
    tempsVolGeometriqueMin: 60,
    surfaceHa: 25,
    batterie: defaultBatterie()
  });
  assert.equal(r.nbVols, 3); // ceil(60/26)
  assert.equal(r.nbPairesMinimales, 2);
  assert.equal(r.nbBatteriesTB65, 4);
  assert.equal(r.nbRotations, 2);
  assert.equal(r.nbMissionsAutomatiques, 3);
  assert.equal(r.nbDecollages, 3);
  assert.equal(r.autonomieRestanteMin, 18); // 3*26 - 60
  assert.equal(r.tempsChangementsMin, 8); // 2 rotations * 4 min
  assert.equal(r.tempsTerrainTotalMin, 68); // 60 + 8
  assert.ok(Math.abs(r.rendementHaH - (25 / (68 / 60))) < 1e-9);
});

test('calculerAutonomie: décollage + retour + réserve exceeding autonomy raises a danger alerte', () => {
  const b = defaultBatterie();
  b.reserveSecuritePct = 95;
  b.tempsDecollageMin = 10;
  b.tempsRetourMin = 10;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 30, surfaceHa: 5, batterie: b });
  assert.equal(r.nbVols, 0);
  assert.ok(r.alertes.some((a) => a.type === 'danger'));
});

test('calculerAutonomie: retour far above recommended range raises a warning (not a danger)', () => {
  const b = defaultBatterie();
  b.tempsRetourMin = 20;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 10, surfaceHa: 5, batterie: b });
  assert.ok(r.alertes.length > 0);
  assert.ok(r.alertes.every((a) => a.type === 'warning'));
});

test('calculerAutonomie: reserveSecuritePct out of [0,100] raises a danger alerte', () => {
  const b = defaultBatterie();
  b.reserveSecuritePct = 150;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 10, surfaceHa: 5, batterie: b });
  assert.ok(r.alertes.some((a) => a.type === 'danger'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/batteries.test.js`
Expected: FAIL — `Cannot find module '../batteries.js'` (file does not exist yet).

- [ ] **Step 3: Commit the failing test**

```bash
git add drone-mission-app/tests/batteries.test.js
git commit -m "test: add failing tests for Batteries.calculerAutonomie"
```

---

## Task 2: Implement `Batteries.calculerAutonomie` and `DEFAULTS`

**Files:**
- Create: `drone-mission-app/batteries.js`

- [ ] **Step 1: Write the implementation**

Create `drone-mission-app/batteries.js`:

```js
/**
 * batteries.js
 * Moteur d'autonomie et de rotation des batteries pour le DJI Matrice 350 RTK
 * (paire de TB65, mission photogrammétrique Zenmuse P1). Isole toute la logique
 * liée à l'autonomie du calcul de géométrie de vol (calculs.js) : nombre de
 * vols/batteries nécessaires, répartition décollage/mission/retour/réserve,
 * rotations, décollages, rendement.
 */

'use strict';

const Batteries = (() => {

  const DEFAULTS = {
    modele: 'TB65 (double batterie)',
    autonomieParPaireMin: 40,        // min, 38-42 selon conditions (Zenmuse P1)
    tempsDecollageMin: 2,            // min, décollage + montée (5 % de l'autonomie totale)
    tempsRetourMin: 4,               // min, retour au point de décollage + atterrissage (10 %)
    reserveSecuritePct: 20,          // % d'autonomie totale conservé en réserve de sécurité
    tempsChangementBatterieMin: 4,   // min, temps de remplacement d'une paire au sol
    // Plages de validation (cahier des charges) — pourcentages de l'autonomie TOTALE
    plages: {
      decollagePct: [5, 10],
      missionPct: [65, 75],
      retourPct: [10, 15],
      reservePct: [10, 20]
    }
  };

  /**
   * Calcule l'autonomie, le nombre de batteries/vols et la répartition de
   * consommation à partir du temps de vol géométrique total (issu de Calc).
   * @param {Object} p
   * @param {number} p.tempsVolGeometriqueMin - temps de vol géométrique total pour un drone (Calc.tempsVolParDroneMin)
   * @param {number} p.surfaceHa - surface totale de la mission (Calc.surfaceHa)
   * @param {Object} p.batterie - paramètres batterie courants (état de l'application, forme de DEFAULTS)
   */
  function calculerAutonomie(p) {
    const { tempsVolGeometriqueMin, surfaceHa } = p;
    const b = p.batterie;
    const alertes = [];

    if (b.reserveSecuritePct < 0 || b.reserveSecuritePct > 100) {
      alertes.push({ type: 'danger', msg: `Réserve de sécurité invalide (${b.reserveSecuritePct} %) : doit être comprise entre 0 et 100 %.` });
    }
    if (b.tempsDecollageMin < 0 || b.tempsRetourMin < 0) {
      alertes.push({ type: 'danger', msg: `Les temps de décollage et de retour ne peuvent pas être négatifs.` });
    }

    const autonomieUtileMin = b.autonomieParPaireMin * (1 - b.reserveSecuritePct / 100);
    const tempsUtileParPaireMin = autonomieUtileMin - b.tempsDecollageMin - b.tempsRetourMin;

    if (tempsUtileParPaireMin <= 0) {
      alertes.push({
        type: 'danger',
        msg: `Le temps de décollage (${b.tempsDecollageMin} min) + retour (${b.tempsRetourMin} min) + réserve (${b.reserveSecuritePct} %) dépasse l'autonomie de la batterie (${b.autonomieParPaireMin} min) : aucune marge de vol disponible.`
      });
    }

    const nbVols = tempsUtileParPaireMin > 0
      ? Math.max(1, Math.ceil(tempsVolGeometriqueMin / tempsUtileParPaireMin))
      : 0;

    const autonomieRestanteMin = nbVols > 0 ? (nbVols * tempsUtileParPaireMin) - tempsVolGeometriqueMin : 0;
    const nbPairesMinimales = nbVols <= 1 ? 1 : 2;
    const nbBatteriesTB65 = nbPairesMinimales * 2;
    const nbRotations = Math.max(0, nbVols - 1);
    const nbMissionsAutomatiques = nbVols;
    const nbDecollages = nbVols;

    const tempsChangementsMin = nbRotations * b.tempsChangementBatterieMin;
    const tempsTerrainTotalMin = tempsVolGeometriqueMin + tempsChangementsMin;
    const surfaceParBatterieHa = nbVols > 0 ? surfaceHa / nbVols : 0;
    const rendementHaH = tempsTerrainTotalMin > 0 ? surfaceHa / (tempsTerrainTotalMin / 60) : 0;

    // Répartition réelle en % de l'autonomie TOTALE (autonomieParPaireMin), pour validation
    const decollagePctReel = (b.tempsDecollageMin / b.autonomieParPaireMin) * 100;
    const missionPctReel = (tempsUtileParPaireMin / b.autonomieParPaireMin) * 100;
    const retourPctReel = (b.tempsRetourMin / b.autonomieParPaireMin) * 100;
    const reservePctReel = b.reserveSecuritePct;

    const [decMin, decMax] = DEFAULTS.plages.decollagePct;
    const [misMin, misMax] = DEFAULTS.plages.missionPct;
    const [retMin, retMax] = DEFAULTS.plages.retourPct;
    const [resMin, resMax] = DEFAULTS.plages.reservePct;

    if (tempsUtileParPaireMin > 0 && (decollagePctReel < decMin || decollagePctReel > decMax)) {
      alertes.push({ type: 'warning', msg: `Répartition décollage (${decollagePctReel.toFixed(1)} %) hors de la plage recommandée (${decMin}-${decMax} %).` });
    }
    if (tempsUtileParPaireMin > 0 && (missionPctReel < misMin || missionPctReel > misMax)) {
      alertes.push({ type: 'warning', msg: `Répartition mission (${missionPctReel.toFixed(1)} %) hors de la plage recommandée (${misMin}-${misMax} %).` });
    }
    if (tempsUtileParPaireMin > 0 && (retourPctReel < retMin || retourPctReel > retMax)) {
      alertes.push({ type: 'warning', msg: `Répartition retour (${retourPctReel.toFixed(1)} %) hors de la plage recommandée (${retMin}-${retMax} %).` });
    }
    if (reservePctReel < resMin || reservePctReel > resMax) {
      alertes.push({ type: 'warning', msg: `Réserve de sécurité (${reservePctReel} %) hors de la plage recommandée (${resMin}-${resMax} %).` });
    }

    return {
      autonomieUtileMin, tempsUtileParPaireMin, nbVols, autonomieRestanteMin,
      nbPairesMinimales, nbBatteriesTB65, nbRotations, nbMissionsAutomatiques,
      nbDecollages, tempsChangementsMin, tempsTerrainTotalMin, surfaceParBatterieHa,
      rendementHaH, decollagePctReel, missionPctReel, retourPctReel, reservePctReel,
      alertes
    };
  }

  return { DEFAULTS, calculerAutonomie };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Batteries;
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/batteries.test.js`
Expected: PASS — all 5 tests green (the `genererPlanVols` tests are added in Task 3, don't exist yet).

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/batteries.js
git commit -m "feat: implement Batteries.calculerAutonomie battery autonomy model"
```

---

## Task 3: Implement `Batteries.genererPlanVols`

**Files:**
- Modify: `drone-mission-app/tests/batteries.test.js`
- Modify: `drone-mission-app/batteries.js`

- [ ] **Step 1: Write the failing tests**

Append to `drone-mission-app/tests/batteries.test.js`:

```js
test('genererPlanVols: splits lines evenly across the required number of flights', () => {
  const calcResultats = {
    longueurLigne: 500, espacementLignes: 60, distanceTotale: 4000,
    tempsVolParDroneMin: 20, surfaceHa: 12, nombrePhotos: 240
  };
  const missions = Batteries.genererPlanVols(calcResultats, 2, 4);
  assert.equal(missions.length, 2);
  assert.equal(missions[0].batterie, 'Batterie 1');
  assert.equal(missions[1].batterie, 'Batterie 2');
  assert.equal(missions[0].lignes + missions[1].lignes, 4);
  assert.ok(Math.abs((missions[0].surfaceHa + missions[1].surfaceHa) - 12) < 1e-9);
  assert.equal(missions[0].photos + missions[1].photos, 240);
  assert.equal(missions[0].statut, 'Planifiée');
});

test('genererPlanVols: returns an empty array when nbVols is 0', () => {
  const calcResultats = { longueurLigne: 500, espacementLignes: 60, distanceTotale: 4000, tempsVolParDroneMin: 20, surfaceHa: 12, nombrePhotos: 240 };
  const missions = Batteries.genererPlanVols(calcResultats, 0, 4);
  assert.deepEqual(missions, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/batteries.test.js`
Expected: FAIL — `Batteries.genererPlanVols is not a function`.

- [ ] **Step 3: Implement `genererPlanVols`**

In `drone-mission-app/batteries.js`, add this function inside the `Batteries` IIFE, right after `calculerAutonomie`:

```js
  /** Découpe la mission globale en un plan de vol par paire de batteries (tableau des missions) */
  function genererPlanVols(calcResultats, nbVols, nombreLignesTotal) {
    const missions = [];
    if (!nbVols || nbVols <= 0) return missions;
    const lignesParVol = Math.max(1, Math.ceil(nombreLignesTotal / nbVols));
    let ligneRestantes = nombreLignesTotal;
    let idx = 1;
    while (ligneRestantes > 0) {
      const lignesIci = Math.min(lignesParVol, ligneRestantes);
      const distance = lignesIci * calcResultats.longueurLigne
        + Math.max(0, lignesIci - 1) * calcResultats.espacementLignes;
      const temps = distance / (calcResultats.distanceTotale / calcResultats.tempsVolParDroneMin || 1);
      missions.push({
        id: idx,
        batterie: `Batterie ${idx}`,
        lignes: lignesIci,
        surfaceHa: calcResultats.surfaceHa * (lignesIci / nombreLignesTotal),
        distance,
        tempsMin: temps,
        photos: Math.round(calcResultats.nombrePhotos * (lignesIci / nombreLignesTotal)),
        statut: 'Planifiée'
      });
      ligneRestantes -= lignesIci;
      idx++;
    }
    return missions;
  }
```

And update the module's return statement to:

```js
  return { DEFAULTS, calculerAutonomie, genererPlanVols };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/batteries.test.js`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/batteries.js drone-mission-app/tests/batteries.test.js
git commit -m "feat: implement Batteries.genererPlanVols mission-splitting logic"
```

---

## Task 4: Strip battery logic out of `calculs.js`

**Files:**
- Create: `drone-mission-app/tests/calculs.test.js`
- Modify: `drone-mission-app/utils.js`
- Modify: `drone-mission-app/calculs.js`

- [ ] **Step 1: Add a CommonJS export guard to `utils.js`**

In `drone-mission-app/utils.js`, the module ends with:

```js
  return {
    uid, fmt, fmtDuration, fmtBytes, haToM2, m2ToHa, km2ToM2,
    haversine, polygonAreaM2, centroid, toast, debounce, clamp, now,
    toCSV, download
  };
})();
```

Add immediately after (new final line of the file):

```js

if (typeof module !== 'undefined' && module.exports) module.exports = Utils;
```

- [ ] **Step 2: Write the failing regression tests**

Create `drone-mission-app/tests/calculs.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

global.Utils = require('../utils.js');
const Calc = require('../calculs.js');

function baseParams(overrides = {}) {
  return {
    surfaceM2: 500000,
    geometrie: { longueur: 700, largeur: 500 },
    distanceDecollageAuCentre: 100,
    drone: { ...Calc.DEFAULTS.drone, ...overrides.drone },
    camera: { ...Calc.DEFAULTS.camera, ...overrides.camera },
    vol: { ...Calc.DEFAULTS.vol, ...overrides.vol },
    couts: { ...Calc.DEFAULTS.couts, ...overrides.couts },
    limites: { ...Calc.DEFAULTS.limites, ...overrides.limites }
  };
}

test('calculerMission still computes geometry and photogrammetric product fields', () => {
  const r = Calc.calculerMission(baseParams());
  assert.ok(r.gsd > 0);
  assert.ok(r.nombreLignes >= 1);
  assert.ok(r.tempsVolMin > 0);
  assert.ok(r.orthophotoMo > 0);
  assert.ok(r.nuagePointsMo > 0);
  assert.ok(r.mnsMo > 0);
  assert.ok(r.mntMo > 0);
});

test('calculerMission no longer returns battery-derived fields (moved to Batteries)', () => {
  const r = Calc.calculerMission(baseParams());
  assert.equal(r.nbBatteriesParDrone, undefined);
  assert.equal(r.nbBatteriesTotal, undefined);
  assert.equal(r.autonomieUtile, undefined);
  assert.equal(r.tempsChangementsMin, undefined);
  assert.equal(r.tempsTerrainTotalMin, undefined);
  assert.equal(r.nbMissionsParDrone, undefined);
  assert.equal(r.surfaceParBatterieHa, undefined);
  assert.equal(r.rendementHaH, undefined);
});

test('Calc.DEFAULTS.drone no longer carries battery-specific fields', () => {
  assert.equal(Calc.DEFAULTS.drone.autonomie, undefined);
  assert.equal(Calc.DEFAULTS.drone.tempsSecurite, undefined);
  assert.equal(Calc.DEFAULTS.drone.tempsChangementBatterie, undefined);
  assert.equal(Calc.DEFAULTS.drone.batterie, undefined);
});

test('Calc.genererPlanMissions no longer exists (moved to Batteries.genererPlanVols)', () => {
  assert.equal(Calc.genererPlanMissions, undefined);
});

test('validerParametres no longer emits the old battery-specific alertes', () => {
  const params = baseParams({ vol: { altitude: 100 } });
  const alertes = Calc.validerParametres(params);
  assert.ok(!alertes.some((a) => /autonomie de la batterie/.test(a.msg)));
  assert.ok(!alertes.some((a) => /Type de batterie non renseigné/.test(a.msg)));
});

test('validerParametres still flags altitude above the drone maximum', () => {
  const params = baseParams({ vol: { altitude: 500 } });
  const alertes = Calc.validerParametres(params);
  assert.ok(alertes.some((a) => a.type === 'danger' && /Altitude de vol/.test(a.msg)));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/calculs.test.js`
Expected: FAIL — the first two tests pass (geometry fields already work today), but "no longer returns battery-derived fields", "Calc.DEFAULTS.drone no longer carries battery-specific fields", and "Calc.genererPlanMissions no longer exists" FAIL because the old battery code is still present in `calculs.js`.

- [ ] **Step 4: Remove battery-specific defaults**

In `drone-mission-app/calculs.js`, replace:

```js
    drone: {
      modele: 'DJI Matrice 350 RTK',
      vitesseCartographie: 15,     // m/s
      altitudeMax: 120,            // m AGL
      autonomie: 42,               // min
      tempsSecurite: 7,            // min (réserve RTB)
      tempsChangementBatterie: 4,  // min
      batterie: 'TB65 (double batterie)',
      positionnement: 'RTK',
      vitesseMax: 23,              // m/s (limite constructeur indicative)
      nombreDrones: 1
    },
```

with:

```js
    drone: {
      modele: 'DJI Matrice 350 RTK',
      vitesseCartographie: 15,     // m/s
      altitudeMax: 120,            // m AGL
      positionnement: 'RTK',
      vitesseMax: 23,              // m/s (limite constructeur indicative)
      nombreDrones: 1
    },
```

- [ ] **Step 5: Remove battery calculations from `calculerMission`**

In `drone-mission-app/calculs.js`, replace:

```js
    // --- Batteries / drones ---
    const nbDrones = Math.max(1, drone.nombreDrones || 1);
    const tempsVolParDroneMin = tempsVolMin / nbDrones;
    const autonomieUtile = Math.max(1, drone.autonomie - drone.tempsSecurite);
    const nbBatteriesParDrone = Math.max(1, Math.ceil(tempsVolParDroneMin / autonomieUtile));
    const nbBatteriesTotal = nbBatteriesParDrone * nbDrones;
    const nbMissionsParDrone = nbBatteriesParDrone; // 1 mission = 1 vol/batterie
    const tempsChangementsMin = (nbBatteriesParDrone - 1) * drone.tempsChangementBatterie;
    const tempsTerrainTotalMin = tempsVolParDroneMin + tempsChangementsMin;

    const surfaceParBatterieHa = surfaceHa / nbBatteriesTotal;
    const rendementHaH = surfaceHa / (tempsTerrainTotalMin / 60);
```

with:

```js
    // --- Répartition entre drones (le calcul batterie est délégué à Batteries.calculerAutonomie) ---
    const nbDrones = Math.max(1, drone.nombreDrones || 1);
    const tempsVolParDroneMin = tempsVolMin / nbDrones;
```

- [ ] **Step 6: Update the `calculerMission` return statement**

Replace:

```js
    return {
      gsd, empreinte, espacementLignes, espacementPhotos, intervalleDeclenchement,
      nombreLignes, longueurLigne, longueurTotaleLignes, distanceVirages, distanceTransit,
      distanceTotale, photosParLigne, nombrePhotos, tempsVolMin, tempsVolParDroneMin,
      tempsPriseDeVueMin, autonomieUtile, nbBatteriesParDrone, nbBatteriesTotal,
      nbMissionsParDrone, nbDrones, tempsChangementsMin, tempsTerrainTotalMin,
      surfaceParBatterieHa, rendementHaH, tailleParPhotoMo, volumeImagesMo,
      heuresTraitement, orthophotoMo, nuagePointsMo, mnsMo, mntMo,
      coutOperateur, coutBatteries, coutTraitement, coutTotal,
      surfaceHa, surfaceM2
    };
```

with:

```js
    return {
      gsd, empreinte, espacementLignes, espacementPhotos, intervalleDeclenchement,
      nombreLignes, longueurLigne, longueurTotaleLignes, distanceVirages, distanceTransit,
      distanceTotale, photosParLigne, nombrePhotos, tempsVolMin, tempsVolParDroneMin,
      tempsPriseDeVueMin, nbDrones, tailleParPhotoMo, volumeImagesMo,
      heuresTraitement, orthophotoMo, nuagePointsMo, mnsMo, mntMo,
      coutOperateur, coutBatteries, coutTraitement, coutTotal,
      surfaceHa, surfaceM2
    };
```

- [ ] **Step 7: Remove `genererPlanMissions`**

In `drone-mission-app/calculs.js`, delete this entire function (now `Batteries.genererPlanVols`):

```js
  /** Découpe la mission globale en un plan de vol par batterie (tableau des missions) */
  function genererPlanMissions(resultats, nombreLignesTotal) {
    const missions = [];
    const lignesParBatterie = Math.max(1, Math.ceil(nombreLignesTotal / resultats.nbBatteriesParDrone));
    let ligneRestantes = nombreLignesTotal;
    let idx = 1;
    while (ligneRestantes > 0) {
      const lignesIci = Math.min(lignesParBatterie, ligneRestantes);
      const distance = lignesIci * resultats.longueurLigne
        + Math.max(0, lignesIci - 1) * resultats.espacementLignes;
      const temps = distance / (resultats.distanceTotale / resultats.tempsVolParDroneMin || 1);
      missions.push({
        id: idx,
        batterie: `Batterie ${idx}`,
        lignes: lignesIci,
        surfaceHa: resultats.surfaceHa * (lignesIci / nombreLignesTotal),
        distance,
        tempsMin: temps,
        photos: Math.round(resultats.nombrePhotos * (lignesIci / nombreLignesTotal)),
        statut: 'Planifiée'
      });
      ligneRestantes -= lignesIci;
      idx++;
    }
    return missions;
  }

```

- [ ] **Step 8: Remove the two battery-specific validations from `validerParametres`**

In `drone-mission-app/calculs.js`, delete these lines from `validerParametres`:

```js
    if (drone.autonomie - drone.tempsSecurite <= 0) {
      alertes.push({ type: 'danger', msg: `Le temps de sécurité dépasse ou égale l'autonomie de la batterie : autonomie utile nulle.` });
    }
    if (!drone.batterie) {
      alertes.push({ type: 'warning', msg: `Type de batterie non renseigné.` });
    }
```

- [ ] **Step 9: Update the module's return statement**

Replace:

```js
  return {
    DEFAULTS, calcGSD, altitudePourGSD, calcEmpreinte, bboxOriente,
    orientationOptimale, calculerMission, genererPlanMissions, validerParametres
  };
})();
```

with:

```js
  return {
    DEFAULTS, calcGSD, altitudePourGSD, calcEmpreinte, bboxOriente,
    orientationOptimale, calculerMission, validerParametres
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/calculs.test.js`
Expected: PASS — all 6 tests green.

Also re-run the batteries tests to confirm no cross-contamination:
Run: `node --test drone-mission-app/tests/`
Expected: PASS — all 13 tests green (7 from batteries.test.js + 6 from calculs.test.js).

- [ ] **Step 11: Commit**

```bash
git add drone-mission-app/utils.js drone-mission-app/calculs.js drone-mission-app/tests/calculs.test.js
git commit -m "refactor: move battery logic out of calculs.js into batteries.js"
```

---

## Task 5: Wire `batteries.js` into `index.html` (script tag, form fields, dashboard cards)

**Files:**
- Modify: `drone-mission-app/index.html`

- [ ] **Step 1: Load the new module**

In `drone-mission-app/index.html`, replace:

```html
<script src="utils.js"></script>
<script src="calculs.js"></script>
<script src="cartographie.js"></script>
```

with:

```html
<script src="utils.js"></script>
<script src="calculs.js"></script>
<script src="batteries.js"></script>
<script src="cartographie.js"></script>
```

- [ ] **Step 2: Update the dashboard cards**

Replace:

```html
        <div class="card"><span class="card__label">Batteries nécessaires</span><span class="card__value" id="cardBatteries">—</span></div>
        <div class="card"><span class="card__label">Nombre de missions</span><span class="card__value" id="cardMissions">—</span></div>
        <div class="card"><span class="card__label">Distance totale</span><span class="card__value" id="cardDistance">—</span></div>
```

with:

```html
        <div class="card"><span class="card__label">Paires de batteries</span><span class="card__value" id="cardBatteries">—</span></div>
        <div class="card"><span class="card__label">Nombre de missions</span><span class="card__value" id="cardMissions">—</span></div>
        <div class="card"><span class="card__label">Rotations de batteries</span><span class="card__value" id="cardRotations">—</span></div>
        <div class="card"><span class="card__label">Décollages</span><span class="card__value" id="cardDecollages">—</span></div>
        <div class="card"><span class="card__label">Distance totale</span><span class="card__value" id="cardDistance">—</span></div>
```

- [ ] **Step 3: Update the Drone panel-box fields**

Replace:

```html
          <div class="field-row">
            <div class="field"><label>Autonomie moyenne (min)</label><input type="number" id="droneAutonomie" step="1"></div>
            <div class="field"><label>Temps de sécurité RTB (min)</label><input type="number" id="droneSecu" step="1"></div>
          </div>
          <div class="field">
            <label>Temps de remplacement batterie (min)</label>
            <input type="number" id="droneSwap" step="0.5">
          </div>
```

with:

```html
          <div class="field-row">
            <div class="field"><label>Autonomie par paire de batteries (min)</label><input type="number" id="droneAutonomie" step="1" min="1"></div>
            <div class="field"><label>Réserve de sécurité (%)</label><input type="number" id="droneSecu" step="1" min="0" max="100"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Temps de décollage (min)</label><input type="number" id="battDecollage" step="0.5" min="0"></div>
            <div class="field"><label>Temps de retour (min)</label><input type="number" id="battRetour" step="0.5" min="0"></div>
          </div>
          <div class="field">
            <label>Temps de remplacement batterie (min)</label>
            <input type="number" id="droneSwap" step="0.5" min="0">
          </div>
```

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/index.html
git commit -m "feat: add battery fields and cards to index.html"
```

(No automated test for this step — it's static markup with no logic. Verified visually in Task 8.)

---

## Task 6: Update `app.js` to consume `Batteries`

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add `batteries` to `state`**

Replace:

```js
  const state = {
    drone: { ...Calc.DEFAULTS.drone },
    camera: { ...Calc.DEFAULTS.camera },
    vol: { ...Calc.DEFAULTS.vol },
    couts: { ...Calc.DEFAULTS.couts },
    limites: { ...Calc.DEFAULTS.limites },
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
    theme: 'sombre',
    superficieManuelleHa: 50,
    nomZone: ''
  };
```

- [ ] **Step 2: Update the `champs` binding table**

Replace:

```js
    ['droneAutonomie', 'drone.autonomie', Number],
    ['droneSecu', 'drone.tempsSecurite', Number],
    ['droneSwap', 'drone.tempsChangementBatterie', Number],
    ['droneVitesseMax', 'drone.vitesseMax', Number],
```

with:

```js
    ['droneAutonomie', 'batteries.autonomieParPaireMin', Number],
    ['droneSecu', 'batteries.reserveSecuritePct', Number],
    ['droneSwap', 'batteries.tempsChangementBatterieMin', Number],
    ['battDecollage', 'batteries.tempsDecollageMin', Number],
    ['battRetour', 'batteries.tempsRetourMin', Number],
    ['droneVitesseMax', 'drone.vitesseMax', Number],
```

- [ ] **Step 3: Update `recalculer()` to call `Batteries`**

Replace:

```js
    const resultats = Calc.calculerMission(params);
    dernierResultats = resultats;

    const plan = Carto.genererLignesDeVol(angle, espacementLignes, state.vol.margeSecurite);
    dernieresMissions = Calc.genererPlanMissions(resultats, resultats.nombreLignes);

    majDashboard(resultats);
    majTableauMissions(dernieresMissions);
    majGraphiques(resultats, dernieresMissions);
    majValidation(params);
    document.getElementById('coutBloc').classList.toggle('is-hidden', resultats.coutTotal <= 0);
```

with:

```js
    const resultatsGeo = Calc.calculerMission(params);
    const resultatsBatt = Batteries.calculerAutonomie({
      tempsVolGeometriqueMin: resultatsGeo.tempsVolParDroneMin,
      surfaceHa: resultatsGeo.surfaceHa,
      batterie: state.batteries
    });
    const resultats = { ...resultatsGeo, ...resultatsBatt };
    dernierResultats = resultats;

    const plan = Carto.genererLignesDeVol(angle, espacementLignes, state.vol.margeSecurite);
    dernieresMissions = Batteries.genererPlanVols(resultatsGeo, resultatsBatt.nbVols, resultatsGeo.nombreLignes);

    majDashboard(resultats);
    majTableauMissions(dernieresMissions);
    majGraphiques(resultats, dernieresMissions);
    majValidation(params, resultatsBatt.alertes);
    document.getElementById('coutBloc').classList.toggle('is-hidden', resultats.coutTotal <= 0);
```

- [ ] **Step 4: Update `majDashboard` cards**

Replace:

```js
    const cartes = {
      cardTempsVol: Utils.fmtDuration(r.tempsVolMin),
      cardBatteries: r.nbBatteriesTotal,
      cardMissions: r.nbMissionsParDrone,
      cardDistance: `${Utils.fmt(r.distanceTotale / 1000, 2)} km`,
      cardPhotos: Utils.fmt(r.nombrePhotos, 0),
      cardRendement: `${Utils.fmt(r.rendementHaH, 2)} ha/h`,
      cardGSD: `${Utils.fmt(r.gsd, 2)} cm/px`,
      cardSurface: `${Utils.fmt(r.surfaceHa, 2)} ha`
    };
```

with:

```js
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
```

- [ ] **Step 5: Update the `detailGeometrie` block**

Replace:

```js
    document.getElementById('detailGeometrie').innerHTML = `
      <div><span>Empreinte photo</span><b>${Utils.fmt(r.empreinte.largeur, 1)} × ${Utils.fmt(r.empreinte.hauteur, 1)} m</b></div>
      <div><span>Espacement des lignes</span><b>${Utils.fmt(r.espacementLignes, 1)} m</b></div>
      <div><span>Espacement des photos</span><b>${Utils.fmt(r.espacementPhotos, 1)} m</b></div>
      <div><span>Intervalle de déclenchement</span><b>${Utils.fmt(r.intervalleDeclenchement, 2)} s</b></div>
      <div><span>Nombre de lignes</span><b>${r.nombreLignes}</b></div>
      <div><span>Longueur d'une ligne</span><b>${Utils.fmt(r.longueurLigne, 0)} m</b></div>
      <div><span>Surface par batterie</span><b>${Utils.fmt(r.surfaceParBatterieHa, 2)} ha</b></div>
      <div><span>Temps total terrain</span><b>${Utils.fmtDuration(r.tempsTerrainTotalMin)}</b></div>
    `;
```

with:

```js
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
```

- [ ] **Step 6: Update `majValidation` to accept battery alertes**

Replace:

```js
  function majValidation(params) {
    const alertes = Calc.validerParametres(params);
```

with:

```js
  function majValidation(params, alertesBatterie = []) {
    const alertes = Calc.validerParametres(params).concat(alertesBatterie);
```

- [ ] **Step 7: Update the "Répartition du temps" chart definition**

Replace:

```js
    charts.temps = new Chart(document.getElementById('chartTemps'), {
      type: 'doughnut',
      data: {
        labels: ['Vol', 'Changements de batterie'],
        datasets: [{ data: [0, 0], backgroundColor: [c.accent2, c.accent] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: c.texte } } } }
    });
```

with:

```js
    charts.temps = new Chart(document.getElementById('chartTemps'), {
      type: 'doughnut',
      data: {
        labels: ['Décollage', 'Mission', 'Retour', 'Réserve'],
        datasets: [{ data: [0, 0, 0, 0], backgroundColor: [c.accent3, c.accent2, c.accent, c.danger] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: c.texte } } } }
    });
```

- [ ] **Step 8: Update `majGraphiques` to feed the 4-segment breakdown**

Replace:

```js
    charts.temps.data.datasets[0].data = [+r.tempsVolParDroneMin.toFixed(1), +r.tempsChangementsMin.toFixed(1)];
    charts.temps.update();
```

with:

```js
    const reserveMin = state.batteries.autonomieParPaireMin * (state.batteries.reserveSecuritePct / 100);
    charts.temps.data.datasets[0].data = [
      +state.batteries.tempsDecollageMin.toFixed(1),
      +r.tempsUtileParPaireMin.toFixed(1),
      +state.batteries.tempsRetourMin.toFixed(1),
      +reserveMin.toFixed(1)
    ];
    charts.temps.update();
```

- [ ] **Step 9: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: wire Batteries module into app.js dashboard, charts and validation"
```

(No automated test for this step — `app.js` is pure DOM orchestration with no exported logic. Verified visually in Task 8.)

---

## Task 7: Update `export.js` field references

**Files:**
- Modify: `drone-mission-app/export.js`

- [ ] **Step 1: Update `resumeVersLignes` (Excel export)**

Replace:

```js
      ['Autonomie (min)', p.drone.autonomie],
      ['Temps de sécurité (min)', p.drone.tempsSecurite],
      ['Nombre de drones', p.drone.nombreDrones],
```

with:

```js
      ['Autonomie par paire de batteries (min)', p.batteries.autonomieParPaireMin],
      ['Réserve de sécurité (%)', p.batteries.reserveSecuritePct],
      ['Temps de décollage (min)', p.batteries.tempsDecollageMin],
      ['Temps de retour (min)', p.batteries.tempsRetourMin],
      ['Nombre de drones', p.drone.nombreDrones],
```

Replace:

```js
      ['Nombre de batteries', r.nbBatteriesTotal],
      ['Nombre de missions', r.nbMissionsParDrone],
      ['Temps total terrain (min)', +r.tempsTerrainTotalMin.toFixed(1)],
```

with:

```js
      ['Paires de batteries', r.nbPairesMinimales],
      ['Batteries TB65 (unités)', r.nbBatteriesTB65],
      ['Nombre de missions', r.nbMissionsAutomatiques],
      ['Rotations de batteries', r.nbRotations],
      ['Décollages', r.nbDecollages],
      ['Temps total terrain (min)', +r.tempsTerrainTotalMin.toFixed(1)],
```

- [ ] **Step 2: Update `exportPDF`**

Replace:

```js
    ligneKV('Autonomie / sécurité', `${params.drone.autonomie} min / ${params.drone.tempsSecurite} min`);
```

with:

```js
    ligneKV('Autonomie par paire / réserve', `${params.batteries.autonomieParPaireMin} min / ${params.batteries.reserveSecuritePct} %`);
```

Replace:

```js
    ligneKV('Nombre de batteries nécessaires', resultats.nbBatteriesTotal);
    ligneKV('Nombre de missions', resultats.nbMissionsParDrone);
```

with:

```js
    ligneKV('Paires de batteries nécessaires', resultats.nbPairesMinimales);
    ligneKV('Batteries TB65 (unités)', resultats.nbBatteriesTB65);
    ligneKV('Nombre de missions', resultats.nbMissionsAutomatiques);
    ligneKV('Rotations de batteries', resultats.nbRotations);
    ligneKV('Décollages', resultats.nbDecollages);
```

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/export.js
git commit -m "feat: update exports (Excel/PDF) with new battery fields"
```

(No automated test — `export.js` depends on `XLSX`/`jsPDF`/DOM globals not available in Node. Verified visually in Task 8.)

---

## Task 8: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve the app locally**

Run: `npx --yes serve drone-mission-app -l 8080`
(or any static file server — the app has no build step)

- [ ] **Step 2: Open in browser and check the dashboard**

Open `http://localhost:8080`. On load, confirm:
- No console errors.
- "Tableau de bord" cards show: Surface, Temps de vol, **Paires de batteries**, Nombre de missions, **Rotations de batteries**, **Décollages**, Distance, Photos, Rendement, GSD — all non-`—` values.
- No red/orange alert banners appear with the default zone (confirms the default battery values land within the recommended ranges, per Design decision #1 above).

- [ ] **Step 3: Check the new/relabeled fields**

Go to "Zone & paramètres" → "Drone — DJI Matrice 350 RTK". Confirm the fields read: "Autonomie par paire de batteries (min)" (40), "Réserve de sécurité (%)" (20), "Temps de décollage (min)" (2), "Temps de retour (min)" (4), "Temps de remplacement batterie (min)" (4). Change "Temps de retour (min)" to 20 and confirm an orange warning banner appears on the dashboard mentioning "Répartition retour".

- [ ] **Step 4: Check the chart**

On the dashboard, confirm the "Répartition du temps" doughnut now shows 4 segments labeled Décollage / Mission / Retour / Réserve (instead of the old 2-segment Vol/Changements chart).

- [ ] **Step 5: Check exports**

Click "Rapport PDF complet" and "Export Excel (.xlsx)". Confirm both files download without errors and contain the new battery field labels (Paires de batteries, Batteries TB65, Rotations, Décollages) instead of the old ones.

- [ ] **Step 6: Regression-check unrelated features**

Confirm zone drawing, KML import/export, scenario comparison, and project save/reload (via "Sauvegarder le projet" then "Rouvrir un projet") still work exactly as before.

- [ ] **Step 7: Run the full automated suite one last time**

Run: `node --test drone-mission-app/tests/`
Expected: PASS — 13/13 tests green.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: manual verification pass for battery module (Bloc B)"
```

(Only commit if verification uncovered fixes; if nothing changed, skip this step — there is nothing to commit.)
