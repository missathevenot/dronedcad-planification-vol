# Bloc A — Performances PC + Estimation des traitements/tailles — Design

Sous-projet 2 sur 4 de la refonte DroneDCAD-Planification-Vol-PWA v2 (ordre retenu : **B → A → C → D**). Le Bloc B (module Batterie) est terminé et fusionné dans `master`.

## Contexte global (rappel, pour mémoire)

L'application `DroneDCAD-Planification-Vol-PWA-Final/drone-mission-app` est une PWA JavaScript vanilla (pas de framework, pas de backend), architecturée en modules IIFE exposés globalement (`Utils`, `Calc`, `Batteries`, `Carto`, `Exporter`, `App`) et chargés dans `index.html` dans un ordre de dépendance strict. `App.recalculer()` est le point d'orchestration central.

Le cahier des charges global demande 4 grands ajouts, découpés en sous-projets indépendants :
- **B — Batteries** ✅ terminé
- **A — Performances PC + Estimation des traitements/tailles** (ce document)
- **C — Météo (Open-Meteo en données réelles + liens Ventusky/Windy/UAV Forecast/Zoom Earth) + Moteur de décision**
- **D — Synthèse opérationnelle + Modernisation UI** (dépend de A, B, C — vient en dernier)

## Objectif du bloc A

1. Permettre à l'utilisateur de choisir le type d'ordinateur qui traitera les images (portable / bureau / station de travail / serveur), chacun avec un coefficient de performance.
2. Calculer automatiquement, après le plan de vol, le temps de traitement détaillé par étape (alignement, nuage de points, MNS, MNT, orthophoto, total), pondéré par ce coefficient.
3. Calculer les tailles estimées des produits (images brutes, nuage de points, MNS, MNT, orthophoto) et une capacité de stockage recommandée — ces tailles ne dépendent PAS du PC choisi (un ordinateur plus rapide ne change pas la taille des fichiers produits).

## État actuel (avant ce bloc)

`calculs.js` calcule déjà, sans aucune notion de type de PC, un bloc unique de « produits photogrammétriques » (lignes 173-190 de `calculs.js`) :
- `heuresTraitement` : une seule estimation globale, `(nombrePhotos × empreintePx) / 4.2e9`.
- `orthophotoMo`, `nuagePointsMo`, `mnsMo`, `mntMo` : tailles des produits, formules géométriques (surface, GSD).
- `tailleParPhotoMo` / `volumeImagesMo` : taille des images brutes.

Le tableau de bord affiche ces valeurs dans le panel-box « Produits photogrammétriques (estimation) ».

## Architecture

- Deux nouveaux fichiers, modules IIFE au même pattern que `Batteries` (`DEFAULTS` exporté + fonctions pures) :
  - `performance.js` (module `Performance`) : catalogue des types d'ordinateur et de leurs coefficients.
  - `traitement.js` (module `Traitement`) : calcule temps par étape + tailles des produits + capacité de stockage recommandée, à partir des sorties de `Calc.calculerMission()` et du coefficient PC sélectionné.
- Chargés dans `index.html` après `calculs.js`, avant `app.js` (comme `batteries.js`).
- **`calculs.js` perd** `heuresTraitement`, `orthophotoMo`, `nuagePointsMo`, `mnsMo`, `mntMo`, `tailleParPhotoMo`, `volumeImagesMo` — tout ce qui concerne la volumétrie/traitement des produits migre vers `traitement.js`. `calculs.js` ne garde que la géométrie de vol pure (lignes, distances, GSD, nombre de photos et leur espacement).
- `App.recalculer()` appelle `Calc.calculerMission()` puis `Traitement.calculerTraitement(...)` (en lui passant `state.performance` pour le coefficient), et fusionne les résultats pour l'affichage — même schéma que la fusion `resultatsGeo`/`resultatsBatt` du Bloc B.

## Module `performance.js`

