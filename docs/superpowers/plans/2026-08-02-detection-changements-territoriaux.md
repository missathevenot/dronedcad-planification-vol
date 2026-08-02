# Détection des changements territoriaux (B7, Groupe 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th sub-tab "Détection des changements" to a zone's Suivi dossier, letting an agent compare the current dossier to a prior dossier of the same zone, draw and categorize change polygons (construction/extension/démolition/occupation du sol/anomalie cadastrale/anomalie fiscale) with a priority level, and generate a PDF "rapport d'analyse territoriale".

**Architecture:** One new Supabase table `changements_territoriaux` (one row per drawn polygon, generic `type` field instead of 6 separate tables). `suivi.js` gains pure mapper/filter/stats functions plus impure CRUD, following its existing pure/impure split. A new small dedicated Leaflet module `carto-changements.js` (mirroring the separation already established by `cartographie.js`, but scoped to a single drawable "changement" layer instead of the full zone/exclusion/décollage/lignes-de-vol toolset) powers a mini-map inside the sub-tab. `app.js` adds the 5th sub-tab following the existing `suiviSousOnglet*` pattern (`rendreSousOngletPlanification` / `rendreCartesQualite` are the closest precedents). `export.js` gains a new PDF report function reusing the existing `dessinerEnteteOfficiel` header and `section`/`ligneKV` helpers.

**Tech Stack:** Vanilla JS, Leaflet, Supabase (Postgres + Auth + RLS), jsPDF, `node:test`.

**Design doc:** `docs/superpowers/specs/2026-08-02-detection-changements-territoriaux-design.md`

---

## Task 1: Provisionner le schéma Supabase (table + RLS)

**Files:** none (exécuté directement via l'outil Supabase par l'orchestrateur, action ponctuelle sur le schéma de production, même pattern que les tranches précédentes).

- [ ] **Step 1: Créer la table `changements_territoriaux`**

```sql
create table changements_territoriaux (
  id uuid primary key default gen_random_uuid(),
  mission_suivi_id uuid not null references missions_suivi(id) on delete cascade,
  dossier_reference_id uuid references missions_suivi(id),
  type text not null check (type in (
    'nouvelle_construction', 'extension', 'demolition',
    'changement_occupation_sol', 'anomalie_cadastrale', 'anomalie_fiscale'
  )),
  geometrie jsonb not null,
  priorite text not null default 'moyenne' check (priorite in ('faible','moyenne','haute')),
  description text default '',
  date_detection date not null default current_date,
  detecte_par uuid references profils(id)
);
alter table changements_territoriaux enable row level security;
create policy "lecture_tous_agents_actifs" on changements_territoriaux for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on changements_territoriaux for insert to authenticated with check (public.est_agent_actif());
create policy "modification_tous_agents_actifs" on changements_territoriaux for update to authenticated using (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on changements_territoriaux for delete to authenticated using (public.est_agent_actif());
```

- [ ] **Step 2: Vérifier l'absence de récursion RLS**

Confirmer via `get_advisors(type: security)` qu'aucune alerte nouvelle n'apparaît sur `changements_territoriaux` (la policy réutilise `est_agent_actif()`, déjà validée sans récursion dans les tranches précédentes).

---

## Task 2: Fonctions pures — mapper, filtre, statistiques

**Files:**
- Modify: `drone-mission-app/suivi.js`
- Test: `drone-mission-app/tests/suivi.test.js`

- [ ] **Step 1: Ajouter les fonctions pures**

Dans `drone-mission-app/suivi.js`, juste après `calculerStatsTableauDeBord` (qui se termine par `return { total, termines, enCours, incidents, volumetrieTotaleMo };\n  }`) et avant le commentaire `// Fonctions impures`, ajouter :

