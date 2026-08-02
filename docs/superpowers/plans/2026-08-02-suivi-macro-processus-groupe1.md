# Suivi post levé par drone — sous-menus macro-processus Groupe 1 (B1-B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the "Suivi post levé par drone" tab so it is organized by macro-processus (Planification, Acquisition, Traitement, Contrôle qualité) instead of a flat dossier list + operational dashboard, scoped to a zone from the shared zone library, with real document management and multi-entry registries per macro-processus.

**Architecture:** Extend the existing 4 Supabase tables (`missions_suivi`, `executions_vol`, `etapes_traitement`, `controles_qualite`) with new columns and 6 new child tables (`mission_equipe`, `autorisations_mission`, `registre_incidents_vol`, `registre_anomalies_qualite`, `historique_corrections`, `pieces_jointes`) plus a Storage bucket for files. `suivi.js` gains pure mapper/calculation functions and impure CRUD functions following its existing pure/impure split. `app.js` replaces the flat dossier-list navigation with a zone-first selector (reusing the `Zones` module from Chantier A) and extends the existing dossier-detail sub-tab pattern (`suiviSousOngletExecution/Traitement/Qualite`) with a 4th "Planification" sub-tab.

**Tech Stack:** Vanilla JS, Supabase (Postgres + Auth + Storage + RLS), `node:test`.

---

## Task 1: Provisionner le schéma Supabase (colonnes, tables, RLS, bucket Storage)

**Files:** none (exécuté directement via l'outil Supabase par l'orchestrateur, pas par un agent — action ponctuelle sur le schéma de production, même pattern que les tranches précédentes).

- [ ] **Step 1: Nouvelles colonnes sur les tables existantes**

```sql
alter table missions_suivi add column zone_id uuid references zones(id);
alter table missions_suivi add column drones_affectes text[] default '{}';
alter table missions_suivi add column budget_previsionnel_fcfa numeric;

alter table executions_vol add column couverture_reelle jsonb;
```

- [ ] **Step 2: Table `mission_equipe`**

```sql
create table mission_equipe (
  id uuid primary key default gen_random_uuid(),
  mission_suivi_id uuid not null references missions_suivi(id) on delete cascade,
  agent_id uuid not null references profils(id),
  role_sur_mission text default ''
);
alter table mission_equipe enable row level security;
create policy "lecture_tous_agents_actifs" on mission_equipe for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on mission_equipe for insert to authenticated with check (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on mission_equipe for delete to authenticated using (public.est_agent_actif());
```

- [ ] **Step 3: Table `autorisations_mission`**

```sql
create table autorisations_mission (
  id uuid primary key default gen_random_uuid(),
  mission_suivi_id uuid not null references missions_suivi(id) on delete cascade,
  intitule text not null,
  statut text not null default 'a_solliciter' check (statut in ('a_solliciter','obtenue','refusee')),
  date_obtention date,
  remarque text default ''
);
alter table autorisations_mission enable row level security;
create policy "lecture_tous_agents_actifs" on autorisations_mission for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on autorisations_mission for insert to authenticated with check (public.est_agent_actif());
create policy "modification_tous_agents_actifs" on autorisations_mission for update to authenticated using (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on autorisations_mission for delete to authenticated using (public.est_agent_actif());
```

- [ ] **Step 4: Table `registre_incidents_vol`**

```sql
create table registre_incidents_vol (
  id uuid primary key default gen_random_uuid(),
  execution_vol_id uuid not null references executions_vol(id) on delete cascade,
  date_incident date not null default current_date,
  description text not null,
  gravite text default 'mineure' check (gravite in ('mineure','majeure','critique'))
);
alter table registre_incidents_vol enable row level security;
create policy "lecture_tous_agents_actifs" on registre_incidents_vol for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on registre_incidents_vol for insert to authenticated with check (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on registre_incidents_vol for delete to authenticated using (public.est_agent_actif());
```

- [ ] **Step 5: Tables `registre_anomalies_qualite` et `historique_corrections`**

```sql
create table registre_anomalies_qualite (
  id uuid primary key default gen_random_uuid(),
  controle_id uuid not null references controles_qualite(id) on delete cascade,
  description text not null,
  date_signalement date not null default current_date,
  statut text not null default 'ouverte' check (statut in ('ouverte','corrigee'))
);
create table historique_corrections (
  id uuid primary key default gen_random_uuid(),
  controle_id uuid not null references controles_qualite(id) on delete cascade,
  date_correction date not null default current_date,
  description text not null,
  corrige_par uuid references profils(id)
);
alter table registre_anomalies_qualite enable row level security;
alter table historique_corrections enable row level security;
create policy "lecture_tous_agents_actifs" on registre_anomalies_qualite for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on registre_anomalies_qualite for insert to authenticated with check (public.est_agent_actif());
create policy "modification_tous_agents_actifs" on registre_anomalies_qualite for update to authenticated using (public.est_agent_actif());
create policy "lecture_tous_agents_actifs" on historique_corrections for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on historique_corrections for insert to authenticated with check (public.est_agent_actif());
```

- [ ] **Step 6: Table générique `pieces_jointes`**

```sql
create table pieces_jointes (
  id uuid primary key default gen_random_uuid(),
  table_liee text not null check (table_liee in ('executions_vol','etapes_traitement','controles_qualite')),
  ligne_id uuid not null,
  type_fichier text not null,
  chemin_storage text not null,
  nom_original text not null,
  uploaded_by uuid references profils(id),
  uploaded_at timestamptz default now()
);
alter table pieces_jointes enable row level security;
create policy "lecture_tous_agents_actifs" on pieces_jointes for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on pieces_jointes for insert to authenticated with check (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on pieces_jointes for delete to authenticated using (public.est_agent_actif());
```

- [ ] **Step 7: Bucket Storage privé et ses policies**

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('suivi-pieces-jointes', 'suivi-pieces-jointes', false, 20971520);

create policy "lecture_tous_agents_actifs_storage" on storage.objects for select to authenticated
  using (bucket_id = 'suivi-pieces-jointes' and public.est_agent_actif());
create policy "ecriture_tous_agents_actifs_storage" on storage.objects for insert to authenticated
  with check (bucket_id = 'suivi-pieces-jointes' and public.est_agent_actif());
create policy "suppression_tous_agents_actifs_storage" on storage.objects for delete to authenticated
  using (bucket_id = 'suivi-pieces-jointes' and public.est_agent_actif());
```

(20971520 octets = 20 Mo, la limite décidée en conception.)

- [ ] **Step 8: Vérifier l'absence de récursion RLS**

Confirmer via `get_advisors(type: security)` qu'aucune alerte nouvelle n'apparaît sur les tables/policies créées (toutes réutilisent `est_agent_actif()`, déjà validée sans récursion).

---

## Task 2: Migrer les dossiers existants

**Files:** none (SQL exécuté directement par l'orchestrateur, action ponctuelle sur les données de production).

- [ ] **Step 1: Rapprocher les dossiers existants avec la bibliothèque de zones**

```sql
update missions_suivi m
set zone_id = z.id
from zones z
where m.zone_id is null
  and lower(trim(m.nom_zone)) = lower(trim(z.nom));
