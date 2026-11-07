#!/usr/bin/env node
/**
 * reportes-auto.js — deja en la carpeta Reportes de Drive los tres reportes del tablero, en PDF.
 *
 * Es la «generación automática» que pidió el cliente: no arma un documento aparte, imprime el que ya
 * hace el tablero. Abre index.html en un Chrome sin pantalla con el enlace directo del reporte
 * (?rpt=semanal|acumulado|mensual), espera a que el tablero marque window.RB_REPORTE_LISTO con el
 * periodo pedido y guarda la impresión: el semanal sale en A4 y el mensual y el acumulado en láminas
 * de 1280×720, con las mismas reglas @media print que el botón «Descargar PDF».
 *
 * Qué toca cada día (fecha de Lima, js/ciclo.js):
 *   lunes            → el semanal de la semana que cerró ayer y el acumulado del mes a ese domingo
 *   día 1 del ciclo  → el mensual del mes que cerró ayer (el acumulado de ese domingo no se repite)
 * Un reporte que ya está en la carpeta no se vuelve a subir, así que la corrida se puede repetir.
 *
 * Uso:
 *   node scripts/reportes-auto.js                      # lo que toque hoy, y lo sube a Drive
 *   node scripts/reportes-auto.js --dry                # dice qué subiría, sin abrir Chrome
 *   node scripts/reportes-auto.js --salida=tmp         # guarda los PDF ahí y no sube nada
 *   node scripts/reportes-auto.js --fecha=2026-11-02   # como si hoy fuera ese día
 *   node scripts/reportes-auto.js --formato=mensual    # solo ese formato, aunque hoy no toque
 *   node scripts/reportes-auto.js --forzar             # sube aunque ya esté en la carpeta
 *
 * Variables: RB_DRIVE_SCRIPT_URL y RB_DRIVE_WRITE_KEY (la clave de escritura del Apps Script, que no
 * es la de lectura: esa viaja dentro del tablero publicado). CHROME_PATH si Chrome no está donde se
 * lo busca. Sin poder leer la carpeta o subir, sale con código 1 y no deja nada a medias.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');
const Ciclo = require('../js/ciclo.js');
const { listFolder } = require('./drive-publico.js');

const RAIZ = path.join(__dirname, '..');
const CARPETA_REPORTES = '1TxuNI5ig8xnakT0JhH56iv-M3zyKWeR6';
const CLIENTE = 'Reporte Royal Baby';
const ESPERA_MS = 90000;

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto = null) => {
  const found = args.find(a => a.startsWith(`--${nombre}=`));
  return found ? found.slice(nombre.length + 3) : porDefecto;
};
const DRY = args.includes('--dry');
const FORZAR = args.includes('--forzar');
const SALIDA = opcion('salida');
const HOY = opcion('fecha', Ciclo.hoyLima());
const FORMATO = opcion('formato');

const pad = n => String(n).padStart(2, '0');
const log = msg => console.log(`  ${msg}`);

// ── Qué reportes toca dejar hoy ──────────────────────────────────────────────────────────────────
// Cada uno lleva el enlace con el que se imprime, el nombre con el que vive en Drive y lo que el
// tablero tiene que confirmar en RB_REPORTE_LISTO para que no se suba el reporte de otro periodo.
function pendientes(hoy) {
  const ayer = Ciclo.sumarDias(hoy, -1);
  const mesHoy = Ciclo.mesDe(hoy);
  const mesAyer = Ciclo.mesDe(ayer);
  const cierreAyer = mesHoy.dia === 1 && mesAyer.dia === mesAyer.dias;   // ayer cerró el ciclo
  const out = [];

  if (Ciclo.diaSemana(hoy) === 1) {
    const lunes = Ciclo.sumarDias(hoy, -7);
    const anterior = Ciclo.sumarDias(lunes, -7);
    const sem = semanaDe(ayer);
    out.push({
      tipo: 'semanal',
      enlace: { rpt: 'semanal', semana: lunes },
      nombre: `${CLIENTE} | Semana ${sem.n} de ${sem.mes}: ${Ciclo.rango(lunes, ayer)} vs ${Ciclo.rango(anterior, Ciclo.sumarDias(lunes, -1))}`,
      espera: info => info.lunes === lunes,
      pdf: { format: 'A4', landscape: false },
    });
    // El domingo que cierra el ciclo es el mensual: no se sube dos veces el mismo periodo.
    if (!cierreAyer) {
      out.push({
        tipo: 'acumulado',
        enlace: { rpt: 'acumulado', corte: ayer },
        nombre: `${CLIENTE} | Acumulado de ${mesAyer.mes} al ${Ciclo.corta(ayer)}`,
        espera: info => info.corte === ayer,
        pdf: { preferCSSPageSize: true },
      });
    }
  }

  if (cierreAyer) {
    out.push({
      tipo: 'mensual',
      enlace: { rpt: 'mensual', periodo: `${mesAyer.year}-${pad(mesAyer.mi + 1)}` },
      nombre: `${CLIENTE} | Reporte ${mesAyer.mes}`,
      espera: info => info.periodo === `${mesAyer.year}-${pad(mesAyer.mi + 1)}` && !info.corte,
      pdf: { preferCSSPageSize: true },
    });
  }

  return FORMATO ? out.filter(r => r.tipo === FORMATO) : out;
}

// La semana del ciclo a la que pertenece un domingo, numerada como en el tablero (js/reporte-semanal.js).
function semanaDe(domingo) {
  const m = Ciclo.mesDe(domingo);
  const s = Ciclo.semanas(m.year, m.mi).find(w => domingo >= w.inicio && domingo <= w.fin);
  return { n: s ? s.w : 1, mes: m.mes };
}

// Con --formato de un día que no toca, se arma igual con el último periodo cerrado.
function forzadoPorFormato(hoy) {
  const domingo = Ciclo.sumarDias(hoy, -((new Date(`${hoy}T00:00:00Z`).getUTCDay() + 6) % 7) - 1);
  if (FORMATO === 'semanal' || FORMATO === 'acumulado') return pendientes(Ciclo.sumarDias(domingo, 1));
  const mes = Ciclo.mesDe(hoy);
  const anterior = Ciclo.periodo(mes.mi === 0 ? mes.year - 1 : mes.year, mes.mi === 0 ? 11 : mes.mi - 1);
  return pendientes(Ciclo.sumarDias(anterior.fin, 1));
}

// ── Servidor local del tablero (el mismo index.html, leyendo data/) ──────────────────────────────
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
function servir() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(RAIZ, rel);
    if (!file.startsWith(RAIZ) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('no está');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      cerrar: () => new Promise(r => server.close(r)),
    }));
  });
}

// ── Chrome ───────────────────────────────────────────────────────────────────────────────────────
function chrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = candidatos.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) throw new Error('no se encontró Chrome; indicalo con CHROME_PATH');
  return found;
}

async function imprimir(navegador, base, reporte) {
  const query = new URLSearchParams(reporte.enlace).toString();
  const page = await navegador.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${base}/index.html?${query}`, { waitUntil: 'networkidle0', timeout: ESPERA_MS });
    await page.waitForFunction('window.RB_REPORTE_LISTO && window.RB_REPORTE_LISTO.tipo === ' + JSON.stringify(reporte.tipo), { timeout: ESPERA_MS });
    const info = await page.evaluate(() => window.RB_REPORTE_LISTO);
    if (!reporte.espera(info)) {
      throw new Error(`el tablero pintó otro periodo (${JSON.stringify(info)}): el dato todavía no llega hasta ahí`);
    }
    return await page.pdf({ printBackground: true, ...reporte.pdf });
  } finally {
    await page.close();
  }
}

// ── Drive ────────────────────────────────────────────────────────────────────────────────────────
async function subir(nombre, pdf) {
  const url = (process.env.RB_DRIVE_SCRIPT_URL || '').trim();
  const clave = (process.env.RB_DRIVE_WRITE_KEY || '').trim();
  if (!url || !clave) throw new Error('faltan RB_DRIVE_SCRIPT_URL o RB_DRIVE_WRITE_KEY');
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    signal: AbortSignal.timeout(180000),
    body: new URLSearchParams({
      action: 'subir', clave, carpeta: CARPETA_REPORTES, nombre,
      mimeType: 'application/pdf', base64: pdf.toString('base64'),
    }),
  });
  if (!res.ok) throw new Error(`el Apps Script respondió HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`no lo guardó: ${body.error || 'respuesta inválida'}`);
  return body.id;
}

// ── Corrida ──────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const hoy = HOY;
  let lista = pendientes(hoy);
  if (FORMATO && !lista.length) lista = forzadoPorFormato(hoy);
  const dia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][Ciclo.diaSemana(hoy)];
  const cuenta = !lista.length ? 'ningún reporte' : lista.length === 1 ? '1 reporte' : `${lista.length} reportes`;
  console.log(`[reportes] ${hoy} (${dia}): ${cuenta}`);
  if (!lista.length) return;

  // Lo que ya está en la carpeta no se repite (la corrida puede dispararse varias veces el mismo día).
  let enCarpeta = [];
  if (!SALIDA) {
    enCarpeta = (await listFolder(CARPETA_REPORTES)).map(f => String(f.name || '').trim());
  }
  const porHacer = lista.filter(r => {
    const ya = !FORZAR && enCarpeta.includes(r.nombre);
    log(`${r.tipo}: «${r.nombre}»${ya ? ' · ya está en la carpeta' : ''}`);
    return !ya;
  });
  if (DRY || !porHacer.length) return;

  const sitio = await servir();
  const navegador = await puppeteer.launch({
    executablePath: chrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const fallos = [];
  try {
    for (const reporte of porHacer) {
      try {
        const pdf = await imprimir(navegador, sitio.url, reporte);
        if (SALIDA) {
          fs.mkdirSync(SALIDA, { recursive: true });
          const destino = path.join(SALIDA, `${reporte.nombre.replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
          fs.writeFileSync(destino, pdf);
          log(`→ ${destino} (${Math.round(pdf.length / 1024)} kB)`);
        } else {
          const id = await subir(reporte.nombre, pdf);
          log(`→ Drive ${id} (${Math.round(pdf.length / 1024)} kB)`);
        }
      } catch (err) {
        fallos.push(`${reporte.tipo}: ${err.message}`);
      }
    }
  } finally {
    await navegador.close();
    await sitio.cerrar();
  }
  if (fallos.length) {
    fallos.forEach(f => console.error(`  ✗ ${f}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
