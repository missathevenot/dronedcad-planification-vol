# Module Performance PC + Traitement (Bloc A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PC-performance-coefficient selector and a detailed, coefficient-weighted processing-time/product-size estimation tab to the DroneDCAD-Planification-Vol-PWA, replacing the current single-lump, PC-agnostic estimate embedded in `calculs.js`.

**Architecture:** Two new IIFE modules, `performance.js` (PC type catalogue + coefficient lookup) and `traitement.js` (processing time per phase + product sizes + storage recommendation), following the exact pattern of `batteries.js`. `calculs.js` loses all volumetry/processing fields (they move to `traitement.js`); `app.js` merges `Calc`/`Batteries`/`Traitement` outputs and renders a new "Estimation des traitements" tab.

**Tech Stack:** Vanilla JS (no bundler, no framework), Node.js built-in test runner (`node:test` + `node:assert/strict`) for the two new pure-logic modules, matching the project's established testing approach from Bloc B. Manual browser verification for DOM/UI wiring.

Design reference: `docs/superpowers/specs/2026-07-26-module-performance-traitement-design.md`

---

## Design decisions locked in during planning (read before starting)

These resolve implementation details not fully pinned down in the design doc:

1. **`empreintePx` is computed by the caller (`app.js`), not exposed by `Calc.calculerMission()`.** `app.js` already has `state.camera.largeurPx`/`hauteurPx` available, so `empreintePx = state.camera.largeurPx * state.camera.hauteurPx` is computed inline in `recalculer()`, exactly like the existing `gsdTemp`/`empreinteTemp` intermediate calculations already there. No change needed to `calculs.js`'s return shape for this.
2. **`coefficientPC` is added to the final merged `resultats` object in `app.js`**, alongside the `Traitement.calculerTraitement()` output, so `export.js` can read `r.coefficientPC` directly instead of calling `Performance.coefficientDe()` itself — `export.js` only ever reads pre-computed fields off `resultats`/`state`, it never calls domain modules directly (matches its existing pattern: it reads `p.drone.modele`, not `Calc.something()`).
3. **The PC type's human-readable name/config text is read directly from `state.performance.types[state.performance.typeSelectionne]`** wherever needed for display (dashboard hint, exports) — this is state data, not a calculation, so no new module function is needed for it beyond `Performance.coefficientDe()`.
4. **Test input numbers for `traitement.js`** are chosen so the arithmetic comes out to clean values at the reference coefficient (1.00): `nombrePhotos: 1000`, `empreintePx: 42000000` → `tempsBaseTotalH = 10.0` exactly, splitting into `1.5 / 4.5 / 1.0 / 1.0 / 2.0` hours for alignement/nuage/MNS/MNT/orthophoto. `surfaceM2: 1000000`, `gsd: 100` (1 m/px) are chosen so `pixelsOrtho = pixelsMNS = 1000000` exactly, keeping the size formulas easy to hand-verify (the `/1024/1024` division still produces a decimal, so size assertions use a `< 1e-9` tolerance computed from the same documented formula, not hardcoded decimal literals — this avoids transcription errors in the test itself).
5. **New nav tab icon**: `🖥` (the existing nav icons ◧⚙⌖≣⭳ are plain Unicode symbols with no established emoji precedent, but no plain-Unicode option reads as unambiguously "processing/computer" — `🖥` is the clearest option and is a one-character, low-risk deviation).
6. **PDF export gets both new charts added to its canvases dict**, alongside the 4 existing ones, matching the existing intent ("le rapport PDF inclut... les graphiques").

---

## Task 1: Test harness + failing tests for `Performance.coefficientDe`

**Files:**
- Create: `drone-mission-app/tests/performance.test.js`

- [ ] **Step 1: Write the failing tests**

Create `drone-mission-app/tests/performance.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Performance = require('../performance.js');

test('coefficientDe: returns the coefficient of each known PC type', () => {
  const t = Performance.DEFAULTS.types;
  assert.equal(Performance.coefficientDe(t, 'portable'), 1.00);
  assert.equal(Performance.coefficientDe(t, 'bureau'), 0.65);
  assert.equal(Performance.coefficientDe(t, 'station'), 0.35);
  assert.equal(Performance.coefficientDe(t, 'serveur'), 0.20);
});

test('coefficientDe: falls back to portable (1.00) for an unknown or missing type', () => {
  const t = Performance.DEFAULTS.types;
  assert.equal(Performance.coefficientDe(t, 'inconnu'), 1.00);
  assert.equal(Performance.coefficientDe(t, undefined), 1.00);
  assert.equal(Performance.coefficientDe(t, null), 1.00);
});

test('DEFAULTS.typeSelectionne is a valid key in DEFAULTS.types', () => {
  assert.ok(Performance.DEFAULTS.types[Performance.DEFAULTS.typeSelectionne]);
});

test('every PC type has a nom, config and coefficient', () => {
  Object.values(Performance.DEFAULTS.types).forEach((t) => {
    assert.equal(typeof t.nom, 'string');
    assert.equal(typeof t.config, 'string');
    assert.equal(typeof t.coefficient, 'number');
    assert.ok(t.coefficient > 0 && t.coefficient <= 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/performance.test.js`
Expected: FAIL — `Cannot find module '../performance.js'` (file does not exist yet).

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/tests/performance.test.js
git commit -m "test: add failing tests for Performance.coefficientDe"
```

---

## Task 2: Implement `performance.js`

**Files:**
- Create: `drone-mission-app/performance.js`

- [ ] **Step 1: Write the implementation**

Create `drone-mission-app/performance.js`:

```js
/**
 * performance.js
 * Catalogue des types d'ordinateur de traitement photogrammétrique et de
 * leur coefficient de performance (utilisé par traitement.js pour pondérer
 * les temps de traitement estimés). Portable = référence (coefficient 1.00).
 */

