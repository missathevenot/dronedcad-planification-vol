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
    supabaseUrl: 'https://kepbgoxbatytyvrisqcs.supabase.co',
    supabaseAnonKey: 'sb_publishable_OgBpPTqv02vL0EF_o-y44w_TXNid0aw',
    etapesTraitement: ['alignement', 'nuage_clairseme', 'nuage_dense', 'mns', 'mnt', 'orthophoto', 'modele_3d'],
    livrablesQualite: ['orthophoto', 'mns', 'mnt', 'nuage_points']
  };

  // ------------------------------------------------------------------
  // Fonctions pures (testables)
  // ------------------------------------------------------------------

  /** Construit les lignes à insérer (dossier + vols + étapes) à partir d'un projet DroneDCAD. */
  function construireDossierDepuisProjet({ nomZone, commune, superficieHa, nombreMissionsPrevues, agentReferentId, donneesPlanification, zoneId, dronesAffectes, budgetPrevisionnelFcfa }) {
    const dossier = {
      nom_zone: nomZone,
      commune: commune || '',
      date_planification: new Date().toISOString().slice(0, 10),
      superficie_ha: superficieHa,
      nombre_missions_prevues: nombreMissionsPrevues,
      agent_referent_id: agentReferentId,
      statut_global: 'planifiee',
      donnees_planification: donneesPlanification,
      historique: [],
      zone_id: zoneId || null,
      drones_affectes: dronesAffectes || [],
      budget_previsionnel_fcfa: budgetPrevisionnelFcfa ?? null
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
      createdAt: row.created_at,
      zoneId: row.zone_id,
      dronesAffectes: row.drones_affectes || [],
      budgetPrevisionnelFcfa: row.budget_previsionnel_fcfa
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

  // ------------------------------------------------------------------
  // Fonctions impures (appels réseau Supabase, non testées automatiquement)
  // ------------------------------------------------------------------

  let client = null;

  /** Initialise (une seule fois) et retourne le client Supabase. Exportée pour être
   * partagée avec les autres modules (ex. zones.js), afin de garantir une seule
   * instance de client Supabase plutôt que d'en recréer une seconde avec les mêmes
   * identifiants. */
  function initClient() {
    if (!client) client = window.supabase.createClient(DEFAULTS.supabaseUrl, DEFAULTS.supabaseAnonKey);
    return client;
  }

  function traduireErreurAuth(error) {
    if (error.message === 'Invalid login credentials') return 'Email ou mot de passe incorrect.';
    return error.message;
  }

  /** Connecte l'agent avec email/mot de passe. Lève une erreur au message traduit en cas d'échec. */
  async function connexion(email, motDePasse) {
    const { data, error } = await initClient().auth.signInWithPassword({ email, password: motDePasse });
    if (error) throw new Error(traduireErreurAuth(error));
    return data.session;
  }

  async function deconnexion() {
    await initClient().auth.signOut();
  }

  /** Retourne la session active, ou null si personne n'est connecté. */
  async function sessionActuelle() {
    const { data } = await initClient().auth.getSession();
    return data.session;
  }

  /** Récupère le profil (nom, rôle) de l'agent actuellement connecté. */
  async function profilConnecte() {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb.from('profils').select('*').eq('id', user.id).single();
    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Votre compte existe mais aucun profil ne lui est associé. Contactez un administrateur.');
      }
      throw new Error(`Échec du chargement du profil : ${error.message}`);
    }
    return { id: data.id, nomComplet: data.nom_complet, role: data.role, statut: data.statut };
  }

  /** Crée un dossier de suivi (et ses vols/étapes) à partir d'un projet DroneDCAD planifié. */
  async function creerDossierMission(params) {
    const { dossier, executions, etapes } = construireDossierDepuisProjet(params);
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    dossier.created_by = user ? user.id : null;

    const { data: dossierInsere, error: erreurDossier } = await sb.from('missions_suivi').insert(dossier).select().single();
    if (erreurDossier) throw new Error(`Échec de la création du dossier : ${erreurDossier.message}`);

    const executionsAvecId = executions.map((e) => ({ ...e, mission_suivi_id: dossierInsere.id }));
    const etapesAvecId = etapes.map((e) => ({ ...e, mission_suivi_id: dossierInsere.id }));

    if (executionsAvecId.length) {
      const { error: erreurExecutions } = await sb.from('executions_vol').insert(executionsAvecId);
      if (erreurExecutions) {
        const err = new Error(`Dossier créé mais échec de la création des vols : ${erreurExecutions.message}`);
        err.dossierId = dossierInsere.id;
        throw err;
      }
    }

    const { error: erreurEtapes } = await sb.from('etapes_traitement').insert(etapesAvecId);
    if (erreurEtapes) {
      const err = new Error(`Dossier créé mais échec de la création des étapes de traitement : ${erreurEtapes.message}`);
      err.dossierId = dossierInsere.id;
      throw err;
    }

    return mapperDossierVersJs(dossierInsere);
  }

  /** Liste les dossiers, avec filtres optionnels { statut, commune }. */
  async function listerDossiers(filtres = {}) {
    const sb = initClient();
    let requete = sb.from('missions_suivi').select('*').order('created_at', { ascending: false });
    if (filtres.statut) requete = requete.eq('statut_global', filtres.statut);
    if (filtres.commune) requete = requete.ilike('commune', `%${filtres.commune}%`);
    const { data, error } = await requete;
    if (error) throw new Error(`Échec du chargement des dossiers : ${error.message}`);
    return data.map(mapperDossierVersJs);
  }

  /** Récupère un dossier complet (infos + vols + étapes + contrôles qualité). */
  async function recupererDossier(id) {
    const sb = initClient();
    const [{ data: dossier, error: e1 }, { data: executions, error: e2 },
           { data: etapes, error: e3 }, { data: controles, error: e4 }] = await Promise.all([
      sb.from('missions_suivi').select('*').eq('id', id).single(),
      sb.from('executions_vol').select('*').eq('mission_suivi_id', id).order('numero_mission'),
      sb.from('etapes_traitement').select('*').eq('mission_suivi_id', id),
      sb.from('controles_qualite').select('*').eq('mission_suivi_id', id)
    ]);
    if (e1) throw new Error(`Échec du chargement du dossier : ${e1.message}`);
    if (e2 || e3 || e4) throw new Error('Échec du chargement du détail du dossier.');
    return {
      dossier: mapperDossierVersJs(dossier),
      executions: executions.map(mapperExecutionVersJs),
      etapes: etapes.map(mapperEtapeVersJs),
      controles: controles.map(mapperControleVersJs)
    };
  }

  /** Met à jour un vol. `donnees` peut contenir statut/dateReelle/dureeReelleMin/photosReelles/descriptionIncident. */
  async function mettreAJourExecutionVol(id, donnees) {
    const sb = initClient();
    const patch = { updated_at: new Date().toISOString() };
    if (donnees.statut !== undefined) patch.statut = donnees.statut;
    if (donnees.dateReelle !== undefined) patch.date_reelle = donnees.dateReelle;
    if (donnees.dureeReelleMin !== undefined) patch.duree_reelle_min = donnees.dureeReelleMin;
    if (donnees.photosReelles !== undefined) patch.photos_reelles = donnees.photosReelles;
    if (donnees.descriptionIncident !== undefined) patch.description_incident = donnees.descriptionIncident;
    const { data, error } = await sb.from('executions_vol').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour du vol : ${error.message}`);
    return mapperExecutionVersJs(data);
  }

  /** Met à jour une étape de traitement. `donnees` peut contenir statut/dateDebut/dateFin/dureeReelleMin/tailleReelleMo. */
  async function mettreAJourEtapeTraitement(id, donnees) {
    const sb = initClient();
    const patch = { updated_at: new Date().toISOString() };
    if (donnees.statut !== undefined) patch.statut = donnees.statut;
    if (donnees.dateDebut !== undefined) patch.date_debut = donnees.dateDebut;
    if (donnees.dateFin !== undefined) patch.date_fin = donnees.dateFin;
    if (donnees.dureeReelleMin !== undefined) patch.duree_reelle_min = donnees.dureeReelleMin;
    if (donnees.tailleReelleMo !== undefined) patch.taille_reelle_mo = donnees.tailleReelleMo;
    const { data, error } = await sb.from('etapes_traitement').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de l'étape : ${error.message}`);
    return mapperEtapeVersJs(data);
  }

  /** Enregistre un nouveau résultat de contrôle qualité pour un livrable. */
  async function enregistrerControleQualite(donnees) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const ligne = {
      mission_suivi_id: donnees.missionSuiviId,
      livrable: donnees.livrable,
      resultat: donnees.resultat,
      commentaire: donnees.commentaire || '',
      controleur_id: user ? user.id : null
    };
    const { data, error } = await sb.from('controles_qualite').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'enregistrement du contrôle qualité : ${error.message}`);
    return mapperControleVersJs(data);
  }

  /** Calcule les indicateurs du tableau de bord opérationnel sur l'ensemble des dossiers. */
  async function recupererTableauDeBord() {
    const sb = initClient();
    const { data: dossiers, error: e1 } = await sb.from('missions_suivi').select('*');
    if (e1) throw new Error(`Échec du chargement du tableau de bord : ${e1.message}`);
    const { data: executions, error: e2 } = await sb.from('executions_vol').select('*');
    const { data: etapes, error: e3 } = await sb.from('etapes_traitement').select('*');
    if (e2 || e3) throw new Error('Échec du chargement du tableau de bord.');
    const dossiersEnrichis = dossiers.map((d) => ({
      ...mapperDossierVersJs(d),
      executions: executions.filter((e) => e.mission_suivi_id === d.id).map(mapperExecutionVersJs),
      etapes: etapes.filter((e) => e.mission_suivi_id === d.id).map(mapperEtapeVersJs)
    }));
    return calculerStatsTableauDeBord(dossiersEnrichis);
  }

  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs, calculerAvancementDossier, calculerStatsTableauDeBord,
    connexion, deconnexion, sessionActuelle, profilConnecte, initClient,
    creerDossierMission, listerDossiers, recupererDossier,
    mettreAJourExecutionVol, mettreAJourEtapeTraitement, enregistrerControleQualite, recupererTableauDeBord
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Suivi;
