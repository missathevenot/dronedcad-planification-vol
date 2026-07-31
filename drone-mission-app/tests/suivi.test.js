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
