# Bibliothèque de zones partagées + réorganisation des onglets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text "Nom de la zone" with a shared, nameable, saveable zone library (Supabase-backed), reorganize the "Zone & paramètres"/"Cartographie" tabs into "Zone & Cartographie"/"Paramètres", reorder all 8 tabs, and reflect the new commune/description fields in the PDF/Excel exports.

**Architecture:** New module `zones.js` (pure mapping/filtering functions + impure Supabase calls, same split pattern as `suivi.js`/`meteo.js`), reusing the Supabase client already initialized by `suivi.js` (extended to export `initClient`) rather than a second client instance. New `zones` table in the existing `dronedcad-suivi` Supabase project, reusing the existing `public.est_agent_actif()` RLS helper. HTML/CSS/`app.js` wiring for the new "Zone" group box, the tab reorder, and the zone-selection/save/delete UX. `export.js` updates for the two new fields.

**Tech Stack:** Vanilla JS (no bundler), same Supabase project/client as the Suivi module.

**Reference design doc:** `docs/superpowers/specs/2026-08-01-zones-partagees-design.md`

---

## Task 1: Provisionner la table `zones` et exporter `Suivi.initClient`

**This task is NOT delegated to an implementer subagent** for the SQL migration part — it is executed directly by the orchestrator using the Supabase MCP tools, since it targets the same already-provisioned, already-paid ($0/month) `dronedcad-suivi` project — no new resource is created, no new cost confirmation is needed. The `suivi.js` code change (Step 2) IS delegated normally.

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Appliquer le schéma SQL de la table `zones`**

Appeler `apply_migration` sur le projet `kepbgoxbatytyvrisqcs` (`dronedcad-suivi`) avec `name: "zones_schema"` et la requête suivante :

```sql
create table zones (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null,
  commune      text default '',
  description  text default '',
  geometrie    jsonb not null,
  created_by   uuid references profils(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table zones enable row level security;
create policy "lecture_tous_agents_actifs" on zones for select to authenticated
  using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on zones for insert to authenticated
  with check (public.est_agent_actif());
create policy "modification_tous_agents_actifs" on zones for update to authenticated
  using (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on zones for delete to authenticated
  using (public.est_agent_actif());
```

This reuses `public.est_agent_actif()`, déjà créée lors du correctif de récursion RLS du module Suivi (`docs/superpowers/specs/2026-07-30-suivi-execution-mission-design.md`) — aucune nouvelle fonction `SECURITY DEFINER` n'est nécessaire.

- [ ] **Step 2: Exporter `initClient` depuis `suivi.js`**

In `drone-mission-app/suivi.js`, replace:

```js
  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs, calculerAvancementDossier, calculerStatsTableauDeBord,
    connexion, deconnexion, sessionActuelle, profilConnecte,
    creerDossierMission, listerDossiers, recupererDossier,
    mettreAJourExecutionVol, mettreAJourEtapeTraitement, enregistrerControleQualite, recupererTableauDeBord
  };
})();
```

with:

```js
  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs, calculerAvancementDossier, calculerStatsTableauDeBord,
    connexion, deconnexion, sessionActuelle, profilConnecte, initClient,
    creerDossierMission, listerDossiers, recupererDossier,
    mettreAJourExecutionVol, mettreAJourEtapeTraitement, enregistrerControleQualite, recupererTableauDeBord
  };
})();
```

