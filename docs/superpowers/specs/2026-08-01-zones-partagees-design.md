# Bibliothèque de zones partagées + réorganisation des onglets — Design

Premier des deux chantiers issus de la demande de modification de l'application (points 1 à 7). Le second chantier — sous-menus du « Suivi post levé par drone » par macro-processus (points 8-9 de la demande) — fera l'objet d'une conception séparée, une fois celui-ci construit et testé.

## Contexte

Jusqu'ici, la « zone de la mission » était une donnée locale et éphémère : un simple champ texte (`nomZone`) et une géométrie dessinée sur la carte, jamais nommément conservés d'une session à l'autre autrement que via la sauvegarde de projet complète (`.json`). Cette tranche transforme la zone en une **entité nommée, réutilisable et partagée entre agents**, stockée dans la base Supabase déjà utilisée par le module « Suivi post levé par drone ».

**Changement de principe assumé** : contrairement aux blocs précédents (Batteries, Traitement, Météo, Suivi), qui préservaient un usage hors-ligne du cœur de l'application, la gestion de zone devient une fonctionnalité **qui nécessite une connexion** — consulter, enregistrer, charger ou supprimer une zone de la bibliothèque partagée exige d'être authentifié, exactement comme l'envoi d'un dossier vers le Suivi aujourd'hui. Dessiner une zone à la volée sur la carte et voir les calculs se mettre à jour reste possible sans connexion (rien ne change à `Calc`/`Batteries`/`Traitement`), mais cette zone ne pourra pas être nommée/conservée dans la bibliothèque tant que l'utilisateur n'est pas connecté.

## Objectif de cette tranche

1. Remplacer le champ libre « Nom de la zone » par une bibliothèque de zones nommées, sauvegardables et rechargeables, partagée entre agents.
2. Permettre de retrouver une zone par sa commune.
3. Réorganiser les onglets « Zone & paramètres » et « Cartographie » : la gestion de zone quitte les paramètres pour rejoindre la cartographie, qui devient le point d'entrée unique pour tout ce qui concerne la zone de mission.
4. Répercuter la description et la commune dans les exports (PDF, Excel).

## Modèle de données (Supabase)

Nouvelle table dans le projet Supabase déjà utilisé par le Suivi (`dronedcad-suivi`) :

