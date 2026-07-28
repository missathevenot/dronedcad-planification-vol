/**
 * calculs.js
 * Moteur de calcul de mission photogrammétrique pour DJI Matrice 350 RTK + Zenmuse P1.
 * Toutes les formules sont documentées ; les estimations de volumétrie (nuage de points,
 * MNT/MNS, temps de traitement) sont des ordres de grandeur indicatifs, à valider selon
 * la chaîne de traitement retenue (DJI Terra, Pix4D, Agisoft Metashape...).
 */

'use strict';

const Calc = (() => {

  // ------------------------------------------------------------------
  // Valeurs par défaut — modifiables depuis l'interface
  // ------------------------------------------------------------------
  const DEFAULTS = {
    drone: {
      modele: 'DJI Matrice 350 RTK',
      vitesseCartographie: 15,     // m/s
      altitudeMax: 120,            // m AGL
      positionnement: 'RTK',
      vitesseMax: 23,              // m/s (limite constructeur indicative)
      nombreDrones: 1
    },
    camera: {
      modele: 'DJI Zenmuse P1',
      megapixels: 45,
      largeurPx: 8192,
      hauteurPx: 5460,
      capteurLargeurMm: 35.9,      // plein format
      capteurHauteurMm: 24.0,
      focalesDisponibles: [24, 35, 50],
      obturateur: 'mécanique',
      formats: ['JPEG', 'RAW']
    },
    vol: {
      altitude: 100,               // m AGL
      recouvrementLong: 80,        // %
      recouvrementLat: 70,         // %
      vitesse: 15,                 // m/s
      focale: 35,                  // mm
      orientationLignes: 0,        // degrés, 0 = auto
      orientationAuto: true,
      margeSecurite: 30,           // m ajoutés à chaque extrémité de ligne
      formatCapture: 'both'        // 'raw' | 'jpeg' | 'both'
    },
    couts: {
      tauxHoraireOperateur: 0,     // FCFA/h — laissé à 0 par défaut (facultatif)
      coutCycleBatterie: 0,        // FCFA/cycle de charge
      coutTraitementParHa: 0       // FCFA/ha
    },
    limites: {
      recouvrementLongMin: 60,
      recouvrementLatMin: 30,
      tailleImageJpegMo: 38,
      tailleImageRawMo: 82,
      intervalleDeclenchementMin: 0.7 // s — limite pratique obturateur mécanique
    }
  };

  /** GSD (cm/pixel) à partir de l'altitude, la focale et la largeur capteur/image */
  function calcGSD(altitudeM, focaleMm, capteurLargeurMm, imageLargeurPx) {
    // GSD(m) = (capteur_mm * altitude_m) / (focale_mm * image_px) ; conversion en cm
    const gsdM = (capteurLargeurMm * altitudeM) / (focaleMm * imageLargeurPx);
    return gsdM * 100;
  }

  /** Altitude (m) nécessaire pour atteindre un GSD cible (cm/pixel) */
  function altitudePourGSD(gsdCibleCm, focaleMm, capteurLargeurMm, imageLargeurPx) {
    const gsdM = gsdCibleCm / 100;
    return (gsdM * focaleMm * imageLargeurPx) / capteurLargeurMm;
  }

  /** Empreinte au sol d'une photo (largeur x hauteur, en mètres) */
  function calcEmpreinte(gsdCm, imageLargeurPx, imageHauteurPx) {
    const gsdM = gsdCm / 100;
    return {
      largeur: gsdM * imageLargeurPx,
      hauteur: gsdM * imageHauteurPx
    };
  }

  /**
   * Calcule la géométrie de vol (bbox orientée) pour un polygone donné et un angle
   * d'orientation des lignes. Retourne longueur (le long des lignes) et largeur
   * (perpendiculaire, utilisée pour l'espacement des lignes).
   */
  function bboxOriente(latlngs, centre, angleDeg) {
    const toRad = (d) => (d * Math.PI) / 180;
    const a = toRad(angleDeg);
    const cosA = Math.cos(-a), sinA = Math.sin(-a);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(toRad(centre[0]));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    latlngs.forEach(([lat, lng]) => {
      const x0 = (lng - centre[1]) * mPerDegLng;
      const y0 = (lat - centre[0]) * mPerDegLat;
      const x = x0 * cosA - y0 * sinA;
      const y = x0 * sinA + y0 * cosA;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return {
      longueur: maxY - minY,   // étendue le long de la direction de vol
      largeur: maxX - minX,    // étendue perpendiculaire (nombre de lignes)
      minX, maxX, minY, maxY, mPerDegLat, mPerDegLng
    };
  }

  /**
   * Recherche l'orientation de lignes qui minimise la largeur perpendiculaire
   * (donc le nombre de lignes / les manœuvres de virage), par balayage 0-179°.
   */
  function orientationOptimale(latlngs, centre) {
    let meilleure = { angle: 0, largeur: Infinity };
    for (let angle = 0; angle < 180; angle += 2) {
      const b = bboxOriente(latlngs, centre, angle);
      if (b.largeur < meilleure.largeur) meilleure = { angle, largeur: b.largeur };
    }
    return meilleure.angle;
  }

  /**
   * Calcul complet d'une mission à partir des paramètres saisis.
   * @param {Object} p - paramètres { surfaceM2, drone, camera, vol, couts, geometrie }
   */
  function calculerMission(p) {
    const { drone, camera, vol, couts, limites } = p;
    const surfaceM2 = p.surfaceM2;
    const surfaceHa = Utils.m2ToHa(surfaceM2);

    // --- GSD & empreinte photo ---
    const gsd = calcGSD(vol.altitude, vol.focale, camera.capteurLargeurMm, camera.largeurPx);
    const empreinte = calcEmpreinte(gsd, camera.largeurPx, camera.hauteurPx);

    // --- Espacements ---
    const espacementLignes = empreinte.largeur * (1 - vol.recouvrementLat / 100);
    const espacementPhotos = empreinte.hauteur * (1 - vol.recouvrementLong / 100);
    const intervalleDeclenchement = espacementPhotos / vol.vitesse; // secondes

    // --- Géométrie du chantier ---
    const geo = p.geometrie; // { longueur, largeur } en mètres, issu de bboxOriente
    const margeTotale = vol.margeSecurite * 2;
    const longueurLigne = geo.longueur + margeTotale;
    const nombreLignes = Math.max(1, Math.ceil(geo.largeur / espacementLignes) + 1);

    const longueurTotaleLignes = nombreLignes * longueurLigne;
    const distanceVirages = (nombreLignes - 1) * espacementLignes; // approx virages en U
    const distanceTransit = (p.distanceDecollageAuCentre || 0) * 2; // aller-retour point de décollage
    const distanceTotale = longueurTotaleLignes + distanceVirages + distanceTransit;

    // --- Photos ---
    const photosParLigne = Math.max(1, Math.ceil(longueurLigne / espacementPhotos) + 1);
    const nombrePhotos = photosParLigne * nombreLignes;

    // --- Temps de vol ---
    const tempsVolMin = distanceTotale / vol.vitesse / 60;
    const tempsPriseDeVueMin = longueurTotaleLignes / vol.vitesse / 60;

    // --- Répartition entre drones (le calcul batterie est délégué à Batteries.calculerAutonomie) ---
    const nbDrones = Math.max(1, drone.nombreDrones || 1);
    const tempsVolParDroneMin = tempsVolMin / nbDrones;

    // --- Volumétrie images ---
    let tailleParPhotoMo = 0;
    if (vol.formatCapture === 'raw') tailleParPhotoMo = limites.tailleImageRawMo;
    else if (vol.formatCapture === 'jpeg') tailleParPhotoMo = limites.tailleImageJpegMo;
    else tailleParPhotoMo = limites.tailleImageRawMo + limites.tailleImageJpegMo;
    const volumeImagesMo = nombrePhotos * tailleParPhotoMo;

    // --- Produits photogrammétriques (estimations) ---
    const empreintePx = camera.largeurPx * camera.hauteurPx;
    const heuresTraitement = (nombrePhotos * empreintePx) / 4.2e9; // heuristique ~4.2 Gpx traités / h (poste performant)

    const gsdM = gsd / 100;
    const pixelsOrtho = surfaceM2 / (gsdM * gsdM);
    const orthophotoMo = (pixelsOrtho * 1.5) / (1024 * 1024); // ~1.5 octet/px compressé (JPEG/LZW, 3 bandes)

    const densiteNuage = 4; // points par empreinte pixel GSD (dense cloud typique)
    const nbPointsNuage = pixelsOrtho * densiteNuage;
    const nuagePointsMo = (nbPointsNuage * 18) / (1024 * 1024); // ~18 octets/point (xyz + rgb + normales compressés)

    const gsdMNS = gsdM; // MNS ~ résolution native
    const gsdMNT = gsdM * 4; // MNT généralement rééchantillonné plus grossier
    const pixelsMNS = surfaceM2 / (gsdMNS * gsdMNS);
    const pixelsMNT = surfaceM2 / (gsdMNT * gsdMNT);
    const mnsMo = (pixelsMNS * 4) / (1024 * 1024); // float32 1 bande
    const mntMo = (pixelsMNT * 4) / (1024 * 1024);

    // --- Coûts ---
    // coutOperateur/coutBatteries/coutTotal dépendent de données batterie
    // (temps terrain réel, nombre de vols) qui n'existent plus ici depuis la
    // suppression du calcul batterie : ils sont calculés dans app.js, après
    // fusion avec Batteries.calculerAutonomie(). Seul coutTraitement (basé sur
    // la surface) reste purement géométrique et a sa place dans ce module.
    const coutTraitement = surfaceHa * (couts.coutTraitementParHa || 0);

    return {
      gsd, empreinte, espacementLignes, espacementPhotos, intervalleDeclenchement,
      nombreLignes, longueurLigne, longueurTotaleLignes, distanceVirages, distanceTransit,
      distanceTotale, photosParLigne, nombrePhotos, tempsVolMin, tempsVolParDroneMin,
      tempsPriseDeVueMin, nbDrones, tailleParPhotoMo, volumeImagesMo,
      heuresTraitement, orthophotoMo, nuagePointsMo, mnsMo, mntMo,
      coutTraitement,
      surfaceHa, surfaceM2
    };
  }

  /** Validation réglementaire / cohérence des paramètres. Retourne une liste d'alertes. */
  function validerParametres(p) {
    const { drone, vol, limites } = p;
    const alertes = [];

    if (vol.altitude > drone.altitudeMax) {
      alertes.push({ type: 'danger', msg: `Altitude de vol (${vol.altitude} m) supérieure à l'altitude maximale autorisée (${drone.altitudeMax} m AGL).` });
    }
    if (vol.altitude <= 0) {
      alertes.push({ type: 'danger', msg: `Altitude de vol invalide.` });
    }
    if (vol.vitesse > drone.vitesseMax) {
      alertes.push({ type: 'danger', msg: `Vitesse de vol (${vol.vitesse} m/s) supérieure à la vitesse maximale du ${drone.modele} (${drone.vitesseMax} m/s).` });
    }
    if (vol.recouvrementLong < limites.recouvrementLongMin) {
      alertes.push({ type: 'warning', msg: `Recouvrement longitudinal (${vol.recouvrementLong} %) inférieur au minimum recommandé (${limites.recouvrementLongMin} %) pour un traitement photogrammétrique fiable.` });
    }
    if (vol.recouvrementLat < limites.recouvrementLatMin) {
      alertes.push({ type: 'warning', msg: `Recouvrement latéral (${vol.recouvrementLat} %) inférieur au minimum recommandé (${limites.recouvrementLatMin} %).` });
    }
    return alertes;
  }

  return {
    DEFAULTS, calcGSD, altitudePourGSD, calcEmpreinte, bboxOriente,
    orientationOptimale, calculerMission, validerParametres
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