(only the return statement changes — `initClient`'s own definition, higher up in the file, is untouched; it was already a fully-formed internal function, this just adds its name to the export list.)

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests, 0 failures (this change only widens an export list, no logic changed).

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: export Suivi.initClient for reuse by the new zones module"
```

---

## Task 2: Tests + fonctions pures de `zones.js`

**Files:**
- Create: `drone-mission-app/zones.js`
- Create: `drone-mission-app/tests/zones.test.js`

- [ ] **Step 1: Write the failing tests**

Create `drone-mission-app/tests/zones.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Zones = require('../zones.js');

test('mapperZoneVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'z1', nom: 'Zone Yopougon', commune: 'Yopougon', description: 'Levé prioritaire',
    geometrie: [[5.35, -4.02], [5.36, -4.02], [5.36, -4.01]],
    created_by: 'u1', created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z'
  };
  const js = Zones.mapperZoneVersJs(row);
  assert.equal(js.id, 'z1');
  assert.equal(js.nom, 'Zone Yopougon');
  assert.equal(js.commune, 'Yopougon');
  assert.equal(js.description, 'Levé prioritaire');
  assert.deepEqual(js.geometrie, [[5.35, -4.02], [5.36, -4.02], [5.36, -4.01]]);
  assert.equal(js.createdBy, 'u1');
  assert.equal(js.createdAt, '2026-08-01T10:00:00Z');
  assert.equal(js.updatedAt, '2026-08-01T10:00:00Z');
});

test('communesDistinctes: returns sorted, de-duplicated, non-empty communes', () => {
  const zones = [
    { commune: 'Yopougon' }, { commune: 'Cocody' }, { commune: 'Yopougon' },
    { commune: '' }, { commune: null }, { commune: 'Abobo' }
  ];
  assert.deepEqual(Zones.communesDistinctes(zones), ['Abobo', 'Cocody', 'Yopougon']);
});

test('communesDistinctes: empty array in, empty array out', () => {
  assert.deepEqual(Zones.communesDistinctes([]), []);
});

