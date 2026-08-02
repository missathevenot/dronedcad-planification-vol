# Suivi post levé par drone — sous-menus par macro-processus (Groupe 1 : B1-B4) — Design

Premier sous-chantier de « Chantier B » (points 8-9 de la demande de modification du 2026-08-01). Chantier B couvre les 12 macro-processus listés dans `MACRO PROCESSUS.md` ; il est découpé en sous-chantiers indépendants, chacun avec son propre cycle conception → plan → implémentation.

**Groupe 1** (ce document) couvre les 4 macro-processus déjà partiellement représentés par le module Suivi actuel :
- **B1** — Planification des missions photogrammétriques
- **B2** — Acquisition des données photogrammétriques
- **B3** — Traitement photogrammétrique et production des données géospatiales
- **B4** — Contrôle qualité et certification des produits photogrammétriques

**Groupe 2** (B5-B12, hors périmètre de ce document) couvre les 8 macro-processus entièrement nouveaux (gouvernance, référentiel géospatial national, détection de changements, cadastre, fiscalité, recensement foncier, pilotage stratégique) — conception séparée à venir, un par un ou par petits groupes.

## Contexte

Le module Suivi actuel (`drone-mission-app/suivi.js`) modélise déjà, sans le nommer ainsi, une bonne partie des macro-processus B1-B4 à travers quatre tables Supabase :
- `missions_suivi` (le « dossier ») ≈ B1 Planification
- `executions_vol` ≈ B2 Acquisition
- `etapes_traitement` ≈ B3 Traitement
- `controles_qualite` ≈ B4 Contrôle qualité

Mais l'interface actuelle (onglet « Suivi post levé par drone ») présente ces données sous forme d'un « Tableau de bord opérationnel » et d'une liste plate de « Dossiers de mission », sans distinction visuelle par macro-processus, et le dossier est rattaché à une zone par texte libre (`nom_zone`/`commune`) plutôt que par lien vers la bibliothèque de zones partagées introduite dans Chantier A (table `zones`).

Les listes de champs officielles du fichier `MACRO PROCESSUS.md` pour B1-B4 ajoutent aussi des éléments absents aujourd'hui : gestion documentaire réelle (fichiers), registres multi-entrées (incidents, anomalies, corrections) plutôt que des champs texte uniques, et quelques concepts nouveaux (autorisations à solliciter, indicateurs de charge, couverture réelle de vol, affectation d'équipes/drones, budget prévisionnel).

## Objectif de cette tranche

1. Rattacher chaque dossier de suivi à une zone de la bibliothèque partagée (`zone_id`), avec migration des dossiers existants.
2. Restructurer l'onglet Suivi : retirer « Tableau de bord opérationnel » et « Dossiers de mission » (point 9), les remplacer par une navigation « zone d'abord, puis 4 sous-menus » (point 8).
3. Étendre le modèle de données pour couvrir les champs de B1-B4 listés dans `MACRO PROCESSUS.md` qui ne sont pas encore représentés.
4. Ajouter une gestion documentaire réelle (upload/consultation de fichiers) pour les livrables et rapports.

## Modèle de données (Supabase)

### `missions_suivi` (B1 — Planification)

Nouvelles colonnes :
```sql
alter table missions_suivi add column zone_id uuid references zones(id);
alter table missions_suivi add column drones_affectes text[] default '{}';
alter table missions_suivi add column budget_previsionnel_fcfa numeric;
```

