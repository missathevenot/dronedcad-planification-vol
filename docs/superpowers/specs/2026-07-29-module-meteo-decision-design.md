# Bloc C — Météo + Moteur de décision — Design

Sous-projet 3 sur 4 de la refonte DroneDCAD-Planification-Vol-PWA v2 (ordre retenu : **B → A → C → D**). Les blocs B (Batteries) et A (Performance PC + Traitement) sont terminés, fusionnés dans `master`, et déployés sur GitHub Pages (`https://missathevenot.github.io/dronedcad-planification-vol/`).

## Contexte global (rappel, pour mémoire)

L'application `DroneDCAD-Planification-Vol-PWA-Final/drone-mission-app` est une PWA JavaScript vanilla (pas de framework, pas de backend), architecturée en modules IIFE exposés globalement (`Utils`, `Calc`, `Batteries`, `Performance`, `Traitement`, `Carto`, `Exporter`, `App`) et chargés dans `index.html` dans un ordre de dépendance strict. `App.recalculer()` est le point d'orchestration central pour les calculs locaux (sans réseau). Ce bloc introduit la **première dépendance réseau** de l'application : le reste du fonctionnement hors-ligne (PWA/service worker) n'est pas affecté, seule la météo nécessite une connexion internet, et seulement au moment où l'utilisateur clique explicitement sur "Actualiser la météo".

Le cahier des charges global demande 4 grands ajouts :
- **B — Batteries** ✅ terminé
- **A — Performances PC + Estimation des traitements/tailles** ✅ terminé
- **C — Météo + Moteur de décision** (ce document)
- **D — Synthèse opérationnelle + Modernisation UI** (dépend de A, B, C — vient en dernier)

## Objectif du bloc C

