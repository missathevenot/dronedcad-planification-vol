'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Suivi = require('../suivi.js');

test('construireDossierDepuisProjet: builds the dossier row and one execution/etape row per unit', () => {
  const { dossier, executions, etapes } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone Yopougon', commune: 'Yopougon', superficieHa: 42,
    nombreMissionsPrevues: 3, agentReferentId: 'agent-1',
    donneesPlanification: { drone: {} }
  });
  assert.equal(dossier.nom_zone, 'Zone Yopougon');
  assert.equal(dossier.commune, 'Yopougon');
  assert.equal(dossier.superficie_ha, 42);
  assert.equal(dossier.nombre_missions_prevues, 3);
  assert.equal(dossier.agent_referent_id, 'agent-1');
  assert.equal(dossier.statut_global, 'planifiee');
  assert.deepEqual(dossier.donnees_planification, { drone: {} });
  assert.deepEqual(dossier.historique, []);

  assert.equal(executions.length, 3);
  assert.deepEqual(executions.map((e) => e.numero_mission), [1, 2, 3]);
  executions.forEach((e) => assert.equal(e.statut, 'planifiee'));

  assert.equal(etapes.length, 7);
  assert.deepEqual(etapes.map((e) => e.etape),
    ['alignement', 'nuage_clairseme', 'nuage_dense', 'mns', 'mnt', 'orthophoto', 'modele_3d']);
  etapes.forEach((e) => assert.equal(e.statut, 'a_faire'));
});

test('construireDossierDepuisProjet: commune defaults to empty string when not provided', () => {
  const { dossier } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone X', commune: undefined, superficieHa: 10,
    nombreMissionsPrevues: 1, agentReferentId: null, donneesPlanification: {}
  });
  assert.equal(dossier.commune, '');
});

test('construireDossierDepuisProjet: zero missions produces empty executions and no dangling loop bug', () => {
  const { executions } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone Vide', commune: '', superficieHa: 5,
    nombreMissionsPrevues: 0, agentReferentId: null, donneesPlanification: {}
  });
  assert.deepEqual(executions, []);
});

test('mapperDossierVersJs: converts a snake_case Supabase row to a camelCase object', () => {
  const row = {
    id: 'd1', nom_zone: 'Zone A', commune: 'Cocody', date_planification: '2026-08-01',
    superficie_ha: 20, nombre_missions_prevues: 2, agent_referent_id: 'a1',
    statut_global: 'en_cours', donnees_planification: { x: 1 }, historique: [],
    created_by: 'a1', created_at: '2026-08-01T10:00:00Z'
  };
  const js = Suivi.mapperDossierVersJs(row);
  assert.equal(js.id, 'd1');
  assert.equal(js.nomZone, 'Zone A');
  assert.equal(js.commune, 'Cocody');
  assert.equal(js.datePlanification, '2026-08-01');
  assert.equal(js.superficieHa, 20);
  assert.equal(js.nombreMissionsPrevues, 2);
  assert.equal(js.agentReferentId, 'a1');
  assert.equal(js.statutGlobal, 'en_cours');
  assert.deepEqual(js.donneesPlanification, { x: 1 });
  assert.equal(js.createdBy, 'a1');
  assert.equal(js.createdAt, '2026-08-01T10:00:00Z');
});

test('construireDossierDepuisProjet: inclut zone_id, drones_affectes, budget_previsionnel_fcfa', () => {
  const { dossier } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone test', commune: 'Yopougon', superficieHa: 10, nombreMissionsPrevues: 1,
    agentReferentId: 'agent-1', donneesPlanification: {}, zoneId: 'zone-uuid-1',
    dronesAffectes: ['DJI-01'], budgetPrevisionnelFcfa: 500000
  });
  assert.strictEqual(dossier.zone_id, 'zone-uuid-1');
  assert.deepStrictEqual(dossier.drones_affectes, ['DJI-01']);
  assert.strictEqual(dossier.budget_previsionnel_fcfa, 500000);
});

test('construireDossierDepuisProjet: zone_id/drones_affectes ont des valeurs par défaut sûres si absents', () => {
  const { dossier } = Suivi.construireDossierDepuisProjet({
    nomZone: 'Zone test', commune: '', superficieHa: 10, nombreMissionsPrevues: 1,
    agentReferentId: null, donneesPlanification: {}
  });
  assert.strictEqual(dossier.zone_id, null);
  assert.deepStrictEqual(dossier.drones_affectes, []);
  assert.strictEqual(dossier.budget_previsionnel_fcfa, null);
});