'use strict';

const Performance = (() => {

  const DEFAULTS = {
    typeSelectionne: 'portable',
    types: {
      portable: {
        nom: 'Ordinateur portable',
        config: 'Intel Core i5/i7 ou AMD Ryzen 5/7 · 16 Go RAM · SSD 512 Go · GPU intégré ou milieu de gamme',
        coefficient: 1.00
      },
      bureau: {
        nom: 'Ordinateur de bureau',
        config: 'Intel Core i7/i9 ou Ryzen 7/9 · 32 Go RAM · SSD NVMe · NVIDIA RTX',
        coefficient: 0.65
      },
      station: {
        nom: 'Station de travail',
        config: 'Xeon ou Threadripper · 64 à 256 Go RAM · plusieurs SSD NVMe · RTX professionnelle',
        coefficient: 0.35
      },
      serveur: {
        nom: 'Serveur de calcul',
        config: 'Multi CPU · 128 à 1024 Go RAM · RAID/NVMe · plusieurs GPU',
        coefficient: 0.20
      }
    }
  };

  /** Retourne le coefficient du type sélectionné, ou celui de 'portable' si absent/inconnu. */
  function coefficientDe(types, typeSelectionne) {
    const t = types[typeSelectionne];
    return t ? t.coefficient : types.portable.coefficient;
  }

  return { DEFAULTS, coefficientDe };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Performance;
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/performance.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/performance.js
git commit -m "feat: implement Performance module (PC type catalogue + coefficient lookup)"
```

---

## Task 3: Test harness + failing tests for `Traitement.calculerTraitement`

**Files:**
- Create: `drone-mission-app/tests/traitement.test.js`

- [ ] **Step 1: Write the failing tests**

Create `drone-mission-app/tests/traitement.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Traitement = require('../traitement.js');

function baseParams(overrides = {}) {
  return {
    nombrePhotos: 1000,
    empreintePx: 42000000,
    surfaceM2: 1000000,
    gsd: 100,
    formatCapture: 'both',
    limites: { tailleImageRawMo: 82, tailleImageJpegMo: 38 },
    coefficientPC: 1.00,
    ...overrides
  };
}

test('calculerTraitement: phase times at coefficient 1.00 (portable) split 15/45/10/10/20 %', () => {
  const r = Traitement.calculerTraitement(baseParams());
  assert.ok(Math.abs(r.tempsAlignementH - 1.5) < 1e-9);
  assert.ok(Math.abs(r.tempsNuageH - 4.5) < 1e-9);
  assert.ok(Math.abs(r.tempsMNSH - 1.0) < 1e-9);
  assert.ok(Math.abs(r.tempsMNTH - 1.0) < 1e-9);
  assert.ok(Math.abs(r.tempsOrthophotoH - 2.0) < 1e-9);
  assert.ok(Math.abs(r.tempsTotalH - 10.0) < 1e-9);
});

test('calculerTraitement: phase times scale linearly with coefficientPC', () => {
  const r = Traitement.calculerTraitement(baseParams({ coefficientPC: 0.65 }));
  assert.ok(Math.abs(r.tempsTotalH - 6.5) < 1e-9);
  assert.ok(Math.abs(r.tempsNuageH - (4.5 * 0.65)) < 1e-9);
  assert.ok(Math.abs(r.tempsAlignementH - (1.5 * 0.65)) < 1e-9);
});

test('calculerTraitement: product sizes are independent of coefficientPC', () => {
  const rPortable = Traitement.calculerTraitement(baseParams({ coefficientPC: 1.00 }));
  const rServeur = Traitement.calculerTraitement(baseParams({ coefficientPC: 0.20 }));
  assert.equal(rPortable.orthophotoMo, rServeur.orthophotoMo);
  assert.equal(rPortable.nuagePointsMo, rServeur.nuagePointsMo);
  assert.equal(rPortable.mnsMo, rServeur.mnsMo);
  assert.equal(rPortable.mntMo, rServeur.mntMo);
  assert.equal(rPortable.volumeImagesMo, rServeur.volumeImagesMo);
  assert.notEqual(rPortable.tempsTotalH, rServeur.tempsTotalH);
});

test('calculerTraitement: product sizes match the documented formulas', () => {
  const r = Traitement.calculerTraitement(baseParams());
  const gsdM = 1.0; // gsd=100cm -> 1 m/px
  const pixelsOrtho = 1000000 / (gsdM * gsdM);
  assert.ok(Math.abs(r.orthophotoMo - (pixelsOrtho * 1.5) / (1024 * 1024)) < 1e-9);
  assert.ok(Math.abs(r.nuagePointsMo - (pixelsOrtho * 4 * 18) / (1024 * 1024)) < 1e-9);
  const pixelsMNS = 1000000 / (gsdM * gsdM);
  const pixelsMNT = 1000000 / ((gsdM * 4) * (gsdM * 4));
  assert.ok(Math.abs(r.mnsMo - (pixelsMNS * 4) / (1024 * 1024)) < 1e-9);
  assert.ok(Math.abs(r.mntMo - (pixelsMNT * 4) / (1024 * 1024)) < 1e-9);
});

test('calculerTraitement: raw image size uses formatCapture and limites', () => {
  const rBoth = Traitement.calculerTraitement(baseParams({ formatCapture: 'both' }));
  assert.equal(rBoth.tailleParPhotoMo, 120);
  assert.equal(rBoth.volumeImagesMo, 120000);
  const rJpeg = Traitement.calculerTraitement(baseParams({ formatCapture: 'jpeg' }));
  assert.equal(rJpeg.tailleParPhotoMo, 38);
  assert.equal(rJpeg.volumeImagesMo, 38000);
  const rRaw = Traitement.calculerTraitement(baseParams({ formatCapture: 'raw' }));
  assert.equal(rRaw.tailleParPhotoMo, 82);
  assert.equal(rRaw.volumeImagesMo, 82000);
});

test('calculerTraitement: recommended storage is 1.3x the total product size', () => {
  const r = Traitement.calculerTraitement(baseParams());
  const tailleTotale = r.volumeImagesMo + r.orthophotoMo + r.nuagePointsMo + r.mnsMo + r.mntMo;
  assert.ok(Math.abs(r.tailleTotaleMo - tailleTotale) < 1e-9);
  assert.ok(Math.abs(r.stockageRecommandeMo - tailleTotale * 1.3) < 1e-9);
});

test('DEFAULTS.repartition percentages sum to 1.00 (100%)', () => {
  const rep = Traitement.DEFAULTS.repartition;
  const somme = rep.alignement + rep.nuage + rep.mns + rep.mnt + rep.orthophoto;
  assert.ok(Math.abs(somme - 1.0) < 1e-9);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/traitement.test.js`
Expected: FAIL — `Cannot find module '../traitement.js'` (file does not exist yet).

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/tests/traitement.test.js
git commit -m "test: add failing tests for Traitement.calculerTraitement"
```

---

## Task 4: Implement `traitement.js`

**Files:**
- Create: `drone-mission-app/traitement.js`

- [ ] **Step 1: Write the implementation**

Create `drone-mission-app/traitement.js`:

```js
/**
 * traitement.js
 * Estimation des temps de traitement photogrammétrique (alignement, nuage de
 * points, MNS, MNT, orthophoto) pondérés par le coefficient de performance de
 * l'ordinateur de traitement (voir performance.js), et des tailles des
 * produits générés (indépendantes du PC). Isole toute la logique de
 * volumétrie/traitement du calcul de géométrie de vol (calculs.js).
 */

'use strict';

const Traitement = (() => {

  const DEFAULTS = {
    // Débit de référence à coefficient 1.00 (ordinateur portable) : pixels traités par heure
    debitReferencePxParH: 4.2e9,
    // Répartition du temps total entre les 5 étapes de la chaîne de traitement
    repartition: {
      alignement: 0.15,
      nuage: 0.45,
      mns: 0.10,
      mnt: 0.10,
      orthophoto: 0.20
    },
    margeStockage: 1.30 // 30 % de marge pour fichiers temporaires/intermédiaires
  };

  /**
   * Calcule les temps de traitement par étape et les tailles des produits
   * photogrammétriques.
   * @param {Object} p
   * @param {number} p.nombrePhotos
   * @param {number} p.empreintePx - largeurPx × hauteurPx de la caméra
   * @param {number} p.surfaceM2
   * @param {number} p.gsd - GSD en cm/pixel
   * @param {string} p.formatCapture - 'raw' | 'jpeg' | 'both'
   * @param {Object} p.limites - { tailleImageRawMo, tailleImageJpegMo }
   * @param {number} p.coefficientPC - coefficient de performance (Performance.coefficientDe(...))
   */
  function calculerTraitement(p) {
    const { nombrePhotos, empreintePx, surfaceM2, gsd, formatCapture, limites, coefficientPC } = p;
    const rep = DEFAULTS.repartition;

    // --- Temps de traitement (dépend du coefficient PC) ---
    const tempsBaseTotalH = (nombrePhotos * empreintePx) / DEFAULTS.debitReferencePxParH;
    const tempsAlignementH = tempsBaseTotalH * rep.alignement * coefficientPC;
    const tempsNuageH = tempsBaseTotalH * rep.nuage * coefficientPC;
    const tempsMNSH = tempsBaseTotalH * rep.mns * coefficientPC;
    const tempsMNTH = tempsBaseTotalH * rep.mnt * coefficientPC;
    const tempsOrthophotoH = tempsBaseTotalH * rep.orthophoto * coefficientPC;
    const tempsTotalH = tempsAlignementH + tempsNuageH + tempsMNSH + tempsMNTH + tempsOrthophotoH;

    // --- Volumétrie images brutes (indépendante du PC) ---
    let tailleParPhotoMo = 0;
    if (formatCapture === 'raw') tailleParPhotoMo = limites.tailleImageRawMo;
    else if (formatCapture === 'jpeg') tailleParPhotoMo = limites.tailleImageJpegMo;
    else tailleParPhotoMo = limites.tailleImageRawMo + limites.tailleImageJpegMo;
    const volumeImagesMo = nombrePhotos * tailleParPhotoMo;

    // --- Tailles des produits (indépendantes du PC) ---
    const gsdM = gsd / 100;
    const pixelsOrtho = surfaceM2 / (gsdM * gsdM);
    const orthophotoMo = (pixelsOrtho * 1.5) / (1024 * 1024); // ~1.5 octet/px compressé (JPEG/LZW, 3 bandes)

    const densiteNuage = 4; // points par empreinte pixel GSD (dense cloud typique)
    const nbPointsNuage = pixelsOrtho * densiteNuage;
    const nuagePointsMo = (nbPointsNuage * 18) / (1024 * 1024); // ~18 octets/point (xyz + rgb + normales compressés)

    const gsdMNS = gsdM; // MNS ~ résolution native
    const gsdMNT = gsdM * 4; // MNT généralement rééchantillonné plus grossier
    const pixelsMNS = surfaceM2 / (gsdMNS * gsdMNS);
    const pixelsMNT = surfaceM2 / (gsdMNT * gsdMNT);
    const mnsMo = (pixelsMNS * 4) / (1024 * 1024); // float32 1 bande
    const mntMo = (pixelsMNT * 4) / (1024 * 1024);

    // --- Capacité de stockage recommandée ---
    const tailleTotaleMo = volumeImagesMo + orthophotoMo + nuagePointsMo + mnsMo + mntMo;
    const stockageRecommandeMo = tailleTotaleMo * DEFAULTS.margeStockage;

    return {
      tempsAlignementH, tempsNuageH, tempsMNSH, tempsMNTH, tempsOrthophotoH, tempsTotalH,
      tailleParPhotoMo, volumeImagesMo, orthophotoMo, nuagePointsMo, mnsMo, mntMo,
      tailleTotaleMo, stockageRecommandeMo
    };
  }

  return { DEFAULTS, calculerTraitement };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Traitement;
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/traitement.test.js`
Expected: PASS — all 7 tests green.

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/traitement.js
git commit -m "feat: implement Traitement.calculerTraitement processing time/size model"
```

---

## Task 5: Strip volumetry/processing fields out of `calculs.js`

**Files:**
- Modify: `drone-mission-app/tests/calculs.test.js`
- Modify: `drone-mission-app/calculs.js`

- [ ] **Step 1: Update the existing regression test file**

In `drone-mission-app/tests/calculs.test.js`, replace the first test:

```js
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
```

with:

```js
test('calculerMission still computes flight geometry fields', () => {
  const r = Calc.calculerMission(baseParams());
  assert.ok(r.gsd > 0);
  assert.ok(r.nombreLignes >= 1);
  assert.ok(r.tempsVolMin > 0);
  assert.ok(r.nombrePhotos > 0);
  assert.ok(r.surfaceM2 > 0);
});

test('calculerMission no longer returns volumetry/processing fields (moved to Traitement)', () => {
  const r = Calc.calculerMission(baseParams());
  assert.equal(r.tailleParPhotoMo, undefined);
  assert.equal(r.volumeImagesMo, undefined);
  assert.equal(r.heuresTraitement, undefined);
  assert.equal(r.orthophotoMo, undefined);
  assert.equal(r.nuagePointsMo, undefined);
  assert.equal(r.mnsMo, undefined);
  assert.equal(r.mntMo, undefined);
});
```

(This appends one new test right after the modified first test — the other 5 existing tests in the file are untouched.)

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `node --test drone-mission-app/tests/calculs.test.js`
Expected: The renamed "still computes flight geometry fields" test PASSes (those fields already work). The new "no longer returns volumetry/processing fields" test FAILs, because `calculs.js` still computes and returns those fields.

- [ ] **Step 3: Remove the volumetry/processing block from `calculerMission`**

In `drone-mission-app/calculs.js`, replace:

```js
    // --- Répartition entre drones (le calcul batterie est délégué à Batteries.calculerAutonomie) ---
    const nbDrones = Math.max(1, drone.nombreDrones || 1);
    const tempsVolParDroneMin = tempsVolMin / nbDrones;

    // --- Volumétrie images ---
    let tailleParPhotoMo = 0;
    if (vol.formatCapture === 'raw') tailleParPhotoMo = limites.tailleImageRawMo;
    else if (vol.formatCapture === 'jpeg') tailleParPhotoMo = limites.tailleImageJpegMo;
    else tailleParPhotoMo = limites.tailleImageRawMo + limites.tailleImageJpegMo;
    const volumeImagesMo = nombrePhotos * tailleParPhotoMo;

    // --- Produits photogrammétriques (estimations) ---
    const empreintePx = camera.largeurPx * camera.hauteurPx;
    const heuresTraitement = (nombrePhotos * empreintePx) / 4.2e9; // heuristique ~4.2 Gpx traités / h (poste performant)

    const gsdM = gsd / 100;
    const pixelsOrtho = surfaceM2 / (gsdM * gsdM);
    const orthophotoMo = (pixelsOrtho * 1.5) / (1024 * 1024); // ~1.5 octet/px compressé (JPEG/LZW, 3 bandes)

    const densiteNuage = 4; // points par empreinte pixel GSD (dense cloud typique)
    const nbPointsNuage = pixelsOrtho * densiteNuage;
    const nuagePointsMo = (nbPointsNuage * 18) / (1024 * 1024); // ~18 octets/point (xyz + rgb + normales compressés)

    const gsdMNS = gsdM; // MNS ~ résolution native
    const gsdMNT = gsdM * 4; // MNT généralement rééchantillonné plus grossier
    const pixelsMNS = surfaceM2 / (gsdMNS * gsdMNS);
    const pixelsMNT = surfaceM2 / (gsdMNT * gsdMNT);
    const mnsMo = (pixelsMNS * 4) / (1024 * 1024); // float32 1 bande
    const mntMo = (pixelsMNT * 4) / (1024 * 1024);

    // --- Coûts ---
```

with:

```js
    // --- Répartition entre drones (le calcul batterie est délégué à Batteries.calculerAutonomie) ---
    const nbDrones = Math.max(1, drone.nombreDrones || 1);
    const tempsVolParDroneMin = tempsVolMin / nbDrones;

    // --- Coûts ---
```

(The volumetry/processing block — raw image size, `heuresTraitement`, orthophoto/nuage/MNS/MNT sizes — moves to `Traitement.calculerTraitement()`, built in Tasks 3-4.)

- [ ] **Step 4: Drop the now-unused `limites` destructuring**

In `drone-mission-app/calculs.js`, replace:

```js
  function calculerMission(p) {
    const { drone, camera, vol, couts, limites } = p;
```

with:

```js
  function calculerMission(p) {
    const { drone, camera, vol, couts } = p;
```

(`limites` was only used by the volumetry block just removed; `camera` is still used by `calcGSD`/`calcEmpreinte` above, so it stays.)

- [ ] **Step 5: Update the `calculerMission` return statement**

Replace:

```js
    return {
      gsd, empreinte, espacementLignes, espacementPhotos, intervalleDeclenchement,
      nombreLignes, longueurLigne, longueurTotaleLignes, distanceVirages, distanceTransit,
      distanceTotale, photosParLigne, nombrePhotos, tempsVolMin, tempsVolParDroneMin,
      tempsPriseDeVueMin, nbDrones, tailleParPhotoMo, volumeImagesMo,
      heuresTraitement, orthophotoMo, nuagePointsMo, mnsMo, mntMo,
      coutTraitement,
      surfaceHa, surfaceM2
    };
```

with:

```js
    return {
      gsd, empreinte, espacementLignes, espacementPhotos, intervalleDeclenchement,
      nombreLignes, longueurLigne, longueurTotaleLignes, distanceVirages, distanceTransit,
      distanceTotale, photosParLigne, nombrePhotos, tempsVolMin, tempsVolParDroneMin,
      tempsPriseDeVueMin, nbDrones,
      coutTraitement,
      surfaceHa, surfaceM2
    };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/calculs.test.js`
Expected: PASS — all 7 tests green (6 pre-existing + 1 renamed/added in Step 1... the file now has 7 tests total: the renamed geometry test, the new "no longer returns" test, and the original battery-related tests 3-7).

Also re-run the full suite to confirm no cross-contamination:
Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 28 tests total (10 batteries + 7 calculs + 4 performance + 7 traitement). The batteries.test.js count (10, not the 8 you might expect from the original Bloc B plan) reflects two extra regression tests added during Bloc B's final whole-branch review — this is just a sanity check on the total, not a hard gate; if the reported count differs, what matters is 0 failures.

- [ ] **Step 7: Commit**

```bash
git add drone-mission-app/calculs.js drone-mission-app/tests/calculs.test.js
git commit -m "refactor: move volumetry/processing fields out of calculs.js into traitement.js"
```

---

## Task 6: Wire `performance.js`/`traitement.js` into `index.html`

**Files:**
- Modify: `drone-mission-app/index.html`

- [ ] **Step 1: Load the new modules**

Replace:

```html
<script src="utils.js"></script>
<script src="calculs.js"></script>
<script src="batteries.js"></script>
<script src="cartographie.js"></script>
```

with:

```html
<script src="utils.js"></script>
<script src="calculs.js"></script>
<script src="batteries.js"></script>
<script src="performance.js"></script>
<script src="traitement.js"></script>
<script src="cartographie.js"></script>
```

- [ ] **Step 2: Add the new nav tab**

Replace:

```html
      <button class="nav__item" data-target="panel-missions">
        <span class="nav__ico">≣</span> Missions &amp; scénarios
      </button>
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
```

with:

```html
      <button class="nav__item" data-target="panel-missions">
        <span class="nav__ico">≣</span> Missions &amp; scénarios
      </button>
      <button class="nav__item" data-target="panel-traitement">
        <span class="nav__ico">🖥</span> Estimation des traitements
      </button>
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
```

- [ ] **Step 3: Remove the old dashboard "Produits photogrammétriques" panel-box**

Replace:

```html
      <div class="grid-2">
        <div class="panel-box">
          <h3>Géométrie de la mission</h3>
          <div class="kv-list" id="detailGeometrie"></div>
        </div>
        <div class="panel-box">
          <h3>Produits photogrammétriques (estimation)</h3>
          <div class="kv-list" id="detailProduits"></div>
        </div>
      </div>
```

with:

```html
      <div class="grid-2">
        <div class="panel-box">
          <h3>Géométrie de la mission</h3>
          <div class="kv-list" id="detailGeometrie"></div>
        </div>
      </div>
```

- [ ] **Step 4: Add the "Configuration de l'ordinateur de traitement" panel-box**

Replace:

```html
        <div class="panel-box">
          <h3>Estimation des coûts <span class="hint">(facultatif)</span></h3>
          <div class="field-row">
            <div class="field"><label>Coût opérateur (par heure)</label><input type="number" id="coutOperateur" min="0" step="500"></div>
            <div class="field"><label>Coût par cycle de batterie</label><input type="number" id="coutBatterie" min="0" step="500"></div>
          </div>
          <div class="field">
            <label>Coût de traitement (par ha)</label>
            <input type="number" id="coutTraitement" min="0" step="500">
          </div>
        </div>

      </div>
    </section>
```

with:

```html
        <div class="panel-box">
          <h3>Estimation des coûts <span class="hint">(facultatif)</span></h3>
          <div class="field-row">
            <div class="field"><label>Coût opérateur (par heure)</label><input type="number" id="coutOperateur" min="0" step="500"></div>
            <div class="field"><label>Coût par cycle de batterie</label><input type="number" id="coutBatterie" min="0" step="500"></div>
          </div>
          <div class="field">
            <label>Coût de traitement (par ha)</label>
            <input type="number" id="coutTraitement" min="0" step="500">
          </div>
        </div>

        <div class="panel-box">
          <h3>Configuration de l'ordinateur de traitement</h3>
          <div class="field">
            <label>Type d'ordinateur</label>
            <select id="pcType">
              <option value="portable">Ordinateur portable (coefficient 1.00)</option>
              <option value="bureau">Ordinateur de bureau (coefficient 0.65)</option>
              <option value="station">Station de travail (coefficient 0.35)</option>
              <option value="serveur">Serveur de calcul (coefficient 0.20)</option>
            </select>
          </div>
          <p class="hint" id="pcTypeConfig"></p>
        </div>

      </div>
    </section>
```

- [ ] **Step 5: Add the new "Estimation des traitements" panel**

Replace:

```html
    <!-- ============ PANEL: EXPORT ============ -->
    <section id="panel-export" class="panel">
```

with:

```html
    <!-- ============ PANEL: TRAITEMENT ============ -->
    <section id="panel-traitement" class="panel">
      <div class="cards-grid">
        <div class="card"><span class="card__label">Temps alignement</span><span class="card__value" id="cardTempsAlignement">—</span></div>
        <div class="card"><span class="card__label">Temps nuage de points</span><span class="card__value" id="cardTempsNuage">—</span></div>
        <div class="card"><span class="card__label">Temps MNS</span><span class="card__value" id="cardTempsMNS">—</span></div>
        <div class="card"><span class="card__label">Temps MNT</span><span class="card__value" id="cardTempsMNT">—</span></div>
        <div class="card"><span class="card__label">Temps orthophoto</span><span class="card__value" id="cardTempsOrtho">—</span></div>
        <div class="card"><span class="card__label">Temps total de traitement</span><span class="card__value" id="cardTempsTotal">—</span></div>
      </div>

      <div class="grid-2">
        <div class="panel-box">
          <h3>Tailles des produits (estimation)</h3>
          <div class="kv-list" id="detailTaillesProduits"></div>
        </div>
        <div class="panel-box">
          <h3>Stockage recommandé</h3>
          <div class="kv-list" id="detailStockage"></div>
        </div>
      </div>

      <div class="grid-2 charts-grid">
        <div class="panel-box chart-box"><h3>Temps par étape de traitement</h3><canvas id="chartTraitementTemps"></canvas></div>
        <div class="panel-box chart-box"><h3>Répartition des tailles des produits</h3><canvas id="chartTraitementTailles"></canvas></div>
      </div>
    </section>

    <!-- ============ PANEL: EXPORT ============ -->
    <section id="panel-export" class="panel">
```

- [ ] **Step 6: Commit**

```bash
git add drone-mission-app/index.html
git commit -m "feat: add PC config panel and Estimation des traitements tab to index.html"
```

(No automated test for this step — it's static markup with no logic. Verified visually in Task 9.)

---

## Task 7: Update `app.js` to consume `Performance`/`Traitement`

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add `performance` to `state`**

Replace:

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
    theme: 'sombre',
    superficieManuelleHa: 50,
    nomZone: ''
  };
```

- [ ] **Step 2: Add `pcType` to the `champs` binding table**

Replace:

```js
    ['coutOperateur', 'couts.tauxHoraireOperateur', Number],
    ['coutBatterie', 'couts.coutCycleBatterie', Number],
    ['coutTraitement', 'couts.coutTraitementParHa', Number],
    ['superficieManuelle', 'superficieManuelleHa', Number],
    ['nomZone', 'nomZone', String]
  ];
```

with:

```js
    ['coutOperateur', 'couts.tauxHoraireOperateur', Number],
    ['coutBatterie', 'couts.coutCycleBatterie', Number],
    ['coutTraitement', 'couts.coutTraitementParHa', Number],
    ['pcType', 'performance.typeSelectionne', String],
    ['superficieManuelle', 'superficieManuelleHa', Number],
    ['nomZone', 'nomZone', String]
  ];
```

- [ ] **Step 3: Show the selected PC type's config text, and refresh it on change**

Replace:

```js
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
        recalculer();
      }, 200));
    });

    document.getElementById('btnGenererZoneTest').addEventListener('click', genererZoneTest);
    document.getElementById('btnEffacerZone').addEventListener('click', () => Carto.effacerTout());
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
  }
```

with:

```js
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
```

- [ ] **Step 4: Call `Traitement.calculerTraitement()` in `recalculer()` and merge its output**

Replace:

```js
    const coutOperateur = (resultatsBatt.tempsTerrainTotalMin / 60) * (state.couts.tauxHoraireOperateur || 0);
    const coutBatteries = nbMissionsAutomatiques * (state.couts.coutCycleBatterie || 0);
    const coutTotal = coutOperateur + coutBatteries + resultatsGeo.coutTraitement;
    const resultats = {
      ...resultatsGeo, ...resultatsBatt,
      nbPairesMinimales, nbBatteriesTB65, nbMissionsAutomatiques, nbRotations, nbDecollages,
      surfaceParBatterieHa, coutOperateur, coutBatteries, coutTotal
    };
    dernierResultats = resultats;
```

with:

```js
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
```

- [ ] **Step 5: Call `majTraitement()` alongside the other render functions**

Replace:

```js
    majDashboard(resultats);
    majTableauMissions(dernieresMissions);
    majGraphiques(resultats, dernieresMissions);
    majValidation(params, resultatsBatt.alertes);
    document.getElementById('coutBloc').classList.toggle('is-hidden', resultats.coutTotal <= 0);
  }
```

with:

```js
    majDashboard(resultats);
    majTraitement(resultats);
    majTableauMissions(dernieresMissions);
    majGraphiques(resultats, dernieresMissions);
    majValidation(params, resultatsBatt.alertes);
    document.getElementById('coutBloc').classList.toggle('is-hidden', resultats.coutTotal <= 0);
  }
```

- [ ] **Step 6: Remove the old `detailProduits` block from `majDashboard`, add `majTraitement()`**

Replace:

```js
    document.getElementById('detailProduits').innerHTML = `
      <div><span>Volume images</span><b>${Utils.fmtBytes(r.volumeImagesMo * 1024 * 1024)}</b></div>
      <div><span>Temps de traitement estimé</span><b>${Utils.fmt(r.heuresTraitement, 1)} h</b></div>
      <div><span>Orthophoto estimée</span><b>${Utils.fmtBytes(r.orthophotoMo * 1024 * 1024)}</b></div>
      <div><span>Nuage de points estimé</span><b>${Utils.fmtBytes(r.nuagePointsMo * 1024 * 1024)}</b></div>
      <div><span>MNS estimé</span><b>${Utils.fmtBytes(r.mnsMo * 1024 * 1024)}</b></div>
      <div><span>MNT estimé</span><b>${Utils.fmtBytes(r.mntMo * 1024 * 1024)}</b></div>
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
```

with:

```js
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
```

- [ ] **Step 7: Add the two new charts to `initCharts()`**

Replace:

```js
    charts.distance = new Chart(document.getElementById('chartDistance'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Distance parcourue par mission (m)', data: [], backgroundColor: c.accent2 }] },
      options: communs
    });
  }
```

with:

```js
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
```

- [ ] **Step 8: Feed the two new charts in `majGraphiques()`**

Replace:

```js
    charts.distance.data.labels = labels;
    charts.distance.data.datasets[0].data = missions.map((m) => Math.round(m.distance));
    charts.distance.update();
  }
```

with:

```js
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
```

- [ ] **Step 9: Add the two new charts to the PDF export's canvases**

Replace:

```js
    document.getElementById('btnExportPDF').addEventListener('click', () => {
      if (!dernieresMissions.length) return Utils.toast('Aucune mission calculée.', 'warning');
      const canvases = {
        'Temps de vol par batterie': charts.batteries.canvas,
        'Répartition du temps': charts.temps.canvas,
        'Surface par mission': charts.surface.canvas,
        'Photos par mission': charts.photos.canvas
      };
      Exporter.exportPDF(dernieresMissions, dernierResultats, state, canvases);
    });
```

with:

```js
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
```

- [ ] **Step 10: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: wire Performance/Traitement modules into app.js dashboard, new tab and charts"
```

(No automated test for this step — `app.js` is pure DOM orchestration with no exported logic. Verified visually in Task 9.)

---

## Task 8: Update `export.js` field references

**Files:**
- Modify: `drone-mission-app/export.js`

- [ ] **Step 1: Update `resumeVersLignes` (Excel export) — parameters section**

Replace:

```js
      ['Autonomie par paire de batteries (min)', p.batteries.autonomieParPaireMin],
      ['Réserve de sécurité (%)', p.batteries.reserveSecuritePct],
      ['Temps de décollage (min)', p.batteries.tempsDecollageMin],
      ['Temps de retour (min)', p.batteries.tempsRetourMin],
      ['Nombre de drones', p.drone.nombreDrones],
      [],
      ['Paramètres caméra'],
```

with:

```js
      ['Autonomie par paire de batteries (min)', p.batteries.autonomieParPaireMin],
      ['Réserve de sécurité (%)', p.batteries.reserveSecuritePct],
      ['Temps de décollage (min)', p.batteries.tempsDecollageMin],
      ['Temps de retour (min)', p.batteries.tempsRetourMin],
      ['Nombre de drones', p.drone.nombreDrones],
      ['Ordinateur de traitement', p.performance.types[p.performance.typeSelectionne].nom],
      ['Coefficient de performance', r.coefficientPC],
      [],
      ['Paramètres caméra'],
```

- [ ] **Step 2: Update `resumeVersLignes` — results section**

Replace:

```js
      ['Temps de traitement estimé (h)', +r.heuresTraitement.toFixed(1)],
      ['Taille orthophoto estimée', Utils.fmtBytes(r.orthophotoMo * 1024 * 1024)],
      ['Taille nuage de points estimée', Utils.fmtBytes(r.nuagePointsMo * 1024 * 1024)],
      ['Taille MNS estimée', Utils.fmtBytes(r.mnsMo * 1024 * 1024)],
      ['Taille MNT estimée', Utils.fmtBytes(r.mntMo * 1024 * 1024)],
      ['Coût total estimé', +r.coutTotal.toFixed(0)]
    ];
```

with:

```js
      ['Temps alignement estimé (h)', +r.tempsAlignementH.toFixed(2)],
      ['Temps nuage de points estimé (h)', +r.tempsNuageH.toFixed(2)],
      ['Temps MNS estimé (h)', +r.tempsMNSH.toFixed(2)],
      ['Temps MNT estimé (h)', +r.tempsMNTH.toFixed(2)],
      ['Temps orthophoto estimé (h)', +r.tempsOrthophotoH.toFixed(2)],
      ['Temps total de traitement estimé (h)', +r.tempsTotalH.toFixed(2)],
      ['Taille orthophoto estimée', Utils.fmtBytes(r.orthophotoMo * 1024 * 1024)],
      ['Taille nuage de points estimée', Utils.fmtBytes(r.nuagePointsMo * 1024 * 1024)],
      ['Taille MNS estimée', Utils.fmtBytes(r.mnsMo * 1024 * 1024)],
      ['Taille MNT estimée', Utils.fmtBytes(r.mntMo * 1024 * 1024)],
      ['Capacité de stockage recommandée', Utils.fmtBytes(r.stockageRecommandeMo * 1024 * 1024)],
      ['Coût total estimé', +r.coutTotal.toFixed(0)]
    ];
```

- [ ] **Step 3: Update `exportPDF` — parameters section**

Replace:

```js
    ligneKV('Autonomie par paire / réserve', `${params.batteries.autonomieParPaireMin} min / ${params.batteries.reserveSecuritePct} %`);
    ligneKV('Caméra', `${params.camera.modele} — ${params.camera.largeurPx}×${params.camera.hauteurPx} px`);
    ligneKV('Focale utilisée', `${params.vol.focale} mm`);
    ligneKV('Nombre de drones simultanés', params.drone.nombreDrones);
```

with:

```js
    ligneKV('Autonomie par paire / réserve', `${params.batteries.autonomieParPaireMin} min / ${params.batteries.reserveSecuritePct} %`);
    ligneKV('Caméra', `${params.camera.modele} — ${params.camera.largeurPx}×${params.camera.hauteurPx} px`);
    ligneKV('Focale utilisée', `${params.vol.focale} mm`);
    ligneKV('Nombre de drones simultanés', params.drone.nombreDrones);
    ligneKV('Ordinateur de traitement', `${params.performance.types[params.performance.typeSelectionne].nom} (coefficient ${resultats.coefficientPC})`);
```

- [ ] **Step 4: Update `exportPDF` — results section**

Replace:

```js
    section('Estimation des produits photogrammétriques');
    ligneKV('Temps de traitement estimé', `${Utils.fmt(resultats.heuresTraitement, 1)} h`);
    ligneKV('Taille orthophoto estimée', Utils.fmtBytes(resultats.orthophotoMo * 1024 * 1024));
    ligneKV('Taille nuage de points estimée', Utils.fmtBytes(resultats.nuagePointsMo * 1024 * 1024));
    ligneKV('Taille MNS estimée', Utils.fmtBytes(resultats.mnsMo * 1024 * 1024));
    ligneKV('Taille MNT estimée', Utils.fmtBytes(resultats.mntMo * 1024 * 1024));
    if (resultats.coutTotal > 0) ligneKV('Coût total estimé', Utils.fmt(resultats.coutTotal, 0));
```

with:

```js
    section('Estimation des traitements photogrammétriques');
    ligneKV('Temps alignement', `${Utils.fmt(resultats.tempsAlignementH, 2)} h`);
    ligneKV('Temps nuage de points', `${Utils.fmt(resultats.tempsNuageH, 2)} h`);
    ligneKV('Temps MNS', `${Utils.fmt(resultats.tempsMNSH, 2)} h`);
    ligneKV('Temps MNT', `${Utils.fmt(resultats.tempsMNTH, 2)} h`);
    ligneKV('Temps orthophoto', `${Utils.fmt(resultats.tempsOrthophotoH, 2)} h`);
    ligneKV('Temps total de traitement', `${Utils.fmt(resultats.tempsTotalH, 2)} h`);
    ligneKV('Taille orthophoto estimée', Utils.fmtBytes(resultats.orthophotoMo * 1024 * 1024));
    ligneKV('Taille nuage de points estimée', Utils.fmtBytes(resultats.nuagePointsMo * 1024 * 1024));
    ligneKV('Taille MNS estimée', Utils.fmtBytes(resultats.mnsMo * 1024 * 1024));
    ligneKV('Taille MNT estimée', Utils.fmtBytes(resultats.mntMo * 1024 * 1024));
    ligneKV('Capacité de stockage recommandée', Utils.fmtBytes(resultats.stockageRecommandeMo * 1024 * 1024));
    if (resultats.coutTotal > 0) ligneKV('Coût total estimé', Utils.fmt(resultats.coutTotal, 0));
```

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/export.js
git commit -m "feat: update exports (Excel/PDF) with new processing time/storage fields"
```

(No automated test — `export.js` depends on `XLSX`/`jsPDF`/DOM globals not available in Node. Verified visually in Task 9.)

---

## Task 9: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve the app locally**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 2: Open in browser and check the dashboard**

Open `http://localhost:8080`. Confirm:
- No console errors.
- Dashboard no longer shows a "Produits photogrammétriques (estimation)" panel-box.
- "Géométrie de la mission" panel-box still shows its usual rows (unaffected by this bloc).

- [ ] **Step 3: Check the PC configuration field**

Go to "Zone & paramètres". Confirm a new panel-box "Configuration de l'ordinateur de traitement" appears, with a select showing the 4 PC types and a hint line below it showing the selected type's technical config. Change the selection to "Station de travail" and confirm the hint text updates to the Xeon/Threadripper description.

- [ ] **Step 4: Check the new "Estimation des traitements" tab**

Click the new "Estimation des traitements" nav item. Confirm:
- 6 cards show non-`—` values (Temps alignement/nuage/MNS/MNT/orthophoto/total).
- "Tailles des produits" and "Stockage recommandé" kv-lists show non-empty Mo/Go values.
- Both charts (bar "Temps par étape de traitement", doughnut "Répartition des tailles des produits") render with data.

- [ ] **Step 5: Verify the PC coefficient actually changes the numbers**

With a zone defined, note the "Temps total de traitement" value with "Ordinateur portable" selected. Switch to "Serveur de calcul" (coefficient 0.20) and confirm the value drops to roughly 20% of the portable value (all 4 processing types produce a *lower* time, since a smaller coefficient = faster). Confirm the "Tailles des produits" values do NOT change when switching PC type (sizes are PC-independent per the design).

- [ ] **Step 6: Check exports**

Click "Rapport PDF complet" and "Export Excel (.xlsx)". Confirm both downloads complete without new console errors, and that both contain rows for the PC type/coefficient and the 5 processing-time figures + storage recommendation instead of the old single "Temps de traitement estimé" row.

- [ ] **Step 7: Regression-check unrelated features**

Confirm zone drawing, KML import/export, scenario comparison, battery cards/chart (unaffected by this bloc), and project save/reload still work exactly as before.

- [ ] **Step 8: Run the full automated suite one last time**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — all tests green (use the actual reported count; see the note in Task 5 Step 6).

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "chore: manual verification pass for performance/traitement module (Bloc A)"
```

(Only commit if verification uncovered fixes; if nothing changed, skip this step — there is nothing to commit.)
