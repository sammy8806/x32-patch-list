/**
 * Production build. Produces a self-contained `dist/` directory:
 *
 *   dist/
 *     index.html              (rewritten to reference the hashed bundle)
 *     assets/main-<hash>.js   (bundled + minified app + Lit)
 *     assets/styles-<hash>.css (concatenated stylesheets)
 *     sw.js                   (service worker, compiled and version-stamped)
 *     manifest.webmanifest    (copied)
 *     icons/*                 (copied)
 *
 * Host `dist/` on any static file server. Open `dist/index.html` directly
 * from the filesystem and it also works — the service worker simply stays
 * unregistered from `file://` origins.
 */

import { readdir, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dir);
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

async function rmrf(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

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

function hash(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}

async function buildApp(): Promise<{ jsPath: string; cssPath: string; assetUrls: string[] }> {
  // 1) Bundle the app entry (main.ts) — Lit + components.
  const appResult = await Bun.build({
    entrypoints: [join(SRC, 'main.ts')],
    outdir: join(DIST, 'assets'),
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'external',
    naming: '[dir]/[name]-[hash].[ext]',
  });
  if (!appResult.success) {
    for (const log of appResult.logs) console.error(log);
    throw new Error('App bundle failed');
  }
  const jsArtifact = appResult.outputs.find((o) => o.kind === 'entry-point');
  if (!jsArtifact) throw new Error('No JS entry point produced');

  // 2) Concatenate all stylesheets into one hashed file so index.html links
  //    exactly one CSS resource.
  const cssOrder = [
    'base.css',
    'web.css',
    'routing-views.css',
    'shell.css',
    'print.css',
  ];
  const cssChunks = await Promise.all(
    cssOrder.map((name) => readFile(join(SRC, 'styles', name), 'utf8')),
  );
  const cssBody = cssChunks.join('\n\n');
  const cssHash = hash(cssBody);
  const cssName = `styles-${cssHash}.css`;
  await ensureDir(join(DIST, 'assets'));
  await writeFile(join(DIST, 'assets', cssName), cssBody);

  // 3) Collect asset URLs for the service worker precache.
  const assetUrls = appResult.outputs
    .map((o) => `./assets/${relative(join(DIST, 'assets'), o.path)}`)
    .filter((url) => !url.endsWith('.map'));
  assetUrls.push(`./assets/${cssName}`);

  return {
    jsPath: `./assets/${relative(join(DIST, 'assets'), jsArtifact.path)}`,
    cssPath: `./assets/${cssName}`,
    assetUrls,
  };
}

async function writeIndexHtml(jsPath: string, cssPath: string): Promise<void> {
  const template = await readFile(join(SRC, 'index.html'), 'utf8');
  const rewritten = template
    // Drop the four individual stylesheet links, insert the concatenated one.
    .replace(
      /\s*<link rel="stylesheet" href="\.\/styles\/[^"]+" \/>\s*/g,
      '',
    )
    .replace(
      '</head>',
      `    <link rel="stylesheet" href="${cssPath}" />\n  </head>`,
    )
    // Rewrite the main.ts reference to the hashed bundle.
    .replace(
      /<script type="module" src="\.\/main\.ts"><\/script>/,
      `<script type="module" src="${jsPath}"></script>`,
    );
  await writeFile(join(DIST, 'index.html'), rewritten);
}

async function buildServiceWorker(assetUrls: string[]): Promise<void> {
  const version = hash(assetUrls.join('|'));

  const swResult = await Bun.build({
    entrypoints: [join(SRC, 'pwa', 'sw.ts')],
    outdir: DIST,
    target: 'browser',
    format: 'esm',
    minify: true,
    naming: '[dir]/sw.js',
    define: {
      __SW_VERSION__: JSON.stringify(version),
      __PRECACHE_URLS__: JSON.stringify(assetUrls),
    },
  });
  if (!swResult.success) {
    for (const log of swResult.logs) console.error(log);
    throw new Error('Service worker build failed');
  }
}

async function copyStaticAssets(): Promise<void> {
  // Manifest
  await copyFile(
    join(SRC, 'pwa', 'manifest.webmanifest'),
    join(DIST, 'manifest.webmanifest'),
  );

  // Icons directory
  const icons = await walk(join(SRC, 'icons'));
  for (const file of icons) {
    const rel = relative(SRC, file);
    const dest = join(DIST, rel);
    await ensureDir(dirname(dest));
    await copyFile(file, dest);
  }
}

async function main(): Promise<void> {
  await rmrf(DIST);
  await ensureDir(DIST);

  const { jsPath, cssPath, assetUrls } = await buildApp();
  await writeIndexHtml(jsPath, cssPath);
  await copyStaticAssets();
  await buildServiceWorker([
    './',
    './index.html',
    './manifest.webmanifest',
    './icons/icon.svg',
    ...assetUrls,
  ]);

  // Small build summary.
  const files = await walk(DIST);
  let total = 0;
  for (const f of files) total += (await Bun.file(f).size);
  console.log(
    `Built ${files.length} files, ${(total / 1024).toFixed(1)} KiB → ${relative(ROOT, DIST)}`,
  );
}

await main();
