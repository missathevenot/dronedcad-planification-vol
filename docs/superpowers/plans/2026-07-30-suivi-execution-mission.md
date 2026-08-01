# Suivi d'exécution de mission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Suivi post levé par drone" tab to DroneDCAD Planification Vol, backed by a dedicated Supabase project, letting authenticated agents track real mission execution, treatment progress and quality control, with a small operational dashboard.

**Architecture:** New module `suivi.js` (pure mapping/calculation functions + impure Supabase calls, same split pattern as `meteo.js`). New Supabase project (PostgreSQL + Auth + RLS) holds `profils`/`missions_suivi`/`executions_vol`/`etapes_traitement`/`controles_qualite`. New nav tab wired into `index.html`/`style.css`/`app.js`, positioned last, after "Export & projet". Everything else in the app is untouched and stays fully offline; only this new tab requires network + login.

**Tech Stack:** Vanilla JS (no bundler), `@supabase/supabase-js` v2 (UMD build, vendored locally like the other libs), Supabase (PostgreSQL + Auth + Row Level Security).

**Reference design doc:** `docs/superpowers/specs/2026-07-30-suivi-execution-mission-design.md`

---

## Task 1: Provisionner le projet Supabase et le schéma de données

**This task is NOT delegated to an implementer subagent.** It requires direct access to the Supabase MCP tools and an explicit cost confirmation from the human before any resource is created. The orchestrator (you, running this plan) executes it directly.

**Files:** none (infrastructure only).

- [ ] **Step 1: Confirmer l'organisation et le coût avec l'utilisateur**

Organisation Supabase disponible (déjà vérifié en amont) : `SoroTanna` (id `khwbjblnqhczjbajbxis`), seule organisation existante. Coût de création d'un nouveau projet dans cette organisation (déjà vérifié) : **0 $/mois (offre gratuite)**.

Présenter ces deux faits à l'utilisateur et obtenir sa confirmation explicite avant de continuer, même si le coût est nul (l'outil `confirm_cost` l'exige).

- [ ] **Step 2: Confirmer le coût puis créer le projet**

Appeler `confirm_cost` avec `type: "project"`, `recurrence: "monthly"`, `amount: 0`, récupérer l'identifiant de confirmation retourné.