test('communesDistinctes: ignores whitespace-only communes', () => {
  const zones = [{ commune: '   ' }, { commune: 'Abobo' }];
  assert.deepEqual(Zones.communesDistinctes(zones), ['Abobo']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/zones.test.js`
Expected: FAIL — `Cannot find module '../zones.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `drone-mission-app/zones.js`:

```js
/**
 * zones.js
 * Bibliothèque de zones de mission partagées (nom, commune, description,
 * géométrie), stockée dans le même projet Supabase que suivi.js. Réutilise
 * le client déjà initialisé par Suivi.initClient() plutôt que d'en recréer
 * un second avec les mêmes identifiants codés en dur. Séparation pure /
 * impure : tout ce qui touche le réseau est isolé dans la section
 * "Fonctions impures" en bas de fichier ; le reste est pur et testable.
 */

'use strict';

const Zones = (() => {

  // ------------------------------------------------------------------
  // Fonctions pures (testables)
  // ------------------------------------------------------------------

  /** Convertit une ligne Supabase (snake_case) `zones` en objet JS (camelCase). */
  function mapperZoneVersJs(row) {
    return {
      id: row.id,
      nom: row.nom,
      commune: row.commune,
      description: row.description,
      geometrie: row.geometrie,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /** Liste triée (locale fr), dédupliquée, des communes non vides d'une liste de zones. */
  function communesDistinctes(zones) {
    const communes = zones.map((z) => z.commune).filter((c) => c && c.trim());
    return [...new Set(communes)].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  return { mapperZoneVersJs, communesDistinctes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Zones;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/zones.test.js`
Expected: PASS — 4 tests green.

Also re-run the full suite:
Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests total (57 existing + 4 new). If the reported count differs, what matters is 0 failures.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/zones.js drone-mission-app/tests/zones.test.js
git commit -m "feat: add Zones pure mapping and filtering functions"
```

---

## Task 3: Fonctions Supabase CRUD dans `zones.js`

**Files:**
- Modify: `drone-mission-app/zones.js`

- [ ] **Step 1: Add the impure functions**

In `drone-mission-app/zones.js`, add this section right before the final `return { ... };` statement (after `communesDistinctes`):

```js
  // ------------------------------------------------------------------
  // Fonctions impures (appels réseau Supabase, non testées automatiquement)
  // ------------------------------------------------------------------

  /** Liste toutes les zones de la bibliothèque partagée, triées par nom. */
  async function listerZones() {
    const sb = Suivi.initClient();
    const { data, error } = await sb.from('zones').select('*').order('nom');
    if (error) throw new Error(`Échec du chargement des zones : ${error.message}`);
    return data.map(mapperZoneVersJs);
  }

  /** Crée une nouvelle zone dans la bibliothèque partagée. */
  async function creerZone(donnees) {
    const sb = Suivi.initClient();
    const { data: { user } } = await sb.auth.getUser();
    const ligne = {
      nom: donnees.nom,
      commune: donnees.commune || '',
      description: donnees.description || '',
      geometrie: donnees.geometrie,
      created_by: user ? user.id : null
    };
    const { data, error } = await sb.from('zones').insert(ligne).select().single();
    if (error) throw new Error(`Échec de la création de la zone : ${error.message}`);
    return mapperZoneVersJs(data);
  }

  /** Met à jour une zone existante. `donnees` peut contenir nom/commune/description/geometrie. */
  async function mettreAJourZone(id, donnees) {
    const sb = Suivi.initClient();
    const patch = { updated_at: new Date().toISOString() };
    if (donnees.nom !== undefined) patch.nom = donnees.nom;
    if (donnees.commune !== undefined) patch.commune = donnees.commune;
    if (donnees.description !== undefined) patch.description = donnees.description;
    if (donnees.geometrie !== undefined) patch.geometrie = donnees.geometrie;
    const { data, error } = await sb.from('zones').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de la zone : ${error.message}`);
    return mapperZoneVersJs(data);
  }

  /** Supprime une zone de la bibliothèque partagée. */
  async function supprimerZone(id) {
    const sb = Suivi.initClient();
    const { error } = await sb.from('zones').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression de la zone : ${error.message}`);
  }
```

- [ ] **Step 2: Update the module's return statement**

Replace:

```js
  return { mapperZoneVersJs, communesDistinctes };
})();
```

with:

```js
  return { mapperZoneVersJs, communesDistinctes, listerZones, creerZone, mettreAJourZone, supprimerZone };
})();
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures (the new impure functions have no unit tests, matching the `Suivi`/`Meteo` impure-function precedent).

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/zones.js
git commit -m "feat: implement Zones Supabase CRUD functions"
```

---

## Task 4: HTML — réorganisation et renommage des onglets

**Files:**
- Modify: `drone-mission-app/index.html`

- [ ] **Step 1: Load the new module**

Replace:

```html
<script src="suivi.js"></script>
<script src="app.js"></script>
```

with:

```html
<script src="suivi.js"></script>
<script src="zones.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 2: Reorder and rename the nav tabs**

Replace:

```html
      <button class="nav__item is-active" data-target="panel-dashboard">
        <span class="nav__ico">◧</span> Tableau de bord
        <span id="navAlertBadge" class="nav__badge is-hidden">0</span>
      </button>
      <button class="nav__item" data-target="panel-params">
        <span class="nav__ico">⚙</span> Zone &amp; paramètres
      </button>
      <button class="nav__item" data-target="panel-carto">
        <span class="nav__ico">⌖</span> Cartographie
      </button>
      <button class="nav__item" data-target="panel-missions">
        <span class="nav__ico">≣</span> Missions &amp; scénarios
      </button>
      <button class="nav__item" data-target="panel-traitement">
        <span class="nav__ico">🖥</span> Estimation des traitements
      </button>
      <button class="nav__item" data-target="panel-meteo">
        <span class="nav__ico">☁</span> Conditions météo
      </button>
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
      <button class="nav__item" data-target="panel-suivi">
        <span class="nav__ico">📡</span> Suivi post levé par drone
      </button>
```

with:

