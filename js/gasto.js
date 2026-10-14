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
  const inkColor = '#06132b';
  const TAB_KEY = 'rb-gp-tab';
  const PANE_CHARTS = {
    meta:   ['chart-gp-camp-*'],
    google: ['chart-gp-google-spend'],
  };

  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const AGE_LABELS = { Unknown: 'Sin dato' };
  const GENDER_LABELS = { female: 'Mujeres', male: 'Hombres', unknown: 'Sin dato' };

  const state = { data: null, loaded: false, tab: 'meta', month: null, rendered: {} };

  // ── Formato (mismo criterio que el resto del tablero: "S/. " y es-PE) ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, dec = 0) => n == null || !Number.isFinite(n) ? '—'
    : 'S/. ' + n.toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const moneyShort = v => Math.abs(v) >= 1e3 ? 'S/. ' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : 'S/. ' + Math.round(v);
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
  const shortOf = id => SHORT[+id.slice(5, 7) - 1];

  function deltaPill(cur, prev, { neutral = false } = {}) {
    if (cur == null || !prev) return '';
    const d = (cur - prev) / prev * 100;
    const cls = neutral ? 'gray' : d >= 0 ? 'green' : 'red';
    return `<span class="pill ${cls}">${d >= 0 ? '+' : ''}${pct(d)}</span>`;
  }
  // Mismos umbrales de ROAS que Proyecciones.
  const roasPill = (roas, purchases) => !purchases
    ? '<span class="pill gray">sin compras</span>'
    : `<span class="pill ${roas >= 3 ? 'green' : roas >= 1.5 ? 'amber' : 'red'}">${roasFmt(roas)}</span>`;

  const kpi = ({ label, value, subs = [] }) => `
    <div class="kpi-pill">
      <span>${label}</span>
      <strong>${value}</strong>
      ${subs.filter(Boolean).map(s => `<small>${s}</small>`).join('')}
    </div>`;

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

  const monthsOf = p => (state.data?.months || []).filter(m => m[p]);
  // El mes elegido se comparte entre pestañas; si una plataforma no lo tiene (o Meta está en Anual), muestra su último mes.
  const pickMonth = list => list.find(m => m.id === state.month) || list[list.length - 1];

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

  function monthSelector(hostId, list, selected) {
    const host = document.getElementById(hostId);
    const year = selected.id.slice(0, 4);
    const has = new Set(list.map(m => m.id));
    host.innerHTML = SHORT.map((label, k) => {
      const id = `${year}-${String(k + 1).padStart(2, '0')}`;
      const on = id === selected.id;
      const ok = has.has(id);
      return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}${ok ? '' : ' sin-datos'}" data-id="${id}"
        aria-pressed="${on}"${ok ? '' : ' disabled'} title="${MONTHS[k]} ${year}${ok ? '' : ' · sin datos'}">${label}</button>`;
    }).join('');
    host.querySelectorAll('.proj-mes-btn:not(.sin-datos)').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.id === selected.id) return;
      state.month = btn.dataset.id;
      // La otra pestaña se vuelve a pintar con el mes nuevo cuando se abra.
      state.rendered = { [state.tab]: true };
      RENDER[state.tab]();
    }));
  }

  function periodText(block, m) {
    const c = block.coverage;
    const range = c ? `Del ${fechaCorta(c.start)} al ${fechaCorta(c.end)}` : esc(m.label);
    const partial = c && !c.complete ? ' <span class="pill amber">mes parcial</span>' : '';
    return `${range}${partial} <span class="muted">· ${esc(block.source?.name || '')}</span>`;
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

  // Resalta en el eje X la etiqueta del mes elegido.
  function highlightX(chartId, idx) {
    const chart = global.Charts.getInstance(chartId);
    if (!chart) return;
    chart.options.scales.x.ticks.color = ctx => ctx.index === idx ? inkColor : axisColor;
    chart.options.scales.x.ticks.font = ctx => ({ size: 11, weight: ctx.index === idx ? 700 : 400 });
    chart.update('none');
  }

  function monthlyBarChart(id, list, values, color, footer) {
    global.Charts.mount(id, {
      type: 'bar',
      data: { labels: list.map(m => shortOf(m.id)), datasets: [{ label: 'Inversión', data: values, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 36 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => list[items[0].dataIndex].label,
            label: c => ` Inversión: ${money(c.parsed.y)}`,
            footer: items => footer(list[items[0].dataIndex]),
          } },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { size: 11 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: moneyShort }, grid: { color: gridColor } },
        },
      },
    });
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
    compact: readSetting(ADS_COMPACT_KEY, 'false') === 'true',
    fullscreen: false,
    tabsHome: null,
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
  function renderMetaTabs(period) {
    const host = document.getElementById('gp-meta-months');
    const year = viewYear();
    const annual = Boolean(period?.annual);
    const selected = annual ? null : period?.month.key;
    const yearOk = Boolean(yearPeriod(year));
    keepFocus(host, () => {
      host.innerHTML = MONTHS.map((name, k) => {
        const key = `${year}-${pad(k + 1)}`;
        const ok = Boolean(monthByKey(key)?.hasData);
        const on = key === selected;
        return `<button type="button" class="month-tab${on ? ' active' : ''}" data-month="${key}" aria-pressed="${on}"${ok ? '' : ' disabled title="Sin export de Meta en la carpeta"'}>${name}${key === meta.latestKey ? '<span class="gp-current-dot" title="Último mes con datos"></span>' : ''}</button>`;
      }).join('') + `<button type="button" class="month-tab${annual ? ' active' : ''}" data-month="${YEAR_KEY}" aria-pressed="${annual}" title="${yearOk ? `Acumulado ${year} de los meses con export de Meta` : 'Sin exports de Meta en la carpeta'}"${yearOk ? '' : ' disabled'}>Anual</button>`;
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

  function drawLineChart(id, series, metrics, modeKey) {
    meta.charts.add(id);
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
      body.innerHTML = '<tr><td class="gp-table-empty" colspan="17">No hay anuncios de este grupo en el periodo.</td></tr>';
      return;
    }
    const monthShort = period.month?.shortName.toLowerCase();
    const dateShort = iso => fechaCorta(iso);
    body.innerHTML = rows.map(a => {
      const before = previous.get(a.key);
      let days = '—';
      if (period.annual && a.firstDate) days = a.firstDate === a.lastDate ? dateShort(a.firstDate) : `${dateShort(a.firstDate)} - ${dateShort(a.lastDate)}`;
      else if (!period.annual && a.firstDay) days = a.firstDay === a.lastDay ? `${a.firstDay} ${monthShort}` : `${a.firstDay}-${a.lastDay} ${monthShort}`;
      const link = safeUrl(a.link);
      return `
        <tr style="--gp-row-c:${a.groupColor}">
          <td class="gp-type-col"><span class="gp-group"><i class="gp-dot-c"></i>${esc(a.groupLabel)}</span></td>
          <td class="gp-ad-col" title="${esc(a.ad)}"><span class="gp-ad-text">${a.leader ? '<b class="gp-leader" title="Líder del grupo">★</b> ' : ''}${esc(a.ad)}</span></td>
          <td class="gp-set-col">${esc(a.campaigns.join(' / '))}<small>${esc(a.adSets.join(' / ') || '—')}</small></td>
          <td><span class="gp-result-pill">${esc(a.resultType ? a.resultLabel : groupResult.get(a.group) || a.resultLabel)}</span></td>
          <td class="r mono"><b>${num(a.results)}</b></td>
          <td class="r mono">${before ? num(before.results) : '<span class="gp-no-data">—</span>'}</td>
          <td class="r">${period.compare ? variationCell(a.results, before?.results) : '<span class="gp-no-data">—</span>'}</td>
          <td class="r mono">${unitCost(a.costPerResult)}</td>
          <td class="r mono">${money(a.spend, 2)}</td>
          <td class="r mono">${a.purchases ? num(a.purchases) : '—'}</td>
          <td class="r">${roasPill(a.roas, a.purchases)}</td>
          <td class="r mono">${num(a.impressions)}</td>
          <td class="r mono">${num(a.reach)}</td>
          <td class="r mono">${money(a.cpm, 2)}</td>
          <td class="r mono">${num(a.clicks)}</td>
          <td class="gp-date-col">${days}</td>
          <td>${link ? `<a class="gp-preview" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver anuncio »</a>` : '<span class="gp-no-data">Sin enlace</span>'}</td>
        </tr>`;
    }).join('');
  }

  // ── Herramientas de la tabla de anuncios ──
  function applyAdsCompact() {
    const panel = document.getElementById('gp-ads-panel');
    const button = document.getElementById('gp-ads-density');
    panel.classList.toggle('is-compact', meta.compact);
    button.setAttribute('aria-pressed', String(meta.compact));
    button.textContent = meta.compact ? 'Cómodo' : 'Compacto';
    button.title = meta.compact ? 'Volver a filas amplias' : 'Reducir el alto de las filas';
  }

  function toggleAdsFullscreen(force) {
    const panel = document.getElementById('gp-ads-panel');
    const button = document.getElementById('gp-ads-expand');
    if (!panel || !button) return;
    meta.fullscreen = force == null ? !meta.fullscreen : Boolean(force);
    const tabs = document.getElementById('gp-meta-months');
    const scroll = panel.querySelector('.gp-ads-scroll');
    panel.classList.toggle('is-fullscreen', meta.fullscreen);
    document.body.classList.toggle('gp-table-fullscreen', meta.fullscreen);
    // Las pestañas de mes viajan al panel para poder cambiar de mes sin salir.
    if (meta.fullscreen) {
      meta.tabsHome = { parent: tabs.parentNode, next: tabs.nextSibling };
      panel.insertBefore(tabs, scroll);
    } else if (meta.tabsHome) {
      meta.tabsHome.parent.insertBefore(tabs, meta.tabsHome.next);
      meta.tabsHome = null;
    }
    button.setAttribute('aria-pressed', String(meta.fullscreen));
    button.textContent = meta.fullscreen ? '✕ Salir' : '⤢ Pantalla completa';
    button.title = meta.fullscreen ? 'Salir de pantalla completa (Esc)' : 'Ver la tabla en pantalla completa (Esc para salir)';
    if (meta.fullscreen) scroll.focus();
  }

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
    if (!body.querySelector('#gp-meta-kpis')) { body.innerHTML = metaBodyTpl; applyAdsCompact(); }

    const period = currentPeriod();
    state.month = period.annual ? YEAR_KEY : period.month.key;
    // Los grupos del periodo se calculan una vez para los cuadros, la distribución y los anuncios.
    const groups = groupsOf(period.rows);
    renderMetaTabs(period);
    renderAlerts('gp-meta-alerts', 'meta', period.annual ? { label: String(period.year), warnings: [] } : period.month.raw);
    renderPeriod(period);
    renderKpis(period);
    renderDistribution(period);
    renderCampaigns(period, groups);
    renderAds(period, groups);
    renderFunnelAudience(period);
  }

  // Eventos por delegación en #gp-meta-body: sobreviven a que el estado vacío reemplace su contenido.
  function wireMeta() {
    const body = document.getElementById('gp-meta-body');
    body.addEventListener('click', e => {
      const tab = e.target.closest('#gp-meta-months .month-tab:not(:disabled)');
      if (tab) {
        if (tab.dataset.month === state.month) return;
        state.month = tab.dataset.month;
        // Google Ads se vuelve a pintar con el mes nuevo cuando se abra.
        state.rendered = { meta: true };
        renderMeta();
        return;
      }
      const toggle = e.target.closest('[data-camp-toggle]');
      if (toggle) {
        const key = toggle.closest('.gp-camp-block').dataset.group;
        saveCampaignSettings(key, { collapsed: !campaignSettings(key).collapsed });
        renderCampaignChart(key);
        return;
      }
      if (e.target.closest('#gp-ads-density')) {
        meta.compact = !meta.compact;
        saveSetting(ADS_COMPACT_KEY, meta.compact);
        applyAdsCompact();
        return;
      }
      if (e.target.closest('#gp-ads-expand')) toggleAdsFullscreen();
    });
    body.addEventListener('change', e => {
      if (e.target.id === 'gp-ads-group') {
        meta.adsGroup = e.target.value;
        renderAds(currentPeriod());
        return;
      }
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
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && meta.fullscreen) toggleAdsFullscreen(false);
    });
    // Cambiar de módulo o de pestaña con el panel fijo dejaría la página bloqueada.
    document.querySelectorAll('.s-item, .gp-tab').forEach(btn => btn.addEventListener('click', () => {
      if (meta.fullscreen) toggleAdsFullscreen(false);
    }));
  }

  // ════════════════════════════════════════════════════════════
  // GOOGLE ADS
  // ════════════════════════════════════════════════════════════
  function renderGoogle() {
    const list = monthsOf('google');
    const body = document.getElementById('gp-google-body');
    if (!list.length) { emptyState(body, 'google'); return; }

    const m = pickMonth(list);
    const i = list.indexOf(m);
    const prev = list[i - 1];
    const g = m.google;
    const t = g.totals;
    const pt = prev?.google.totals;
    const partial = !!g.coverage && !g.coverage.complete;
    const vs = prev ? ` vs ${shortOf(prev.id)}` : '';
    const complete = g.campaignsComplete;
    const categories = Object.entries(g.conversionsByCategory || {}).sort((a, b) => b[1] - a[1]);
    const campaigns = g.campaigns.slice().sort((a, b) => (b.purchases || 0) - (a.purchases || 0) || (b.conversions || 0) - (a.conversions || 0));
    const catText = cats => Object.entries(cats || {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${numDec(v)}`).join(' · ') || '—';
    // Las conversiones de Google suman Compra y Contacto (clics a WhatsApp): solo se explican cuando difieren de las compras.
    const contact = categories.find(([k, v]) => /contacto/i.test(k) && v);
    const conversionsNote = t.conversions != null && (t.conversions !== t.purchases || categories.some(([k, v]) => v && !/compra/i.test(k)))
      ? `<p class="gp-note gp-note-top">Conversiones del mes: <b>${numDec(t.conversions)}</b>${categories.length ? ` (${catText(g.conversionsByCategory)})` : ''}.
        ${contact ? 'Contacto son clics a WhatsApp y va aparte: el KPI de conversión es <b>Compras</b>.' : 'El KPI de conversión es <b>Compras</b>.'}</p>`
      : '';

    body.innerHTML = `
      <div class="rep-toolbar">
        <div class="proj-mes-wrap">
          <span class="proj-mes-label">Mes</span>
          <div class="proj-mes-selector" id="gp-google-months" role="group" aria-label="Mes de Google Ads"></div>
        </div>
        <span class="rep-period-meta">${periodText(g, m)}</span>
      </div>
      <div class="rep-stack">
        <div class="gp-alerts" id="gp-google-alerts"></div>
        <div class="kpi-strip gp-kpis">${[
          kpi({ label: 'Inversión', value: money(t.cost),
            subs: [prev ? `${deltaPill(t.cost, pt.cost, { neutral: true })}${vs}` : 'Costo del mes', `CPC ${money(t.cpc, 2)}`] }),
          kpi({ label: 'Compras', value: numDec(t.purchases),
            subs: [prev ? `${deltaPill(t.purchases, pt.purchases, { neutral: partial })}${vs}` : '', `Costo por compra ${money(t.costPerPurchase, 2)}`] }),
          kpi({ label: 'Valor de conversión', value: money(t.conversionValue),
            subs: [prev ? `${deltaPill(t.conversionValue, pt.conversionValue, { neutral: partial })}${vs}` : '', `ROAS ${roasFmt(t.roas)} · atribución de Google`] }),
          kpi({ label: 'CTR', value: pct(t.ctr == null ? null : t.ctr * 100, 2),
            subs: [`${num(t.clicks)} clics · ${num(t.impressions)} impresiones`] }),
        ].join('')}</div>
        ${conversionsNote}
        <div class="grid-2">
          <div class="panel">
            <div class="panel-head"><div>
              <div class="panel-title">Inversión por tipo de campaña</div>
              <div class="panel-sub">Costo, clics y compras del mes · cifras completas</div>
            </div></div>
            <div class="gp-table-wrap"><table class="rep-table">
              <thead><tr><th>Tipo</th><th class="r">Inversión</th><th class="r">Clics</th><th class="r">CTR</th><th class="r">Compras</th><th class="r">ROAS</th></tr></thead>
              <tbody>${g.byType.map(x => {
                const share = (ratio(x.cost, t.cost) || 0) * 100;
                return `<tr>
                  <td><div class="rep-camp-name">${esc(x.type)}</div><div class="rep-bar"><div style="width:${share}%"></div></div></td>
                  <td class="r mono">${money(x.cost)}<span class="sub-val">${pct(share)}</span></td>
                  <td class="r mono">${num(x.clicks)}</td>
                  <td class="r mono">${pct(x.ctr == null ? null : x.ctr * 100, 2)}</td>
                  <td class="r mono">${x.purchases ? numDec(x.purchases) : '—'}</td>
                  <td class="r">${roasPill(x.roas, x.purchases)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div>
              <div class="panel-title">Compras por campaña</div>
              <div class="panel-sub">${complete ? 'Inversión y compras de cada campaña' : 'Compras, valor y conversiones por categoría · sin costo por campaña'}</div>
            </div></div>
            ${campaigns.length ? `<div class="gp-table-wrap"><table class="rep-table">
              <thead><tr><th>Campaña</th>${complete ? '<th class="r">Inversión</th>' : ''}<th class="r">Compras</th><th class="r">Valor</th>${complete ? '<th class="r">ROAS</th>' : '<th class="r">Conversiones</th>'}</tr></thead>
              <tbody>${campaigns.map(c => `<tr>
                <td>${esc(c.campaign)}<span class="sub-val">${esc([c.type, c.status].filter(Boolean).join(' · '))}</span></td>
                ${complete ? `<td class="r mono">${money(c.cost)}</td>` : ''}
                <td class="r mono">${c.purchases ? numDec(c.purchases) : '—'}</td>
                <td class="r mono">${c.conversionValue ? money(c.conversionValue) : '—'}</td>
                ${complete ? `<td class="r">${roasPill(c.roas, c.purchases)}</td>` : `<td class="r gp-cats">${catText(c.conversionsByCategory)}</td>`}
              </tr>`).join('')}</tbody>
            </table></div>` : '<p class="gp-note">El informe de este mes no trae campañas.</p>'}
            ${complete ? '' : `<p class="gp-note">El informe viene segmentado por «${esc(g.segmentation)}»: por campaña solo trae conversiones y su valor. El costo, las impresiones y los clics de cada campaña no se conocen; la inversión completa está en «Inversión por tipo de campaña».</p>`}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div>
            <div class="panel-title">Inversión mensual</div>
            <div class="panel-sub">Costo en Google Ads por mes · el tooltip muestra compras y ROAS · Google llega con un total por mes, sin serie diaria</div>
          </div></div>
          <div class="chart-wrap h-220"><canvas id="chart-gp-google-spend" role="img" aria-label="Inversión mensual en Google Ads"></canvas></div>
        </div>
      </div>`;
    monthSelector('gp-google-months', list, m);
    renderAlerts('gp-google-alerts', 'google', m);

    monthlyBarChart('chart-gp-google-spend', list, list.map(x => x.google.totals.cost), PLATFORMS.google.color, x => {
      const gt = x.google.totals;
      return `Compras: ${numDec(gt.purchases)} · ROAS ${roasFmt(gt.roas)}`;
    });
    highlightX('chart-gp-google-spend', i);
  }

  // ════════════════════════════════════════════════════════════
  // Pestañas
  // ════════════════════════════════════════════════════════════
  const RENDER = { meta: renderMeta, google: renderGoogle };

  function showTab(name) {
    if (!RENDER[name]) name = 'meta';
    state.tab = name;
    document.querySelectorAll('.gp-tab').forEach(t => {
      const on = t.dataset.pane === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.gp-pane').forEach(p => { p.hidden = p.id !== 'gp-pane-' + name; });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* storage bloqueado */ }

    // Render perezoso: los charts se crean con la pestaña ya visible (y con los datos ya cargados)
    if (!state.loaded) return;
    if (!state.rendered[name]) {
      state.rendered[name] = true;
      RENDER[name]();
    } else {
      requestAnimationFrame(() => global.Charts.replay(PANE_CHARTS[name]));
    }
  }

  function wireTabs() {
    const tabs = [...document.querySelectorAll('.gp-tab')];
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

  let started = false;
  async function init() {
    if (started) {
      requestAnimationFrame(() => global.Charts.replay(PANE_CHARTS[state.tab]));
      return;
    }
    started = true;
    metaBodyTpl = document.getElementById('gp-meta-body').innerHTML;
    wireTabs();
    wireMeta();
    applyAdsCompact();
    state.data = await loadData();
    state.loaded = true;
    buildMetaMonths();
    const months = state.data?.months || [];
    state.month = months.length ? months[months.length - 1].id : null;
    try { state.tab = localStorage.getItem(TAB_KEY) || 'meta'; } catch (e) { /* storage bloqueado */ }
    showTab(state.tab);
  }

  global.Gasto = { init, load: loadData };
})(window);