Appeler `create_project` avec :
- `name`: `dronedcad-suivi`
- `organization_id`: `khwbjblnqhczjbajbxis`
- `region`: `eu-west-3` (région Paris — la plus proche disponible de la Côte d'Ivoire)
- `confirm_cost_id`: l'identifiant obtenu à l'étape précédente

Le projet peut prendre quelques minutes à s'initialiser — vérifier périodiquement avec `get_project` jusqu'à ce que son statut soit actif.

- [ ] **Step 3: Appliquer le schéma SQL**

Appeler `apply_migration` avec `project_id` = l'id du projet créé, `name`: `schema_initial`, et la requête suivante :

```sql
-- Profils agents, liés à auth.users (authentification native Supabase)
create table profils (
  id            uuid primary key references auth.users(id),
  nom_complet   text not null,
  role          text not null check (role in ('telepilote','technicien_traitement','responsable','admin')),
  statut        text not null default 'actif' check (statut in ('actif','inactif')),
  created_at    timestamptz default now()
);
alter table profils enable row level security;
create policy "lecture_propre_profil" on profils for select to authenticated using (id = auth.uid());
create policy "admin_gere_profils" on profils for all to authenticated
  using (exists (select 1 from profils p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profils p where p.id = auth.uid() and p.role = 'admin'));

-- Un dossier par zone envoyée depuis DroneDCAD
create table missions_suivi (
  id                        uuid primary key default gen_random_uuid(),
  nom_zone                  text not null,
  commune                   text default '',
  date_planification        date not null,
  superficie_ha             numeric not null,
  nombre_missions_prevues   integer not null,
  agent_referent_id         uuid references profils(id),
  statut_global             text not null default 'planifiee'
                             check (statut_global in ('planifiee','en_cours','terminee')),
  donnees_planification     jsonb not null,
  historique                jsonb not null default '[]',
  created_by                uuid references profils(id),
  created_at                timestamptz default now()
);
alter table missions_suivi enable row level security;
create policy "lecture_tous_agents_actifs" on missions_suivi for select to authenticated
  using (exists (select 1 from profils p where p.id = auth.uid() and p.statut = 'actif'));
create policy "ecriture_responsable_admin" on missions_suivi for insert to authenticated
  with check (exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin')));
create policy "modification_responsable_admin" on missions_suivi for update to authenticated
  using (exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin')));

-- Un vol réellement exécuté (ou tenté) par dossier
create table executions_vol (
  id                 uuid primary key default gen_random_uuid(),
  mission_suivi_id   uuid not null references missions_suivi(id) on delete cascade,
  numero_mission     integer not null,
  statut             text not null default 'planifiee'
                      check (statut in ('planifiee','executee','reportee','incident','annulee')),
  date_reelle        date,
  duree_reelle_min   numeric,
  photos_reelles     integer,
  description_incident text default '',
  telepilote_id      uuid references profils(id),
  updated_at         timestamptz default now()
);
alter table executions_vol enable row level security;
create policy "lecture_tous_agents_actifs" on executions_vol for select to authenticated
  using (exists (select 1 from profils p where p.id = auth.uid() and p.statut = 'actif'));
create policy "creation_responsable_admin" on executions_vol for insert to authenticated
  with check (exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin')));
create policy "modification_telepilote_assigne_ou_responsable" on executions_vol for update to authenticated
  using (
    telepilote_id = auth.uid()
    or exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin'))
  );

-- Une étape de traitement photogrammétrique par dossier
create table etapes_traitement (
  id                 uuid primary key default gen_random_uuid(),
  mission_suivi_id   uuid not null references missions_suivi(id) on delete cascade,
  etape              text not null check (etape in
                      ('alignement','nuage_clairseme','nuage_dense','mns','mnt','orthophoto','modele_3d')),
  statut             text not null default 'a_faire' check (statut in ('a_faire','en_cours','terminee')),
  date_debut         date,
  date_fin           date,
  duree_reelle_min   numeric,
  taille_reelle_mo   numeric,
  technicien_id      uuid references profils(id),
  updated_at         timestamptz default now()
);
alter table etapes_traitement enable row level security;
create policy "lecture_tous_agents_actifs" on etapes_traitement for select to authenticated
  using (exists (select 1 from profils p where p.id = auth.uid() and p.statut = 'actif'));
create policy "creation_responsable_admin" on etapes_traitement for insert to authenticated
  with check (exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin')));
create policy "modification_technicien_assigne_ou_responsable" on etapes_traitement for update to authenticated
  using (
    technicien_id = auth.uid()
    or exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin'))
  );

-- Un résultat de contrôle qualité par livrable
create table controles_qualite (
  id                 uuid primary key default gen_random_uuid(),
  mission_suivi_id   uuid not null references missions_suivi(id) on delete cascade,
  livrable           text not null check (livrable in ('orthophoto','mns','mnt','nuage_points')),
  resultat           text not null check (resultat in ('conforme','rejete','a_reprendre')),
  commentaire        text default '',
  controleur_id      uuid references profils(id),
  date_controle       date not null default current_date
);
alter table controles_qualite enable row level security;
create policy "lecture_tous_agents_actifs" on controles_qualite for select to authenticated
  using (exists (select 1 from profils p where p.id = auth.uid() and p.statut = 'actif'));
create policy "creation_technicien_ou_responsable" on controles_qualite for insert to authenticated
  with check (
    controleur_id = auth.uid()
    or exists (select 1 from profils p where p.id = auth.uid() and p.role in ('responsable','admin'))
  );
```

- [ ] **Step 4: Récupérer l'URL et la clé publique du projet**

Appeler `get_project_url` puis `get_publishable_keys` avec le `project_id` du projet créé. Noter les deux valeurs — elles seront codées en dur dans `suivi.js` au Task 4.

- [ ] **Step 5: Créer le premier compte administrateur**

Demander à l'utilisateur l'email et le nom complet à utiliser pour le tout premier compte administrateur. Créer ce compte via le tableau de bord Supabase (Authentication → Add user, avec un mot de passe temporaire communiqué à l'utilisateur), puis récupérer son UUID et insérer sa ligne `profils` via `execute_sql` :

```sql
insert into profils (id, nom_complet, role, statut)
values ('<uuid-du-compte-créé>', '<nom complet>', 'admin', 'actif');
```

Ce compte est nécessaire pour créer les comptes des autres agents (télépilotes, techniciens) par la suite, via le même mécanisme.

- [ ] **Step 6: Consigner les valeurs pour les tâches suivantes**

Noter dans le contexte transmis au Task 4 : l'URL du projet Supabase et la clé publique (anon/publishable key) récupérées à l'étape 4.

- [ ] **Step 7: Corriger la récursion RLS sur `profils` (découvert lors de la vérification manuelle, Task 11)**

Le schéma du Step 3 provoque une **récursion infinie** (`infinite recursion detected in policy for relation "profils"`) dès qu'une politique RLS vérifie un rôle en interrogeant `profils` depuis une politique sur `profils` (ou, par transitivité, depuis les politiques des autres tables) — un bug qui casse toute connexion réelle à l'application (`profilConnecte()` interroge `profils` juste après chaque connexion). Appliquer ce correctif via `apply_migration` **immédiatement après le Step 3**, avant de passer au Step 4 :

```sql
create or replace function public.est_agent_actif()
returns boolean language sql security definer set search_path = public stable
as $$ select exists (select 1 from profils where id = auth.uid() and statut = 'actif'); $$;

create or replace function public.est_responsable_ou_admin()
returns boolean language sql security definer set search_path = public stable
as $$ select exists (select 1 from profils where id = auth.uid() and role in ('responsable','admin')); $$;

create or replace function public.est_admin()
returns boolean language sql security definer set search_path = public stable
as $$ select exists (select 1 from profils where id = auth.uid() and role = 'admin'); $$;

drop policy if exists "admin_gere_profils" on profils;
create policy "admin_gere_profils" on profils for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "lecture_tous_agents_actifs" on missions_suivi;
create policy "lecture_tous_agents_actifs" on missions_suivi for select to authenticated using (public.est_agent_actif());
drop policy if exists "ecriture_responsable_admin" on missions_suivi;
create policy "ecriture_responsable_admin" on missions_suivi for insert to authenticated with check (public.est_responsable_ou_admin());
drop policy if exists "modification_responsable_admin" on missions_suivi;
create policy "modification_responsable_admin" on missions_suivi for update to authenticated using (public.est_responsable_ou_admin());

drop policy if exists "lecture_tous_agents_actifs" on executions_vol;
create policy "lecture_tous_agents_actifs" on executions_vol for select to authenticated using (public.est_agent_actif());
drop policy if exists "creation_responsable_admin" on executions_vol;
create policy "creation_responsable_admin" on executions_vol for insert to authenticated with check (public.est_responsable_ou_admin());
drop policy if exists "modification_telepilote_assigne_ou_responsable" on executions_vol;
create policy "modification_telepilote_assigne_ou_responsable" on executions_vol for update to authenticated
  using (telepilote_id = auth.uid() or public.est_responsable_ou_admin());

drop policy if exists "lecture_tous_agents_actifs" on etapes_traitement;
create policy "lecture_tous_agents_actifs" on etapes_traitement for select to authenticated using (public.est_agent_actif());
drop policy if exists "creation_responsable_admin" on etapes_traitement;
create policy "creation_responsable_admin" on etapes_traitement for insert to authenticated with check (public.est_responsable_ou_admin());
drop policy if exists "modification_technicien_assigne_ou_responsable" on etapes_traitement;
create policy "modification_technicien_assigne_ou_responsable" on etapes_traitement for update to authenticated
  using (technicien_id = auth.uid() or public.est_responsable_ou_admin());

drop policy if exists "lecture_tous_agents_actifs" on controles_qualite;
create policy "lecture_tous_agents_actifs" on controles_qualite for select to authenticated using (public.est_agent_actif());
drop policy if exists "creation_technicien_ou_responsable" on controles_qualite;
create policy "creation_technicien_ou_responsable" on controles_qualite for insert to authenticated
  with check (controleur_id = auth.uid() or public.est_responsable_ou_admin());
```

Vérifié en rejouant, via SQL (`set local role authenticated; set local request.jwt.claim.sub = '<uuid>';`), le scénario d'un télépilote tentant de modifier un vol non assigné (bloqué) puis un vol assigné (autorisé), sans erreur de récursion. Voir aussi le document de conception, section « Row Level Security », pour le détail de ce correctif.

---

## Task 2: Vendoriser la librairie cliente Supabase

**Files:**
- Create: `drone-mission-app/libs/supabase.js`

- [ ] **Step 1: Télécharger le build UMD**

Run: `curl -o "drone-mission-app/libs/supabase.js" "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"`

- [ ] **Step 2: Vérifier le fichier téléchargé**

Run: `node -e "require('./drone-mission-app/libs/supabase.js'); console.log('OK')" 2>&1 | tail -5` — ce script ne doit pas planter de façon inattendue (le fichier est un UMD, il peut afficher une erreur liée à `window` non défini côté Node, ce qui est normal ; l'important est que le fichier existe et fait plusieurs centaines de Ko).

Run: `ls -la drone-mission-app/libs/supabase.js` — vérifier que le fichier fait au moins 300 Ko (une taille anormalement petite indiquerait une erreur de téléchargement, par exemple une page d'erreur HTML au lieu du script).

Ouvrir les 5 premières lignes du fichier (`head -5 drone-mission-app/libs/supabase.js`) et confirmer qu'il s'agit bien de JavaScript minifié (pas de balises HTML `<html>`/`<!DOCTYPE`).

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/libs/supabase.js
git commit -m "chore: vendor @supabase/supabase-js UMD build"
```

(Pas de test automatisé pour cette étape — fichier tiers vendorisé tel quel.)

---

## Task 3: Tests + implémentation des fonctions pures de `suivi.js`

**Files:**
- Create: `drone-mission-app/suivi.js`
- Create: `drone-mission-app/tests/suivi.test.js`

- [ ] **Step 1: Write the failing tests**

Create `drone-mission-app/tests/suivi.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Suivi = require('../suivi.js');

test('construireDossierDepuisProjet: builds the dossier row and one execution/etape row per unit', () => {
  const { dossier, executions, etapes } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone Yopougon', commune: 'Yopougon', superficieHa: 42,
    nombreMissionsPrevues: 3, agentReferentId: 'agent-1',
    donneesPlanification: { drone: {} }
  });
  assert.equal(dossier.nom_zone, 'Zone Yopougon');
  assert.equal(dossier.commune, 'Yopougon');
  assert.equal(dossier.superficie_ha, 42);
  assert.equal(dossier.nombre_missions_prevues, 3);
  assert.equal(dossier.agent_referent_id, 'agent-1');
  assert.equal(dossier.statut_global, 'planifiee');
  assert.deepEqual(dossier.donnees_planification, { drone: {} });
  assert.deepEqual(dossier.historique, []);

  assert.equal(executions.length, 3);
  assert.deepEqual(executions.map((e) => e.numero_mission), [1, 2, 3]);
  executions.forEach((e) => assert.equal(e.statut, 'planifiee'));

  assert.equal(etapes.length, 7);
  assert.deepEqual(etapes.map((e) => e.etape),
    ['alignement', 'nuage_clairseme', 'nuage_dense', 'mns', 'mnt', 'orthophoto', 'modele_3d']);
  etapes.forEach((e) => assert.equal(e.statut, 'a_faire'));
});

test('construireDossierDepuisProjet: commune defaults to empty string when not provided', () => {
  const { dossier } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone X', commune: undefined, superficieHa: 10,
    nombreMissionsPrevues: 1, agentReferentId: null, donneesPlanification: {}
  });
  assert.equal(dossier.commune, '');
});