```html
      <button class="nav__item is-active" data-target="panel-carto">
        <span class="nav__ico">⌖</span> Zone &amp; Cartographie
      </button>
      <button class="nav__item" data-target="panel-params">
        <span class="nav__ico">⚙</span> Paramètres
      </button>
      <button class="nav__item" data-target="panel-missions">
        <span class="nav__ico">≣</span> Missions &amp; scénarios
      </button>
      <button class="nav__item" data-target="panel-meteo">
        <span class="nav__ico">☁</span> Conditions météo
      </button>
      <button class="nav__item" data-target="panel-traitement">
        <span class="nav__ico">🖥</span> Estimation des traitements
      </button>
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
      <button class="nav__item" data-target="panel-dashboard">
        <span class="nav__ico">◧</span> Tableau de bord
        <span id="navAlertBadge" class="nav__badge is-hidden">0</span>
      </button>
      <button class="nav__item" data-target="panel-suivi">
        <span class="nav__ico">📡</span> Suivi post levé par drone
      </button>
```

Note: the `<section>` panels themselves are NOT physically reordered in the file in this step — only the nav buttons' order changes, which is what drives the visual tab order (the panels' own position in the HTML doesn't matter, only which one has `.is-active` matching the active nav button's `data-target`). Do not move the `<section>` blocks.

- [ ] **Step 3: Swap the default-active panel**

Replace:

```html
    <section id="panel-dashboard" class="panel is-active">
```

with:

```html
    <section id="panel-dashboard" class="panel">
```

Then replace:

```html
    <!-- ============ PANEL: CARTOGRAPHIE ============ -->
    <section id="panel-carto" class="panel">
```

with:

```html
    <!-- ============ PANEL: ZONE & CARTOGRAPHIE ============ -->
    <section id="panel-carto" class="panel is-active">
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures (static markup change, no JS logic touched).

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/index.html
git commit -m "feat: reorder and rename tabs (Zone & Cartographie first, Paramètres, Tableau de bord moved)"
```

(No automated test for the visual reordering itself — verified in Task 12.)

---

## Task 5: HTML — groupe "Zone" dans Zone & Cartographie, retrait de "Zone de la mission" de Paramètres

**Files:**
- Modify: `drone-mission-app/index.html`

- [ ] **Step 1: Remove the "Zone de la mission" box from Paramètres**

Replace:

```html
    <section id="panel-params" class="panel">
      <div class="grid-2">

        <div class="panel-box">
          <h3>Zone de la mission</h3>
          <div class="field">
            <label>Nom de la zone</label>
            <input type="text" id="nomZone" placeholder="Ex : Zone cadastrale de Yopougon">
          </div>
          <div class="field">
            <label>Superficie de référence (ha)</label>
            <input type="number" id="superficieManuelle" min="0" step="0.5" value="50">
          </div>
          <div class="btn-row">
            <button id="btnGenererZoneTest" class="btn btn--accent">Générer une zone carrée</button>
            <button id="btnEffacerZone" class="btn btn--ghost">Effacer la zone</button>
          </div>
          <p class="hint">Ou dessinez / importez la zone réelle depuis l'onglet <b>Cartographie</b> (KML, GeoJSON, Shapefile zippé).</p>
        </div>

        <div class="panel-box">
          <h3>Drone — DJI Matrice 350 RTK</h3>
```

with:

```html
    <section id="panel-params" class="panel">
      <div class="grid-2">

        <div class="panel-box">
          <h3>Drone — DJI Matrice 350 RTK</h3>
```

- [ ] **Step 2: Add the "Zone" fields to the renamed "Zone" box in Zone & Cartographie**

Replace:

```html
        <div class="carto-tools panel-box">
          <h3>Outils</h3>
          <div class="btn-col">
            <button id="btnDessinerZone" class="btn btn--accent">✎ Dessiner la zone</button>
            <button id="btnDessinerExclusion" class="btn btn--warn">✎ Zone d'exclusion</button>
            <button id="btnPointDecollage" class="btn btn--ghost">📍 Point de décollage</button>
            <label class="btn btn--ghost btn--file">
              ⭱ Importer (KML / GeoJSON / SHP.zip)
              <input type="file" id="fichierImport" accept=".kml,.geojson,.json,.zip" hidden>
            </label>
          </div>

          <h3 class="mt">Calques</h3>
```