```js
DEFAULTS = {
  typeSelectionne: 'portable',
  types: {
    portable: {
      nom: 'Ordinateur portable',
      config: 'Intel Core i5/i7 ou AMD Ryzen 5/7 · 16 Go RAM · SSD 512 Go · GPU intégré ou milieu de gamme',
      coefficient: 1.00
    },
    bureau: {
      nom: 'Ordinateur de bureau',
      config: 'Intel Core i7/i9 ou Ryzen 7/9 · 32 Go RAM · SSD NVMe · NVIDIA RTX',
      coefficient: 0.65
    },
    station: {
      nom: 'Station de travail',
      config: 'Xeon ou Threadripper · 64 à 256 Go RAM · plusieurs SSD NVMe · RTX professionnelle',
      coefficient: 0.35
    },
    serveur: {
      nom: 'Serveur de calcul',
      config: 'Multi CPU · 128 à 1024 Go RAM · RAID/NVMe · plusieurs GPU',
      coefficient: 0.20
    }
  }
}
```

`Performance` expose une fonction pure `coefficientDe(typesObj, typeSelectionne)` qui retourne le coefficient du type sélectionné, ou celui de `'portable'` (1.00) si `typeSelectionne` est absent/inconnu — c'est la seule logique de ce module, tout le reste est de la donnée.

## Module `traitement.js` — formules

### Temps de traitement (dépend du coefficient PC)

Le temps total heuristique existant (`(nombrePhotos × empreintePx) / 4.2e9`, en heures) est conservé comme **temps de référence à coefficient 1.00** (ordinateur portable), puis réparti entre 5 étapes selon des proportions typiques d'une chaîne de traitement photogrammétrique (Pix4D / Metashape / DJI Terra) :

```js
DEFAULTS.repartition = {
  alignement: 0.15,
  nuage: 0.45,
  mns: 0.10,
  mnt: 0.10,
  orthophoto: 0.20
}
```

```
tempsBaseTotalH = (nombrePhotos × empreintePx) / 4.2e9
tempsAlignementH  = tempsBaseTotalH × repartition.alignement × coefficientPC
tempsNuageH       = tempsBaseTotalH × repartition.nuage      × coefficientPC
tempsMNSH         = tempsBaseTotalH × repartition.mns        × coefficientPC
tempsMNTH         = tempsBaseTotalH × repartition.mnt        × coefficientPC
tempsOrthophotoH  = tempsBaseTotalH × repartition.orthophoto × coefficientPC
tempsTotalH       = tempsAlignementH + tempsNuageH + tempsMNSH + tempsMNTH + tempsOrthophotoH
                   (= tempsBaseTotalH × coefficientPC, par construction)
```

### Tailles des produits (indépendantes du PC — reprises telles quelles de `calculs.js`)

```
tailleParPhotoMo   = (formule identique à l'actuelle, selon vol.formatCapture / limites)
volumeImagesMo     = nombrePhotos × tailleParPhotoMo
empreintePx        = camera.largeurPx × camera.hauteurPx
gsdM               = gsd / 100
pixelsOrtho        = surfaceM2 / (gsdM × gsdM)
orthophotoMo       = (pixelsOrtho × 1.5) / (1024×1024)
nbPointsNuage      = pixelsOrtho × 4          // densité 4 points/pixel GSD
nuagePointsMo      = (nbPointsNuage × 18) / (1024×1024)
gsdMNS = gsdM ; gsdMNT = gsdM × 4
pixelsMNS = surfaceM2 / (gsdMNS×gsdMNS) ; pixelsMNT = surfaceM2 / (gsdMNT×gsdMNT)
mnsMo = (pixelsMNS × 4) / (1024×1024)
mntMo = (pixelsMNT × 4) / (1024×1024)
```

### Capacité de stockage recommandée

```
tailleTotaleMo = volumeImagesMo + orthophotoMo + nuagePointsMo + mnsMo + mntMo
stockageRecommandeMo = tailleTotaleMo × 1.30   // marge 30 % (fichiers temporaires/intermédiaires)
```

### Fonction exportée

