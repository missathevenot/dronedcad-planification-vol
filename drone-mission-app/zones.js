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

  return { mapperZoneVersJs, communesDistinctes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Zones;
