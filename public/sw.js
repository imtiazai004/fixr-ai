/**
 * Fixr — Service Worker v2
 * Caches the app shell for offline-first delivery.
 * Strategy:
 *   • Navigation (HTML)  → Network first, cached index.html fallback
 *   • Static assets      → Cache first, network fallback + update cache
 *   • /api/*             → Network only (never cache live data)
 *   • External CDN       → Cache first (fonts, Leaflet)
 */

const SW_VERSION   = 'fixr-v2';
const STATIC_CACHE = SW_VERSION + '-static';

// App shell — everything needed to render the UI offline
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/fixr-icon.svg',
    '/icons/fixr-icon-maskable.svg',
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', event => {
    console.log('[SW] Installing', SW_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            // addAll fails if ANY request fails — use individual adds so one
            // missing file doesn't block the whole install.
            return Promise.allSettled(
                APP_SHELL.map(url =>
                    cache.add(url).catch(err =>
                        console.warn('[SW] Could not cache', url, err.message)
                    )
                )
            );
        })
    );
    self.skipWaiting(); // activate immediately without waiting for old clients to close
});

// ── Activate: delete stale caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
    console.log('[SW] Activating', SW_VERSION);
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== STATIC_CACHE)
                    .map(k => {
                        console.log('[SW] Deleting old cache:', k);
                        return caches.delete(k);
                    })
            )
        ).then(() => self.clients.claim()) // take control of all open tabs
    );
});

// ── Fetch: route requests ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // ── 1. API calls → network only, no cache ──────────────────────────────
    if (url.pathname.startsWith('/api/')) {
        // Let the browser handle it normally
        return;
    }

    // ── 2. HTML navigation → network first, fallback to cached index.html ──
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Update cache with fresh HTML while we're at it
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(STATIC_CACHE).then(c => c.put(request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    console.log('[SW] Offline — serving cached index.html');
                    return caches.match('/index.html');
                })
        );
        return;
    }

    // ── 3. Everything else → cache first, network fallback ──────────────────
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) {
                // Serve from cache immediately, but refresh in background
                // (stale-while-revalidate pattern)
                const networkFetch = fetch(request)
                    .then(response => {
                        if (response.ok && request.method === 'GET') {
                            const clone = response.clone();
                            caches.open(STATIC_CACHE).then(c => c.put(request, clone));
                        }
                        return response;
                    })
                    .catch(() => {}); // ignore network errors when we have cache

                return cached; // return cache immediately
            }

            // Not in cache → fetch from network and cache result
            return fetch(request).then(response => {
                if (response.ok && request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(STATIC_CACHE).then(c => c.put(request, clone));
                }
                return response;
            }).catch(() => {
                // Complete failure — nothing we can do
                console.warn('[SW] Fetch failed and no cache for', url.pathname);
                return new Response('Offline — please reconnect', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            });
        })
    );
});

// ── Message handler — allows app to trigger SW updates ───────────────────────
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