test('mapperDossierVersJs: converts a snake_case Supabase row to a camelCase object', () => {
  const row = {
    id: 'd1', nom_zone: 'Zone A', commune: 'Cocody', date_planification: '2026-08-01',
    superficie_ha: 20, nombre_missions_prevues: 2, agent_referent_id: 'a1',
    statut_global: 'en_cours', donnees_planification: { x: 1 }, historique: [],
    created_by: 'a1', created_at: '2026-08-01T10:00:00Z'
  };
  const js = Suivi.mapperDossierVersJs(row);
  assert.equal(js.id, 'd1');
  assert.equal(js.nomZone, 'Zone A');
  assert.equal(js.commune, 'Cocody');
  assert.equal(js.datePlanification, '2026-08-01');
  assert.equal(js.superficieHa, 20);
  assert.equal(js.nombreMissionsPrevues, 2);
  assert.equal(js.agentReferentId, 'a1');
  assert.equal(js.statutGlobal, 'en_cours');
  assert.deepEqual(js.donneesPlanification, { x: 1 });
  assert.equal(js.createdBy, 'a1');
  assert.equal(js.createdAt, '2026-08-01T10:00:00Z');
});

test('mapperExecutionVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'e1', mission_suivi_id: 'd1', numero_mission: 2, statut: 'executee',
    date_reelle: '2026-08-02', duree_reelle_min: 25, photos_reelles: 180,
    description_incident: '', telepilote_id: 't1', updated_at: '2026-08-02T09:00:00Z'
  };
  const js = Suivi.mapperExecutionVersJs(row);
  assert.equal(js.missionSuiviId, 'd1');
  assert.equal(js.numeroMission, 2);
  assert.equal(js.statut, 'executee');
  assert.equal(js.dateReelle, '2026-08-02');
  assert.equal(js.dureeReelleMin, 25);
  assert.equal(js.photosReelles, 180);
  assert.equal(js.telepiloteId, 't1');
});

test('mapperEtapeVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'et1', mission_suivi_id: 'd1', etape: 'orthophoto', statut: 'en_cours',
    date_debut: '2026-08-03', date_fin: null, duree_reelle_min: 120,
    taille_reelle_mo: 4500, technicien_id: 'tech1', updated_at: '2026-08-03T08:00:00Z'
  };
  const js = Suivi.mapperEtapeVersJs(row);
  assert.equal(js.missionSuiviId, 'd1');
  assert.equal(js.etape, 'orthophoto');
  assert.equal(js.dateDebut, '2026-08-03');
  assert.equal(js.dureeReelleMin, 120);
  assert.equal(js.tailleReelleMo, 4500);
  assert.equal(js.technicienId, 'tech1');
});

test('mapperControleVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'c1', mission_suivi_id: 'd1', livrable: 'mns', resultat: 'conforme',
    commentaire: 'RAS', controleur_id: 'ctrl1', date_controle: '2026-08-04'
  };
  const js = Suivi.mapperControleVersJs(row);
  assert.equal(js.missionSuiviId, 'd1');
  assert.equal(js.livrable, 'mns');
  assert.equal(js.resultat, 'conforme');
  assert.equal(js.controleurId, 'ctrl1');
  assert.equal(js.dateControle, '2026-08-04');
});

test('calculerAvancementDossier: 0% when nothing is done', () => {
  const executions = [{ statut: 'planifiee' }, { statut: 'planifiee' }];
  const etapes = [{ statut: 'a_faire' }, { statut: 'a_faire' }];
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 0);
});

test('calculerAvancementDossier: 100% when everything executed/terminee', () => {
  const executions = [{ statut: 'executee' }, { statut: 'executee' }];
  const etapes = [{ statut: 'terminee' }];
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 100);
});

test('calculerAvancementDossier: partial completion is rounded to the nearest percent', () => {
  const executions = [{ statut: 'executee' }, { statut: 'planifiee' }];
  const etapes = [{ statut: 'a_faire' }];
  // 1 done out of 3 tasks = 33.33...% -> rounded to 33
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 33);
});

test('calculerAvancementDossier: reportee/incident/annulee do not count as done', () => {
  const executions = [{ statut: 'reportee' }, { statut: 'incident' }, { statut: 'annulee' }];
  const etapes = [];
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 0);
});

test('calculerAvancementDossier: 0% (not NaN) when there are no tasks at all', () => {
  assert.equal(Suivi.calculerAvancementDossier([], []), 0);
});

test('calculerStatsTableauDeBord: aggregates counts and volumetry across dossiers', () => {
  const dossiers = [
    {
      statutGlobal: 'terminee',
      executions: [{ statut: 'executee' }, { statut: 'incident' }],
      etapes: [{ tailleReelleMo: 1000 }, { tailleReelleMo: 500 }]
    },
    {
      statutGlobal: 'en_cours',
      executions: [{ statut: 'planifiee' }],
      etapes: [{ tailleReelleMo: 200 }]
    },
    {
      statutGlobal: 'planifiee',
      executions: [],
      etapes: []
    }
  ];
  const stats = Suivi.calculerStatsTableauDeBord(dossiers);
  assert.equal(stats.total, 3);
  assert.equal(stats.termines, 1);
  assert.equal(stats.enCours, 1);
  assert.equal(stats.incidents, 1);
  assert.equal(stats.volumetrieTotaleMo, 1700);
});

