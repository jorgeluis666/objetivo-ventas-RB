#!/usr/bin/env node
/**
 * build.js — concatena index.html + css/ + js/ en un único archivo
 * dist/index.html para deploy a GitHub Pages.
 *
 * Uso: node scripts/build.js
 * Salida: dist/index.html + copia de data/ventas-2026.json a dist/data/
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function inlineCss(html) {
  return html.replace(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g,
    (match, href) => {
      if (/^https?:\/\//.test(href)) return match;
      const css = readFile(href);
      return `<style>\n/* ${href} */\n${css}\n</style>`;
    }
  );
}

function inlineScripts(html) {
  return html.replace(
    /<script\s+src="([^"]+)"\s*><\/script>/g,
    (match, src) => {
      if (/^https?:\/\//.test(src)) return match;
      const js = readFile(src);
      // Mantener los scripts en orden: reemplazar por bloques inline
      return `<script>\n/* ${src} */\n${js}\n</script>`;
    }
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDataDir() {
  const srcData  = path.join(ROOT, 'data');
  const destData = path.join(DIST_DIR, 'data');
  if (!fs.existsSync(srcData)) return;
  ensureDir(destData);
  for (const file of fs.readdirSync(srcData)) {
    fs.copyFileSync(path.join(srcData, file), path.join(destData, file));
  }
}

function main() {
  const rawHtml = readFile('index.html');
  let html = inlineCss(rawHtml);
  html = inlineScripts(html);

  ensureDir(DIST_DIR);
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  copyDataDir();

  const size = (fs.statSync(DIST_HTML).size / 1024).toFixed(1);
  console.log(`[build] escrito ${path.relative(ROOT, DIST_HTML)} (${size} KB)`);
  console.log(`[build] data copiada a dist/data/`);
}

try {
  main();
} catch (err) {
  console.error('[build] error:', err.message);
  process.exit(1);
}