with:

```html
        <div class="carto-tools panel-box">
          <h3>Zone</h3>
          <div class="field">
            <label>Localité ou Commune</label>
            <input type="text" id="zoneCommune" list="communesDatalist" placeholder="Ex : Yopougon">
            <datalist id="communesDatalist"></datalist>
          </div>
          <div class="field">
            <label>Nom de la zone</label>
            <input type="text" id="zoneNom" list="zonesDatalist" placeholder="Ex : Zone cadastrale de Yopougon">
            <datalist id="zonesDatalist"></datalist>
          </div>
          <div class="field">
            <label>Description</label>
            <textarea id="zoneDescription" rows="3"></textarea>
          </div>
          <div class="btn-row">
            <button id="btnEnregistrerZone" class="btn btn--accent">💾 Enregistrer</button>
            <button id="btnSupprimerZone" class="btn btn--warn">🗑 Supprimer</button>
          </div>

          <div class="btn-col mt">
            <button id="btnDessinerZone" class="btn btn--accent">✎ Dessiner la zone</button>
            <button id="btnDessinerExclusion" class="btn btn--warn">✎ Zone d'exclusion</button>
            <button id="btnPointDecollage" class="btn btn--ghost">📍 Point de décollage</button>
            <label class="btn btn--ghost btn--file">
              ⭱ Importer (KML / GeoJSON / SHP.zip)
              <input type="file" id="fichierImport" accept=".kml,.geojson,.json,.zip" hidden>
            </label>
          </div>

          <h3 class="mt">Calques</h3>
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/index.html
git commit -m "feat: add Zone group box (Commune, Nom, Description, Enregistrer/Supprimer) to Zone & Cartographie, remove Zone de la mission from Paramètres"
```

---

## Task 6: `app.js` — modèle d'état `state.zone`, retrait des anciennes liaisons

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Replace `state.nomZone` with `state.zone`**

Replace:

```js
    theme: 'sombre',
    superficieManuelleHa: 50,
    nomZone: ''
  };
```

with:

```js
    theme: 'sombre',
    superficieManuelleHa: 50,
    zone: { id: null, nom: '', commune: '', description: '' }
  };
```