test('calculerStatsTableauDeBord: all zeros for an empty list', () => {
  const stats = Suivi.calculerStatsTableauDeBord([]);
  assert.deepEqual(stats, { total: 0, termines: 0, enCours: 0, incidents: 0, volumetrieTotaleMo: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test drone-mission-app/tests/suivi.test.js`
Expected: FAIL — `Cannot find module '../suivi.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `drone-mission-app/suivi.js`:

```js
/**
 * suivi.js
 * Suivi d'exécution des missions post-levé (vols réels, traitement, contrôle
 * qualité) et tableau de bord opérationnel. Backend Supabase dédié à ce
 * module (base de données + authentification), indépendant du reste de
 * l'application qui reste hors-ligne. Séparation pure / impure : tout ce qui
 * touche le réseau (auth.*, requêtes Supabase) est isolé dans la section
 * "Fonctions impures" en bas de fichier ; le reste est pur et testable.
 */

'use strict';

const Suivi = (() => {

  const DEFAULTS = {
    supabaseUrl: 'https://REMPLACER-PAR-URL-DU-PROJET.supabase.co',
    supabaseAnonKey: 'REMPLACER-PAR-LA-CLE-PUBLIQUE-DU-PROJET',
    etapesTraitement: ['alignement', 'nuage_clairseme', 'nuage_dense', 'mns', 'mnt', 'orthophoto', 'modele_3d'],
    livrablesQualite: ['orthophoto', 'mns', 'mnt', 'nuage_points']
  };

  // ------------------------------------------------------------------
  // Fonctions pures (testables)
  // ------------------------------------------------------------------

  /** Construit les lignes à insérer (dossier + vols + étapes) à partir d'un projet DroneDCAD. */
  function construireDossierDepuisProjet({ nomZone, commune, superficieHa, nombreMissionsPrevues, agentReferentId, donneesPlanification }) {
    const dossier = {
      nom_zone: nomZone,
      commune: commune || '',
      date_planification: new Date().toISOString().slice(0, 10),
      superficie_ha: superficieHa,
      nombre_missions_prevues: nombreMissionsPrevues,
      agent_referent_id: agentReferentId,
      statut_global: 'planifiee',
      donnees_planification: donneesPlanification,
      historique: []
    };
    const executions = [];
    for (let n = 1; n <= nombreMissionsPrevues; n++) {
      executions.push({ numero_mission: n, statut: 'planifiee' });
    }
    const etapes = DEFAULTS.etapesTraitement.map((etape) => ({ etape, statut: 'a_faire' }));
    return { dossier, executions, etapes };
  }

  function mapperDossierVersJs(row) {
    return {
      id: row.id,
      nomZone: row.nom_zone,
      commune: row.commune,
      datePlanification: row.date_planification,
      superficieHa: row.superficie_ha,
      nombreMissionsPrevues: row.nombre_missions_prevues,
      agentReferentId: row.agent_referent_id,
      statutGlobal: row.statut_global,
      donneesPlanification: row.donnees_planification,
      historique: row.historique,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

  function mapperExecutionVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      numeroMission: row.numero_mission,
      statut: row.statut,
      dateReelle: row.date_reelle,
      dureeReelleMin: row.duree_reelle_min,
      photosReelles: row.photos_reelles,
      descriptionIncident: row.description_incident,
      telepiloteId: row.telepilote_id,
      updatedAt: row.updated_at
    };
  }

  function mapperEtapeVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      etape: row.etape,
      statut: row.statut,
      dateDebut: row.date_debut,
      dateFin: row.date_fin,
      dureeReelleMin: row.duree_reelle_min,
      tailleReelleMo: row.taille_reelle_mo,
      technicienId: row.technicien_id,
      updatedAt: row.updated_at
    };
  }

  function mapperControleVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      livrable: row.livrable,
      resultat: row.resultat,
      commentaire: row.commentaire,
      controleurId: row.controleur_id,
      dateControle: row.date_controle
    };
  }

  /** % d'avancement d'un dossier = (vols exécutés + étapes terminées) / (total vols + total étapes). */
  function calculerAvancementDossier(executions, etapes) {
    const totalTaches = executions.length + etapes.length;
    if (totalTaches === 0) return 0;
    const tachesTerminees = executions.filter((e) => e.statut === 'executee').length
      + etapes.filter((e) => e.statut === 'terminee').length;
    return Math.round((tachesTerminees / totalTaches) * 100);
  }

  /** Agrège les indicateurs du tableau de bord opérationnel à partir de dossiers enrichis. */
  function calculerStatsTableauDeBord(dossiers) {
    const total = dossiers.length;
    const termines = dossiers.filter((d) => d.statutGlobal === 'terminee').length;
    const enCours = dossiers.filter((d) => d.statutGlobal === 'en_cours').length;
    const incidents = dossiers.reduce(
      (acc, d) => acc + d.executions.filter((e) => e.statut === 'incident').length, 0
    );
    const volumetrieTotaleMo = dossiers.reduce(
      (acc, d) => acc + d.etapes.reduce((a2, e) => a2 + (e.tailleReelleMo || 0), 0), 0
    );
    return { total, termines, enCours, incidents, volumetrieTotaleMo };
  }

  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs, calculerAvancementDossier, calculerStatsTableauDeBord
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Suivi;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test drone-mission-app/tests/suivi.test.js`
Expected: PASS — 14 tests green.

Also re-run the full suite to confirm no cross-contamination:
Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests total (43 existing + 14 new). If the reported count differs, what matters is 0 failures.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/suivi.js drone-mission-app/tests/suivi.test.js
git commit -m "feat: add Suivi pure data-mapping and calculation functions"
```

---

## Task 4: Implémentation des fonctions Supabase (auth + CRUD) dans `suivi.js`

**Files:**
- Modify: `drone-mission-app/suivi.js`

**Context:** use the real Supabase project URL and anon key recorded at the end of Task 1, Step 6.

- [ ] **Step 1: Replace the DEFAULTS placeholders with the real project values**

In `drone-mission-app/suivi.js`, replace:

```js
  const DEFAULTS = {
    supabaseUrl: 'https://REMPLACER-PAR-URL-DU-PROJET.supabase.co',
    supabaseAnonKey: 'REMPLACER-PAR-LA-CLE-PUBLIQUE-DU-PROJET',
```

with the real values noted at Task 1 Step 6 (keep the rest of `DEFAULTS` unchanged).

- [ ] **Step 2: Add the impure functions**

In `drone-mission-app/suivi.js`, add this section right before the final `return { ... };` statement (after `calculerStatsTableauDeBord`):

```js
  // ------------------------------------------------------------------
  // Fonctions impures (appels réseau Supabase, non testées automatiquement)
  // ------------------------------------------------------------------

  let client = null;

  /** Initialise (une seule fois) et retourne le client Supabase. */
  function initClient() {
    if (!client) client = window.supabase.createClient(DEFAULTS.supabaseUrl, DEFAULTS.supabaseAnonKey);
    return client;
  }

  function traduireErreurAuth(error) {
    if (error.message === 'Invalid login credentials') return 'Email ou mot de passe incorrect.';
    return error.message;
  }

  /** Connecte l'agent avec email/mot de passe. Lève une erreur au message traduit en cas d'échec. */
  async function connexion(email, motDePasse) {
    const { data, error } = await initClient().auth.signInWithPassword({ email, password: motDePasse });
    if (error) throw new Error(traduireErreurAuth(error));
    return data.session;
  }

  async function deconnexion() {
    await initClient().auth.signOut();
  }

  /** Retourne la session active, ou null si personne n'est connecté. */
  async function sessionActuelle() {
    const { data } = await initClient().auth.getSession();
    return data.session;
  }

  /** Récupère le profil (nom, rôle) de l'agent actuellement connecté. */
  async function profilConnecte() {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb.from('profils').select('*').eq('id', user.id).single();
    if (error) throw new Error(`Échec du chargement du profil : ${error.message}`);
    return { id: data.id, nomComplet: data.nom_complet, role: data.role, statut: data.statut };
  }

  /** Crée un dossier de suivi (et ses vols/étapes) à partir d'un projet DroneDCAD planifié. */
  async function creerDossierMission(params) {
    const { dossier, executions, etapes } = construireDossierDepuisProjet(params);
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    dossier.created_by = user ? user.id : null;

    const { data: dossierInsere, error: erreurDossier } = await sb.from('missions_suivi').insert(dossier).select().single();
    if (erreurDossier) throw new Error(`Échec de la création du dossier : ${erreurDossier.message}`);

    const executionsAvecId = executions.map((e) => ({ ...e, mission_suivi_id: dossierInsere.id }));
    const etapesAvecId = etapes.map((e) => ({ ...e, mission_suivi_id: dossierInsere.id }));

    const { error: erreurExecutions } = await sb.from('executions_vol').insert(executionsAvecId);
    if (erreurExecutions) throw new Error(`Dossier créé mais échec de la création des vols : ${erreurExecutions.message}`);

    const { error: erreurEtapes } = await sb.from('etapes_traitement').insert(etapesAvecId);
    if (erreurEtapes) throw new Error(`Dossier créé mais échec de la création des étapes de traitement : ${erreurEtapes.message}`);

    return mapperDossierVersJs(dossierInsere);
  }

  /** Liste les dossiers, avec filtres optionnels { statut, commune }. */
  async function listerDossiers(filtres = {}) {
    const sb = initClient();
    let requete = sb.from('missions_suivi').select('*').order('created_at', { ascending: false });
    if (filtres.statut) requete = requete.eq('statut_global', filtres.statut);
    if (filtres.commune) requete = requete.ilike('commune', `%${filtres.commune}%`);
    const { data, error } = await requete;
    if (error) throw new Error(`Échec du chargement des dossiers : ${error.message}`);
    return data.map(mapperDossierVersJs);
  }

  /** Récupère un dossier complet (infos + vols + étapes + contrôles qualité). */
  async function recupererDossier(id) {
    const sb = initClient();
    const [{ data: dossier, error: e1 }, { data: executions, error: e2 },
           { data: etapes, error: e3 }, { data: controles, error: e4 }] = await Promise.all([
      sb.from('missions_suivi').select('*').eq('id', id).single(),
      sb.from('executions_vol').select('*').eq('mission_suivi_id', id).order('numero_mission'),
      sb.from('etapes_traitement').select('*').eq('mission_suivi_id', id),
      sb.from('controles_qualite').select('*').eq('mission_suivi_id', id)
    ]);
    if (e1) throw new Error(`Échec du chargement du dossier : ${e1.message}`);
    if (e2 || e3 || e4) throw new Error('Échec du chargement du détail du dossier.');
    return {
      dossier: mapperDossierVersJs(dossier),
      executions: executions.map(mapperExecutionVersJs),
      etapes: etapes.map(mapperEtapeVersJs),
      controles: controles.map(mapperControleVersJs)
    };
  }

  /** Met à jour un vol. `donnees` peut contenir statut/dateReelle/dureeReelleMin/photosReelles/descriptionIncident. */
  async function mettreAJourExecutionVol(id, donnees) {
    const sb = initClient();
    const patch = { updated_at: new Date().toISOString() };
    if (donnees.statut !== undefined) patch.statut = donnees.statut;
    if (donnees.dateReelle !== undefined) patch.date_reelle = donnees.dateReelle;
    if (donnees.dureeReelleMin !== undefined) patch.duree_reelle_min = donnees.dureeReelleMin;
    if (donnees.photosReelles !== undefined) patch.photos_reelles = donnees.photosReelles;
    if (donnees.descriptionIncident !== undefined) patch.description_incident = donnees.descriptionIncident;
    const { data, error } = await sb.from('executions_vol').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour du vol : ${error.message}`);
    return mapperExecutionVersJs(data);
  }

  /** Met à jour une étape de traitement. `donnees` peut contenir statut/dateDebut/dateFin/dureeReelleMin/tailleReelleMo. */
  async function mettreAJourEtapeTraitement(id, donnees) {
    const sb = initClient();
    const patch = { updated_at: new Date().toISOString() };
    if (donnees.statut !== undefined) patch.statut = donnees.statut;
    if (donnees.dateDebut !== undefined) patch.date_debut = donnees.dateDebut;
    if (donnees.dateFin !== undefined) patch.date_fin = donnees.dateFin;
    if (donnees.dureeReelleMin !== undefined) patch.duree_reelle_min = donnees.dureeReelleMin;
    if (donnees.tailleReelleMo !== undefined) patch.taille_reelle_mo = donnees.tailleReelleMo;
    const { data, error } = await sb.from('etapes_traitement').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de l'étape : ${error.message}`);
    return mapperEtapeVersJs(data);
  }

  /** Enregistre un nouveau résultat de contrôle qualité pour un livrable. */
  async function enregistrerControleQualite(donnees) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const ligne = {
      mission_suivi_id: donnees.missionSuiviId,
      livrable: donnees.livrable,
      resultat: donnees.resultat,
      commentaire: donnees.commentaire || '',
      controleur_id: user ? user.id : null
    };
    const { data, error } = await sb.from('controles_qualite').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'enregistrement du contrôle qualité : ${error.message}`);
    return mapperControleVersJs(data);
  }

  /** Calcule les indicateurs du tableau de bord opérationnel sur l'ensemble des dossiers. */
  async function recupererTableauDeBord() {
    const sb = initClient();
    const { data: dossiers, error: e1 } = await sb.from('missions_suivi').select('*');
    if (e1) throw new Error(`Échec du chargement du tableau de bord : ${e1.message}`);
    const { data: executions, error: e2 } = await sb.from('executions_vol').select('*');
    const { data: etapes, error: e3 } = await sb.from('etapes_traitement').select('*');
    if (e2 || e3) throw new Error('Échec du chargement du tableau de bord.');
    const dossiersEnrichis = dossiers.map((d) => ({
      ...mapperDossierVersJs(d),
      executions: executions.filter((e) => e.mission_suivi_id === d.id).map(mapperExecutionVersJs),
      etapes: etapes.filter((e) => e.mission_suivi_id === d.id).map(mapperEtapeVersJs)
    }));
    return calculerStatsTableauDeBord(dossiersEnrichis);
  }
```

- [ ] **Step 3: Update the module's return statement**

Replace:

```js
  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs, calculerAvancementDossier, calculerStatsTableauDeBord
  };
})();
```

with:

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

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests, 0 failures (the new impure functions have no unit tests, matching the `recupererMeteo` precedent in `meteo.js`; they're verified manually in Task 11).

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: implement Suivi Supabase auth and CRUD functions"
```