```js

  /** Convertit une ligne Supabase (snake_case) `changements_territoriaux` en objet JS (camelCase). */
  function mapperChangementVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      dossierReferenceId: row.dossier_reference_id,
      type: row.type,
      geometrie: row.geometrie,
      priorite: row.priorite,
      description: row.description,
      dateDetection: row.date_detection,
      detectePar: row.detecte_par
    };
  }

  /** Filtre une liste de changements par type et/ou priorité. Filtres vides = pas de filtrage sur ce critère. */
  function filtrerChangements(changements, filtres = {}) {
    return changements.filter((c) =>
      (!filtres.type || c.type === filtres.type) &&
      (!filtres.priorite || c.priorite === filtres.priorite)
    );
  }

  /** Compte les changements par type et par priorité, pour l'en-tête de la liste et le rapport PDF. */
  function calculerStatsChangements(changements) {
    const parType = {};
    const parPriorite = { faible: 0, moyenne: 0, haute: 0 };
    changements.forEach((c) => {
      parType[c.type] = (parType[c.type] || 0) + 1;
      parPriorite[c.priorite] = (parPriorite[c.priorite] || 0) + 1;
    });
    return { total: changements.length, parType, parPriorite };
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Dans le `return { ... }` en fin de fichier, remplacer :

```js
    mapperMembreEquipeVersJs, mapperAutorisationVersJs, mapperIncidentVersJs, mapperAnomalieVersJs, mapperCorrectionVersJs, mapperPieceJointeVersJs, calculerIndicateursCharge,
```

par :

```js
    mapperMembreEquipeVersJs, mapperAutorisationVersJs, mapperIncidentVersJs, mapperAnomalieVersJs, mapperCorrectionVersJs, mapperPieceJointeVersJs, calculerIndicateursCharge,
    mapperChangementVersJs, filtrerChangements, calculerStatsChangements,
```

- [ ] **Step 3: Tests**

Ajouter à la fin de `drone-mission-app/tests/suivi.test.js` :

```js
test('mapperChangementVersJs: convertit une ligne changements_territoriaux', () => {
  const js = Suivi.mapperChangementVersJs({
    id: 'ch1', mission_suivi_id: 'm1', dossier_reference_id: 'm0',
    type: 'nouvelle_construction', geometrie: [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]],
    priorite: 'haute', description: 'Bâtiment non cadastré', date_detection: '2026-08-01', detecte_par: 'a1'
  });
  assert.strictEqual(js.type, 'nouvelle_construction');
  assert.strictEqual(js.dossierReferenceId, 'm0');
  assert.strictEqual(js.priorite, 'haute');
  assert.deepStrictEqual(js.geometrie, [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]]);
});

test('filtrerChangements: filtre par type', () => {
  const changements = [
    { type: 'extension', priorite: 'faible' },
    { type: 'demolition', priorite: 'haute' }
  ];
  const resultat = Suivi.filtrerChangements(changements, { type: 'demolition' });
  assert.strictEqual(resultat.length, 1);
  assert.strictEqual(resultat[0].type, 'demolition');
});

test('filtrerChangements: filtre par priorité', () => {
  const changements = [
    { type: 'extension', priorite: 'faible' },
    { type: 'demolition', priorite: 'haute' }
  ];
  const resultat = Suivi.filtrerChangements(changements, { priorite: 'haute' });
  assert.strictEqual(resultat.length, 1);
  assert.strictEqual(resultat[0].priorite, 'haute');
});

test('filtrerChangements: sans filtre retourne tout', () => {
  const changements = [{ type: 'extension', priorite: 'faible' }, { type: 'demolition', priorite: 'haute' }];
  assert.strictEqual(Suivi.filtrerChangements(changements, {}).length, 2);
  assert.strictEqual(Suivi.filtrerChangements(changements).length, 2);
});

test('calculerStatsChangements: compte par type et par priorité', () => {
  const changements = [
    { type: 'extension', priorite: 'faible' },
    { type: 'extension', priorite: 'moyenne' },
    { type: 'demolition', priorite: 'haute' }
  ];
  const stats = Suivi.calculerStatsChangements(changements);
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.parType.extension, 2);
  assert.strictEqual(stats.parType.demolition, 1);
  assert.strictEqual(stats.parPriorite.faible, 1);
  assert.strictEqual(stats.parPriorite.moyenne, 1);
  assert.strictEqual(stats.parPriorite.haute, 1);
});

