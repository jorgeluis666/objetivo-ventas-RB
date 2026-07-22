#!/usr/bin/env node
/**
 * Lee los Google Sheets "TASA DE VENTAS DIARIAS 2025" y "... 2026" y genera
 * data/ventas-2026.json con totales mensuales, datos semanales y transacciones
 * por canal para ambos años.
 *
 * Modos:
 *   node scripts/fetch-data.js                   → lee desde Google Sheets API
 *   node scripts/fetch-data.js --csv-dir=<path>  → lee CSVs locales (dev / bootstrap)
 */

const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials', 'service-account.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ventas-2026.json');

function monthsForYear(year) {
  return [
    { sheet: 'ENERO',      name: 'Enero',      monthIndex: 0,  days: 31 },
    { sheet: 'FEBRERO',    name: 'Febrero',    monthIndex: 1,  days: year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28 },
    { sheet: 'MARZO',      name: 'Marzo',      monthIndex: 2,  days: 31 },
    { sheet: 'ABRIL',      name: 'Abril',      monthIndex: 3,  days: 30 },
    { sheet: 'MAYO',       name: 'Mayo',       monthIndex: 4,  days: 31 },
    { sheet: 'JUNIO',      name: 'Junio',      monthIndex: 5,  days: 30 },
    { sheet: 'JULIO',      name: 'Julio',      monthIndex: 6,  days: 31 },
    { sheet: 'AGOSTO',     name: 'Agosto',     monthIndex: 7,  days: 31 },
    { sheet: 'SEPTIEMBRE', name: 'Septiembre', monthIndex: 8,  days: 30 },
    { sheet: 'OCTUBRE',    name: 'Octubre',    monthIndex: 9,  days: 31 },
    { sheet: 'NOVIEMBRE',  name: 'Noviembre',  monthIndex: 10, days: 30 },
    { sheet: 'DICIEMBRE',  name: 'Diciembre',  monthIndex: 11, days: 31 },
  ];
}

// Layouts de columnas por año. Los sheets 2025 y 2026 tienen órdenes distintos:
//   2025 (A–H): FECHA | CANT/MONTO | WHATSAPP | INSTAGRAM | FACEBOOK | WEB | TIENDA | TOTAL
//   2026 (A–I): FECHA | CANT/MONTO | WHATSAPP | INSTAGRAM | FACEBOOK | SHOWROOM | WEB | TIENDA | TOTAL
const COLS_2025 = [
  { col: 2, upper: 'WHATSAPP',  title: 'WhatsApp'  },
  { col: 3, upper: 'INSTAGRAM', title: 'Instagram' },
  { col: 4, upper: 'FACEBOOK',  title: 'Facebook'  },
  { col: 5, upper: 'WEB',       title: 'Web'       },
  { col: 6, upper: 'TIENDA',    title: 'Tienda'    },
  // Showroom no existe en 2025 — se completa con 0
  { col: null, upper: 'SHOWROOM', title: 'Showroom' },
];
const COLS_2026 = [
  { col: 2, upper: 'WHATSAPP',  title: 'WhatsApp'  },
  { col: 3, upper: 'INSTAGRAM', title: 'Instagram' },
  { col: 4, upper: 'FACEBOOK',  title: 'Facebook'  },
  { col: 5, upper: 'SHOWROOM',  title: 'Showroom'  },
  { col: 6, upper: 'WEB',       title: 'Web'       },
  { col: 7, upper: 'TIENDA',    title: 'Tienda'    },
];

// Cada año con su sheet, meses y layout. 2025 = histórico (año completo),
// 2026 = en curso. Para 2026 leemos los meses hasta el actual + 1 (cierra
// margen para meses recién creados). Tabs inexistentes caen al fallback de zeros.
function monthsUpToCurrent(year) {
  const all = monthsForYear(year);
  const today = new Date();
  if (today.getFullYear() < year)  return [];
  if (today.getFullYear() > year)  return all;
  return all.slice(0, today.getMonth() + 2); // +1 actual, +1 buffer
}