```sql
create table zones (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null,
  commune      text default '',
  description  text default '',
  geometrie    jsonb not null,   -- tableau de paires [lat, lng], format Carto.getZone()
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

Réutilise la fonction `public.est_agent_actif()` déjà créée pour corriger la récursion RLS du module Suivi (cf. `2026-07-30-suivi-execution-mission-design.md`). Écriture ouverte à tout agent actif, comme la lecture — pas de restriction par rôle (cohérent avec le principe déjà en place sur les dossiers de suivi : transparence interne à l'équipe).

**Portée** : seule la géométrie de la zone de survol principale est enregistrée. Les zones d'exclusion et le point de décollage restent, comme aujourd'hui, propres à la session de planification en cours et ne font pas partie de la bibliothèque de zones.

## Nouveau module applicatif : `zones.js`

Nouveau fichier `drone-mission-app/zones.js`, module IIFE `Zones`, même pattern que `suivi.js`. Réutilise le même projet Supabase (même URL, même clé publique) que `suivi.js` — pas de second projet. `Suivi.initClient()` est aujourd'hui une fonction interne non exportée (choix délibéré du module Suivi) ; cette tranche l'ajoute à l'objet exporté de `suivi.js` (simple extension de la liste d'export, aucun changement de comportement) afin que `zones.js` puisse réutiliser la même instance de client Supabase plutôt que d'en recréer une seconde avec les mêmes identifiants codés en dur à deux endroits :
- `listerZones()` : retourne toutes les zones (pour peupler la liste déroulante et la commune).
- `creerZone(donnees)`, `mettreAJourZone(id, donnees)`, `supprimerZone(id)` (pas de `recupererZone(id)` séparé : la liste complète, chargée une fois à l'ouverture de l'onglet via `listerZones()`, est conservée côté client et la zone choisie y est retrouvée par nom — évite un aller-retour réseau supplémentaire à chaque sélection).
- Fonction pure `mapperZoneVersJs(row)` (mapping snake_case → camelCase, testable).
- Fonction pure `communesDistinctes(zones)` (liste triée des communes non vides présentes parmi les zones, testable).

## Interface utilisateur

### Onglet « Zone & Cartographie » (renommé depuis « Cartographie »)

Le groupe *Outils* est renommé **« Zone »** et s'enrichit, en tête, des champs suivants (dans cet ordre) :

1. **Localité ou Commune** — champ texte associé à un `<datalist>` alimenté dynamiquement par `Zones.communesDistinctes()` (même mécanique que le champ « Nom de la zone » ci-dessous : liste déroulante de suggestions, tout en restant modifiable pour saisir une commune encore jamais enregistrée lors de la création d'une nouvelle zone). Sélectionner ou taper une commune filtre les zones proposées au champ suivant ; laisser le champ vide n'applique aucun filtre.
2. **Nom de la zone** — champ texte associé à un `<datalist>` (permet de taper un nouveau nom OU de choisir une zone existante dans la liste suggérée, filtrée par la commune sélectionnée). Choisir un nom qui correspond exactement à une zone existante charge automatiquement sa géométrie sur la carte (`Carto.setZone(...)`), sa commune et sa description.
3. **Description** — zone de texte multi-lignes (`<textarea>`).
4. Boutons **Enregistrer** et **Supprimer** (à la suite des outils de dessin existants).

Les outils déjà présents (Dessiner la zone, Zone d'exclusion, Point de décollage, Importer, Calques, Zones d'exclusion) restent inchangés, simplement précédés de ce nouveau bloc.

**Comportement Enregistrer/Supprimer** :
- *Enregistrer* : si le nom saisi correspond à une zone déjà chargée (via le datalist), met à jour cette zone (géométrie actuelle du dessin + commune + description). Sinon, crée une nouvelle zone. Nécessite une zone dessinée (≥ 3 points) et une connexion active ; sinon toast d'avertissement (et redirection vers l'écran de connexion du Suivi si non connecté, comme pour « Envoyer vers le Suivi »).
- *Supprimer* : supprime la zone actuellement chargée de la bibliothèque partagée (nécessite qu'une zone existante soit chargée) et réinitialise les champs/la carte.

### Onglet « Paramètres » (renommé depuis « Zone & paramètres »)

Le groupe *Zone de la mission* est retiré de cet onglet. Sont supprimés avec lui : le champ *Superficie de référence (ha)*, les boutons *Générer une zone carrée* et *Effacer la zone*, et le texte d'aide sur l'import KML/GeoJSON/Shapefile (cette aide n'a plus lieu d'être puisque le dessin/import se fait désormais exclusivement depuis l'onglet Zone & Cartographie, qui contient déjà ces outils). Les autres groupes (Drone, Caméra, Paramètres de vol, Estimation des coûts, Configuration PC) restent inchangés.

### Ordre des onglets

1. Zone & Cartographie
2. Paramètres
3. Missions & scénarios
4. Conditions météo
5. Estimation des traitements
6. Export & projet
7. Tableau de bord
8. Suivi post levé par drone

## Modèle d'état applicatif (`app.js`)

Remplace le champ plat `state.nomZone` (string) par un objet `state.zone` :

```js
state.zone = { id: null, nom: '', commune: '', description: '' }
```

`id` est `null` tant qu'aucune zone existante n'est chargée (zone dessinée librement, non enregistrée) ; il porte l'identifiant Supabase une fois une zone chargée depuis la bibliothèque ou nouvellement enregistrée.

Le champ **Commune** de l'onglet Météo (`state.meteo.commune`) n'est pas modifié par cette tranche — il reste un champ libre indépendant de la commune de la zone, saisi séparément par l'utilisateur pour les besoins de la prévision météo. En revanche, l'envoi vers le Suivi (`envoyerVersSuivi`, déjà existant) est mis à jour pour lire `state.zone.nom` / `state.zone.commune` (source désormais plus fiable) au lieu de `state.nomZone` / `state.meteo.commune`.

**Anciens projets `.json`** : un fichier sauvegardé avant cette tranche contient `state.nomZone` (string) et pas de `state.zone`. Au rechargement, si `state.zone` est absent, il est reconstruit comme `{ id: null, nom: state.nomZone || '', commune: '', description: '' }` — repli silencieux, même mécanisme que pour les autres modules.

## Exports

- **PDF** (`export.js`, `exportPDF`) : la ligne « Zone : … » est suivie de deux nouvelles lignes « Commune : … » et « Description : … » (« Non renseignée » si vide), dans le même style que la ligne existante.
- **Excel** (`export.js`, `resumeVersLignes`) : ajout d'une section « Zone » en tête du résumé (avant « Paramètres drone »), avec les lignes Nom, Commune, Description.

## Erreurs / validations

- Tentative d'enregistrer sans zone dessinée (< 3 points) → toast d'avertissement, pas d'appel réseau.
- Tentative d'enregistrer/supprimer sans connexion → redirection vers l'écran de connexion du Suivi (même pattern que le bouton « Envoyer vers le Suivi »).
- Tentative de supprimer sans zone chargée depuis la bibliothèque → toast d'avertissement.
- Échec réseau lors du chargement de la liste de zones/communes → toast d'erreur, listes vides plutôt que plantage.

## Compatibilité / non-régression

- Le moteur de calcul (`Calc`, `Batteries`, `Traitement`, `Meteo`) n'est pas touché : dessiner une zone et voir les résultats se recalculer reste possible sans connexion.
- Les onglets Missions & scénarios, Conditions météo, Estimation des traitements, Export & projet, Tableau de bord, Suivi post levé par drone ne sont pas modifiés dans leur contenu (seul l'ordre des onglets change).
- Le module `suivi.js` et ses tables existantes ne sont pas modifiés ; `zones.js` réutilise uniquement le client Supabase déjà initialisé par `Suivi.initClient()`.

## Hors périmètre de cette tranche

- Sous-menus du Suivi par macro-processus (points 8-9 de la demande initiale) — conception séparée à venir.
- Zones d'exclusion et point de décollage ne font pas partie de la bibliothèque de zones enregistrées.
- Pas de restriction de droits d'écriture par rôle sur les zones (tout agent actif peut créer/modifier/supprimer).
