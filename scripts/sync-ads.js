#!/usr/bin/env node
/**
 * Sincroniza la inversión publicitaria de Royal Baby desde dos carpetas de Google
 * Drive, una por plataforma, y escribe data/ads-2026.json.
 *
 *   Google Ads  "Royal Baby GA - <Mes> 2026"  informe de campaña, un total por mes.
 *   Meta Ads    "Royal Baby - <Mes> 2026"     export del Administrador de anuncios
 *                                             con desglose diario, edad, sexo y anuncio.
 *
 * Los archivos son hojas de cálculo nativas de Google y alt=media falla con ellas: se
 * descargan con la exportación a CSV. Un CSV subido tal cual se baja con alt=media.
 * El método se elige por el mimeType de cada archivo.
 *
 * Descubrimiento: API de Drive si hay RB_DRIVE_API_KEY (o GOOGLE_API_KEY); si no, la
 * vista pública de la carpeta, que alcanza mientras siga compartida por enlace.
 *
 * El mes sale del contenido (rango del informe en Google Ads, columna Día en Meta); el
 * nombre del archivo es solo respaldo. Un mes puede existir con una sola plataforma.
 *
 * Si falla la descarga o la lectura de un archivo no se escribe nada: queda el último
 * JSON válido y el proceso termina con código 1. Las advertencias (informe segmentado,
 * totales que no cuadran, cifras reparadas) no frenan la sincronización.
 *
 * Uso:
 *   node scripts/sync-ads.js           → sincroniza
 *   node scripts/sync-ads.js --check   → informa sin escribir
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ads-2026.json');
const USER_AGENT = 'royal-baby-dashboard-sync/1.0';
const TIMEOUT_MS = 60000;

const FOLDERS = {
  google: { id: '1TT5KTVZuGlFc7OqvGAz9nuRVyJFvwJpd', label: 'Google Ads' },
  meta:   { id: '1kjz_QSgFpkd9semvyjrlLQi3ETH8-DPm', label: 'Meta Ads' },
};

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const CSV_MIMES = new Set(['text/csv', 'text/plain', 'application/csv', 'text/comma-separated-values']);

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTH_BY_NAME = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
// El rango del informe puede venir como "1 de agosto de 2026" o "1 ago 2026".
const MONTH_BY_PREFIX = Object.fromEntries(Object.entries(MONTH_BY_NAME).map(([name, n]) => [name.slice(0, 3), n]));

// ─── Utilidades ──────────────────────────────────────────────────────────────

function normalize(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// "--" es la celda vacía de Google Ads.
function cleanText(value) {
  const text = String(value ?? '').trim();
  return text === '--' ? '' : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseNumber(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text === '--' || text === '-' || text.startsWith('<')) return null;
  const cleaned = text.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

// Impresiones y clics son enteros. Las hojas de Google Ads se armaron importando el CSV
// con coma decimal, así que "122,200" quedó guardado como 122,2 y se exporta "122,2".
// Un grupo final de una o dos cifras solo puede venir de ahí: se completa con ceros y la
// validación contra los totales confirma o desmiente la reparación.
function parseCount(raw) {
  const text = String(raw ?? '').trim();
  const grouped = text.match(/^(\d{1,3})((?:[.,]\d{3})*)[.,](\d{1,3})$/);
  if (grouped) {
    const value = Number(grouped[1] + grouped[2].replace(/[.,]/g, '') + grouped[3].padEnd(3, '0'));
    return { value, repaired: grouped[3].length < 3 || text.includes('.') };
  }
  const value = parseNumber(text);
  return { value: value === null ? null : Math.round(value), repaired: false };
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function ratio(numerator, denominator, decimals = 2) {
  if (numerator === null || numerator === undefined || !denominator) return null;
  return round(numerator / denominator, decimals);
}

function sumField(items, field) {
  let total = 0;
  for (const item of items) total += item[field] || 0;
  return total;
}

function money(value) {
  return value === null || value === undefined
    ? '—'
    : 'S/ ' + value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function count(value) {
  return value === null || value === undefined ? '—' : value.toLocaleString('es-PE', { maximumFractionDigits: 2 });
}

// ─── Meses ───────────────────────────────────────────────────────────────────

function monthId(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(id) {
  const [year, month] = id.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

function daysInMonth(id) {
  const [year, month] = id.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthOfDate(isoDate) {
  return isoDate.slice(0, 7);
}

// "Royal Baby GA - Setiembre 2026" → 2026-09
function monthFromName(name) {
  for (const match of normalize(name).matchAll(/([a-z]+)\s+(?:de(?:l)?\s+)?(\d{4})/g)) {
    if (MONTH_BY_NAME[match[1]]) return monthId(match[2], MONTH_BY_NAME[match[1]]);
  }
  return null;
}

// "1 de septiembre de 2026 - 30 de septiembre de 2026" → { start, end }
function periodFromText(text) {
  const dates = [];
  for (const match of normalize(text).matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})/g)) {
    const month = MONTH_BY_PREFIX[match[2]];
    if (month) dates.push(`${monthId(match[3], month)}-${match[1].padStart(2, '0')}`);
  }
  return dates.length >= 2 ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

// Meta exporta 2026-09-30; se acepta también 30/09/2026 por si cambia la configuración regional.
function parseDay(raw) {
  const text = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

function coverage(start, end, id, days) {
  return {
    start,
    end,
    days,
    daysInMonth: daysInMonth(id),
    complete: start <= `${id}-01` && end >= `${id}-${String(daysInMonth(id)).padStart(2, '0')}`,
  };
}

// ─── Google Ads ──────────────────────────────────────────────────────────────

const GA_COLUMNS = {
  'campana': 'campaign',
  'estado de la campana': 'status',
  'tipo de campana': 'type',
  'presupuesto': 'budget',
  'tipo de presupuesto': 'budgetType',
  'costo': 'cost',
  'coste': 'cost',
  'impr.': 'impressions',
  'impr': 'impressions',
  'impresiones': 'impressions',
  'clics': 'clicks',
  'conversiones': 'conversions',
  'conv.': 'conversions',
  'conversiones por compras': 'purchases',
  'todas las conv.': 'allConversions',
  'valor de conv.': 'conversionValue',
};
const GA_COUNT_FIELDS = ['impressions', 'clicks'];
const GA_NUMBER_FIELDS = ['cost', 'conversions', 'purchases', 'allConversions', 'conversionValue'];
const GA_METRICS = ['cost', 'impressions', 'clicks', 'conversions', 'purchases', 'allConversions', 'conversionValue'];
// Con cualquiera de estas columnas Google Ads deja costo, impresiones y clics en cero en
// las filas de campaña: las cifras reales quedan solo en las filas "Total:".
const GA_CONVERSION_SEGMENTS = [
  'categoria de conversion',
  'accion de conversion',
  'nombre de la accion de conversion',
  'tipo de accion de conversion',
  'origen de la conversion',
];
// El export en español llama "Compras" a las campañas de Shopping. En Google Ads se ven como "Shopping",
// y en el tablero "Compras" es el KPI de conversión: se guardan con el nombre de la interfaz.
const GA_TYPE_LABELS = { compras: 'Shopping' };
const campaignType = text => GA_TYPE_LABELS[normalize(text)] || text;
const GA_FIELD_LABELS = {
  cost: 'costo', impressions: 'impresiones', clicks: 'clics', conversions: 'conversiones',
  purchases: 'conversiones por compras', allConversions: 'todas las conv.', conversionValue: 'valor de conv.',
};

function googleRatios(m) {
  return {
    ...m,
    ctr: ratio(m.clicks, m.impressions, 6),
    cpc: ratio(m.cost, m.clicks),
    costPerConversion: ratio(m.cost, m.conversions),
    costPerPurchase: ratio(m.cost, m.purchases),
    roas: ratio(m.conversionValue, m.cost),
  };
}

function roundGoogle(m) {
  const out = {};
  for (const field of GA_METRICS) out[field] = m[field] === null || m[field] === undefined ? null : round(m[field]);
  return out;
}

function compareTotals(name, expected, items, fields) {
  return fields
    .filter(field => expected[field] !== null && expected[field] !== undefined)
    .map(field => {
      const actual = round(sumField(items, field));
      const tolerance = GA_COUNT_FIELDS.includes(field) ? 0 : Math.max(0.05, Math.abs(expected[field]) * 0.0005);
      return { check: name, field, expected: round(expected[field]), actual, ok: Math.abs(actual - expected[field]) <= tolerance };
    });
}

function parseGoogleReport(text) {
  const rows = parseCsv(text);
  const headerIndex = rows.slice(0, 15).findIndex(row => {
    const plain = row.map(normalize);
    return plain.includes('campana') && plain.some(cell => cell === 'costo' || cell === 'coste');
  });
  if (headerIndex < 0) throw new Error('no encuentro el encabezado del informe de campaña (Campaña, Costo…)');

  const header = rows[headerIndex];
  const plainHeader = header.map(normalize);
  const col = {};
  plainHeader.forEach((cell, index) => {
    const field = GA_COLUMNS[cell];
    if (field && !(field in col)) col[field] = index;
  });
  for (const required of ['campaign', 'cost', 'impressions', 'clicks', 'conversions']) {
    if (!(required in col)) throw new Error(`falta la columna de ${GA_FIELD_LABELS[required] || 'campaña'}`);
  }
  const segmentIndex = plainHeader.findIndex(cell => GA_CONVERSION_SEGMENTS.includes(cell));
  let segmentation = segmentIndex >= 0 ? header[segmentIndex].trim() : null;
  const period = periodFromText(rows.slice(0, headerIndex).map(row => row.join(' ')).join(' '));

  const repairs = [];
  const cell = (row, field) => (col[field] !== undefined ? row[col[field]] ?? '' : '');
  const readMetrics = (row, rowLabel) => {
    const out = {};
    for (const field of GA_COUNT_FIELDS) {
      const raw = cell(row, field).trim();
      const { value, repaired } = parseCount(raw);
      out[field] = value;
      if (repaired) repairs.push({ row: rowLabel, column: header[col[field]].trim(), raw, value });
    }
    for (const field of GA_NUMBER_FIELDS) out[field] = col[field] === undefined ? null : parseNumber(cell(row, field));
    return out;
  };

  let account = null;
  let filtered = null;
  const accountByCategory = {};
  const byType = [];
  const campaigns = new Map();

  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some(value => value.trim())) continue;
    const category = segmentIndex >= 0 ? cleanText(row[segmentIndex]) : '';
    const totalCell = row.find(value => /^total:/i.test(value.trim()));

    if (totalCell) {
      const label = totalCell.trim().replace(/^total:\s*/i, '');
      const key = normalize(label);
      // Las filas con categoría son el desglose de conversiones de ese total: costo en cero.
      if (key === 'cuenta') {
        if (category) accountByCategory[category] = parseNumber(cell(row, 'conversions')) || 0;
        else if (!account) account = readMetrics(row, 'Total: Cuenta');
      } else if (key === 'campanas filtradas' || key === 'campanas') {
        // "Total: Campañas" (informe sin filtro) o "Total: Campañas filtradas": suma de las filas de campaña, no un tipo.
        if (!category && !filtered) filtered = readMetrics(row, 'Total: Campañas filtradas');
      } else if (!category) {
        byType.push({ type: campaignType(label), ...readMetrics(row, `Total: ${label}`) });
      }
      continue;
    }

    const name = cleanText(cell(row, 'campaign'));
    if (!name) continue;
    const values = readMetrics(row, name);
    let entry = campaigns.get(name);
    if (!entry) {
      const budgetType = cleanText(cell(row, 'budgetType'));
      entry = {
        campaign: name,
        status: cleanText(cell(row, 'status')) || null,
        type: campaignType(cleanText(cell(row, 'type'))) || null,
        dailyBudget: !budgetType || normalize(budgetType).startsWith('diari') ? parseNumber(cell(row, 'budget')) : null,
        metrics: Object.fromEntries(GA_METRICS.map(field => [field, 0])),
        conversionsByCategory: {},
      };
      campaigns.set(name, entry);
    }
    for (const field of GA_METRICS) entry.metrics[field] += values[field] || 0;
    if (category) {
      entry.conversionsByCategory[category] = round((entry.conversionsByCategory[category] || 0) + (values.conversions || 0));
    }
  }

  const campaignList = [...campaigns.values()];
  // Otra segmentación que no conozcamos deja el mismo rastro: campañas sin costo con una cuenta que sí gastó.
  if (!segmentation && campaignList.length && sumField(campaignList.map(c => c.metrics), 'cost') === 0 && account?.cost > 0) {
    segmentation = 'desconocida (las campañas traen costo 0 y la cuenta no)';
  }
  const complete = !segmentation;

  const typeRows = byType.filter(row => GA_METRICS.some(field => row[field]));
  // Google Ads no siempre exporta la fila "Total: <tipo>" (en enero de 2026 faltó la de Video, de una
  // campaña quitada). Con las campañas completas, el tipo que falte se arma sumando sus campañas.
  if (complete) {
    const known = new Set(typeRows.map(row => normalize(row.type)));
    const orphan = new Map();
    for (const entry of campaignList) {
      if (!entry.type || known.has(normalize(entry.type))) continue;
      if (!orphan.has(entry.type)) orphan.set(entry.type, []);
      orphan.get(entry.type).push(entry.metrics);
    }
    for (const [type, items] of orphan) {
      const row = { type, ...Object.fromEntries(GA_METRICS.map(field => [field, sumField(items, field)])), fromCampaigns: true };
      if (GA_METRICS.some(field => row[field])) typeRows.push(row);
    }
  }
  let totals = account;
  let totalsSource = 'Total: Cuenta';
  if (!totals && typeRows.length) {
    totals = Object.fromEntries(GA_METRICS.map(field => [field, sumField(typeRows, field)]));
    totalsSource = 'suma de los totales por tipo de campaña';
  } else if (!totals && complete && campaignList.length) {
    totals = Object.fromEntries(GA_METRICS.map(field => [field, sumField(campaignList.map(c => c.metrics), field)]));
    totalsSource = 'suma de campañas';
  }
  if (!totals) throw new Error('el informe no trae campañas ni filas de totales');
  // Una columna que el export no trae queda en null, no en cero: sin «Conversiones por compras» no hay KPI de compras.
  const missing = GA_NUMBER_FIELDS.filter(field => col[field] === undefined);
  for (const field of missing) totals[field] = null;

  // Validación: todo lo que se pueda sumar se compara contra la fila de totales.
  const checks = [];
  if (account && typeRows.length) {
    checks.push(...compareTotals('Total por tipo de campaña vs Total: Cuenta', account, typeRows, GA_METRICS));
  }
  if (account && campaignList.length) {
    // Segmentado, cada fila de campaña solo trae bien las conversiones y su valor.
    const fields = complete ? GA_METRICS : ['conversions', 'purchases', 'allConversions', 'conversionValue'];
    checks.push(...compareTotals('Suma de campañas vs Total: Cuenta', account, campaignList.map(c => c.metrics), fields));
  }
  if (account && Object.keys(accountByCategory).length) {
    const items = Object.values(accountByCategory).map(conversions => ({ conversions }));
    checks.push(...compareTotals('Conversiones por categoría vs Total: Cuenta', account, items, ['conversions']));
  }
  // Si difieren, el informe tiene un filtro que deja fuera campañas con gasto.
  if (complete && filtered && account) {
    checks.push(...compareTotals('Total: Campañas filtradas vs Total: Cuenta', account, [filtered], ['cost']));
  }

  return {
    period,
    segmentation,
    campaignsComplete: complete,
    totalsSource,
    totals: googleRatios(roundGoogle(totals)),
    conversionsByCategory: Object.keys(accountByCategory).length ? accountByCategory : null,
    byType: typeRows.map(row => ({
      type: row.type,
      ...googleRatios(roundGoogle(row)),
      ...(row.fromCampaigns ? { fromCampaigns: true } : {}),
    })),
    campaigns: campaignList.map(entry => {
      const metrics = roundGoogle(entry.metrics);
      // Sin el export completo el costo, las impresiones y los clics de cada campaña no se conocen: null, no 0.
      if (!complete) for (const field of ['cost', 'impressions', 'clicks']) metrics[field] = null;
      for (const field of missing) metrics[field] = null;
      return {
        campaign: entry.campaign,
        status: entry.status,
        type: entry.type,
        dailyBudget: entry.dailyBudget,
        complete,
        ...googleRatios(metrics),
        conversionsByCategory: Object.keys(entry.conversionsByCategory).length ? entry.conversionsByCategory : null,
      };
    }),
    missingColumns: missing,
    repairs,
    checks,
  };
}

