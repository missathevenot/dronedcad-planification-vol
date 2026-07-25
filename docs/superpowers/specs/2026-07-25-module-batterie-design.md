# Bloc B — Module Batterie (DJI Matrice 350 RTK) — Design

Sous-projet 1 sur 4 de la refonte DroneDCAD-Planification-Vol-PWA v2 (ordre retenu : **B → A → C → D**, voir contexte ci-dessous).

## Contexte global (rappel, pour mémoire)

L'application `DroneDCAD-Planification-Vol-PWA-Final/drone-mission-app` est une PWA JavaScript vanilla (pas de framework, pas de backend), architecturée en modules IIFE exposés globalement (`Utils`, `Calc`, `Carto`, `Exporter`, `App`) et chargés dans `index.html` dans un ordre de dépendance strict. `App.recalculer()` est le point d'orchestration central : il lit l'état (`state`), appelle `Calc`, met à jour le tableau de bord, les graphiques Chart.js et les validations.

Le cahier des charges global demande 4 grands ajouts, découpés en sous-projets indépendants :
- **B — Batteries** (ce document)
- **A — Performances PC + Estimation des traitements/tailles**
- **C — Météo (Open-Meteo en données réelles + liens Ventusky/Windy/UAV Forecast/Zoom Earth) + Moteur de décision**
- **D — Synthèse opérationnelle + Modernisation UI** (dépend de A, B, C — vient en dernier)

## Objectif du bloc B

Remplacer entièrement le calcul batterie actuel (approximatif, basé sur `autonomie - tempsSecurite`) par un modèle fidèle aux caractéristiques réelles du DJI Matrice 350 RTK en mission photogrammétrique Zenmuse P1, avec une répartition détaillée de la consommation (décollage / mission / retour / réserve).

## Architecture

- Nouveau fichier `batteries.js`, module IIFE `Batteries`, même pattern que les modules existants (fonctions pures + `DEFAULTS` exporté).
- Chargé dans `index.html` après `calculs.js`, avant `app.js`.
- **Séparation des responsabilités** :
  - `Calc` (`calculs.js`) reste seul responsable de la géométrie de vol : distance totale des lignes, nombre de lignes, temps de vol géométrique (`distanceTotale`, `tempsVolMin`). Ces champs ne changent pas de sens.
  - `Batteries` (`batteries.js`) prend en entrée le temps de vol géométrique total et produit tous les résultats liés à l'autonomie. Il **remplace** les champs actuellement calculés dans `Calc.calculerMission()` : `nbBatteriesParDrone`, `nbBatteriesTotal`, `autonomieUtile`, `tempsChangementsMin`, `tempsTerrainTotalMin`, `nbMissionsParDrone`.
  - `App.recalculer()` appelle `Calc.calculerMission()` puis `Batteries.calculerAutonomie()` en passant le temps de vol géométrique, et fusionne les deux résultats pour l'affichage.

## Modèle de données — `Batteries.DEFAULTS`

```js
{
  autonomieParPaireMin: 40,     // min, réglable 38–42
  tempsDecollageMin: 1.5,       // min, fixe réglable
  tempsRetourMin: 2,            // min, fixe réglable
  reserveSecuritePct: 20,       // %, réglable
  // Plages de validation (issues du cahier des charges), non modifiables par l'utilisateur
  plages: {
    decollagePct: [5, 10],
    missionPct: [65, 75],
    retourPct: [10, 15],
    reservePct: [10, 20]
  }
}
```

## Formules

1. `autonomieUtileMin = autonomieParPaireMin * (1 - reserveSecuritePct / 100)`
2. `tempsUtileParPaireMin = autonomieUtileMin - tempsDecollageMin - tempsRetourMin`
   - Si `tempsUtileParPaireMin <= 0` → alerte "danger" (voir Validations), calcul arrêté.
