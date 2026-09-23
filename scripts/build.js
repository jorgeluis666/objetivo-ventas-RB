#!/usr/bin/env node
/**
 * build.js — concatena index.html + css/ + js/ en un único archivo
 * dist/index.html para publicar en el hosting de Lima Retail.
 *
 * Uso: HTPASSWD_PATH=/home/<usuario>/.htpasswds/<carpeta>/passwd node scripts/build.js
 * Salida: dist/index.html, dist/data/ventas-2026.json y dist/.htaccess.
 * Nada más: csv-backups, alertas-*.json y objetivos-2026.json no se publican.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT      = path.join(__dirname, '..');
const DIST_DIR  = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

// Único dato que el tablero pide por fetch (js/data-live.js). Lista blanca: los demás JSON de
// data/ son configuración interna (destinatarios de alertas, registro de envíos) o insumos del
// pipeline, y no deben quedar descargables.
const PUBLIC_DATA = ['ventas-2026.json', 'ads-data.json'];

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

function copyPublicData() {
  const destData = path.join(DIST_DIR, 'data');
  ensureDir(destData);
  for (const name of PUBLIC_DATA) {
    fs.copyFileSync(path.join(ROOT, 'data', name), path.join(destData, name));
  }
}

// El acceso lo controla Apache (HTTP Basic Auth), no el navegador. HTPASSWD_PATH es la ruta absoluta
// del archivo de claves en el servidor (la que crea cPanel > Privacidad de directorios). Si falta,
// se deja un marcador: Apache responde 500 en vez de servir el tablero sin clave.
function writeHtaccess(html) {
  const htpasswdPath = (process.env.HTPASSWD_PATH || '').trim();
  if (!htpasswdPath) console.warn('[build] falta HTPASSWD_PATH; dist/.htaccess queda con un marcador y el sitio no abrira');
  // CSP con el hash de cada <script> inline, porque el build mete todo el JS dentro del HTML.
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  const csp = [
    "default-src 'self'",
    `script-src 'self' https://cdnjs.cloudflare.com ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const template = readFile('deploy/.htaccess');
  for (const token of ['__HTPASSWD_PATH__', '__CSP__']) {
    if (template.split(token).length !== 2) throw new Error(`deploy/.htaccess debe contener ${token} exactamente una vez`);
  }
  const output = template
    .replace('__HTPASSWD_PATH__', htpasswdPath || '/RUTA/NO/CONFIGURADA/.htpasswd')
    .replace('__CSP__', csp);
  fs.writeFileSync(path.join(DIST_DIR, '.htaccess'), output, 'utf8');
}

function main() {
  const rawHtml = readFile('index.html');
  let html = inlineCss(rawHtml);
  html = inlineScripts(html);
  // El navegador convierte CRLF en LF antes de calcular el hash CSP de cada <script>; si el HTML
  // conserva CRLF (archivos editados en Windows) los hashes no coinciden y el tablero no carga.
  html = html.replace(/\r\n?/g, '\n');

  // dist/ se regenera entero para que no queden archivos de builds anteriores (JSON internos, assets viejos).
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  ensureDir(DIST_DIR);
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  copyPublicData();
  writeHtaccess(html);

  const size = (fs.statSync(DIST_HTML).size / 1024).toFixed(1);
  console.log(`[build] escrito ${path.relative(ROOT, DIST_HTML)} (${size} KB)`);
  console.log(`[build] data publicada: ${PUBLIC_DATA.join(', ')}`);
}

try {
  main();
} catch (err) {
  console.error('[build] error:', err.message);
  process.exit(1);
}