test('mapperDossierVersJs: convertit zone_id/drones_affectes/budget_previsionnel_fcfa', () => {
  const js = Suivi.mapperDossierVersJs({
    id: 'd1', nom_zone: 'Z', commune: 'C', date_planification: '2026-01-01',
    superficie_ha: 5, nombre_missions_prevues: 1, agent_referent_id: null,
    statut_global: 'planifiee', donnees_planification: {}, historique: [],
    created_by: null, created_at: '2026-01-01T00:00:00Z',
    zone_id: 'zone-uuid-1', drones_affectes: ['DJI-01'], budget_previsionnel_fcfa: 500000
  });
  assert.strictEqual(js.zoneId, 'zone-uuid-1');
  assert.deepStrictEqual(js.dronesAffectes, ['DJI-01']);
  assert.strictEqual(js.budgetPrevisionnelFcfa, 500000);
});

test('mapperExecutionVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'e1', mission_suivi_id: 'd1', numero_mission: 2, statut: 'executee',
    date_reelle: '2026-08-02', duree_reelle_min: 25, photos_reelles: 180,
    description_incident: '', telepilote_id: 't1', updated_at: '2026-08-02T09:00:00Z'
  };
  const js = Suivi.mapperExecutionVersJs(row);
  assert.equal(js.missionSuiviId, 'd1');
  assert.equal(js.numeroMission, 2);
  assert.equal(js.statut, 'executee');
  assert.equal(js.dateReelle, '2026-08-02');
  assert.equal(js.dureeReelleMin, 25);
  assert.equal(js.photosReelles, 180);
  assert.equal(js.telepiloteId, 't1');
});

test('mapperEtapeVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'et1', mission_suivi_id: 'd1', etape: 'orthophoto', statut: 'en_cours',
    date_debut: '2026-08-03', date_fin: null, duree_reelle_min: 120,
    taille_reelle_mo: 4500, technicien_id: 'tech1', updated_at: '2026-08-03T08:00:00Z'
  };
  const js = Suivi.mapperEtapeVersJs(row);
  assert.equal(js.missionSuiviId, 'd1');
  assert.equal(js.etape, 'orthophoto');
  assert.equal(js.dateDebut, '2026-08-03');
  assert.equal(js.dureeReelleMin, 120);
  assert.equal(js.tailleReelleMo, 4500);
  assert.equal(js.technicienId, 'tech1');
});

test('mapperControleVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'c1', mission_suivi_id: 'd1', livrable: 'mns', resultat: 'conforme',
    commentaire: 'RAS', controleur_id: 'ctrl1', date_controle: '2026-08-04'
  };
  const js = Suivi.mapperControleVersJs(row);
  assert.equal(js.missionSuiviId, 'd1');
  assert.equal(js.livrable, 'mns');
  assert.equal(js.resultat, 'conforme');
  assert.equal(js.controleurId, 'ctrl1');
  assert.equal(js.dateControle, '2026-08-04');
});

test('calculerAvancementDossier: 0% when nothing is done', () => {
  const executions = [{ statut: 'planifiee' }, { statut: 'planifiee' }];
  const etapes = [{ statut: 'a_faire' }, { statut: 'a_faire' }];
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 0);
});

test('calculerAvancementDossier: 100% when everything executed/terminee', () => {
  const executions = [{ statut: 'executee' }, { statut: 'executee' }];
  const etapes = [{ statut: 'terminee' }];
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 100);
});

test('calculerAvancementDossier: partial completion is rounded to the nearest percent', () => {
  const executions = [{ statut: 'executee' }, { statut: 'planifiee' }];
  const etapes = [{ statut: 'a_faire' }];
  // 1 done out of 3 tasks = 33.33...% -> rounded to 33
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 33);
});

test('calculerAvancementDossier: reportee/incident/annulee do not count as done', () => {
  const executions = [{ statut: 'reportee' }, { statut: 'incident' }, { statut: 'annulee' }];
  const etapes = [];
  assert.equal(Suivi.calculerAvancementDossier(executions, etapes), 0);
});

test('calculerAvancementDossier: 0% (not NaN) when there are no tasks at all', () => {
  assert.equal(Suivi.calculerAvancementDossier([], []), 0);
});

test('calculerStatsTableauDeBord: aggregates counts and volumetry across dossiers', () => {
  const dossiers = [
    {
      statutGlobal: 'terminee',
      executions: [{ statut: 'executee' }, { statut: 'incident' }],
      etapes: [{ tailleReelleMo: 1000 }, { tailleReelleMo: 500 }]
    },
    {
      statutGlobal: 'en_cours',
      executions: [{ statut: 'planifiee' }],
      etapes: [{ tailleReelleMo: 200 }]
    },
    {
      statutGlobal: 'planifiee',
      executions: [],
      etapes: []
    }
  ];
  const stats = Suivi.calculerStatsTableauDeBord(dossiers);
  assert.equal(stats.total, 3);
  assert.equal(stats.termines, 1);
  assert.equal(stats.enCours, 1);
  assert.equal(stats.incidents, 1);
  assert.equal(stats.volumetrieTotaleMo, 1700);
});