(`superficieManuelleHa` is kept — it's no longer user-editable, but `genererZoneTest()` still reads it internally to size the demo zone shown on first load; its default of 50 is now a fixed internal constant rather than a form-bound value.)

- [ ] **Step 2: Remove the dead `champs` entries**

Replace:

```js
    ['superficieManuelle', 'superficieManuelleHa', Number],
    ['nomZone', 'nomZone', String]
  ];
```

with:

```js
  ];
```

(The zone fields — Commune, Nom, Description — are no longer simple auto-bound fields; they get bespoke handling in a later task, since selecting a zone by name must load its geometry/commune/description, which the generic `champs` mechanism can't express.)

- [ ] **Step 3: Remove the now-dead button bindings**

Replace:

```js
    document.getElementById('btnGenererZoneTest').addEventListener('click', genererZoneTest);
    document.getElementById('btnEffacerZone').addEventListener('click', () => Carto.effacerTout());
  }
```

with:

```js
  }
```

(Both buttons — `btnGenererZoneTest` and `btnEffacerZone` — were removed from `index.html` in Task 5. Leaving these `addEventListener` calls in place would throw `TypeError: Cannot read properties of null` on `init()`, since `document.getElementById` would return `null` for both ids.)

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures (this task only touches `app.js` orchestration code with no automated coverage, matching the file's existing pattern; verified manually in Task 12).

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: replace state.nomZone with state.zone, remove dead zone-test-generation bindings"
```

---

## Task 7: `app.js` — chargement paresseux de la liste des zones et des communes

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the lazy-load and populate functions**

In `drone-mission-app/app.js`, add this block right after `bindFiltresSuivi`'s closing `}` (which is followed by a blank line, then `async function afficherListeSuivi() {`). Locate that exact spot by searching for `function bindFiltresSuivi()` and inserting immediately after its closing brace:

```js
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
```

- [ ] **Step 2: Call `initialiserOngletZones()` on first visit to the tab, mirroring the météo/suivi lazy-init pattern**

In `bindNavigation()`, replace:

```js
        if (target === 'panel-carto') Carto.invalidateSize();
        if (target === 'panel-meteo' && !meteoAutoRempliFait) {
```

with:

```js
        if (target === 'panel-carto') {
          Carto.invalidateSize();
          if (!zonesChargeesFait) {
            zonesChargeesFait = true;
            initialiserOngletZones();
          }
        }
        if (target === 'panel-meteo' && !meteoAutoRempliFait) {
```

- [ ] **Step 3: Load the zone library on initial page load too, since "Zone & Cartographie" is now the default-active tab**

Since `panel-carto` is now shown by default on load (Task 4), a user never "clicks into" it on their first visit — `bindNavigation()`'s click handler alone would never fire for it. Replace:

```js
    remplirFormulaireDepuisEtat();
    genererZoneTest(); // zone de démonstration au chargement
    recalculer();
  }
```

with:

```js
    remplirFormulaireDepuisEtat();
    genererZoneTest(); // zone de démonstration au chargement
    recalculer();
    zonesChargeesFait = true;
    initialiserOngletZones();
  }
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: load shared zone library and populate commune/zone selectors on startup"
```

---

## Task 8: `app.js` — sélection d'une zone, filtrage par commune

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the selection-handling functions**

In `drone-mission-app/app.js`, add this block right after `peuplerDatalistZones`'s closing `}` (added in Task 7):

```js
  function bindSelectionZone() {
    document.getElementById('zoneCommune').addEventListener('change', () => {
      peuplerDatalistZones();
    });
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
    if (zone.commune) document.getElementById('zoneCommune').value = zone.commune;
    if (zone.geometrie && zone.geometrie.length >= 3) Carto.setZone(zone.geometrie);
  }
```

- [ ] **Step 2: Call `bindSelectionZone()` from `init()`**

Replace:

```js
    bindEnvoiVersSuivi();
    bindSuivi();
    bindFiltresSuivi();
    initCharts();
```

with:

```js
    bindEnvoiVersSuivi();
    bindSuivi();
    bindFiltresSuivi();
    bindSelectionZone();
    initCharts();
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: load a zone's geometry/commune/description when selected from the library"
```

---

## Task 9: `app.js` — boutons Enregistrer / Supprimer

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the save/delete functions**

In `drone-mission-app/app.js`, add this block right after `chargerZone`'s closing `}` (added in Task 8):

```js
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
    const session = await Suivi.sessionActuelle();
    if (!session) {
      Utils.toast('Connectez-vous dans l\'onglet « Suivi post levé par drone » avant d\'enregistrer une zone.', 'warning');
      document.querySelector('.nav__item[data-target="panel-suivi"]').click();
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
    const session = await Suivi.sessionActuelle();
    if (!session) {
      Utils.toast('Connectez-vous dans l\'onglet « Suivi post levé par drone » avant de supprimer une zone.', 'warning');
      document.querySelector('.nav__item[data-target="panel-suivi"]').click();
      return;
    }
    const btn = document.getElementById('btnSupprimerZone');
    btn.disabled = true;
    try {
      await Zones.supprimerZone(state.zone.id);
      state.zone = { id: null, nom: '', commune: '', description: '' };
      document.getElementById('zoneNom').value = '';
      document.getElementById('zoneDescription').value = '';
      zonesEnCache = await Zones.listerZones();
      peuplerCommunes();
      peuplerDatalistZones();
      Utils.toast('Zone supprimée.', 'success');
    } catch (err) {
      Utils.toast(`Échec de la suppression de la zone : ${err.message}`, 'danger');
      btn.disabled = false;
    }
  }
```

- [ ] **Step 2: Call `bindEnregistrerSupprimerZone()` from `init()`**

Replace:

```js
    bindFiltresSuivi();
    bindSelectionZone();
    initCharts();
```

with:

```js
    bindFiltresSuivi();
    bindSelectionZone();
    bindEnregistrerSupprimerZone();
    initCharts();
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: add Enregistrer/Supprimer handling for the shared zone library"
```

---

## Task 10: `app.js` — mise à jour de `envoyerVersSuivi`, rétrocompatibilité de rechargement de projet

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Update `envoyerVersSuivi` to read `state.zone`**

Replace:

```js
        nomZone: state.nomZone || 'Zone sans nom',
        commune: state.meteo.commune,
```

with:

```js
        nomZone: state.zone.nom || 'Zone sans nom',
        commune: state.zone.commune,
```

- [ ] **Step 2: Handle old project files that still have `state.nomZone` instead of `state.zone`**

In `bindImportExport()`, replace:

```js
        const data = await Exporter.chargerProjet(f);
        Object.assign(state, data.state);
        remplirFormulaireDepuisEtat();
```

with:

```js
        const data = await Exporter.chargerProjet(f);
        Object.assign(state, data.state);
        if (!data.state.zone && data.state.nomZone) {
          state.zone = { id: null, nom: data.state.nomZone, commune: '', description: '' };
        }
        remplirFormulaireDepuisEtat();
```

- [ ] **Step 3: Populate the new zone fields when a project is reloaded**

In `remplirFormulaireDepuisEtat()`, replace:

```js
    majPCTypeHint();
    majCoordsAffichage();
  }