---

## Task 5: Wiring HTML/CSS — onglet, connexion, tableau de bord, liste des dossiers

**Files:**
- Modify: `drone-mission-app/index.html`
- Modify: `drone-mission-app/style.css`

- [ ] **Step 1: Load the new module**

In `drone-mission-app/index.html`, replace:

```html
<script src="meteo.js"></script>
<script src="cartographie.js"></script>
```

with:

```html
<script src="libs/supabase.js"></script>
<script src="meteo.js"></script>
<script src="cartographie.js"></script>
```

Then, further down (near the closing of the body, alongside the other application scripts, right before `<script src="app.js"></script>`), add:

```html
<script src="suivi.js"></script>
```

(If `app.js` is the last script tag, insert the new tag on the line immediately above it.)

- [ ] **Step 2: Add the new nav tab, positioned last, after "Export & projet"**

Replace:

```html
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
```

with:

```html
      <button class="nav__item" data-target="panel-export">
        <span class="nav__ico">⭳</span> Export &amp; projet
      </button>
      <button class="nav__item" data-target="panel-suivi">
        <span class="nav__ico">📡</span> Suivi post levé par drone
      </button>
```

- [ ] **Step 3: Add the "Suivi post levé par drone" panel**

Find the closing of the `panel-export` section — it looks like:

