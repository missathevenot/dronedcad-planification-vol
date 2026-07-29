/**
 * meteo.js
 * Récupération des conditions météo (Open-Meteo) pour une position/date/heure
 * données, moteur de décision de faisabilité de mission, et construction de
 * liens vers des services météo complémentaires (Ventusky, Windy, Zoom Earth,
 * UAV Forecast). Seule fonction impure du module : recupererMeteo() (fetch
 * réseau) ; tout le reste est pur et testable indépendamment.
 */

'use strict';

const Meteo = (() => {

  const DEFAULTS = {
    seuils: {
      ventAlerteKmh: 20,        // ≤20 OK, ]20,30] Alerte, >30 Annulation
      ventAnnulationKmh: 30,
      rafalesAlerteKmh: 30,     // ≤30 OK, >30 Alerte (pas de palier annulation)
      visibiliteAlerteKm: 10    // ≥10 OK, <10 Alerte
    },
    codesOrage: [95, 96, 99],       // codes météo WMO
    codesBrouillard: [45, 48]       // codes météo WMO
  };

  /**
   * Construit l'URL de la requête Open-Meteo pour une position et une date.
   * `timezone=auto` fait renvoyer les horodatages horaires dans le fuseau
   * local de la position demandée (résolu par Open-Meteo à partir des
   * coordonnées) plutôt qu'en UTC — sans ce paramètre, `hourly.time` serait
   * en UTC alors que `heure` (saisie utilisateur) est une heure locale, ce
   * qui ferait correspondre silencieusement la mauvaise heure sans erreur.
   */
  function construireUrlOpenMeteo({ latitude, longitude, date }) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&hourly=wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,visibility,relative_humidity_2m,weather_code` +
      `&start_date=${date}&end_date=${date}&wind_speed_unit=kmh&timezone=auto`;
  }

  /** Extrait et convertit les données de l'heure demandée depuis une réponse Open-Meteo. */
  function extraireDonneesHeure(reponseApi, date, heure) {
    const heureHH = heure.split(':')[0].padStart(2, '0');
    const cle = `${date}T${heureHH}:00`;
    const index = reponseApi.hourly.time.indexOf(cle);
    if (index === -1) {
      throw new Error(`Aucune donnée météo disponible pour ${date} à ${heureHH}:00 (hors plage de prévision Open-Meteo, ~16 jours).`);
    }
    const h = reponseApi.hourly;
    const codeTemps = h.weather_code[index];
    return {
      ventKmh: h.wind_speed_10m[index],
      rafalesKmh: h.wind_gusts_10m[index],
      precipitationMm: h.precipitation[index],
      couvertureNuageusePct: h.cloud_cover[index],
      visibiliteKm: h.visibility[index] / 1000,
      humiditePct: h.relative_humidity_2m[index],
      codeTemps,
      orage: DEFAULTS.codesOrage.includes(codeTemps),
      brouillard: DEFAULTS.codesBrouillard.includes(codeTemps)
    };
  }

  /**
   * Applique les règles de faisabilité à des données météo déjà extraites et
   * retourne le verdict global (le pire critère l'emporte) avec le détail par
   * critère et la liste des raisons pour les critères non-OK.
   */
  function analyserFaisabilite(donnees) {
    const s = DEFAULTS.seuils;
    const criteres = [];

    let statutVent = 'ok';
    if (donnees.ventKmh > s.ventAnnulationKmh) statutVent = 'annulation';
    else if (donnees.ventKmh > s.ventAlerteKmh) statutVent = 'alerte';
    criteres.push({ nom: 'Vent', valeur: `${donnees.ventKmh} km/h`, statut: statutVent });

    const statutRafales = donnees.rafalesKmh > s.rafalesAlerteKmh ? 'alerte' : 'ok';
    criteres.push({ nom: 'Rafales', valeur: `${donnees.rafalesKmh} km/h`, statut: statutRafales });

    const statutPrecipitations = donnees.precipitationMm > 0 ? 'annulation' : 'ok';
    criteres.push({ nom: 'Précipitations', valeur: `${donnees.precipitationMm} mm`, statut: statutPrecipitations });

    const statutOrage = donnees.orage ? 'annulation' : 'ok';
    criteres.push({ nom: 'Orage', valeur: donnees.orage ? 'Présent' : 'Absent', statut: statutOrage });

    const statutVisibilite = donnees.visibiliteKm < s.visibiliteAlerteKm ? 'alerte' : 'ok';
    criteres.push({ nom: 'Visibilité', valeur: `${donnees.visibiliteKm} km`, statut: statutVisibilite });

    const statutBrouillard = donnees.brouillard ? 'annulation' : 'ok';
    criteres.push({ nom: 'Brouillard', valeur: donnees.brouillard ? 'Présent' : 'Absent', statut: statutBrouillard });

    criteres.push({ nom: 'Couverture nuageuse', valeur: `${donnees.couvertureNuageusePct} %`, statut: 'ok' });
    criteres.push({ nom: 'Humidité', valeur: `${donnees.humiditePct} %`, statut: 'ok' });

    const pireStatut = criteres.some((c) => c.statut === 'annulation') ? 'annulation'
      : criteres.some((c) => c.statut === 'alerte') ? 'alerte' : 'ok';
    const verdict = pireStatut === 'annulation' ? 'annulee' : pireStatut === 'alerte' ? 'deconseillee' : 'autorisee';

    const raisons = criteres
      .filter((c) => c.statut !== 'ok')
      .map((c) => `${c.nom} : ${c.valeur} (${c.statut === 'annulation' ? "seuil d'annulation dépassé" : 'hors plage recommandée'})`);

    return { verdict, criteres, raisons };
  }

  /** Construit les liens vers les services météo complémentaires pour une position donnée. */
  function construireLiensExternes({ latitude, longitude }) {
    const lat = Number(latitude).toFixed(4);
    const lon = Number(longitude).toFixed(4);
    return {
      ventusky: `https://www.ventusky.com/${lat};${lon}`,
      windy: `https://www.windy.com/?${lat},${lon},10,d:picker`,
      zoomEarth: 'https://zoom.earth/',
      uavForecast: 'https://www.uavforecast.com/'
    };
  }

  /** Récupère et extrait les données météo réelles pour une position/date/heure (impur, fetch réseau). */
  async function recupererMeteo({ latitude, longitude, date, heure }) {
    const url = construireUrlOpenMeteo({ latitude, longitude, date });
    const reponse = await fetch(url);
    if (!reponse.ok) {
      throw new Error(`Le service météo a répondu avec une erreur (HTTP ${reponse.status}).`);
    }
    const donneesApi = await reponse.json();
    return extraireDonneesHeure(donneesApi, date, heure);
  }

  return {
    DEFAULTS, construireUrlOpenMeteo, extraireDonneesHeure, analyserFaisabilite,
    construireLiensExternes, recupererMeteo
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Meteo;
