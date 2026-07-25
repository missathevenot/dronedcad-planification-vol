/**
 * batteries.js
 * Moteur d'autonomie et de rotation des batteries pour le DJI Matrice 350 RTK
 * (paire de TB65, mission photogrammétrique Zenmuse P1). Isole toute la logique
 * liée à l'autonomie du calcul de géométrie de vol (calculs.js) : nombre de
 * vols/batteries nécessaires, répartition décollage/mission/retour/réserve,
 * rotations, décollages, rendement.
 */

'use strict';

const Batteries = (() => {

  const DEFAULTS = {
    modele: 'TB65 (double batterie)',
    autonomieParPaireMin: 40,        // min, 38-42 selon conditions (Zenmuse P1)
    tempsDecollageMin: 2,            // min, décollage + montée (5 % de l'autonomie totale)
    tempsRetourMin: 4,               // min, retour au point de décollage + atterrissage (10 %)
    reserveSecuritePct: 20,          // % d'autonomie totale conservé en réserve de sécurité
    tempsChangementBatterieMin: 4,   // min, temps de remplacement d'une paire au sol
    // Plages de validation (cahier des charges) — pourcentages de l'autonomie TOTALE
    plages: {
      decollagePct: [5, 10],
      missionPct: [65, 75],
      retourPct: [10, 15],
      reservePct: [10, 20]
    }
  };

  /**
   * Calcule l'autonomie, le nombre de batteries/vols et la répartition de
   * consommation à partir du temps de vol géométrique total (issu de Calc).
   * @param {Object} p
   * @param {number} p.tempsVolGeometriqueMin - temps de vol géométrique total pour un drone (Calc.tempsVolParDroneMin)
   * @param {number} p.surfaceHa - surface totale de la mission (Calc.surfaceHa)
   * @param {Object} p.batterie - paramètres batterie courants (état de l'application, forme de DEFAULTS)
   */
  function calculerAutonomie(p) {
    const { tempsVolGeometriqueMin, surfaceHa } = p;
    const b = p.batterie;
    const alertes = [];

    if (b.reserveSecuritePct < 0 || b.reserveSecuritePct > 100) {
      alertes.push({ type: 'danger', msg: `Réserve de sécurité invalide (${b.reserveSecuritePct} %) : doit être comprise entre 0 et 100 %.` });
    }
    if (b.tempsDecollageMin < 0 || b.tempsRetourMin < 0) {
      alertes.push({ type: 'danger', msg: `Les temps de décollage et de retour ne peuvent pas être négatifs.` });
    }

    const autonomieUtileMin = b.autonomieParPaireMin * (1 - b.reserveSecuritePct / 100);
    const tempsUtileParPaireMin = autonomieUtileMin - b.tempsDecollageMin - b.tempsRetourMin;

    if (tempsUtileParPaireMin <= 0) {
      alertes.push({
        type: 'danger',
        msg: `Le temps de décollage (${b.tempsDecollageMin} min) + retour (${b.tempsRetourMin} min) + réserve (${b.reserveSecuritePct} %) dépasse l'autonomie de la batterie (${b.autonomieParPaireMin} min) : aucune marge de vol disponible.`
      });
    }

    const nbVols = tempsUtileParPaireMin > 0
      ? Math.max(1, Math.ceil(tempsVolGeometriqueMin / tempsUtileParPaireMin))
      : 0;

    const autonomieRestanteMin = nbVols > 0 ? (nbVols * tempsUtileParPaireMin) - tempsVolGeometriqueMin : 0;
    const nbPairesMinimales = nbVols <= 1 ? 1 : 2;
    const nbBatteriesTB65 = nbPairesMinimales * 2;
    const nbRotations = Math.max(0, nbVols - 1);
    const nbMissionsAutomatiques = nbVols;
    const nbDecollages = nbVols;

    const tempsChangementsMin = nbRotations * b.tempsChangementBatterieMin;
    const tempsTerrainTotalMin = tempsVolGeometriqueMin + tempsChangementsMin;
    const surfaceParBatterieHa = nbVols > 0 ? surfaceHa / nbVols : 0;
    const rendementHaH = tempsTerrainTotalMin > 0 ? surfaceHa / (tempsTerrainTotalMin / 60) : 0;

    // Répartition réelle en % de l'autonomie TOTALE (autonomieParPaireMin), pour validation
    const decollagePctReel = (b.tempsDecollageMin / b.autonomieParPaireMin) * 100;
    const missionPctReel = (tempsUtileParPaireMin / b.autonomieParPaireMin) * 100;
    const retourPctReel = (b.tempsRetourMin / b.autonomieParPaireMin) * 100;
    const reservePctReel = b.reserveSecuritePct;

    const [decMin, decMax] = DEFAULTS.plages.decollagePct;
    const [misMin, misMax] = DEFAULTS.plages.missionPct;
    const [retMin, retMax] = DEFAULTS.plages.retourPct;
    const [resMin, resMax] = DEFAULTS.plages.reservePct;

    if (tempsUtileParPaireMin > 0 && (decollagePctReel < decMin || decollagePctReel > decMax)) {
      alertes.push({ type: 'warning', msg: `Répartition décollage (${decollagePctReel.toFixed(1)} %) hors de la plage recommandée (${decMin}-${decMax} %).` });
    }
    if (tempsUtileParPaireMin > 0 && (missionPctReel < misMin || missionPctReel > misMax)) {
      alertes.push({ type: 'warning', msg: `Répartition mission (${missionPctReel.toFixed(1)} %) hors de la plage recommandée (${misMin}-${misMax} %).` });
    }
    if (tempsUtileParPaireMin > 0 && (retourPctReel < retMin || retourPctReel > retMax)) {
      alertes.push({ type: 'warning', msg: `Répartition retour (${retourPctReel.toFixed(1)} %) hors de la plage recommandée (${retMin}-${retMax} %).` });
    }
    if (reservePctReel < resMin || reservePctReel > resMax) {
      alertes.push({ type: 'warning', msg: `Réserve de sécurité (${reservePctReel} %) hors de la plage recommandée (${resMin}-${resMax} %).` });
    }

    return {
      autonomieUtileMin, tempsUtileParPaireMin, nbVols, autonomieRestanteMin,
      nbPairesMinimales, nbBatteriesTB65, nbRotations, nbMissionsAutomatiques,
      nbDecollages, tempsChangementsMin, tempsTerrainTotalMin, surfaceParBatterieHa,
      rendementHaH, decollagePctReel, missionPctReel, retourPctReel, reservePctReel,
      alertes
    };
  }

  /** Découpe la mission globale en un plan de vol par paire de batteries (tableau des missions) */
  function genererPlanVols(calcResultats, nbVols, nombreLignesTotal) {
    const missions = [];
    if (!nbVols || nbVols <= 0) return missions;
    const lignesParVol = Math.max(1, Math.ceil(nombreLignesTotal / nbVols));
    let ligneRestantes = nombreLignesTotal;
    let idx = 1;
    while (ligneRestantes > 0) {
      const lignesIci = Math.min(lignesParVol, ligneRestantes);
      const distance = lignesIci * calcResultats.longueurLigne
        + Math.max(0, lignesIci - 1) * calcResultats.espacementLignes;
      const temps = distance / (calcResultats.distanceTotale / calcResultats.tempsVolParDroneMin || 1);
      missions.push({
        id: idx,
        batterie: `Batterie ${idx}`,
        lignes: lignesIci,
        surfaceHa: calcResultats.surfaceHa * (lignesIci / nombreLignesTotal),
        distance,
        tempsMin: temps,
        photos: Math.round(calcResultats.nombrePhotos * (lignesIci / nombreLignesTotal)),
        statut: 'Planifiée'
      });
      ligneRestantes -= lignesIci;
      idx++;
    }
    return missions;
  }

  return { DEFAULTS, calculerAutonomie, genererPlanVols };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Batteries;