```js
Traitement.calculerTraitement({
  nombrePhotos, surfaceM2, gsd,                     // issus de Calc.calculerMission()
  empreintePx,                                       // = state.camera.largeurPx × state.camera.hauteurPx (calculé par l'appelant, app.js — Calc.calculerMission() ne l'expose pas dans son retour actuel, inutile de le lui ajouter puisque app.js a déjà accès à state.camera)
  formatCapture, limites,                             // issus de state.vol.formatCapture / Calc.DEFAULTS.limites
  coefficientPC                                       // issu de Performance.coefficientDe(Performance.DEFAULTS.types, state.performance.typeSelectionne)
})
```
retourne `{ tempsAlignementH, tempsNuageH, tempsMNSH, tempsMNTH, tempsOrthophotoH, tempsTotalH, tailleParPhotoMo, volumeImagesMo, orthophotoMo, nuagePointsMo, mnsMo, mntMo, tailleTotaleMo, stockageRecommandeMo }`.

**Note d'implémentation** : `calculs.js` n'a pas besoin d'être modifié pour exposer `empreintePx` dans son retour — `app.js` le calcule directement depuis `state.camera.largeurPx`/`state.camera.hauteurPx` (données déjà présentes dans l'état de l'application), exactement comme il le fait déjà ailleurs dans `recalculer()` pour d'autres calculs intermédiaires (ex. `gsdTemp`, `empreinteTemp`).

## Interface utilisateur

- **Nouveau panel-box « Configuration de l'ordinateur de traitement »** dans l'onglet « Zone & paramètres » (après le panel-box « Estimation des coûts »). Un `<select>` ou groupe de boutons radio pour les 4 types ; la configuration technique de chacun est affichée en texte d'aide (`hint`) ; le coefficient est affiché mais non modifiable dans cette v1 (conforme à l'objectif d'extensibilité future, sans complexifier l'UI aujourd'hui).
- **Nouvel onglet de navigation « Estimation des traitements »** (nouveau `panel-traitement`, même pattern que les panels existants), contenant :
  - Une rangée de cartes : Temps alignement, Temps nuage de points, Temps MNS, Temps MNT, Temps orthophoto, **Temps total** (mis en avant).
  - Un bloc kv-list des tailles de produits (images brutes, nuage, MNS, MNT, orthophoto), formatées en Mo/Go via `Utils.fmtBytes`.
  - Une carte « Capacité de stockage recommandée » mise en avant.
  - Un graphique en barres « Temps par étape » et un graphique doughnut « Répartition des tailles des produits » (Chart.js, même pattern que les graphiques existants).
- **Suppression** du panel-box « Produits photogrammétriques (estimation) » du tableau de bord (remplacé par le nouvel onglet).

## Erreurs / validations

- Type de PC absent, `null` ou inconnu (clé qui n'existe pas dans `types`) → `Performance.coefficientDe()` retourne le coefficient de `'portable'` (1.00), aucune alerte nécessaire (repli silencieux, comportement par défaut raisonnable).
- Aucune nouvelle validation numérique : les entrées de `Traitement.calculerTraitement()` proviennent de la géométrie déjà validée par `Calc.calculerMission()` / `Calc.validerParametres()`.

## Extensibilité

- `Performance.DEFAULTS.types` est un objet à clés : ajouter un 5ᵉ type de matériel plus tard = une entrée supplémentaire, sans toucher à `coefficientDe()`.
- `Traitement.DEFAULTS.repartition` isole les proportions par étape en donnée modifiable, réutilisable pour un futur profil de capteur/traitement différent sans toucher à `calculerTraitement()`.

## Compatibilité / non-régression

- Toutes les fonctionnalités existantes (dessin de zone, import/export, scénarios, batteries, PDF/Excel/CSV/KML) continuent de fonctionner ; les exports (`export.js`) doivent être mis à jour pour référencer les nouveaux champs de temps/tailles au lieu des anciens champs supprimés de `calculs.js`.
- Le mode hors-ligne PWA n'est pas affecté : ce bloc est 100 % calcul local, aucune dépendance réseau.
- Anciens fichiers projet (`.json`) sans clé `state.performance` : repli silencieux sur `Performance.DEFAULTS` au rechargement (même mécanisme que `state.batteries` au Bloc B).

## Hors périmètre de ce sous-projet

- Le module météo (`meteo.js`) et le moteur de décision n'existent pas encore à ce stade.
- La modernisation visuelle globale au-delà des deux graphiques de ce bloc (jauges, icônes météo, tableau de bord de synthèse final) est traitée dans le bloc D.