// ─── Meta Ads ────────────────────────────────────────────────────────────────

const META_COLUMNS = {
  'dia': 'day',
  'edad': 'age',
  'sexo': 'gender',
  'nombre del anuncio': 'ad',
  'objetivo': 'objective',
  'impresiones': 'impressions',
  'clics en el enlace': 'linkClicks',
  'ctr (todos)': 'ctrAll',
  'interacciones': 'interactions',
  'compras': 'purchases',
  'valor de conversion de compras': 'purchaseValue',
  'conversaciones con mensajes iniciadas': 'conversations',
  'visitas a la pagina de destino del sitio web': 'landingViews',
  'articulos agregados al carrito': 'addToCart',
  'pagos iniciados': 'checkouts',
  'tipo de resultado': 'resultType',
  'resultados': 'results',
  'nombre de la campana': 'campaign',
  'nombre del conjunto de anuncios': 'adset',
  'enlace de vista previa': 'adLink',
  'inicio del informe': 'reportStart',
  'fin del informe': 'reportEnd',
};
// Solo lo aditivo. Alcance y Frecuencia cuentan personas únicas: no se pueden sumar
// entre días, edades ni anuncios, y no se publican.
const META_METRICS = ['spend', 'impressions', 'linkClicks', 'allClicks', 'interactions', 'purchases', 'purchaseValue', 'conversations'];
// Pasos del embudo entre el clic y la compra: van en el total del mes y en cada campaña, no en la serie diaria.
const META_FUNNEL = ['landingViews', 'addToCart', 'checkouts'];
const META_SUMS = [...META_METRICS, ...META_FUNNEL];
const META_FUNNEL_LABELS = {
  landingViews: 'Visitas a la página de destino del sitio web',
  addToCart: 'Artículos agregados al carrito',
  checkouts: 'Pagos iniciados',
};
// Público (edad y sexo) y anuncios: un total por mes, sin serie diaria.
const META_BREAKDOWN = ['spend', 'impressions', 'linkClicks', 'purchases', 'purchaseValue', 'conversations'];
const META_MONEY = new Set(['spend', 'purchaseValue']);
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const GENDER_ORDER = ['female', 'male', 'unknown'];
const TOP_ADS = 10;

