/**
 * Local development server.
 *
 * Runs `Bun.build` in watch mode into `.dev-dist/`, then serves that directory
 * as static files. This is the same bundler path as production, so any import
 * that works in dev also works in `dist/` — no dev-only module resolution
 * surprises.
 *
 * Rebuild on source change is handled by Bun's `--watch` runtime flag: the
 * outer command is expected to be `bun --watch run dev.ts`. Even without
 * `--watch` this still works for a fresh build + serve.
 */

import { mkdir, rm, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, relative, dirname, extname } from 'node:path';
import { existsSync, statSync, watch } from 'node:fs';

const ROOT = resolve(import.meta.dir);
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, '.dev-dist');
const PORT = Number(process.env.PORT ?? 8732);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};
const contentType = (p: string) =>
  MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function buildOnce(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(SRC, 'main.ts')],
    outdir: join(OUT, 'assets'),
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
    naming: '[dir]/[name].[ext]',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Dev bundle failed');
  }

  // CSS: concatenate in deterministic order.
  const order = ['base.css', 'web.css', 'shell.css', 'print.css'];
  const chunks = await Promise.all(
    order.map((n) => readFile(join(SRC, 'styles', n), 'utf8')),
  );
  await writeFile(join(OUT, 'assets', 'styles.css'), chunks.join('\n\n'));

  // index.html: rewrite to match dev-bundled paths.
  const html = (await readFile(join(SRC, 'index.html'), 'utf8'))
    .replace(/\s*<link rel="stylesheet" href="\.\/styles\/[^"]+" \/>\s*/g, '')
    .replace(
      '</head>',
      `    <link rel="stylesheet" href="./assets/styles.css" />\n  </head>`,
    )
    .replace(
      /<script type="module" src="\.\/main\.ts"><\/script>/,
      `<script type="module" src="./assets/main.js"></script>`,
    );
  await writeFile(join(OUT, 'index.html'), html);

  // Manifest + icons.
  await copyFile(
    join(SRC, 'pwa', 'manifest.webmanifest'),
    join(OUT, 'manifest.webmanifest'),
  );
  const icons = await walk(join(SRC, 'icons'));
  for (const file of icons) {
    const dest = join(OUT, relative(SRC, file));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file, dest);
  }

  console.log(`[dev] build ok (${new Date().toISOString()})`);
}

let rebuildPending: Promise<void> | null = null;
async function rebuild(): Promise<void> {
  if (rebuildPending) return rebuildPending;
  rebuildPending = buildOnce()
    .catch((err) => console.error('[dev] build failed:', err))
    .finally(() => {
      rebuildPending = null;
    });
  return rebuildPending;
}

await buildOnce();

// Watch src/ for changes and rebuild.
watch(SRC, { recursive: true }, () => {
  rebuild();
});

const server = Bun.serve({
  port: PORT,
  development: true,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';

    // In dev we short-circuit the SW: registration is gated on http protocol
    // in main.ts, but a previously-installed SW from another port could still
    // hit us. Respond with an empty script so any stale SW becomes inert.
    if (path === '/sw.js') {
      return new Response('// dev: sw disabled', {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    const candidate = join(OUT, path);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return new Response(Bun.file(candidate), {
        headers: { 'Content-Type': contentType(candidate) },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`x32-patch-list dev server → http://localhost:${server.port}/`);
