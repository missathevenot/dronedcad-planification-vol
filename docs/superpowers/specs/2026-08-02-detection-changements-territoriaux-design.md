# Suivi post levé par drone — Détection des changements territoriaux (Groupe 2, premier sous-chantier) — Design

Premier sous-chantier détaillé de **Groupe 2** de Chantier B (les 12 macro-processus de `MACRO PROCESSUS.md`, dont Groupe 1 / B1-B4 a déjà été livré — voir `docs/superpowers/specs/2026-08-02-suivi-macro-processus-groupe1-design.md`).

## Cadrage de Groupe 2 (décisions actées avant ce document)

Groupe 2 couvrait à l'origine 8 macro-processus nationaux. Après discussion, le périmètre retenu pour Drones DCAD est réduit à **ce qui est rattachable à un dossier de zone existant** (même logique que B1-B4), en excluant ce qui est intrinsèquement transversal/national :

**Retirés définitivement du périmètre de l'application** (aucune conception ni implémentation prévue) :
- Gouvernance et pilotage du projet (COPIL) — décisions/programme à l'échelle du projet global, pas d'une zone.
- Gestion du référentiel géospatial et de la géodatabase nationale — catalogue agrégeant toutes les zones.
- Pilotage stratégique, gouvernance, intelligence décisionnelle et tableaux de bord — le texte source parle explicitement d'« indicateurs nationaux ».

**Retenus, dans l'ordre de conception** — chacun rattaché au dossier de zone (`missions_suivi`) existant, chacun son propre cycle conception → plan → implémentation :
1. **B7 — Détection automatique des changements et analyse intelligente du territoire** (ce document)
2. B8 — Mise à jour du cadastre et gestion du cycle de vie des objets cadastraux *(recadré : seule la partie « mise à jour pour cette zone » — parcelles/bâtiments/historique/journal de validation — est retenue ; le « référentiel cadastral consolidé » national est hors périmètre)*
3. B9 — Recoupement cadastral-fiscal et identification des écarts *(le texte source précise déjà « potentiel fiscal par zone »)*
4. B10 — Gestion numérique du recensement foncier et des opérations de terrain
5. B11 — Identification des biens imposables, évaluation du potentiel fiscal et aide à la décision *(recadré : registre des biens imposables + estimation du potentiel fiscal pour cette zone ; les « scénarios de mobilisation des recettes » et « tableaux de bord décisionnels » agrégés sont hors périmètre)*

## B7 — Détection des changements : contexte

Champs officiels (`MACRO PROCESSUS.md`) : couche des nouvelles constructions ; couche des extensions ; couche des démolitions ; couche des changements d'occupation du sol ; couche des anomalies cadastrales ; couche des anomalies fiscales ; cartes de priorité d'intervention ; rapports d'analyse territoriale.

Une zone peut avoir plusieurs dossiers de suivi dans le temps (`listerDossiers({ zoneId })` le confirme). Le principe retenu : comparer le dossier **actuel** à un dossier **antérieur** de la même zone.

**Méthode retenue : annotation manuelle assistée**, pas de détection automatique par traitement d'image (hors de portée d'une PWA client-side — nécessiterait un pipeline de traitement d'image externe). L'agent dessine les polygones de changement sur le fond de carte OSM/CARTO standard existant, en se référant visuellement au fichier orthophoto (déjà géré comme pièce jointe téléchargeable, pas affiché comme calque géoréférencé sur la carte).

Les 6 « couches » de changement sont modélisées comme un seul champ `type` sur une table unique (même esprit que `registre_incidents_vol` / `registre_anomalies_qualite` du Groupe 1), plutôt que 6 tables séparées.

Note technique : l'onglet Suivi n'affiche aujourd'hui aucune carte dans ses sous-onglets (la carte Leaflet avec outils de dessin n'existe que dans le panneau « Zone & Cartographie », `cartographie.js`). Ce sous-chantier introduit donc une deuxième petite instance de carte Leaflet, dédiée à ce sous-onglet, avec un seul outil (dessiner un polygone), sans les fonctionnalités de zones d'exclusion / point de décollage / import du panneau principal.

## Modèle de données (Supabase)

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

- `mission_suivi_id` : le dossier actuel sur lequel on travaille.
- `dossier_reference_id` : optionnel (nullable), pointe vers le dossier antérieur de la même zone servant de référence « avant ». Un premier levé d'une zone n'a pas d'antérieur.
- Une ligne = un polygone dessiné, sa catégorie, sa priorité d'intervention. `geometrie` au même format `[[lat,lng], ...]` que `zones.geometrie` / `couverture_reelle` — réutilisable avec l'outil de dessin Leaflet existant (`zones.js`).

## Interface

Nouveau sous-onglet **« Détection des changements »** dans le dossier de zone (aux côtés de Planification/Acquisition/Traitement/Contrôle qualité) :

1. **Sélecteur de dossier de référence** — liste déroulante des autres dossiers de la même zone (`listerDossiers({ zoneId })`, dossier courant exclu), pour choisir le levé « avant ». Optionnel.
2. **Carte de dessin** — fond OSM/CARTO standard, outil « dessiner un polygone de changement ». À la validation d'un tracé, formulaire : type (les 6 catégories), priorité (faible/moyenne/haute), description libre.
3. **Carte de priorité d'intervention** — la même carte affiche tous les polygones déjà enregistrés pour ce dossier, colorés par priorité (rouge = haute, orange = moyenne, vert = faible). Pas d'artefact séparé : une vue de la carte existante.
4. **Liste des changements** sous la carte — tableau filtrable par type/priorité, une ligne par entrée, avec suppression (même pattern que le registre d'anomalies du Groupe 1).

## Rapport d'analyse territoriale

Nouvelle fonction d'export dans `export.js` (même moteur PDF que les rapports existants), déclenchée par un bouton dans le sous-onglet. Contenu : identification zone/dossier, dossier de référence utilisé (le cas échéant), synthèse par type et par priorité, puis liste détaillée des changements avec description et date. Généré à la demande, pas stocké en base.

## Gestion des erreurs

- Un polygone doit avoir au moins 3 points et un type sélectionné avant l'enregistrement ; sinon message d'erreur, pas d'insertion.
- Garde anti-double-soumission sur le formulaire d'ajout (même pattern que pour les incidents/anomalies du Groupe 1).
- Réinitialisation de l'outil de dessin et de la sélection de dossier de référence si l'agent change de zone/dossier en cours de dessin (même garde que le changement de zone déjà en place dans Suivi).
- RLS identique aux autres registres du Groupe 1 (lecture/écriture/modification/suppression pour tout agent actif).

## Tests

Nouvelles fonctions pures ajoutées à `suivi.js`, testées dans `tests/suivi.test.js`, même style que l'existant :
- `mapperChangementVersJs` — conversion snake_case → camelCase de la ligne Supabase.
- `filtrerChangements(changements, { type, priorite })` — filtrage pour la liste affichée.
- `calculerStatsChangements(changements)` — comptage par type et par priorité, utilisé à la fois pour l'en-tête de la liste et pour la synthèse du rapport PDF.

## Hors périmètre de cette tranche

- Détection automatique par traitement d'image (pixel-diff) — nécessiterait un pipeline externe.
- Affichage de l'orthophoto géoréférencée comme calque sur la carte (`Leaflet ImageOverlay`) — les orthophotos restent de simples fichiers téléchargeables.
- Toute vue agrégée multi-zones des changements détectés (relève du macro-processus « Référentiel géospatial national », hors périmètre de l'application — voir cadrage de Groupe 2 ci-dessus).
