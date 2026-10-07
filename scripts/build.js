#!/usr/bin/env node
/**
 * build.js — arma dist/ para GitHub Pages (https://royalbaby.limaretail.com).
 *
 * Salida: dist/index.html, dist/assets/ y dist/CNAME. Nada más: data/, scripts/ y README no se publican.
 * index.html lleva incrustados el CSS, todos los js/ y los datos (ventas-2026.json, objetivos-2026.json y
 * ads-2026.json, este último sin los campos que el tablero no lee).
 *
 * Con RB_PAGE_PASSWORD el tablero se cifra (AES-256-GCM, llave PBKDF2-SHA256 de 600 000 iteraciones)
 * dentro de deploy/pages-gate.html, que lo descifra en el navegador con la clave. Sin la variable,
 * dist/index.html queda en claro: sirve solo para probar en local (el workflow no publica sin clave).
 *
 * Uso: RB_PAGE_PASSWORD=<clave> node scripts/build.js
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT      = path.join(__dirname, '..');
const DIST_DIR  = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

const PBKDF2_ITERATIONS = 600000;

// Datos que usa el tablero: viajan dentro del HTML (cifrado), nunca como archivos sueltos en dist/.
// Los demás JSON de data/ (destinatarios y registro de alertas) y los CSV no se publican.
const EMBEDDED_DATA = {
  RB_VENTAS_DATA:    'data/ventas-2026.json',
  RB_OBJETIVOS_DATA: 'data/objetivos-2026.json',
  RB_GASTO_DATA:     'data/ads-2026.json',
};

// Campos que el tablero no lee: se quitan al incrustar para no inflar el HTML cifrado.
const TRIM_DATA = {
  RB_GASTO_DATA(doc) {
    delete doc.rules;
    for (const month of doc.months || []) {
      if (month.google) {
        delete month.google.checks;
        delete month.google.repairs;
      }
      // Por día y campaña, la inversión diaria (js/gasto.js) usa inversión, compras y conversaciones, y las
      // tarjetas de Proyecciones (js/projections.js) además el valor de las compras.
      month.meta?.daily?.forEach(row => {
        for (const field of Object.keys(row)) {
          if (!['day', 'campaign', 'spend', 'purchases', 'purchaseValue', 'conversations'].includes(field)) delete row[field];
        }
      });
    }
    return doc;
  },
};

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Un "</script>" o "</style>" dentro de un archivo incrustado cerraría la etiqueta antes de tiempo.
function assertEmbeddable(rel, content, tag) {
  if (new RegExp(`</${tag}`, 'i').test(content)) throw new Error(`${rel} contiene </${tag}> y no se puede incrustar`);
  return content;
}

// Todos los reemplazos usan funciones: con una cadena de reemplazo, un "$&" o "$'" dentro del
// código o de los datos se interpretaría como patrón y rompería el resultado.
function inlineCss(html) {
  return html.replace(/<link rel="stylesheet" href="(css\/[\w.-]+\.css)">/g, (_, href) => {
    // Incrustado, el CSS se resuelve desde dist/index.html: '../assets/' pasa a 'assets/'.
    const css = assertEmbeddable(href, readFile(href), 'style').replaceAll('../assets/', 'assets/');
    return `<style>\n/* ${href} */\n${css}\n</style>`;
  });
}

// Se incrustan en el orden de index.html todos los js/ que carga: no hay otra lista que mantener.
function inlineScripts(html) {
  return html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (_, src) => {
    const js = assertEmbeddable(src, readFile(src), 'script');
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });
}

function embedData(html) {
  const assignments = Object.entries(EMBEDDED_DATA).map(([name, rel]) => {
    // JSON.parse valida el archivo; '<' es el texto "<" escapado para que nada cierre el <script>.
    const data = JSON.parse(readFile(rel));
    const json = JSON.stringify(TRIM_DATA[name] ? TRIM_DATA[name](data) : data).replace(/</g, '\\u003c');
    return `window.${name} = ${json};`;
  });
  if (html.split('</head>').length !== 2) throw new Error('index.html debe tener un solo </head>');
  return html.replace('</head>', () => `<script>\n${assignments.join('\n')}\n</script>\n</head>`);
}

// dist/ solo lleva index.html, assets/ y CNAME: cualquier otro archivo local quedaría roto al publicar.
function checkLocalReferences(rawHtml, html) {
  if (/<link[^>]*rel="stylesheet"[^>]*href="(?!https:)|<script[^>]*src="(?!https:)/.test(html)) {
    throw new Error('index.html carga un css o js local que el build no incrusta');
  }
  for (const [, ref] of rawHtml.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
    if (/^(https:|#|data:|mailto:|css\/|js\/)/.test(ref)) continue;
    if (!ref.startsWith('assets/')) throw new Error(`index.html usa ${ref}, que no se publica (solo assets/)`);
    if (!fs.existsSync(path.join(ROOT, ref))) throw new Error(`falta ${ref}`);
  }
}

// La salida es compatible con WebCrypto: el tag de GCM va pegado al final del texto cifrado.
function encryptPage(html, password) {
  // Sal fija por marca (no es secreta): la llave que recuerda el navegador sigue sirviendo después del deploy
  // diario y solo deja de servir cuando cambia la clave. El iv sí es nuevo en cada build.
  const salt = crypto.createHash('sha256').update('lr-gate:royal-baby').digest().subarray(0, 16);
  const iv   = crypto.randomBytes(12);
  const key  = crypto.pbkdf2Sync(password.normalize('NFC'), salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(html, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const payload = JSON.stringify({
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv:   iv.toString('base64'),
    data: data.toString('base64'),
  });
  const template = readFile('deploy/pages-gate.html');
  if (template.split('__PAYLOAD__').length !== 2) throw new Error('deploy/pages-gate.html debe contener __PAYLOAD__ exactamente una vez');
  return template.replace('__PAYLOAD__', () => payload).replace(/\r\n?/g, '\n');
}

function main() {
  const rawHtml = readFile('index.html');
  let html = inlineCss(rawHtml);
  html = inlineScripts(html);
  checkLocalReferences(rawHtml, html);
  html = embedData(html);
  html = html.replace(/\r\n?/g, '\n');

  const cname = readFile('CNAME').trim();
  if (!cname) throw new Error('CNAME está vacío');

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const password = process.env.RB_PAGE_PASSWORD || '';
  const output = password ? encryptPage(html, password) : html;
  if (password && Object.keys(EMBEDDED_DATA).some(name => output.includes(name))) {
    throw new Error('dist/index.html quedó con los datos en claro');
  }
  fs.writeFileSync(DIST_HTML, output, 'utf8');
  if (password) console.log('[build] dist/index.html cifrado con RB_PAGE_PASSWORD');
  else console.warn('[build] sin RB_PAGE_PASSWORD: dist/index.html queda sin clave (solo para uso local)');

  // El logo y el fondo del acceso se referencian por URL: son lo único que se publica fuera del HTML.
  fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST_DIR, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), `${cname}\n`, 'utf8');

  const size = (fs.statSync(DIST_HTML).size / 1024).toFixed(1);
  console.log(`[build] dist/index.html (${size} KB), assets/ y CNAME (${cname})`);
}

try {
  main();
} catch (err) {
  console.error('[build] error:', err.message);
  process.exit(1);
}