function emptyMeta(fields = META_SUMS) {
  return Object.fromEntries(fields.map(field => [field, 0]));
}

function roundMeta(m, fields = META_SUMS) {
  const out = {};
  for (const field of fields) out[field] = round(m[field], META_MONEY.has(field) ? 2 : 0);
  return out;
}

function addMetrics(target, source, fields) {
  for (const field of fields) target[field] += source[field];
}

// El enlace de vista previa lleva el ID del anuncio (feed_demo_ad=…): dos anuncios pueden llamarse igual.
function adKey(row) {
  const id = (row.adLink.match(/[?&]feed_demo_ad=(\d+)/) || [])[1];
  return id || row.adLink || `${row.campaign}|${row.adset}|${row.ad}`;
}

// Edad y sexo se suman por mes; "Unknown" queda al final.
function audienceBy(rows, field, order) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!groups.has(key)) groups.set(key, emptyMeta(META_BREAKDOWN));
    addMetrics(groups.get(key), row.metrics, META_BREAKDOWN);
  }
  const rank = key => (order.includes(key) ? order.indexOf(key) : order.length);
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([key, metrics]) => ({ [field]: key, ...roundMeta(metrics, META_BREAKDOWN) }));
}

// CTR, CPM y costos se recalculan desde las sumas; nunca se promedian.
function metaRatios(m) {
  return {
    ...m,
    ctr: ratio(m.allClicks, m.impressions, 6),
    linkCtr: ratio(m.linkClicks, m.impressions, 6),
    cpm: ratio(m.spend * 1000, m.impressions),
    cpc: ratio(m.spend, m.linkClicks),
    costPerPurchase: ratio(m.spend, m.purchases),
    roas: ratio(m.purchaseValue, m.spend),
  };
}

