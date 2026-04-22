/**
 * Service worker — cache-first strategy with build-time versioning.
 *
 * `__SW_VERSION__` and `__PRECACHE_URLS__` are replaced at build time (see
 * `build.ts`) via Bun's `define` substitution, so the minifier can't remove
 * or collapse them.
 *
 * Behaviour:
 *   - On install, precache the core app shell.
 *   - On activate, drop any older cache versions.
 *   - On fetch, serve from cache if present; otherwise hit the network and
 *     store the response. Same-origin only.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
declare const __SW_VERSION__: string;
declare const __PRECACHE_URLS__: readonly string[];

const CACHE_NAME = `x32-patch-list::${__SW_VERSION__}`;
const PRECACHE_URLS: readonly string[] = __PRECACHE_URLS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...PRECACHE_URLS])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('x32-patch-list::') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })(),
  );
});

export {};