test('calculerStatsChangements: tableau vide donne des stats à zéro', () => {
  const stats = Suivi.calculerStatsChangements([]);
  assert.strictEqual(stats.total, 0);
  assert.deepStrictEqual(stats.parType, {});
  assert.deepStrictEqual(stats.parPriorite, { faible: 0, moyenne: 0, haute: 0 });
});
```

- [ ] **Step 4: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS, 79 tests (73 existants + 6 nouveaux), 0 échec.

```bash
git add drone-mission-app/suivi.js drone-mission-app/tests/suivi.test.js
git commit -m "feat: fonctions pures pour les changements territoriaux (mapper, filtre, statistiques)"
```

---

## Task 3: CRUD Supabase — changements territoriaux

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Ajouter les fonctions impures**

Dans `drone-mission-app/suivi.js`, juste avant `return { ... }` en fin de fichier (après `enregistrerCorrection`), ajouter :

```js

  /** Liste les changements territoriaux enregistrés pour un dossier. */
  async function listerChangements(missionSuiviId) {
    const sb = initClient();
    const { data, error } = await sb.from('changements_territoriaux').select('*').eq('mission_suivi_id', missionSuiviId).order('date_detection', { ascending: false });
    if (error) throw new Error(`Échec du chargement des changements : ${error.message}`);
    return data.map(mapperChangementVersJs);
  }

  /** Enregistre un nouveau changement territorial (polygone dessiné + catégorisation). */
  async function enregistrerChangement(missionSuiviId, donnees) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const ligne = {
      mission_suivi_id: missionSuiviId,
      dossier_reference_id: donnees.dossierReferenceId || null,
      type: donnees.type,
      geometrie: donnees.geometrie,
      priorite: donnees.priorite || 'moyenne',
      description: donnees.description || '',
      detecte_par: user ? user.id : null
    };
    const { data, error } = await sb.from('changements_territoriaux').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'enregistrement du changement : ${error.message}`);
    return mapperChangementVersJs(data);
  }

  /** Supprime un changement territorial. */
  async function supprimerChangement(id) {
    const sb = initClient();
    const { error } = await sb.from('changements_territoriaux').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression du changement : ${error.message}`);
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Remplacer la dernière ligne du `return { ... }` :

```js
    listerAnomaliesQualite, signalerAnomalieQualite, mettreAJourAnomalieQualite,
    listerCorrections, enregistrerCorrection
  };
```

par :

```js
    listerAnomaliesQualite, signalerAnomalieQualite, mettreAJourAnomalieQualite,
    listerCorrections, enregistrerCorrection,
    listerChangements, enregistrerChangement, supprimerChangement
  };
```

- [ ] **Step 3: Lancer les tests (pas de nouveau test — fonctions impures, non testées automatiquement, cohérent avec le reste du fichier)**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: CRUD Supabase pour les changements territoriaux"
```

---

## Task 4: Nouveau module carte dédiée `carto-changements.js`

**Files:**
- Create: `drone-mission-app/carto-changements.js`

- [ ] **Step 1: Créer le fichier**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add drone-mission-app/carto-changements.js
git commit -m "feat: module carte dédié au dessin des changements territoriaux"
```

---

## Task 5: Charger le nouveau script et styler la mini-carte

**Files:**
- Modify: `drone-mission-app/index.html`
- Modify: `drone-mission-app/style.css`
- Modify: `drone-mission-app/sw.js`

- [ ] **Step 1: Ajouter la balise `<script>`**

Dans `drone-mission-app/index.html`, remplacer :

```html
<script src="cartographie.js"></script>
```

par :

```html
<script src="cartographie.js"></script>
<script src="carto-changements.js"></script>
```

- [ ] **Step 2: Ajouter la classe CSS de la mini-carte**

Dans `drone-mission-app/style.css`, juste après la règle `.carto-map{...}` (`.carto-map{border:1px solid var(--line); border-radius:var(--radius); overflow:hidden;}`), ajouter :

```css
.suivi-mini-carte{border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; height:360px; margin:10px 0;}
.suivi-mini-carte > div{width:100%; height:100%; background:var(--panel-2);}
```

- [ ] **Step 3: Précacher le nouveau fichier dans le service worker**

Dans `drone-mission-app/sw.js`, remplacer :

```js
  './cartographie.js',
  './logo-dgi.js',
