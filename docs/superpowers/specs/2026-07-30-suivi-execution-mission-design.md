# Suivi d'exécution de mission — Design

Première tranche du futur module « Suivi opérationnel, cadastral et fiscal » de DroneDCAD Planification Vol. Cette tranche prend la forme d'un nouvel onglet **« Suivi post levé par drone »**. Ce document ne couvre que cette première tranche ; les suivantes (mise à jour cadastrale, recoupement fiscal, identification des contribuables, tableaux de bord consolidés) seront spécifiées séparément une fois celle-ci construite et testée.

## Contexte

DroneDCAD Planification Vol est une PWA JavaScript vanilla (pas de framework, pas de backend), qui couvre aujourd'hui la planification d'une mission (zone, batteries, traitement estimé, météo) mais s'arrête à la planification : rien ne trace ce qui se passe réellement une fois le drone envoyé sur le terrain. Cette tranche ajoute le premier maillon d'une chaîne de suivi plus large (cf. cahier des charges PIAD-CF) : suivre l'exécution réelle des vols, l'avancement réel du traitement photogrammétrique, et le résultat du contrôle qualité des livrables — jusqu'à un premier tableau de bord opérationnel.

Contrairement aux blocs précédents (Batteries, Performance/Traitement, Météo), ce module introduit la **première dépendance à un compte utilisateur et à une base de données partagée** : plusieurs agents (télépilotes, techniciens, responsables) doivent pouvoir mettre à jour et consulter les mêmes dossiers, dans le temps, depuis des postes différents. Tout le reste de l'application (planification, cartographie, batteries, traitement estimé, météo, export) reste strictement inchangé et continue de fonctionner hors-ligne sans compte, exactement comme aujourd'hui.

## Objectif de cette tranche

1. Permettre l'envoi d'un projet planifié dans DroneDCAD vers un espace de suivi partagé (« dossier de mission »).
2. Permettre à des agents authentifiés de mettre à jour le statut réel de chaque vol, l'avancement de chaque étape de traitement, et le résultat du contrôle qualité des livrables.
3. Donner une première vue consolidée (tableau de bord opérationnel) sur l'avancement de l'ensemble des dossiers.

## Décision d'architecture retenue

- **Backend : Supabase** (PostgreSQL managé + authentification + Row Level Security), provisionné comme un projet Supabase dédié et indépendant — pas de lien avec un éventuel projet Supabase d'une autre application de la Direction du Cadastre. Choisi plutôt qu'un backend Vercel entièrement fait-maison car il fournit l'authentification et le contrôle d'accès par rôle nativement (via RLS), sans code serveur à écrire ni maintenir — décisif pour un module qui touchera des données sensibles.
- Le frontend appelle Supabase **directement** depuis le navigateur via la librairie cliente `@supabase/supabase-js`, vendorisée localement dans `libs/supabase.js` (UMD build), suivant le même principe que les autres librairies déjà vendorisées dans l'app (`leaflet.js`, `chart.umd.js`, `xlsx.full.min.js`, `jspdf`, `html2canvas`).
- L'URL du projet Supabase et sa clé publique (« anon key ») sont codées en dur dans le nouveau module `suivi.js` : c'est le seul choix possible en l'absence de tout mécanisme de build/variables d'environnement dans cette app statique, et c'est l'usage prévu par Supabase pour ce type de clé (la sécurité réelle est assurée par les politiques RLS côté serveur, pas par le secret de cette clé).
- Le reste de l'application n'est pas touché : même déploiement GitHub Pages, même absence de build, même fonctionnement hors-ligne pour tout ce qui existe déjà.

## Architecture applicative

- Nouveau fichier `suivi.js`, module IIFE `Suivi` (même pattern que `Batteries`/`Traitement`/`Meteo`) :
  - Initialisation du client Supabase.
  - Fonctions d'authentification (`connexion`, `deconnexion`, `sessionActuelle`).
  - Fonctions CRUD pures orientées métier : `creerDossierMission(donnees)`, `listerDossiers(filtres)`, `mettreAJourExecutionVol(id, donnees)`, `mettreAJourEtapeTraitement(id, donnees)`, `mettreAJourControleQualite(id, donnees)`, `recupererTableauDeBord()`.
  - Toute la logique de mapping français camelCase (JS) ↔ snake_case (Postgres) est isolée dans ce fichier, comme `meteo.js` isole le mapping avec l'API Open-Meteo.