```

- [ ] **Step 2: Vérifier le résultat**

```sql
select count(*) as total, count(zone_id) as avec_zone_id from missions_suivi;
```

Noter le nombre de dossiers restés sans correspondance (`total - avec_zone_id`) — ils resteront fonctionnels via `nom_zone`/`commune`, aucune action supplémentaire requise dans cette tranche.

- [ ] **Step 3: Migrer `description_incident` vers `registre_incidents_vol`**

```sql
insert into registre_incidents_vol (execution_vol_id, date_incident, description)
select id, coalesce(date_reelle, current_date), description_incident
from executions_vol
where description_incident is not null and trim(description_incident) <> '';
```

(`description_incident` reste en base, gelée, pour rester réversible — non supprimée.)

---

## Task 3: Étendre `envoyerVersSuivi` pour transmettre `zone_id` et l'estimation traitement

**Files:**
- Modify: `drone-mission-app/app.js` (fonctions `envoyerVersSuivi`, ~ligne 532-545)
- Modify: `drone-mission-app/suivi.js` (fonctions `construireDossierDepuisProjet`, `mapperDossierVersJs`, `creerDossierMission`)
- Test: `drone-mission-app/tests/suivi.test.js` (fichier existant — ajouter des cas)

- [ ] **Step 1: Étendre `construireDossierDepuisProjet` pour accepter `zoneId`, `dronesAffectes`, `budgetPrevisionnelFcfa`**

Dans `drone-mission-app/suivi.js`, remplacer :

```js
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
```

par :

```js
  function construireDossierDepuisProjet({ nomZone, commune, superficieHa, nombreMissionsPrevues, agentReferentId, donneesPlanification, zoneId, dronesAffectes, budgetPrevisionnelFcfa }) {
    const dossier = {
      nom_zone: nomZone,
      commune: commune || '',
      date_planification: new Date().toISOString().slice(0, 10),
      superficie_ha: superficieHa,
      nombre_missions_prevues: nombreMissionsPrevues,
      agent_referent_id: agentReferentId,
      statut_global: 'planifiee',
      donnees_planification: donneesPlanification,
      historique: [],
      zone_id: zoneId || null,
      drones_affectes: dronesAffectes || [],
      budget_previsionnel_fcfa: budgetPrevisionnelFcfa ?? null
    };
```

- [ ] **Step 2: Étendre `mapperDossierVersJs`**

Remplacer :

```js
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
```

par :

```js
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
      createdAt: row.created_at,
      zoneId: row.zone_id,
      dronesAffectes: row.drones_affectes || [],
      budgetPrevisionnelFcfa: row.budget_previsionnel_fcfa
    };
  }
```

- [ ] **Step 3: Test des deux fonctions pures étendues**

Ajouter dans `drone-mission-app/tests/suivi.test.js` :

```js
test('construireDossierDepuisProjet: inclut zone_id, drones_affectes, budget_previsionnel_fcfa', () => {
  const { dossier } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone test', commune: 'Yopougon', superficieHa: 10, nombreMissionsPrevues: 1,
    agentReferentId: 'agent-1', donneesPlanification: {}, zoneId: 'zone-uuid-1',
    dronesAffectes: ['DJI-01'], budgetPrevisionnelFcfa: 500000
  });
  assert.strictEqual(dossier.zone_id, 'zone-uuid-1');
  assert.deepStrictEqual(dossier.drones_affectes, ['DJI-01']);
  assert.strictEqual(dossier.budget_previsionnel_fcfa, 500000);
});

test('construireDossierDepuisProjet: zone_id/drones_affectes ont des valeurs par défaut sûres si absents', () => {
  const { dossier } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone test', commune: '', superficieHa: 10, nombreMissionsPrevues: 1,
    agentReferentId: null, donneesPlanification: {}
  });
  assert.strictEqual(dossier.zone_id, null);
  assert.deepStrictEqual(dossier.drones_affectes, []);
  assert.strictEqual(dossier.budget_previsionnel_fcfa, null);
});

test('mapperDossierVersJs: convertit zone_id/drones_affectes/budget_previsionnel_fcfa', () => {
  const js = Suivi.mapperDossierVersJs({
    id: 'd1', nom_zone: 'Z', commune: 'C', date_planification: '2026-01-01',
    superficie_ha: 5, nombre_missions_prevues: 1, agent_referent_id: null,
    statut_global: 'planifiee', donnees_planification: {}, historique: [],
    created_by: null, created_at: '2026-01-01T00:00:00Z',
    zone_id: 'zone-uuid-1', drones_affectes: ['DJI-01'], budget_previsionnel_fcfa: 500000
  });
  assert.strictEqual(js.zoneId, 'zone-uuid-1');
  assert.deepStrictEqual(js.dronesAffectes, ['DJI-01']);
  assert.strictEqual(js.budgetPrevisionnelFcfa, 500000);
});
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS, 64 tests (61 existants + 3 nouveaux), 0 échec.

- [ ] **Step 5: Étendre `envoyerVersSuivi` dans `app.js`**

Dans `drone-mission-app/app.js`, remplacer (~ligne 534-541) :

```js
      const profil = await Suivi.profilConnecte();
      await Suivi.creerDossierMission({
        nomZone: state.zone.nom || 'Zone sans nom',
        commune: state.zone.commune,
        superficieHa: dernierResultats.surfaceHa,
        nombreMissionsPrevues: dernierResultats.nbMissionsAutomatiques,
        agentReferentId: profil ? profil.id : null,
        donneesPlanification: state
      });
```

par :

```js
      const profil = await Suivi.profilConnecte();
      await Suivi.creerDossierMission({
        nomZone: state.zone.nom || 'Zone sans nom',
        commune: state.zone.commune,
        superficieHa: dernierResultats.surfaceHa,
        nombreMissionsPrevues: dernierResultats.nbMissionsAutomatiques,
        agentReferentId: profil ? profil.id : null,
        donneesPlanification: { etat: state, resultats: dernierResultats },
        zoneId: state.zone.id
      });
```

- [ ] **Step 6: Relancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 64 tests, 0 échec.

```bash
git add drone-mission-app/app.js drone-mission-app/suivi.js drone-mission-app/tests/suivi.test.js
git commit -m "feat: transmettre zone_id, drones affectés, budget et résultats calculés au dossier de suivi créé"
```

---

## Task 4: Fonctions pures — mappers des nouvelles tables + `calculerIndicateursCharge`

**Files:**
- Modify: `drone-mission-app/suivi.js`
- Test: `drone-mission-app/tests/suivi.test.js`

- [ ] **Step 1: Ajouter les 6 fonctions de mapping pures**

Dans `drone-mission-app/suivi.js`, juste après `mapperControleVersJs` (avant `calculerAvancementDossier`), ajouter :