function parseMetaReport(text) {
  const rows = parseCsv(text);
  const headerIndex = rows.slice(0, 10).findIndex(row => row.map(normalize).includes('nombre de la campana'));
  if (headerIndex < 0) throw new Error('no encuentro el encabezado del export de Meta (Nombre de la campaña…)');
  const header = rows[headerIndex];
  const col = {};
  header.forEach((name, index) => {
    const plain = normalize(name);
    const field = META_COLUMNS[plain] || (plain.startsWith('importe gastado') ? 'spend' : null);
    if (field && !(field in col)) col[field] = index;
  });
  for (const [field, label] of [['spend', 'Importe gastado'], ['impressions', 'Impresiones']]) {
    if (!(field in col)) throw new Error(`falta la columna ${label}`);
  }
  const currency = (header[col.spend].match(/\(([A-Z]{3})\)/) || [])[1] || null;
  const cell = (row, field) => (col[field] !== undefined ? row[col[field]] ?? '' : '');
  const warnings = [];
  if (currency && currency !== 'PEN') warnings.push(`el importe gastado viene en ${currency}, no en PEN`);

  const parsed = [];
  const seen = new Set();
  let duplicates = 0;
  let badDays = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some(value => value.trim())) continue;
    const campaign = cell(row, 'campaign').trim();
    if (!campaign) continue;
    const day = col.day !== undefined ? parseDay(cell(row, 'day')) : null;
    if (col.day !== undefined && !day) { badDays++; continue; }
    // Dos anuncios pueden llamarse igual: el enlace de vista previa lleva el ID de cada uno.
    const key = ['day', 'age', 'gender', 'ad', 'adLink', 'adset', 'campaign'].map(field => cell(row, field)).join('|');
    if (seen.has(key)) duplicates++;
    seen.add(key);
    const impressions = parseNumber(cell(row, 'impressions')) || 0;
    const ctrAll = parseNumber(cell(row, 'ctrAll'));
    const results = parseNumber(cell(row, 'results')) || 0;
    parsed.push({
      day,
      campaign,
      adset: cell(row, 'adset').trim(),
      ad: cell(row, 'ad').trim(),
      adLink: cell(row, 'adLink').trim(),
      age: cell(row, 'age').trim() || 'Unknown',
      gender: normalize(cell(row, 'gender')) || 'unknown',
      objective: cell(row, 'objective').trim(),
      resultType: results ? cell(row, 'resultType').trim() || '(sin tipo)' : null,
      results,
      reportStart: parseDay(cell(row, 'reportStart')),
      reportEnd: parseDay(cell(row, 'reportEnd')),
      metrics: {
        spend: parseNumber(cell(row, 'spend')) || 0,
        impressions,
        linkClicks: parseNumber(cell(row, 'linkClicks')) || 0,
        // Meta no exporta los clics (todos); salen exactos de CTR (todos) × impresiones.
        allClicks: ctrAll === null ? 0 : Math.round(ctrAll * impressions / 100),
        interactions: parseNumber(cell(row, 'interactions')) || 0,
        purchases: parseNumber(cell(row, 'purchases')) || 0,
        purchaseValue: parseNumber(cell(row, 'purchaseValue')) || 0,
        conversations: parseNumber(cell(row, 'conversations')) || 0,
        landingViews: parseNumber(cell(row, 'landingViews')) || 0,
        addToCart: parseNumber(cell(row, 'addToCart')) || 0,
        checkouts: parseNumber(cell(row, 'checkouts')) || 0,
      },
    });
  }
  if (!parsed.length) throw new Error('el export no trae filas de campañas');
  // Un paso del embudo sin columna en el export queda en null, no en cero.
  const missingFunnel = META_FUNNEL.filter(field => col[field] === undefined);
  for (const field of missingFunnel) warnings.push(`falta la columna ${META_FUNNEL_LABELS[field]}: ese paso del embudo no se muestra`);
  if (badDays) warnings.push(`${badDays} filas con una fecha que no se pudo leer en la columna Día; quedaron fuera`);
  if (duplicates) warnings.push(`${duplicates} filas repetidas (mismo día, edad, sexo y anuncio): revisar si el export se duplicó`);
  if (col.ctrAll === undefined) warnings.push('falta la columna CTR (todos): el CTR solo se puede calcular con clics en el enlace');

  // El mes es el del contenido. Si el export se pasa de mes, las filas de otros meses no se cuentan.
  const daily = col.day !== undefined;
  const dates = parsed.flatMap(row => (daily ? [row.day] : [row.reportStart, row.reportEnd])).filter(Boolean).sort();
  let month = dates.length ? monthOfDate(dates[0]) : null;
  if (daily) {
    const perMonth = {};
    for (const row of parsed) perMonth[monthOfDate(row.day)] = (perMonth[monthOfDate(row.day)] || 0) + 1;
    month = Object.entries(perMonth).sort((a, b) => b[1] - a[1])[0][0];
    const outside = parsed.length - perMonth[month];
    if (outside) warnings.push(`${outside} filas de otros meses quedaron fuera (el export pasa de ${monthLabel(month)})`);
  } else {
    warnings.push('el export no tiene la columna Día: sin serie diaria para este mes');
  }
  const kept = daily ? parsed.filter(row => monthOfDate(row.day) === month) : parsed;

  const campaigns = new Map();
  const dailyRows = new Map();
  const ads = new Map();
  for (const row of kept) {
    let entry = campaigns.get(row.campaign);
    if (!entry) {
      entry = { campaign: row.campaign, objectives: new Set(), resultsByType: {}, metrics: emptyMeta() };
      campaigns.set(row.campaign, entry);
    }
    if (row.objective) entry.objectives.add(row.objective);
    addMetrics(entry.metrics, row.metrics, META_SUMS);
    if (row.resultType) entry.resultsByType[row.resultType] = (entry.resultsByType[row.resultType] || 0) + row.results;

    if (col.ad !== undefined) {
      const key = adKey(row);
      let ad = ads.get(key);
      if (!ad) {
        ad = { ad: row.ad || '(sin nombre)', campaign: row.campaign, link: row.adLink || null, metrics: emptyMeta(META_BREAKDOWN) };
        ads.set(key, ad);
      }
      addMetrics(ad.metrics, row.metrics, META_BREAKDOWN);
    }

    if (!daily) continue;
    const key = `${row.day}|${row.campaign}`;
    let day = dailyRows.get(key);
    if (!day) {
      day = { day: row.day, campaign: row.campaign, metrics: emptyMeta(META_METRICS), results: 0 };
      dailyRows.set(key, day);
    }
    addMetrics(day.metrics, row.metrics, META_METRICS);
    day.results += row.results;
  }

  const resultsByType = {};
  const campaignList = [...campaigns.values()].map(entry => {
    const types = Object.keys(entry.resultsByType);
    for (const type of types) resultsByType[type] = (resultsByType[type] || 0) + entry.resultsByType[type];
    if (types.length > 1) {
      warnings.push(`«${entry.campaign}» mezcla tipos de resultado (${types.join(', ')}): sus resultados no se suman en un solo número`);
    }
    const metrics = metaRatios(roundMeta(entry.metrics));
    for (const field of missingFunnel) metrics[field] = null;
    const single = types.length === 1 ? types[0] : null;
    return {
      campaign: entry.campaign,
      objective: [...entry.objectives].join(', ') || null,
      resultType: types.length ? single || 'mixto' : null,
      results: single || !types.length ? round(entry.resultsByType[single] || 0) : null,
      costPerResult: single ? ratio(metrics.spend, entry.resultsByType[single]) : null,
      resultsByType: types.length > 1 ? entry.resultsByType : undefined,
      ...metrics,
    };
  }).sort((a, b) => b.spend - a.spend);

  // Los resultados de cada día llevan el tipo de su campaña; uno mixto no se publica sumado.
  const typeOf = Object.fromEntries(campaignList.map(c => [c.campaign, c.resultType]));
  const dailyList = [...dailyRows.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.campaign.localeCompare(b.campaign))
    .map(row => ({
      day: row.day,
      campaign: row.campaign,
      ...roundMeta(row.metrics, META_METRICS),
      results: typeOf[row.campaign] === 'mixto' ? null : round(row.results),
    }));

  // Anuncios top del mes: los que trajeron compras o conversaciones, primero las compras.
  const adList = [...ads.values()].filter(ad => ad.metrics.spend > 0 || ad.metrics.impressions > 0);
  const topAds = adList
    .filter(ad => ad.metrics.purchases > 0 || ad.metrics.conversations > 0)
    .sort((a, b) => b.metrics.purchases - a.metrics.purchases
      || b.metrics.conversations - a.metrics.conversations
      || b.metrics.spend - a.metrics.spend)
    .slice(0, TOP_ADS)
    .map(ad => {
      const metrics = roundMeta(ad.metrics, META_BREAKDOWN);
      return { ad: ad.ad, campaign: ad.campaign, link: ad.link, ...metrics, roas: ratio(metrics.purchaseValue, metrics.spend) };
    });

  const totals = metaRatios(roundMeta(Object.fromEntries(META_SUMS.map(field => [field, sumField(campaignList, field)]))));
  for (const field of missingFunnel) totals[field] = null;

  const days = new Set(kept.map(row => row.day).filter(Boolean));
  const keptDates = daily ? [...days].sort() : dates;
  return {
    month,
    currency,
    rows: kept.length,
    granularity: daily ? 'diaria' : 'mensual',
    coverage: month ? coverage(keptDates[0], keptDates[keptDates.length - 1], month, daily ? days.size : null) : null,
    totals,
    resultsByType: Object.fromEntries(Object.entries(resultsByType).map(([type, value]) => [type, round(value)])),
    campaigns: campaignList,
    audience: {
      age: col.age !== undefined ? audienceBy(kept, 'age', AGE_ORDER) : null,
      gender: col.gender !== undefined ? audienceBy(kept, 'gender', GENDER_ORDER) : null,
    },
    ads: col.ad !== undefined ? { count: adList.length, top: topAds } : null,
    daily: daily ? dailyList : null,
    warnings,
  };
}

