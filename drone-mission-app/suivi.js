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

  /** Construit les lignes à insérer (dossier + vols + étapes) à partir d'un projet Drones DCAD. */
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
      updatedAt: row.updated_at,
      couvertureReelle: row.couverture_reelle
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

  /** Convertit une ligne Supabase (snake_case) `mission_equipe` en objet JS (camelCase). */
  function mapperMembreEquipeVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      agentId: row.agent_id,
      roleSurMission: row.role_sur_mission
    };
  }

  /** Convertit une ligne Supabase (snake_case) `autorisations_mission` en objet JS (camelCase). */
  function mapperAutorisationVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      intitule: row.intitule,
      statut: row.statut,
      dateObtention: row.date_obtention,
      remarque: row.remarque
    };
  }

  /** Convertit une ligne Supabase (snake_case) `registre_incidents_vol` en objet JS (camelCase). */
  function mapperIncidentVersJs(row) {
    return {
      id: row.id,
      executionVolId: row.execution_vol_id,
      dateIncident: row.date_incident,
      description: row.description,
      gravite: row.gravite
    };
  }

  /** Convertit une ligne Supabase (snake_case) `registre_anomalies_qualite` en objet JS (camelCase). */
  function mapperAnomalieVersJs(row) {
    return {
      id: row.id,
      controleId: row.controle_id,
      description: row.description,
      dateSignalement: row.date_signalement,
      statut: row.statut
    };
  }

  /** Convertit une ligne Supabase (snake_case) `historique_corrections` en objet JS (camelCase). */
  function mapperCorrectionVersJs(row) {
    return {
      id: row.id,
      controleId: row.controle_id,
      dateCorrection: row.date_correction,
      description: row.description,
      corrigePar: row.corrige_par
    };
  }

  /** Convertit une ligne Supabase (snake_case) `pieces_jointes` en objet JS (camelCase). */
  function mapperPieceJointeVersJs(row) {
    return {
      id: row.id,
      tableLiee: row.table_liee,
      ligneId: row.ligne_id,
      typeFichier: row.type_fichier,
      cheminStorage: row.chemin_storage,
      nomOriginal: row.nom_original,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at
    };
  }

  /** Indicateurs de charge : nombre de missions actives et de drones distincts actuellement affectés (hors missions terminées). */
  function calculerIndicateursCharge(dossiers) {
    const dossiersActifs = dossiers.filter((d) => d.statutGlobal !== 'terminee');
    const dronesUniques = new Set();
    dossiersActifs.forEach((d) => (d.dronesAffectes || []).forEach((id) => dronesUniques.add(id)));
    return {
      missionsActives: dossiersActifs.length,
      dronesAffectes: dronesUniques.size
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

  /** Convertit une ligne Supabase (snake_case) `changements_territoriaux` en objet JS (camelCase). */
  function mapperChangementVersJs(row) {
    return {
      id: row.id,
      missionSuiviId: row.mission_suivi_id,
      dossierReferenceId: row.dossier_reference_id,
      type: row.type,
      geometrie: row.geometrie,
      priorite: row.priorite,
      description: row.description,
      dateDetection: row.date_detection,
      detectePar: row.detecte_par
    };
  }

  /** Filtre une liste de changements par type et/ou priorité. Filtres vides = pas de filtrage sur ce critère. */
  function filtrerChangements(changements, filtres = {}) {
    return changements.filter((c) =>
      (!filtres.type || c.type === filtres.type) &&
      (!filtres.priorite || c.priorite === filtres.priorite)
    );
  }

  /** Compte les changements par type et par priorité, pour l'en-tête de la liste et le rapport PDF. */
  function calculerStatsChangements(changements) {
    const parType = {};
    const parPriorite = { faible: 0, moyenne: 0, haute: 0 };
    changements.forEach((c) => {
      parType[c.type] = (parType[c.type] || 0) + 1;
      parPriorite[c.priorite] = (parPriorite[c.priorite] || 0) + 1;
    });
    return { total: changements.length, parType, parPriorite };
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

  /** Crée un dossier de suivi (et ses vols/étapes) à partir d'un projet Drones DCAD planifié. */
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

  /** Liste les dossiers, avec filtres optionnels { statut, commune, zoneId }. */
  async function listerDossiers(filtres = {}) {
    const sb = initClient();
    let requete = sb.from('missions_suivi').select('*').order('created_at', { ascending: false });
    if (filtres.statut) requete = requete.eq('statut_global', filtres.statut);
    if (filtres.commune) requete = requete.ilike('commune', `%${filtres.commune}%`);
    if (filtres.zoneId) requete = requete.eq('zone_id', filtres.zoneId);
    const { data, error } = await requete;
    if (error) throw new Error(`Échec du chargement des dossiers : ${error.message}`);
    return data.map(mapperDossierVersJs);
  }

  /** Récupère un dossier complet (infos + vols + étapes + contrôles qualité + équipe + autorisations). */
  async function recupererDossier(id) {
    const sb = initClient();
    const [{ data: dossier, error: e1 }, { data: executions, error: e2 },
           { data: etapes, error: e3 }, { data: controles, error: e4 },
           { data: equipe, error: e5 }, { data: autorisations, error: e6 }] = await Promise.all([
      sb.from('missions_suivi').select('*').eq('id', id).single(),
      sb.from('executions_vol').select('*').eq('mission_suivi_id', id).order('numero_mission'),
      sb.from('etapes_traitement').select('*').eq('mission_suivi_id', id),
      sb.from('controles_qualite').select('*').eq('mission_suivi_id', id),
      sb.from('mission_equipe').select('*').eq('mission_suivi_id', id),
      sb.from('autorisations_mission').select('*').eq('mission_suivi_id', id)
    ]);
    if (e1) throw new Error(`Échec du chargement du dossier : ${e1.message}`);
    if (e2 || e3 || e4 || e5 || e6) throw new Error('Échec du chargement du détail du dossier.');
    return {
      dossier: mapperDossierVersJs(dossier),
      executions: executions.map(mapperExecutionVersJs),
      etapes: etapes.map(mapperEtapeVersJs),
      controles: controles.map(mapperControleVersJs),
      equipe: equipe.map(mapperMembreEquipeVersJs),
      autorisations: autorisations.map(mapperAutorisationVersJs)
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

  /** Liste les membres d'équipe affectés à un dossier. */
  async function listerMembresEquipe(missionSuiviId) {
    const sb = initClient();
    const { data, error } = await sb.from('mission_equipe').select('*').eq('mission_suivi_id', missionSuiviId);
    if (error) throw new Error(`Échec du chargement de l'équipe : ${error.message}`);
    return data.map(mapperMembreEquipeVersJs);
  }

  /** Affecte un agent à un dossier. */
  async function ajouterMembreEquipe(missionSuiviId, agentId, roleSurMission) {
    const sb = initClient();
    const ligne = {
      mission_suivi_id: missionSuiviId,
      agent_id: agentId,
      role_sur_mission: roleSurMission || ''
    };
    const { data, error } = await sb.from('mission_equipe').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'affectation : ${error.message}`);
    return mapperMembreEquipeVersJs(data);
  }

  /** Retire un agent d'un dossier. */
  async function retirerMembreEquipe(id) {
    const sb = initClient();
    const { error } = await sb.from('mission_equipe').delete().eq('id', id);
    if (error) throw new Error(`Échec du retrait : ${error.message}`);
  }

  /** Liste les agents actifs (pour les affecter à une mission). */
  async function listerAgentsActifs() {
    const sb = initClient();
    const { data, error } = await sb.from('profils').select('id, nom_complet').eq('statut', 'actif').order('nom_complet');
    if (error) throw new Error(`Échec du chargement des agents : ${error.message}`);
    return data.map((p) => ({ id: p.id, nomComplet: p.nom_complet }));
  }

  /** Liste les autorisations à solliciter/obtenues pour un dossier. */
  async function listerAutorisations(missionSuiviId) {
    const sb = initClient();
    const { data, error } = await sb.from('autorisations_mission').select('*').eq('mission_suivi_id', missionSuiviId);
    if (error) throw new Error(`Échec du chargement des autorisations : ${error.message}`);
    return data.map(mapperAutorisationVersJs);
  }

  /** Crée une autorisation à solliciter pour un dossier. */
  async function creerAutorisation(missionSuiviId, intitule) {
    const sb = initClient();
    const ligne = {
      mission_suivi_id: missionSuiviId,
      intitule
    };
    const { data, error } = await sb.from('autorisations_mission').insert(ligne).select().single();
    if (error) throw new Error(`Échec de la création de l'autorisation : ${error.message}`);
    return mapperAutorisationVersJs(data);
  }

  /** Met à jour une autorisation. `donnees` peut contenir statut/dateObtention/remarque. */
  async function mettreAJourAutorisation(id, donnees) {
    const sb = initClient();
    const patch = {};
    if (donnees.statut !== undefined) patch.statut = donnees.statut;
    if (donnees.dateObtention !== undefined) patch.date_obtention = donnees.dateObtention;
    if (donnees.remarque !== undefined) patch.remarque = donnees.remarque;
    const { data, error } = await sb.from('autorisations_mission').update(patch).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de l'autorisation : ${error.message}`);
    return mapperAutorisationVersJs(data);
  }

  /** Supprime une autorisation. */
  async function supprimerAutorisation(id) {
    const sb = initClient();
    const { error } = await sb.from('autorisations_mission').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression de l'autorisation : ${error.message}`);
  }

  /** Liste les incidents enregistrés pour un vol. */
  async function listerIncidentsVol(executionVolId) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_incidents_vol').select('*').eq('execution_vol_id', executionVolId).order('date_incident', { ascending: false });
    if (error) throw new Error(`Échec du chargement des incidents : ${error.message}`);
    return data.map(mapperIncidentVersJs);
  }

  /** Enregistre un nouvel incident pour un vol. */
  async function enregistrerIncidentVol(executionVolId, donnees) {
    const sb = initClient();
    const ligne = {
      execution_vol_id: executionVolId,
      description: donnees.description,
      gravite: donnees.gravite || 'mineure'
    };
    const { data, error } = await sb.from('registre_incidents_vol').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'enregistrement de l'incident : ${error.message}`);
    return mapperIncidentVersJs(data);
  }

  /** Met à jour la couverture réellement survolée d'un vol (géométrie, même format que zones.geometrie). */
  async function mettreAJourCouvertureReelle(executionVolId, geometrie) {
    const sb = initClient();
    const { error } = await sb.from('executions_vol').update({ couverture_reelle: geometrie, updated_at: new Date().toISOString() }).eq('id', executionVolId);
    if (error) throw new Error(`Échec de l'enregistrement de la couverture réelle : ${error.message}`);
  }

  /** Téléverse un fichier lié à une ligne (execution_vol, etape_traitement ou controle_qualite) et enregistre sa référence. */
  async function uploaderPieceJointe(tableLiee, ligneId, fichier, typeFichier) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const nomFichierSecurise = fichier.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const chemin = `${tableLiee}/${ligneId}/${Date.now()}_${nomFichierSecurise}`;
    const { error: erreurUpload } = await sb.storage.from('suivi-pieces-jointes').upload(chemin, fichier);
    if (erreurUpload) throw new Error(`Échec du téléversement : ${erreurUpload.message}`);
    const ligne = {
      table_liee: tableLiee,
      ligne_id: ligneId,
      type_fichier: typeFichier,
      chemin_storage: chemin,
      nom_original: fichier.name,
      uploaded_by: user ? user.id : null
    };
    const { data, error } = await sb.from('pieces_jointes').insert(ligne).select().single();
    if (error) {
      const err = new Error(`Fichier téléversé mais échec de l'enregistrement de la référence : ${error.message}`);
      err.cheminStorage = chemin;
      throw err;
    }
    return mapperPieceJointeVersJs(data);
  }

  /** Liste les pièces jointes d'une ligne donnée. */
  async function listerPiecesJointes(tableLiee, ligneId) {
    const sb = initClient();
    const { data, error } = await sb.from('pieces_jointes').select('*').eq('table_liee', tableLiee).eq('ligne_id', ligneId).order('uploaded_at', { ascending: false });
    if (error) throw new Error(`Échec du chargement des pièces jointes : ${error.message}`);
    return data.map(mapperPieceJointeVersJs);
  }

  /** Retourne une URL signée temporaire (1h) pour télécharger une pièce jointe. */
  async function obtenirUrlSigneePieceJointe(cheminStorage) {
    const sb = initClient();
    const { data, error } = await sb.storage.from('suivi-pieces-jointes').createSignedUrl(cheminStorage, 3600);
    if (error) throw new Error(`Échec de la génération du lien de téléchargement : ${error.message}`);
    return data.signedUrl;
  }

  /** Supprime une pièce jointe (référence en base ; le fichier Storage n'est pas nettoyé dans cette tranche). */
  async function supprimerPieceJointe(id) {
    const sb = initClient();
    const { error } = await sb.from('pieces_jointes').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression de la pièce jointe : ${error.message}`);
  }

  /** Liste les anomalies signalées pour un contrôle qualité. */
  async function listerAnomaliesQualite(controleId) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_anomalies_qualite').select('*').eq('controle_id', controleId).order('date_signalement', { ascending: false });
    if (error) throw new Error(`Échec du chargement des anomalies : ${error.message}`);
    return data.map(mapperAnomalieVersJs);
  }

  /** Signale une nouvelle anomalie pour un contrôle qualité. */
  async function signalerAnomalieQualite(controleId, description) {
    const sb = initClient();
    const ligne = {
      controle_id: controleId,
      description
    };
    const { data, error } = await sb.from('registre_anomalies_qualite').insert(ligne).select().single();
    if (error) throw new Error(`Échec du signalement de l'anomalie : ${error.message}`);
    return mapperAnomalieVersJs(data);
  }

  /** Met à jour le statut d'une anomalie (ex. 'corrigee'). */
  async function mettreAJourAnomalieQualite(id, statut) {
    const sb = initClient();
    const { data, error } = await sb.from('registre_anomalies_qualite').update({ statut }).eq('id', id).select().single();
    if (error) throw new Error(`Échec de la mise à jour de l'anomalie : ${error.message}`);
    return mapperAnomalieVersJs(data);
  }

  /** Liste l'historique des corrections apportées pour un contrôle qualité. */
  async function listerCorrections(controleId) {
    const sb = initClient();
    const { data, error } = await sb.from('historique_corrections').select('*').eq('controle_id', controleId).order('date_correction', { ascending: false });
    if (error) throw new Error(`Échec du chargement de l'historique des corrections : ${error.message}`);
    return data.map(mapperCorrectionVersJs);
  }

  /** Enregistre une correction apportée suite à une anomalie. */
  async function enregistrerCorrection(controleId, description) {
    const sb = initClient();
    const { data: { user } } = await sb.auth.getUser();
    const ligne = {
      controle_id: controleId,
      description,
      corrige_par: user ? user.id : null
    };
    const { data, error } = await sb.from('historique_corrections').insert(ligne).select().single();
    if (error) throw new Error(`Échec de l'enregistrement de la correction : ${error.message}`);
    return mapperCorrectionVersJs(data);
  }

  return {
    DEFAULTS,
    construireDossierDepuisProjet, mapperDossierVersJs, mapperExecutionVersJs,
    mapperEtapeVersJs, mapperControleVersJs,
    mapperMembreEquipeVersJs, mapperAutorisationVersJs, mapperIncidentVersJs, mapperAnomalieVersJs, mapperCorrectionVersJs, mapperPieceJointeVersJs, calculerIndicateursCharge,
    mapperChangementVersJs, filtrerChangements, calculerStatsChangements,
    calculerAvancementDossier, calculerStatsTableauDeBord,
    connexion, deconnexion, sessionActuelle, profilConnecte, initClient,
    creerDossierMission, listerDossiers, recupererDossier,
    mettreAJourExecutionVol, mettreAJourEtapeTraitement, enregistrerControleQualite, recupererTableauDeBord,
    listerMembresEquipe, ajouterMembreEquipe, retirerMembreEquipe, listerAgentsActifs,
    listerAutorisations, creerAutorisation, mettreAJourAutorisation, supprimerAutorisation,
    listerIncidentsVol, enregistrerIncidentVol, mettreAJourCouvertureReelle,
    uploaderPieceJointe, listerPiecesJointes, obtenirUrlSigneePieceJointe, supprimerPieceJointe,
    listerAnomaliesQualite, signalerAnomalieQualite, mettreAJourAnomalieQualite,
    listerCorrections, enregistrerCorrection
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Suivi;