```html
    </section>

    <!-- ============ PANEL: METEO ============ -->
```

(or, if Météo now comes before Export in the file, find the last `</section>` before the final closing tags of the panels area). Locate the closing `</section>` tag of `panel-export` specifically (the section whose opening tag is `<section id="panel-export" class="panel">`), and insert the new panel immediately after it:

```html
    <!-- ============ PANEL: SUIVI POST LEVÉ ============ -->
    <section id="panel-suivi" class="panel">

      <div id="suiviConnexionHost" class="panel-box">
        <h3>Connexion</h3>
        <div class="field"><label>Email</label><input type="email" id="suiviEmail"></div>
        <div class="field"><label>Mot de passe</label><input type="password" id="suiviMotDePasse"></div>
        <div id="suiviConnexionErreur" class="alerte alerte--danger is-hidden"></div>
        <div class="btn-row">
          <button id="btnSuiviConnexion" class="btn btn--accent">Se connecter</button>
        </div>
      </div>

      <div id="suiviContenuHost" class="is-hidden">

        <div class="panel-box">
          <div class="btn-row" style="justify-content:space-between">
            <span id="suiviUtilisateurConnecte" class="hint"></span>
            <button id="btnSuiviDeconnexion" class="btn btn--ghost">Déconnexion</button>
          </div>
        </div>

        <div class="panel-box">
          <h3>Tableau de bord opérationnel</h3>
          <div class="cards-grid">
            <div class="card"><span class="card__label">Dossiers</span><span class="card__value" id="suiviStatTotal">—</span></div>
            <div class="card"><span class="card__label">Terminés</span><span class="card__value" id="suiviStatTermines">—</span></div>
            <div class="card"><span class="card__label">En cours</span><span class="card__value" id="suiviStatEnCours">—</span></div>
            <div class="card"><span class="card__label">Vols en incident</span><span class="card__value" id="suiviStatIncidents">—</span></div>
            <div class="card"><span class="card__label">Volumétrie produite</span><span class="card__value" id="suiviStatVolumetrie">—</span></div>
          </div>
        </div>

        <div id="suiviListeHost" class="panel-box">
          <h3>Dossiers de mission</h3>
          <div class="field-row">
            <div class="field">
              <label>Statut</label>
              <select id="suiviFiltreStatut">
                <option value="">Tous</option>
                <option value="planifiee">Planifiée</option>
                <option value="en_cours">En cours</option>
                <option value="terminee">Terminée</option>
              </select>
            </div>
            <div class="field"><label>Commune</label><input type="text" id="suiviFiltreCommune" placeholder="Toutes"></div>
          </div>
          <div id="suiviListeDossiers"></div>
        </div>

        <div id="suiviDetailHost" class="is-hidden"></div>

      </div>
    </section>

```

- [ ] **Step 4: Add the CSS**

In `drone-mission-app/style.css`, replace:

```css
.badge--info{background:rgba(79,209,197,.15); color:var(--cyan);}
```

with:

```css
.badge--info{background:rgba(79,209,197,.15); color:var(--cyan);}
.badge--success{background:rgba(74,222,128,.15); color:var(--success);}
.badge--warning{background:rgba(240,168,78,.15); color:var(--amber);}
.badge--danger{background:rgba(242,84,91,.15); color:var(--danger);}
.badge--muted{background:rgba(140,160,191,.15); color:var(--muted);}
```

Then, replace:

```css
/* ---------------------------------- Cartographie ---------------------------------- */
```

with:

```css
/* ---------------------------------- Suivi post levé par drone ---------------------------------- */
.suivi-carte-dossier{
  border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:10px;
  cursor:pointer; transition:border-color .12s ease;
}
.suivi-carte-dossier:hover{border-color:var(--amber);}
.suivi-carte-dossier__ligne1{display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;}
.suivi-carte-dossier__titre{font-weight:700; color:var(--text);}
.suivi-carte-dossier__meta{font-size:.8rem; color:var(--muted);}
.suivi-sous-onglet.is-active{background:var(--panel-2); border-color:var(--amber); color:var(--amber);}
.suivi-tache-carte{
  border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:10px;
}
.suivi-tache-carte__entete{display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;}

/* ---------------------------------- Cartographie ---------------------------------- */
```

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/index.html drone-mission-app/style.css
git commit -m "feat: add Suivi post levé par drone tab, login screen, dashboard and dossier list markup"
```

(No automated test for this step — static markup/CSS with no logic. Verified visually in Task 11.)

---

## Task 6: Wiring HTML/CSS — détail d'un dossier (3 sous-onglets)

**Files:**
- Modify: `drone-mission-app/index.html`

- [ ] **Step 1: Add the dossier-detail markup**

The dossier detail view is rendered entirely by JavaScript (Task 10) into the already-existing empty `<div id="suiviDetailHost" class="is-hidden"></div>` added in Task 5 — no additional static markup is needed in `index.html` for this task. This step exists to document the expected structure the JS will inject, so the implementer of Task 10 builds exactly this:

```html
<!-- Structure injectée dynamiquement dans #suiviDetailHost par app.js -->
<div class="panel-box">
  <button id="btnSuiviRetourListe" class="btn btn--ghost">← Retour à la liste</button>
  <h3 id="suiviDetailTitre">—</h3>
  <div id="suiviDetailInfos" class="kv-list"></div>
</div>

<div class="panel-box">
  <div class="btn-row">
    <button class="btn btn--ghost suivi-sous-onglet is-active" data-sous-onglet="execution">Exécution des vols</button>
    <button class="btn btn--ghost suivi-sous-onglet" data-sous-onglet="traitement">Traitement</button>
    <button class="btn btn--ghost suivi-sous-onglet" data-sous-onglet="qualite">Contrôle qualité</button>
  </div>
</div>

<div id="suiviSousOngletExecution" class="suivi-sous-panel"></div>
<div id="suiviSousOngletTraitement" class="suivi-sous-panel is-hidden"></div>
<div id="suiviSousOngletQualite" class="suivi-sous-panel is-hidden"></div>
```

Confirm no change is needed to `index.html` for this task (the container already exists from Task 5) — mark this task's HTML step as a no-op verification rather than an edit.

- [ ] **Step 2: Verify**

Run: `grep -c "suiviDetailHost" drone-mission-app/index.html`
Expected: `1` (the empty container from Task 5 is present; nothing to add here).

No commit needed for this task — it produces no file changes, only confirms the structure that Task 10's JavaScript must produce.

---

## Task 7: `app.js` — bouton "Envoyer vers le Suivi post levé par drone"

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the button to the Export panel**

In `drone-mission-app/index.html`, find the "Projet" section of `panel-export` (containing the "💾 Sauvegarder le projet (.json)" button) and add, right after that button's closing tag:

```html
          <button id="btnEnvoyerVersSuivi" class="btn btn--ghost">📡 Envoyer vers le Suivi post levé par drone</button>