```js
  /** Convertit une ligne Supabase `mission_equipe` en objet JS. */
  function mapperMembreEquipeVersJs(row) {
    return { id: row.id, missionSuiviId: row.mission_suivi_id, agentId: row.agent_id, roleSurMission: row.role_sur_mission };
  }

  /** Convertit une ligne Supabase `autorisations_mission` en objet JS. */
  function mapperAutorisationVersJs(row) {
    return {
      id: row.id, missionSuiviId: row.mission_suivi_id, intitule: row.intitule,
      statut: row.statut, dateObtention: row.date_obtention, remarque: row.remarque
    };
  }

  /** Convertit une ligne Supabase `registre_incidents_vol` en objet JS. */
  function mapperIncidentVersJs(row) {
    return { id: row.id, executionVolId: row.execution_vol_id, dateIncident: row.date_incident, description: row.description, gravite: row.gravite };
  }

  /** Convertit une ligne Supabase `registre_anomalies_qualite` en objet JS. */
  function mapperAnomalieVersJs(row) {
    return { id: row.id, controleId: row.controle_id, description: row.description, dateSignalement: row.date_signalement, statut: row.statut };
  }

  /** Convertit une ligne Supabase `historique_corrections` en objet JS. */
  function mapperCorrectionVersJs(row) {
    return { id: row.id, controleId: row.controle_id, dateCorrection: row.date_correction, description: row.description, corrigePar: row.corrige_par };
  }

  /** Convertit une ligne Supabase `pieces_jointes` en objet JS. */
  function mapperPieceJointeVersJs(row) {
    return {
      id: row.id, tableLiee: row.table_liee, ligneId: row.ligne_id, typeFichier: row.type_fichier,
      cheminStorage: row.chemin_storage, nomOriginal: row.nom_original, uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at
    };
  }

  /** Indicateurs de charge : nombre de drones/agents actuellement affectés à des missions non terminées. */
  function calculerIndicateursCharge(dossiers) {
    const dossiersActifs = dossiers.filter((d) => d.statutGlobal !== 'terminee');
    const dronesUniques = new Set();
    dossiersActifs.forEach((d) => (d.dronesAffectes || []).forEach((id) => dronesUniques.add(id)));
    return {
      missionsActives: dossiersActifs.length,
      dronesAffectes: dronesUniques.size
    };
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Dans le `return { ... }` en fin de fichier, ajouter après `mapperControleVersJs` :
`mapperMembreEquipeVersJs, mapperAutorisationVersJs, mapperIncidentVersJs, mapperAnomalieVersJs, mapperCorrectionVersJs, mapperPieceJointeVersJs, calculerIndicateursCharge,`

- [ ] **Step 3: Tests**

Ajouter dans `drone-mission-app/tests/suivi.test.js` :

```js
test('mapperMembreEquipeVersJs: convertit une ligne mission_equipe', () => {
  const js = Suivi.mapperMembreEquipeVersJs({ id: 'e1', mission_suivi_id: 'm1', agent_id: 'a1', role_sur_mission: 'Télépilote' });
  assert.deepStrictEqual(js, { id: 'e1', missionSuiviId: 'm1', agentId: 'a1', roleSurMission: 'Télépilote' });
});

test('mapperAutorisationVersJs: convertit une ligne autorisations_mission', () => {
  const js = Suivi.mapperAutorisationVersJs({
    id: 'au1', mission_suivi_id: 'm1', intitule: 'Autorisation ANAC', statut: 'obtenue', date_obtention: '2026-01-01', remarque: ''
  });
  assert.strictEqual(js.intitule, 'Autorisation ANAC');
  assert.strictEqual(js.statut, 'obtenue');
});

test('mapperIncidentVersJs: convertit une ligne registre_incidents_vol', () => {
  const js = Suivi.mapperIncidentVersJs({ id: 'i1', execution_vol_id: 'ex1', date_incident: '2026-01-01', description: 'Vent fort', gravite: 'majeure' });
  assert.strictEqual(js.description, 'Vent fort');
  assert.strictEqual(js.gravite, 'majeure');
});

test('mapperAnomalieVersJs: convertit une ligne registre_anomalies_qualite', () => {
  const js = Suivi.mapperAnomalieVersJs({ id: 'an1', controle_id: 'c1', description: 'Trou dans le nuage', date_signalement: '2026-01-01', statut: 'ouverte' });
  assert.strictEqual(js.statut, 'ouverte');
});

test('mapperCorrectionVersJs: convertit une ligne historique_corrections', () => {
  const js = Suivi.mapperCorrectionVersJs({ id: 'co1', controle_id: 'c1', date_correction: '2026-01-02', description: 'Recalage', corrige_par: 'a1' });
  assert.strictEqual(js.description, 'Recalage');
});

test('mapperPieceJointeVersJs: convertit une ligne pieces_jointes', () => {
  const js = Suivi.mapperPieceJointeVersJs({
    id: 'p1', table_liee: 'executions_vol', ligne_id: 'ex1', type_fichier: 'image',
    chemin_storage: 'executions_vol/ex1/photo.jpg', nom_original: 'photo.jpg', uploaded_by: 'a1', uploaded_at: '2026-01-01T00:00:00Z'
  });
  assert.strictEqual(js.cheminStorage, 'executions_vol/ex1/photo.jpg');
});

test('calculerIndicateursCharge: compte les drones uniques affectés aux missions non terminées', () => {
  const dossiers = [
    { statutGlobal: 'en_cours', dronesAffectes: ['DJI-01', 'DJI-02'] },
    { statutGlobal: 'planifiee', dronesAffectes: ['DJI-01'] },
    { statutGlobal: 'terminee', dronesAffectes: ['DJI-03'] }
  ];
  const indicateurs = Suivi.calculerIndicateursCharge(dossiers);
  assert.strictEqual(indicateurs.missionsActives, 2);
  assert.strictEqual(indicateurs.dronesAffectes, 2);
});

test('calculerIndicateursCharge: tableau vide donne des indicateurs à zéro', () => {
  const indicateurs = Suivi.calculerIndicateursCharge([]);
  assert.strictEqual(indicateurs.missionsActives, 0);
  assert.strictEqual(indicateurs.dronesAffectes, 0);
});
```

- [ ] **Step 4: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests (64 + 8 nouveaux), 0 échec.

```bash
git add drone-mission-app/suivi.js drone-mission-app/tests/suivi.test.js
git commit -m "feat: fonctions pures pour équipe, autorisations, registres et pièces jointes"
```

---

## Task 5: CRUD Supabase — équipe et autorisations (Planification)

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Ajouter les fonctions impures, juste avant `return { ... }` en fin de fichier**

```js
  /** Liste les membres d'équipe affectés à un dossier. */
  async function listerMembresEquipe(missionSuiviId) {
    const sb = initClient();
    const { data, error } = await sb.from('mission_equipe').select('*').eq('mission_suivi_id', missionSuiviId);
    if (error) throw new Error(`Échec du chargement de l'équipe : ${error.message}`);
    return data.map(mapperMembreEquipeVersJs);
  }

  /** Affecte un agent à un dossier. */
  async function ajouterMembreEquipe(missionSuiviId, agentId, roleSurMission) {
    const sb = initClient();
    const { data, error } = await sb.from('mission_equipe')
      .insert({ mission_suivi_id: missionSuiviId, agent_id: agentId, role_sur_mission: roleSurMission || '' })
      .select().single();
    if (error) throw new Error(`Échec de l'affectation : ${error.message}`);
    return mapperMembreEquipeVersJs(data);
  }

  /** Retire un agent d'un dossier. */
  async function retirerMembreEquipe(id) {
    const sb = initClient();
    const { error } = await sb.from('mission_equipe').delete().eq('id', id);
    if (error) throw new Error(`Échec du retrait : ${error.message}`);
  }

  /** Liste les autorisations à solliciter/obtenues pour un dossier. */
  async function listerAutorisations(missionSuiviId) {
    const sb = initClient();
    const { data, error } = await sb.from('autorisations_mission').select('*').eq('mission_suivi_id', missionSuiviId).order('id');
    if (error) throw new Error(`Échec du chargement des autorisations : ${error.message}`);
    return data.map(mapperAutorisationVersJs);
  }

  /** Crée une autorisation à solliciter pour un dossier. */
  async function creerAutorisation(missionSuiviId, intitule) {
    const sb = initClient();
    const { data, error } = await sb.from('autorisations_mission')
      .insert({ mission_suivi_id: missionSuiviId, intitule }).select().single();
    if (error) throw new Error(`Échec de la création de l'autorisation : ${error.message}`);
    return mapperAutorisationVersJs(data);
  }

  /** Met à jour le statut/date d'obtention/remarque d'une autorisation. */
  async function mettreAJourAutorisation(id, donnees) {
    const sb = initClient();
    const patch = {};
    if (donnees.statut !== undefined) patch.statut = donnees.statut;
    if (donnees.dateObtention !== undefined) patch.date_obtention = donnees.dateObtention;
    if (donnees.remarque !== undefined) patch.remarque = donnees.remarque;
    const { data, error } = await sb.from('autorisations_mission').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de l'autorisation : ${error.message}`);
    return mapperAutorisationVersJs(data);
  }

  /** Supprime une autorisation. */
  async function supprimerAutorisation(id) {
    const sb = initClient();
    const { error } = await sb.from('autorisations_mission').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression de l'autorisation : ${error.message}`);
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Ajouter au `return { ... }` : `listerMembresEquipe, ajouterMembreEquipe, retirerMembreEquipe, listerAutorisations, creerAutorisation, mettreAJourAutorisation, supprimerAutorisation,`

- [ ] **Step 3: Lancer les tests (pas de nouveau test — fonctions impures, non testées automatiquement, cohérent avec le reste du fichier)**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: CRUD Supabase pour l'affectation d'équipe et les autorisations de mission"
```

---

## Task 6: CRUD Supabase — registre des incidents et couverture réelle (Acquisition)

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Étendre `mapperExecutionVersJs` pour inclure `couverture_reelle`**

Remplacer (~ligne 66-79) :

```js
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
```

par :

```js
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
      updatedAt: row.updated_at,
      couvertureReelle: row.couverture_reelle
    };
  }