- **Plans de vol** et **besoins en batteries** : déjà couverts par la colonne existante `donnees_planification` (jsonb, blob d'état `state` envoyé depuis l'app via « Envoyer vers le Suivi ») — aucun nouveau champ nécessaire.
- **Estimation des traitements photogrammétriques** : aujourd'hui `donnees_planification` ne contient que les paramètres d'entrée (`state`), pas le résultat calculé (`dernierResultats`, qui inclut l'estimation traitement). `envoyerVersSuivi()` (`app.js`) doit être étendu pour inclure un instantané de `dernierResultats` dans `donneesPlanification` au moment de l'envoi (ex. `donneesPlanification: { etat: state, resultats: dernierResultats }`) — modification mineure, cohérente avec les données déjà disponibles à cet endroit du code, sans nouveau champ de base de données.
- **Calendrier des missions** : déjà couvert par `date_planification` + `nombre_missions_prevues` + le statut de chaque `executions_vol`.
- **Affectation des drones** : `drones_affectes text[]` — liste libre d'identifiants (l'app ne modélise pas de registre de parc drone aujourd'hui, donc un champ texte multiple est proportionné).
- **Budget prévisionnel** : `budget_previsionnel_fcfa numeric`, saisi manuellement ou pré-rempli depuis le total calculé par l'onglet Paramètres au moment de l'envoi.
- **Indicateurs de charge** : calculés à la volée côté client (nouvelle fonction pure `calculerIndicateursCharge(missions)` dans `suivi.js`, même esprit que `calculerStatsTableauDeBord`), pas stockés en base.

Nouvelle table pour l'affectation d'équipes (plusieurs agents par mission) :
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

Nouvelle table pour les autorisations à solliciter (registre) :
```sql
create table autorisations_mission (
  id uuid primary key default gen_random_uuid(),
  mission_suivi_id uuid not null references missions_suivi(id) on delete cascade,
  intitule text not null,
  statut text not null default 'a_solliciter',
  date_obtention date,
  remarque text default ''
);
alter table autorisations_mission enable row level security;
create policy "lecture_tous_agents_actifs" on autorisations_mission for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on autorisations_mission for insert to authenticated with check (public.est_agent_actif());
create policy "modification_tous_agents_actifs" on autorisations_mission for update to authenticated using (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on autorisations_mission for delete to authenticated using (public.est_agent_actif());
```

### `executions_vol` (B2 — Acquisition)

Nouvelle colonne :
```sql
alter table executions_vol add column couverture_reelle jsonb;
```
- **Couverture réelle de la zone** : `couverture_reelle jsonb`, même format que `zones.geometrie` (tableau de paires `[lat, lng]`), distincte de la zone planifiée.
- **Images géoréférencées**, **rapports de mission**, **métadonnées d'acquisition** (en tant que fichiers) : via la table générique `pieces_jointes` (voir plus bas).
- **Journal de vol** : couvert au niveau dossier/mission par les champs existants (`date_reelle`, `duree_reelle_min`) — pas de journal horodaté minute par minute dans cette tranche (hors périmètre, voir plus bas).
- **Jeux de données sécurisés pour le traitement** : correspond à l'upload effectif dans `pieces_jointes` (le fichier étant dans Supabase Storage, il est de fait sauvegardé/sécurisé).

Nouvelle table pour le registre des incidents (remplace le champ unique `description_incident`, qui est conservé pour compatibilité mais n'est plus la source principale) :
```sql
create table registre_incidents_vol (
  id uuid primary key default gen_random_uuid(),
  execution_vol_id uuid not null references executions_vol(id) on delete cascade,
  date_incident date not null default current_date,
  description text not null,
  gravite text default 'mineure'
);
alter table registre_incidents_vol enable row level security;
create policy "lecture_tous_agents_actifs" on registre_incidents_vol for select to authenticated using (public.est_agent_actif());
create policy "ecriture_tous_agents_actifs" on registre_incidents_vol for insert to authenticated with check (public.est_agent_actif());
create policy "suppression_tous_agents_actifs" on registre_incidents_vol for delete to authenticated using (public.est_agent_actif());
```

### `etapes_traitement` (B3 — Traitement)

Aucune nouvelle colonne : la structure existante (`etape` énumère déjà `alignement/nuage_clairseme/nuage_dense/mns/mnt/orthophoto/modele_3d`, avec `statut`/dates/durée/taille) couvre déjà **Orthophotos**, **MNS**, **MNT**, **nuages de points clairsemés et denses**, **modèles 3D texturés**. Les **rapports de traitement**, **rapports de précision** et **métadonnées normalisées** (en tant que fichiers) passent par `pieces_jointes`.

### `controles_qualite` (B4 — Contrôle qualité)

Nouvelles tables pour les registres :
```sql
create table registre_anomalies_qualite (
  id uuid primary key default gen_random_uuid(),
  controle_id uuid not null references controles_qualite(id) on delete cascade,
  description text not null,
  date_signalement date not null default current_date,
  statut text not null default 'ouverte'
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
- **Orthophotos/MNS/MNT/nuages certifiés**, **certificats de conformité** (en tant que fichiers) : via `pieces_jointes`.
- Les résultats de contrôle (`resultat`, `commentaire`) restent sur `controles_qualite` comme aujourd'hui.

### Table générique `pieces_jointes` (documents, tous macro-processus)

```sql
create table pieces_jointes (
  id uuid primary key default gen_random_uuid(),
  table_liee text not null,
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
`table_liee` + `ligne_id` pointent vers la ligne concernée (`executions_vol`, `etapes_traitement` ou `controles_qualite`) — table générique plutôt qu'une table par type de document, pour éviter la duplication de schéma entre B2/B3/B4.

Toutes les nouvelles policies réutilisent `public.est_agent_actif()`, déjà en place et sans risque de récursion RLS (fonction `security definer` qui interroge uniquement `profils`).

## Gestion documentaire (Supabase Storage)

Bucket privé `suivi-pieces-jointes` (pas d'accès public direct). Upload depuis le sous-menu concerné (bouton « Ajouter un fichier »), limite de 20 Mo par fichier (proportionné à des orthophotos/rapports, évite qu'un envoi involontaire de nuage de points brut sature le bucket gratuit Supabase). Téléchargement via URL signée temporaire, jamais de lien public permanent. Accès contrôlé par policies Storage réutilisant `est_agent_actif()`, symétriques à celles de `pieces_jointes`. La suppression d'une ligne parente (ex. une `execution_vol`) n'entraîne pas de suppression automatique du fichier Storage correspondant dans cette tranche — un fichier orphelin est inoffensif ; le nettoyage est hors périmètre (voir plus bas).

## Migration des dossiers existants

Script SQL exécuté une fois, directement par l'orchestrateur (pas par un agent, action ponctuelle sur les données de production) :
1. Pour chaque `missions_suivi` avec `zone_id is null` : recherche une `zones` dont `nom` correspond exactement (insensible à la casse, `ilike`) à `nom_zone` ; si trouvée, `update missions_suivi set zone_id = ...`.
2. Les dossiers sans correspondance gardent `zone_id = null` et restent visibles/fonctionnels via leurs champs `nom_zone`/`commune` existants (pas de perte de données, pas de blocage — rattachement manuel possible plus tard, hors périmètre de cette tranche).
3. Pour chaque `executions_vol` avec `description_incident` non vide : insertion d'une ligne dans `registre_incidents_vol` (`description = description_incident`, `date_incident = date_reelle` ou date du jour si absente) pour préserver l'historique. `description_incident` reste en base (colonne gelée, plus utilisée par la nouvelle UI) plutôt que supprimée, pour rester réversible.

## Interface utilisateur

Dans l'onglet « Suivi post levé par drone », après connexion :
1. **Sélecteur de zone** (même mécanique `<input> + <datalist>` que l'onglet Zone & Cartographie, alimenté par `Zones.listerZones()`) remplace la liste plate actuelle de dossiers.
2. Une fois une zone choisie : si plusieurs dossiers de suivi existent pour cette zone (`zone_id` correspondant), un sélecteur secondaire de dossier apparaît (libellé par date de planification) ; s'il n'y en a qu'un, il se charge directement ; s'il n'y en a aucun, message « Aucun dossier de suivi pour cette zone » (un dossier se crée via « Envoyer vers le Suivi » depuis Zone & Cartographie, mécanisme inchangé, désormais avec `zone_id` rempli directement).
3. Le dossier ouvert affiche **4 sous-onglets internes** : Planification, Acquisition, Traitement, Contrôle qualité — chacun avec ses champs propres, ses registres (listes avec ajout/suppression d'entrées) et une zone d'upload/liste de pièces jointes le cas échéant.
4. Les groupes « Tableau de bord opérationnel » et « Dossiers de mission » sont retirés (point 9).

## Droits d'accès

Aucune restriction de rôle sur B1-B4 : tout agent actif peut lire/écrire sur les 4 sous-menus, comme le comportement actuel du module Suivi. Toutes les nouvelles tables réutilisent `est_agent_actif()`.

## Compatibilité / non-régression

- `zones.js`, l'onglet Zone & Cartographie et le reste de l'application (météo, traitement, exports) ne sont pas modifiés par cette tranche.
- `envoyerVersSuivi()` (Chantier A) doit être étendu pour transmettre `state.zone.id` en plus des champs déjà envoyés, afin que le nouveau dossier ait `zone_id` rempli dès sa création — modification minimale, pas de changement de comportement pour l'utilisateur.
- Les dossiers existants restent consultables même sans `zone_id` (repli sur `nom_zone`/`commune`).

## Hors périmètre de cette tranche

- Macro-processus B5-B12 (conception séparée à venir, un par un ou par petits groupes).
- Toute restriction de droits par rôle (confirmé : aucune restriction pour B1-B4).
- Nettoyage automatique des fichiers Storage orphelins après suppression d'une ligne parente.
- Journal de vol structuré et horodaté minute par minute (le suivi reste au niveau dossier/mission).
- Rattachement manuel a posteriori des dossiers sans correspondance de zone trouvée lors de la migration.
