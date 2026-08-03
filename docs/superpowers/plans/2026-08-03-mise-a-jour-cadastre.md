# Mise à jour du cadastre (B8, Groupe 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "officialize a detected change into a cadastral object" to the existing "Détection des changements" sub-tab, plus a new 6th "Mise à jour du cadastre" sub-tab in Suivi that shows the registry of cadastral objects (parcels/buildings) created this way, with a validation status and a history log.

**Architecture:** Two new Supabase tables (`objets_cadastraux`, `historique_objets_cadastraux`), public RLS from creation (no authentication in this module). `suivi.js` gains pure mapper functions and impure CRUD, following its existing pure/impure split. `app.js` adds an "Officialiser" action inline on each change card in the existing B7 list (`renderListeChangements`), and a new 6th sub-tab whose registry loader (`chargerRegistreCadastre`) follows the same self-contained "re-render everything on every call" pattern already used successfully by `chargerRegistreAnomalies` (Contrôle qualité, Groupe 1) — not the map-drawing pattern from B7's `bindFormulaireChangements`/`rafraichirChangements` split, which only exists because that feature has a persistent Leaflet map instance outside the refreshed list. B8 has no map, so there is no listener-accumulation risk to guard against here: `chargerRegistreCadastre` can safely replace its own container's `innerHTML` (including all buttons) on every call, exactly like `chargerRegistreAnomalies` already does.

**Tech Stack:** Vanilla JS, Supabase (Postgres + RLS), `node:test`.

**Design doc:** `docs/superpowers/specs/2026-08-03-mise-a-jour-cadastre-design.md`

---

## Task 1: Provisionner le schéma Supabase (tables + RLS publique)

**Files:** none (exécuté directement via l'outil Supabase par l'orchestrateur, pas par un agent — même pattern que les tranches précédentes).

- [ ] **Step 1: Créer les tables `objets_cadastraux` et `historique_objets_cadastraux`**

```sql
create table objets_cadastraux (
  id uuid primary key default gen_random_uuid(),
  mission_suivi_id uuid not null references missions_suivi(id) on delete cascade,
  changement_id uuid references changements_territoriaux(id),
  type text not null check (type in ('parcelle', 'batiment')),
  reference text not null,
  geometrie jsonb not null,
  description text default '',
  statut text not null default 'en_attente' check (statut in ('en_attente', 'valide', 'rejete')),
  date_creation date not null default current_date
);
alter table objets_cadastraux enable row level security;
create policy "acces_public_sans_authentification" on objets_cadastraux for all to public using (true) with check (true);

create table historique_objets_cadastraux (
  id uuid primary key default gen_random_uuid(),
  objet_cadastral_id uuid not null references objets_cadastraux(id) on delete cascade,
  date_evenement date not null default current_date,
  description text not null,
  nouveau_statut text check (nouveau_statut in ('en_attente', 'valide', 'rejete'))
);
alter table historique_objets_cadastraux enable row level security;
create policy "acces_public_sans_authentification" on historique_objets_cadastraux for all to public using (true) with check (true);
```

- [ ] **Step 2: Vérifier l'absence de nouvelle alerte de sécurité inattendue**

Confirmer via `get_advisors(type: security)` que les seules nouvelles alertes concernant ces deux tables sont les warnings `rls_policy_always_true` attendus (accès public volontaire, comme les 12 tables précédentes du module Suivi) — aucune alerte d'un autre type.

---

## Task 2: Fonctions pures — mappers

**Files:**
- Modify: `drone-mission-app/suivi.js`
- Test: `drone-mission-app/tests/suivi.test.js`

- [ ] **Step 1: Ajouter les fonctions pures**

Dans `drone-mission-app/suivi.js`, juste après `calculerStatsChangements` (qui se termine par `return { total: changements.length, parType, parPriorite };\n  }`) et avant le commentaire `// Fonctions impures`, ajouter :

```js

  /** Convertit une ligne Supabase (snake_case) `objets_cadastraux` en objet JS (camelCase). */
  function mapperObjetCadastralVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      changementId: row.changement_id,
      type: row.type,
      reference: row.reference,
      geometrie: row.geometrie,
      description: row.description,
      statut: row.statut,
      dateCreation: row.date_creation
    };
  }

  /** Convertit une ligne Supabase (snake_case) `historique_objets_cadastraux` en objet JS (camelCase). */
  function mapperHistoriqueCadastralVersJs(row) {
    return {
      id: row.id,
      objetCadastralId: row.objet_cadastral_id,
      dateEvenement: row.date_evenement,
      description: row.description,
      nouveauStatut: row.nouveau_statut
    };
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Dans le `return { ... }` en fin de fichier, remplacer :

```js
    mapperChangementVersJs, filtrerChangements, calculerStatsChangements,