// ─── Consolidado ─────────────────────────────────────────────────────────────

function consolidate(month) {
  const g = month.google?.totals;
  const m = month.meta?.totals;
  const platforms = [g && 'google', m && 'meta'].filter(Boolean);
  const spend = round((g?.cost || 0) + (m?.spend || 0));
  const impressions = (g?.impressions || 0) + (m?.impressions || 0);
  const clicks = (g?.clicks || 0) + (m?.linkClicks || 0);
  const purchases = round((g?.purchases || 0) + (m?.purchases || 0));
  const purchaseValue = round((g?.conversionValue || 0) + (m?.purchaseValue || 0));
  const metaDaily = month.meta?.granularity === 'diaria';
  const dailyBasis = !g ? (metaDaily ? 'real' : 'estimado') : !m || !metaDaily ? 'estimado' : 'mixto';

  const notes = [];
  if (platforms.length === 1) notes.push(`Solo hay datos de ${FOLDERS[platforms[0]].label} para este mes.`);
  if (platforms.length === 2) {
    notes.push('Clics = clics de Google Ads + clics en el enlace de Meta.');
    notes.push('Compras y valor: cada plataforma usa su propia atribución; una misma venta puede estar contada en las dos.');
  }
  if (dailyBasis === 'mixto') notes.push('La serie diaria mezcla Meta (cifras diarias reales) con Google Ads (total del mes repartido entre los días, estimado).');
  if (dailyBasis === 'estimado') notes.push('No hay cifras diarias reales este mes: la serie diaria es el total del mes repartido entre los días.');
  if (g && g.purchases === null) notes.push('Google Ads no informó compras este mes: las compras y el costo por compra son solo de Meta.');

  return {
    platforms,
    spend,
    impressions,
    clicks,
    purchases,
    purchaseValue,
    cpm: ratio(spend * 1000, impressions),
    costPerPurchase: ratio(spend, purchases),
    roas: ratio(purchaseValue, spend),
    spendShare: platforms.length === 2 && spend
      ? { google: ratio(g.cost, spend, 4), meta: ratio(m.spend, spend, 4) }
      : null,
    dailyBasis,
    notes,
  };
}