3. `nbVols = ceil(tempsVolGeometriqueTotalMin / tempsUtileParPaireMin)`
4. `autonomieRestanteMin = (nbVols * tempsUtileParPaireMin) - tempsVolGeometriqueTotalMin` (reliquat non consommé sur le dernier vol)
5. `nbPairesMinimales = nbVols === 1 ? 1 : 2` (2 paires minimum pour permettre une rotation continue : une paire vole pendant que l'autre charge)
6. `nbBatteriesTB65 = nbPairesMinimales * 2`
7. `nbRotations = max(0, nbVols - 1)` (nombre de changements de paire sur le terrain)
8. `nbMissionsAutomatiques = nbVols` (1 mission DJI Pilot 2 = 1 vol sur une charge)
9. `nbDecollages = nbVols`
10. Répartition réelle observée (pour validation et graphique) :
    - `decollagePctReel = tempsDecollageMin / autonomieParPaireMin * 100`
    - `missionPctReel = (tempsUtileParPaireMin) / autonomieParPaireMin * 100` (approximation : temps mission moyen par paire, capé au temps réellement volé sur le dernier vol le cas échéant)
    - `retourPctReel = tempsRetourMin / autonomieParPaireMin * 100`
    - `reservePctReel = reserveSecuritePct`

## Interface utilisateur

- **Panel "Zone & paramètres" → panel-box "Drone — DJI Matrice 350 RTK"** : ajout de 3 champs — *Temps de décollage (min)*, *Temps de retour (min)*, *Réserve de sécurité (%)*. Le champ *Autonomie* existant est relabellisé "Autonomie par paire de batteries (min)".
- **Tableau de bord** : la carte "Batteries nécessaires" devient "Paires de batteries nécessaires" (affiche `nbPairesMinimales`, avec `nbBatteriesTB65` en sous-texte). Ajout de deux cartes : "Rotations de batteries" et "Décollages".
- **Graphique** : le doughnut existant "Répartition du temps" (2 segments : vol / changements de batterie) est remplacé par un doughnut à 4 segments : Décollage / Mission / Retour / Réserve, alimenté par les `*PctReel` ci-dessus.
- Le bloc `detailGeometrie` du tableau de bord affiche en plus : temps utile par batterie, autonomie restante.

## Validations / erreurs

Ajout dans le pipeline de validation existant (`alertesHost`, pattern `validerParametres`) :
- `tempsUtileParPaireMin <= 0` → **danger** : "Le temps de décollage + retour + réserve dépasse l'autonomie de la batterie : aucune marge de vol disponible."
- `reserveSecuritePct` hors [0, 100] → **danger**.
- `tempsDecollageMin < 0` ou `tempsRetourMin < 0` → **danger**.
- Répartition réelle (`decollagePctReel`, `missionPctReel`, `retourPctReel`, `reservePctReel`) hors des plages `DEFAULTS.plages` → **warning** avec message explicite indiquant la plage recommandée et la valeur obtenue.

## Extensibilité

`Batteries.DEFAULTS` isole totalement les caractéristiques de la batterie (autonomie, temps décollage/retour, réserve) du modèle drone (`Calc.DEFAULTS.drone`). L'ajout futur d'un autre type de batterie ou d'un autre drone se fera en ajoutant un nouvel objet de configuration sans modifier la logique de `calculerAutonomie()`, qui reste paramétrée en entrée.

## Compatibilité / non-régression

- Toutes les fonctionnalités existantes (dessin de zone, import/export, scénarios, PDF/Excel/CSV/KML) continuent de fonctionner ; les exports doivent être mis à jour pour inclure les nouveaux champs batterie (paires, rotations, décollages) au lieu des anciens champs supprimés.
- Le mode hors-ligne PWA n'est pas affecté : ce bloc est 100 % calcul local, aucune dépendance réseau.

## Hors périmètre de ce sous-projet

- Le module `performance.js` (coefficient PC) n'existe pas encore à ce stade — le bloc B ne dépend d'aucun coefficient PC.
- La modernisation visuelle globale (cards redessinées, jauges, icônes) est traitée dans le bloc D ; ce bloc B se limite à intégrer proprement les nouveaux champs dans les composants UI existants (cards, kv-list, doughnut chart).
