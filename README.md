# x32-patch-list

Generate printable patch lists from Behringer X32 scene files — entirely in
your browser. No CDN, no server, no upload.

The app is a single-page, installable web app. Open it as a folder from your
disk, host the built `dist/` directory on any static file server, or install
it as a PWA once you've loaded it over HTTPS.

## Using it

1. Load the app (from a URL you host, or open `dist/index.html` directly).
2. Pick a scene (`.scn`) file with the file picker — or drop one on the page.
3. The patch list renders client-side. Everything stays local to your browser.
4. Fill in source and remarks columns, toggle rows off that shouldn't print,
   set a title, and hit **Print**.

Title, remarks, row toggles, and section toggles are saved in `localStorage`
keyed by the scene filename + contents, so reloading or coming back later
brings your notes with you without colliding with a different same-name file.
Use **Export JSON** to dump the parsed model plus your notes as a portable JSON
file.

When loaded over HTTPS (or localhost) a service worker caches the app so it
keeps working offline. From `file://` the service worker stays unregistered
but the app still runs — it's just not auto-cached for the next visit.

## Development

Requires [Bun](https://bun.com) ≥ 1.3.

```bash
bun install
bun test           # parser + integration tests
bun run typecheck  # tsc --noEmit
bun run dev        # http://localhost:5173
bun run build      # → dist/
```

`bun run build` produces a self-contained `dist/` directory with hashed asset
names, a minified service worker, the web manifest, and icons. Host it on
GitHub Pages, Netlify, a static Nginx, `python -m http.server dist/`, or just
open `dist/index.html` directly from the filesystem.

## Project structure

```
src/
  parser/          # port of legacy x32parser.py
  components/      # Lit web components (x32-app, x32-upload, …)
  styles/          # base / web / shell / print CSS
  pwa/             # manifest + service worker
  icons/           # PWA icons
  index.html       # entry point
  main.ts          # component bootstrap + SW registration
  storage.ts       # localStorage adapter

tests/             # bun:test — ports of the Python unit tests + fixture
build.ts           # bun build wrapper (emits dist/)
dev.ts             # dev server (wraps bun build + static files)

legacy/            # the previous Flask + App Engine app, kept for reference
```

## Legacy Flask app

The Python/Flask implementation it grew out of is preserved under `legacy/`.
It's no longer wired into `bun` tasks, but the sources remain as a reference
when cross-checking parser behaviour against real scene files.

## License

GPL-2.0-only. See [`LICENSE`](./LICENSE).
