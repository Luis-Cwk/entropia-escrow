/**
 * Construye la demo estática que sirve GitHub Pages desde /docs.
 * Genera docs/app.js (bundle con el SDK), docs/index.html y docs/styles.css.
 *
 * Uso: node scripts/build-web.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTRACT = join(ROOT, 'contracts', 'composition_escrow.py');
const SRC = join(ROOT, 'web', 'src');
const DOCS = join(ROOT, 'docs');

mkdirSync(SRC, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const source = readFileSync(CONTRACT, 'utf8');
writeFileSync(join(SRC, 'contract-code.js'), `export default ${JSON.stringify(source)};\n`, 'utf8');

await build({
  entryPoints: [join(SRC, 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  outfile: join(DOCS, 'app.js'),
});

copyFileSync(join(ROOT, 'web', 'index.html'), join(DOCS, 'index.html'));
copyFileSync(join(ROOT, 'web', 'styles.css'), join(DOCS, 'styles.css'));

console.log('Listo: docs/index.html, docs/styles.css y docs/app.js');