```

par :

```js
  './cartographie.js',
  './carto-changements.js',
  './logo-dgi.js',
```

- [ ] **Step 4: Bumper la version du cache**

Remplacer :

```js
const CACHE_VERSION = 'drones-dcad-v3';
```

par :

```js
const CACHE_VERSION = 'drones-dcad-v4';
```

- [ ] **Step 5: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec (changements HTML/CSS/SW purs, aucun impact sur les tests Node).

```bash
git add drone-mission-app/index.html drone-mission-app/style.css drone-mission-app/sw.js
git commit -m "feat: charger carto-changements.js, styler la mini-carte, précacher le nouveau fichier"
```

---

## Task 6: `app.js` — intégrer le 5e sous-onglet "Détection des changements"

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Ajouter le bouton de sous-onglet et le panneau dans `majAffichageDetailSuivi`**

Remplacer :

```js
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'qualite' ? ' is-active' : ''}" data-sous-onglet="qualite">Contrôle qualité</button>
        </div>
      </div>

      <div id="suiviSousOngletPlanification" class="suivi-sous-panel${suiviSousOngletActif === 'planification' ? '' : ' is-hidden'}">${rendreSousOngletPlanification(dossier, equipe, autorisations)}</div>
      <div id="suiviSousOngletExecution" class="suivi-sous-panel${suiviSousOngletActif === 'execution' ? '' : ' is-hidden'}">${rendreCartesExecutions(executions)}</div>
      <div id="suiviSousOngletTraitement" class="suivi-sous-panel${suiviSousOngletActif === 'traitement' ? '' : ' is-hidden'}">${rendreCartesEtapes(etapes)}</div>
      <div id="suiviSousOngletQualite" class="suivi-sous-panel${suiviSousOngletActif === 'qualite' ? '' : ' is-hidden'}">${rendreCartesQualite(controles)}</div>
    `;
```

par :

```js
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'qualite' ? ' is-active' : ''}" data-sous-onglet="qualite">Contrôle qualité</button>
          <button class="btn btn--ghost suivi-sous-onglet${suiviSousOngletActif === 'changements' ? ' is-active' : ''}" data-sous-onglet="changements">Détection des changements</button>
        </div>
      </div>

      <div id="suiviSousOngletPlanification" class="suivi-sous-panel${suiviSousOngletActif === 'planification' ? '' : ' is-hidden'}">${rendreSousOngletPlanification(dossier, equipe, autorisations)}</div>
      <div id="suiviSousOngletExecution" class="suivi-sous-panel${suiviSousOngletActif === 'execution' ? '' : ' is-hidden'}">${rendreCartesExecutions(executions)}</div>
      <div id="suiviSousOngletTraitement" class="suivi-sous-panel${suiviSousOngletActif === 'traitement' ? '' : ' is-hidden'}">${rendreCartesEtapes(etapes)}</div>
      <div id="suiviSousOngletQualite" class="suivi-sous-panel${suiviSousOngletActif === 'qualite' ? '' : ' is-hidden'}">${rendreCartesQualite(controles)}</div>
      <div id="suiviSousOngletChangements" class="suivi-sous-panel${suiviSousOngletActif === 'changements' ? '' : ' is-hidden'}">${rendreSousOngletChangements(dossier)}</div>
    `;
