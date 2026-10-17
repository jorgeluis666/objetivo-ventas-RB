/* ============================================================
   gasto.js — módulo "Gasto publicitario".
   Solo usa las carpetas de pauta de Royal Baby en Drive, una pestaña por fuente:
     Meta Ads    carpeta "Meta Files"    (export diario del Administrador de anuncios)
     Google Ads  carpeta "Google Files"  (informe de campaña, un total por mes)
   scripts/sync-ads.js las lee y escribe data/ads-2026.json; el workflow
   sync-ads.yml lo corre todos los días a las 10:30 (Lima). Publicado, el JSON
   viaja incrustado en el HTML cifrado (window.RB_GASTO_DATA, scripts/build.js).
   La fecha de sincronización y las carpetas van en el desplegable de la barra
   superior (Sheets.setDetail).
   No hay botón para sincronizar: exigiría guardar un token de GitHub en el
   navegador y el tablero lo abren clientes (ver sheets.js).
   Meta Ads sigue la estructura del tablero de Terminal Pesquero: pestañas de
   mes y Anual, periodo con KPIs contra el mismo tramo del mes anterior,
   distribución por campaña con un cuadro por campaña (KPIs, gráfico y
   conjuntos de anuncios) y la tabla de anuncios. Todo sale de meta.table.
   Google Ads repite la estructura con el informe de campaña (un total por mes)
   y, si el mes lo trae, el informe por día y palabra clave (google.detail).
   Expone window.Gasto.init() (main.js lo llama al abrir la vista) y Gasto.load(),
   la misma carga de datos, que main.js le pasa a Proyecciones.
   ============================================================ */

