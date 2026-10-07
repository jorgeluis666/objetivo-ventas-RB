#!/usr/bin/env node
/**
 * Genera data/ventas-2026.json con totales mensuales, datos semanales y transacciones por canal.
 *
 * Fuentes:
 *   2026 → la hoja de la carpeta de Drive "Ventas Royal Baby - 2026" (compartida por enlace,
 *          sin credenciales). Se lee con js/fuentes-drive.js, el mismo código que usa el botón
 *          Sincronizar del tablero.
 *   2025 → el Google Sheet "TASA DE VENTAS DIARIAS 2025" por la API de Sheets (service account).
 *
 * Modos:
 *   node scripts/fetch-data.js                   → Drive (2026) + Sheets API (2025)
 *   node scripts/fetch-data.js --solo-2026       → Drive (2026); 2025 se conserva del JSON actual
 *   node scripts/fetch-data.js --csv-dir=<path>  → lee CSVs locales de ambos años (dev / bootstrap)
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const FD = require('../js/fuentes-drive.js');
const { hojaDeCarpeta } = require('./drive-publico.js');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials', 'service-account.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ventas-2026.json');

const SHEET_2025 = { id: '13gqg8ZueL4YOj3wQ7gypf3Mem3oNBSFyPNJE67cICQ0', range: 'A1:H100' };

const FIELDS_2025 = ['d2025_live', 'd2025_commercial', 'weekly2025', 'weekly2025_commercial',
  'transactions2025', 'transactions2025_commercial'];

// --- CSV parser (mínimo, maneja campos entrecomillados) ---
function parseCSVText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

let _sheetsClient = null;
async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`No existe ${CREDENTIALS_PATH}. Colocá la service account JSON ahí (o usá --solo-2026).`);
  }
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// Nombres EXACTOS de las pestañas de un spreadsheet.
async function listTabs(spreadsheetId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  return (res.data.sheets || []).map(s => s.properties.title);
}

async function loadRowsFromApi(tab, spreadsheetId, rangeSpec) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!${rangeSpec}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.data.values || [];
}

function loadRowsFromCsv(monthConfig, csvDir, year) {
  // Busca archivos con cualquiera de estos prefijos y el mes en el nombre:
  //   "TASA DE VENTAS DIARIAS <año> - <MES>*.csv"  (2026 típico)
  //   "TASA DE VENDA <año> - <MES>*.csv"           (2025 típico)
  const yearStr = String(year);
  const prefixes = [`TASA DE VENTAS DIARIAS ${yearStr}`, `TASA DE VENDA ${yearStr}`];
  const monthUpper = monthConfig.sheet.toUpperCase();
  const candidates = fs.readdirSync(csvDir).filter(f => {
    const up = f.toUpperCase();
    if (!up.endsWith('.CSV')) return false;
    if (!prefixes.some(p => up.startsWith(p))) return false;
    // Match por palabra (evita que ENERO matchee FEBRERO, etc.)
    return new RegExp(`\\b${monthUpper}\\b`).test(up);
  });
  if (candidates.length === 0) {
    // Del mes en curso o del siguiente puede no haber CSV todavía: sin ventas, no es una falla.
    if (!FD.isClosedMonth(year, monthConfig.monthIndex)) return [];
    throw new Error(`No se encontró CSV para ${monthConfig.sheet} (${year}) en ${csvDir}`);
  }
  // Preferimos el de menor longitud (el original sin sufijos "(1)", " (copy)", etc.)
  candidates.sort((a, b) => a.length - b.length);
  return parseCSVText(fs.readFileSync(path.join(csvDir, candidates[0]), 'utf8'));
}

function parseArgs(argv) {
  const args = { csvDir: null, solo2026: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--csv-dir=')) args.csvDir = a.substring('--csv-dir='.length);
    if (a === '--solo-2026') args.solo2026 = true;
  }
  return args;
}

const log = msg => console.log(`  ${msg}`);

// 2026 desde la carpeta de Drive (o CSV en --csv-dir).
async function read2026(args) {
  if (args.csvDir) {
    const leido = await FD.leerAnio({
      year: 2026, cols: FD.COLS_2026, tabs: null, log,
      getRows: m => loadRowsFromCsv(m, args.csvDir, 2026),
    });
    const commercial = FD.buildCommercialYear(leido.dailyRows, 2026, FD.COLS_2026);
    return {
      failures: leido.failures, fuente: null,
      fields: {
        d2026: leido.totals, d2026_calendar: leido.totals, d2026_commercial: commercial.totals,
        weeklyData: leido.weekly, weeklyData_calendar: leido.weekly, weeklyData_commercial: commercial.weekly,
        weekly2026: leido.weekly, weekly2026_calendar: leido.weekly, weekly2026_commercial: commercial.weekly,
        transactions: leido.transactions, transactions_calendar: leido.transactions,
        transactions_commercial: commercial.transactions, commercialPeriodDays: commercial.periodDays,
        daily2026: FD.dailyByMonth(leido.dailyRows, FD.COLS_2026),
      },
    };
  }
  const carpeta = FD.CARPETAS.ventas;
  console.log(`[fetch 2026] carpeta ${FD.urlCarpeta(carpeta)}`);
  const hoja = await hojaDeCarpeta(carpeta);
  console.log(`[fetch 2026] hoja «${hoja.name}» (${hoja.id})`);
  const tabs = await FD.descargarLibro(hoja.id, { XLSX });
  console.log(`[fetch 2026] pestañas: ${Object.keys(tabs).map(t => `"${t}"`).join(', ')}`);
  const result = await FD.ventas2026(tabs, { log });
  console.log(`[fetch 2026] último día con ventas: ${result.ultimoDia || '—'}`);
  return {
    failures: result.failures,
    fuente: { carpeta, archivo: { id: hoja.id, nombre: hoja.name }, ultimoDia: result.ultimoDia },
    fields: result.fields,
  };
}

// 2025 desde su Google Sheet (o CSV en --csv-dir). Con --solo-2026 se conserva lo publicado.
async function read2025(args) {
  if (args.solo2026) {
    const actual = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    const missing = FIELDS_2025.filter(f => !actual[f]);
    if (missing.length) return { failures: [`--solo-2026: el JSON actual no tiene ${missing.join(', ')}`], fields: {} };
    console.log('[fetch 2025] --solo-2026: se conserva 2025 del JSON actual');
    return { failures: [], fields: Object.fromEntries(FIELDS_2025.map(f => [f, actual[f]])) };
  }
  let tabs = null;
  if (!args.csvDir) {
    try {
      tabs = await listTabs(SHEET_2025.id);
      console.log(`[fetch 2025] pestañas: ${tabs.map(t => `"${t}"`).join(', ')}`);
    } catch (err) {
      return { failures: [`2025: no se pudieron listar las pestañas (${err.message})`], fields: {} };
    }
  }
  const leido = await FD.leerAnio({
    year: 2025, cols: FD.COLS_2025, tabs, log,
    getRows: (m, tab) => args.csvDir ? loadRowsFromCsv(m, args.csvDir, 2025) : loadRowsFromApi(tab, SHEET_2025.id, SHEET_2025.range),
  });
  const commercial = FD.buildCommercialYear(leido.dailyRows, 2025, FD.COLS_2025);
  return {
    failures: leido.failures,
    fields: {
      d2025_live:                  leido.totals,
      d2025_commercial:            commercial.totals,
      weekly2025:                  leido.weekly,
      weekly2025_commercial:       commercial.weekly,
      transactions2025:            leido.transactions,
      transactions2025_commercial: commercial.transactions,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const r2026 = await read2026(args);
  const r2025 = await read2025(args);

  // Si alguna lectura falló, no se reescribe el JSON: queda publicado el último dato válido y el
  // workflow termina en rojo (no hay commit ni deploy). Antes el mes fallido se publicaba en S/. 0.
  const failures = [...r2026.failures, ...r2025.failures];
  if (failures.length) {
    console.error(`[fetch] ${failures.length} lectura(s) fallida(s); se conserva ${OUTPUT_PATH} sin cambios:`);
    failures.forEach(failure => console.error(`  - ${failure}`));
    process.exit(1);
  }

  const output = {
    // Hora Lima (UTC-5) sin zona: el tablero la lee añadiendo "-05:00" (ver sheets.js formatRelative).
    generated: FD.ahoraLima(),
    commercialCutoffDay: 25,
    commercialCycleLabel: '26-25',
    // Hoja de Drive de la que salió 2026: el botón Sincronizar del tablero la vuelve a leer.
    fuente2026: r2026.fuente,
    // 2026 (en curso)
    ...r2026.fields,
    // 2025 (histórico, referencia anual)
    ...r2025.fields,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[fetch] escrito ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
