/**
 * utils.js
 * Fonctions utilitaires génériques : formatage, conversions, notifications, id.
 * Application Drones DCAD — gestion des levés par drones et d'élargissement de l'assiette de l'impôt foncier (DJI Matrice 350 RTK / Zenmuse P1)
 */

'use strict';

const Utils = (() => {

  /** Génère un identifiant court unique */
  function uid(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** Formate un nombre avec séparateur de milliers (fr-FR) et décimales fixes */
  function fmt(num, decimals = 2) {
    if (num === null || num === undefined || Number.isNaN(num)) return '—';
    return Number(num).toLocaleString('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /** Formate une durée en minutes -> "1 h 24 min" */
  function fmtDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return '—';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h <= 0) return `${m} min`;
    return `${h} h ${String(m).padStart(2, '0')} min`;
  }

  /** Formate un octet-count en unité lisible */
  function fmtBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${fmt(v, i === 0 ? 0 : 2)} ${units[i]}`;
  }

  /** Échappe les caractères HTML spéciaux d'une chaîne, pour une interpolation sûre dans innerHTML. */
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Conversion hectares <-> m² */
  const haToM2 = (ha) => ha * 10000;
  const m2ToHa = (m2) => m2 / 10000;
  const km2ToM2 = (km2) => km2 * 1_000_000;

  /** Distance haversine entre deux points [lat,lng] en mètres */
  function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Aire d'un polygone géographique (shoelace projeté approximativement en m², suffisant pour l'échelle mission) */
  function polygonAreaM2(latlngs) {
    if (!latlngs || latlngs.length < 3) return 0;
    const R = 6378137;
    const toRad = (d) => (d * Math.PI) / 180;
    let area = 0;
    const n = latlngs.length;
    for (let i = 0; i < n; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % n];
      area += toRad(p2[1] - p1[1]) * (2 + Math.sin(toRad(p1[0])) + Math.sin(toRad(p2[0])));
    }
    area = Math.abs((area * R * R) / 2);
    return area;
  }

  /** Centroïde simple d'un polygone [lat,lng][] */
  function centroid(latlngs) {
    let lat = 0, lng = 0;
    latlngs.forEach((p) => { lat += p[0]; lng += p[1]; });
    return [lat / latlngs.length, lng / latlngs.length];
  }

  /** Notification toast */
  function toast(message, type = 'info', timeout = 4200) {
    const host = document.getElementById('toastHost');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    const icon = { info: 'ℹ', success: '✔', warning: '⚠', danger: '✖' }[type] || 'ℹ';
    el.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg">${message}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => el.remove(), 300);
    }, timeout);
  }

  /** Debounce */
  function debounce(fn, delay = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  /** Clamp */
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  /** Horodatage lisible fr */
  function now() {
    return new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** Convertit un tableau d'objets en CSV */
  function toCSV(rows, headers) {
    const escape = (v) => {
      const s = String(v ?? '');
      return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(';')];
    rows.forEach((r) => lines.push(headers.map((h) => escape(r[h])).join(';')));
    return '\uFEFF' + lines.join('\n');
  }

  /** Déclenche le téléchargement d'un blob */
  function download(filename, content, mime = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return {
    uid, fmt, fmtDuration, fmtBytes, escapeHtml, haToM2, m2ToHa, km2ToM2,
    haversine, polygonAreaM2, centroid, toast, debounce, clamp, now,
    toCSV, download
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Utils;