```

- [ ] **Step 2: Ajouter les fonctions impures**

```js
  /** Liste les incidents enregistrés pour un vol. */
  async function listerIncidentsVol(executionVolId) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_incidents_vol').select('*').eq('execution_vol_id', executionVolId).order('date_incident', { ascending: false });
    if (error) throw new Error(`Échec du chargement des incidents : ${error.message}`);
    return data.map(mapperIncidentVersJs);
  }

  /** Enregistre un nouvel incident pour un vol. */
  async function enregistrerIncidentVol(executionVolId, donnees) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_incidents_vol')
      .insert({ execution_vol_id: executionVolId, description: donnees.description, gravite: donnees.gravite || 'mineure' })
      .select().single();
    if (error) throw new Error(`Échec de l'enregistrement de l'incident : ${error.message}`);
    return mapperIncidentVersJs(data);
  }

  /** Met à jour la couverture réellement survolée d'un vol (géométrie, même format que zones.geometrie). */
  async function mettreAJourCouvertureReelle(executionVolId, geometrie) {
    const sb = initClient();
    const { error } = await sb.from('executions_vol').update({ couverture_reelle: geometrie, updated_at: new Date().toISOString() }).eq('id', executionVolId);
    if (error) throw new Error(`Échec de l'enregistrement de la couverture réelle : ${error.message}`);
  }
```

- [ ] **Step 3: Exporter les nouvelles fonctions**

Ajouter au `return { ... }` : `listerIncidentsVol, enregistrerIncidentVol, mettreAJourCouvertureReelle,`

- [ ] **Step 4: Mettre à jour le test existant du mapper (fixture incomplète)**

Le fichier `drone-mission-app/tests/suivi.test.js` contient déjà un test pour `mapperExecutionVersJs` (créé lors de la tranche Suivi initiale) — vérifier qu'il n'échoue pas avec le nouveau champ (une fixture qui ne fournit pas `couverture_reelle` produira simplement `couvertureReelle: undefined`, ce qui ne casse pas une assertion `deepStrictEqual` existante uniquement si cette dernière liste explicitement tous les champs attendus sans `couvertureReelle`). Si le test existant utilise `assert.deepStrictEqual` sur l'objet complet, l'étendre pour inclure `couvertureReelle: null` (ou la valeur attendue) dans le résultat comparé, sinon il échouera après ce changement.

- [ ] **Step 5: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

- [ ] **Step 6: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: CRUD Supabase pour le registre des incidents de vol et la couverture réelle"
```

---

## Task 7: CRUD Supabase générique — pièces jointes (documents B2/B3/B4)

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Ajouter les fonctions impures**

```js
  /** Téléverse un fichier lié à une ligne (execution_vol, etape_traitement ou controle_qualite) et enregistre sa référence. */
  async function uploaderPieceJointe(tableLiee, ligneId, fichier, typeFichier) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const chemin = `${tableLiee}/${ligneId}/${Date.now()}_${fichier.name}`;
    const { error: erreurUpload } = await sb.storage.from('suivi-pieces-jointes').upload(chemin, fichier);
    if (erreurUpload) throw new Error(`Échec du téléversement : ${erreurUpload.message}`);
    const { data, error } = await sb.from('pieces_jointes').insert({
      table_liee: tableLiee, ligne_id: ligneId, type_fichier: typeFichier,
      chemin_storage: chemin, nom_original: fichier.name, uploaded_by: user ? user.id : null
    }).select().single();
    if (error) throw new Error(`Fichier téléversé mais échec de l'enregistrement de la référence : ${error.message}`);
    return mapperPieceJointeVersJs(data);
  }

  /** Liste les pièces jointes d'une ligne donnée. */
  async function listerPiecesJointes(tableLiee, ligneId) {
    const sb = initClient();
    const { data, error } = await sb.from('pieces_jointes').select('*').eq('table_liee', tableLiee).eq('ligne_id', ligneId).order('uploaded_at', { ascending: false });
    if (error) throw new Error(`Échec du chargement des pièces jointes : ${error.message}`);
    return data.map(mapperPieceJointeVersJs);
  }

  /** Retourne une URL signée temporaire (1h) pour télécharger une pièce jointe. */
  async function obtenirUrlSigneePieceJointe(cheminStorage) {
    const sb = initClient();
    const { data, error } = await sb.storage.from('suivi-pieces-jointes').createSignedUrl(cheminStorage, 3600);
    if (error) throw new Error(`Échec de la génération du lien de téléchargement : ${error.message}`);
    return data.signedUrl;
  }

  /** Supprime une pièce jointe (référence en base ; le fichier Storage n'est pas nettoyé dans cette tranche). */
  async function supprimerPieceJointe(id) {
    const sb = initClient();
    const { error } = await sb.from('pieces_jointes').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression : ${error.message}`);
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Ajouter au `return { ... }` : `uploaderPieceJointe, listerPiecesJointes, obtenirUrlSigneePieceJointe, supprimerPieceJointe,`

- [ ] **Step 3: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: CRUD Supabase générique pour les pièces jointes (Storage)"
```

---

## Task 8: CRUD Supabase — anomalies et corrections (Contrôle qualité)

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Ajouter les fonctions impures**

```js
  /** Liste les anomalies signalées pour un contrôle qualité. */
  async function listerAnomaliesQualite(controleId) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_anomalies_qualite').select('*').eq('controle_id', controleId).order('date_signalement', { ascending: false });
    if (error) throw new Error(`Échec du chargement des anomalies : ${error.message}`);
    return data.map(mapperAnomalieVersJs);
  }

  /** Signale une nouvelle anomalie pour un contrôle qualité. */
  async function signalerAnomalieQualite(controleId, description) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_anomalies_qualite').insert({ controle_id: controleId, description }).select().single();
    if (error) throw new Error(`Échec du signalement de l'anomalie : ${error.message}`);
    return mapperAnomalieVersJs(data);
  }

  /** Marque une anomalie comme corrigée. */
  async function mettreAJourAnomalieQualite(id, statut) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_anomalies_qualite').update({ statut }).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de l'anomalie : ${error.message}`);
    return mapperAnomalieVersJs(data);
  }

  /** Liste l'historique des corrections apportées pour un contrôle qualité. */
  async function listerCorrections(controleId) {
    const sb = initClient();
    const { data, error } = await sb.from('historique_corrections').select('*').eq('controle_id', controleId).order('date_correction', { ascending: false });
    if (error) throw new Error(`Échec du chargement de l'historique des corrections : ${error.message}`);
    return data.map(mapperCorrectionVersJs);
  }

  /** Enregistre une correction apportée suite à une anomalie. */
  async function enregistrerCorrection(controleId, description) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('historique_corrections')
      .insert({ controle_id: controleId, description, corrige_par: user ? user.id : null }).select().single();
    if (error) throw new Error(`Échec de l'enregistrement de la correction : ${error.message}`);
    return mapperCorrectionVersJs(data);
  }