```

par :

```js
    mapperChangementVersJs, filtrerChangements, calculerStatsChangements,
    mapperObjetCadastralVersJs, mapperHistoriqueCadastralVersJs,
```

- [ ] **Step 3: Tests**

Ajouter à la fin de `drone-mission-app/tests/suivi.test.js` :

```js
test('mapperObjetCadastralVersJs: convertit une ligne objets_cadastraux', () => {
  const js = Suivi.mapperObjetCadastralVersJs({
    id: 'oc1', mission_suivi_id: 'm1', changement_id: 'ch1', type: 'parcelle',
    reference: 'P-2026-014', geometrie: [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]],
    description: 'Parcelle issue du changement', statut: 'en_attente', date_creation: '2026-08-03'
  });
  assert.strictEqual(js.type, 'parcelle');
  assert.strictEqual(js.reference, 'P-2026-014');
  assert.strictEqual(js.changementId, 'ch1');
  assert.strictEqual(js.statut, 'en_attente');
  assert.deepStrictEqual(js.geometrie, [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]]);
});

test('mapperHistoriqueCadastralVersJs: convertit une ligne historique_objets_cadastraux', () => {
  const js = Suivi.mapperHistoriqueCadastralVersJs({
    id: 'h1', objet_cadastral_id: 'oc1', date_evenement: '2026-08-03',
    description: 'Objet créé à partir du changement officialisé.', nouveau_statut: 'en_attente'
  });
  assert.strictEqual(js.objetCadastralId, 'oc1');
  assert.strictEqual(js.description, 'Objet créé à partir du changement officialisé.');
  assert.strictEqual(js.nouveauStatut, 'en_attente');
});
```

- [ ] **Step 4: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS, 81 tests (79 existants + 2 nouveaux), 0 échec.

```bash
git add drone-mission-app/suivi.js drone-mission-app/tests/suivi.test.js
git commit -m "feat: fonctions pures pour les objets cadastraux (mappers)"
```

---

## Task 3: CRUD Supabase — objets cadastraux et historique

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Ajouter les fonctions impures**

Dans `drone-mission-app/suivi.js`, juste avant `return { ... }` en fin de fichier (après `supprimerChangement`), ajouter :

```js

  /** Liste les objets cadastraux d'un dossier. */
  async function listerObjetsCadastraux(missionSuiviId) {
    const sb = initClient();
    const { data, error } = await sb.from('objets_cadastraux').select('*').eq('mission_suivi_id', missionSuiviId).order('date_creation', { ascending: false });
    if (error) throw new Error(`Échec du chargement des objets cadastraux : ${error.message}`);
    return data.map(mapperObjetCadastralVersJs);
  }

  /** Officialise un changement territorial en objet cadastral (parcelle ou bâtiment), avec sa première entrée d'historique. */
  async function officialiserChangement(changementId, missionSuiviId, donnees) {
    const sb = initClient();
    const ligne = {
      mission_suivi_id: missionSuiviId,
      changement_id: changementId,
      type: donnees.type,
      reference: donnees.reference,
      geometrie: donnees.geometrie,
      description: donnees.description || ''
    };
    const { data, error } = await sb.from('objets_cadastraux').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'officialisation : ${error.message}`);
    const { error: erreurHistorique } = await sb.from('historique_objets_cadastraux').insert({
      objet_cadastral_id: data.id,
      description: 'Objet créé à partir du changement officialisé.',
      nouveau_statut: 'en_attente'
    });
    if (erreurHistorique) {
      const err = new Error(`Objet cadastral créé mais échec de l'historique : ${erreurHistorique.message}`);
      err.objetCadastralId = data.id;
      throw err;
    }
    return mapperObjetCadastralVersJs(data);
  }

  /** Liste l'historique d'un objet cadastral. */
  async function listerHistoriqueObjetCadastral(objetCadastralId) {
    const sb = initClient();
    const { data, error } = await sb.from('historique_objets_cadastraux').select('*').eq('objet_cadastral_id', objetCadastralId).order('date_evenement', { ascending: false });
    if (error) throw new Error(`Échec du chargement de l'historique : ${error.message}`);
    return data.map(mapperHistoriqueCadastralVersJs);
  }

  /** Met à jour le statut d'un objet cadastral et ajoute une entrée à son historique. */
  async function mettreAJourStatutObjetCadastral(id, nouveauStatut, description) {
    const sb = initClient();
    const { error: erreurMaj } = await sb.from('objets_cadastraux').update({ statut: nouveauStatut }).eq('id', id);
    if (erreurMaj) throw new Error(`Échec de la mise à jour du statut : ${erreurMaj.message}`);
    const { error: erreurHistorique } = await sb.from('historique_objets_cadastraux').insert({
      objet_cadastral_id: id,
      description,
      nouveau_statut: nouveauStatut
    });
    if (erreurHistorique) throw new Error(`Statut mis à jour mais échec de l'historique : ${erreurHistorique.message}`);
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Remplacer la dernière ligne du `return { ... }` :

```js
    listerChangements, enregistrerChangement, supprimerChangement
  };
```

par :

```js
    listerChangements, enregistrerChangement, supprimerChangement,
    listerObjetsCadastraux, officialiserChangement, listerHistoriqueObjetCadastral, mettreAJourStatutObjetCadastral
  };
```

- [ ] **Step 3: Lancer les tests (pas de nouveau test — fonctions impures, non testées automatiquement, cohérent avec le reste du fichier)**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 81 tests, 0 échec.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: CRUD Supabase pour les objets cadastraux et leur historique"
```

---

## Task 4: `app.js` — bouton "Officialiser en objet cadastral" dans le sous-onglet B7

**Files:**
- Modify: `drone-mission-app/app.js`

**Contexte :** cette tâche modifie `renderListeChangements` et `rafraichirChangements`, déjà en place depuis B7. Elle référence `chargerRegistreCadastre`, ajoutée seulement à la Task 7 — dangling reference acceptée dans l'intervalle (état intermédiaire déjà utilisé plusieurs fois dans le plan de B7), sans impact sur les tests Node.

- [ ] **Step 1: Faire connaître à `rafraichirChangements` les changements déjà officialisés**

Remplacer :

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

par :

```js
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
```

- [ ] **Step 2: Ajouter le bouton/formulaire d'officialisation et son état "déjà officialisé" dans chaque carte**

Remplacer :

```js
  function renderListeChangements(hoteListe, changements, filtres = changementsFiltresActuels) {
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

par :

```js
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
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 81 tests, 0 échec.

```bash
git add drone-mission-app/app.js
git commit -m "feat: bouton d'officialisation d'un changement en objet cadastral (sous-onglet Détection des changements)"
```

---

## Task 5: `app.js` — intégrer le 6e sous-onglet "Mise à jour du cadastre"

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Ajouter le bouton de sous-onglet et le panneau dans `majAffichageDetailSuivi`**

Remplacer :

```js
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

par :

```js
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
```

- [ ] **Step 2: Basculer la visibilité du 6e panneau dans `bindSousOngletsSuivi`**

Remplacer :

```js
        document.getElementById('suiviSousOngletChangements').classList.toggle('is-hidden', cible !== 'changements');
      });
    });
  }
```

par :

```js
        document.getElementById('suiviSousOngletChangements').classList.toggle('is-hidden', cible !== 'changements');
        document.getElementById('suiviSousOngletCadastre').classList.toggle('is-hidden', cible !== 'cadastre');
      });
    });
  }
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 81 tests, 0 échec. `rendreSousOngletCadastre` n'existe pas encore (ajoutée à la Task 6) — dangling reference acceptée, sans impact sur les tests Node (`app.js` n'est requis par aucun test).

```bash
git add drone-mission-app/app.js
git commit -m "feat: intégrer le 6e sous-onglet Mise à jour du cadastre dans Suivi"
```

---

## Task 6: `app.js` — rendu du sous-onglet cadastre

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Ajouter les libellés/badges**

Juste après la ligne :

```js
  const BADGE_PRIORITE_CHANGEMENT = { faible: 'success', moyenne: 'warning', haute: 'danger' };
```

ajouter :

```js
  const LIBELLES_TYPE_OBJET_CADASTRAL = { parcelle: 'Parcelle', batiment: 'Bâtiment' };
  const LIBELLES_STATUT_CADASTRAL = { en_attente: 'En attente', valide: 'Validé', rejete: 'Rejeté' };
  const BADGE_STATUT_CADASTRAL = { en_attente: 'muted', valide: 'success', rejete: 'danger' };
```

- [ ] **Step 2: Ajouter `rendreSousOngletCadastre`**

Juste après la fin de la fonction `rendreSousOngletChangements` (juste avant `function rendreSousOngletPlanification`), ajouter :

```js
  function rendreSousOngletCadastre(dossier) {
    return `
      <div class="panel-box" data-cadastre-liste="${dossier.id}">
        <h3>Objets cadastraux</h3>
        <p class="hint">Chargement…</p>
      </div>
    `;
  }
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 81 tests, 0 échec.

```bash
git add drone-mission-app/app.js
git commit -m "feat: rendu du sous-onglet Mise à jour du cadastre"
```

---

## Task 7: `app.js` — registre des objets cadastraux (liste, statut, historique) et câblage initial

**Files:**
- Modify: `drone-mission-app/app.js`

**Contexte :** `chargerRegistreCadastre` suit le pattern de `chargerRegistreAnomalies` (Contrôle qualité, Groupe 1) : elle re-fetch tout, reconstruit tout son `innerHTML` (y compris les boutons) et rebranche tous les écouteurs à chaque appel — sûr par construction puisque le conteneur entier est remplacé à chaque fois. Cette tâche résout aussi la dangling reference laissée par la Task 4 (`chargerRegistreCadastre`).

- [ ] **Step 1: Ajouter `chargerRegistreCadastre`**

Après la fonction `chargerDossiersReferencePourChangements`, ajouter :

```js
  async function chargerRegistreCadastre(dossierId) {
    const hote = document.querySelector(`[data-cadastre-liste="${dossierId}"]`);
    if (!hote) return;
    try {
      const objets = await Suivi.listerObjetsCadastraux(dossierId);
      const historiques = await Promise.all(objets.map((o) => Suivi.listerHistoriqueObjetCadastral(o.id)));
      hote.innerHTML = `
        <h3>Objets cadastraux</h3>
        ${objets.length === 0 ? '<p class="hint">Aucun objet cadastral pour ce dossier. Officialisez un changement depuis le sous-onglet Détection des changements.</p>' : objets.map((o, i) => `
          <div class="suivi-tache-carte" data-objet-cadastral-id="${o.id}">
            <div class="suivi-tache-carte__entete">
              <b>${LIBELLES_TYPE_OBJET_CADASTRAL[o.type]} — ${Utils.escapeHtml(o.reference)}</b>
              <span class="badge badge--${BADGE_STATUT_CADASTRAL[o.statut]}">${LIBELLES_STATUT_CADASTRAL[o.statut]}</span>
            </div>
            <p class="hint">${Utils.escapeHtml(o.description) || 'Aucune description.'} — ${o.dateCreation}</p>
            <div class="field-row">
              <div class="field"><label>Statut</label>
                <select class="suivi-cadastre-statut">
                  ${Object.keys(LIBELLES_STATUT_CADASTRAL).map((v) => `<option value="${v}" ${v === o.statut ? 'selected' : ''}>${LIBELLES_STATUT_CADASTRAL[v]}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Description</label><input type="text" class="suivi-cadastre-description" placeholder="Décrire la modification"></div>
            </div>
            <button class="btn btn--accent suivi-cadastre-enregistrer">Enregistrer</button>
            <h4 class="mt">Historique</h4>
            ${historiques[i].length === 0 ? '<p class="hint">Aucun événement enregistré.</p>' : historiques[i].map((h) => `
              <p class="hint">${h.dateEvenement} — ${Utils.escapeHtml(h.description)}${h.nouveauStatut ? ` (${LIBELLES_STATUT_CADASTRAL[h.nouveauStatut]})` : ''}</p>
            `).join('')}
          </div>
        `).join('')}
      `;
      hote.querySelectorAll('.suivi-cadastre-enregistrer').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const carte = btn.closest('[data-objet-cadastral-id]');
          const id = carte.dataset.objetCadastralId;
          const nouveauStatut = carte.querySelector('.suivi-cadastre-statut').value;
          const description = carte.querySelector('.suivi-cadastre-description').value.trim();
          if (!description) {
            Utils.toast('Décrivez la modification avant d\'enregistrer.', 'warning');
            return;
          }
          btn.disabled = true;
          try {
            await Suivi.mettreAJourStatutObjetCadastral(id, nouveauStatut, description);
            Utils.toast('Objet cadastral mis à jour.', 'success');
            await chargerRegistreCadastre(dossierId);
          } catch (err) {
            Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      hote.innerHTML = `<h3>Objets cadastraux</h3><p class="hint">Échec du chargement : ${Utils.escapeHtml(err.message)}</p>`;
      Utils.toast(`Échec du chargement des objets cadastraux : ${err.message}`, 'danger');
    }
  }
```

- [ ] **Step 2: Câbler le chargement initial dans `bindFormulairesDetailSuivi`**

Remplacer :

```js
    document.querySelectorAll('[data-changements-liste]').forEach((hote) => {
      const [dossierId, zoneId] = hote.dataset.changementsListe.split(':');
      chargerListeEtCarteChangements(dossierId, zoneId || null, hote);
    });
```

par :

```js
    document.querySelectorAll('[data-changements-liste]').forEach((hote) => {
      const [dossierId, zoneId] = hote.dataset.changementsListe.split(':');
      chargerListeEtCarteChangements(dossierId, zoneId || null, hote);
    });

    document.querySelectorAll('[data-cadastre-liste]').forEach((hote) => {
      chargerRegistreCadastre(hote.dataset.cadastreListe);
    });
```

- [ ] **Step 3: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 81 tests, 0 échec. La dangling reference de la Task 4 est maintenant résolue.

```bash
git add drone-mission-app/app.js
git commit -m "feat: registre des objets cadastraux (statut, historique) et chargement initial"
```

---

## Task 8: Vérification manuelle complète en navigateur

**Files:** none (verification only).

- [ ] **Step 1: Servir l'app localement**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 2: Ouvrir un dossier ayant au moins un changement territorial enregistré**

Se rendre dans Suivi, ouvrir un dossier de zone. S'il n'a aucun changement, en créer un rapidement dans le sous-onglet "Détection des changements" (dessiner un polygone, l'enregistrer) pour pouvoir tester l'officialisation — le nettoyer à la fin (Step 8).

- [ ] **Step 3: Officialiser un changement**

Dans "Détection des changements", cliquer "Officialiser en objet cadastral" sur un changement : le formulaire (type/référence/description) apparaît. Laisser la référence vide et confirmer : message d'erreur, pas de création. Remplir une référence, confirmer : toast de succès, le changement affiche désormais le badge "Déjà officialisé" à la place du bouton.

- [ ] **Step 4: Vérifier le registre du sous-onglet "Mise à jour du cadastre"**

Ouvrir le nouveau sous-onglet : l'objet cadastral créé apparaît (type, référence, statut "En attente", description, une entrée d'historique "Objet créé à partir du changement officialisé.").

- [ ] **Step 5: Changer le statut et vérifier l'historique**

Choisir "Validé" dans le sélecteur de statut, laisser la description vide, cliquer Enregistrer : message d'erreur, pas de mise à jour. Remplir une description, cliquer Enregistrer : toast de succès, le badge de statut passe à "Validé", une nouvelle entrée apparaît dans l'historique avec la description saisie et le nouveau statut entre parenthèses.

- [ ] **Step 6: Vérifier la synchronisation entre les deux sous-onglets**

Retourner dans "Détection des changements" : le changement officialisé affiche toujours "Déjà officialisé" (pas de double officialisation possible via l'interface).

- [ ] **Step 7: Régression sur le reste de l'application**

Confirmer que les 4 premiers sous-onglets de Suivi (Planification, Acquisition, Traitement, Contrôle qualité) et le reste de l'application (Zone & Cartographie, Paramètres, Missions, Météo, Traitements, Export) fonctionnent comme avant cette tranche.

- [ ] **Step 8: Nettoyer les données de test**

Si des données de test ont été créées (dossier, changement, objet cadastral, historique), les supprimer via l'outil Supabase MCP (`execute_sql` avec `delete from ... where id = '...'`) en respectant l'ordre des clés étrangères (historique_objets_cadastraux → objets_cadastraux → changements_territoriaux → missions_suivi). Aucun bouton de suppression n'existe dans l'interface pour objets_cadastraux/historique_objets_cadastraux dans ce périmètre.

- [ ] **Step 9: Suite automatisée finale**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 81 tests, 0 échec.

- [ ] **Step 10: Commit final (si des corrections ont été nécessaires)**

```bash
git add -A
git commit -m "chore: vérification manuelle de la mise à jour du cadastre (B8)"
```
