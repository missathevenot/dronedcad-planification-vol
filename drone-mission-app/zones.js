/**
 * zones.js
 * Bibliothèque de zones de mission partagées (nom, commune, description,
 * géométrie), stockée dans le même projet Supabase que suivi.js. Réutilise
 * le client déjà initialisé par Suivi.initClient() plutôt que d'en recréer
 * un second avec les mêmes identifiants codés en dur. Séparation pure /
 * impure : tout ce qui touche le réseau est isolé dans la section
 * "Fonctions impures" en bas de fichier ; le reste est pur et testable.
 */

'use strict';

const Zones = (() => {

  // ------------------------------------------------------------------
  // Fonctions pures (testables)
  // ------------------------------------------------------------------

  /** Convertit une ligne Supabase (snake_case) `zones` en objet JS (camelCase). */
  function mapperZoneVersJs(row) {
    return {
      id: row.id,
      nom: row.nom,
      commune: row.commune,
      description: row.description,
      geometrie: row.geometrie,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /** Liste triée (locale fr), dédupliquée, des communes non vides d'une liste de zones. */
  function communesDistinctes(zones) {
    const communes = zones.map((z) => z.commune).filter((c) => c && c.trim());
    return [...new Set(communes)].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // ------------------------------------------------------------------
  // Fonctions impures (appels réseau Supabase, non testées automatiquement)
  // ------------------------------------------------------------------

  /** Liste toutes les zones de la bibliothèque partagée, triées par nom. */
  async function listerZones() {
    const sb = Suivi.initClient();
    const { data, error } = await sb.from('zones').select('*').order('nom');
    if (error) throw new Error(`Échec du chargement des zones : ${error.message}`);
    return data.map(mapperZoneVersJs);
  }

  /** Crée une nouvelle zone dans la bibliothèque partagée. */
  async function creerZone(donnees) {
    const sb = Suivi.initClient();
    const { data: { user } } = await sb.auth.getUser();
    const ligne = {
      nom: donnees.nom,
      commune: donnees.commune || '',
      description: donnees.description || '',
      geometrie: donnees.geometrie,
      created_by: user ? user.id : null
    };
    const { data, error } = await sb.from('zones').insert(ligne).select().single();
    if (error) throw new Error(`Échec de la création de la zone : ${error.message}`);
    return mapperZoneVersJs(data);
  }

  /** Met à jour une zone existante. `donnees` peut contenir nom/commune/description/geometrie. */
  async function mettreAJourZone(id, donnees) {
    const sb = Suivi.initClient();
    const patch = { updated_at: new Date().toISOString() };
    if (donnees.nom !== undefined) patch.nom = donnees.nom;
    if (donnees.commune !== undefined) patch.commune = donnees.commune;
    if (donnees.description !== undefined) patch.description = donnees.description;
    if (donnees.geometrie !== undefined) patch.geometrie = donnees.geometrie;
    const { data, error } = await sb.from('zones').update(patch).eq('id', id).select().single();
    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Cette zone n\'existe plus (elle a peut-être été supprimée par un autre agent).');
      }
      throw new Error(`Échec de la mise à jour de la zone : ${error.message}`);
    }
    return mapperZoneVersJs(data);
  }

  /** Supprime une zone de la bibliothèque partagée. */
  async function supprimerZone(id) {
    const sb = Suivi.initClient();
    const { error } = await sb.from('zones').delete().eq('id', id);
    if (error) throw new Error(`Échec de la suppression de la zone : ${error.message}`);
  }

  return { mapperZoneVersJs, communesDistinctes, listerZones, creerZone, mettreAJourZone, supprimerZone };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Zones;