1. Récupérer automatiquement les conditions météo réelles (vent, rafales, précipitations, couverture nuageuse, visibilité, brouillard, humidité, risque d'orage) pour une date/heure/position donnée, via l'API gratuite Open-Meteo.
2. Donner accès à 4 services météo spécialisés (Ventusky, Windy, UAV Forecast, Zoom Earth) pour un contrôle visuel humain complémentaire.
3. Appliquer un moteur de décision automatique qui traduit ces données en un verdict de faisabilité de mission (🟢/🟠/🔴) avec les raisons détaillées.

## Recherche préalable (contraintes vérifiées)

- **Open-Meteo** : endpoint `https://api.open-meteo.com/v1/forecast`, gratuit, sans clé API, CORS ouvert. Paramètres horaires disponibles : `wind_speed_10m`, `wind_gusts_10m`, `precipitation`, `cloud_cover`, `visibility`, `relative_humidity_2m`, `weather_code`. Coordonnées via `latitude`/`longitude`, date via `start_date`/`end_date` (format `YYYY-MM-DD`). Le code météo (`weather_code`, standard WMO) permet de détecter le brouillard (45, 48) et l'orage (95, 96, 99) sans service séparé. Portée de prévision : environ 16 jours.
- **Ventusky** : format de lien profond confirmé par des URLs réelles indexées : `https://www.ventusky.com/{lat};{lon}`.
- **Windy** : format confirmé par la documentation communautaire officielle : `https://www.windy.com/?{lat},{lon},{zoom},d:picker`.
- **Zoom Earth** et **UAV Forecast** : aucun format de lien profond (paramètres lat/lon) documenté publiquement n'a pu être vérifié. Conformément à la consigne de ne jamais fabriquer d'URL non vérifiée, ces deux services sont liés via leur page d'accueil réelle (`https://zoom.earth/`, `https://www.uavforecast.com/`), avec les coordonnées de la mission affichées en texte à côté (copiables) pour saisie manuelle sur place.

## Architecture

- Nouveau fichier `meteo.js`, module IIFE `Meteo` (même pattern que `Batteries`/`Traitement`) : nom explicitement prévu par le cahier des charges (point 9 : "meteo.js").
- Séparation logique pure / impure à l'intérieur du même module (comme `Carto` gère déjà son I/O de fichiers) :
  - **Pures et testables** : `construireUrlOpenMeteo(params)`, `extraireDonneesHeure(reponseApi, date, heure)`, `analyserFaisabilite(donnees)`, `construireLiensExternes(coords)`.
  - **Impure, non testée automatiquement** : `recupererMeteo(params)` — orchestration `fetch()` + parsing, verifiée manuellement en navigateur (Task de vérification finale, comme pour `app.js`/`export.js` dans les blocs précédents).
- Chargé dans `index.html` après `traitement.js`, avant `cartographie.js` (ou n'importe où avant `app.js`, sans dépendance stricte puisque `meteo.js` ne dépend d'aucun autre module applicatif).

## Module `meteo.js` — formules et données

```js
DEFAULTS = {
  seuils: {
    ventAlerteKmh: 20,       // ≤20 OK, ]20,30] Alerte, >30 Annulation
    ventAnnulationKmh: 30,
    rafalesAlerteKmh: 30,    // ≤30 OK, >30 Alerte (pas de palier annulation)
    visibiliteAlerteKm: 10   // ≥10 OK, <10 Alerte
  },
  codesOrage: [95, 96, 99],      // codes WMO
  codesBrouillard: [45, 48]      // codes WMO
}
```

### `construireUrlOpenMeteo({ latitude, longitude, date })`
Construit l'URL complète de la requête `hourly=wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,visibility,relative_humidity_2m,weather_code&start_date={date}&end_date={date}&wind_speed_unit=kmh`.

### `extraireDonneesHeure(reponseApi, date, heure)`
Trouve dans `reponseApi.hourly.time` l'index correspondant à `{date}T{heure}:00` (heure normalisée sur 2 chiffres) et retourne :
```js
{
  ventKmh, rafalesKmh, precipitationMm, couvertureNuageusePct,
  visibiliteKm,        // = visibility (m) / 1000
  humiditePct, codeTemps,
  orage: codesOrage.includes(codeTemps),
  brouillard: codesBrouillard.includes(codeTemps)
}
```
Lève une erreur explicite si l'heure demandée n'a pas de correspondance (date hors plage de prévision Open-Meteo).

### `analyserFaisabilite(donnees)`
Applique le tableau de règles (voir section suivante) à chaque critère, calcule un statut (`'ok' | 'alerte' | 'annulation'`) par critère, puis un verdict global : **le pire critère l'emporte** — une seule "annulation" → `'annulee'` ; sinon une seule "alerte" → `'deconseillee'` ; sinon `'autorisee'`. Retourne `{ verdict, criteres: [{ nom, valeur, statut }], raisons: [texte explicatif pour chaque critère non-OK] }`. Couverture nuageuse et humidité sont incluses dans `criteres` avec un statut toujours `'ok'` (informatif seulement, pas de règle de décision définie par le cahier des charges pour ces deux-là).

### `construireLiensExternes({ latitude, longitude })`
```js
{
  ventusky: `https://www.ventusky.com/${lat};${lon}`,
  windy: `https://www.windy.com/?${lat},${lon},10,d:picker`,
  zoomEarth: 'https://zoom.earth/',
  uavForecast: 'https://www.uavforecast.com/'
}
```

### `recupererMeteo({ latitude, longitude, date, heure })` (async, impure)
Appelle `construireUrlOpenMeteo`, exécute `fetch()`, parse le JSON, appelle `extraireDonneesHeure`. Propage toute erreur réseau/HTTP/parsing à l'appelant (`app.js`), qui l'affiche via un toast (pattern déjà existant dans l'app pour `Carto.importFile`).

## Interface utilisateur

Nouvel onglet de navigation **« Conditions météo »**, contenant :
- Un panel-box de saisie : date, heure, commune (texte libre, sans géocodage), latitude/longitude (nombre, auto-remplis depuis `Carto.getCentroid()` **une seule fois** à la première ouverture de l'onglet si les champs sont vides et qu'une zone existe ; bouton "Recentrer sur la zone" pour les resynchroniser à la demande) ; bouton **"Actualiser la météo"**.
- Une grille de cartes : Vent, Rafales, Précipitations, Couverture nuageuse, Visibilité, Brouillard (Oui/Non), Humidité, Risque d'orage (Oui/Non).
- 4 boutons de renvoi externe : "Ouvrir dans Ventusky", "Ouvrir dans Windy" (liens directs avec coordonnées), "Ouvrir Zoom Earth", "Ouvrir UAV Forecast" (page d'accueil + coordonnées affichées à côté, copiables).
- Un grand panneau de verdict, coloré selon le statut : 🟢 MISSION AUTORISÉE / 🟠 MISSION DÉCONSEILLÉE / 🔴 MISSION ANNULÉE, avec la liste des raisons détaillées sous forme d'alertes (réutilise le pattern `alerte alerte--danger/warning/success` déjà existant).

## Erreurs / validations

- Pas de zone dessinée → bouton "Actualiser la météo" désactivé ou toast d'avertissement (cohérent avec le pattern existant "Définissez une zone...").
- Échec réseau / API indisponible / timeout → toast d'erreur clair ("Impossible de récupérer les données météo. Vérifiez votre connexion internet."), le panneau de verdict garde son dernier état connu (ou affiche "Aucune donnée" si jamais actualisé) plutôt que de planter.
- Date hors de la plage de prévision Open-Meteo (~16 jours) → message d'erreur explicite distinct d'une erreur réseau générique.

## Extensibilité

- `DEFAULTS.seuils` isole tous les seuils numériques en donnée modifiable, sans toucher à `analyserFaisabilite()`.
- `construireLiensExternes()` retourne un objet à clés ; ajouter un futur 5ᵂ service météo = une entrée supplémentaire.
- La séparation `recupererMeteo` (I/O) / reste (pur) permet de remplacer Open-Meteo par un autre fournisseur plus tard sans toucher au moteur de décision.

## Compatibilité / non-régression

- Toutes les fonctionnalités existantes (batteries, traitement, export, cartographie, PWA hors-ligne) restent inchangées ; ce bloc n'ajoute qu'un nouvel onglet et un nouveau module, sans modifier `calculs.js`, `batteries.js`, `performance.js`, `traitement.js`.
- Le mode hors-ligne PWA reste garanti pour tout le reste de l'application ; seule l'actualisation météo échoue proprement (message clair) en l'absence de réseau.
- Les champs de saisie (date, heure, commune, latitude, longitude) vivent dans `state.meteo` comme les autres paramètres de mission et sont donc sauvegardés/restaurés avec le projet (`.json`), au même titre que `state.batteries` ou `state.performance`. **En revanche, le résultat de la requête météo (données récupérées, verdict, raisons) n'est PAS stocké dans `state`** — c'est une donnée volatile, tenue en variable locale de `App` (comme `dernierResultats`), qui redevient vide après un rechargement de projet tant que l'utilisateur n'a pas recliqué sur "Actualiser la météo". Anciens fichiers projet sans clé `state.meteo` : repli silencieux sur les valeurs par défaut, même mécanisme que pour `state.batteries`/`state.performance`.

## Hors périmètre de ce sous-projet

- Le tableau de bord de synthèse finale agrégeant batteries + traitement + météo (Bloc D) n'existe pas encore à ce stade.
- La modernisation visuelle globale au-delà du panneau de verdict et des cartes de ce bloc (jauges avancées, icônes météo animées) est traitée dans le bloc D.
