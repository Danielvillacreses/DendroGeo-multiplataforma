// Service worker de DendroGeo: la app abre y funciona sin conexión.
// - Archivos de la app: se guardan al instalar (precache) y se actualizan en segundo plano.
// - Teselas de mapa ya vistas: se guardan para verlas sin conexión (hasta ~3000).
// - Llamadas a Supabase: nunca se guardan; la sincronización la maneja la app.
const VERSION = 'dendrogeo-v4';
const APP = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/app.js', 'js/plataforma.js', 'js/cinta.js', 'js/tema.js', 'js/calc.js', 'js/store.js', 'js/sync.js', 'js/config.js', 'js/demo.js',
  'vendor/capacitor.js', 'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/supabase.js',
  'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png',
  'vendor/images/layers.png', 'vendor/images/layers-2x.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const TESELAS = 'dendrogeo-teselas';
const MAX_TESELAS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== TESELAS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const esTesela = (u) => /tile\.openstreetmap\.org|arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery/.test(u.href);
const esFuente = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u.host);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.host.endsWith('supabase.co') || url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/')) return;

  if (esTesela(url)) {
    e.respondWith(caches.open(TESELAS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          c.put(req, res.clone());
          c.keys().then((ks) => { if (ks.length > MAX_TESELAS) ks.slice(0, ks.length - MAX_TESELAS).forEach((k) => c.delete(k)); });
        }
        return res;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  if (url.origin === location.origin || esFuente(url)) {
    // stale-while-revalidate: responde desde caché y actualiza en segundo plano
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const red = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(red); return hit; }
      const res = await red;
      if (res) return res;
      if (req.mode === 'navigate') return c.match('index.html');
      return new Response('Sin conexión', { status: 503 });
    }));
  }
});