```

- [ ] **Step 2: Basculer la visibilité du 5e panneau dans `bindSousOngletsSuivi`**

Remplacer :

```js
        document.getElementById('suiviSousOngletQualite').classList.toggle('is-hidden', cible !== 'qualite');
      });
    });
  }
```

par :

```js
        document.getElementById('suiviSousOngletQualite').classList.toggle('is-hidden', cible !== 'qualite');
        document.getElementById('suiviSousOngletChangements').classList.toggle('is-hidden', cible !== 'changements');
      });
    });
  }
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec (`rendreSousOngletChangements` sera ajouté à la Task 7 ; ce commit seul provoquerait une `ReferenceError` en navigateur mais n'affecte pas les tests Node — accepté comme état intermédiaire entre deux commits de la même tâche fonctionnelle, cohérent avec le style d'autres tâches du plan précédent).

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: intégrer le 5e sous-onglet Détection des changements dans Suivi"
```

---

## Task 7: `app.js` — rendu du sous-onglet et sélection du dossier de référence

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Ajouter les libellés de type/priorité**

Juste après la ligne :

```js
  const BADGE_RESULTAT_QUALITE = { conforme: 'success', rejete: 'danger', a_reprendre: 'warning' };
```

ajouter :

```js
  const LIBELLES_TYPE_CHANGEMENT = {
    nouvelle_construction: 'Nouvelle construction', extension: 'Extension', demolition: 'Démolition',
    changement_occupation_sol: "Changement d'occupation du sol",
    anomalie_cadastrale: 'Anomalie cadastrale', anomalie_fiscale: 'Anomalie fiscale'
  };
  const LIBELLES_PRIORITE_CHANGEMENT = { faible: 'Faible', moyenne: 'Moyenne', haute: 'Haute' };
  const BADGE_PRIORITE_CHANGEMENT = { faible: 'success', moyenne: 'warning', haute: 'danger' };
```

- [ ] **Step 2: Ajouter `rendreSousOngletChangements`**

Juste après la fin de la fonction `rendreCartesQualite` (juste avant `function rendreSousOngletPlanification`), ajouter :

```js
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
```

- [ ] **Step 3: Charger le sélecteur de dossier de référence**

Après la fonction `chargerAgentsPourAffectation`, ajouter :

```js
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
```

- [ ] **Step 4: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec.

```bash
git add drone-mission-app/app.js
git commit -m "feat: rendu du sous-onglet Détection des changements et sélecteur de dossier de référence"
```

---

## Task 8: `app.js` — carte de dessin et enregistrement d'un changement

**Files:**
- Modify: `drone-mission-app/app.js`

**Contexte :** `chargerListeEtCarteChangements` (créée dans cette tâche) est appelée une seule fois, depuis `bindFormulairesDetailSuivi` (câblée dans cette tâche) — elle initialise la mini-carte et attache les écouteurs du formulaire (dessiner/annuler/enregistrer/rapport) sur des boutons DOM persistants, rendus une seule fois par `rendreSousOngletChangements` (Task 7) et jamais recréés ensuite. Recharger les changements après une sauvegarde/suppression passe donc par une fonction séparée et plus légère, `rafraichirChangements` (Step 1bis), qui ne touche ni la carte (`initMap`) ni le formulaire — seulement la liste, l'affichage des polygones existants et le sélecteur de dossier de référence. Rappeler `bindFormulaireChangements` à chaque sauvegarde (comme le fait `chargerRegistreAnomalies` pour son propre sous-onglet) réattacherait un jeu d'écouteurs supplémentaire sur ces mêmes boutons à chaque fois, d'où l'accumulation à éviter.

- [ ] **Step 1: Ajouter les variables d'état et la fonction principale**

Après `chargerDossiersReferencePourChangements` (Task 7), ajouter :

```js
  let changementGeometrieEnAttente = null;
  let changementsActuelsPourRapport = [];

  async function chargerListeEtCarteChangements(dossierId, zoneId, hoteListe) {
    try {
      CartoChangements.initMap('changementsCarte');
      bindFormulaireChangements(dossierId, zoneId, hoteListe);
      await rafraichirChangements(dossierId, zoneId, hoteListe);
    } catch (err) {
      hoteListe.innerHTML = `<h3>Changements enregistrés</h3><p class="hint">Échec du chargement : ${Utils.escapeHtml(err.message)}</p>`;
      Utils.toast(`Échec du chargement des changements : ${err.message}`, 'danger');
    }
  }