```

- [ ] **Step 2: Exporter les nouvelles fonctions**

Ajouter au `return { ... }` : `listerAnomaliesQualite, signalerAnomalieQualite, mettreAJourAnomalieQualite, listerCorrections, enregistrerCorrection,`

- [ ] **Step 3: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: CRUD Supabase pour les anomalies qualité et l'historique des corrections"
```

---

## Task 9: Étendre `recupererDossier` pour inclure équipe et autorisations

**Files:**
- Modify: `drone-mission-app/suivi.js`

- [ ] **Step 1: Étendre la requête groupée**

Remplacer (~ligne 229-246) :

```js
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
```

par :

```js
  async function recupererDossier(id) {
    const sb = initClient();
    const [{ data: dossier, error: e1 }, { data: executions, error: e2 },
           { data: etapes, error: e3 }, { data: controles, error: e4 },
           { data: equipe, error: e5 }, { data: autorisations, error: e6 }] = await Promise.all([
      sb.from('missions_suivi').select('*').eq('id', id).single(),
      sb.from('executions_vol').select('*').eq('mission_suivi_id', id).order('numero_mission'),
      sb.from('etapes_traitement').select('*').eq('mission_suivi_id', id),
      sb.from('controles_qualite').select('*').eq('mission_suivi_id', id),
      sb.from('mission_equipe').select('*').eq('mission_suivi_id', id),
      sb.from('autorisations_mission').select('*').eq('mission_suivi_id', id).order('id')
    ]);
    if (e1) throw new Error(`Échec du chargement du dossier : ${e1.message}`);
    if (e2 || e3 || e4 || e5 || e6) throw new Error('Échec du chargement du détail du dossier.');
    return {
      dossier: mapperDossierVersJs(dossier),
      executions: executions.map(mapperExecutionVersJs),
      etapes: etapes.map(mapperEtapeVersJs),
      controles: controles.map(mapperControleVersJs),
      equipe: equipe.map(mapperMembreEquipeVersJs),
      autorisations: autorisations.map(mapperAutorisationVersJs)
    };
  }
```

- [ ] **Step 2: Lancer les tests, puis commit**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

```bash
git add drone-mission-app/suivi.js
git commit -m "feat: inclure équipe et autorisations dans le chargement complet d'un dossier de suivi"
```

---

## Task 10: HTML — restructurer le panneau Suivi (sélecteur de zone, retrait tableau de bord/liste, 4e sous-onglet)

**Files:**
- Modify: `drone-mission-app/index.html`

- [ ] **Step 1: Remplacer le contenu de `suiviContenuHost`**

