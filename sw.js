// AETL Service Worker - caches all modular app assets for offline use.
const CACHE = 'aetl-v1.0.4';
const ASSETS = [
  './',
  './index.html',
  './styles/main.css',
  './styles/base.css',
  './styles/utilities.css',
  './styles/buttons.css',
  './styles/animations.css',
  './styles/dashboard.css',
  './styles/project-card.css',
  './styles/workspace.css',
  './styles/preview.css',
  './styles/forms.css',
  './styles/name-table.css',
  './styles/modals.css',
  './styles/proofread.css',
  './styles/plugins.css',
  './styles/shortcuts.css',
  './styles/bookmarks.css',
  './styles/opfs-explorer.css',
  './styles/immersive.css',
  './styles/lightbox.css',
  './styles/boot.css',
  './styles/busy.css',
  './styles/toast.css',
  './styles/responsive.css',
  './jszip.min.js',
  './manifest.json',
  './icon.svg',
  './scripts/core/namespace.js',
  './scripts/plugins/util.js',
  './scripts/plugins/sha256.js',
  './scripts/plugins/zip-reader.js',
  './scripts/plugins/manifest.js',
  './scripts/plugins/dialogs.js',
  './scripts/plugins/wasm-runner.js',
  './scripts/plugins/downloads.js',
  './scripts/plugins/net-runner.js',
  './scripts/plugins/runtime.js',
  './scripts/plugins/plugin-ui.js',
  './scripts/core/constants.js',
  './scripts/core/schema.js',
  './scripts/core/dropdowns.js',
  './scripts/core/util.js',
  './scripts/core/icons.js',
  './scripts/core/bookmarks.js',
  './scripts/core/format-detect.js',
  './scripts/core/net.js',
  './scripts/core/dom.js',
  './scripts/storage/serialize.js',
  './scripts/storage/storage.js',
  './scripts/storage/opfs-explorer.js',
  './scripts/formats/html.js',
  './scripts/formats/epub.js',
  './scripts/formats/json.js',
  './scripts/formats/parse-epub.js',
  './scripts/formats/export.js',
  './scripts/formats/backup.js',
  './scripts/state/vndb.js',
  './scripts/state/progress.js',
  './scripts/state/state.js',
  './scripts/ui/modals.js',
  './scripts/features/proofread.js',
  './scripts/features/shortcuts.js',
  './scripts/features/importer.js',
  './scripts/features/exporter.js',
  './scripts/features/immersive.js',
  './scripts/app.js',
  './scripts/plugin-host.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => { console.error('SW install failed:', err); throw err; })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

function withCoi(res) {
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  e.respondWith(
    caches.open(CACHE).then(c => c.match(e.request)).then(cached => {
      if (cached) return sameOrigin ? withCoi(cached) : cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'error') return res;
        if (sameOrigin) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(err => console.error('cache put failed:', err));
          return withCoi(res);
        }
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});