const SOURCES = [
  { year: 2025, id: '13gqg8ZueL4YOj3wQ7gypf3Mem3oNBSFyPNJE67cICQ0', months: monthsForYear(2025),       cols: COLS_2025, range: 'A1:H100' },
  { year: 2026, id: '1WQhZyWVWq7cnLybU-LfXRBVg8B66jbNNPqfcYD_assM', months: monthsUpToCurrent(2026),    cols: COLS_2026, range: 'A1:I100' },
];

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '' || s === '-') return 0;
  const cleaned = s
    .replace(/S\/\.?/gi, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Agrupa días del mes en semanas calendario (Lun–Dom, clipadas al mes).
 * Día 1 arranca en W1; cada lunes subsecuente incrementa el número de semana.
 * Replica la estructura de weeklyData original del dashboard.
 */
function buildWeekMap(year, monthIndex, daysInMonth) {
  const dayToWeek = new Array(daysInMonth + 1);
  let weekNum = 1;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, monthIndex, d).getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
    if (d > 1 && dow === 1) weekNum++;
    dayToWeek[d] = weekNum;
  }
  return dayToWeek;
}

function parseSheet(rows, monthConfig, year, cols) {
  const totals = {};
  const transactions = {};
  cols.forEach(c => { totals[c.title] = 0; transactions[c.upper] = 0; });

  const dayToWeek = buildWeekMap(year, monthConfig.monthIndex, monthConfig.days);
  const weekCount = dayToWeek[monthConfig.days];

  const weeklyTotals = [];
  const dailyRows = [];
  for (let w = 1; w <= weekCount; w++) {
    const row = { w, TOTAL: 0 };
    cols.forEach(c => { row[c.upper] = 0; });
    weeklyTotals.push(row);
  }

  let dayCounter = 0;
  let pendingCantidad = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const label = String(row[1] || '').trim().toUpperCase();
    if (label === 'CANTIDAD') {
      pendingCantidad = row;
    } else if (label === 'MONTO' && pendingCantidad) {
      dayCounter++;
      if (dayCounter > monthConfig.days) break;
      const w = dayToWeek[dayCounter];
      const weekRow = weeklyTotals[w - 1];

      const dailyTotals = {};
      const dailyTransactions = {};
      cols.forEach(c => { dailyTotals[c.title] = 0; dailyTransactions[c.upper] = 0; });

      for (const c of cols) {
        if (c.col == null) continue; // Canal no presente en el sheet (ej. Showroom en 2025)
        const qty = toNumber(pendingCantidad[c.col]);
        const amount = toNumber(row[c.col]);
        transactions[c.upper] += qty;
        totals[c.title] += amount;
        weekRow[c.upper] += amount;
        weekRow.TOTAL += amount;
        dailyTransactions[c.upper] += qty;
        dailyTotals[c.title] += amount;
      }

      dailyRows.push({
        year,
        monthIndex: monthConfig.monthIndex,
        day: dayCounter,
        totals: dailyTotals,
        transactions: dailyTransactions,
      });
      pendingCantidad = null;
    }
  }

  cols.forEach(c => { totals[c.title] = round2(totals[c.title]); });
  weeklyTotals.forEach(wr => {
    wr.TOTAL = round2(wr.TOTAL);
    cols.forEach(c => { wr[c.upper] = round2(wr[c.upper]); });
  });

  dailyRows.forEach(dr => {
    Object.keys(dr.totals).forEach(k => { dr.totals[k] = round2(dr.totals[k]); });
  });

  return { totals, transactions, weeklyTotals, dailyRows };
}

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
    throw new Error(`No existe ${CREDENTIALS_PATH}. Colocá la service account JSON ahí.`);
  }
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// Diagnóstico: lista los nombres EXACTOS de los tabs de un spreadsheet.
async function listTabs(spreadsheetId) {
  const sheets = await getSheetsClient();
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    return (res.data.sheets || []).map(s => s.properties.title);
  } catch (err) {
    return { error: err.message };
  }
}

// Matcher case-insensitive: dado un nombre deseado (ej. 'ENERO') devuelve el
// tab real que coincide ignorando mayúsculas/espacios — o null si no hay match.
function resolveTabName(wantedUpper, availableTabs) {
  const norm = s => String(s).trim().toUpperCase();
  const wantedNorm = norm(wantedUpper);
  return availableTabs.find(t => norm(t) === wantedNorm) || null;
}

async function loadRowsFromApi(monthConfig, spreadsheetId, rangeSpec) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${monthConfig.sheet}!${rangeSpec || 'A1:I100'}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.data.values || [];
}