```

- [ ] **Step 1bis: Ajouter `rafraichirChangements` (rechargement léger, sans réinitialiser la carte ni le formulaire)**

Juste après `chargerListeEtCarteChangements`, ajouter :

```js
  async function rafraichirChangements(dossierId, zoneId, hoteListe) {
    const changements = await Suivi.listerChangements(dossierId);
    changementsActuelsPourRapport = changements;
    CartoChangements.afficherChangements(changements);
    CartoChangements.invalidateSize();
    renderListeChangements(hoteListe, changements);
    await chargerDossiersReferencePourChangements(zoneId, dossierId);
    return changements;
  }
```

- [ ] **Step 2: Câbler le bouton "Dessiner un changement" et le formulaire d'enregistrement**

Ajouter, juste après `rafraichirChangements` :

```js
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
```

Points importants (corrigés après revue de code d'une première version de cette tâche) :
- `bindFormulaireChangements` n'est appelée qu'une seule fois, depuis `chargerListeEtCarteChangements` (chargement initial du sous-onglet) — jamais depuis `rafraichirChangements`. Les boutons `btnDessiner`/`btnEnregistrer`/`btnAnnuler`/`btnRapport` sont rendus une seule fois par `rendreSousOngletChangements` (Task 7) et ne sont jamais recréés ; les rappeler à chaque rafraîchissement accumulerait des écouteurs dupliqués sur ces mêmes nœuds DOM persistants.
- `btnEnregistrer.disabled` est remis à `false` dans un bloc `finally`, pas seulement dans le `catch` — sans cela, le bouton resterait désactivé indéfiniment après une sauvegarde réussie (aucun re-rendu complet ne recrée ce bouton pour le "réactiver" implicitement).
- `changementsActuelsPourRapport` est une variable de niveau module, mise à jour à chaque `rafraichirChangements`, plutôt qu'un paramètre figé au moment du premier `bindFormulaireChangements` — sinon le bouton rapport utiliserait toujours la toute première liste chargée, jamais les changements ajoutés/supprimés depuis.

Note : `renderListeChangements` est ajoutée à la Task 9 — cette tâche seule provoquerait une `ReferenceError` en navigateur (mais pas d'échec des tests Node), état intermédiaire accepté comme dans la Task 6.

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec.

```bash
git add drone-mission-app/app.js
git commit -m "feat: dessin et enregistrement d'un changement territorial sur la mini-carte"
```

---

## Task 9: `app.js` — liste filtrable et suppression des changements

**Files:**
- Modify: `drone-mission-app/app.js`

**Contexte :** le bouton de suppression appelle `rafraichirChangements` (ajoutée en Task 8), pas `chargerListeEtCarteChangements` — pour la même raison que le formulaire d'enregistrement (Task 8) : `chargerListeEtCarteChangements` réinitialise la carte et rappelle `bindFormulaireChangements`, ce qui accumulerait des écouteurs sur les boutons persistants du formulaire à chaque suppression. `renderListeChangements` elle-même reste sûre à rappeler autant de fois que nécessaire (filtres inclus) car elle remplace entièrement son propre `hoteListe.innerHTML` à chaque appel — ses propres écouteurs (filtres, boutons Supprimer) sont donc toujours attachés à des nœuds fraîchement créés, jamais accumulés.

- [ ] **Step 1: Ajouter `renderListeChangements`**

Après `bindFormulaireChangements` (Task 8), ajouter :

```js
  function renderListeChangements(hoteListe, changements, filtres = {}) {
    const filtres_actuels = { type: filtres.type || '', priorite: filtres.priorite || '' };
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
          <button class="btn btn--ghost suivi-changement-supprimer">Supprimer</button>
        </div>
      `).join('')}
    `;

    const selectType = document.getElementById('changementsFiltreType');
    const selectPriorite = document.getElementById('changementsFiltrePriorite');
    selectType.addEventListener('change', () => renderListeChangements(hoteListe, changements, { type: selectType.value, priorite: selectPriorite.value }));
    selectPriorite.addEventListener('change', () => renderListeChangements(hoteListe, changements, { type: selectType.value, priorite: selectPriorite.value }));

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
  }