Remplacer (lignes ~439-478, tout le contenu de `<div id="suiviContenuHost" class="is-hidden">` jusqu'à sa fermeture) :

```html
      <div id="suiviContenuHost" class="is-hidden">

        <div class="panel-box">
          <div class="panel-box__head">
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
```

par :

```html
      <div id="suiviContenuHost" class="is-hidden">

        <div class="panel-box">
          <div class="panel-box__head">
            <span id="suiviUtilisateurConnecte" class="hint"></span>
            <button id="btnSuiviDeconnexion" class="btn btn--ghost">Déconnexion</button>
          </div>
        </div>

        <div id="suiviSelecteurHost" class="panel-box">
          <h3>Zone suivie</h3>
          <div class="field">
            <label>Localité ou Commune</label>
            <input type="text" id="suiviZoneCommune" list="suiviCommunesDatalist" placeholder="Ex : Yopougon">
            <datalist id="suiviCommunesDatalist"></datalist>
          </div>
          <div class="field">
            <label>Zone</label>
            <input type="text" id="suiviZoneNom" list="suiviZonesDatalist" placeholder="Choisir une zone">
            <datalist id="suiviZonesDatalist"></datalist>
          </div>
          <div id="suiviDossierSelecteurHost" class="field is-hidden">
            <label>Dossier de suivi</label>
            <select id="suiviDossierSelecteur"></select>
          </div>
          <p id="suiviZoneAucunDossier" class="hint is-hidden">Aucun dossier de suivi pour cette zone.</p>
        </div>

        <div id="suiviDetailHost" class="is-hidden"></div>

      </div>
```

- [ ] **Step 2: Vérifier que le 4e sous-onglet « Planification » sera ajouté dynamiquement**

Aucune modification statique nécessaire ici : `majAffichageDetailSuivi()` (Task 11) génère les boutons de sous-onglets en JS. Confirmer simplement que rien dans le HTML ne fait référence en dur à seulement 3 sous-onglets (grep `suivi-sous-onglet` dans `index.html` doit ne rien trouver — cette classe n'existe que dans le HTML généré par `app.js`).

- [ ] **Step 3: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec (changement HTML pur, aucun impact sur les tests Node).

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/index.html
git commit -m "feat: remplacer tableau de bord/liste de dossiers par un sélecteur de zone dans l'onglet Suivi"
```

---

## Task 11: `app.js` — navigation zone-first dans l'onglet Suivi

**Files:**
- Modify: `drone-mission-app/app.js`

**Attention — lecture attentive avant de commencer** : entre `bindFiltresSuivi` (~ligne 619) et `afficherListeSuivi` (~ligne 752), tout le module « Zone & Cartographie — bibliothèque de zones partagées » de Chantier A (`zonesEnCache`, `initialiserOngletZones`, `peuplerCommunes`, `peuplerDatalistZones`, `bindSelectionZone`, `chargerZone`, `bindEnregistrerSupprimerZone`, `enregistrerZone`, `supprimerZoneActuelle`, ~lignes 624-750) est intercalé. Ce bloc ne fait PAS partie de cette tâche et ne doit **pas** être touché — chaque remplacement ci-dessous cible une fonction précise par son texte exact, jamais une plage de lignes entière.

- [ ] **Step 1: Remplacer `bindFiltresSuivi`**

```js
  function bindFiltresSuivi() {
    document.getElementById('suiviFiltreStatut').addEventListener('change', afficherListeSuivi);
    document.getElementById('suiviFiltreCommune').addEventListener('input', Utils.debounce(afficherListeSuivi, 300));
  }
```

par :

```js
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
    document.getElementById('suiviDetailHost').classList.add('is-hidden');
    const selecteurHost = document.getElementById('suiviDossierSelecteurHost');
    const selecteur = document.getElementById('suiviDossierSelecteur');
    const aucunMsg = document.getElementById('suiviZoneAucunDossier');
    selecteurHost.classList.add('is-hidden');
    aucunMsg.classList.add('is-hidden');
    try {
      const dossiers = await Suivi.listerDossiers({ zoneId });
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
      Utils.toast(`Échec du chargement des dossiers de la zone : ${err.message}`, 'danger');
    }
  }
```

Note : `zonesEnCache` (rempli par `initialiserOngletZones`, cf. Chantier A) est réutilisé ici — pas de rechargement séparé de la bibliothèque de zones.

- [ ] **Step 2: Supprimer les trois fonctions devenues mortes (`afficherListeSuivi`, `majTableauDeBordSuivi`, `rafraichirListeDossiers`)**

Ces trois fonctions se trouvent APRÈS le module Zone & Cartographie (donc après le Step 1 ci-dessus dans le fichier), à rechercher par leur texte exact. Supprimer entièrement ce bloc (les trois fonctions à la suite, sans rien entre elles) :

```js
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
```

`suiviTableauDeBordRequeteEnCours` et `suiviListeRequeteEnCours` (les compteurs de requête déclarés en haut du module, ~lignes 30-31) deviennent inutilisés après cette suppression — les laisser en place (variables mortes mais inoffensives) plutôt que de risquer de casser une déclaration partagée ; un nettoyage pourra être fait lors d'une revue finale si un reviewer le signale.

- [ ] **Step 3: Adapter `afficherContenuSuiviConnecte` pour peupler les listes de zones à la connexion**

Remplacer (~ligne 607-614) :

```js
  async function afficherContenuSuiviConnecte() {
    document.getElementById('suiviConnexionHost').classList.add('is-hidden');
    document.getElementById('suiviContenuHost').classList.remove('is-hidden');
    const profil = await Suivi.profilConnecte();
    document.getElementById('suiviUtilisateurConnecte').textContent =
      profil ? `Connecté : ${profil.nomComplet} (${profil.role})` : 'Connecté';
    await afficherListeSuivi();
  }
```

par :

```js
  async function afficherContenuSuiviConnecte() {
    document.getElementById('suiviConnexionHost').classList.add('is-hidden');
    document.getElementById('suiviContenuHost').classList.remove('is-hidden');
    const profil = await Suivi.profilConnecte();
    document.getElementById('suiviUtilisateurConnecte').textContent =
      profil ? `Connecté : ${profil.nomComplet} (${profil.role})` : 'Connecté';
    peuplerCommunesSuivi();
    peuplerDatalistZonesSuivi();
  }
```

- [ ] **Step 4: Adapter `deconnecterSuivi` pour réinitialiser le sélecteur de zone**

Dans `deconnecterSuivi` (~ligne 593-605), remplacer :

```js
      document.getElementById('suiviConnexionHost').classList.remove('is-hidden');
      document.getElementById('suiviContenuHost').classList.add('is-hidden');
    } finally {
```

par :

```js
      document.getElementById('suiviConnexionHost').classList.remove('is-hidden');
      document.getElementById('suiviContenuHost').classList.add('is-hidden');
      document.getElementById('suiviZoneCommune').value = '';
      document.getElementById('suiviZoneNom').value = '';
      document.getElementById('suiviDossierSelecteurHost').classList.add('is-hidden');
      document.getElementById('suiviZoneAucunDossier').classList.add('is-hidden');
      document.getElementById('suiviDetailHost').classList.add('is-hidden');
    } finally {
```

- [ ] **Step 5: Adapter `afficherDetailSuivi` (retrait de la référence à `suiviListeHost`, qui n'existe plus)**

Remplacer (~ligne 841-853) :

```js
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
```

par :

```js
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
```

- [ ] **Step 6: Retirer le bouton « Retour à la liste » de `majAffichageDetailSuivi` (remplacé par le sélecteur de zone/dossier toujours visible au-dessus)**

Dans `majAffichageDetailSuivi` (~ligne 859-887), remplacer :

```js
    document.getElementById('suiviDetailHost').innerHTML = `
      <div class="panel-box">
        <button id="btnSuiviRetourListe" class="btn btn--ghost">← Retour à la liste</button>
        <h3 id="suiviDetailTitre">${Utils.escapeHtml(dossier.nomZone)}</h3>
```

par :

```js
    document.getElementById('suiviDetailHost').innerHTML = `
      <div class="panel-box">
        <h3 id="suiviDetailTitre">${Utils.escapeHtml(dossier.nomZone)}</h3>
```

Et retirer la ligne `document.getElementById('btnSuiviRetourListe').addEventListener('click', afficherListeSuivi);` juste après le template (elle référence un bouton qui n'existe plus).

Dans `bindSuivi()` (~ligne 553-557), retirer la ligne devenue inutile :
```js
    document.getElementById('btnSuiviRetourListe')?.addEventListener('click', afficherListeSuivi);
```
(le `?.` la rendait déjà sûre en son absence, mais elle référence une fonction qui n'existe plus après ce Task — la retirer évite une `ReferenceError`.)

- [ ] **Step 7: Étendre `suivi.js` — `listerDossiers` doit accepter un filtre `zoneId`**

Dans `drone-mission-app/suivi.js`, remplacer (~ligne 218-226) :

```js
  async function listerDossiers(filtres = {}) {
    const sb = initClient();
    let requete = sb.from('missions_suivi').select('*').order('created_at', { ascending: false });
    if (filtres.statut) requete = requete.eq('statut_global', filtres.statut);
    if (filtres.commune) requete = requete.ilike('commune', `%${filtres.commune}%`);
    const { data, error } = await requete;
    if (error) throw new Error(`Échec du chargement des dossiers : ${error.message}`);
    return data.map(mapperDossierVersJs);
  }
```

par :

```js
  async function listerDossiers(filtres = {}) {
    const sb = initClient();
    let requete = sb.from('missions_suivi').select('*').order('created_at', { ascending: false });
    if (filtres.statut) requete = requete.eq('statut_global', filtres.statut);
    if (filtres.commune) requete = requete.ilike('commune', `%${filtres.commune}%`);
    if (filtres.zoneId) requete = requete.eq('zone_id', filtres.zoneId);
    const { data, error } = await requete;
    if (error) throw new Error(`Échec du chargement des dossiers : ${error.message}`);
    return data.map(mapperDossierVersJs);
  }
```

- [ ] **Step 8: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

- [ ] **Step 9: Vérification manuelle rapide dans le navigateur**

Servir l'app (`npx --yes serve drone-mission-app -l 8080`), se connecter, confirmer : aucune erreur console, le sélecteur de zone apparaît, taper une commune filtre les zones, choisir une zone sans dossier affiche le message attendu.

- [ ] **Step 10: Commit**

```bash
git add drone-mission-app/app.js drone-mission-app/suivi.js
git commit -m "feat: navigation par zone (au lieu du tableau de bord/liste plate) dans l'onglet Suivi"
```

---

## Task 12: `app.js` — sous-onglet Planification

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Ajouter le rendu du sous-onglet Planification**

Après `rendreCartesQualite` (~ligne 972), ajouter :

```js
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
      </div>
      <div class="panel-box">
        <h3 class="mt">Autorisations à solliciter</h3>
        ${autorisations.length === 0 ? '<p class="hint">Aucune autorisation enregistrée.</p>' : autorisations.map((a) => `
          <div class="suivi-tache-carte" data-autorisation-id="${a.id}">
            <div class="suivi-tache-carte__entete"><b>${Utils.escapeHtml(a.intitule)}</b>
              <span class="badge badge--${a.statut === 'obtenue' ? 'success' : a.statut === 'refusee' ? 'danger' : 'muted'}">${a.statut}</span>
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
```

- [ ] **Step 2: Intégrer le sous-onglet dans `majAffichageDetailSuivi` et `bindSousOngletsSuivi`**

Remplacer (bloc de `majAffichageDetailSuivi`, ~ligne 859-882) :

```js
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
```

par :

```js
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
        </div>
      </div>

      <div id="suiviSousOngletPlanification" class="suivi-sous-panel${suiviSousOngletActif === 'planification' ? '' : ' is-hidden'}">${rendreSousOngletPlanification(dossier, equipe, autorisations)}</div>
      <div id="suiviSousOngletExecution" class="suivi-sous-panel${suiviSousOngletActif === 'execution' ? '' : ' is-hidden'}">${rendreCartesExecutions(executions)}</div>
      <div id="suiviSousOngletTraitement" class="suivi-sous-panel${suiviSousOngletActif === 'traitement' ? '' : ' is-hidden'}">${rendreCartesEtapes(etapes)}</div>
      <div id="suiviSousOngletQualite" class="suivi-sous-panel${suiviSousOngletActif === 'qualite' ? '' : ' is-hidden'}">${rendreCartesQualite(controles)}</div>
    `;

    bindSousOngletsSuivi();
    bindFormulairesDetailSuivi();
```

Remplacer aussi la ligne de destructuration juste avant (~ligne 856) :
```js
    const { dossier, executions, etapes, controles } = suiviDossierActuel;
```
par :
```js
    const { dossier, executions, etapes, controles, equipe, autorisations } = suiviDossierActuel;
```

Et dans `bindSousOngletsSuivi` (~ligne 827-839), remplacer :

```js
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
```

par :

```js
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
      });
    });
  }