function loadRowsFromCsv(monthConfig, csvDir, year) {
  // Busca archivos con cualquiera de estos prefijos y el mes en el nombre:
  //   "TASA DE VENTAS DIARIAS <año> - <MES>*.csv"  (2026 típico)
  //   "TASA DE VENDA <año> - <MES>*.csv"           (2025 típico)
  const yearStr = String(year);
  const prefixes = [
    `TASA DE VENTAS DIARIAS ${yearStr}`,
    `TASA DE VENTAS DIARIAS ${yearStr} -`,
    `TASA DE VENDA ${yearStr}`,
    `TASA DE VENDA ${yearStr} -`,
  ];
  const monthUpper = monthConfig.sheet.toUpperCase();
  const candidates = fs.readdirSync(csvDir).filter(f => {
    const up = f.toUpperCase();
    if (!up.endsWith('.CSV')) return false;
    if (!prefixes.some(p => up.startsWith(p))) return false;
    // Match por palabra (evita que ENERO matchee FEBRERO, etc.)
    return new RegExp(`\\b${monthUpper}\\b`).test(up);
  });
  if (candidates.length === 0) {
    throw new Error(`No se encontró CSV para ${monthConfig.sheet} (${year}) en ${csvDir}`);
  }
  // Preferimos el de menor longitud (el original sin sufijos "(1)", " (copy)", etc.)
  candidates.sort((a, b) => a.length - b.length);
  const filePath = path.join(csvDir, candidates[0]);
  const text = fs.readFileSync(filePath, 'utf8');
  return parseCSVText(text);
}

function parseArgs(argv) {
  const args = { csvDir: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--csv-dir=')) args.csvDir = a.substring('--csv-dir='.length);
  }
  return args;
}

async function fetchYear(source, args) {
  const totals = {};
  const weekly = {};
  const transactions = {};
  const dailyRows = [];

  // Diagnóstico: tabs que efectivamente existen en el spreadsheet
  let availableTabs = null;
  if (!args.csvDir) {
    const probe = await listTabs(source.id);
    if (Array.isArray(probe)) {
      availableTabs = probe;
      console.log(`[fetch ${source.year}] tabs en el sheet: ${probe.map(t => `"${t}"`).join(', ')}`);
    } else {
      console.error(`[fetch ${source.year}] no pude listar tabs: ${probe.error}`);
    }
  }

  for (const m of source.months) {
    // Si conocemos los tabs reales, resolvemos el nombre ignorando mayúsculas/espacios.
    const resolvedSheet = availableTabs
      ? resolveTabName(m.sheet, availableTabs)
      : m.sheet;

    if (availableTabs && !resolvedSheet) {
      console.error(`  ! ${source.year} ${m.sheet}: no hay tab que coincida (case-insensitive)`);
      totals[m.name] = Object.fromEntries(source.cols.map(c => [c.title, 0]));
      transactions[m.name] = Object.fromEntries(source.cols.map(c => [c.upper, 0]));
      weekly[m.name] = [];
      continue;
    }

    const effectiveMonth = { ...m, sheet: resolvedSheet || m.sheet };
    console.log(`[fetch ${source.year}] leyendo "${effectiveMonth.sheet}"...`);
    let rows;
    try {
      rows = args.csvDir
        ? loadRowsFromCsv(effectiveMonth, args.csvDir, source.year)
        : await loadRowsFromApi(effectiveMonth, source.id, source.range);
    } catch (err) {
      console.error(`  ! ${source.year} ${effectiveMonth.sheet}: ${err.message}`);
      totals[m.name] = Object.fromEntries(source.cols.map(c => [c.title, 0]));
      transactions[m.name] = Object.fromEntries(source.cols.map(c => [c.upper, 0]));
      weekly[m.name] = [];
      continue;
    }

    const parsed = parseSheet(rows, m, source.year, source.cols);
    totals[m.name]       = parsed.totals;
    transactions[m.name] = parsed.transactions;
    weekly[m.name]       = parsed.weeklyTotals;
    dailyRows.push(...parsed.dailyRows);

    const monthTotal = round2(Object.values(parsed.totals).reduce((a, b) => a + b, 0));
    console.log(`  ${source.year} · ${m.name}: S/. ${monthTotal.toLocaleString('es-PE')} · ${parsed.weeklyTotals.length} semanas`);
  }

  return { totals, weekly, transactions, dailyRows };
}

function commercialPeriodDays(year, targetMonthIndex) {
  const start = new Date(year, targetMonthIndex - 1, 26);
  const end = new Date(year, targetMonthIndex, 25);
  return Math.round((end - start) / 86400000) + 1;
}

function buildEmptyWeekly(cols, days) {
  const weekCount = Math.ceil(days / 7);
  const weeks = [];
  for (let w = 1; w <= weekCount; w++) {
    const row = { w, TOTAL: 0 };
    cols.forEach(c => { row[c.upper] = 0; });
    weeks.push(row);
  }
  return weeks;
}