```

- [ ] **Step 2: Câbler le chargement initial dans `bindFormulairesDetailSuivi`**

Remplacer :

```js
    document.querySelectorAll('[data-registre-anomalies]').forEach((hote) => {
      chargerRegistreAnomalies(hote.dataset.registreAnomalies);
    });
```

par :

```js
    document.querySelectorAll('[data-registre-anomalies]').forEach((hote) => {
      chargerRegistreAnomalies(hote.dataset.registreAnomalies);
    });

    document.querySelectorAll('[data-changements-liste]').forEach((hote) => {
      const [dossierId, zoneId] = hote.dataset.changementsListe.split(':');
      chargerListeEtCarteChangements(dossierId, zoneId || null, hote);
    });
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec.

```bash
git add drone-mission-app/app.js
git commit -m "feat: liste filtrable et suppression des changements territoriaux"
```

---

## Task 10: `export.js` — rapport PDF d'analyse territoriale

**Files:**
- Modify: `drone-mission-app/export.js`

- [ ] **Step 1: Ajouter les libellés et la fonction d'export**

Dans `drone-mission-app/export.js`, juste avant `function sauvegarderProjet(state) {`, ajouter :

```js
  const LIBELLES_TYPE_CHANGEMENT_EXPORT = {
    nouvelle_construction: 'Nouvelle construction', extension: 'Extension', demolition: 'Démolition',
    changement_occupation_sol: "Changement d'occupation du sol",
    anomalie_cadastrale: 'Anomalie cadastrale', anomalie_fiscale: 'Anomalie fiscale'
  };
  const LIBELLES_PRIORITE_EXPORT = { faible: 'Faible', moyenne: 'Moyenne', haute: 'Haute' };

  function exportRapportChangements(dossier, changements, nomDossierReference, stats) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = dessinerEnteteOfficiel(doc, pageW);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text("RAPPORT D'ANALYSE TERRITORIALE — DETECTION DES CHANGEMENTS", pageW / 2, y, { align: 'center' });
    y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(`Zone : ${dossier.nomZone && dossier.nomZone.trim() ? dossier.nomZone.trim() : 'Non renseignée'}`, 40, y);
    y += 16;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Commune : ${dossier.commune && dossier.commune.trim() ? dossier.commune.trim() : 'Non renseignée'}`, 40, y);
    y += 13;
    doc.text(`Dossier de référence : ${nomDossierReference || 'Aucun (premier levé)'}`, 40, y);
    y += 16;

    doc.setTextColor(90);
    doc.text(`Généré le ${Utils.now()}  •  Drones DCAD`, 40, y);
    doc.setTextColor(20);
    y += 22;

    doc.setDrawColor(220); doc.line(40, y, pageW - 40, y); y += 18;

    const section = (titre) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(titre, 40, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    };
    const ligneKV = (k, v) => {
      doc.text(String(k), 46, y);
      doc.text(String(v), 260, y);
      y += 13;
      if (y > 760) { doc.addPage(); y = 48; }
    };

    section('Synthèse par type');
    Object.keys(LIBELLES_TYPE_CHANGEMENT_EXPORT).forEach((t) => ligneKV(LIBELLES_TYPE_CHANGEMENT_EXPORT[t], stats.parType[t] || 0));
    y += 6;

    section('Synthèse par priorité');
    Object.keys(LIBELLES_PRIORITE_EXPORT).forEach((p) => ligneKV(LIBELLES_PRIORITE_EXPORT[p], stats.parPriorite[p] || 0));
    y += 6;

    section('Détail des changements');
    if (changements.length === 0) {
      doc.text('Aucun changement enregistré.', 46, y); y += 13;
    }
    changements.forEach((c) => {
      ligneKV(`${LIBELLES_TYPE_CHANGEMENT_EXPORT[c.type]} (${LIBELLES_PRIORITE_EXPORT[c.priorite]})`, c.dateDetection);
      if (c.description) {
        doc.setFontSize(8.5); doc.setTextColor(90);
        const lignes = doc.splitTextToSize(c.description, 480);
        lignes.forEach((ligne) => {
          doc.text(ligne, 46, y); y += 11;
          if (y > 760) { doc.addPage(); y = 48; }
        });
        doc.setFontSize(9.5); doc.setTextColor(20);
      }
    });

    doc.save(`rapport_changements_${Date.now()}.pdf`);
    Utils.toast('Rapport PDF généré.', 'success');
  }