test('calculerStatsTableauDeBord: all zeros for an empty list', () => {
  const stats = Suivi.calculerStatsTableauDeBord([]);
  assert.deepEqual(stats, { total: 0, termines: 0, enCours: 0, incidents: 0, volumetrieTotaleMo: 0 });
});

test('mapperMembreEquipeVersJs: convertit une ligne mission_equipe', () => {
  const js = Suivi.mapperMembreEquipeVersJs({ id: 'e1', mission_suivi_id: 'm1', agent_id: 'a1', role_sur_mission: 'Télépilote' });
  assert.deepStrictEqual(js, { id: 'e1', missionSuiviId: 'm1', agentId: 'a1', roleSurMission: 'Télépilote' });
});

test('mapperAutorisationVersJs: convertit une ligne autorisations_mission', () => {
  const js = Suivi.mapperAutorisationVersJs({
    id: 'au1', mission_suivi_id: 'm1', intitule: 'Autorisation ANAC', statut: 'obtenue', date_obtention: '2026-01-01', remarque: ''
  });
  assert.deepStrictEqual(js, {
    id: 'au1', missionSuiviId: 'm1', intitule: 'Autorisation ANAC', statut: 'obtenue', dateObtention: '2026-01-01', remarque: ''
  });
});

test('mapperIncidentVersJs: convertit une ligne registre_incidents_vol', () => {
  const js = Suivi.mapperIncidentVersJs({ id: 'i1', execution_vol_id: 'ex1', date_incident: '2026-01-01', description: 'Vent fort', gravite: 'majeure' });
  assert.deepStrictEqual(js, { id: 'i1', executionVolId: 'ex1', dateIncident: '2026-01-01', description: 'Vent fort', gravite: 'majeure' });
});

test('mapperAnomalieVersJs: convertit une ligne registre_anomalies_qualite', () => {
  const js = Suivi.mapperAnomalieVersJs({ id: 'an1', controle_id: 'c1', description: 'Trou dans le nuage', date_signalement: '2026-01-01', statut: 'ouverte' });
  assert.deepStrictEqual(js, { id: 'an1', controleId: 'c1', description: 'Trou dans le nuage', dateSignalement: '2026-01-01', statut: 'ouverte' });
});

test('mapperCorrectionVersJs: convertit une ligne historique_corrections', () => {
  const js = Suivi.mapperCorrectionVersJs({ id: 'co1', controle_id: 'c1', date_correction: '2026-01-02', description: 'Recalage', corrige_par: 'a1' });
  assert.deepStrictEqual(js, { id: 'co1', controleId: 'c1', dateCorrection: '2026-01-02', description: 'Recalage', corrigePar: 'a1' });
});

test('mapperPieceJointeVersJs: convertit une ligne pieces_jointes', () => {
  const js = Suivi.mapperPieceJointeVersJs({
    id: 'p1', table_liee: 'executions_vol', ligne_id: 'ex1', type_fichier: 'image',
    chemin_storage: 'executions_vol/ex1/photo.jpg', nom_original: 'photo.jpg', uploaded_by: 'a1', uploaded_at: '2026-01-01T00:00:00Z'
  });
  assert.deepStrictEqual(js, {
    id: 'p1', tableLiee: 'executions_vol', ligneId: 'ex1', typeFichier: 'image',
    cheminStorage: 'executions_vol/ex1/photo.jpg', nomOriginal: 'photo.jpg', uploadedBy: 'a1', uploadedAt: '2026-01-01T00:00:00Z'
  });
});

test('calculerIndicateursCharge: compte les drones uniques affectés aux missions non terminées', () => {
  const dossiers = [
    { statutGlobal: 'en_cours', dronesAffectes: ['DJI-01', 'DJI-02'] },
    { statutGlobal: 'planifiee', dronesAffectes: ['DJI-01'] },
    { statutGlobal: 'terminee', dronesAffectes: ['DJI-03'] }
  ];
  const indicateurs = Suivi.calculerIndicateursCharge(dossiers);
  assert.strictEqual(indicateurs.missionsActives, 2);
  assert.strictEqual(indicateurs.dronesAffectes, 2);
});

test('calculerIndicateursCharge: tableau vide donne des indicateurs à zéro', () => {
  const indicateurs = Suivi.calculerIndicateursCharge([]);
  assert.strictEqual(indicateurs.missionsActives, 0);
  assert.strictEqual(indicateurs.dronesAffectes, 0);
});