- Chargé dans `index.html` après `meteo.js`, avant `app.js`.
- Nouvel onglet de navigation **« Suivi post levé par drone »**, positionné en dernier dans la barre de navigation, juste après l'onglet « Export & projet ». Il a son propre écran de connexion : c'est le seul endroit de l'application qui exige un compte. Les autres onglets restent accessibles sans connexion, y compris si l'utilisateur n'a pas de compte Supabase.

## Modèle de données (PostgreSQL / Supabase)

```sql
-- Profils agents, liés à auth.users (authentification native Supabase)
create table profils (
  id            uuid primary key references auth.users(id),
  nom_complet   text not null,
  role          text not null check (role in ('telepilote','technicien_traitement','responsable','admin')),
  statut        text not null default 'actif' check (statut in ('actif','inactif')),
  created_at    timestamptz default now()
);

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
  donnees_planification     jsonb not null,   -- snapshot complet exporté depuis DroneDCAD (paramètres, résultats calculés)
  historique                jsonb not null default '[]',
  created_by                uuid references profils(id),
  created_at                timestamptz default now()
);

-- Un vol réellement exécuté (ou tenté) par dossier
create table executions_vol (
  id                 uuid primary key default gen_random_uuid(),
  mission_suivi_id   uuid not null references missions_suivi(id) on delete cascade,
  numero_mission     integer not null,          -- correspond au n° de mission planifiée dans DroneDCAD
  statut             text not null default 'planifiee'
                      check (statut in ('planifiee','executee','reportee','incident','annulee')),
  date_reelle        date,
  duree_reelle_min   numeric,
  photos_reelles     integer,
  description_incident text default '',
  telepilote_id      uuid references profils(id),
  updated_at         timestamptz default now()
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
```

**Row Level Security (résumé des politiques)** :
- Tout utilisateur authentifié avec un `profil` actif peut **lire** l'ensemble des dossiers, exécutions, étapes et contrôles (transparence interne à l'équipe — pas de cloisonnement par service à ce stade).
- `executions_vol` : seul le `telepilote_id` assigné, ou un `responsable`/`admin`, peut **modifier** une ligne.
- `etapes_traitement` : seul le `technicien_id` assigné, ou un `responsable`/`admin`, peut **modifier** une ligne.
- `controles_qualite` : chaque contrôle est un **nouvel enregistrement** (jamais modifié après coup), créé par le `controleur_id` qui l'effectue ou par un `responsable`/`admin` — ce choix conserve l'historique complet des recontrôles (ex. un livrable « à reprendre » puis contrôlé de nouveau plus tard comme « conforme »), plutôt que d'écraser le résultat précédent.
- `missions_suivi` : seuls `responsable` et `admin` peuvent **créer** ou modifier le statut global d'un dossier.
- `profils` : chaque agent peut lire son propre profil ; seul `admin` peut créer/modifier des profils.

## Interface utilisateur

Nouvel onglet **« Suivi post levé par drone »** :
- **Écran de connexion** (email + mot de passe Supabase) si aucune session active ; sinon accès direct.
- **Liste des dossiers** : tableau filtrable par statut / commune / date, avec pour chaque ligne : nom de zone, commune, statut global, taux d'avancement (calculé), agent référent.
- **Détail d'un dossier**, avec 3 sous-onglets :
  - *Exécution des vols* : une carte par vol planifié (numéro, statut, date réelle, durée, photos, incident) avec formulaire de mise à jour.
  - *Traitement* : une carte par étape (statut, dates, durée, taille) avec formulaire de mise à jour.
  - *Contrôle qualité* : une carte par livrable (résultat, commentaire) avec formulaire de mise à jour.
