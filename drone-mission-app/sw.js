/**
 * sw.js
 * Service worker de l'application Drones DCAD.
 * Stratégie :
 *  - App shell (HTML/CSS/JS/libs/icônes) : "cache d'abord", pré-mis en cache à l'installation.
 *    Ce sont ces fichiers qui garantissent que l'application (formulaires, calculs,
 *    exports PDF/Excel/CSV/KML, sauvegarde de projet) reste 100 % utilisable hors connexion.
 *  - Tuiles de fond de carte (OpenStreetMap / CARTO, domaines distants) : "réseau d'abord
 *    avec repli sur le cache" — les tuiles déjà consultées restent disponibles hors ligne,
 *    les nouvelles zones nécessitent une connexion la première fois qu'elles sont affichées.
 */

'use strict';

const CACHE_VERSION = 'drones-dcad-v6';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './utils.js',
  './calculs.js',
  './cartographie.js',
  './carto-changements.js',
  './logo-dgi.js',
  './export.js',
  './app.js',
  './libs/leaflet.css',
  './libs/leaflet.js',
  './libs/chart.umd.js',
  './libs/jspdf.umd.min.js',
  './libs/jspdf.plugin.autotable.js',
  './libs/xlsx.full.min.js',
  './libs/html2canvas.min.js',
  './libs/shp.min.js',
  './libs/images/layers.png',
  './libs/images/layers-2x.png',
  './libs/images/marker-icon.png',
  './libs/images/marker-icon-2x.png',
  './libs/images/marker-shadow.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/dgi-logo.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function estTuileDeCarte(url) {
  return /tile\.openstreetmap\.org|basemaps\.cartocdn\.com/.test(url.hostname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Tuiles de carte distantes : réseau d'abord, repli cache, sans jamais faire planter la requête.
  if (estTuileDeCarte(url)) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Tout le reste (app shell + même origine) : cache d'abord, repli réseau + mise en cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return resp;
        }).catch(() => cached);
      })
    );
  }
});