(function (global) {
  const FILE = 'data/ads-2026.json';
  // Mismos colores que Proyecciones: Meta E-Commerce y Google Search.
  const PLATFORMS = {
    meta: {
      label: 'Meta Ads', folderName: 'Meta Files', color: '#1877F2', letter: 'M',
      folder: 'https://drive.google.com/drive/folders/1kjz_QSgFpkd9semvyjrlLQi3ETH8-DPm',
    },
    google: {
      label: 'Google Ads', folderName: 'Google Files', color: '#4285F4', letter: 'G',
      folder: 'https://drive.google.com/drive/folders/1TT5KTVZuGlFc7OqvGAz9nuRVyJFvwJpd',
    },
  };
  const axisColor = '#94A3B8';
  const gridColor = 'rgba(15,23,42,0.06)';
  const TAB_KEY = 'rb-gp-tab';
  const PANE_CHARTS = {
    meta:   ['chart-gp-camp-*'],
    google: ['chart-gp-gcamp-*'],
  };

  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const AGE_LABELS = { Unknown: 'Sin dato' };
  const GENDER_LABELS = { female: 'Mujeres', male: 'Hombres', unknown: 'Sin dato' };

  // monthVersion sube con cada cambio de mes; rendered guarda con qué versión se pintó cada vista (ver setMonth).
  const state = { data: null, artes: null, propuestas: null, loaded: false, tab: 'meta', month: null, monthVersion: 0, rendered: {} };

  // ── Formato (mismo criterio que el resto del tablero: "S/. " y es-PE) ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, dec = 0) => n == null || !Number.isFinite(n) ? '—'
    : 'S/. ' + n.toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const num = n => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('es-PE');
  // Google Ads reparte conversiones entre campañas: pueden venir con decimales (19.75).
  const numDec = n => n == null ? '—' : n.toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const pct = (n, dec = 1) => n == null || !Number.isFinite(n) ? '—' : n.toFixed(dec) + '%';
  const ratio = (a, b) => (a == null || !b ? null : a / b);
  const roasFmt = n => n == null || !Number.isFinite(n) ? '—' : n.toFixed(1) + 'x';
  // Los costos por resultado de reconocimiento e interacción son centavos: con más decimales no quedan en 0.00.
  const unitCost = n => (n != null && n > 0 && n < 0.1
    ? 'S/. ' + n.toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 4 })
    : money(n, 2));
  const decimal = n => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FORMATS = { money: n => money(n), money2: n => money(n, 2), count: num, decimal, unitCost, roas: roasFmt };
  const fmt = (kind, n) => FORMATS[kind](n);
  // Los enlaces vienen de los archivos de Drive: solo se usan si son https.
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);
  const normalize = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const pad = n => String(n).padStart(2, '0');

  const fechaCorta = iso => { const [, mm, dd] = iso.split('-'); return `${+dd} ${SHORT[+mm - 1].toLowerCase()}`; };

  // Nombre del anuncio con enlace a su vista previa (Meta) o a su página (Google).
  const adNameLink = (name, url, title) => {
    const href = safeUrl(url);
    return href
      ? `<a class="gp-ad-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${esc(name)}<span class="gp-ad-link-ic" aria-hidden="true">↗</span></a>`
      : esc(name);
  };
  // Ventas de un anuncio: el valor atribuido y, debajo, cuántas compras o conversiones lo dieron.
  const salesCell = (value, count, word) => (value
    ? `<b>${money(value)}</b><small class="gp-cell-sub">${numDec(count)} ${word}</small>`
    : '<span class="gp-no-data">—</span>');
  // Mismos umbrales de ROAS que Proyecciones.
  const roasPill = (roas, purchases) => !purchases
    ? '<span class="pill gray">sin compras</span>'
    : `<span class="pill ${roas >= 3 ? 'green' : roas >= 1.5 ? 'amber' : 'red'}">${roasFmt(roas)}</span>`;

  function readSetting(key, fallback) {
    try { const value = localStorage.getItem(key); return value == null ? fallback : value; } catch (e) { return fallback; }
  }
  function saveSetting(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* storage bloqueado */ }
  }
  function readJson(key) {
    try {
      const value = JSON.parse(readSetting(key, '{}'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) { return {}; }
  }

  // Un render que reemplaza el HTML de host no saca el foco del control que se estaba usando (pestaña o chip).
  function keepFocus(host, render) {
    const active = document.activeElement;
    if (!host || !active || active === host || !host.contains(active)) { render(); return; }
    const sig = node => [node.tagName, node.getAttribute('name'), node.getAttribute('value'),
      ...[...node.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`)].join('|');
    const wanted = sig(active);
    render();
    if (document.activeElement === active) return;
    [...host.querySelectorAll(active.tagName)].find(node => sig(node) === wanted)?.focus({ preventScroll: true });
  }

  // ── Carga: incrustado al publicar, data/ads-2026.json en local ──
  // Una sola vez: Proyecciones (main.js) usa los mismos datos con Gasto.load().
  let request = null;
  function loadData() {
    if (!request) request = fetchData().then(data => { syncDetail(data); return data; });
    return request;
  }
  async function fetchData() {
    if (global.RB_GASTO_DATA) return global.RB_GASTO_DATA;
    try {
      const res = await fetch(FILE, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.warn('[gasto] no se pudo cargar', FILE, err);
      return null;
    }
  }

  // ── Desplegable de sincronización (barra superior) y estados comunes ──
  // Hasta qué día llega cada plataforma y la carpeta de Drive de cada una.
  function syncDetail(data) {
    if (!global.Sheets) return;
    const months = data?.months || [];
    const rows = Object.keys(PLATFORMS).map(p => {
      const last = months.filter(m => m[p]).pop();
      const c = last?.[p].coverage;
      return { label: PLATFORMS[p].label, value: !last ? 'sin informes' : c ? `hasta el ${fechaCorta(c.end)}` : last.label };
    });
    const sources = Object.entries(PLATFORMS).map(([p, cfg]) => {
      const files = data?.sources?.[p]?.files?.length || 0;
      return {
        label: `Carpeta ${cfg.folderName}`,
        value: `${files} archivo${files === 1 ? '' : 's'}`,
        href: safeUrl(data?.sources?.[p]?.folderUrl) || cfg.folder,
      };
    });
    global.Sheets.setDetail('view-rep', { generated: data?.generatedAt || null, rows, sources });
  }

  function emptyState(body, p) {
    const cfg = PLATFORMS[p];
    const url = safeUrl(state.data?.sources?.[p]?.folderUrl) || cfg.folder;
    body.innerHTML = `
      <div class="panel gp-empty">
        <div class="gp-empty-ic"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        <div class="gp-empty-title">${state.data ? `${cfg.label}: la carpeta todavía no tiene informes` : `${cfg.label} aún no sincronizado`}</div>
        <p class="gp-empty-text">${p === 'meta'
          ? 'Cuando se suba a la carpeta <b>Meta Files</b> el export del Administrador de anuncios (un archivo por mes, con desglose por día, edad, sexo y anuncio), se sincronizará solo y aparecerá aquí.'
          : 'Cuando se suba a la carpeta <b>Google Files</b> el informe de campañas de Google Ads (un archivo por mes, con el rango del mes), se sincronizará solo y aparecerá aquí.'}</p>
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir carpeta en Drive</a>
      </div>`;
  }

  // Avisos del sync: los de la plataforma en ese mes, los de su carpeta y lo pendiente.
  function renderAlerts(hostId, p, m) {
    const label = PLATFORMS[p].label;
    const monthPrefix = `${label} ${m.label}: `;
    const own = (m.warnings || []).filter(w => w.startsWith(monthPrefix)).map(w => w.slice(monthPrefix.length));
    const inMonths = new Set((state.data.months || []).flatMap(x => x.warnings || []));
    const folder = (state.data.warnings || []).filter(w => !inMonths.has(w) && w.startsWith(`${label}: `)).map(w => w.slice(label.length + 2));
    const pending = (state.data.pending || []).filter(w => w.startsWith(`${label}: `)).map(w => w.slice(label.length + 2));
    const host = document.getElementById(hostId);
    host.innerHTML = [
      ...pending.map(w => `<div class="insight warn"><b>Pendiente:</b> ${esc(w)}</div>`),
      own.length || folder.length ? `<div class="insight warn"><b>Avisos de ${esc(m.label)}</b>
        <ul class="gp-alert-list">${[...own, ...folder].map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '',
    ].join('');
    host.hidden = !host.innerHTML;
  }

  // ════════════════════════════════════════════════════════════
  // META ADS — estructura de Terminal Pesquero
  // ════════════════════════════════════════════════════════════
  const YEAR_KEY = 'anual';
  // Indicadores, vista y minimizado del gráfico de cada campaña, por clave de grupo.
  const CAMP_CHARTS_KEY = 'rb-gp-camp-charts-v1';
  const ADS_COMPACT_KEY = 'rb-gp-ads-compact-v1';
  const PREVIOUS_COLOR = '#94A3B8';
  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  // Cada campaña del reporte se agrupa por su nombre. Mismos colores que Proyecciones (E-Commerce, WhatsApp,
  // Interacción); Reconocimiento va en violeta para no repetir el de Interacción. Cada grupo mide su resultado
  // y los resultados no se suman entre grupos.
  const GROUPS = [
    { key: 'whatsapp', label: 'Mensajes WhatsApp', match: /whatsapp|mensajes/, color: '#25D366' },
    { key: 'ecommerce', label: 'Ventas E-Commerce', match: /ventas|e-?commerce|catalogo/, color: '#1877F2' },
    { key: 'interaccion', label: 'Interacción', match: /interacci/, color: '#E1306C' },
    { key: 'reconocimiento', label: 'Reconocimiento', match: /reconocimiento|alcance|notoriedad|branding|thruplay/, color: '#7C3AED' },
    { key: 'trafico', label: 'Tráfico', match: /trafico/, color: '#0D9488' },
  ];
  // Un grupo fuera de GROUPS toma el siguiente color la primera vez que aparece y lo conserva entre meses.
  const OTHER_COLORS = ['#0891B2', '#4F46E5', '#B45309', '#BE123C'];
  const otherGroups = new Map();
  const RESULT_LABELS = [
    { match: /compras en el sitio web/, label: 'Compras en la web' },
    { match: /conversaciones con mensajes/, label: 'Conversaciones' },
    { match: /thruplay/, label: 'Reproducciones (ThruPlay)' },
    { match: /interacciones/, label: 'Interacciones' },
  ];
  const SUM_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'results', 'purchases', 'purchaseValue', 'conversations'];
  const MODES = [
    { key: 'cumulative', label: 'Acumulado del mes' },
    { key: 'daily', label: 'Por día' },
    { key: 'monthly', label: 'Por mes' },
  ];
  // Indicadores del gráfico de cada campaña (Resultados toma el nombre del resultado del grupo). Se puede elegir
  // más de uno; por defecto va el resultado junto a la inversión, que es la relación que se quiere leer.
  const CAMPAIGN_METRICS = [
    { key: 'results', label: 'Resultados', field: 'results', unit: 'count' },
    { key: 'spend', label: 'Inversión', field: 'spend', unit: 'money' },
    { key: 'impressions', label: 'Impresiones', field: 'impressions', unit: 'count' },
    { key: 'reach', label: 'Alcance', field: 'reach', unit: 'count' },
  ];
  const DEFAULT_CAMPAIGN_METRICS = ['results', 'spend'];
  // KPIs de la cabecera de cada campaña, con su variación contra el mismo tramo del mes anterior. El ROAS solo
  // aparece en los grupos con compras.
  const CAMPAIGN_KPIS = [
    { key: 'results', label: null, format: 'count', better: 'up' },
    { key: 'spend', label: 'Inversión', format: 'money2', better: null },
    { key: 'costPerResult', label: 'Costo por resultado', format: 'unitCost', better: 'down' },
    { key: 'reach', label: 'Alcance', format: 'count', better: 'up' },
    { key: 'impressions', label: 'Impresiones', format: 'count', better: 'up' },
    { key: 'cpm', label: 'CPM', format: 'money2', better: 'down' },
    { key: 'roas', label: 'ROAS', format: 'roas', better: 'up', commerce: true },
  ];
  // Resumen del periodo. better: hacia dónde una variación es buena (null = neutra). perMonth: en la vista anual se
  // muestra su promedio mensual. note: segunda línea con el costo o el ROAS.
  const KPIS = [
    { key: 'spend', label: 'Inversión', hint: 'Monto gastado', better: null, format: 'money2', perMonth: true },
    { key: 'impressions', label: 'Impresiones', hint: 'Veces que se mostraron los anuncios', better: 'up', format: 'count', perMonth: true },
    { key: 'reach', label: 'Alcance', hint: 'Suma diaria por público, como en el reporte', better: 'up', format: 'count', perMonth: true },
    { key: 'frequency', label: 'Frecuencia', hint: 'Impresiones / alcance', better: null, format: 'decimal' },
    { key: 'cpm', label: 'CPM prom.', hint: 'Costo por mil impresiones', better: 'down', format: 'money2' },
    { key: 'purchases', label: 'Compras', hint: 'Compras en el sitio web', better: 'up', format: 'count', perMonth: true,
      note: t => `Costo por compra ${money(t.costPerPurchase, 2)}` },
    { key: 'purchaseValue', label: 'Valor de conversión', hint: 'Atribución de Meta', better: 'up', format: 'money', perMonth: true,
      note: t => `ROAS ${roasFmt(t.roas)} · atribución de Meta` },
    { key: 'conversations', label: 'Conversaciones iniciadas', hint: 'WhatsApp y Messenger', better: 'up', format: 'count', perMonth: true,
      note: (t, rows) => {
        const wa = summarize(rows.filter(r => r.group === 'whatsapp'));
        return wa.conversations ? `${num(wa.conversations)} de campañas de mensajes · ${money(ratio(wa.spend, wa.conversations), 2)} c/u` : '';
      } },
  ];

  const meta = {
    months: [],
    latestKey: null,
    campaignCharts: readJson(CAMP_CHARTS_KEY),
    charts: new Set(),
    adsGroup: 'all',
  };
  let metaBodyTpl = '';  // HTML original de #gp-meta-body (se guarda en init)

  // ── Datos: meta.table de cada mes → filas por día, campaña, conjunto y anuncio ──
  const hasActivity = item => item.spend > 0 || item.impressions > 0;

  function groupFor(campaign) {
    const text = normalize(campaign);
    const known = GROUPS.find(g => g.match.test(text));
    if (known) return known;
    const first = String(campaign || '').split('|')[0].trim().replace(/^campa(n|ñ)a\s+/i, '') || 'Sin grupo';
    const key = `otro-${normalize(first).replace(/[^a-z0-9]+/g, '-')}`;
    if (!otherGroups.has(key)) otherGroups.set(key, { key, label: first.charAt(0).toUpperCase() + first.slice(1), color: OTHER_COLORS[otherGroups.size % OTHER_COLORS.length] });
    return otherGroups.get(key);
  }

  function resultLabel(type) {
    const text = normalize(type);
    if (!text) return 'Sin resultados';
    return RESULT_LABELS.find(r => r.match.test(text))?.label || String(type).trim();
  }

  function normalizeMetaMonth(m) {
    const t = m.meta.table;
    const at = Object.fromEntries(t.columns.map((name, i) => [name, i]));
    const [year, month] = m.id.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const rows = t.rows.map(r => {
      const campaign = t.campaigns[r[at.campaign]] || '';
      const ad = t.ads[r[at.ad]] || {};
      const group = groupFor(campaign);
      return {
        d: r[at.d],
        day: `${m.id}-${pad(r[at.d])}`,
        campaign,
        adset: t.adsets[r[at.adset]] || '',
        ad: ad.name || '(sin nombre)',
        link: ad.link || null,
        resultType: r[at.type] == null ? '' : t.types[r[at.type]],
        spend: r[at.spend] || 0,
        impressions: r[at.impressions] || 0,
        reach: r[at.reach] || 0,
        clicks: r[at.linkClicks] || 0,
        results: r[at.results] || 0,
        purchases: r[at.purchases] || 0,
        purchaseValue: r[at.purchaseValue] || 0,
        conversations: r[at.conversations] || 0,
        group: group.key,
        groupLabel: group.label,
        groupColor: group.color,
      };
    });
    const days = rows.filter(hasActivity).map(r => r.d);
    // El export llega hasta coverage.end aunque el último día no tenga gasto.
    const end = m.meta.coverage?.end?.startsWith(m.id) ? +m.meta.coverage.end.slice(8) : null;
    const firstDay = days.length ? Math.min(...days) : null;
    const lastDay = end || (days.length ? Math.max(...days) : null);
    return {
      key: m.id, label: m.label, name: MONTHS[month - 1], shortName: SHORT[month - 1], year, month, daysInMonth,
      rows, firstDay, lastDay, hasData: days.length > 0, complete: lastDay === daysInMonth, raw: m,
    };
  }

  function buildMetaMonths() {
    meta.months = (state.data?.months || []).filter(m => m.meta?.table).map(normalizeMetaMonth);
    const withData = meta.months.filter(m => m.hasData);
    meta.latestKey = withData.length ? withData[withData.length - 1].key : null;
    // Un mes anterior al último con datos ya terminó aunque su export no llegue al último día.
    meta.months.forEach(m => { m.past = Boolean(meta.latestKey && m.key < meta.latestKey); });
  }

  const monthByKey = key => meta.months.find(m => m.key === key) || null;
  function previousMonth(m) {
    const date = new Date(m.year, m.month - 2, 1);
    return monthByKey(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
  }
  const rangeLabel = (m, from, to) => (from === to ? `${from} ${m.name}` : `${from}-${to} ${m.name}`);
  const rowsBetween = (m, from, to) => m.rows.filter(r => r.d >= from && r.d <= to);

  // ── Métricas (se recalculan sobre las sumas; nunca se promedian) ──
  function summarize(rows) {
    const t = Object.fromEntries(SUM_FIELDS.map(f => [f, 0]));
    rows.forEach(r => { SUM_FIELDS.forEach(f => { t[f] += r[f]; }); });
    return {
      ...t,
      // El alcance es la suma de las filas del export (día × edad × sexo × anuncio), como en los reportes.
      frequency: t.reach > 0 ? t.impressions / t.reach : null,
      cpm: t.impressions > 0 ? t.spend / t.impressions * 1000 : null,
      ctr: t.impressions > 0 ? t.clicks / t.impressions * 100 : null,
      costPerResult: t.results > 0 ? t.spend / t.results : null,
      costPerPurchase: t.purchases > 0 ? t.spend / t.purchases : null,
      roas: t.spend > 0 ? t.purchaseValue / t.spend : null,
    };
  }

  // El tipo de resultado de un grupo es el que más resultados junta (las filas sin resultado vienen vacías).
  function dominantType(rows) {
    const byType = new Map();
    rows.forEach(r => { if (r.resultType) byType.set(r.resultType, (byType.get(r.resultType) || 0) + r.results + 1e-9); });
    return [...byType.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  function groupRows(rows, keyOf) {
    const groups = new Map();
    rows.forEach(r => {
      const key = keyOf(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    return groups;
  }

  // Grupos, campañas y conjuntos se arman igual: totales, resultado dominante y % del gasto de las filas dadas,
  // solo los que tuvieron actividad y de mayor a menor gasto. describe aporta los campos propios de cada uno.
  function rank(rows, keyOf, describe) {
    const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
    return [...groupRows(rows, keyOf).entries()]
      .map(([key, items]) => {
        const totals = summarize(items);
        const resultType = dominantType(items);
        return { ...describe(key, items), resultType, resultLabel: resultLabel(resultType), share: totalSpend > 0 ? totals.spend / totalSpend * 100 : 0, ...totals };
      })
      .filter(hasActivity)
      .sort((a, b) => b.spend - a.spend);
  }

  const groupsOf = rows => rank(rows, r => r.group, (key, items) => ({
    key, label: items[0].groupLabel, color: items[0].groupColor,
    campaigns: [...new Set(items.filter(hasActivity).map(r => r.campaign))],
  }));
  const campaignsOf = rows => rank(rows, r => r.campaign, (name, items) => ({
    name, group: items[0].group, groupLabel: items[0].groupLabel, groupColor: items[0].groupColor,
  }));
  // Un conjunto es su nombre dentro de un grupo: así se compara con el mes anterior aunque la campaña cambie de nombre.
  const adSetsOf = rows => rank(rows, r => `${r.group}|${normalize(r.adset)}`, (key, items) => {
    const active = items.filter(hasActivity);
    return {
      key, name: items[0].adset,
      campaigns: [...new Set(active.map(r => r.campaign))],
      adCount: new Set(active.map(r => normalize(r.ad))).size,
    };
  });
  // Como en el ranking del reporte, un anuncio es su nombre dentro de un grupo: si la misma pieza corre en varios
  // conjuntos se suma, y así se puede comparar con el mes anterior.
  function adsOf(rows) {
    return [...groupRows(rows, r => `${r.group}|${normalize(r.ad)}`).entries()]
      .map(([key, items]) => {
        const active = items.filter(hasActivity);
        const days = active.map(r => r.d);
        const dates = active.map(r => r.day).sort();
        const resultType = dominantType(items);
        return {
          key, group: items[0].group, groupLabel: items[0].groupLabel, groupColor: items[0].groupColor,
          ad: items[0].ad, link: items.find(r => r.link)?.link || null,
          campaigns: [...new Set(active.map(r => r.campaign))],
          adSets: [...new Set(active.map(r => r.adset).filter(Boolean))],
          resultType, resultLabel: resultLabel(resultType),
          firstDay: days.length ? Math.min(...days) : null,
          lastDay: days.length ? Math.max(...days) : null,
          firstDate: dates[0] || null,
          lastDate: dates[dates.length - 1] || null,
          ...summarize(items),
        };
      })
      .filter(hasActivity);
  }

  const change = (current, previous) => (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0
    ? null : (current - previous) / previous * 100);

  // Tramo del mes y tramo equivalente del mes anterior, como en el reporte ("1-13 Octubre vs 1-13 Septiembre").
  // Un mes cerrado se compara completo contra el mes anterior completo.
  function periodOf(m) {
    if (!m?.hasData) return null;
    const closed = m.complete || m.past;
    const from = closed ? 1 : m.firstDay;
    const to = closed ? m.daysInMonth : m.lastDay;
    const prev = previousMonth(m);
    let compare = null;
    if (prev?.hasData) {
      const prevTo = closed ? prev.daysInMonth : Math.min(to, prev.daysInMonth);
      compare = { month: prev, rows: rowsBetween(prev, 1, prevTo), label: rangeLabel(prev, 1, prevTo) };
    }
    return {
      month: m, year: m.year, closed, compare,
      rows: rowsBetween(m, from, to),
      label: rangeLabel(m, m.firstDay > from ? m.firstDay : from, Math.min(to, m.lastDay || to)),
    };
  }

  // Vista anual: todos los meses del año con export, sin comparación (no hay exports del año anterior).
  function yearPeriod(year) {
    const months = meta.months.filter(m => m.hasData && m.year === year);
    if (!months.length) return null;
    const first = months[0];
    const last = months[months.length - 1];
    return {
      annual: true, month: null, months, year, compare: null,
      closed: last.month === 12 && last.complete,
      rows: months.flatMap(m => m.rows),
      label: `${first.firstDay} ${first.name} - ${last.lastDay} ${last.name}`,
    };
  }

  function selectedMetaMonth() {
    const m = monthByKey(state.month);
    return m?.hasData ? m : monthByKey(meta.latestKey);
  }
  const viewYear = () => selectedMetaMonth()?.year ?? new Date().getFullYear();
  const annualView = () => state.month === YEAR_KEY && Boolean(yearPeriod(viewYear()));
  const currentPeriod = () => (annualView() ? yearPeriod(viewYear()) : periodOf(selectedMetaMonth()));

  // "▲ 12.3% vs 1-20 Agosto". El color depende de si subir es bueno para ese indicador. Sin compareLabel queda
  // solo "▲ 12.3%" (KPIs de cada campaña, cuyo subtítulo ya dice contra qué periodo se compara).
  function deltaHtml(current, previous, better, compareLabel) {
    const d = change(current, previous);
    if (d == null) return compareLabel ? `<small class="gp-delta flat">Sin dato en ${esc(compareLabel)}</small>` : '';
    const direction = Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down';
    const tone = direction === 'flat' || !better ? 'flat' : direction === better ? 'good' : 'bad';
    const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '●';
    return `<small class="gp-delta ${tone}">${arrow} ${pct(Math.abs(d))}${compareLabel ? ` vs ${esc(compareLabel)}` : ''}</small>`;
  }

  // Celda de variación con el mes anterior: "Nuevo" si no corría, píldora verde o roja si no.
  function variationCell(current, previous) {
    if (previous == null) return '<span class="pill blue">Nuevo</span>';
    const d = change(current, previous);
    if (d == null) return '<span class="gp-no-data">—</span>';
    return `<span class="pill ${d >= 0 ? 'green' : 'red'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d), 0)}</span>`;
  }

  // ── Pestañas de mes y periodo ──
  // Enero a Diciembre del año y Anual (Meta y Google). has(key) dice si el mes tiene datos; what nombra el archivo.
  function renderMonthTabs(hostId, { year, has, latestKey, selected, annual, yearOk, what }) {
    const host = document.getElementById(hostId);
    keepFocus(host, () => {
      host.innerHTML = MONTHS.map((name, k) => {
        const key = `${year}-${pad(k + 1)}`;
        const ok = has(key);
        const on = !annual && key === selected;
        return `<button type="button" class="month-tab${on ? ' active' : ''}" data-month="${key}" aria-pressed="${on}"${ok ? '' : ` disabled title="Sin ${what} en la carpeta"`}>${name}${key === latestKey ? '<span class="gp-current-dot" title="Último mes con datos"></span>' : ''}</button>`;
      }).join('') + `<button type="button" class="month-tab${annual ? ' active' : ''}" data-month="${YEAR_KEY}" aria-pressed="${annual}" title="${yearOk ? `Acumulado ${year} de los meses con datos` : `Sin ${what} en la carpeta`}"${yearOk ? '' : ' disabled'}>Anual</button>`;
    });
  }

  function renderMetaTabs(period) {
    const year = viewYear();
    renderMonthTabs('gp-meta-months', {
      year, has: key => Boolean(monthByKey(key)?.hasData), latestKey: meta.latestKey,
      selected: period?.month?.key, annual: Boolean(period?.annual), yearOk: Boolean(yearPeriod(year)), what: 'export de Meta',
    });
  }

  function renderPeriod(period) {
    const title = document.getElementById('gp-meta-period-title');
    const sub = document.getElementById('gp-meta-period-sub');
    if (period.annual) {
      const count = period.months.length;
      const closed = period.closed || period.year < new Date().getFullYear();
      title.textContent = `Periodo: ${period.label} ${period.year}${closed ? '' : ' (año en curso)'}`;
      sub.textContent = `Acumulado de ${count} ${count === 1 ? 'mes' : 'meses'} con export de Meta (${period.months.map(m => m.shortName).join(', ')}). Sin año anterior para comparar.`;
      return;
    }
    title.textContent = `Periodo: ${period.label} ${period.year}${period.closed ? '' : ' (mes en curso)'}`;
    sub.textContent = period.compare ? `Comparación vs ${period.compare.label}` : 'Sin mes anterior para comparar';
  }

  // Promedio por mes de la vista anual. Mientras haya meses cerrados el mes en curso queda fuera: un mes a medias
  // bajaría el promedio.
  function monthlyAverage(period) {
    const closed = period.months.filter(m => m.complete || m.past);
    const months = closed.length ? closed : period.months;
    const totals = months.map(m => summarize(m.rows));
    const average = Object.fromEntries(KPIS.map(k => [k.key, totals.reduce((s, t) => s + (t[k.key] || 0), 0) / months.length]));
    average.basis = `Promedio de ${months.map(m => m.name).join(', ')}`;
    return average;
  }

  function renderKpis(period) {
    const current = summarize(period.rows);
    const previous = period.compare ? summarize(period.compare.rows) : null;
    const average = period.annual ? monthlyAverage(period) : null;
    document.getElementById('gp-meta-kpis').innerHTML = KPIS.map(k => {
      let line = `<small>${k.hint}</small>`;
      if (previous) line = deltaHtml(current[k.key], previous[k.key], k.better, period.compare.label);
      else if (average && k.perMonth) line = `<small title="${esc(average.basis)}">Prom. mensual: ${fmt(k.format, average[k.key])}</small>`;
      const note = k.note ? k.note(current, period.rows) : '';
      return `
        <div class="kpi-pill">
          <span>${k.label}</span>
          <strong>${fmt(k.format, current[k.key])}</strong>
          ${line}${note ? `<small>${note}</small>` : ''}
        </div>`;
    }).join('');
  }

  // ── Distribución por campaña ──
  function renderDistribution(period) {
    const rows = campaignsOf(period.rows);
    const total = summarize(period.rows);
    document.getElementById('gp-meta-dist-sub').textContent = `${period.label} | ${rows.length} ${rows.length === 1 ? 'campaña' : 'campañas'} con gasto o impresiones.`;
    document.getElementById('gp-meta-dist-body').innerHTML = rows.map(r => `
      <tr style="--gp-row-c:${r.groupColor}">
        <td class="gp-camp-name">${esc(r.name)}</td>
        <td><span class="gp-group"><i class="gp-dot-c"></i>${esc(r.groupLabel)}</span></td>
        <td><span class="gp-result-pill">${esc(r.resultLabel)}</span></td>
        <td class="r mono">${num(r.results)}</td>
        <td class="r mono">${unitCost(r.costPerResult)}</td>
        <td class="r mono">${money(r.spend, 2)}</td>
        <td class="gp-share-col"><span class="gp-share"><span style="width:${Math.min(100, r.share).toFixed(1)}%"></span></span><b>${pct(r.share)}</b></td>
        <td class="r mono">${num(r.impressions)}</td>
        <td class="r mono">${num(r.reach)}</td>
        <td class="r mono">${decimal(r.frequency)}</td>
        <td class="r mono">${money(r.cpm, 2)}</td>
        <td class="r mono">${num(r.clicks)}</td>
        <td class="r mono">${pct(r.ctr, 2)}</td>
        <td class="r mono">${r.purchases ? num(r.purchases) : '—'}</td>
        <td class="r">${roasPill(r.roas, r.purchases)}</td>
      </tr>`).join('') + `
      <tr class="gp-total-row">
        <td class="gp-camp-name">Total del periodo</td>
        <td></td>
        <td><span class="gp-no-data">Los resultados no se suman entre grupos</span></td>
        <td></td><td></td>
        <td class="r mono">${money(total.spend, 2)}</td>
        <td class="gp-share-col"><b>100%</b></td>
        <td class="r mono">${num(total.impressions)}</td>
        <td class="r mono">${num(total.reach)}</td>
        <td class="r mono">${decimal(total.frequency)}</td>
        <td class="r mono">${money(total.cpm, 2)}</td>
        <td class="r mono">${num(total.clicks)}</td>
        <td class="r mono">${pct(total.ctr, 2)}</td>
        <td class="r mono">${total.purchases ? num(total.purchases) : '—'}</td>
        <td class="r">${roasPill(total.roas, total.purchases)}</td>
      </tr>`;
  }

  // ── Cuadro de cada campaña ──
  // Cada grupo tiene su cuadro: KPIs contra el mes anterior, su gráfico y sus conjuntos de anuncios. Indicadores,
  // vista y minimizado se recuerdan por grupo.
  function campaignSettings(key) {
    const saved = meta.campaignCharts[key] || {};
    const metrics = CAMPAIGN_METRICS.map(m => m.key).filter(k => Array.isArray(saved.metrics) && saved.metrics.includes(k));
    return {
      metrics: metrics.length ? metrics : DEFAULT_CAMPAIGN_METRICS,
      mode: MODES.some(m => m.key === saved.mode) ? saved.mode : 'cumulative',
      collapsed: saved.collapsed === true,
    };
  }
  function saveCampaignSettings(key, changes) {
    meta.campaignCharts[key] = { ...campaignSettings(key), ...changes };
    saveSetting(CAMP_CHARTS_KEY, JSON.stringify(meta.campaignCharts));
  }
  const campaignBlock = key => [...document.querySelectorAll('#gp-meta-blocks .gp-camp-block')].find(n => n.dataset.group === key) || null;

  // Meses del año en que corrió un grupo (vista anual, en lugar de la comparación con el mes anterior).
  function groupMonths(period, key) {
    const months = period.months.filter(m => m.rows.some(r => r.group === key && hasActivity(r)));
    if (months.length === period.months.length) return `Activo en los ${months.length} ${months.length === 1 ? 'mes' : 'meses'}`;
    return `Activo en ${months.map(m => m.shortName).join(', ') || 'ningún mes'}`;
  }

  // Conjuntos de anuncios del grupo en el periodo, con sus resultados contra el mes anterior.
  function adSetsHtml(period, group) {
    const ofGroup = rows => rows.filter(r => r.group === group.key);
    const sets = adSetsOf(ofGroup(period.rows));
    const previous = new Map((period.compare ? adSetsOf(ofGroup(period.compare.rows)) : []).map(s => [s.key, s]));
    const compare = Boolean(period.compare);
    // Con una sola campaña su nombre ya está en el subtítulo del cuadro.
    const manyCampaigns = group.campaigns.length > 1;
    const commerce = group.purchases > 0;
    // [título, numérica]
    const head = [['Conjunto']].concat(manyCampaigns ? [['Campaña']] : [], [['Resultados', true]])
      .concat(compare ? [[`Resultados ${period.compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por resultado', true], ['Inversión', true], ['% de la campaña'], ['Impresiones', true], ['Alcance', true], ['CPM', true], ['Clics', true]])
      .concat(commerce ? [['Compras', true], ['ROAS', true]] : []);
    const body = sets.map(s => {
      const before = previous.get(s.key);
      return `
        <tr>
          <td class="gp-camp-name">${esc(s.name || '(sin conjunto)')}<small>${s.adCount} ${s.adCount === 1 ? 'anuncio' : 'anuncios'}</small></td>
          ${manyCampaigns ? `<td class="gp-set-col">${esc(s.campaigns.join(' / '))}</td>` : ''}
          <td class="r mono"><b>${num(s.results)}</b></td>
          ${compare ? `<td class="r mono">${before ? num(before.results) : '<span class="gp-no-data">—</span>'}</td><td class="r">${variationCell(s.results, before?.results)}</td>` : ''}
          <td class="r mono">${unitCost(s.costPerResult)}</td>
          <td class="r mono">${money(s.spend, 2)}</td>
          <td class="gp-share-col"><span class="gp-share"><span style="width:${Math.min(100, s.share).toFixed(1)}%"></span></span><b>${pct(s.share)}</b></td>
          <td class="r mono">${num(s.impressions)}</td>
          <td class="r mono">${num(s.reach)}</td>
          <td class="r mono">${money(s.cpm, 2)}</td>
          <td class="r mono">${num(s.clicks)}</td>
          ${commerce ? `<td class="r mono">${s.purchases ? num(s.purchases) : '—'}</td><td class="r">${roasPill(s.roas, s.purchases)}</td>` : ''}
        </tr>`;
    }).join('') || `<tr><td class="gp-table-empty" colspan="${head.length}">Sin conjuntos con gasto en el periodo.</td></tr>`;
    return `
      <div class="gp-adset-head">
        <div class="panel-title">Conjuntos de anuncios</div>
        <div class="panel-sub">${sets.length} ${sets.length === 1 ? 'conjunto' : 'conjuntos'} con gasto o impresiones en ${esc(period.label)}${compare ? `. Resultados contra ${esc(period.compare.label)}` : ''}.</div>
      </div>
      <div class="gp-table-wrap">
        <table class="rep-table gp-adset-table">
          <thead><tr>${head.map(([label, numeric]) => `<th${numeric ? ' class="r"' : ''}>${esc(label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  // Anuncios del grupo en el periodo, de más a menos resultados, con sus resultados contra el mes anterior.
  // La tabla completa, con filtro y pantalla completa, está en el módulo Anuncios.
  function campaignAdsHtml(period, group) {
    const ofGroup = rows => rows.filter(r => r.group === group.key);
    const ads = adsOf(ofGroup(period.rows)).sort((a, b) => b.results - a.results || b.spend - a.spend);
    const previous = new Map((period.compare ? adsOf(ofGroup(period.compare.rows)) : []).map(a => [a.key, a]));
    const compare = Boolean(period.compare);
    const commerce = group.purchases > 0;
    const manySets = new Set(ads.flatMap(a => a.adSets)).size > 1;
    const monthShort = period.month?.shortName.toLowerCase();
    // Con compras, Ventas y ROAS van junto al anuncio; el nombre enlaza a la vista previa en Meta.
    const head = [['Anuncio']].concat(commerce ? [['Ventas', true], ['ROAS', true]] : [], manySets ? [['Conjunto']] : [], [['Resultados', true]])
      .concat(compare ? [[`Resultados ${period.compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por resultado', true], ['Inversión', true], ['% de la campaña'], ['Impresiones', true], ['Alcance', true], ['CPM', true], ['Clics', true], ['Días activos']]);
    const body = ads.map((a, k) => {
      const before = previous.get(a.key);
      let days = '—';
      if (period.annual && a.firstDate) days = a.firstDate === a.lastDate ? fechaCorta(a.firstDate) : `${fechaCorta(a.firstDate)} - ${fechaCorta(a.lastDate)}`;
      else if (!period.annual && a.firstDay) days = a.firstDay === a.lastDay ? `${a.firstDay} ${monthShort}` : `${a.firstDay}-${a.lastDay} ${monthShort}`;
      const share = group.spend ? a.spend / group.spend * 100 : 0;
      return `
        <tr>
          <td class="gp-camp-name gp-ad-cell" title="${esc(a.ad)}">${k === 0 && a.results > 0 ? '<b class="gp-leader" title="Líder de la campaña">★</b> ' : ''}${adNameLink(a.ad, a.link, 'Ver el anuncio en Meta')}</td>
          ${commerce ? `<td class="r mono gp-sales-col">${salesCell(a.purchaseValue, a.purchases, a.purchases === 1 ? 'compra' : 'compras')}</td><td class="r">${roasPill(a.roas, a.purchases)}</td>` : ''}
          ${manySets ? `<td class="gp-set-col">${esc(a.adSets.join(' / ') || '—')}</td>` : ''}
          <td class="r mono"><b>${num(a.results)}</b></td>
          ${compare ? `<td class="r mono">${before ? num(before.results) : '<span class="gp-no-data">—</span>'}</td><td class="r">${variationCell(a.results, before?.results)}</td>` : ''}
          <td class="r mono">${unitCost(a.costPerResult)}</td>
          <td class="r mono">${money(a.spend, 2)}</td>
          <td class="gp-share-col"><span class="gp-share"><span style="width:${Math.min(100, share).toFixed(1)}%"></span></span><b>${pct(share)}</b></td>
          <td class="r mono">${num(a.impressions)}</td>
          <td class="r mono">${num(a.reach)}</td>
          <td class="r mono">${money(a.cpm, 2)}</td>
          <td class="r mono">${num(a.clicks)}</td>
          <td class="gp-date-col">${days}</td>
        </tr>`;
    }).join('') || `<tr><td class="gp-table-empty" colspan="${head.length}">Sin anuncios con gasto en el periodo.</td></tr>`;
    return `
      <div class="gp-adset-head">
        <div class="panel-title">Anuncios</div>
        <div class="panel-sub">${ads.length} ${ads.length === 1 ? 'anuncio' : 'anuncios'} con gasto o impresiones en ${esc(period.label)}${compare ? `. Resultados contra ${esc(period.compare.label)}` : ''}. La estrella marca al líder.</div>
      </div>
      <div class="gp-table-wrap">
        <table class="rep-table gp-adset-table gp-camp-ads-table">
          <thead><tr>${head.map(([label, numeric]) => `<th${numeric ? ' class="r"' : ''}>${esc(label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function campaignHtml(period, group, before) {
    const key = esc(group.key);
    const settings = campaignSettings(group.key);
    let comparison = '';
    if (period.annual) comparison = `. ${groupMonths(period, group.key)}`;
    else if (period.compare) comparison = before ? ` vs ${period.compare.label}` : `. Nueva: no corría en ${period.compare.label}`;
    const kpis = CAMPAIGN_KPIS.filter(k => !k.commerce || group.purchaseValue > 0).map(k => `
      <div><dt>${esc(k.label || group.resultLabel)}</dt><dd>${fmt(k.format, group[k.key])}${before ? deltaHtml(group[k.key], before[k.key], k.better) : ''}</dd></div>`).join('');
    return `
      <section class="gp-camp-block${settings.collapsed ? ' is-collapsed' : ''}" data-group="${key}" style="--gp-row-c:${group.color}">
        <div class="gp-camp-head">
          <div>
            <div class="gp-camp-title"><i class="gp-dot-c"></i>Campaña ${esc(group.label)}<em>${pct(group.share)} de la inversión</em></div>
            <div class="panel-sub">${esc(group.campaigns.join(' / '))} | ${esc(period.label)}${esc(comparison)}</div>
          </div>
          <div class="gp-camp-controls">
            <div class="gp-chips" data-camp-modes role="radiogroup" aria-label="Vista del gráfico de ${esc(group.label)}"></div>
            <button type="button" class="gp-chart-toggle" data-camp-toggle aria-controls="gp-camp-body-${key}">${CHEVRON}</button>
          </div>
        </div>
        <dl class="gp-camp-kpis">${kpis}</dl>
        <div class="gp-camp-body" id="gp-camp-body-${key}">
          <div class="gp-chips gp-camp-metrics" data-camp-metrics role="group" aria-label="Indicadores del gráfico de ${esc(group.label)}"></div>
          <div class="chart-wrap h-300"><canvas id="chart-gp-camp-${key}" role="img" aria-label="Gráfico de la campaña ${esc(group.label)}"></canvas></div>
          <div class="gp-legend" data-camp-legend></div>
          ${adSetsHtml(period, group)}
          ${campaignAdsHtml(period, group)}
        </div>
      </section>`;
  }

  // Chips de un gráfico: radio para la vista, casillas para los indicadores (selected es entonces una lista).
  function chipsHtml(items, selected, name, color, multiple = false) {
    return items.map(item => {
      const on = multiple ? selected.includes(item.key) : item.key === selected;
      return `<label class="gp-chip${on ? ' active' : ''}" style="--gp-chip-c:${color || item.color}">
        <input type="${multiple ? 'checkbox' : 'radio'}" name="${esc(name)}" value="${esc(item.key)}"${on ? ' checked' : ''}>${esc(item.label)}
      </label>`;
    }).join('');
  }

  // ── Gráficos de cada campaña ──
  // Un mes sin gasto ni impresiones del grupo queda como hueco, igual que un mes sin export.
  function monthlyValue(m, metric) {
    if (!m?.hasData) return null;
    const rows = m.rows.filter(r => r.group === metric.group);
    if (!rows.some(hasActivity)) return null;
    return rows.reduce((s, r) => s + r[metric.field], 0);
  }

  // Valores por día (índice 0 = día 1). Los días posteriores al último dato quedan en null.
  function dailyValues(m, field, group) {
    const values = Array.from({ length: m.daysInMonth }, (_, i) => (m.lastDay && i + 1 <= m.lastDay ? 0 : null));
    m.rows.forEach(r => { if (r.group === group && values[r.d - 1] != null) values[r.d - 1] += r[field]; });
    return values;
  }
  function cumulative(values) {
    let total = 0;
    return values.map(v => (v == null ? null : (total += v)));
  }

  // Total de cada mes del año, o día a día del mes (acumulado o no) frente al mes anterior en el mismo día.
  // compare = false deja solo el mes elegido (varios indicadores a la vez).
  function lineSeries(metric, modeKey, m, compare = true) {
    if (modeKey === 'monthly') {
      const year = viewYear();
      return {
        labels: SHORT,
        datasets: [{ label: metric.label, unit: metric.unit, data: MONTHS.map((_, k) => monthlyValue(monthByKey(`${year}-${pad(k + 1)}`), metric)), borderColor: metric.color, backgroundColor: `${metric.color}1a`, fill: true, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: metric.color, tension: 0.25, spanGaps: false, valueLabels: true }],
        legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(metric.label)} por mes</b></span>`],
      };
    }
    const isCumulative = modeKey === 'cumulative';
    const transform = values => (isCumulative ? cumulative(values) : values);
    const series = {
      labels: Array.from({ length: m.daysInMonth }, (_, i) => `${i + 1}`),
      datasets: [{ label: compare ? m.name : metric.label, unit: metric.unit, data: transform(dailyValues(m, metric.field, metric.group)), borderColor: metric.color, backgroundColor: `${metric.color}14`, fill: isCumulative, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 }],
      legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(m.name)} ${m.year}</b></span>`],
    };
    const prev = previousMonth(m);
    if (compare && prev?.hasData) {
      const prevValues = transform(dailyValues(prev, metric.field, metric.group)).slice(0, m.daysInMonth);
      if (prevValues.some(v => v)) {
        series.datasets.push({ label: prev.name, unit: metric.unit, data: prevValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 });
        series.legend.push(`<span><i class="gp-legend-line dashed" style="color:${PREVIOUS_COLOR}"></i><b>${esc(prev.name)} (mismo día del mes)</b></span>`);
      }
    }
    return series;
  }

  // Un indicador: su línea contra el mes anterior. Varios: una línea por indicador, sin comparación, cada una en su
  // propio panel (eje y) para ver cómo se mueve el resultado frente a la inversión sin mezclar escalas.
  function campaignSeries(metrics, modeKey, m) {
    if (metrics.length === 1) return lineSeries(metrics[0], modeKey, m);
    const parts = metrics.map(metric => lineSeries(metric, modeKey, m, false));
    const what = modeKey === 'monthly' ? `${metrics.length} indicadores por mes` : `${esc(m.name)} ${m.year}`;
    const prev = modeKey === 'monthly' ? null : previousMonth(m);
    return {
      labels: parts[0].labels,
      datasets: parts.map((part, i) => ({ ...part.datasets[0], label: metrics[i].label, yAxisID: `y${i}` })),
      legend: [
        `<span><i class="gp-legend-line" style="background:${metrics[0].color}"></i><b>${what}</b></span>`,
        `<span>Cada indicador con su escala.${prev?.hasData ? ` Elige uno solo para compararlo con ${esc(prev.name)}.` : ''}</span>`,
      ],
    };
  }

  const formatValue = (unit, v) => (unit === 'money' ? money(v, 2) : num(v));
  const tickValue = (unit, v) => (unit === 'money'
    ? (v === 0 ? 'S/. 0' : `S/. ${Number(v).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`)
    : Number(v).toLocaleString('es-PE', { notation: Math.abs(v) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));

  // Con un indicador hay un solo eje y; con varios, un eje por indicador apilado en vertical (paneles con su
  // escala) sobre el mismo eje de días. Nunca dos escalas superpuestas: los cruces entre líneas no significarían nada.
  function yScales(metrics) {
    const base = unit => ({ beginAtZero: true, border: { display: false }, ticks: { color: axisColor, font: { size: 10 }, callback: v => tickValue(unit, v) } });
    if (metrics.length === 1) return { y: { ...base(metrics[0].unit), grid: { color: gridColor } } };
    // Chart.js apila de abajo hacia arriba en el orden de los ejes: se dan al revés para que el resultado quede arriba.
    return Object.fromEntries(metrics.map((metric, i) => [`y${i}`, {
      ...base(metric.unit),
      stack: 'metrics',
      stackWeight: 1,
      grace: '25%',
      // El tope de cada panel cae sobre el cero del panel de arriba: se omite para que no se encimen.
      ticks: { ...base(metric.unit).ticks, maxTicksLimit: 5, callback: (v, tickIndex, ticks) => (i > 0 && tickIndex === ticks.length - 1 ? '' : tickValue(metric.unit, v)) },
      // La línea del cero marca el piso de cada panel.
      grid: { color: ctx => (ctx.tick?.value === 0 ? '#cbd5e1' : gridColor) },
      panelLabel: metric.label,
    }]).reverse());
  }

  const CHART_PLUGINS = [{
    id: 'gpValueLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      chart.data.datasets.forEach((dataset, i) => {
        if (!dataset.valueLabels) return;
        ctx.fillStyle = dataset.borderColor;
        chart.getDatasetMeta(i).data.forEach((point, k) => {
          const v = dataset.data[k];
          if (v == null) return;
          const text = dataset.unit === 'money' ? tickValue('money', Math.round(v)) : Number(v).toLocaleString('es-PE', { notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
          ctx.fillText(text, point.x, point.y - 12);
        });
      });
      ctx.restore();
    },
  }, {
    // Nombre de cada panel arriba a la izquierda (solo con varios indicadores).
    id: 'gpPanelLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textBaseline = 'top';
      Object.values(chart.scales).forEach(scale => {
        const label = scale.options.panelLabel;
        if (!label) return;
        const x = chart.chartArea.left + 8;
        const y = scale.top + 4;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillRect(x - 4, y - 2, ctx.measureText(label).width + 8, 16);
        ctx.fillStyle = '#475569';
        ctx.fillText(label, x, y);
      });
      ctx.restore();
    },
  }, {
    // Línea vertical en el día del tooltip, a lo alto de todos los paneles.
    id: 'gpCrosshair',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements() || [];
      if (!active.length) return;
      const x = active[0].element.x;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  }];

  // registry: los gráficos vivos de la pestaña, para destruirlos al repintar.
  function drawLineChart(id, series, metrics, modeKey, registry = meta.charts) {
    registry.add(id);
    global.Charts.mount(id, {
      type: 'line',
      data: { labels: series.labels, datasets: series.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24, right: 12, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.raw != null,
            callbacks: {
              title: items => (modeKey === 'monthly' ? MONTHS[items[0].dataIndex] : `Día ${items[0].label}`),
              label: c => ` ${c.dataset.label}: ${formatValue(c.dataset.unit, c.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: axisColor, font: { size: 10 }, autoSkip: true, maxTicksLimit: modeKey === 'monthly' ? 12 : 16 } },
          ...yScales(metrics),
        },
      },
      plugins: CHART_PLUGINS,
    });
  }

  function destroyCampaignCharts() {
    meta.charts.forEach(id => global.Charts.destroy(id));
    meta.charts.clear();
  }

  // La vista anual solo tiene sentido por mes; el modo elegido se conserva para cuando se vuelva a un mes.
  function chartModes(savedMode, annual) {
    if (annual) return { modes: MODES.filter(m => m.key === 'monthly'), modeKey: 'monthly' };
    return { modes: MODES, modeKey: MODES.some(m => m.key === savedMode) ? savedMode : 'cumulative' };
  }

  // Los controles del cuadro lo redibujan solo con la clave; renderCampaigns le pasa el periodo y sus grupos.
  function renderCampaignChart(key, period = currentPeriod(), groups = period ? groupsOf(period.rows) : []) {
    const block = campaignBlock(key);
    const group = groups.find(g => g.key === key);
    const m = selectedMetaMonth();
    if (!block || !group || !m) return;
    const settings = campaignSettings(key);
    const { modes, modeKey } = chartModes(settings.mode, period.annual);
    const metrics = CAMPAIGN_METRICS.map(item => ({ ...item, label: item.key === 'results' ? group.resultLabel : item.label, color: group.color, group: key }));
    const selected = metrics.filter(item => settings.metrics.includes(item.key));
    const toggle = block.querySelector('[data-camp-toggle]');
    block.classList.toggle('is-collapsed', settings.collapsed);
    toggle.setAttribute('aria-expanded', String(!settings.collapsed));
    toggle.title = `${settings.collapsed ? 'Expandir' : 'Minimizar'} la campaña ${group.label}`;
    keepFocus(block.querySelector('[data-camp-modes]'), () => { block.querySelector('[data-camp-modes]').innerHTML = chipsHtml(modes, modeKey, `gp-camp-mode-${key}`, 'var(--brand)'); });
    keepFocus(block.querySelector('[data-camp-metrics]'), () => { block.querySelector('[data-camp-metrics]').innerHTML = chipsHtml(metrics, settings.metrics, `gp-camp-metric-${key}`, null, true); });
    const id = `chart-gp-camp-${key}`;
    if (settings.collapsed) {
      global.Charts.destroy(id);
      meta.charts.delete(id);
      return;
    }
    const series = campaignSeries(selected, modeKey, m);
    // Cada panel extra suma alto para que ninguno quede aplastado.
    block.querySelector('canvas').parentElement.style.height = selected.length > 1 ? `${90 + 135 * selected.length}px` : '';
    block.querySelector('[data-camp-legend]').innerHTML = series.legend.join('');
    drawLineChart(id, series, selected, modeKey);
  }

  function renderCampaigns(period, groups) {
    const host = document.getElementById('gp-meta-blocks');
    destroyCampaignCharts();
    const previous = period.compare ? groupsOf(period.compare.rows) : [];
    host.innerHTML = groups.map(g => campaignHtml(period, g, previous.find(p => p.key === g.key))).join('');
    groups.forEach(g => renderCampaignChart(g.key, period, groups));
  }

  // ── Anuncios del periodo ──
  function renderAdsFilter(groups) {
    const select = document.getElementById('gp-ads-group');
    if (meta.adsGroup !== 'all' && !groups.some(g => g.key === meta.adsGroup)) meta.adsGroup = 'all';
    select.innerHTML = ['<option value="all">Todos los grupos</option>']
      .concat(groups.map(g => `<option value="${esc(g.key)}"${g.key === meta.adsGroup ? ' selected' : ''}>${esc(g.label)}</option>`))
      .join('');
  }

  function renderAds(period, groups = groupsOf(period.rows)) {
    const body = document.getElementById('gp-ads-body');
    // Sin periodo de comparación (vista anual o primer mes) las columnas de mes anterior y variación se ocultan.
    document.getElementById('gp-ads-panel').classList.toggle('no-compare', !period.compare);
    renderAdsFilter(groups);
    const order = new Map(groups.map((g, i) => [g.key, i]));
    // Un anuncio sin resultados muestra el resultado que mide su grupo.
    const groupResult = new Map(groups.map(g => [g.key, g.resultLabel]));
    const previous = new Map((period.compare ? adsOf(period.compare.rows) : []).map(a => [a.key, a]));
    const all = adsOf(period.rows).sort((a, b) => (order.get(a.group) - order.get(b.group)) || (b.results - a.results) || (b.spend - a.spend));
    const leaders = new Set();
    all.forEach(a => { if (a.results > 0 && !leaders.has(a.group)) { leaders.add(a.group); a.leader = true; } });
    const rows = meta.adsGroup === 'all' ? all : all.filter(a => a.group === meta.adsGroup);

    document.getElementById('gp-ads-title').textContent = `Anuncios | ${period.label} ${period.year}`;
    document.getElementById('gp-ads-sub').textContent = `${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} ordenados por resultados dentro de cada grupo. La estrella marca al líder de cada grupo.`;
    document.getElementById('gp-ads-prev-head').textContent = period.compare ? `Resultados ${period.compare.label}` : 'Mes anterior';
    if (!rows.length) {
      body.innerHTML = '<tr><td class="gp-table-empty" colspan="16">No hay anuncios de este grupo en el periodo.</td></tr>';
      return;
    }
    const monthShort = period.month?.shortName.toLowerCase();
    const dateShort = iso => fechaCorta(iso);
    // Ventas y ROAS van junto al anuncio; el nombre enlaza a la vista previa en Meta.
    body.innerHTML = rows.map(a => {
      const before = previous.get(a.key);
      let days = '—';
      if (period.annual && a.firstDate) days = a.firstDate === a.lastDate ? dateShort(a.firstDate) : `${dateShort(a.firstDate)} - ${dateShort(a.lastDate)}`;
      else if (!period.annual && a.firstDay) days = a.firstDay === a.lastDay ? `${a.firstDay} ${monthShort}` : `${a.firstDay}-${a.lastDay} ${monthShort}`;
      return `
        <tr style="--gp-row-c:${a.groupColor}">
          <td class="gp-type-col"><span class="gp-group"><i class="gp-dot-c"></i>${esc(a.groupLabel)}</span></td>
          <td class="gp-ad-col" title="${esc(a.ad)}"><span class="gp-ad-text">${a.leader ? '<b class="gp-leader" title="Líder del grupo">★</b> ' : ''}${adNameLink(a.ad, a.link, 'Ver el anuncio en Meta')}</span></td>
          <td class="r mono gp-sales-col">${salesCell(a.purchaseValue, a.purchases, a.purchases === 1 ? 'compra' : 'compras')}</td>
          <td class="r">${roasPill(a.roas, a.purchases)}</td>
          <td class="gp-set-col">${esc(a.campaigns.join(' / '))}<small>${esc(a.adSets.join(' / ') || '—')}</small></td>
          <td><span class="gp-result-pill">${esc(a.resultType ? a.resultLabel : groupResult.get(a.group) || a.resultLabel)}</span></td>
          <td class="r mono"><b>${num(a.results)}</b></td>
          <td class="r mono">${before ? num(before.results) : '<span class="gp-no-data">—</span>'}</td>
          <td class="r">${period.compare ? variationCell(a.results, before?.results) : '<span class="gp-no-data">—</span>'}</td>
          <td class="r mono">${unitCost(a.costPerResult)}</td>
          <td class="r mono">${money(a.spend, 2)}</td>
          <td class="r mono">${num(a.impressions)}</td>
          <td class="r mono">${num(a.reach)}</td>
          <td class="r mono">${money(a.cpm, 2)}</td>
          <td class="r mono">${num(a.clicks)}</td>
          <td class="gp-date-col">${days}</td>
        </tr>`;
    }).join('');
  }

  // ── Herramientas de las tablas de anuncios del módulo Anuncios (Meta y Google) ──
  const AD_TABLES = {
    meta:   { panel: 'gp-ads-panel', density: 'gp-ads-density', expand: 'gp-ads-expand', tabs: 'ad-meta-months', key: ADS_COMPACT_KEY },
    google: { panel: 'gp-g-ads-panel', density: 'gp-g-ads-density', expand: 'gp-g-ads-expand', tabs: 'ad-google-months', key: 'rb-gp-gads-compact-v1' },
  };
  const adTables = Object.fromEntries(Object.entries(AD_TABLES).map(([p, cfg]) => [p, {
    compact: readSetting(cfg.key, 'false') === 'true', fullscreen: false, tabsHome: null,
  }]));

  function applyCompact(p) {
    const cfg = AD_TABLES[p];
    const t = adTables[p];
    const panel = document.getElementById(cfg.panel);
    const button = document.getElementById(cfg.density);
    if (!panel || !button) return;
    panel.classList.toggle('is-compact', t.compact);
    button.setAttribute('aria-pressed', String(t.compact));
    button.textContent = t.compact ? 'Cómodo' : 'Compacto';
    button.title = t.compact ? 'Volver a filas amplias' : 'Reducir el alto de las filas';
  }
  function toggleCompact(p) {
    adTables[p].compact = !adTables[p].compact;
    saveSetting(AD_TABLES[p].key, adTables[p].compact);
    applyCompact(p);
  }

  function toggleFullscreen(p, force) {
    const cfg = AD_TABLES[p];
    const t = adTables[p];
    const panel = document.getElementById(cfg.panel);
    const button = document.getElementById(cfg.expand);
    if (!panel || !button) return;
    t.fullscreen = force == null ? !t.fullscreen : Boolean(force);
    const tabs = document.getElementById(cfg.tabs);
    const scroll = panel.querySelector('.gp-ads-scroll');
    panel.classList.toggle('is-fullscreen', t.fullscreen);
    document.body.classList.toggle('gp-table-fullscreen', t.fullscreen);
    // Las pestañas de mes viajan al panel para poder cambiar de mes sin salir.
    if (t.fullscreen) {
      t.tabsHome = { parent: tabs.parentNode, next: tabs.nextSibling };
      panel.insertBefore(tabs, scroll);
    } else if (t.tabsHome) {
      t.tabsHome.parent.insertBefore(tabs, t.tabsHome.next);
      t.tabsHome = null;
    }
    button.setAttribute('aria-pressed', String(t.fullscreen));
    button.textContent = t.fullscreen ? '✕ Salir' : '⤢ Pantalla completa';
    button.title = t.fullscreen ? 'Salir de pantalla completa (Esc)' : 'Ver la tabla en pantalla completa (Esc para salir)';
    if (t.fullscreen) scroll.focus();
  }
  const closeFullscreens = () => Object.keys(AD_TABLES).forEach(p => { if (adTables[p].fullscreen) toggleFullscreen(p, false); });

  // ── Embudo y público (del archivo de cada mes: un total por mes) ──
  // Suma de los totales de los meses del periodo; un paso en null en todos los meses = el export no trae la columna.
  function funnelTotals(months) {
    const fields = ['impressions', 'linkClicks', 'landingViews', 'addToCart', 'checkouts', 'purchases', 'conversations', 'spend'];
    return Object.fromEntries(fields.map(f => {
      const values = months.map(m => m.meta.totals[f]).filter(v => v != null);
      return [f, values.length ? values.reduce((s, v) => s + v, 0) : null];
    }));
  }

  function audienceOf(months) {
    const merge = (field) => {
      const byKey = new Map();
      months.forEach(m => (m.meta.audience?.[field] || []).forEach(item => {
        const prev = byKey.get(item[field]) || { [field]: item[field], spend: 0, purchases: 0, conversations: 0 };
        prev.spend += item.spend || 0; prev.purchases += item.purchases || 0; prev.conversations += item.conversations || 0;
        byKey.set(item[field], prev);
      }));
      return [...byKey.values()];
    };
    return { age: merge('age'), gender: merge('gender') };
  }

  // Embudo: cada barra = conversión respecto al paso anterior registrado.
  function renderFunnel(t) {
    const steps = [
      ['Impresiones', t.impressions], ['Clics en el enlace', t.linkClicks], ['Visitas a la web', t.landingViews],
      ['Agregados al carrito', t.addToCart], ['Pagos iniciados', t.checkouts], ['Compras', t.purchases],
    ].filter(([, value]) => value != null);  // null = el export no trae esa columna
    let base = null;
    const untracked = [];
    let overflow = false;
    const rows = steps.map(([name, value], k) => {
      // En 0 con pasos posteriores > 0: Meta no recibió ese evento. No corta el embudo.
      if (value === 0 && steps.slice(k + 1).some(([, v]) => v > 0)) {
        untracked.push(name);
        return `<div class="gp-funnel-row is-off">
          <div class="gp-funnel-name">${name}</div>
          <div class="gp-funnel-bar"><div style="width:0"></div></div>
          <div class="gp-funnel-val mono">—</div>
          <div class="gp-funnel-rate">sin registro</div>
        </div>`;
      }
      const rate = base == null ? null : ratio(value, base);
      if (rate > 1) overflow = true;
      base = value;
      return `<div class="gp-funnel-row">
        <div class="gp-funnel-name">${name}</div>
        <div class="gp-funnel-bar"><div style="width:${rate == null ? 100 : Math.max(Math.min(rate * 100, 100), 1.5)}%"></div></div>
        <div class="gp-funnel-val mono">${num(value)}</div>
        <div class="gp-funnel-rate">${rate == null ? '' : pct(rate * 100)}</div>
      </div>`;
    });
    const notes = [];
    if (untracked.length) {
      notes.push(`Meta no registró ${untracked.map(n => `«${n}»`).join(' ni ')} en el periodo aunque sí hay pasos posteriores: el evento no está llegando desde la web. El paso siguiente se mide contra el anterior registrado.`);
    }
    if (overflow) notes.push('Un paso que supera al anterior indica que Meta no registra completo el evento anterior.');
    if (t.conversations) notes.push(`Aparte, <b>${num(t.conversations)} conversaciones</b> iniciadas por mensajes (WhatsApp): no pasan por la web.`);
    document.getElementById('gp-meta-funnel').innerHTML = rows.join('') + notes.map(n => `<p class="gp-note">${n}</p>`).join('');
  }

  // Público: barras por edad (compras, o inversión si no hubo compras) y reparto por sexo.
  function renderAudience(audience, spend) {
    const host = document.getElementById('gp-meta-audience');
    const ages = (audience.age || []).filter(a => a.spend > 0 || a.purchases > 0 || a.conversations > 0);
    const genders = (audience.gender || []).filter(g => g.spend > 0);
    if (!ages.length && !genders.length) {
      host.innerHTML = '<p class="gp-note">El export no trae el desglose por edad y sexo.</p>';
      return;
    }
    const byPurchases = ages.some(a => a.purchases > 0);
    const field = byPurchases ? 'purchases' : 'spend';
    const max = Math.max(...ages.map(a => a[field])) || 1;
    host.innerHTML = `
      ${ages.length ? `<div class="rep-subttl" style="margin-top:0">${byPurchases ? 'Compras' : 'Inversión'} por edad</div>
      ${ages.map(a => `<div class="gp-aud-row">
        <div class="gp-aud-name">${esc(AGE_LABELS[a.age] || a.age)}</div>
        <div class="gp-aud-bar"><div style="width:${a[field] / max * 100}%"></div></div>
        <div class="gp-aud-val">${byPurchases ? `<span class="mono">${num(a.purchases)}</span> <span class="muted">· ${money(a.spend)}</span>` : `<span class="mono">${money(a.spend)}</span>`}</div>
      </div>`).join('')}` : ''}
      ${genders.length ? `<div class="rep-subttl">Inversión por sexo</div>
      <dl class="rep-metrics rep-metrics-wide">${genders.map(g => `<div>
        <dt>${esc(GENDER_LABELS[g.gender] || g.gender)}</dt>
        <dd>${pct((ratio(g.spend, spend) || 0) * 100, 0)} de la inversión · ${num(g.purchases)} compras · ${num(g.conversations)} conv.</dd>
      </div>`).join('')}</dl>` : ''}`;
  }

  function renderFunnelAudience(period) {
    const months = period.annual ? period.months.map(m => m.raw) : [period.month.raw];
    const t = funnelTotals(months);
    const what = period.annual ? `Acumulado ${period.year}` : esc(period.month.raw.meta.source?.name || period.month.label);
    document.getElementById('gp-meta-funnel-sub').innerHTML = `De la impresión a la compra · % respecto al paso anterior · ${what}`;
    document.getElementById('gp-meta-audience-sub').innerHTML = `Compras e inversión por edad y sexo · ${what}`;
    renderFunnel(t);
    renderAudience(audienceOf(months), t.spend);
  }

  // ── Render ──
  function renderMeta() {
    const body = document.getElementById('gp-meta-body');
    if (!meta.latestKey) { emptyState(body, 'meta'); return; }
    // Si antes se mostró el estado vacío, se restaura la estructura del panel
    if (!body.querySelector('#gp-meta-kpis')) body.innerHTML = metaBodyTpl;

    const period = currentPeriod();
    state.month = period.annual ? YEAR_KEY : period.month.key;
    // Los grupos del periodo se calculan una vez para la distribución y los cuadros (con sus anuncios).
    const groups = groupsOf(period.rows);
    renderMetaTabs(period);
    renderAlerts('gp-meta-alerts', 'meta', period.annual ? { label: String(period.year), warnings: [] } : period.month.raw);
    renderPeriod(period);
    renderKpis(period);
    renderDistribution(period);
    renderCampaigns(period, groups);
    renderFunnelAudience(period);
  }

  // Eventos por delegación en #gp-meta-body: sobreviven a que el estado vacío reemplace su contenido.
  function wireMeta() {
    const body = document.getElementById('gp-meta-body');
    body.addEventListener('click', e => {
      const tab = e.target.closest('#gp-meta-months .month-tab:not(:disabled)');
      if (tab) {
        if (tab.dataset.month === state.month) return;
        setMonth(tab.dataset.month);
        markRendered('meta');
        renderMeta();
        return;
      }
      const toggle = e.target.closest('[data-camp-toggle]');
      if (toggle) {
        const key = toggle.closest('.gp-camp-block').dataset.group;
        saveCampaignSettings(key, { collapsed: !campaignSettings(key).collapsed });
        renderCampaignChart(key);
      }
    });
    body.addEventListener('change', e => {
      const input = e.target.closest('.gp-camp-block input');
      if (!input) return;
      const block = input.closest('.gp-camp-block');
      const key = block.dataset.group;
      if (input.closest('[data-camp-modes]')) {
        saveCampaignSettings(key, { mode: input.value });
      } else {
        // Siempre queda al menos un indicador: desmarcar el último lo deja como estaba.
        const checked = [...block.querySelectorAll('[data-camp-metrics] input:checked')].map(i => i.value);
        if (checked.length) saveCampaignSettings(key, { metrics: checked });
      }
      renderCampaignChart(key);
    });
  }

  // Esc y el cambio de módulo o de pestaña cierran la pantalla completa de las dos tablas de anuncios
  // (con el panel fijo la página quedaría bloqueada).
  function wireFullscreenExit() {
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFullscreens(); });
    document.querySelectorAll('.s-item, .gp-tab').forEach(btn => btn.addEventListener('click', closeFullscreens));
  }

  // ════════════════════════════════════════════════════════════
  // GOOGLE ADS — misma estructura que Meta Ads
  // El informe de campaña llega con un total por mes: el periodo, los KPIs, la distribución y los cuadros salen
  // de él. Cuando la carpeta trae además el informe por día y palabra clave del mes (google.detail), da la serie
  // diaria, los grupos de anuncios, los anuncios y los términos de búsqueda.
  // ════════════════════════════════════════════════════════════
  const G_CAMP_CHARTS_KEY = 'rb-gp-gcamp-charts-v1';
  // Cada campaña se agrupa por su tipo (la "campaña" del reporte). Colores de la marca Google.
  const G_TYPES = [
    { key: 'busqueda', label: 'Búsqueda', match: /busqueda|buscar|search/, color: '#4285F4' },
    { key: 'pmax', label: 'Máximo rendimiento', match: /maximo rendimiento|rendimiento maximo|performance max|pmax/, color: '#F9AB00' },
    { key: 'shopping', label: 'Shopping', match: /shopping/, color: '#34A853' },
    { key: 'demanda', label: 'Generación de demanda', match: /generacion de demanda|demand gen|discovery/, color: '#EA4335' },
    { key: 'video', label: 'Video', match: /video|youtube/, color: '#9334E6' },
    { key: 'display', label: 'Display', match: /display/, color: '#12B5CB' },
  ];
  const G_SUMS = ['cost', 'impressions', 'clicks', 'conversions', 'purchases', 'conversionValue'];
  // Indicadores del gráfico de cada tipo. daily: el campo del informe por día (sin impresiones; ahí las compras
  // son las conversiones del informe).
  const G_METRICS = [
    { key: 'cost', label: 'Inversión', unit: 'money', daily: 'cost' },
    { key: 'clicks', label: 'Clics', unit: 'count', daily: 'clicks' },
    { key: 'purchases', label: 'Compras', dailyLabel: 'Conversiones', unit: 'count', daily: 'conversions' },
    { key: 'conversionValue', label: 'Valor de conversión', unit: 'money', daily: 'conversionValue' },
    { key: 'impressions', label: 'Impresiones', unit: 'count', daily: null },
  ];
  const G_DEFAULT_METRICS = ['cost', 'purchases'];
  const G_CAMPAIGN_KPIS = [
    { key: 'cost', label: 'Inversión', format: 'money2', better: null },
    { key: 'clicks', label: 'Clics', format: 'count', better: 'up' },
    { key: 'ctr', label: 'CTR', format: 'pct2', better: 'up' },
    { key: 'cpc', label: 'CPC', format: 'money2', better: 'down' },
    { key: 'purchases', label: 'Compras', format: 'num2', better: 'up' },
    { key: 'costPerPurchase', label: 'Costo por compra', format: 'money2', better: 'down' },
    { key: 'roas', label: 'ROAS', format: 'roas', better: 'up' },
  ];
  const G_KPIS = [
    { key: 'cost', label: 'Inversión', hint: 'Costo del periodo', better: null, format: 'money2', perMonth: true },
    { key: 'impressions', label: 'Impresiones', hint: 'Veces que se mostraron los anuncios', better: 'up', format: 'count', perMonth: true },
    { key: 'clicks', label: 'Clics', hint: 'Clics en los anuncios', better: 'up', format: 'count', perMonth: true },
    { key: 'ctr', label: 'CTR', hint: 'Clics / impresiones', better: 'up', format: 'pct2' },
    { key: 'cpc', label: 'CPC prom.', hint: 'Costo por clic', better: 'down', format: 'money2' },
    { key: 'purchases', label: 'Compras', hint: 'Conversiones por compras', better: 'up', format: 'num2', perMonth: true,
      note: t => `Costo por compra ${money(t.costPerPurchase, 2)}` },
    { key: 'conversionValue', label: 'Valor de conversión', hint: 'Atribución de Google', better: 'up', format: 'money', perMonth: true,
      note: t => `ROAS ${roasFmt(t.roas)} · atribución de Google` },
    { key: 'conversions', label: 'Conversiones', hint: 'Compras y contactos (clics a WhatsApp)', better: 'up', format: 'num2', perMonth: true },
  ];
  FORMATS.pct2 = n => pct(n, 2);
  FORMATS.num2 = numDec;

  const google = { months: [], latestKey: null, campaignCharts: readJson(G_CAMP_CHARTS_KEY), charts: new Set(), adsGroup: 'all' };
  let googleBodyTpl = '';  // HTML original de #gp-google-body (se guarda en init)
  const otherTypes = new Map();

  function typeGroup(type) {
    const text = normalize(type);
    const known = G_TYPES.find(t => t.match.test(text));
    if (known) return known;
    const label = String(type || '').trim() || 'Otro';
    const key = `otro-${normalize(label).replace(/[^a-z0-9]+/g, '-')}`;
    if (!otherTypes.has(key)) otherTypes.set(key, { key, label, color: OTHER_COLORS[otherTypes.size % OTHER_COLORS.length] });
    return otherTypes.get(key);
  }

  // CTR, CPC, costos y ROAS se recalculan sobre las sumas. Un campo en null (informe segmentado) deja sus cocientes en null.
  function gDerive(t) {
    const div = (a, b) => (a == null || b == null || !b ? null : a / b);
    return {
      ...t,
      ctr: div(t.clicks, t.impressions) == null ? null : t.clicks / t.impressions * 100,
      cpc: div(t.cost, t.clicks),
      costPerConversion: div(t.cost, t.conversions),
      costPerPurchase: div(t.cost, t.purchases),
      roas: div(t.conversionValue, t.cost),
    };
  }
  // Suma campo a campo; si algún sumando no informa el campo (null), la suma tampoco.
  function gSum(items) {
    const t = Object.fromEntries(G_SUMS.map(f => [f, 0]));
    items.forEach(item => G_SUMS.forEach(f => { t[f] = t[f] == null || item[f] == null ? null : t[f] + item[f]; }));
    return t;
  }
  const gScale = (t, factor) => Object.fromEntries(G_SUMS.map(f => [f, t[f] == null ? null : t[f] * factor]));
  const gActive = x => (x.cost || 0) > 0 || (x.impressions || 0) > 0 || (x.clicks || 0) > 0;

  function normalizeGoogleMonth(m) {
    const g = m.google;
    const [year, month] = m.id.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const cov = g.coverage?.start?.startsWith(m.id) ? g.coverage : null;
    const firstDay = cov ? +cov.start.slice(8) : 1;
    const lastDay = cov && cov.end.startsWith(m.id) ? +cov.end.slice(8) : daysInMonth;
    const typeOf = new Map();
    const campaigns = (g.campaigns || []).map(c => {
      const group = typeGroup(c.type);
      typeOf.set(c.campaign, group);
      return { name: c.campaign, status: c.status || '', type: c.type, group: group.key, groupLabel: group.label, groupColor: group.color, ...Object.fromEntries(G_SUMS.map(f => [f, c[f] ?? null])) };
    });
    const byType = (g.byType || []).map(x => ({ group: typeGroup(x.type), ...Object.fromEntries(G_SUMS.map(f => [f, x[f] ?? 0])) }));
    const totals = Object.fromEntries(G_SUMS.map(f => [f, g.totals?.[f] ?? null]));
    let detail = null;
    const t = g.detail?.table;
    if (t) {
      const at = Object.fromEntries(t.columns.map((name, i) => [name, i]));
      detail = t.rows.map(r => {
        const campaign = t.campaigns[r[at.campaign]] || '';
        const group = typeOf.get(campaign) || typeGroup(/search|busqueda/i.test(campaign) ? 'Búsqueda' : '');
        const ad = t.ads[r[at.ad]] || {};
        return {
          d: r[at.d], day: `${m.id}-${pad(r[at.d])}`, campaign,
          adGroup: t.adGroups[r[at.adGroup]] || '', ad: ad.name || '(sin nombre)', url: ad.url || null, keyword: t.keywords[r[at.keyword]] || '',
          cost: r[at.cost] || 0, clicks: r[at.clicks] || 0, conversions: r[at.conversions] || 0, conversionValue: r[at.conversionValue] || 0,
          impressions: null, purchases: null,
          group: group.key, groupLabel: group.label, groupColor: group.color,
        };
      });
    }
    const dcov = g.detail?.coverage;
    return {
      key: m.id, label: m.label, name: MONTHS[month - 1], shortName: SHORT[month - 1], year, month, daysInMonth,
      firstDay, lastDay, complete: cov ? cov.complete : true, totals, campaigns, byType, detail,
      detailFirst: dcov ? +dcov.start.slice(8) : null, detailLast: dcov ? +dcov.end.slice(8) : null,
      hasData: gActive(totals), raw: m,
    };
  }

  function buildGoogleMonths() {
    google.months = (state.data?.months || []).filter(m => m.google).map(normalizeGoogleMonth);
    const withData = google.months.filter(m => m.hasData);
    google.latestKey = withData.length ? withData[withData.length - 1].key : null;
    google.months.forEach(m => { m.past = Boolean(google.latestKey && m.key < google.latestKey); });
  }

  const gMonthByKey = key => google.months.find(m => m.key === key) || null;
  function gPrevious(m) {
    const date = new Date(m.year, m.month - 2, 1);
    return gMonthByKey(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
  }
  function gSelectedMonth() {
    const m = gMonthByKey(state.month);
    return m?.hasData ? m : gMonthByKey(google.latestKey);
  }
  const gViewYear = () => gSelectedMonth()?.year ?? new Date().getFullYear();

  // El mes en curso se compara con el mes anterior prorrateado a los mismos días: Google llega con un total por mes
  // y no hay tramo diario del mes anterior. Un mes cerrado se compara completo. Los cocientes no cambian al prorratear.
  function gPeriodOf(m) {
    if (!m?.hasData) return null;
    const closed = m.complete || m.past;
    const days = m.lastDay - m.firstDay + 1;
    const prev = gPrevious(m);
    let compare = null;
    if (prev?.hasData) {
      const prevDays = prev.lastDay - prev.firstDay + 1;
      const factor = closed ? 1 : Math.min(1, days / prevDays);
      compare = factor < 1
        ? { month: prev, factor, label: `${prev.name} prorrateado a ${days} ${days === 1 ? 'día' : 'días'}`, short: `${prev.shortName} prorrateado` }
        : { month: prev, factor: 1, label: rangeLabel(prev, prev.firstDay, prev.lastDay), short: rangeLabel(prev, prev.firstDay, prev.lastDay) };
    }
    // Grupos, anuncios y términos con el mismo tramo del mes anterior, si ese mes también trae informe por día.
    const detailTo = m.detailLast || m.lastDay;
    const detailCompare = m.detail && prev?.detail
      ? { rows: prev.detail.filter(r => r.d <= Math.min(closed ? prev.daysInMonth : detailTo, prev.daysInMonth)), label: rangeLabel(prev, 1, Math.min(closed ? prev.daysInMonth : detailTo, prev.daysInMonth)) }
      : null;
    return {
      month: m, months: [m], year: m.year, closed, compare, detailCompare,
      label: rangeLabel(m, m.firstDay, m.lastDay),
      detail: m.detail, detailLabel: m.detail ? rangeLabel(m, m.detailFirst, m.detailLast) : null,
    };
  }

  function gYearPeriod(year) {
    const months = google.months.filter(m => m.hasData && m.year === year);
    if (!months.length) return null;
    const first = months[0];
    const last = months[months.length - 1];
    const withDetail = months.filter(m => m.detail);
    return {
      annual: true, month: null, months, year, compare: null, detailCompare: null,
      closed: last.month === 12 && last.complete,
      label: `${first.firstDay} ${first.name} - ${last.lastDay} ${last.name}`,
      detail: withDetail.length ? withDetail.flatMap(m => m.detail) : null,
      detailLabel: withDetail.length ? withDetail.map(m => m.shortName).join(', ') : null,
    };
  }
  const gAnnualView = () => state.month === YEAR_KEY && Boolean(gYearPeriod(gViewYear()));
  const gCurrentPeriod = () => (gAnnualView() ? gYearPeriod(gViewYear()) : gPeriodOf(gSelectedMonth()));

  const gTotals = period => gDerive(period.annual ? gSum(period.months.map(m => m.totals)) : period.month.totals);
  const gPrevTotals = period => (period.compare ? gDerive(gScale(period.compare.month.totals, period.compare.factor)) : null);

  // Campañas del periodo (en Anual, sumadas por nombre).
  function gCampaigns(period) {
    const byName = new Map();
    period.months.forEach(m => m.campaigns.forEach(c => {
      if (!byName.has(c.name)) byName.set(c.name, { ...c, items: [] });
      byName.get(c.name).items.push(c);
    }));
    const total = gTotals(period).cost || 0;
    return [...byName.values()]
      .map(c => {
        const sums = gDerive(gSum(c.items));
        // El estado es el del último mes en que aparece.
        return { ...c, ...sums, status: c.items[c.items.length - 1].status, share: total && sums.cost != null ? sums.cost / total * 100 : null };
      })
      .filter(c => gActive(c) || (c.conversions || 0) > 0 || c.cost == null)
      .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || (b.conversions || 0) - (a.conversions || 0));
  }

  // Tipos de campaña del periodo (los cuadros): de los totales por tipo del informe, que vienen completos.
  function gGroups(months, campaigns, factor = 1) {
    const byKey = new Map();
    months.forEach(m => m.byType.forEach(x => {
      if (!byKey.has(x.group.key)) byKey.set(x.group.key, { ...x.group, items: [] });
      byKey.get(x.group.key).items.push(x);
    }));
    const groups = [...byKey.values()].map(g => ({ ...g, ...gDerive(gScale(gSum(g.items), factor)) })).filter(gActive);
    const total = groups.reduce((s, g) => s + (g.cost || 0), 0);
    return groups
      .map(g => ({ ...g, share: total ? g.cost / total * 100 : 0, campaigns: (campaigns || []).filter(c => c.group === g.key).map(c => c.name) }))
      .sort((a, b) => b.cost - a.cost);
  }

  // Filas del informe por día agrupadas (grupos de anuncios, anuncios, términos).
  function gRankDetail(rows, keyOf, describe) {
    const total = rows.reduce((s, r) => s + r.cost, 0);
    return [...groupRows(rows, keyOf).entries()]
      .map(([key, items]) => {
        const sums = gDerive(Object.fromEntries(['cost', 'clicks', 'conversions', 'conversionValue'].map(f => [f, items.reduce((s, r) => s + r[f], 0)])));
        const active = items.filter(gActive);
        const dates = active.map(r => r.day).sort();
        return { key, ...describe(items, active), ...sums, share: total ? sums.cost / total * 100 : 0, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null };
      })
      .filter(x => x.cost > 0 || x.clicks > 0 || x.conversions > 0)
      .sort((a, b) => b.cost - a.cost);
  }
  const gAdGroups = rows => gRankDetail(rows, r => `${r.group}|${normalize(r.adGroup)}`, (items, active) => ({
    name: items[0].adGroup, campaigns: [...new Set(active.map(r => r.campaign))],
    adCount: new Set(active.map(r => normalize(r.ad))).size, termCount: new Set(active.map(r => normalize(r.keyword))).size,
  }));
  const gAds = rows => gRankDetail(rows, r => `${r.group}|${normalize(r.ad)}`, (items, active) => ({
    group: items[0].group, groupLabel: items[0].groupLabel, groupColor: items[0].groupColor,
    ad: items[0].ad, url: items.find(r => r.url)?.url || null,
    campaigns: [...new Set(active.map(r => r.campaign))], adGroups: [...new Set(active.map(r => r.adGroup).filter(Boolean))],
    termCount: new Set(active.map(r => normalize(r.keyword))).size,
  }));
  const gTerms = rows => gRankDetail(rows, r => `${r.group}|${normalize(r.keyword)}`, (items, active) => ({
    group: items[0].group, groupLabel: items[0].groupLabel, groupColor: items[0].groupColor,
    keyword: items[0].keyword || '(sin término)', adGroups: [...new Set(active.map(r => r.adGroup).filter(Boolean))],
  }));

  const daysText = (x, period) => {
    if (!x.firstDate) return '—';
    if (period.annual || x.firstDate.slice(0, 7) !== x.lastDate.slice(0, 7)) return x.firstDate === x.lastDate ? fechaCorta(x.firstDate) : `${fechaCorta(x.firstDate)} - ${fechaCorta(x.lastDate)}`;
    const a = +x.firstDate.slice(8);
    const b = +x.lastDate.slice(8);
    const mon = SHORT[+x.firstDate.slice(5, 7) - 1].toLowerCase();
    return a === b ? `${a} ${mon}` : `${a}-${b} ${mon}`;
  };

  // ── Periodo y KPIs ──
  function renderGooglePeriod(period) {
    const title = document.getElementById('gp-g-period-title');
    const sub = document.getElementById('gp-g-period-sub');
    if (period.annual) {
      const count = period.months.length;
      const closed = period.closed || period.year < new Date().getFullYear();
      title.textContent = `Periodo: ${period.label} ${period.year}${closed ? '' : ' (año en curso)'}`;
      sub.textContent = `Acumulado de ${count} ${count === 1 ? 'mes' : 'meses'} con informe de Google Ads (${period.months.map(m => m.shortName).join(', ')}). Sin año anterior para comparar.`;
      return;
    }
    title.textContent = `Periodo: ${period.label} ${period.year}${period.closed ? '' : ' (mes en curso)'}`;
    sub.textContent = !period.compare ? 'Sin mes anterior para comparar'
      : period.compare.factor < 1 ? `Comparación vs ${period.compare.label} (Google llega con un total por mes)`
      : `Comparación vs ${period.compare.label}`;
  }

  function renderGoogleKpis(period) {
    const current = gTotals(period);
    const previous = gPrevTotals(period);
    let average = null;
    if (period.annual) {
      const closed = period.months.filter(m => m.complete || m.past);
      const months = closed.length ? closed : period.months;
      average = Object.fromEntries(G_KPIS.map(k => [k.key, months.reduce((s, m) => s + (m.totals[k.key] || 0), 0) / months.length]));
      average.basis = `Promedio de ${months.map(m => m.name).join(', ')}`;
    }
    document.getElementById('gp-g-kpis').innerHTML = G_KPIS.map(k => {
      let line = `<small>${k.hint}</small>`;
      if (previous) line = deltaHtml(current[k.key], previous[k.key], k.better, period.compare.short);
      else if (average && k.perMonth) line = `<small title="${esc(average.basis)}">Prom. mensual: ${fmt(k.format, average[k.key])}</small>`;
      const note = k.note ? k.note(current) : '';
      return `
        <div class="kpi-pill">
          <span>${k.label}</span>
          <strong>${fmt(k.format, current[k.key])}</strong>
          ${line}${note ? `<small>${note}</small>` : ''}
        </div>`;
    }).join('');
    // Las conversiones de Google suman Compra y Contacto (clics a WhatsApp): se explican cuando difieren de las compras.
    const categories = {};
    period.months.forEach(m => Object.entries(m.raw.google.conversionsByCategory || {}).forEach(([k, v]) => { categories[k] = (categories[k] || 0) + (v || 0); }));
    const cats = Object.entries(categories).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    const note = document.getElementById('gp-g-kpis-note');
    const differs = current.conversions != null && (current.conversions !== current.purchases || cats.some(([k]) => !/compra/i.test(k)));
    note.hidden = !differs;
    note.innerHTML = differs
      ? `Conversiones del periodo: <b>${numDec(current.conversions)}</b>${cats.length ? ` (${cats.map(([k, v]) => `${esc(k)} ${numDec(v)}`).join(' · ')})` : ''}. ${cats.some(([k]) => /contacto/i.test(k)) ? 'Contacto son clics a WhatsApp y va aparte: ' : ''}el KPI de conversión es <b>Compras</b>.`
      : '';
  }

  // ── Distribución por campaña ──
  function renderGoogleDistribution(period) {
    const rows = gCampaigns(period);
    const total = gTotals(period);
    const incomplete = period.months.filter(m => m.raw.google.campaignsComplete === false);
    document.getElementById('gp-g-dist-sub').textContent = `${period.label} | ${rows.length} ${rows.length === 1 ? 'campaña' : 'campañas'} con costo, impresiones o clics.`;
    const cell = (v, f) => (v == null ? '<span class="gp-no-data">—</span>' : f(v));
    document.getElementById('gp-g-dist-body').innerHTML = rows.map(c => `
      <tr style="--gp-row-c:${c.groupColor}">
        <td class="gp-camp-name">${esc(c.name)}</td>
        <td><span class="gp-group"><i class="gp-dot-c"></i>${esc(c.groupLabel)}</span></td>
        <td><span class="gp-result-pill">${esc(c.status || '—')}</span></td>
        <td class="r mono">${cell(c.cost, v => money(v, 2))}</td>
        <td class="gp-share-col">${c.share == null ? '<span class="gp-no-data">—</span>' : `<span class="gp-share"><span style="width:${Math.min(100, c.share).toFixed(1)}%"></span></span><b>${pct(c.share)}</b>`}</td>
        <td class="r mono">${cell(c.impressions, num)}</td>
        <td class="r mono">${cell(c.clicks, num)}</td>
        <td class="r mono">${pct(c.ctr, 2)}</td>
        <td class="r mono">${money(c.cpc, 2)}</td>
        <td class="r mono">${c.conversions ? numDec(c.conversions) : '—'}</td>
        <td class="r mono">${c.purchases ? numDec(c.purchases) : '—'}</td>
        <td class="r mono">${money(c.costPerPurchase, 2)}</td>
        <td class="r mono">${c.conversionValue ? money(c.conversionValue) : '—'}</td>
        <td class="r">${c.cost == null ? '<span class="gp-no-data">—</span>' : roasPill(c.roas, c.purchases)}</td>
      </tr>`).join('') + `
      <tr class="gp-total-row">
        <td class="gp-camp-name">Total del periodo</td>
        <td></td><td></td>
        <td class="r mono">${money(total.cost, 2)}</td>
        <td class="gp-share-col"><b>100%</b></td>
        <td class="r mono">${num(total.impressions)}</td>
        <td class="r mono">${num(total.clicks)}</td>
        <td class="r mono">${pct(total.ctr, 2)}</td>
        <td class="r mono">${money(total.cpc, 2)}</td>
        <td class="r mono">${numDec(total.conversions)}</td>
        <td class="r mono">${numDec(total.purchases)}</td>
        <td class="r mono">${money(total.costPerPurchase, 2)}</td>
        <td class="r mono">${money(total.conversionValue)}</td>
        <td class="r">${roasPill(total.roas, total.purchases)}</td>
      </tr>`;
    const note = document.getElementById('gp-g-dist-note');
    note.hidden = !incomplete.length;
    note.textContent = incomplete.length
      ? `El informe de ${incomplete.map(m => m.name).join(', ')} viene segmentado por conversión: por campaña solo trae conversiones y su valor (—). La inversión completa está en los cuadros por tipo y en el total.`
      : '';
  }

  // ── Cuadro de cada tipo de campaña ──
  function gCampaignSettings(key) {
    const saved = google.campaignCharts[key] || {};
    const metrics = G_METRICS.map(m => m.key).filter(k => Array.isArray(saved.metrics) && saved.metrics.includes(k));
    return {
      metrics: metrics.length ? metrics : G_DEFAULT_METRICS,
      // Como en Meta, abre en el acumulado del mes; sin informe por día el cuadro cae a "Por mes".
      mode: MODES.some(m => m.key === saved.mode) ? saved.mode : 'cumulative',
      collapsed: saved.collapsed === true,
    };
  }
  function gSaveCampaignSettings(key, changes) {
    google.campaignCharts[key] = { ...gCampaignSettings(key), ...changes };
    saveSetting(G_CAMP_CHARTS_KEY, JSON.stringify(google.campaignCharts));
  }
  const gCampaignBlock = key => [...document.querySelectorAll('#gp-g-blocks .gp-camp-block')].find(n => n.dataset.group === key) || null;

  // El cuadro tiene serie diaria si el mes trae informe por día con filas de ese tipo.
  const gHasDaily = (period, key) => !period.annual && Boolean(period.month.detail?.some(r => r.group === key && gActive(r)));

  function gAdGroupsHtml(period, group) {
    const head = `
      <div class="gp-adset-head">
        <div class="panel-title">Grupos de anuncios</div>`;
    const rows = (period.detail || []).filter(r => r.group === group.key);
    if (!rows.length) {
      return `${head}
        <div class="panel-sub">${period.detail
          ? `El informe por día de ${esc(period.detailLabel)} no trae filas de ${esc(group.label)}.`
          : `El informe de campaña no trae grupos de anuncios. Para verlos, sube a la carpeta <b>Google Files</b> el informe por día con Campaña, Grupo de anuncios, Anuncio y Palabra clave del mes (como el de octubre).`}</div>
      </div>`;
    }
    const sets = gAdGroups(rows);
    const compare = period.detailCompare;
    const previous = new Map((compare ? gAdGroups(compare.rows.filter(r => r.group === group.key)) : []).map(s => [s.key, s]));
    const manyCampaigns = group.campaigns.length > 1;
    const detailCost = rows.reduce((s, r) => s + r.cost, 0);
    const cols = [['Grupo']].concat(manyCampaigns ? [['Campaña']] : [], [['Conversiones', true]])
      .concat(compare ? [[`Conversiones ${compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por conversión', true], ['Inversión', true], ['% del tipo'], ['Clics', true], ['CPC', true], ['Valor', true], ['ROAS', true], ['Términos', true]]);
    return `${head}
        <div class="panel-sub">${sets.length} ${sets.length === 1 ? 'grupo' : 'grupos'} en el informe por día (${esc(period.detailLabel)}): ${money(detailCost, 2)} de ${money(group.cost, 2)} del tipo. Google no detalla los términos con pocas impresiones.</div>
      </div>
      <div class="gp-table-wrap">
        <table class="rep-table gp-adset-table">
          <thead><tr>${cols.map(([label, numeric]) => `<th${numeric ? ' class="r"' : ''}>${esc(label)}</th>`).join('')}</tr></thead>
          <tbody>${sets.map(s => {
            const before = previous.get(s.key);
            return `<tr>
              <td class="gp-camp-name">${esc(s.name || '(sin grupo)')}<small>${s.adCount} ${s.adCount === 1 ? 'anuncio' : 'anuncios'}</small></td>
              ${manyCampaigns ? `<td class="gp-set-col">${esc(s.campaigns.join(' / '))}</td>` : ''}
              <td class="r mono"><b>${numDec(s.conversions)}</b></td>
              ${compare ? `<td class="r mono">${before ? numDec(before.conversions) : '<span class="gp-no-data">—</span>'}</td><td class="r">${variationCell(s.conversions, before?.conversions)}</td>` : ''}
              <td class="r mono">${money(s.costPerConversion, 2)}</td>
              <td class="r mono">${money(s.cost, 2)}</td>
              <td class="gp-share-col"><span class="gp-share"><span style="width:${Math.min(100, s.share).toFixed(1)}%"></span></span><b>${pct(s.share)}</b></td>
              <td class="r mono">${num(s.clicks)}</td>
              <td class="r mono">${money(s.cpc, 2)}</td>
              <td class="r mono">${s.conversionValue ? money(s.conversionValue) : '—'}</td>
              <td class="r">${roasPill(s.roas, s.conversions)}</td>
              <td class="r mono">${num(s.termCount)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  // Anuncios del tipo, del informe por día: de más a menos conversiones. La tabla completa está en el módulo Anuncios.
  function gCampaignAdsHtml(period, group) {
    const head = `
      <div class="gp-adset-head">
        <div class="panel-title">Anuncios</div>`;
    const rows = (period.detail || []).filter(r => r.group === group.key);
    if (!rows.length) {
      return `${head}
        <div class="panel-sub">${period.detail
          ? `El informe por día de ${esc(period.detailLabel)} no trae anuncios de ${esc(group.label)}.`
          : 'El informe de campaña no trae anuncios: llegan con el informe por día y palabra clave del mes.'}</div>
      </div>`;
    }
    const ads = gAds(rows).sort((a, b) => b.conversions - a.conversions || b.cost - a.cost);
    const compare = period.detailCompare;
    const previous = new Map((compare ? gAds(compare.rows.filter(r => r.group === group.key)) : []).map(a => [a.key, a]));
    const total = rows.reduce((s, r) => s + r.cost, 0);
    // Ventas y ROAS van junto al anuncio; el nombre enlaza a la página a la que lleva el anuncio.
    const cols = [['Anuncio'], ['Ventas', true], ['ROAS', true], ['Grupo'], ['Conversiones', true]]
      .concat(compare ? [[`Conversiones ${compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por conversión', true], ['Inversión', true], ['% del tipo'], ['Clics', true], ['CPC', true], ['Términos', true], ['Días activos']]);
    return `${head}
        <div class="panel-sub">${ads.length} ${ads.length === 1 ? 'anuncio' : 'anuncios'} en el informe por día (${esc(period.detailLabel)}). La estrella marca al líder.</div>
      </div>
      <div class="gp-table-wrap">
        <table class="rep-table gp-adset-table gp-camp-ads-table">
          <thead><tr>${cols.map(([label, numeric]) => `<th${numeric ? ' class="r"' : ''}>${esc(label)}</th>`).join('')}</tr></thead>
          <tbody>${ads.map((a, k) => {
            const before = previous.get(a.key);
            const share = total ? a.cost / total * 100 : 0;
            return `<tr>
              <td class="gp-camp-name gp-ad-cell" title="${esc(a.ad)}">${k === 0 && a.conversions > 0 ? '<b class="gp-leader" title="Líder del tipo">★</b> ' : ''}${adNameLink(a.ad, a.url, 'Ver la página del anuncio')}</td>
              <td class="r mono gp-sales-col">${salesCell(a.conversionValue, a.conversions, 'conv.')}</td>
              <td class="r">${roasPill(a.roas, a.conversions)}</td>
              <td class="gp-set-col">${esc(a.adGroups.join(' / ') || '—')}</td>
              <td class="r mono"><b>${numDec(a.conversions)}</b></td>
              ${compare ? `<td class="r mono">${before ? numDec(before.conversions) : '<span class="gp-no-data">—</span>'}</td><td class="r">${variationCell(a.conversions, before?.conversions)}</td>` : ''}
              <td class="r mono">${money(a.costPerConversion, 2)}</td>
              <td class="r mono">${money(a.cost, 2)}</td>
              <td class="gp-share-col"><span class="gp-share"><span style="width:${Math.min(100, share).toFixed(1)}%"></span></span><b>${pct(share)}</b></td>
              <td class="r mono">${num(a.clicks)}</td>
              <td class="r mono">${money(a.cpc, 2)}</td>
              <td class="r mono">${num(a.termCount)}</td>
              <td class="gp-date-col">${daysText(a, period)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function gCampaignHtml(period, group, before) {
    const key = esc(group.key);
    const settings = gCampaignSettings(group.key);
    let comparison = '';
    if (period.annual) {
      const months = period.months.filter(m => m.byType.some(x => x.group.key === group.key && gActive(x)));
      comparison = months.length === period.months.length ? `. Activo en los ${months.length} ${months.length === 1 ? 'mes' : 'meses'}` : `. Activo en ${months.map(m => m.shortName).join(', ')}`;
    } else if (period.compare) {
      comparison = before ? ` vs ${period.compare.label}` : `. Nuevo: no corría en ${period.compare.month.name}`;
    }
    const kpis = G_CAMPAIGN_KPIS.map(k => `
      <div><dt>${esc(k.label)}</dt><dd>${fmt(k.format, group[k.key])}${before ? deltaHtml(group[k.key], before[k.key], k.better) : ''}</dd></div>`).join('');
    return `
      <section class="gp-camp-block${settings.collapsed ? ' is-collapsed' : ''}" data-group="${key}" style="--gp-row-c:${group.color}">
        <div class="gp-camp-head">
          <div>
            <div class="gp-camp-title"><i class="gp-dot-c"></i>Campaña ${esc(group.label)}<em>${pct(group.share)} de la inversión</em></div>
            <div class="panel-sub">${esc(group.campaigns.join(' / ') || group.label)} | ${esc(period.label)}${esc(comparison)}</div>
          </div>
          <div class="gp-camp-controls">
            <div class="gp-chips" data-camp-modes role="radiogroup" aria-label="Vista del gráfico de ${esc(group.label)}"></div>
            <button type="button" class="gp-chart-toggle" data-camp-toggle aria-controls="gp-gcamp-body-${key}">${CHEVRON}</button>
          </div>
        </div>
        <dl class="gp-camp-kpis">${kpis}</dl>
        <div class="gp-camp-body" id="gp-gcamp-body-${key}">
          <div class="gp-chips gp-camp-metrics" data-camp-metrics role="group" aria-label="Indicadores del gráfico de ${esc(group.label)}"></div>
          <div class="chart-wrap h-300"><canvas id="chart-gp-gcamp-${key}" role="img" aria-label="Gráfico de la campaña ${esc(group.label)}"></canvas></div>
          <div class="gp-legend" data-camp-legend></div>
          ${gAdGroupsHtml(period, group)}
          ${gCampaignAdsHtml(period, group)}
        </div>
      </section>`;
  }

  // Valores por día del informe por día (índice 0 = día 1). Fuera de los días que cubre el informe quedan en null.
  function gDailyValues(m, field, key) {
    const values = Array.from({ length: m.daysInMonth }, (_, i) => (i + 1 >= m.detailFirst && i + 1 <= m.detailLast ? 0 : null));
    m.detail.forEach(r => { if (r.group === key && values[r.d - 1] != null) values[r.d - 1] += r[field]; });
    return values;
  }

  function gLineSeries(metric, modeKey, m, compare = true) {
    if (modeKey === 'monthly') {
      const year = gViewYear();
      const values = MONTHS.map((_, k) => {
        const month = gMonthByKey(`${year}-${pad(k + 1)}`);
        const items = month?.hasData ? month.byType.filter(x => x.group.key === metric.group) : [];
        return items.some(gActive) ? items.reduce((s, x) => s + (x[metric.key] || 0), 0) : null;
      });
      return {
        labels: SHORT,
        datasets: [{ label: metric.label, unit: metric.unit, data: values, borderColor: metric.color, backgroundColor: `${metric.color}1a`, fill: true, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: metric.color, tension: 0.25, spanGaps: false, valueLabels: true }],
        legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(metric.label)} por mes</b></span>`],
      };
    }
    const isCumulative = modeKey === 'cumulative';
    const transform = values => (isCumulative ? cumulative(values) : values);
    const label = metric.dailyLabel || metric.label;
    const series = {
      labels: Array.from({ length: m.daysInMonth }, (_, i) => `${i + 1}`),
      datasets: [{ label: compare ? m.name : label, unit: metric.unit, data: transform(gDailyValues(m, metric.daily, metric.group)), borderColor: metric.color, backgroundColor: `${metric.color}14`, fill: isCumulative, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: false }],
      legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(m.name)} ${m.year} · informe por día (${esc(rangeLabel(m, m.detailFirst, m.detailLast))})</b></span>`],
    };
    const prev = gPrevious(m);
    if (compare && prev?.detail) {
      const prevValues = transform(gDailyValues(prev, metric.daily, metric.group)).slice(0, m.daysInMonth);
      if (prevValues.some(v => v)) {
        series.datasets.push({ label: prev.name, unit: metric.unit, data: prevValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 });
        series.legend.push(`<span><i class="gp-legend-line dashed" style="color:${PREVIOUS_COLOR}"></i><b>${esc(prev.name)} (mismo día del mes)</b></span>`);
      }
    } else if (compare) {
      series.legend.push(`<span>${prev ? `${esc(prev.name)} no tiene informe por día para comparar.` : ''}</span>`);
    }
    return series;
  }

  function gCampaignSeries(metrics, modeKey, m) {
    if (metrics.length === 1) return gLineSeries(metrics[0], modeKey, m);
    const parts = metrics.map(metric => gLineSeries(metric, modeKey, m, false));
    return {
      labels: parts[0].labels,
      datasets: parts.map((part, i) => ({ ...part.datasets[0], label: modeKey === 'monthly' ? metrics[i].label : metrics[i].dailyLabel || metrics[i].label, yAxisID: `y${i}` })),
      legend: [parts[0].legend[0].replace(/<b>.*<\/b>/, `<b>${modeKey === 'monthly' ? `${metrics.length} indicadores por mes` : `${esc(m.name)} ${m.year} · informe por día`}</b>`), '<span>Cada indicador con su escala.</span>'],
    };
  }

  function renderGoogleChart(key, period = gCurrentPeriod(), groups = null) {
    const block = gCampaignBlock(key);
    const list = groups || gGroups(period.months, gCampaigns(period));
    const group = list.find(g => g.key === key);
    const m = gSelectedMonth();
    if (!block || !group || !m) return;
    const settings = gCampaignSettings(key);
    const daily = gHasDaily(period, key);
    const modes = daily ? MODES : MODES.filter(x => x.key === 'monthly');
    const modeKey = daily && modes.some(x => x.key === settings.mode) ? settings.mode : 'monthly';
    // En la serie diaria no hay impresiones: ese indicador solo aparece por mes.
    const metrics = G_METRICS.filter(x => modeKey === 'monthly' || x.daily)
      .map(x => ({ ...x, label: modeKey === 'monthly' ? x.label : x.dailyLabel || x.label, color: group.color, group: key }));
    let selected = metrics.filter(x => settings.metrics.includes(x.key));
    if (!selected.length) selected = metrics.filter(x => G_DEFAULT_METRICS.includes(x.key));
    const toggle = block.querySelector('[data-camp-toggle]');
    block.classList.toggle('is-collapsed', settings.collapsed);
    toggle.setAttribute('aria-expanded', String(!settings.collapsed));
    toggle.title = `${settings.collapsed ? 'Expandir' : 'Minimizar'} la campaña ${group.label}`;
    const modesHost = block.querySelector('[data-camp-modes]');
    const metricsHost = block.querySelector('[data-camp-metrics]');
    keepFocus(modesHost, () => { modesHost.innerHTML = chipsHtml(modes, modeKey, `gp-gcamp-mode-${key}`, 'var(--brand)'); });
    keepFocus(metricsHost, () => { metricsHost.innerHTML = chipsHtml(metrics, selected.map(x => x.key), `gp-gcamp-metric-${key}`, null, true); });
    const id = `chart-gp-gcamp-${key}`;
    if (settings.collapsed) {
      global.Charts.destroy(id);
      google.charts.delete(id);
      return;
    }
    const series = gCampaignSeries(selected, modeKey, m);
    block.querySelector('canvas').parentElement.style.height = selected.length > 1 ? `${90 + 135 * selected.length}px` : '';
    block.querySelector('[data-camp-legend]').innerHTML = series.legend.join('');
    drawLineChart(id, series, selected, modeKey, google.charts);
  }

  function renderGoogleCampaigns(period, groups) {
    google.charts.forEach(id => global.Charts.destroy(id));
    google.charts.clear();
    const previous = period.compare ? gGroups([period.compare.month], period.compare.month.campaigns, period.compare.factor) : [];
    document.getElementById('gp-g-blocks').innerHTML = groups.map(g => gCampaignHtml(period, g, previous.find(p => p.key === g.key))).join('');
    groups.forEach(g => renderGoogleChart(g.key, period, groups));
  }

  // ── Anuncios y términos de búsqueda (informe por día) ──
  function detailNote(period) {
    if (!period.detail) return '';
    const months = period.months.filter(m => m.detail);
    const detailCost = period.detail.reduce((s, r) => s + r.cost, 0);
    const cost = months.reduce((s, m) => s + (m.totals.cost || 0), 0);
    return `Informe por día y palabra clave (${esc(period.detailLabel)}): ${money(detailCost, 2)} de ${money(cost, 2)} del informe de campaña (${pct(cost ? detailCost / cost * 100 : null, 0)}). Google no detalla los términos con pocas impresiones.`;
  }

  function renderGoogleAds(period, groups) {
    const body = document.getElementById('gp-g-ads-body');
    const panel = document.getElementById('gp-g-ads-panel');
    const select = document.getElementById('gp-g-ads-group');
    const compare = period.detailCompare;
    panel.classList.toggle('no-compare', !compare);
    const detailGroups = groups.filter(g => (period.detail || []).some(r => r.group === g.key));
    if (google.adsGroup !== 'all' && !detailGroups.some(g => g.key === google.adsGroup)) google.adsGroup = 'all';
    select.innerHTML = ['<option value="all">Todos los tipos</option>']
      .concat(detailGroups.map(g => `<option value="${esc(g.key)}"${g.key === google.adsGroup ? ' selected' : ''}>${esc(g.label)}</option>`)).join('');
    document.getElementById('gp-g-ads-title').textContent = `Anuncios | ${period.label} ${period.year}`;
    document.getElementById('gp-g-ads-prev-head').textContent = compare ? `Conversiones ${compare.label}` : 'Mes anterior';
    const sub = document.getElementById('gp-g-ads-sub');
    if (!period.detail) {
      sub.textContent = '';
      body.innerHTML = '<tr><td class="gp-table-empty" colspan="14">El informe de campaña no trae anuncios. Para verlos, sube a la carpeta Google Files el informe de anuncios por día y palabra clave del mes.</td></tr>';
      return;
    }
    const order = new Map(groups.map((g, i) => [g.key, i]));
    const previous = new Map((compare ? gAds(compare.rows) : []).map(a => [a.key, a]));
    const all = gAds(period.detail).sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) || b.conversions - a.conversions || b.cost - a.cost);
    const leaders = new Set();
    all.forEach(a => { if (a.conversions > 0 && !leaders.has(a.group)) { leaders.add(a.group); a.leader = true; } });
    const rows = google.adsGroup === 'all' ? all : all.filter(a => a.group === google.adsGroup);
    sub.innerHTML = `${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} ordenados por conversiones dentro de cada tipo. La estrella marca al líder. ${detailNote(period)}`;
    // Ventas y ROAS van junto al anuncio; el nombre enlaza a la página a la que lleva el anuncio.
    body.innerHTML = rows.map(a => {
      const before = previous.get(a.key);
      return `
        <tr style="--gp-row-c:${a.groupColor}">
          <td class="gp-type-col"><span class="gp-group"><i class="gp-dot-c"></i>${esc(a.groupLabel)}</span></td>
          <td class="gp-ad-col" title="${esc(a.ad)}"><span class="gp-ad-text">${a.leader ? '<b class="gp-leader" title="Líder del tipo">★</b> ' : ''}${adNameLink(a.ad, a.url, 'Ver la página del anuncio')}</span></td>
          <td class="r mono gp-sales-col">${salesCell(a.conversionValue, a.conversions, 'conv.')}</td>
          <td class="r">${roasPill(a.roas, a.conversions)}</td>
          <td class="gp-set-col">${esc(a.campaigns.join(' / '))}<small>${esc(a.adGroups.join(' / ') || '—')}</small></td>
          <td class="r mono">${money(a.cost, 2)}</td>
          <td class="r mono"><b>${numDec(a.conversions)}</b></td>
          <td class="r mono">${before ? numDec(before.conversions) : '<span class="gp-no-data">—</span>'}</td>
          <td class="r">${compare ? variationCell(a.conversions, before?.conversions) : '<span class="gp-no-data">—</span>'}</td>
          <td class="r mono">${money(a.costPerConversion, 2)}</td>
          <td class="r mono">${num(a.clicks)}</td>
          <td class="r mono">${money(a.cpc, 2)}</td>
          <td class="r mono">${num(a.termCount)}</td>
          <td class="gp-date-col">${daysText(a, period)}</td>
        </tr>`;
    }).join('') || '<tr><td class="gp-table-empty" colspan="14">No hay anuncios de este tipo en el periodo.</td></tr>';
  }

  function renderGoogleTerms(period) {
    const panel = document.getElementById('gp-g-terms-panel');
    const sub = document.getElementById('gp-g-terms-sub');
    const body = document.getElementById('gp-g-terms-body');
    if (!period.detail) {
      sub.textContent = 'Lo que la gente buscó en Google antes de hacer clic en un anuncio.';
      body.innerHTML = '<tr><td class="gp-table-empty" colspan="10">Sin informe por día y palabra clave para este periodo.</td></tr>';
      return;
    }
    const terms = gTerms(period.detail);
    sub.innerHTML = `${terms.length} ${terms.length === 1 ? 'término' : 'términos'} que la gente buscó antes de hacer clic, de mayor a menor inversión. ${detailNote(period)}`;
    body.innerHTML = terms.map(x => `
      <tr style="--gp-row-c:${x.groupColor}">
        <td class="gp-camp-name">${esc(x.keyword)}</td>
        <td><span class="gp-group"><i class="gp-dot-c"></i>${esc(x.groupLabel)}</span></td>
        <td class="gp-set-col">${esc(x.adGroups.join(' / ') || '—')}</td>
        <td class="r mono">${money(x.cost, 2)}</td>
        <td class="gp-share-col"><span class="gp-share"><span style="width:${Math.min(100, x.share).toFixed(1)}%"></span></span><b>${pct(x.share)}</b></td>
        <td class="r mono">${num(x.clicks)}</td>
        <td class="r mono">${money(x.cpc, 2)}</td>
        <td class="r mono">${x.conversions ? numDec(x.conversions) : '—'}</td>
        <td class="r">${roasPill(x.roas, x.conversions)}</td>
        <td class="gp-date-col">${daysText(x, period)}</td>
      </tr>`).join('');
    panel.hidden = false;
  }

  // ── Render ──
  function renderGoogle() {
    const body = document.getElementById('gp-google-body');
    if (!google.latestKey) { emptyState(body, 'google'); return; }
    if (!body.querySelector('#gp-g-kpis')) body.innerHTML = googleBodyTpl;

    const period = gCurrentPeriod();
    const year = gViewYear();
    const campaigns = gCampaigns(period);
    const groups = gGroups(period.months, campaigns);
    renderMonthTabs('gp-google-months', {
      year, has: key => Boolean(gMonthByKey(key)?.hasData), latestKey: google.latestKey,
      selected: period.month?.key, annual: Boolean(period.annual), yearOk: Boolean(gYearPeriod(year)), what: 'informe de Google Ads',
    });
    renderAlerts('gp-google-alerts', 'google', period.annual ? { label: String(period.year), warnings: [] } : period.month.raw);
    renderGooglePeriod(period);
    renderGoogleKpis(period);
    renderGoogleDistribution(period);
    renderGoogleCampaigns(period, groups);
    renderGoogleTerms(period);
  }

  function wireGoogle() {
    const body = document.getElementById('gp-google-body');
    body.addEventListener('click', e => {
      const tab = e.target.closest('#gp-google-months .month-tab:not(:disabled)');
      if (tab) {
        if (tab.dataset.month === state.month) return;
        setMonth(tab.dataset.month);
        markRendered('google');
        renderGoogle();
        return;
      }
      const toggle = e.target.closest('[data-camp-toggle]');
      if (toggle) {
        const key = toggle.closest('.gp-camp-block').dataset.group;
        gSaveCampaignSettings(key, { collapsed: !gCampaignSettings(key).collapsed });
        renderGoogleChart(key);
      }
    });
    body.addEventListener('change', e => {
      const input = e.target.closest('.gp-camp-block input');
      if (!input) return;
      const block = input.closest('.gp-camp-block');
      const key = block.dataset.group;
      if (input.closest('[data-camp-modes]')) {
        gSaveCampaignSettings(key, { mode: input.value });
      } else {
        // Siempre queda al menos un indicador: desmarcar el último lo deja como estaba.
        const checked = [...block.querySelectorAll('[data-camp-metrics] input:checked')].map(i => i.value);
        if (checked.length) gSaveCampaignSettings(key, { metrics: checked });
      }
      renderGoogleChart(key);
    });
  }

  // ════════════════════════════════════════════════════════════
  // MÓDULO ANUNCIOS (vista view-ads)
  // Las tablas de anuncios de Meta y Google con el top 3 de anuncios con ventas. Mismos datos, periodos y mes que
  // Gasto publicitario; dentro de ese módulo cada campaña muestra además sus propios anuncios.
  // ════════════════════════════════════════════════════════════
  const ADS_TAB_KEY = 'rb-ads-tab';
  const adsView = { tab: 'meta' };

  // Top 3 de anuncios que generaron ventas en el periodo: los de más valor atribuido (a igual valor, más compras).
  const topSales = (ads, value, count) => ads.filter(a => a[value] > 0 || a[count] > 0)
    .sort((a, b) => b[value] - a[value] || b[count] - a[count]).slice(0, 3);

  // arte (opcional): el arte de cada anuncio debajo de sus cifras (Meta).
  function topSalesHtml(ads, { value, count, spend, word, link, none, arte }) {
    const top = topSales(ads, value, count);
    const head = '<div class="ad-top-head">Top 3 de anuncios que generaron ventas</div>';
    if (!top.length) return `${head}<p class="gp-note">${none}</p>`;
    return `${head}<div class="ad-top-list">${top.map((a, k) => `
      <div class="ad-top-card" style="--gp-row-c:${a.groupColor}">
        <span class="ad-top-rank">${k + 1}</span>
        <div class="ad-top-body">
          <div class="ad-top-name" title="${esc(a.ad)}">${adNameLink(a.ad, a[link], 'Ver el anuncio')}</div>
          <div class="ad-top-group"><i class="gp-dot-c"></i>${esc(a.groupLabel)} · ${esc(a.campaigns.join(' / '))}</div>
          <div class="ad-top-value">${money(a[value])}</div>
          <div class="ad-top-meta">${numDec(a[count])} ${word(a[count])} · ROAS ${roasFmt(a.roas)} · ${money(a[spend], 2)} de inversión</div>
        </div>
        ${arte ? arte(a) : ''}
      </div>`).join('')}</div>`;
  }

  // ── Artes del mes (data/artes-2026.json, incrustado como RB_ARTES_DATA al publicar) ──
  // Cada arte se identifica con su anuncio por el nombre del archivo: "40% OFF - Daniela.mp4" ↔ "40% OFF Daniela".
  // Solo hay artes de algunos anuncios: los que están en la carpeta del mes.
  // Datos auxiliares del módulo: incrustados al publicar (scripts/build.js) o el JSON de data/ en local.
  async function loadExtra(globalName, file) {
    if (global[globalName]) return global[globalName];
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.warn('[gasto] no se pudo cargar', file, err);
      return null;
    }
  }
  const loadArtes = () => loadExtra('RB_ARTES_DATA', 'data/artes-2026.json');
  // Comentario y propuestas creativas del mes (data/propuestas-creativas-2026.json), escritos a mano.
  const loadPropuestas = () => loadExtra('RB_PROPUESTAS_DATA', 'data/propuestas-creativas-2026.json');
  // Un carrusel es una subcarpeta «<anuncio> (Carrusel)»: el sufijo no es parte del nombre del anuncio.
  const artKey = name => normalize(String(name ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\s*\((carrusel|carousel)\)\s*$/i, ''))
    .replace(/[^a-z0-9%]+/g, ' ').trim();
  const driveId = id => (/^[\w-]{20,}$/.test(String(id || '')) ? String(id) : null);

  // Artes del periodo: los del mes elegido o, en la vista anual, los de todos los meses (el más reciente primero).
  function artesOf(period) {
    const months = state.artes?.months || {};
    if (!period.annual) return months[period.month.key]?.artes || [];
    return Object.keys(months).sort().reverse().flatMap(key => months[key].artes || []);
  }

  // La miniatura de Drive hace de portada; el reproductor de Drive se carga al hacer clic (ver wireAds).
  // Drive rechaza la miniatura si la petición lleva el referer del tablero.
  // Un carrusel es una subcarpeta «(Carrusel)» con una imagen por lámina: la portada es la primera
  // y el clic pasa a la siguiente, en vez de abrir el reproductor de video.
  const esCarrusel = art => art.kind === 'carrusel' && Array.isArray(art.slides) && art.slides.length > 1;
  function arteMedia(art) {
    const id = driveId(art.driveId);
    if (!id) return '<span class="gp-no-data">Sin vista previa</span>';
    if (esCarrusel(art)) {
      const slides = art.slides.filter(driveId);
      return `<button type="button" class="ad-arte-poster is-carrusel" data-slides="${esc(slides.join(','))}" data-slide="0" data-title="${esc(art.file)}" aria-label="Siguiente lámina de ${esc(art.file)}">
          <img src="https://drive.google.com/thumbnail?id=${slides[0]}&amp;sz=w480" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="ad-arte-slide-count" aria-hidden="true">1/${slides.length}</span>
        </button>`;
    }
    return `<button type="button" class="ad-arte-poster" data-arte="${id}" data-title="${esc(art.file)}" aria-label="Reproducir ${esc(art.file)}">
          <img src="https://drive.google.com/thumbnail?id=${id}&amp;sz=w480" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="ad-arte-play" aria-hidden="true">▶</span>
        </button>`;
  }

  function pasarLamina(poster) {
    const slides = String(poster.dataset.slides || '').split(',').filter(Boolean);
    if (slides.length < 2) return;
    const siguiente = (Number(poster.dataset.slide || 0) + 1) % slides.length;
    poster.dataset.slide = String(siguiente);
    poster.querySelector('img').src = `https://drive.google.com/thumbnail?id=${slides[siguiente]}&sz=w480`;
    poster.querySelector('.ad-arte-slide-count').textContent = `${siguiente + 1}/${slides.length}`;
  }
  // Drive no deja reproducir sus videos fuera de su reproductor, y ese reproductor se descuadra en marcos angostos
  // (franja negra, controles cortados). Se pinta a 360×640, donde encaja justo en 9:16, y se escala al ancho del marco.
  const DRIVE_PLAYER = { width: 360, height: 640 };
  function playArte(poster) {
    const box = poster.closest('.ad-arte-media');
    const frame = document.createElement('iframe');
    frame.src = `https://drive.google.com/file/d/${poster.dataset.arte}/preview`;
    frame.title = `Arte ${poster.dataset.title}`;
    frame.allow = 'autoplay; fullscreen';
    frame.allowFullscreen = true;
    frame.className = 'ad-arte-player';
    frame.style.width = DRIVE_PLAYER.width + 'px';
    frame.style.height = DRIVE_PLAYER.height + 'px';
    const fit = () => { frame.style.transform = `scale(${box.clientWidth / DRIVE_PLAYER.width})`; };
    fit();
    if (global.ResizeObserver) new ResizeObserver(fit).observe(box);
    poster.replaceWith(frame);
  }

  const arteNotes = art => `<ul class="ad-arte-notes">${(art.notes || []).slice(0, 3).map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;

  // Debajo del nombre: qué es la pieza. Un carrusel dice cuántas láminas tiene; un video, su duración
  // cuando está anotada a mano.
  function arteTipo(art) {
    if (esCarrusel(art)) return `<small>Carrusel · ${art.slides.length} láminas</small>`;
    if (!art.seconds) return '';
    return `<small>${art.kind === 'video' ? 'Video' : 'Imagen'} · ${art.seconds} s</small>`;
  }

  // Arte de un anuncio del top 3, o un cuadro referencial si la carpeta del mes no lo tiene.
  function topArteHtml(ad, period) {
    const art = artesOf(period).find(x => artKey(x.file) === artKey(ad.ad));
    if (art) {
      return `
        <div class="ad-top-arte">
          <div class="ad-arte-media">${arteMedia(art)}</div>
          <div class="ad-arte-body">
            <div class="ad-arte-file">${esc(art.file)}${arteTipo(art)}</div>
            ${arteNotes(art)}
          </div>
        </div>`;
    }
    const where = period.annual ? 'las carpetas de artes' : state.artes?.months?.[period.month.key]
      ? `la carpeta ${esc(state.artes.months[period.month.key].folder?.name || 'del mes')}`
      : `una carpeta de artes de ${esc(period.month.name.toLowerCase())}`;
    return `
      <div class="ad-top-arte">
        <div class="ad-arte-media is-empty"><span>Sin arte</span></div>
        <div class="ad-arte-body">
          <div class="ad-arte-file">Arte no disponible</div>
          <p class="ad-arte-missing">No hay un archivo «${esc(ad.ad)}» en ${where}. Al subirlo con el nombre del anuncio aparece aquí con su vista previa y sus notas de diseño.</p>
        </div>
      </div>`;
  }

  // ── Anuncios por campaña y conjunto ──
  // Debajo del top 3: cada campaña del periodo con sus conjuntos y, en cada conjunto, sus anuncios con el arte
  // (o un cuadro referencial) y sus cifras. Un anuncio es su nombre dentro del conjunto: sus versiones se suman.
  const bySpend = (a, b) => b.spend - a.spend;
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

  // Resultados con el nombre de lo que mide la campaña o el anuncio ("12 conversaciones", "3 compras").
  const SINGULAR = { compras: 'compra', conversaciones: 'conversación', interacciones: 'interacción', reproducciones: 'reproducción' };
  function resultsText(t, type) {
    if (!(t.results > 0)) return 'Sin resultados';
    let label = resultLabel(type);
    label = label.charAt(0).toLowerCase() + label.slice(1);
    if (Math.round(t.results) === 1) label = label.replace(/^\S+/, w => SINGULAR[w] || w);
    return `${num(t.results)} ${label}`;
  }

  function treeOf(rows) {
    const active = rows.filter(hasActivity);
    return [...groupRows(active, r => r.campaign).entries()].map(([campaign, cRows]) => ({
      campaign, group: cRows[0].group, groupLabel: cRows[0].groupLabel, groupColor: cRows[0].groupColor,
      resultType: dominantType(cRows), ...summarize(cRows),
      adSets: [...groupRows(cRows, r => r.adset).entries()].map(([adset, sRows]) => ({
        adset, resultType: dominantType(sRows), ...summarize(sRows),
        ads: [...groupRows(sRows, r => normalize(r.ad)).values()].map(aRows => ({
          ad: aRows[0].ad, link: aRows.find(r => r.link)?.link || null,
          versions: new Set(aRows.map(r => r.link).filter(Boolean)).size,
          resultType: dominantType(aRows), ...summarize(aRows),
        })).sort((a, b) => b.purchaseValue - a.purchaseValue || b.results - a.results || bySpend(a, b)),
      })).sort(bySpend),
    })).sort(bySpend);
  }

  function adCardHtml(ad, artes) {
    const art = artes.find(x => artKey(x.file) === artKey(ad.ad));
    const media = art
      ? `<div class="ad-arte-media">${arteMedia(art)}</div>`
      : '<div class="ad-arte-media is-empty"><span>Sin arte</span></div>';
    const notes = art?.notes?.length
      ? `<details class="ad-card-notes"><summary>Notas de diseño</summary>${arteNotes(art)}</details>` : '';
    return `
      <article class="ad-card">
        ${media}
        <div class="ad-card-name" title="${esc(ad.ad)}">${adNameLink(ad.ad, ad.link, 'Ver el anuncio en Meta')}</div>
        ${art ? `<div class="ad-card-file">${esc(art.file)}${arteTipo(art)}</div>` : '<div class="ad-card-file" title="No hay un archivo con el nombre del anuncio en la carpeta de artes">Sin arte en Drive</div>'}
        <dl class="ad-card-stats">
          <div><dt>Resultados</dt><dd>${esc(resultsText(ad, ad.resultType))}${ad.costPerResult != null ? `<small>${unitCost(ad.costPerResult)} c/u</small>` : ''}</dd></div>
          <div><dt>Inversión</dt><dd>${money(ad.spend, 2)}${ad.versions > 1 ? `<small>${ad.versions} versiones</small>` : ''}</dd></div>
          ${ad.purchases ? `<div><dt>Ventas</dt><dd>${money(ad.purchaseValue)}<small>${plural(ad.purchases, 'compra', 'compras')} · ROAS ${roasFmt(ad.roas)}</small></dd></div>` : ''}
        </dl>
        ${notes}
      </article>`;
  }

  // Cifras de la cabecera de una campaña o un conjunto, en una línea.
  const treeStats = t => [
    `<b>${money(t.spend, 2)}</b> de inversión`,
    esc(resultsText(t, t.resultType)),
    t.purchases ? `<b>${money(t.purchaseValue)}</b> en ventas · ROAS ${roasFmt(t.roas)}` : '',
  ].filter(Boolean).join(' · ');

  function renderAdTree(period) {
    const host = document.getElementById('ad-meta-tree');
    const tree = treeOf(period.rows);
    if (!tree.length) { host.hidden = true; host.innerHTML = ''; return; }
    const artes = artesOf(period);
    const adSets = tree.reduce((n, c) => n + c.adSets.length, 0);
    const ads = tree.reduce((n, c) => n + c.adSets.reduce((m, s) => m + s.ads.length, 0), 0);
    host.innerHTML = `
      <div class="panel-title">Anuncios por campaña y conjunto | ${esc(period.label)} ${period.year}</div>
      <div class="panel-sub">${plural(tree.length, 'campaña', 'campañas')}, ${plural(adSets, 'conjunto', 'conjuntos')} y ${plural(ads, 'anuncio', 'anuncios')} con gasto en el periodo, de mayor a menor inversión. Cada anuncio muestra su arte de Drive o un cuadro referencial si no lo hay.</div>
      ${tree.map(c => `
        <details class="ad-camp" open style="--gp-row-c:${c.groupColor}">
          <summary class="ad-camp-head">
            <span class="ad-camp-title"><i class="gp-dot-c"></i><span class="ad-camp-name">${esc(c.campaign)}</span><span class="ad-camp-group">${esc(c.groupLabel)}</span></span>
            <span class="ad-camp-stats">${treeStats(c)} · ${plural(c.adSets.length, 'conjunto', 'conjuntos')}</span>
          </summary>
          ${c.adSets.map(s => `
            <section class="ad-set">
              <div class="ad-set-head">
                <span class="ad-set-name">${esc(s.adset || '(sin conjunto)')}</span>
                <span class="ad-set-stats">${plural(s.ads.length, 'anuncio', 'anuncios')} · ${treeStats(s)}</span>
              </div>
              <div class="ad-card-grid">${s.ads.map(a => adCardHtml(a, artes)).join('')}</div>
            </section>`).join('')}
        </details>`).join('')}`;
    host.hidden = false;
  }

  // ── Diversidad creativa por conjunto (al final del módulo) ──
  // La meta del reporte es que cada conjunto cubra las 6 familias creativas. La cobertura se calcula con los anuncios
  // que tienen gasto en el periodo y su clasificación (escrita a mano al revisar cada arte). Cada conjunto marca los
  // formatos que le faltan y trae sugerencias para cubrirlos.
  function coverageOf(adNames, mes, familias) {
    const tags = new Map(Object.entries(mes.anuncios || {}).map(([name, keys]) => [artKey(name), keys]));
    const present = new Map(familias.map(f => [f.key, []]));
    const unclassified = [];
    adNames.forEach(name => {
      const keys = tags.get(artKey(name));
      if (!keys) { unclassified.push(name); return; }
      keys.forEach(k => present.get(k)?.push(name));
    });
    return { present, unclassified };
  }

  const sugerenciaHtml = (p, familia) => `
    <article class="ad-prop">
      <div class="ad-prop-top"><span class="ad-camp-group">${esc(familia?.label || p.familia)}</span><span class="ad-prop-format">${esc(p.formato)}</span></div>
      <div class="ad-prop-title">${esc(p.titulo)}</div>
      <dl class="ad-prop-meta">
        <div><dt>Hipótesis</dt><dd>${esc(p.hipotesis)}</dd></div>
        <div><dt>Métrica</dt><dd>${esc(p.metrica)}</dd></div>
      </dl>
    </article>`;

  // Formatos que le faltan al conjunto para completar la diversidad, con el formato que recomienda el reporte.
  function missingHtml(missing, unmeasured) {
    if (unmeasured) {
      return '<div class="ad-div-missing is-unknown"><b>Formatos que faltan: sin medir.</b> Ningún anuncio de este conjunto tiene arte en Drive; súbelos con el nombre del anuncio para saber qué formatos tiene.</div>';
    }
    if (!missing.length) return '<div class="ad-div-missing is-done"><b>Diversidad creativa completa:</b> el conjunto cubre las 6 familias.</div>';
    return `
      <div class="ad-div-missing">
        <b>Faltan ${missing.length} ${missing.length === 1 ? 'formato' : 'formatos'} para completar la diversidad creativa</b>
        <ul>${missing.map(f => `<li><span>${esc(f.label)}</span>${esc(f.formato || f.que)}</li>`).join('')}</ul>
      </div>`;
  }

  // Un bloque por entrada de sugerencias: uno o varios conjuntos (los que repiten las mismas piezas van juntos).
  function setBlockHtml(sets, entry, mes, familias) {
    const adNames = [...new Set(sets.flatMap(s => s.ads.map(a => a.ad)))];
    const { present, unclassified } = coverageOf(adNames, mes, familias);
    const missing = familias.filter(f => !present.get(f.key).length);
    // Si ningún anuncio tiene arte, la cobertura no se puede medir: no es lo mismo que no cubrir nada.
    const unmeasured = unclassified.length === adNames.length;
    const chips = familias.map(f => {
      const ads = present.get(f.key);
      if (ads.length) return `<span class="ad-fam is-on" title="${esc(`${f.que} Lo cubre: ${ads.join(', ')}`)}">✓ ${esc(f.label)}</span>`;
      return unmeasured
        ? `<span class="ad-fam is-unknown" title="${esc(f.que)}">? ${esc(f.label)}</span>`
        : `<span class="ad-fam" title="${esc(f.que)}">Falta · ${esc(f.label)}</span>`;
    }).join('');
    const famByKey = new Map(familias.map(f => [f.key, f]));
    const names = sets.map(s => s.adset || '(sin conjunto)');
    return `
      <section class="ad-set ad-div-set">
        <div class="ad-set-head">
          <span class="ad-set-name">${esc(names.join(' · '))}</span>
          <span class="ad-set-stats">${unmeasured ? '<b>Cobertura sin medir</b>' : `<b>${familias.length - missing.length} de ${familias.length}</b> familias`}${names.length > 1 ? ` · ${names.length} conjuntos con las mismas piezas` : ''}</span>
        </div>
        <div class="ad-fam-list">${chips}</div>
        ${missingHtml(missing, unmeasured)}
        ${unclassified.length && !unmeasured ? `<p class="ad-div-unclassified">Sin clasificar por falta de arte en Drive: ${esc(unclassified.join(', '))}.</p>` : ''}
        ${entry?.lectura ? `<p class="ad-div-lectura">${esc(entry.lectura)}</p>` : ''}
        ${entry?.propuestas?.length
          ? `<div class="ad-div-sug-head">Sugerencias</div><div class="ad-prop-list">${entry.propuestas.map(p => sugerenciaHtml(p, famByKey.get(p.familia))).join('')}</div>`
          : '<p class="gp-note">Sin sugerencias escritas para este conjunto.</p>'}
      </section>`;
  }

  function renderPropuestas(period) {
    const host = document.getElementById('ad-meta-propuestas');
    const mes = !period.annual && state.propuestas?.months?.[period.month.key];
    if (!mes) { host.hidden = true; host.innerHTML = ''; return; }
    const familias = state.propuestas.familias || [];
    const entries = mes.conjuntos || [];
    const campaigns = treeOf(period.rows).map(c => {
      const sets = new Map(c.adSets.map(s => [normalize(s.adset), s]));
      const used = new Set();
      const blocks = entries.filter(e => normalize(e.campana) === normalize(c.campaign)).map(e => {
        const own = e.conjuntos.map(n => sets.get(normalize(n))).filter(Boolean);
        own.forEach(s => used.add(s));
        return own.length ? setBlockHtml(own, e, mes, familias) : '';
      });
      c.adSets.filter(s => !used.has(s)).forEach(s => blocks.push(setBlockHtml([s], null, mes, familias)));
      return `
        <details class="ad-camp" open style="--gp-row-c:${c.groupColor}">
          <summary class="ad-camp-head">
            <span class="ad-camp-title"><i class="gp-dot-c"></i><span class="ad-camp-name">${esc(c.campaign)}</span><span class="ad-camp-group">${esc(c.groupLabel)}</span></span>
            <span class="ad-camp-stats">${plural(c.adSets.length, 'conjunto', 'conjuntos')}</span>
          </summary>
          ${blocks.join('')}
        </details>`;
    }).join('');
    host.innerHTML = `
      <div class="panel-title">Diversidad creativa por conjunto | ${esc(period.month.name)} ${period.year}</div>
      <div class="panel-sub">Cada conjunto debería cubrir las ${familias.length} familias del ${esc(state.propuestas.fuente || 'reporte de diversidad creativa')}. Se marcan los formatos que faltan y las sugerencias para cubrirlos. Lectura del ${esc(mes.corte)}.</div>
      <ul class="ad-arte-notes ad-div-comment">${(mes.comentario || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      ${campaigns}`;
    host.hidden = false;
  }

  function renderAdsMeta() {
    const title = document.getElementById('ad-meta-period-title');
    if (!meta.latestKey) {
      title.textContent = 'Sin datos de Meta Ads';
      document.getElementById('ad-meta-period-sub').textContent = 'La carpeta Meta Files todavía no tiene exports.';
      return;
    }
    const period = currentPeriod();
    state.month = period.annual ? YEAR_KEY : period.month.key;
    const groups = groupsOf(period.rows);
    const year = viewYear();
    renderMonthTabs('ad-meta-months', {
      year, has: key => Boolean(monthByKey(key)?.hasData), latestKey: meta.latestKey,
      selected: period.month?.key, annual: Boolean(period.annual), yearOk: Boolean(yearPeriod(year)), what: 'export de Meta',
    });
    title.textContent = `Periodo: ${period.label} ${period.year}${period.annual || period.closed ? '' : ' (mes en curso)'}`;
    document.getElementById('ad-meta-period-sub').textContent = period.compare ? `Comparación vs ${period.compare.label}` : period.annual ? 'Acumulado del año: sin periodo anterior para comparar' : 'Sin mes anterior para comparar';
    const ads = adsOf(period.rows);
    document.getElementById('ad-meta-top').innerHTML = topSalesHtml(ads, {
      value: 'purchaseValue', count: 'purchases', spend: 'spend', link: 'link', word: n => (n === 1 ? 'compra' : 'compras'),
      none: 'Ningún anuncio registró compras en el periodo.', arte: a => topArteHtml(a, period),
    });
    renderAdTree(period);
    renderAds(period, groups);
    renderPropuestas(period);
  }

  function renderAdsGoogle() {
    const title = document.getElementById('ad-google-period-title');
    if (!google.latestKey) {
      title.textContent = 'Sin datos de Google Ads';
      document.getElementById('ad-google-period-sub').textContent = 'La carpeta Google Files todavía no tiene informes.';
      return;
    }
    const period = gCurrentPeriod();
    state.month = period.annual ? YEAR_KEY : period.month.key;
    const groups = gGroups(period.months, gCampaigns(period));
    const year = gViewYear();
    renderMonthTabs('ad-google-months', {
      year, has: key => Boolean(gMonthByKey(key)?.hasData), latestKey: google.latestKey,
      selected: period.month?.key, annual: Boolean(period.annual), yearOk: Boolean(gYearPeriod(year)), what: 'informe de Google Ads',
    });
    title.textContent = `Periodo: ${period.detail ? period.detailLabel : period.label} ${period.year}${period.annual || period.closed ? '' : ' (mes en curso)'}`;
    document.getElementById('ad-google-period-sub').textContent = !period.detail
      ? 'Este periodo no tiene informe por día y palabra clave: no hay datos de anuncios.'
      : period.detailCompare ? `Comparación vs ${period.detailCompare.label}` : 'Sin informe por día del mes anterior para comparar';
    const ads = period.detail ? gAds(period.detail) : [];
    // En Google las ventas son el valor de las conversiones del informe por día.
    document.getElementById('ad-google-top').innerHTML = period.detail ? topSalesHtml(ads, {
      value: 'conversionValue', count: 'conversions', spend: 'cost', link: 'url', word: () => 'conv.',
      none: 'Ningún anuncio registró conversiones con valor en el periodo.',
    }) : '';
    renderGoogleAds(period, groups);
  }

  const ADS_RENDER = { meta: renderAdsMeta, google: renderAdsGoogle };

  function showAdsTab(name) {
    if (!ADS_RENDER[name]) name = 'meta';
    adsView.tab = name;
    document.querySelectorAll('#view-ads .ad-tab').forEach(t => {
      const on = t.dataset.adPane === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('#view-ads .ad-pane').forEach(p => { p.hidden = p.id !== 'ad-pane-' + name; });
    try { localStorage.setItem(ADS_TAB_KEY, name); } catch (e) { /* storage bloqueado */ }
    if (!state.loaded) return;
    // Se repinta si el mes cambió desde la última vez (en este módulo o en Gasto publicitario).
    if (isStale('ads-' + name)) {
      markRendered('ads-' + name);
      ADS_RENDER[name]();
    }
  }

  function wireAds() {
    const view = document.getElementById('view-ads');
    const tabs = [...view.querySelectorAll('.ad-tab')];
    tabs.forEach((t, k) => {
      t.querySelector('.gp-tab-ic').style.background = PLATFORMS[t.dataset.adPane].color;
      t.addEventListener('click', () => showAdsTab(t.dataset.adPane));
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        showAdsTab(next.dataset.adPane);
      });
    });
    view.addEventListener('click', e => {
      const tab = e.target.closest('#ad-meta-months .month-tab:not(:disabled), #ad-google-months .month-tab:not(:disabled)');
      if (tab) {
        if (tab.dataset.month === state.month) return;
        setMonth(tab.dataset.month);
        markRendered('ads-' + adsView.tab);
        ADS_RENDER[adsView.tab]();
        return;
      }
      const poster = e.target.closest('.ad-arte-poster');
      if (poster) {
        if (poster.classList.contains('is-carrusel')) pasarLamina(poster);
        else playArte(poster);
        return;
      }
      if (e.target.closest('#gp-ads-density')) { toggleCompact('meta'); return; }
      if (e.target.closest('#gp-ads-expand')) { toggleFullscreen('meta'); return; }
      if (e.target.closest('#gp-g-ads-density')) { toggleCompact('google'); return; }
      if (e.target.closest('#gp-g-ads-expand')) toggleFullscreen('google');
    });
    view.addEventListener('change', e => {
      if (e.target.id === 'gp-ads-group') {
        meta.adsGroup = e.target.value;
        renderAds(currentPeriod());
      } else if (e.target.id === 'gp-g-ads-group') {
        google.adsGroup = e.target.value;
        const period = gCurrentPeriod();
        renderGoogleAds(period, gGroups(period.months, gCampaigns(period)));
      }
    });
    applyCompact('meta');
    applyCompact('google');
  }

  // ════════════════════════════════════════════════════════════
  // Mes compartido, carga y pestañas
  // ════════════════════════════════════════════════════════════
  // El mes elegido vale para Gasto publicitario (Meta y Google) y Anuncios. Cada vista recuerda con qué versión
  // del mes se pintó: al volver a ella se repinta solo si el mes cambió en otra parte.
  function setMonth(value) {
    state.month = value;
    state.monthVersion += 1;
  }
  const markRendered = key => { state.rendered[key] = state.monthVersion; };
  const isStale = key => state.rendered[key] !== state.monthVersion;

  // Datos de una sola vez para los dos módulos, se abra primero el que se abra.
  let ready = null;
  function ensureReady() {
    if (!ready) {
      ready = Promise.all([loadData(), loadArtes(), loadPropuestas()]).then(([data, artes, propuestas]) => {
        state.data = data;
        state.artes = artes;
        state.propuestas = propuestas;
        state.loaded = true;
        buildMetaMonths();
        buildGoogleMonths();
        const months = data?.months || [];
        state.month = months.length ? months[months.length - 1].id : null;
      });
    }
    return ready;
  }

  const RENDER = { meta: renderMeta, google: renderGoogle };

  function showTab(name) {
    if (!RENDER[name]) name = 'meta';
    state.tab = name;
    document.querySelectorAll('#view-rep .gp-tab').forEach(t => {
      const on = t.dataset.pane === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('#view-rep .gp-pane').forEach(p => { p.hidden = p.id !== 'gp-pane-' + name; });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* storage bloqueado */ }

    // Render perezoso: los charts se crean con la pestaña ya visible (y con los datos ya cargados)
    if (!state.loaded) return;
    if (isStale(name)) {
      markRendered(name);
      RENDER[name]();
    } else {
      requestAnimationFrame(() => global.Charts.replay(PANE_CHARTS[name]));
    }
  }

  function wireTabs() {
    const tabs = [...document.querySelectorAll('#view-rep .gp-tab')];
    tabs.forEach((t, k) => {
      // El color de cada plataforma sale de PLATFORMS: el mismo en pestañas, barras y gráficos.
      const cfg = PLATFORMS[t.dataset.pane];
      t.querySelector('.gp-tab-ic').style.background = cfg.color;
      document.getElementById('gp-pane-' + t.dataset.pane).style.setProperty('--gp-c', cfg.color);
      t.addEventListener('click', () => showTab(t.dataset.pane));
      // Flechas izquierda/derecha entre pestañas (patrón ARIA tablist)
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        showTab(next.dataset.pane);
      });
    });
  }

  // Esc y el cambio de módulo cierran la pantalla completa en los dos módulos; una vez para toda la página.
  let shared = false;
  function wireShared() {
    if (shared) return;
    shared = true;
    wireFullscreenExit();
  }

  let started = false;
  async function init() {
    if (started) {
      showTab(state.tab);
      return;
    }
    started = true;
    metaBodyTpl = document.getElementById('gp-meta-body').innerHTML;
    googleBodyTpl = document.getElementById('gp-google-body').innerHTML;
    wireShared();
    wireTabs();
    wireMeta();
    wireGoogle();
    try { state.tab = localStorage.getItem(TAB_KEY) || 'meta'; } catch (e) { /* storage bloqueado */ }
    await ensureReady();
    showTab(state.tab);
  }

  let adsStarted = false;
  async function initAds() {
    if (adsStarted) {
      showAdsTab(adsView.tab);
      return;
    }
    adsStarted = true;
    wireShared();
    wireAds();
    try { adsView.tab = localStorage.getItem(ADS_TAB_KEY) || 'meta'; } catch (e) { /* storage bloqueado */ }
    showAdsTab(adsView.tab);
    await ensureReady();
    showAdsTab(adsView.tab);
  }

  global.Gasto = { init, initAds, load: loadData };
})(window);