```

- [ ] **Step 2: Exporter la nouvelle fonction**

Remplacer :

```js
  return { exportCSV, exportExcel, exportPDF, sauvegarderProjet, chargerProjet };
```

par :

```js
  return { exportCSV, exportExcel, exportPDF, exportRapportChangements, sauvegarderProjet, chargerProjet };
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 79 tests, 0 échec (export.js n'a pas de tests dédiés, cohérent avec le reste du fichier — logique de rendu PDF non testée automatiquement).

```bash
git add drone-mission-app/export.js
git commit -m "feat: rapport PDF d'analyse territoriale pour les changements détectés"
```

---

## Task 11: Vérification manuelle complète en navigateur

**Files:** none (verification only).

- [ ] **Step 1: Servir l'app localement**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 2: Ouvrir un dossier existant et vérifier le 5e sous-onglet**

Se connecter, ouvrir un dossier de suivi ayant une zone associée. Confirmer la présence du sous-onglet « Détection des changements » à côté des 4 précédents, aucune erreur console à son ouverture.

- [ ] **Step 3: Vérifier le sélecteur de dossier de référence**

Confirmer que le sélecteur liste bien les autres dossiers de la même zone (le cas échéant) et propose « Aucun (premier levé) » par défaut.

- [ ] **Step 4: Dessiner et enregistrer un changement**

Cliquer « Dessiner un changement », placer au moins 3 points sur la carte, double-cliquer pour terminer : le formulaire de catégorisation apparaît. Choisir un type et une priorité, enregistrer : le changement apparaît dans la liste ET sur la carte, coloré selon sa priorité.

- [ ] **Step 5: Vérifier les filtres et la suppression**

Filtrer par type puis par priorité : la liste se met à jour sans recharger la carte de façon incohérente. Supprimer un changement : il disparaît de la liste et de la carte.

- [ ] **Step 6: Vérifier le rapport PDF**

Cliquer « Générer le rapport d'analyse territoriale » : un PDF se télécharge, avec l'en-tête officiel, la synthèse par type/priorité, et le détail des changements enregistrés.

- [ ] **Step 7: Vérifier la réinitialisation au changement de dossier/zone**

Changer de zone ou de dossier dans Suivi puis revenir sur « Détection des changements » : aucun résidu du dessin ou du formulaire précédent, la carte et la liste reflètent le nouveau dossier.

- [ ] **Step 8: Régression sur le reste de l'application**

Confirmer que Zone & Cartographie, Paramètres, Missions & scénarios, Météo, Traitements, Export & projet et les 4 autres sous-onglets de Suivi fonctionnent comme avant cette tranche.

- [ ] **Step 9: Suite automatisée finale**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 79 tests, 0 échec.

- [ ] **Step 10: Commit final (si des corrections ont été nécessaires)**

```bash
git add -A
git commit -m "chore: vérification manuelle de la détection des changements territoriaux (B7)"
```