```

- [ ] **Step 2: Wire the button in `app.js`**

In `drone-mission-app/app.js`, find the météo functions block added in the previous bloc (functions `bindMeteo`, `recentrerMeteoSurZone`, etc., ending with `majMeteo`). Add this new block immediately after `majMeteo`'s closing `}` and before `majTableauMissions`:

```js
  // ------------------------------------------------------------------
  // Suivi post levé par drone — envoi d'un projet planifié
  // ------------------------------------------------------------------
  function bindEnvoiVersSuivi() {
    document.getElementById('btnEnvoyerVersSuivi').addEventListener('click', envoyerVersSuivi);
  }

  async function envoyerVersSuivi() {
    if (!Carto.getZone() || Carto.getZone().length < 3) {
      Utils.toast('Définissez une zone avant d\'envoyer vers le suivi.', 'warning');
      return;
    }
    const session = await Suivi.sessionActuelle();
    if (!session) {
      Utils.toast('Connectez-vous dans l\'onglet « Suivi post levé par drone » avant d\'envoyer un dossier.', 'warning');
      document.querySelector('.nav__item[data-target="panel-suivi"]').click();
      return;
    }
    if (!dernierResultats) {
      Utils.toast('Aucun résultat de mission calculé pour le moment.', 'warning');
      return;
    }
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
    }
  }
```

- [ ] **Step 3: Call `bindEnvoiVersSuivi()` from `init()`**

Replace:

```js
    bindScenarios();
    bindMeteo();
    initCharts();
```

with:

```js
    bindScenarios();
    bindMeteo();
    bindEnvoiVersSuivi();
    initCharts();
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests, 0 failures (this task only adds DOM-orchestration code with no automated coverage, matching `app.js`'s existing pattern; verified manually in Task 11).

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/index.html drone-mission-app/app.js
git commit -m "feat: add 'Envoyer vers le Suivi post levé par drone' button"
```

---

## Task 8: `app.js` — connexion/déconnexion et navigation de l'onglet Suivi

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the connection/navigation functions**

In `drone-mission-app/app.js`, add this block right after the block added in Task 7 (after `envoyerVersSuivi`'s closing `}`, before `majTableauMissions`):

```js
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
    try {
      await Suivi.connexion(email, motDePasse);
      await afficherContenuSuiviConnecte();
    } catch (err) {
      erreurHost.textContent = err.message;
      erreurHost.classList.remove('is-hidden');
    }
  }

  async function deconnecterSuivi() {
    await Suivi.deconnexion();
    document.getElementById('suiviEmail').value = '';
    document.getElementById('suiviMotDePasse').value = '';
    document.getElementById('suiviConnexionHost').classList.remove('is-hidden');
    document.getElementById('suiviContenuHost').classList.add('is-hidden');
  }

  async function afficherContenuSuiviConnecte() {
    document.getElementById('suiviConnexionHost').classList.add('is-hidden');
    document.getElementById('suiviContenuHost').classList.remove('is-hidden');
    const profil = await Suivi.profilConnecte();
    document.getElementById('suiviUtilisateurConnecte').textContent =
      profil ? `Connecté : ${profil.nomComplet} (${profil.role})` : 'Connecté';
    await afficherListeSuivi();
  }
```

- [ ] **Step 2: Call `bindSuivi()` and `initialiserOngletSuivi()` from `init()`**

Replace:

```js
    bindScenarios();
    bindMeteo();
    bindEnvoiVersSuivi();
    initCharts();
```

with:

```js
    bindScenarios();
    bindMeteo();
    bindEnvoiVersSuivi();
    bindSuivi();
    initialiserOngletSuivi();
    initCharts();
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests, 0 failures. (`afficherListeSuivi`, called above, is defined in Task 9 — this is expected; the test suite does not execute `app.js` in a browser context, so this forward reference does not cause a test failure. It will be resolved before Task 11's manual verification.)

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: add Suivi login/logout flow and tab initialization"
```

---

## Task 9: `app.js` — liste des dossiers et tableau de bord

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the list-rendering and dashboard functions**

In `drone-mission-app/app.js`, add this block right after the block added in Task 8 (after `afficherContenuSuiviConnecte`'s closing `}`, before `majTableauMissions`):

```js
  const LIBELLES_STATUT_DOSSIER = { planifiee: 'Planifiée', en_cours: 'En cours', terminee: 'Terminée' };
  const BADGE_STATUT_DOSSIER = { planifiee: 'muted', en_cours: 'warning', terminee: 'success' };

  function bindFiltresSuivi() {
    document.getElementById('suiviFiltreStatut').addEventListener('change', afficherListeSuivi);
    document.getElementById('suiviFiltreCommune').addEventListener('input', Utils.debounce(afficherListeSuivi, 300));
  }

  async function afficherListeSuivi() {
    document.getElementById('suiviDetailHost').classList.add('is-hidden');
    document.getElementById('suiviListeHost').classList.remove('is-hidden');
    await Promise.all([majTableauDeBordSuivi(), rafraichirListeDossiers()]);
  }

  async function majTableauDeBordSuivi() {
    try {
      const stats = await Suivi.recupererTableauDeBord();
      document.getElementById('suiviStatTotal').textContent = stats.total;
      document.getElementById('suiviStatTermines').textContent = stats.termines;
      document.getElementById('suiviStatEnCours').textContent = stats.enCours;
      document.getElementById('suiviStatIncidents').textContent = stats.incidents;
      document.getElementById('suiviStatVolumetrie').textContent = Utils.fmtBytes(stats.volumetrieTotaleMo * 1024 * 1024);
    } catch (err) {
      Utils.toast(`Échec du chargement du tableau de bord : ${err.message}`, 'danger');
    }
  }

  async function rafraichirListeDossiers() {
    const hote = document.getElementById('suiviListeDossiers');
    try {
      const filtres = {
        statut: document.getElementById('suiviFiltreStatut').value,
        commune: document.getElementById('suiviFiltreCommune').value.trim()
      };
      const dossiers = await Suivi.listerDossiers(filtres);
      if (dossiers.length === 0) {
        hote.innerHTML = '<p class="hint">Aucun dossier pour ces filtres.</p>';
        return;
      }
      hote.innerHTML = dossiers.map((d) => `
        <div class="suivi-carte-dossier" data-id="${d.id}">
          <div class="suivi-carte-dossier__ligne1">
            <span class="suivi-carte-dossier__titre">${d.nomZone}</span>
            <span class="badge badge--${BADGE_STATUT_DOSSIER[d.statutGlobal]}">${LIBELLES_STATUT_DOSSIER[d.statutGlobal]}</span>
          </div>
          <div class="suivi-carte-dossier__meta">${d.commune || 'Commune non renseignée'} · ${d.datePlanification} · ${d.superficieHa} ha</div>
        </div>
      `).join('');
      hote.querySelectorAll('.suivi-carte-dossier').forEach((carte) => {
        carte.addEventListener('click', () => afficherDetailSuivi(carte.dataset.id));
      });
    } catch (err) {
      hote.innerHTML = '';
      Utils.toast(`Échec du chargement des dossiers : ${err.message}`, 'danger');
    }
  }
