# Suivi post levé par drone — Mise à jour du cadastre (B8, Groupe 2) — Design

Deuxième sous-chantier détaillé de **Groupe 2** de Chantier B, après B7 (Détection des changements territoriaux, livré — voir `docs/superpowers/specs/2026-08-02-detection-changements-territoriaux-design.md`).

## Cadrage

**B8 — Mise à jour du cadastre et gestion du cycle de vie des objets cadastraux**, recadré (comme B7) à ce qui est rattachable au dossier de zone en cours. Champs officiels retenus (`MACRO PROCESSUS.md`) : parcelles mises à jour ; bâtiments cadastraux mis à jour ; historique des modifications ; journal des validations. Explicitement hors périmètre : « nouvelles couches cadastrales » (traitée comme simple registre, pas de carte dédiée — voir « Hors périmètre ») et « référentiel cadastral consolidé » (vue nationale agrégée, même raison d'exclusion que le référentiel géospatial national écarté avant B7).

**Principe retenu** (décision structurante) : un objet cadastral n'existe que comme officialisation d'un changement territorial déjà détecté en B7 — pas de dessin indépendant. Ceci évite de redessiner ce qui a déjà été repéré et modélise directement l'idée de « cycle de vie » : un changement détecté (B7) devient, sur décision de l'agent, un objet cadastral officiel (B8) avec son propre statut de validation et son historique.

Comme pour B7, ce macro-processus est mis en œuvre **sans authentification** (retirée du module Suivi entre-temps) : la notion de « qui valide » n'existe pas de façon fiable, donc le statut de validation n'enregistre ni auteur ni identité — juste un état et un historique daté.

## Modèle de données (Supabase)

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

- `changement_id` : référence le changement B7 dont l'objet est issu. Nullable en base pour flexibilité future, mais dans ce périmètre toujours renseigné — la seule façon de créer un objet cadastral est d'officialiser un changement.
- `type` : `parcelle` ou `batiment` — table unique avec un champ type, même esprit que `changements_territoriaux` (B7) plutôt que deux tables séparées.
- `geometrie` : héritée du changement source au moment de l'officialisation, **non modifiable ensuite**. Le cycle de vie suivi par cette tranche est le statut de l'objet, pas sa forme géométrique — cohérent avec l'absence d'outil d'édition de polygone existant dans B7.
- `historique_objets_cadastraux` couvre à la fois « historique des modifications » et « journal des validations » du texte source : une seule table plutôt que deux, une entrée = date + description, avec `nouveau_statut` renseigné uniquement quand l'entrée correspond effectivement à un changement de statut.
- RLS directement publique dès la création (contrairement à B7, conçu avant le retrait de l'authentification puis corrigé après coup) — pas de politique intermédiaire à ouvrir dans une tranche ultérieure.

## Interface

**Dans le sous-onglet B7 existant** (« Détection des changements », fonction `renderListeChangements`) : chaque carte de changement affiche un bouton **« Officialiser en objet cadastral »**, remplacé par un badge **« Déjà officialisé »** si un objet cadastral référence déjà ce changement. Le clic ouvre un petit formulaire en ligne : type (parcelle/bâtiment), référence, description (pré-remplie depuis celle du changement), avec Confirmer/Annuler. La géométrie est reprise automatiquement du changement — aucun champ ni carte pour ça dans ce formulaire.

Une fois officialisé, le bouton **« Supprimer »** du changement disparaît aussi (remplacé par la mention « non supprimable ») : `changement_id` est une clé étrangère simple (sans `on delete cascade`), donc supprimer un changement déjà lié à un objet cadastral échouerait en base — autant l'empêcher proprement dans l'interface plutôt que de laisser remonter une erreur Postgres brute.

**Nouveau 6e sous-onglet « Mise à jour du cadastre »** (`data-sous-onglet="cadastre"`, même pattern de navigation que les 5 précédents) : liste les objets cadastraux du dossier. Chaque carte affiche type, référence, badge de statut coloré (en attente = neutre, validé = succès, rejeté = danger), description, puis :
- Un sélecteur de statut (En attente / Validé / Rejeté) + un champ description + bouton **Enregistrer**, qui met à jour le statut de l'objet et ajoute une entrée à l'historique.
- L'historique de l'objet affiché en dessous (liste chronologique : date, description, nouveau statut le cas échéant), même pattern d'affichage que le registre d'anomalies du Contrôle qualité (Groupe 1).

Pas de filtres (type/statut) sur ce registre dans cette tranche — les registres du Groupe 1 n'en avaient pas non plus ; B7 en avait car son volume de changements peut être plus important. Pas de rapport PDF dédié, cohérent avec le recadrage déjà acté (pas de tableau de bord agrégé pour B8).

## Fonctions (`suivi.js`)

Pures, testées dans `tests/suivi.test.js` :
- `mapperObjetCadastralVersJs(row)` — conversion snake_case → camelCase.
- `mapperHistoriqueCadastralVersJs(row)` — conversion snake_case → camelCase.

Impures :
- `listerObjetsCadastraux(missionSuiviId)`
- `officialiserChangement(changementId, missionSuiviId, { type, reference, description, geometrie })` — crée la ligne `objets_cadastraux` puis une première entrée d'historique (« Objet créé à partir du changement officialisé. », `nouveau_statut: 'en_attente'`).
- `listerHistoriqueObjetCadastral(objetCadastralId)`
- `mettreAJourStatutObjetCadastral(objetCadastralId, nouveauStatut, description)` — met à jour `objets_cadastraux.statut` et ajoute une entrée d'historique.

## Gestion des erreurs

- Référence obligatoire avant de confirmer l'officialisation d'un changement (sinon message d'erreur, pas d'insertion).
- Garde anti-double-soumission sur les boutons Confirmer (officialisation) et Enregistrer (mise à jour de statut).
- Réinitialisation du formulaire d'officialisation et de l'état d'édition si l'agent change de dossier/zone en cours de saisie — couverte structurellement par le re-rendu complet de `suiviDetailHost`, comme pour les sous-onglets précédents.
- RLS publique dès la création (voir modèle de données) — pas de vérification de session, cohérent avec le reste du module Suivi.

## Hors périmètre de cette tranche

- Carte dédiée pour B8 — les géométries des objets cadastraux restent visibles via la carte du sous-onglet B7 (même polygone que le changement source).
- Édition de la géométrie d'un objet cadastral après officialisation.
- Filtres sur le registre des objets cadastraux.
- Rapport PDF dédié à B8.
- Tout lien vers un référentiel cadastral national consolidé (hors périmètre de l'application — voir cadrage de Groupe 2 dans le design de B7).