```

Et changer la valeur par défaut de `suiviSousOngletActif` (~ligne 825) de `'execution'` à `'planification'` (le premier sous-onglet affiché par défaut à l'ouverture d'un dossier).

- [ ] **Step 3: Ajouter les handlers pour retirer un membre et gérer les autorisations**

Dans `bindFormulairesDetailSuivi` (~ligne 974), ajouter avant la ligne finale de fermeture de fonction :

```js
    document.querySelectorAll('[data-membre-id]').forEach((carte) => {
      carte.querySelector('.suivi-equipe-retirer').addEventListener('click', async () => {
        try {
          await Suivi.retirerMembreEquipe(carte.dataset.membreId);
          await afficherDetailSuivi(suiviDossierActuel.dossier.id);
        } catch (err) {
          Utils.toast(`Échec du retrait : ${err.message}`, 'danger');
        }
      });
    });

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
```

- [ ] **Step 4: Lancer les tests, puis vérification manuelle rapide**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

Servir l'app, se connecter, ouvrir un dossier : confirmer que le sous-onglet « Planification » s'affiche par défaut avec drones affectés/budget, qu'ajouter une autorisation fonctionne et apparaît immédiatement.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: sous-onglet Planification (équipe, drones, budget, autorisations, indicateurs de charge)"
```

---

## Task 13: `app.js` — registre des incidents et couverture réelle (sous-onglet Acquisition)

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Étendre `rendreCartesExecutions` avec le registre des incidents**

Remplacer (~ligne 889-913) :

```js
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
```

par :

```js
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
          <p class="hint">${i.dateIncident} — <b>${i.gravite}</b> — ${Utils.escapeHtml(i.description)}</p>
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
      hote.querySelector('.suivi-incident-ajouter').addEventListener('click', async () => {
        const description = hote.querySelector('.suivi-incident-description').value.trim();
        if (!description) {
          Utils.toast('Décrivez l\'incident avant de l\'ajouter.', 'warning');
          return;
        }
        try {
          await Suivi.enregistrerIncidentVol(executionVolId, { description, gravite: hote.querySelector('.suivi-incident-gravite').value });
          Utils.toast('Incident enregistré.', 'success');
          await chargerRegistreIncidents(executionVolId);
        } catch (err) {
          Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
        }
      });
    } catch (err) {
      hote.innerHTML = `<p class="hint">Échec du chargement des incidents : ${Utils.escapeHtml(err.message)}</p>`;
    }
  }
```

- [ ] **Step 2: Charger le registre d'incidents, câbler la couverture réelle, et charger les pièces jointes à l'affichage du sous-onglet Acquisition**

Dans `bindFormulairesDetailSuivi`, après le bloc `document.querySelectorAll('[data-execution-id]')` existant (celui qui gère `suivi-vol-enregistrer`), ajouter à la suite :

```js
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
```

Note sur la couverture réelle : plutôt que de dupliquer un outil de dessin cartographique dans l'onglet Suivi (qui n'a pas de carte), on réutilise la géométrie déjà dessinée/chargée sur la carte de l'onglet Zone & Cartographie via `Carto.getZone()` (le module `Carto` reste en mémoire quel que soit l'onglet actif). L'agent dessine ou charge la couverture réellement survolée sur la carte, puis revient dans Suivi cliquer sur ce bouton pour l'enregistrer sur le vol concerné.

(`chargerPiecesJointes` est ajoutée à la Task suivante, partagée entre B2/B3/B4 — cette ligne restera sans effet tant qu'elle n'existe pas encore ; ne pas s'inquiéter d'une erreur de fonction non définie, elle sera résolue avant la fin de la Task 14. Si vous exécutez cette Task isolément, commentez temporairement cette ligne ou passez directement à la Task 14 avant de tester dans le navigateur.)

- [ ] **Step 3: Lancer les tests**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

- [ ] **Step 4: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: registre des incidents de vol dans le sous-onglet Acquisition"
```

---

## Task 14: `app.js` — pièces jointes génériques (B2/B3/B4)

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Ajouter la fonction générique de gestion des pièces jointes**

Après `chargerRegistreIncidents` (Task 13), ajouter :

```js
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
          try {
            const url = await Suivi.obtenirUrlSigneePieceJointe(chemin);
            window.open(url, '_blank');
          } catch (err) {
            Utils.toast(`Échec du téléchargement : ${err.message}`, 'danger');
          }
        });
      });
      hote.querySelectorAll('.suivi-piece-supprimer').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('[data-piece-id]').dataset.pieceId;
          try {
            await Suivi.supprimerPieceJointe(id);
            await chargerPiecesJointes(tableLiee, ligneId, hote);
          } catch (err) {
            Utils.toast(`Échec de la suppression : ${err.message}`, 'danger');
          }
        });
      });
      const inputFichier = hote.querySelector('.suivi-piece-fichier');
      inputFichier.addEventListener('change', async () => {
        const fichier = inputFichier.files[0];
        if (!fichier) return;
        try {
          await Suivi.uploaderPieceJointe(tableLiee, ligneId, fichier, fichier.type || 'document');
          Utils.toast('Fichier ajouté.', 'success');
          await chargerPiecesJointes(tableLiee, ligneId, hote);
        } catch (err) {
          Utils.toast(`Échec du téléversement : ${err.message}`, 'danger');
        }
      });
    } catch (err) {
      hote.innerHTML = `<p class="hint">Échec du chargement des pièces jointes : ${Utils.escapeHtml(err.message)}</p>`;
    }
  }
```

- [ ] **Step 2: Ajouter les emplacements de pièces jointes dans `rendreCartesEtapes` et `rendreCartesQualite`**

Dans `rendreCartesEtapes` (~ligne 915-939), juste avant la fermeture `</div>` de chaque carte (après le bouton `suivi-etape-enregistrer`), ajouter :
```html
        <div class="suivi-pieces-jointes-host" data-pieces-jointes="etapes_traitement:${e.id}">Chargement des pièces jointes…</div>
```

Dans `rendreCartesQualite` (~ligne 941-972), le rendu boucle sur `controles` déjà existants (historique) et un formulaire "Nouveau contrôle" séparé. Ajouter l'emplacement de pièces jointes UNIQUEMENT sur les contrôles déjà enregistrés (boucle `controles.map`), juste avant la fermeture de chaque carte historique :
```html
        <div class="suivi-pieces-jointes-host" data-pieces-jointes="controles_qualite:${c.id}">Chargement des pièces jointes…</div>
```
Ne pas ajouter de zone de pièces jointes sur le formulaire "Nouveau contrôle" (pas encore de `controle.id` avant l'enregistrement).

- [ ] **Step 3: Câbler le chargement des pièces jointes dans `bindFormulairesDetailSuivi`**

La ligne ajoutée en Task 13 Step 2 (`document.querySelectorAll('[data-pieces-jointes]').forEach(...)`) fonctionne maintenant que `chargerPiecesJointes` existe — aucune modification supplémentaire nécessaire ici, juste retirer le commentaire/contournement temporaire éventuellement laissé en Task 13.

- [ ] **Step 4: Lancer les tests, puis vérification manuelle**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

Servir l'app, ouvrir un dossier, sous-onglet Acquisition ou Traitement : confirmer qu'« Ajouter un fichier » téléverse réellement (via un petit fichier texte de test), qu'il apparaît dans la liste, que « Télécharger » ouvre une URL signée valide, que « Supprimer » le retire de la liste.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: pièces jointes génériques (upload/téléchargement/suppression) pour Acquisition, Traitement, Contrôle qualité"
```