- **Tableau de bord opérationnel** (page d'accueil du nouvel onglet) : taux d'avancement global (dossiers terminés / total), volumétrie totale produite (somme des tailles réelles), nombre de vols en incident, répartition des dossiers par statut — réutilise le pattern de cartes déjà utilisé dans le tableau de bord existant de l'app.

## Intégration avec l'existant

- Nouveau bouton dans l'onglet **« Export & projet »** : **« Envoyer vers le Suivi post levé par drone »**.
  - Si l'utilisateur n'est pas connecté, ouvre l'écran de connexion du nouvel onglet.
  - Une fois connecté, crée un enregistrement `missions_suivi` à partir de l'état courant du projet : `nom_zone` = `state.nomZone`, `commune` = `state.meteo.commune` (le seul champ commune existant dans l'app, saisi dans l'onglet Météo — vide si jamais renseigné), `superficie_ha` = `dernierResultats.surfaceHa`, `nombre_missions_prevues` = `dernierResultats.nbMissionsAutomatiques` (déjà calculé par `recalculer()` et mis à l'échelle de la flotte complète — pas de nouveau calcul nécessaire). Un enregistrement `executions_vol` est créé par mission planifiée (statut initial `planifiee`) et un enregistrement `etapes_traitement` par étape de traitement pour ce dossier (statut initial `a_faire`).
  - `donnees_planification` stocke un instantané complet de l'état du projet au moment de l'envoi (mêmes données que celles sauvegardées dans le fichier `.json` du projet), pour traçabilité — mais cet instantané n'est plus modifié ensuite ; seules les tables `executions_vol`/`etapes_traitement`/`controles_qualite` évoluent.
- Aucune autre partie de l'application n'est modifiée : `calculs.js`, `batteries.js`, `performance.js`, `traitement.js`, `meteo.js`, `cartographie.js`, `export.js` restent inchangés.

## Erreurs / validations

- Envoi vers le suivi sans zone dessinée → bouton désactivé ou toast d'avertissement (cohérent avec le pattern existant).
- Échec réseau / Supabase indisponible → toast d'erreur clair, aucune perte de données locales (le projet reste sauvegardable en `.json` comme avant, indépendamment du suivi).
- Identifiants de connexion invalides → message d'erreur explicite sur l'écran de connexion.
- Tentative de modification d'un enregistrement hors de son périmètre de rôle → bloquée par la politique RLS côté serveur ; le frontend n'affiche pas les actions de modification non autorisées (pas seulement une erreur après coup).

## Extensibilité (pour les tranches suivantes)

- `missions_suivi` est conçue comme le point d'ancrage de toute la suite de la chaîne : les futures tables (parcelles, biens imposables, contribuables, anomalies fiscales) référenceront `mission_suivi_id` ou la commune/zone associée.
- Le champ `role` de `profils` est une simple valeur texte contrainte par `check` : ajouter un rôle futur (ex. `agent_fiscal`, `agent_recensement`) ne nécessite qu'une migration de contrainte, pas de refonte.
- Le tableau de bord de cette tranche est le premier étage du futur tableau de bord consolidé (Module 15 du cahier des charges PIAD-CF) ; il sera étendu, pas remplacé.

## Compatibilité / non-régression

- Aucune fonctionnalité existante n'est modifiée ; toutes restent utilisables hors-ligne sans compte, exactement comme avant cette tranche.
- Le mode hors-ligne PWA reste garanti pour tout le reste de l'application ; seul l'onglet Suivi post levé par drone nécessite une connexion, au même titre que l'actualisation météo.
- Aucun champ existant de `state` (projet DroneDCAD) n'est modifié ; l'envoi vers le suivi est une action de lecture seule sur `state`, purement additive.

## Hors périmètre de cette tranche

- Mise à jour cadastrale (parcelles, bâtiments), recoupement cadastral-fiscal, recensement foncier assisté, identification des biens imposables, évaluation du potentiel fiscal, tableaux de bord cadastral/fiscal consolidés — tranches suivantes.
- Gestion des ressources opérationnelles au sens large (drones, véhicules, RTK, maintenance) — non couverte ici ; seuls les statuts liés à l'exécution des vols et au traitement le sont.
- Notifications automatiques, rappels d'échéance — non couverts dans cette tranche.