// ─── Drive ───────────────────────────────────────────────────────────────────

function apiKey() {
  return (process.env.RB_DRIVE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).replace(/^﻿/, '');
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

async function listWithApi(folderId, key) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime)',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    key,
  });
  const payload = JSON.parse(await fetchText(`https://www.googleapis.com/drive/v3/files?${params}`));
  return (payload.files || []).map(file => ({
    id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime || null,
  }));
}

// La vista pública trae el mimeType en el ícono de cada archivo (…/type/<mimeType>).
async function listWithPublicView(folderId) {
  const html = await fetchText(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`);
  const files = [];
  for (const block of html.split('<div class="flip-entry"').slice(1)) {
    const id = (block.match(/^\s*id="entry-([-\w]{20,})"/) || [])[1];
    const name = (block.match(/class="flip-entry-title">([^<]+)</) || [])[1];
    const mimeType = (block.match(/\/type\/([^"?]+)"/) || [])[1] || null;
    if (id && name) files.push({ id, name: decodeHtml(name.trim()), mimeType, modifiedTime: null });
  }
  return files;
}

async function listFolder(folderId) {
  const key = apiKey();
  if (key) {
    try {
      const files = await listWithApi(folderId, key);
      if (files.length) return { files, discovery: 'api' };
    } catch (err) {
      console.warn(`  ! la API de Drive falló (${err.message}); uso la vista pública`);
    }
  }
  const files = await listWithPublicView(folderId);
  if (!files.length) throw new Error('la carpeta no devolvió archivos (¿dejó de estar compartida por enlace?)');
  return { files, discovery: 'pública' };
}

function isTabular(file) {
  return file.mimeType === SHEET_MIME || CSV_MIMES.has(file.mimeType) || (!file.mimeType && /\.csv$/i.test(file.name));
}

// Hoja nativa: exportar a CSV. CSV subido: bajar el archivo (alt=media).
function downloadUrls(file, key) {
  const id = encodeURIComponent(file.id);
  const k = encodeURIComponent(key);
  if (file.mimeType === SHEET_MIME) {
    return [
      key && `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv&key=${k}`,
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
    ].filter(Boolean);
  }
  return [
    key && `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${k}`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ].filter(Boolean);
}

async function download(file) {
  let lastError = null;
  for (const url of downloadUrls(file, apiKey())) {
    try {
      const text = await fetchText(url);
      if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Drive devolvió una página web en vez del CSV (¿el archivo dejó de estar compartido?)');
      return text;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`no se pudo descargar: ${lastError?.message}`);
}

// ─── Sincronización ──────────────────────────────────────────────────────────

async function readPlatform(platform, failures, log) {
  const folder = FOLDERS[platform];
  const { files, discovery } = await listFolder(folder.id);
  const tabular = files.filter(isTabular);
  for (const file of files.filter(f => !isTabular(f) && f.mimeType !== 'application/vnd.google-apps.folder')) {
    log.push(`${folder.label}: «${file.name}» no es una hoja de Google ni un CSV (${file.mimeType || 'tipo desconocido'}); no se lee`);
  }
  console.log(`[ads] ${folder.label}: ${tabular.length} archivos (vista ${discovery})`);

  const reports = [];
  for (const file of tabular) {
    try {
      const text = await download(file);
      const report = platform === 'google' ? parseGoogleReport(text) : parseMetaReport(text);
      const fromContent = platform === 'google' ? (report.period && monthOfDate(report.period.start)) : report.month;
      const fromName = monthFromName(file.name);
      const month = fromContent || fromName;
      if (!month) throw new Error('no se pudo deducir el mes ni del contenido ni del nombre');
      if (fromContent && fromName && fromContent !== fromName) {
        log.push(`${folder.label}: «${file.name}» dice ${monthLabel(fromName)} en el nombre pero el contenido es de ${monthLabel(fromContent)}; uso el contenido`);
      }
      if (platform === 'google' && report.period && monthOfDate(report.period.end) !== monthOfDate(report.period.start)) {
        log.push(`${folder.label}: «${file.name}» cubre más de un mes (${report.period.start} a ${report.period.end}); queda en ${monthLabel(month)}`);
      }
      reports.push({ file, month, monthFrom: fromContent ? 'contenido' : 'nombre', report });
    } catch (err) {
      failures.push(`${folder.label} «${file.name}»: ${err.message}`);
    }
  }

  // Dos archivos del mismo mes: gana el modificado más reciente, si Drive lo informa.
  const byMonth = new Map();
  reports.sort((a, b) => String(b.file.modifiedTime || '').localeCompare(String(a.file.modifiedTime || '')) || a.file.name.localeCompare(b.file.name));
  for (const entry of reports) {
    const current = byMonth.get(entry.month);
    if (current) {
      log.push(`${folder.label}: hay dos archivos de ${monthLabel(entry.month)}; uso «${current.file.name}» e ignoro «${entry.file.name}»`);
      continue;
    }
    byMonth.set(entry.month, entry);
  }
  return {
    source: {
      folderId: folder.id,
      folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
      discovery,
      files: tabular.map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime })),
    },
    byMonth,
  };
}

function googleBlock(entry, warnings) {
  const { report, file, month } = entry;
  const label = `Google Ads ${monthLabel(month)}`;
  if (report.segmentation) {
    warnings.push(`${label}: el informe viene segmentado por «${report.segmentation}»: las campañas traen conversiones pero costo, impresiones y clics en cero. Los KPIs del mes salen de «${report.totalsSource}» y la tabla por campaña queda incompleta.`);
  }
  const failed = report.checks.filter(check => !check.ok);
  for (const check of failed) {
    warnings.push(`${label}: ${check.check} no cuadra en ${GA_FIELD_LABELS[check.field] || check.field}: total ${count(check.expected)}, suma ${count(check.actual)}.`);
  }
  if (report.repairs.length) {
    const sample = report.repairs.slice(0, 3).map(r => `${r.column} de «${r.row}» "${r.raw}" → ${count(r.value)}`).join('; ');
    warnings.push(`${label}: ${report.repairs.length} cifra(s) que la hoja había truncado al importar el CSV se completaron (${sample})${failed.length ? '' : '; cuadran con los totales'}.`);
  }
  if (report.missingColumns.includes('purchases')) {
    warnings.push(`${label}: falta la columna «Conversiones por compras»: sin KPI de compras de Google Ads este mes.`);
  }
  if (report.missingColumns.includes('conversionValue')) {
    warnings.push(`${label}: falta la columna «Valor de conv.»: sin ROAS de Google Ads este mes.`);
  }
  return {
    source: { name: file.name, id: file.id, mimeType: file.mimeType, modifiedTime: file.modifiedTime },
    monthFrom: entry.monthFrom,
    granularity: 'mensual',
    coverage: report.period ? coverage(report.period.start, report.period.end, month, null) : null,
    segmentation: report.segmentation,
    campaignsComplete: report.campaignsComplete,
    totalsSource: report.totalsSource,
    totals: report.totals,
    conversionsByCategory: report.conversionsByCategory,
    byType: report.byType,
    campaigns: report.campaigns,
    checks: report.checks,
    repairs: report.repairs,
  };
}

function metaBlock(entry, warnings) {
  const { report, file, month } = entry;
  for (const warning of report.warnings) warnings.push(`Meta Ads ${monthLabel(month)}: ${warning}`);
  return {
    source: { name: file.name, id: file.id, mimeType: file.mimeType, modifiedTime: file.modifiedTime },
    monthFrom: entry.monthFrom,
    granularity: report.granularity,
    coverage: report.coverage,
    currency: report.currency,
    rows: report.rows,
    totals: report.totals,
    resultsByType: report.resultsByType,
    campaigns: report.campaigns,
    audience: report.audience,
    ads: report.ads,
    daily: report.daily,
  };
}

// JSON con indentación, pero cada objeto plano en una sola línea: las series diarias quedan legibles y el diff es corto.
function serialize(document) {
  return JSON.stringify(document, null, 2)
    .replace(/\{\n\s+([^{}[\]]*?)\n\s+\}/g, (_, body) => `{ ${body.split(/,\n\s+/).join(', ')} }`) + '\n';
}

function comparable(document) {
  return JSON.stringify({ months: document.months, warnings: document.warnings, pending: document.pending });
}

function reportToActions(changed) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

function printMonth(month) {
  const g = month.google;
  const m = month.meta;
  console.log(`\n  ${month.label}`);
  if (g) {
    const t = g.totals;
    const ctr = t.ctr === null ? '—' : `${(t.ctr * 100).toFixed(2)}%`;
    console.log(`    Google  ${money(t.cost)} · ${count(t.impressions)} impr · ${count(t.clicks)} clics · CTR ${ctr} · ${count(t.purchases)} compras · costo/compra ${money(t.costPerPurchase)} · valor ${money(t.conversionValue)} (conversiones con Contacto: ${count(t.conversions)})`);
    const rebuilt = g.byType.filter(row => row.fromCampaigns).map(row => row.type);
    console.log(`            ${g.campaignsComplete ? `${g.campaigns.length} campañas completas` : `tabla por campaña INCOMPLETA (segmentada por ${g.segmentation}); KPIs desde ${g.totalsSource}`}${rebuilt.length ? ` · sin fila de total en el informe, sumado desde sus campañas: ${rebuilt.join(', ')}` : ''}`);
  }
  if (m) {
    const t = m.totals;
    const ctr = t.ctr === null ? '—' : `${(t.ctr * 100).toFixed(2)}%`;
    const results = Object.entries(m.resultsByType).map(([type, value]) => `${count(value)} ${type}`).join(', ') || 'sin resultados';
    console.log(`    Meta    ${money(t.spend)} · ${count(t.impressions)} impr · ${count(t.linkClicks)} clics enlace · CTR ${ctr} · CPM ${money(t.cpm)} · ${count(t.purchases)} compras · costo/compra ${money(t.costPerPurchase)} · ${count(t.conversations)} conversaciones`);
    console.log(`            ${m.campaigns.length} campañas · ${m.coverage?.days ?? '—'} días con datos · resultados: ${results}`);
    console.log(`            embudo: ${count(t.landingViews)} visitas · ${count(t.addToCart)} al carrito · ${count(t.checkouts)} pagos iniciados · ${count(t.purchases)} compras · ${m.ads ? `${m.ads.top.length} anuncios top de ${m.ads.count}` : 'sin columna de anuncio'}`);
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const failures = [];
  const warnings = [];
  const google = await readPlatform('google', failures, warnings);
  const meta = await readPlatform('meta', failures, warnings);

  if (failures.length) {
    console.error(`[ads] ${failures.length} archivo(s) fallaron; se conserva ${path.relative(process.cwd(), OUTPUT_PATH)} sin cambios:`);
    failures.forEach(failure => console.error(`  - ${failure}`));
    process.exit(1);
  }

  const ids = [...new Set([...google.byMonth.keys(), ...meta.byMonth.keys()])].sort();
  const months = ids.map(id => {
    const before = warnings.length;
    const month = { id, label: monthLabel(id) };
    if (google.byMonth.has(id)) month.google = googleBlock(google.byMonth.get(id), warnings);
    if (meta.byMonth.has(id)) month.meta = metaBlock(meta.byMonth.get(id), warnings);
    month.consolidated = consolidate(month);
    month.warnings = warnings.slice(before);
    return month;
  });

  const segmented = months.filter(month => month.google?.segmentation);
  const pending = segmented.length
    ? [`Google Ads: exportar de nuevo el informe de campaña sin segmentar por «${segmented[0].google.segmentation}», con Campaña, Costo, Impr., CTR, Clics, Prom. CPC, Conversiones, Costo/conv., Conversiones por compras y Valor de conv. por campaña, y reemplazar las hojas de ${segmented.map(month => month.label).join(', ')}.`]
    : [];

  const document = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    currency: 'PEN',
    rules: [
      'Google Ads llega mensual: sin serie diaria real. Meta Ads llega por día y la serie diaria es real.',
      'Meta: la serie diaria va por día y campaña (edad, sexo y anuncio se suman). El público (audience: edad y sexo) y los anuncios top (ads.top, con su enlace de vista previa) van por mes. Alcance y frecuencia no son aditivos y no se publican.',
      'Embudo de Meta: impresiones → clics en el enlace → visitas a la página de destino (landingViews) → agregados al carrito (addToCart) → pagos iniciados (checkouts) → compras. Un paso en null = el export no trae la columna.',
      'CTR, CPC, CPM, costo por resultado y ROAS se recalculan sobre las sumas, nunca se promedian. CTR en fracción (0.0674 = 6.74%).',
      'Los resultados de Meta llevan su tipo; no se suman resultados de tipos distintos.',
      'KPI de conversión: Compras (purchases, costPerPurchase). Google Ads = «Conversiones por compras»; Meta = «Compras». Las conversiones de Google Ads incluyen Contacto (clics a WhatsApp) y quedan aparte en conversions y conversionsByCategory.',
      'Google Ads: campaña con costo, impresiones o clics en null = no informado por el export (segmentado), no cero.',
    ],
    sources: { google: google.source, meta: meta.source },
    pending,
    warnings,
    months,
  };

  console.log(`[ads] ${months.length} meses: ${months.map(month => `${month.id} (${[month.google && 'G', month.meta && 'M'].filter(Boolean).join('+')})`).join(', ')}`);
  months.forEach(printMonth);
  if (warnings.length) {
    console.log(`\n[ads] ${warnings.length} advertencia(s):`);
    warnings.forEach(warning => console.log(`  ! ${warning}`));
  }
  pending.forEach(item => console.log(`\n[ads] PENDIENTE: ${item}`));

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')); } catch { /* primera vez */ }
  const changed = !previous || comparable(previous) !== comparable(document);
  if (check) {
    console.log(`\n[ads] ${changed ? 'hay cambios' : 'sin cambios'} (--check: no se escribe)`);
    return;
  }
  if (changed) fs.writeFileSync(OUTPUT_PATH, serialize(document));
  console.log(`\n[ads] ${changed ? 'escrito' : 'sin cambios en'} ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  reportToActions(changed);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseCsv, parseCount, parseGoogleReport, parseMetaReport, monthFromName, periodFromText, consolidate };
