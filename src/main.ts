/**
 * App bootstrap.
 *
 * Loads component definitions (via their side-effectful `customElements.define`
 * calls) and registers the service worker if we're running in a PWA-capable
 * context (i.e. over HTTP/HTTPS, not from a `file://` URL).
 */

import './components/app-shell.js';

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('./sw.js', import.meta.url), { type: 'classic' })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}