---

## Task 15: `app.js` — anomalies et corrections (sous-onglet Contrôle qualité)

**Files:**
- Modify: `drone-mission-app/app.js`

- [ ] **Step 1: Étendre `rendreCartesQualite` avec anomalies/corrections**

Remplacer (~ligne 941-951, seulement la partie qui génère chaque carte de contrôle historique) :

```js
    const historique = controles.length === 0 ? '<p class="hint">Aucun contrôle enregistré.</p>' : controles.map((c) => `
      <div class="suivi-tache-carte">
        <div class="suivi-tache-carte__entete">
          <b>${LIBELLES_LIVRABLE[c.livrable]}</b>
          <span class="badge badge--${BADGE_RESULTAT_QUALITE[c.resultat]}">${LIBELLES_RESULTAT_QUALITE[c.resultat]}</span>
        </div>
        <p class="hint">${Utils.escapeHtml(c.commentaire) || 'Aucun commentaire.'} — ${c.dateControle}</p>
      </div>
    `).join('');
```

par :

```js
    const historique = controles.length === 0 ? '<p class="hint">Aucun contrôle enregistré.</p>' : controles.map((c) => `
      <div class="suivi-tache-carte" data-controle-id="${c.id}">
        <div class="suivi-tache-carte__entete">
          <b>${LIBELLES_LIVRABLE[c.livrable]}</b>
          <span class="badge badge--${BADGE_RESULTAT_QUALITE[c.resultat]}">${LIBELLES_RESULTAT_QUALITE[c.resultat]}</span>
        </div>
        <p class="hint">${Utils.escapeHtml(c.commentaire) || 'Aucun commentaire.'} — ${c.dateControle}</p>
        <div class="suivi-registre-host" data-registre-anomalies="${c.id}">Chargement des anomalies…</div>
        <div class="suivi-pieces-jointes-host" data-pieces-jointes="controles_qualite:${c.id}">Chargement des pièces jointes…</div>
      </div>
    `).join('');
```

- [ ] **Step 2: Ajouter la fonction de gestion des anomalies/corrections**

Après `chargerPiecesJointes` (Task 14), ajouter :

```js
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
            <span class="badge badge--${a.statut === 'corrigee' ? 'success' : 'warning'}">${a.statut}</span>
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
          try {
            await Suivi.mettreAJourAnomalieQualite(id, 'corrigee');
            await chargerRegistreAnomalies(controleId);
          } catch (err) {
            Utils.toast(`Échec de la mise à jour : ${err.message}`, 'danger');
          }
        });
      });
      hote.querySelector('.suivi-anomalie-ajouter').addEventListener('click', async () => {
        const description = hote.querySelector('.suivi-anomalie-description').value.trim();
        if (!description) {
          Utils.toast('Décrivez l\'anomalie avant de la signaler.', 'warning');
          return;
        }
        try {
          await Suivi.signalerAnomalieQualite(controleId, description);
          Utils.toast('Anomalie signalée.', 'success');
          await chargerRegistreAnomalies(controleId);
        } catch (err) {
          Utils.toast(`Échec du signalement : ${err.message}`, 'danger');
        }
      });
      hote.querySelector('.suivi-correction-ajouter').addEventListener('click', async () => {
        const description = hote.querySelector('.suivi-correction-description').value.trim();
        if (!description) {
          Utils.toast('Décrivez la correction avant de l\'enregistrer.', 'warning');
          return;
        }
        try {
          await Suivi.enregistrerCorrection(controleId, description);
          Utils.toast('Correction enregistrée.', 'success');
          await chargerRegistreAnomalies(controleId);
        } catch (err) {
          Utils.toast(`Échec de l'enregistrement : ${err.message}`, 'danger');
        }
      });
    } catch (err) {
      hote.innerHTML = `<p class="hint">Échec du chargement : ${Utils.escapeHtml(err.message)}</p>`;
    }
  }
```

- [ ] **Step 3: Câbler le chargement dans `bindFormulairesDetailSuivi`**

Ajouter à la suite des blocs déjà présents (Task 13 Step 2) :

```js
    document.querySelectorAll('[data-registre-anomalies]').forEach((hote) => {
      chargerRegistreAnomalies(hote.dataset.registreAnomalies);
    });
```

- [ ] **Step 4: Lancer les tests, puis vérification manuelle**

Run: `node --test drone-mission-app/tests/*.test.js` — Expected: PASS, 72 tests, 0 échec.

Servir l'app, ouvrir un dossier avec au moins un contrôle qualité enregistré, sous-onglet Contrôle qualité : confirmer que signaler une anomalie fonctionne, la marquer corrigée met à jour son badge, ajouter une correction l'affiche dans l'historique.

- [ ] **Step 5: Commit**

```bash
git add drone-mission-app/app.js
git commit -m "feat: registre des anomalies et historique des corrections dans le sous-onglet Contrôle qualité"
```

---

## Task 16: Vérification manuelle complète en navigateur

**Files:** none (verification only).

- [ ] **Step 1: Servir l'app localement**

Run: `npx --yes serve drone-mission-app -l 8080`

- [ ] **Step 2: Vérifier l'onglet Suivi sans connexion**

Ouvrir `http://localhost:8080`, onglet « Suivi post levé par drone » : écran de connexion affiché, aucune erreur console.

- [ ] **Step 3: Se connecter et vérifier le sélecteur de zone**

Se connecter (compte admin). Confirmer : plus de « Tableau de bord opérationnel » ni de « Dossiers de mission » ; un sélecteur de zone (commune + nom) apparaît ; taper une commune filtre les zones proposées.

- [ ] **Step 4: Créer un nouveau dossier et vérifier le lien zone_id**

Depuis Zone & Cartographie, charger/créer une zone, dessiner, envoyer vers le Suivi. Retourner dans Suivi, sélectionner cette zone : le dossier fraîchement créé apparaît directement (un seul dossier → pas de sélecteur secondaire).

- [ ] **Step 5: Vérifier les 4 sous-onglets**

Dans le dossier ouvert : confirmer la présence des 4 sous-onglets (Planification, Acquisition, Traitement, Contrôle qualité), « Planification » actif par défaut, drones affectés/budget affichés (vides si non renseignés à la création), ajout d'une autorisation fonctionnel.

- [ ] **Step 6: Vérifier registres et pièces jointes**

Sous-onglet Acquisition : ajouter un incident, confirmer son apparition. Téléverser un petit fichier test sur un vol : confirmer apparition dans la liste, téléchargement via URL signée fonctionnel, suppression fonctionnelle. Répéter rapidement pour Traitement (pièces jointes) et Contrôle qualité (anomalie + correction + pièce jointe), après avoir enregistré au moins un contrôle qualité de test.

- [ ] **Step 7: Vérifier la migration des dossiers existants**

Si des dossiers existaient avant cette tranche (créés lors des tests de Chantier A), confirmer qu'ils restent accessibles (avec ou sans `zone_id` selon le rapprochement de la Task 2), et que tout incident historique migré apparaît dans le registre.

- [ ] **Step 8: Régression sur le reste de l'application**

Confirmer que Zone & Cartographie, Paramètres, Missions & scénarios, Météo, Traitements, Export & projet fonctionnent comme avant cette tranche.

- [ ] **Step 9: Suite automatisée finale**

Run: `node --test drone-mission-app/tests/*.test.js`
Expected: PASS — 72 tests, 0 échec.

- [ ] **Step 10: Commit final (si des corrections ont été nécessaires)**

```bash
git add -A
git commit -m "chore: vérification manuelle du regroupement B1-B4 dans l'onglet Suivi"
```
