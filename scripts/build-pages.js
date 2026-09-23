#!/usr/bin/env node
/**
 * build-pages.js — build para GitHub Pages (sin autenticación HTTP).
 * Incrusta CSS y JS en dist/index.html y copia los JSON públicos.
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const DIST_DIR  = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

const PUBLIC_DATA = ['ventas-2026.json', 'ads-data.json'];

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function inlineCss(html) {
  return html.replace(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g,
    (match, href) => {
      if (/^https?:\/\//.test(href)) return match;
      return `<style>\n/* ${href} */\n${readFile(href)}\n</style>`;
    }
  );
}

function inlineScripts(html) {
  return html.replace(
    /<script\s+src="([^"]+)"\s*><\/script>/g,
    (match, src) => {
      if (/^https?:\/\//.test(src)) return match;
      return `<script>\n/* ${src} */\n${readFile(src)}\n</script>`;
    }
  );
}

function main() {
  let html = readFile('index.html');
  html = inlineCss(html);
  html = inlineScripts(html);
  html = html.replace(/\r\n?/g, '\n');

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');

  const destData = path.join(DIST_DIR, 'data');
  fs.mkdirSync(destData, { recursive: true });
  for (const name of PUBLIC_DATA) {
    const src = path.join(ROOT, 'data', name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destData, name));
      console.log(`[build] copiado data/${name}`);
    }
  }

  const size = (fs.statSync(DIST_HTML).size / 1024).toFixed(1);
  console.log(`[build] dist/index.html (${size} KB)`);
}

try {
  main();
} catch (err) {
  console.error('[build] error:', err.message);
  process.exit(1);
}
