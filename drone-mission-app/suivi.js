/**
 * suivi.js
 * Suivi d'exécution des missions post-levé (vols réels, traitement, contrôle
 * qualité) et tableau de bord opérationnel. Backend Supabase dédié à ce
 * module (base de données + authentification), indépendant du reste de
 * l'application qui reste hors-ligne. Séparation pure / impure : tout ce qui
 * touche le réseau (auth.*, requêtes Supabase) est isolé dans la section
 * "Fonctions impures" en bas de fichier ; le reste est pur et testable.
 */

'use strict';

const Suivi = (() => {

  const DEFAULTS = {
    supabaseUrl: 'https://REMPLACER-PAR-URL-DU-PROJET.supabase.co',
    supabaseAnonKey: 'REMPLACER-PAR-LA-CLE-PUBLIQUE-DU-PROJET',
    etapesTraitement: ['alignement', 'nuage_clairseme', 'nuage_dense', 'mns', 'mnt', 'orthophoto', 'modele_3d'],
    livrablesQualite: ['orthophoto', 'mns', 'mnt', 'nuage_points']
  };

  // ------------------------------------------------------------------
  // Fonctions pures (testables)
  // ------------------------------------------------------------------

  /** Construit les lignes à insérer (dossier + vols + étapes) à partir d'un projet DroneDCAD. */
  function construireDossierDepuisProjet({ nomZone, commune, superficieHa, nombreMissionsPrevues, agentReferentId, donneesPlanification }) {
    const dossier = {
      nom_zone: nomZone,
      commune: commune || '',
      date_planification: new Date().toISOString().slice(0, 10),
      superficie_ha: superficieHa,
      nombre_missions_prevues: nombreMissionsPrevues,
      agent_referent_id: agentReferentId,
      statut_global: 'planifiee',
      donnees_planification: donneesPlanification,
      historique: []
    };
    const executions = [];
    for (let n = 1; n <= nombreMissionsPrevues; n++) {
      executions.push({ numero_mission: n, statut: 'planifiee' });
    }
    const etapes = DEFAULTS.etapesTraitement.map((etape) => ({ etape, statut: 'a_faire' }));
    return { dossier, executions, etapes };
  }

  /** Convertit une ligne Supabase (snake_case) `missions_suivi` en objet JS (camelCase). */
  function mapperDossierVersJs(row) {
    return {
      id: row.id,
      nomZone: row.nom_zone,
      commune: row.commune,
      datePlanification: row.date_planification,
      superficieHa: row.superficie_ha,
      nombreMissionsPrevues: row.nombre_missions_prevues,
      agentReferentId: row.agent_referent_id,
      statutGlobal: row.statut_global,
      donneesPlanification: row.donnees_planification,
      historique: row.historique,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

  /** Convertit une ligne Supabase (snake_case) `executions_vol` en objet JS (camelCase). */
  function mapperExecutionVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      numeroMission: row.numero_mission,
      statut: row.statut,
      dateReelle: row.date_reelle,
      dureeReelleMin: row.duree_reelle_min,
      photosReelles: row.photos_reelles,
      descriptionIncident: row.description_incident,
      telepiloteId: row.telepilote_id,
      updatedAt: row.updated_at
    };
  }

  /** Convertit une ligne Supabase (snake_case) `etapes_traitement` en objet JS (camelCase). */
  function mapperEtapeVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      etape: row.etape,
      statut: row.statut,
      dateDebut: row.date_debut,
      dateFin: row.date_fin,
      dureeReelleMin: row.duree_reelle_min,
      tailleReelleMo: row.taille_reelle_mo,
      technicienId: row.technicien_id,
      updatedAt: row.updated_at
    };
  }

  /** Convertit une ligne Supabase (snake_case) `controles_qualite` en objet JS (camelCase). */
  function mapperControleVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      livrable: row.livrable,
      resultat: row.resultat,
      commentaire: row.commentaire,
      controleurId: row.controleur_id,
      dateControle: row.date_controle
    };
  }

  /** % d'avancement d'un dossier = (vols exécutés + étapes terminées) / (total vols + total étapes). */
  function calculerAvancementDossier(executions, etapes) {
    const totalTaches = executions.length + etapes.length;
    if (totalTaches === 0) return 0;
    const tachesTerminees = executions.filter((e) => e.statut === 'executee').length
      + etapes.filter((e) => e.statut === 'terminee').length;
    return Math.round((tachesTerminees / totalTaches) * 100);
  }

  /** Agrège les indicateurs du tableau de bord opérationnel à partir de dossiers enrichis. */
  function calculerStatsTableauDeBord(dossiers) {
    const total = dossiers.length;
    const termines = dossiers.filter((d) => d.statutGlobal === 'terminee').length;
    const enCours = dossiers.filter((d) => d.statutGlobal === 'en_cours').length;
    const incidents = dossiers.reduce(
      (acc, d) => acc + (d.executions || []).filter((e) => e.statut === 'incident').length, 0
    );
    const volumetrieTotaleMo = dossiers.reduce(
      (acc, d) => acc + (d.etapes || []).reduce((a2, e) => a2 + (e.tailleReelleMo || 0), 0), 0
    );
    return { total, termines, enCours, incidents, volumetrieTotaleMo };
  }

  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs, calculerAvancementDossier, calculerStatsTableauDeBord
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Suivi;