```

with:

```js
    majPCTypeHint();
    majCoordsAffichage();
    document.getElementById('zoneNom').value = state.zone.nom || '';
    document.getElementById('zoneDescription').value = state.zone.description || '';
    if (state.zone.commune) document.getElementById('zoneCommune').value = state.zone.commune;
  }
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: use state.zone in Envoyer vers le Suivi, restore zone fields on project reload"
```

---

## Task 11: `export.js` — Commune et Description dans le PDF et l'Excel

**Files:**
- Modify: `drone-mission-app/export.js`

- [ ] **Step 1: Update the PDF header**

Replace:

```js
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(`Zone : ${params.nomZone && params.nomZone.trim() ? params.nomZone.trim() : 'Non renseignée'}`, 40, y);
    y += 16;
```

with:

```js
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(`Zone : ${params.zone.nom && params.zone.nom.trim() ? params.zone.nom.trim() : 'Non renseignée'}`, 40, y);
    y += 16;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Commune : ${params.zone.commune && params.zone.commune.trim() ? params.zone.commune.trim() : 'Non renseignée'}`, 40, y);
    y += 13;
    doc.text(`Description : ${params.zone.description && params.zone.description.trim() ? params.zone.description.trim() : 'Non renseignée'}`, 40, y);
    y += 16;
```

- [ ] **Step 2: Update the Excel summary**

Replace:

```js
  function resumeVersLignes(r, p) {
    const pcType = p.performance.types[p.performance.typeSelectionne] || p.performance.types.portable;
    return [
      ['Rapport de mission — Planification photogrammétrique drone'],
      ['Généré le', Utils.now()],
      [],
      ['Paramètres drone'],
```

with:

```js
  function resumeVersLignes(r, p) {
    const pcType = p.performance.types[p.performance.typeSelectionne] || p.performance.types.portable;
    return [
      ['Rapport de mission — Planification photogrammétrique drone'],
      ['Généré le', Utils.now()],
      [],
      ['Zone'],
      ['Nom', p.zone.nom || 'Non renseigné'],
      ['Commune', p.zone.commune || 'Non renseignée'],
      ['Description', p.zone.description || 'Non renseignée'],
      [],
      ['Paramètres drone'],
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 61 tests, 0 failures (export.js has no automated test coverage, matching the file's existing pattern — verified manually in Task 12).

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/export.js
git commit -m "feat: include Commune and Description in the PDF report and Excel export"
```