```

- [ ] **Step 2: Call `bindFiltresSuivi()` from `init()`**

Replace:

```js
    bindEnvoiVersSuivi();
    bindSuivi();
    initialiserOngletSuivi();
    initCharts();
```

with:

```js
    bindEnvoiVersSuivi();
    bindSuivi();
    bindFiltresSuivi();
    initialiserOngletSuivi();
    initCharts();
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests, 0 failures. (`afficherDetailSuivi`, referenced above, is defined in Task 10 — same forward-reference situation as Task 8, resolved before Task 11.)

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: add Suivi dossier list, filters and operational dashboard rendering"
```

---

## Task 10: `app.js` — détail d'un dossier et mises à jour de statut

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Add the dossier-detail rendering and update-form functions**

In `drone-mission-app/app.js`, add this block right after the block added in Task 9 (after `rafraichirListeDossiers`'s closing `}`, before `majTableauMissions`):

```js
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

  function bindSousOngletsSuivi() {
    document.querySelectorAll('.suivi-sous-onglet').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.suivi-sous-onglet').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const cible = btn.dataset.sousOnglet;
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
        <h3 id="suiviDetailTitre">${dossier.nomZone}</h3>
        <div id="suiviDetailInfos" class="kv-list">
          <div><span>Commune</span><b>${dossier.commune || '—'}</b></div>
          <div><span>Superficie</span><b>${dossier.superficieHa} ha</b></div>
          <div><span>Statut global</span><b>${LIBELLES_STATUT_DOSSIER[dossier.statutGlobal]}</b></div>
          <div><span>Avancement</span><b>${avancement} %</b></div>
        </div>
      </div>

      <div class="panel-box">
        <div class="btn-row">
          <button class="btn btn--ghost suivi-sous-onglet is-active" data-sous-onglet="execution">Exécution des vols</button>
          <button class="btn btn--ghost suivi-sous-onglet" data-sous-onglet="traitement">Traitement</button>
          <button class="btn btn--ghost suivi-sous-onglet" data-sous-onglet="qualite">Contrôle qualité</button>
        </div>
      </div>

      <div id="suiviSousOngletExecution" class="suivi-sous-panel">${rendreCartesExecutions(executions)}</div>
      <div id="suiviSousOngletTraitement" class="suivi-sous-panel is-hidden">${rendreCartesEtapes(etapes)}</div>
      <div id="suiviSousOngletQualite" class="suivi-sous-panel is-hidden">${rendreCartesQualite(controles)}</div>
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
        <div class="field"><label>Incident (si applicable)</label><textarea class="suivi-vol-incident" rows="2">${e.descriptionIncident || ''}</textarea></div>
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
        <p class="hint">${c.commentaire || 'Aucun commentaire.'} — ${c.dateControle}</p>
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
      carte.querySelector('.suivi-vol-enregistrer').addEventListener('click', async () => {
        const id = carte.dataset.executionId;
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
        }
      });
    });

    document.querySelectorAll('[data-etape-id]').forEach((carte) => {
      carte.querySelector('.suivi-etape-enregistrer').addEventListener('click', async () => {
        const id = carte.dataset.etapeId;
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
        }
      });
    });

    const btnQualite = document.getElementById('btnSuiviEnregistrerQualite');
    if (btnQualite) {
      btnQualite.addEventListener('click', async () => {
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
        }
      });
    }
  }
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 57 tests, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: add Suivi dossier detail view with vol/étape/qualité update forms"
```

---

## Task 11: Vérification manuelle en navigateur

**Files:** none (verification only).

- [ ] **Step 1: Créer 2-3 comptes de test supplémentaires**

En plus du compte admin créé au Task 1, utiliser ce compte admin pour créer (via le tableau de bord Supabase Authentication, comme au Task 1 Step 5) un compte `telepilote` et un compte `technicien_traitement`, avec une ligne `profils` correspondante pour chacun (`role: 'telepilote'` / `role: 'technicien_traitement'`, `statut: 'actif'`).

- [ ] **Step 2: Serve the app locally**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 3: Vérifier l'écran de connexion et la non-régression du reste de l'app**

Ouvrir `http://localhost:8080`. Confirmer l'absence d'erreur console. Confirmer que tous les onglets existants (Tableau de bord, Zone & paramètres, Cartographie, Missions & scénarios, Estimation des traitements, Conditions météo, Export & projet) fonctionnent exactement comme avant, sans connexion. Cliquer sur le nouvel onglet "Suivi post levé par drone" (positionné en dernier) : confirmer l'affichage de l'écran de connexion.

- [ ] **Step 4: Tester une connexion invalide puis valide**

Tenter une connexion avec des identifiants invalides : confirmer l'affichage d'un message d'erreur clair. Se connecter avec le compte `responsable`/admin créé au Task 1 : confirmer l'affichage du contenu authentifié (nom + rôle affichés, tableau de bord à 0 partout, liste vide).

- [ ] **Step 5: Tester l'envoi d'un projet vers le suivi**

Aller dans "Zone & paramètres", générer une zone de test. Aller dans "Export & projet", cliquer sur "Envoyer vers le Suivi post levé par drone". Confirmer un toast de succès. Retourner dans l'onglet Suivi : confirmer que le nouveau dossier apparaît dans la liste et que le tableau de bord s'est mis à jour (1 dossier, statut "Planifiée").

- [ ] **Step 6: Tester la mise à jour d'un vol, d'une étape et d'un contrôle qualité**

Cliquer sur le dossier créé. Dans "Exécution des vols", changer le statut d'un vol en "Exécutée" avec une date/durée/nombre de photos, cliquer "Enregistrer" : confirmer la mise à jour du badge et de l'avancement affiché. Faire de même dans "Traitement" pour une étape (statut "Terminée" avec une taille produite). Dans "Contrôle qualité", enregistrer un contrôle "Conforme" sur un livrable : confirmer son apparition dans l'historique. Retourner au tableau de bord : confirmer que les indicateurs (terminés/en cours/volumétrie) reflètent ces changements.

- [ ] **Step 7: Tester le contrôle d'accès par rôle**

Se déconnecter, se connecter avec le compte `telepilote` créé à l'étape 1. Confirmer qu'il peut consulter tous les dossiers mais que toute tentative de modification d'un vol qui ne lui est pas assigné (`telepilote_id` différent du sien) échoue proprement (toast d'erreur, pas de plantage) — c'est la politique RLS qui bloque, pas une vérification côté client.

- [ ] **Step 8: Tester la gestion d'erreur réseau**

Couper la connexion réseau (mode avion ou DevTools → Network → Offline), tenter une action dans l'onglet Suivi (rafraîchir la liste, mettre à jour un vol) : confirmer un toast d'erreur clair, pas de plantage, et que les autres onglets de l'application restent pleinement utilisables hors-ligne.

- [ ] **Step 9: Régression-check unrelated features**

Confirmer que le dashboard, l'onglet batteries, l'estimation des traitements, le tableau des missions, les exports (PDF/Excel/CSV/KML), la sauvegarde/rechargement de projet, et le comportement PWA hors-ligne (service worker toujours enregistré) sont inchangés.

- [ ] **Step 10: Run the full automated suite one last time**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — all tests green (57, or the actual reported count — 0 failures is what matters).

- [ ] **Step 11: Final commit**

```bash
git add -A
git commit -m "chore: manual verification pass for Suivi post levé par drone module"
```

(Only commit if verification uncovered fixes; if nothing changed, skip this step.)