test('calculerIndicateursCharge: dossier sans propriété dronesAffectes ne lève pas et compte 0 drone', () => {
  const dossiers = [{ statutGlobal: 'en_cours' }];
  const indicateurs = Suivi.calculerIndicateursCharge(dossiers);
  assert.strictEqual(indicateurs.missionsActives, 1);
  assert.strictEqual(indicateurs.dronesAffectes, 0);
});

test('mapperChangementVersJs: convertit une ligne changements_territoriaux', () => {
  const js = Suivi.mapperChangementVersJs({
    id: 'ch1', mission_suivi_id: 'm1', dossier_reference_id: 'm0',
    type: 'nouvelle_construction', geometrie: [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]],
    priorite: 'haute', description: 'Bâtiment non cadastré', date_detection: '2026-08-01', detecte_par: 'a1'
  });
  assert.strictEqual(js.type, 'nouvelle_construction');
  assert.strictEqual(js.dossierReferenceId, 'm0');
  assert.strictEqual(js.priorite, 'haute');
  assert.deepStrictEqual(js.geometrie, [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]]);
});

test('filtrerChangements: filtre par type', () => {
  const changements = [
    { type: 'extension', priorite: 'faible' },
    { type: 'demolition', priorite: 'haute' }
  ];
  const resultat = Suivi.filtrerChangements(changements, { type: 'demolition' });
  assert.strictEqual(resultat.length, 1);
  assert.strictEqual(resultat[0].type, 'demolition');
});

test('filtrerChangements: filtre par priorité', () => {
  const changements = [
    { type: 'extension', priorite: 'faible' },
    { type: 'demolition', priorite: 'haute' }
  ];
  const resultat = Suivi.filtrerChangements(changements, { priorite: 'haute' });
  assert.strictEqual(resultat.length, 1);
  assert.strictEqual(resultat[0].priorite, 'haute');
});

test('filtrerChangements: sans filtre retourne tout', () => {
  const changements = [{ type: 'extension', priorite: 'faible' }, { type: 'demolition', priorite: 'haute' }];
  assert.strictEqual(Suivi.filtrerChangements(changements, {}).length, 2);
  assert.strictEqual(Suivi.filtrerChangements(changements).length, 2);
});

test('calculerStatsChangements: compte par type et par priorité', () => {
  const changements = [
    { type: 'extension', priorite: 'faible' },
    { type: 'extension', priorite: 'moyenne' },
    { type: 'demolition', priorite: 'haute' }
  ];
  const stats = Suivi.calculerStatsChangements(changements);
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.parType.extension, 2);
  assert.strictEqual(stats.parType.demolition, 1);
  assert.strictEqual(stats.parPriorite.faible, 1);
  assert.strictEqual(stats.parPriorite.moyenne, 1);
  assert.strictEqual(stats.parPriorite.haute, 1);
});

test('calculerStatsChangements: tableau vide donne des stats à zéro', () => {
  const stats = Suivi.calculerStatsChangements([]);
  assert.strictEqual(stats.total, 0);
  assert.deepStrictEqual(stats.parType, {});
  assert.deepStrictEqual(stats.parPriorite, { faible: 0, moyenne: 0, haute: 0 });
});

test('mapperObjetCadastralVersJs: convertit une ligne objets_cadastraux', () => {
  const js = Suivi.mapperObjetCadastralVersJs({
    id: 'oc1', mission_suivi_id: 'm1', changement_id: 'ch1', type: 'parcelle',
    reference: 'P-2026-014', geometrie: [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]],
    description: 'Parcelle issue du changement', statut: 'en_attente', date_creation: '2026-08-03'
  });
  assert.strictEqual(js.type, 'parcelle');
  assert.strictEqual(js.reference, 'P-2026-014');
  assert.strictEqual(js.changementId, 'ch1');
  assert.strictEqual(js.statut, 'en_attente');
  assert.deepStrictEqual(js.geometrie, [[5.3, -4.0], [5.31, -4.0], [5.31, -4.01]]);
});

test('mapperHistoriqueCadastralVersJs: convertit une ligne historique_objets_cadastraux', () => {
  const js = Suivi.mapperHistoriqueCadastralVersJs({
    id: 'h1', objet_cadastral_id: 'oc1', date_evenement: '2026-08-03',
    description: 'Objet créé à partir du changement officialisé.', nouveau_statut: 'en_attente'
  });
  assert.strictEqual(js.objetCadastralId, 'oc1');
  assert.strictEqual(js.description, 'Objet créé à partir du changement officialisé.');
  assert.strictEqual(js.nouveauStatut, 'en_attente');
});