---

## Task 12: Vérification manuelle en navigateur

**Files:** none (verification only).

- [ ] **Step 1: Serve the app locally**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 2: Vérifier le nouvel ordre et les nouveaux noms des onglets**

Ouvrir `http://localhost:8080`. Confirmer l'absence d'erreur console. Confirmer que l'onglet actif par défaut est **« Zone & Cartographie »** (première position), et que l'ordre complet est : Zone & Cartographie, Paramètres, Missions & scénarios, Conditions météo, Estimation des traitements, Export & projet, Tableau de bord, Suivi post levé par drone. Confirmer que la carte s'affiche correctement dès le chargement (pas de rendu tronqué/mal dimensionné).

- [ ] **Step 3: Vérifier le groupe « Zone » et l'absence de connexion**

Sans être connecté : confirmer que le champ Localité/Commune est vide (aucune suggestion tant qu'aucune zone n'est chargée), que le champ Nom de la zone est vide ou affiche la zone de démonstration générée au chargement, que dessiner une nouvelle zone et voir les calculs se mettre à jour (onglet Tableau de bord) fonctionne normalement sans connexion. Cliquer sur « Enregistrer » : confirmer un toast d'avertissement et une redirection vers l'écran de connexion du Suivi (pas de plantage).

- [ ] **Step 4: Vérifier l'onglet « Paramètres »**

Confirmer que le groupe « Zone de la mission », le champ « Superficie de référence (ha) », les boutons « Générer une zone carrée »/« Effacer la zone » et le texte d'aide sur l'import ont bien disparu. Confirmer que les autres groupes (Drone, Caméra, Paramètres de vol, Coûts, PC) sont inchangés et fonctionnent normalement.

- [ ] **Step 5: Se connecter et tester Enregistrer/Supprimer**

Se connecter (compte admin). Dessiner une zone, taper un nom, sélectionner/taper une commune, écrire une description, cliquer « Enregistrer » : confirmer un toast de succès. Recharger la page (F5), revenir dans Zone & Cartographie : confirmer que le nom de la zone apparaît dans les suggestions du champ Nom de la zone, et que le sélectionner recharge géométrie/commune/description. Changer la commune dans le filtre : confirmer que la liste de suggestions se restreint aux zones de cette commune. Cliquer « Supprimer » : confirmer que la zone disparaît de la bibliothèque et que les champs se réinitialisent.

- [ ] **Step 6: Vérifier les exports**

Avec une zone nommée chargée (nom, commune, description renseignés), exporter le rapport PDF complet : confirmer que Commune et Description apparaissent sous le nom de la zone. Exporter en Excel : confirmer la présence d'une section « Zone » avec Nom/Commune/Description en tête du résumé.

- [ ] **Step 7: Tester le rechargement d'un ancien projet**

Si un fichier de projet `.json` sauvegardé avant cette tranche est disponible (contenant `nomZone` et pas `zone`), le recharger : confirmer que le nom de la zone est repris dans le champ Nom de la zone sans erreur, avec commune/description vides. À défaut, ce cas peut être simulé en éditant un fichier de sauvegarde généré par l'app actuelle pour retirer la clé `zone` et ajouter `"nomZone": "Test rétrocompatibilité"`.

- [ ] **Step 8: Régression sur les fonctionnalités inchangées**

Confirmer que Missions & scénarios, Conditions météo, Estimation des traitements, Export & projet (CSV/KML), Suivi post levé par drone (liste, détail, formulaires) fonctionnent comme avant cette tranche. Confirmer que le service worker est toujours enregistré et actif.

- [ ] **Step 9: Run the full automated suite one last time**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — all tests green (61, or the actual reported count — 0 failures is what matters).

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "chore: manual verification pass for shared zones library and tab reorganization"
```

(Only commit if verification uncovered fixes; if nothing changed, skip this step.)