function buildCommercialYear(dailyRows, sourceYear, cols) {
  const monthConfigs = monthsForYear(sourceYear);
  const totals = {};
  const weekly = {};
  const transactions = {};
  const periodDays = {};

  monthConfigs.forEach(m => {
    periodDays[m.name] = commercialPeriodDays(sourceYear, m.monthIndex);
    totals[m.name] = Object.fromEntries(cols.map(c => [c.title, 0]));
    transactions[m.name] = Object.fromEntries(cols.map(c => [c.upper, 0]));
    weekly[m.name] = buildEmptyWeekly(cols, periodDays[m.name]);
  });

  dailyRows.forEach(dr => {
    let targetYear = dr.year;
    let targetMonthIndex = dr.monthIndex;
    let periodDay;

    if (dr.day > 25) {
      targetMonthIndex = dr.monthIndex + 1;
      periodDay = dr.day - 25;
      if (targetMonthIndex > 11) {
        targetMonthIndex = 0;
        targetYear += 1;
      }
    } else {
      const previousMonthDays = new Date(dr.year, dr.monthIndex, 0).getDate();
      periodDay = previousMonthDays - 25 + dr.day;
    }

    if (targetYear !== sourceYear) return;
    const monthName = monthConfigs[targetMonthIndex]?.name;
    if (!monthName || !totals[monthName]) return;

    const weekIndex = Math.max(0, Math.ceil(periodDay / 7) - 1);
    const weekRow = weekly[monthName][weekIndex];
    if (!weekRow) return;

    cols.forEach(c => {
      const amount = dr.totals[c.title] || 0;
      const qty = dr.transactions[c.upper] || 0;
      totals[monthName][c.title] += amount;
      transactions[monthName][c.upper] += qty;
      weekRow[c.upper] += amount;
      weekRow.TOTAL += amount;
    });
  });

  Object.values(totals).forEach(month => {
    Object.keys(month).forEach(k => { month[k] = round2(month[k]); });
  });
  Object.values(weekly).forEach(weeks => weeks.forEach(wr => {
    wr.TOTAL = round2(wr.TOTAL);
    cols.forEach(c => { wr[c.upper] = round2(wr[c.upper]); });
  }));

  return { totals, weekly, transactions, periodDays };
}
async function main() {
  const args = parseArgs(process.argv);
  const source = args.csvDir ? `CSV (${args.csvDir})` : 'Google Sheets API';
  console.log(`[fetch] fuente: ${source}`);

  const results = {};
  for (const src of SOURCES) {
    results[src.year] = await fetchYear(src, args);
  }

  // Timestamp en hora Lima (UTC-5). Perú no aplica horario de verano.
  // El resultado es un ISO-8601 sin zona ("2026-05-16T10:30:00"); el cliente
  // lo parsea añadiendo "-05:00" (ver sheets.js formatRelative).
  const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;
  const generated = new Date(Date.now() + LIMA_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '');

  const commercial2026 = buildCommercialYear(results[2026].dailyRows, 2026, COLS_2026);
  const commercial2025 = buildCommercialYear(results[2025].dailyRows, 2025, COLS_2025);

  const output = {
    generated,
    commercialCutoffDay: 25,
    commercialCycleLabel: '26-25',
    // 2026 (en curso)
    d2026:        results[2026].totals,
    d2026_calendar: results[2026].totals,
    d2026_commercial: commercial2026.totals,
    weeklyData:   results[2026].weekly,
    weeklyData_calendar: results[2026].weekly,
    weeklyData_commercial: commercial2026.weekly,       // nombre legacy, usado por objectives.js
    weekly2026:   results[2026].weekly,
    weekly2026_calendar: results[2026].weekly,
    weekly2026_commercial: commercial2026.weekly,       // alias explícito
    transactions: results[2026].transactions,
    transactions_calendar: results[2026].transactions,
    transactions_commercial: commercial2026.transactions,
    commercialPeriodDays: commercial2026.periodDays, // legacy → usado por pace cards
    // 2025 (histórico, referencia anual)
    d2025_live:        results[2025].totals,
    d2025_commercial:  commercial2025.totals,
    weekly2025:        results[2025].weekly,
    weekly2025_commercial: commercial2025.weekly,
    transactions2025:  results[2025].transactions,
    transactions2025_commercial: commercial2025.transactions,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[fetch] escrito ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
