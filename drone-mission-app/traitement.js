/**
 * traitement.js
 * Estimation des temps de traitement photogrammétrique (alignement, nuage de
 * points, MNS, MNT, orthophoto) pondérés par le coefficient de performance de
 * l'ordinateur de traitement (voir performance.js), et des tailles des
 * produits générés (indépendantes du PC). Isole toute la logique de
 * volumétrie/traitement du calcul de géométrie de vol (calculs.js).
 */

'use strict';

const Traitement = (() => {

  const DEFAULTS = {
    // Débit de référence à coefficient 1.00 (ordinateur portable) : pixels traités par heure
    debitReferencePxParH: 4.2e9,
    // Répartition du temps total entre les 5 étapes de la chaîne de traitement
    repartition: {
      alignement: 0.15,
      nuage: 0.45,
      mns: 0.10,
      mnt: 0.10,
      orthophoto: 0.20
    },
    margeStockage: 1.30 // 30 % de marge pour fichiers temporaires/intermédiaires
  };

  /**
   * Calcule les temps de traitement par étape et les tailles des produits
   * photogrammétriques.
   * @param {Object} p
   * @param {number} p.nombrePhotos
   * @param {number} p.empreintePx - largeurPx × hauteurPx de la caméra
   * @param {number} p.surfaceM2
   * @param {number} p.gsd - GSD en cm/pixel
   * @param {string} p.formatCapture - 'raw' | 'jpeg' | 'both'
   * @param {Object} p.limites - { tailleImageRawMo, tailleImageJpegMo }
   * @param {number} p.coefficientPC - coefficient de performance (Performance.coefficientDe(...))
   */
  function calculerTraitement(p) {
    const { nombrePhotos, empreintePx, surfaceM2, gsd, formatCapture, limites, coefficientPC } = p;
    const rep = DEFAULTS.repartition;

    // --- Temps de traitement (dépend du coefficient PC) ---
    const tempsBaseTotalH = (nombrePhotos * empreintePx) / DEFAULTS.debitReferencePxParH;
    const tempsAlignementH = tempsBaseTotalH * rep.alignement * coefficientPC;
    const tempsNuageH = tempsBaseTotalH * rep.nuage * coefficientPC;
    const tempsMNSH = tempsBaseTotalH * rep.mns * coefficientPC;
    const tempsMNTH = tempsBaseTotalH * rep.mnt * coefficientPC;
    const tempsOrthophotoH = tempsBaseTotalH * rep.orthophoto * coefficientPC;
    const tempsTotalH = tempsAlignementH + tempsNuageH + tempsMNSH + tempsMNTH + tempsOrthophotoH;

    // --- Volumétrie images brutes (indépendante du PC) ---
    let tailleParPhotoMo = 0;
    if (formatCapture === 'raw') tailleParPhotoMo = limites.tailleImageRawMo;
    else if (formatCapture === 'jpeg') tailleParPhotoMo = limites.tailleImageJpegMo;
    else tailleParPhotoMo = limites.tailleImageRawMo + limites.tailleImageJpegMo;
    const volumeImagesMo = nombrePhotos * tailleParPhotoMo;

    // --- Tailles des produits (indépendantes du PC) ---
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

    // --- Capacité de stockage recommandée ---
    const tailleTotaleMo = volumeImagesMo + orthophotoMo + nuagePointsMo + mnsMo + mntMo;
    const stockageRecommandeMo = tailleTotaleMo * DEFAULTS.margeStockage;

    return {
      tempsAlignementH, tempsNuageH, tempsMNSH, tempsMNTH, tempsOrthophotoH, tempsTotalH,
      tailleParPhotoMo, volumeImagesMo, orthophotoMo, nuagePointsMo, mnsMo, mntMo,
      tailleTotaleMo, stockageRecommandeMo
    };
  }

  return { DEFAULTS, calculerTraitement };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Traitement;
