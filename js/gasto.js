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
  // Ciclo de venta (js/ciclo.js): cada mes va del 27 del anterior al 26. Los informes llegan por mes calendario
  // y aquí se reagrupan por ciclo; la clave de un mes (YYYY-MM) es la de su ciclo y d, el día dentro de él.
  const Ciclo = global.Ciclo;
  const cicloKey = c => `${c.year}-${pad(c.mi + 1)}`;
  const fechaCiclo = (m, d) => Ciclo.fechaDe(m.year, m.month - 1, d);
  // Eje de los gráficos por día: el día del mes de cada fecha del ciclo (27, 28, … 1, 2, …)
  const etiquetasCiclo = m => Array.from({ length: m.daysInMonth }, (_, i) => String(+fechaCiclo(m, i + 1).slice(8)));
  const minIso = (a, b) => (a < b ? a : b);
  const maxIso = (a, b) => (a > b ? a : b);

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

  // Avisos del sync: los de la plataforma en los informes del periodo (raws, los meses de data/ads-2026.json que
  // toca el ciclo), los de su carpeta y lo pendiente.
  function renderAlerts(hostId, p, m, raws = []) {
    const label = PLATFORMS[p].label;
    const own = raws.flatMap(r => {
      const monthPrefix = `${label} ${r.label}: `;
      return (r.warnings || []).filter(w => w.startsWith(monthPrefix)).map(w => (raws.length > 1 ? `${r.label}: ` : '') + w.slice(monthPrefix.length));
    });
    const inMonths = new Set((state.data.months || []).flatMap(x => x.warnings || []));
    const folder = (state.data.warnings || []).filter(w => !inMonths.has(w) && w.startsWith(`${label}: `)).map(w => w.slice(label.length + 2));
    const pending = (state.data.pending || []).filter(w => w.startsWith(`${label}: `)).map(w => w.slice(label.length + 2));
    const host = document.getElementById(hostId);
    host.innerHTML = [
      ...pending.map(w => `<div class="insight warn"><b>Pendiente:</b> ${esc(w)}</div>`),
      own.length ? `<div class="insight warn"><b>Avisos de ${esc(m.label)}</b>
        <ul class="gp-alert-list">${own.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '',
      // Los avisos de la carpeta no son del mes que se está viendo —hablan de archivos sueltos, de
      // duplicados, de nombres que no cuadran— y mezclarlos con los del mes hacía leer como de
      // octubre cosas de enero.
      folder.length ? `<div class="insight warn"><b>Avisos de la carpeta de ${esc(label)}</b>
        <ul class="gp-alert-list">${folder.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '',
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
  // Vistas del gráfico de cada campaña (Meta y Google). Sin "Acumulado del mes": un total corrido siempre sube y
  // hace ver un crecimiento que no hay (una vista guardada en acumulado vuelve a Por día).
  const MODES = [
    { key: 'daily', label: 'Por día' },
    { key: 'monthly', label: 'Por mes' },
  ];
  // Indicadores del gráfico de cada campaña (Resultados toma el nombre del resultado del grupo). Se puede elegir
  // más de uno; por defecto va el resultado junto a la inversión, que es la relación que se quiere leer.
  // tone: el color de su línea cuando los indicadores van juntos en un solo cuadro (si no, todos llevan el del grupo).
  const CAMPAIGN_METRICS = [
    { key: 'results', label: 'Resultados', field: 'results', unit: 'count', tone: '#0F766E' },
    { key: 'spend', label: 'Inversión', field: 'spend', unit: 'money', tone: '#2563EB' },
    { key: 'impressions', label: 'Impresiones', field: 'impressions', unit: 'count', tone: '#EA580C' },
    { key: 'reach', label: 'Alcance', field: 'reach', unit: 'count', tone: '#7C3AED' },
    // Cociente: inversión / resultados sumados del día o del mes; sin resultados queda como hueco.
    { key: 'costPerResult', label: 'Costo por resultado', ratio: ['spend', 'results'], unit: 'money', tone: '#DB2777' },
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

  // Filas de un export de Meta (un mes calendario), con su fecha (day) y el índice del export (raw).
  function metaRows(m, raw) {
    const t = m.meta.table;
    const at = Object.fromEntries(t.columns.map((name, i) => [name, i]));
    return t.rows.map(r => {
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
        raw,
      };
    });
  }

  // Los exports de Meta van por mes calendario y traen cada día: sus filas se reagrupan por el ciclo de venta.
  // parts: cada export que toca el ciclo con la parte de su inversión que cae en él (f); el embudo y el público
  // llegan con un total por mes y se reparten con ella.
  function buildMetaMonths() {
    const raws = (state.data?.months || []).filter(m => m.meta?.table);
    // El export llega hasta coverage.end aunque el último día no tenga gasto.
    const covEnd = raws.map(m => m.meta.coverage?.end).filter(Boolean).sort().pop() || null;
    const rawSpend = raws.map(() => 0);
    const byKey = new Map();
    raws.forEach((m, i) => metaRows(m, i).forEach(r => {
      rawSpend[i] += r.spend;
      const c = Ciclo.mesDe(r.day);
      if (c.dia < 1) return;
      r.d = c.dia;
      const key = cicloKey(c);
      if (!byKey.has(key)) byKey.set(key, { c, rows: [] });
      byKey.get(key).rows.push(r);
    }));
    meta.months = [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, { c, rows }]) => {
      const days = rows.filter(hasActivity).map(r => r.d);
      const firstDay = days.length ? Math.min(...days) : null;
      const lastDay = covEnd && covEnd >= c.inicio ? Ciclo.diasHasta(c.year, c.mi, covEnd) : (days.length ? Math.max(...days) : null);
      const spendIn = raws.map(() => 0);
      rows.forEach(r => { spendIn[r.raw] += r.spend; });
      const parts = raws.map((raw, i) => ({ raw, f: rawSpend[i] ? spendIn[i] / rawSpend[i] : 0, spend: spendIn[i] })).filter(p => p.f > 0);
      return {
        key, label: `${c.mes} ${c.year}`, name: c.mes, shortName: SHORT[c.mi], year: c.year, month: c.mi + 1, daysInMonth: c.dias,
        rows, firstDay, lastDay, hasData: days.length > 0, complete: lastDay === c.dias, parts,
      };
    });
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
  // Tramo de días del ciclo con sus fechas: «27 sep – 13 oct».
  const rangeLabel = (m, from, to) => Ciclo.rango(fechaCiclo(m, from), fechaCiclo(m, to));
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
      label: `${Ciclo.corta(fechaCiclo(first, first.firstDay))} - ${Ciclo.corta(fechaCiclo(last, last.lastDay))}`,
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
      // Abre por día; una vista guardada que ya no existe (el acumulado) también vuelve a Por día.
      mode: MODES.some(m => m.key === saved.mode) ? saved.mode : 'daily',
      collapsed: saved.collapsed === true,
      // Varios indicadores en un solo cuadro (cada uno con su escala) en vez de un panel por indicador.
      combined: saved.combined === true,
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
    // Con compras, Ventas y ROAS van junto al anuncio; el nombre enlaza a la vista previa en Meta.
    const head = [['Anuncio']].concat(commerce ? [['Ventas', true], ['ROAS', true]] : [], manySets ? [['Conjunto']] : [], [['Resultados', true]])
      .concat(compare ? [[`Resultados ${period.compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por resultado', true], ['Inversión', true], ['% de la campaña'], ['Impresiones', true], ['Alcance', true], ['CPM', true], ['Clics', true], ['Días activos']]);
    const body = ads.map((a, k) => {
      const before = previous.get(a.key);
      let days = '—';
      if (a.firstDate) days = Ciclo.rango(a.firstDate, a.lastDate);
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
    const sum = field => rows.reduce((s, r) => s + r[field], 0);
    return metric.ratio ? ratio(sum(metric.ratio[0]), sum(metric.ratio[1])) : sum(metric.field);
  }

  // Valores por día (índice 0 = día 1). Los días posteriores al último dato quedan en null.
  function dailyValues(m, field, group) {
    const values = Array.from({ length: m.daysInMonth }, (_, i) => (m.lastDay && i + 1 <= m.lastDay ? 0 : null));
    m.rows.forEach(r => { if (r.group === group && values[r.d - 1] != null) values[r.d - 1] += r[field]; });
    return values;
  }
  // Cociente día a día de dos series sumadas: un día sin denominador (sin resultados) queda como hueco.
  const divideValues = (nums, dens) => nums.map((n, i) => ratio(n, dens[i]));
  const metricDaily = (m, metric) => (metric.ratio
    ? divideValues(dailyValues(m, metric.ratio[0], metric.group), dailyValues(m, metric.ratio[1], metric.group))
    : dailyValues(m, metric.field, metric.group));
  // Puntos visibles donde hay dato: cada uno lleva su valor (gpValueLabels).
  const dotRadius = (values, size) => values.map(v => (v == null ? 0 : size));

  // Total de cada mes del año, o día a día del mes frente al mes anterior en el mismo día.
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
    const values = metricDaily(m, metric);
    const series = {
      labels: etiquetasCiclo(m),
      datasets: [{ label: compare ? m.name : metric.label, unit: metric.unit, data: values, borderColor: metric.color, backgroundColor: `${metric.color}14`, fill: false, borderWidth: 2.5, pointRadius: dotRadius(values, 2), pointHoverRadius: 4, pointBackgroundColor: metric.color, tension: 0.2, spanGaps: false, valueLabels: true }],
      legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(m.name)} ${m.year}</b></span>`],
    };
    const prev = previousMonth(m);
    if (compare && prev?.hasData) {
      const prevValues = metricDaily(prev, metric).slice(0, m.daysInMonth);
      if (prevValues.some(v => v)) {
        series.datasets.push({ label: prev.name, unit: metric.unit, data: prevValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 });
        series.legend.push(`<span><i class="gp-legend-line dashed" style="color:${PREVIOUS_COLOR}"></i><b>${esc(prev.name)} (mismo día del ciclo)</b></span>`);
      }
    }
    return series;
  }

  // Varios indicadores en un solo cuadro: un color por indicador (tone), sin relleno, y la leyenda con cada color.
  // what: el periodo ("Por día, Octubre 2026"); hint: la nota extra de la leyenda.
  function combinedSeries(metrics, parts, what, hint = '') {
    return {
      labels: parts[0].labels,
      datasets: parts.map((part, i) => ({ ...part.datasets[0], fill: false, yAxisID: `y${i}` })),
      legend: metrics.map(metric => `<span><i class="gp-legend-line" style="background:${metric.tone}"></i><b>${esc(metric.label)}</b></span>`)
        .concat(`<span>${what}. Cada indicador con su escala: compara la forma y lee el valor en el punto.${hint}</span>`),
    };
  }

  // Un indicador: su línea contra el mes anterior. Varios: una línea por indicador, sin comparación, cada una en su
  // propio panel (eje y) para ver cómo se mueve el resultado frente a la inversión sin mezclar escalas; con combined,
  // todas en un solo cuadro con un color cada una.
  function campaignSeries(metrics, modeKey, m, combined = false) {
    if (metrics.length === 1) return lineSeries(metrics[0], modeKey, m);
    const parts = metrics.map(metric => lineSeries(combined ? { ...metric, color: metric.tone } : metric, modeKey, m, false));
    const prev = modeKey === 'monthly' ? null : previousMonth(m);
    const hint = prev?.hasData ? ` Elige uno solo para compararlo con ${esc(prev.name)}.` : '';
    if (combined) return combinedSeries(metrics, parts, modeKey === 'monthly' ? `Por mes, ${viewYear()}` : `Por día, ${esc(m.name)} ${m.year}`, hint);
    const what = modeKey === 'monthly' ? `${metrics.length} indicadores por mes` : `${esc(m.name)} ${m.year}`;
    return {
      labels: parts[0].labels,
      datasets: parts.map((part, i) => ({ ...part.datasets[0], label: metrics[i].label, yAxisID: `y${i}` })),
      legend: [
        `<span><i class="gp-legend-line" style="background:${metrics[0].color}"></i><b>${what}</b></span>`,
        `<span>Cada indicador con su escala.${hint}</span>`,
      ],
    };
  }

  // unitCost: los costos por resultado de centavos llevan más decimales (no quedan en S/. 0.00).
  const formatValue = (unit, v) => (unit === 'money' ? unitCost(v) : num(v));
  const tickValue = (unit, v) => (unit === 'money'
    ? (v === 0 ? 'S/. 0' : `S/. ${Number(v).toLocaleString('es-PE', { maximumFractionDigits: Math.abs(v) >= 10 ? 0 : Math.abs(v) >= 0.1 ? 2 : 3 })}`)
    : Number(v).toLocaleString('es-PE', { notation: Math.abs(v) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));
  // Etiqueta de un punto: soles sin decimales, salvo montos chicos (S/. 0.40 no debe leerse S/. 0).
  const pointText = (unit, v) => (unit === 'money'
    ? (Math.abs(v) >= 10 ? tickValue('money', Math.round(v)) : unitCost(v))
    : Number(v).toLocaleString('es-PE', { notation: Math.abs(v) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));

  // Con un indicador hay un solo eje y; con varios, un eje por indicador apilado en vertical (paneles con su
  // escala) sobre el mismo eje de días. Nunca dos escalas a la vista sobre las mismas líneas: los cruces no
  // significarían nada. En un solo cuadro (combined) cada indicador tiene su escala sin eje visible: el valor va
  // en cada punto.
  function yScales(metrics, combined = false) {
    const base = unit => ({ beginAtZero: true, border: { display: false }, ticks: { color: axisColor, font: { size: 10 }, callback: v => tickValue(unit, v) } });
    if (metrics.length === 1) return { y: { ...base(metrics[0].unit), grace: '12%', grid: { color: gridColor } } };
    if (combined) return Object.fromEntries(metrics.map((metric, i) => [`y${i}`, { display: false, beginAtZero: true, grace: '18%' }]));
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
    // Valor en cada punto (valueLabels), menos los ceros (el punto ya está en la base). Va arriba en un pico y abajo
    // en un valle para no montarse en la línea, con halo blanco. Si choca con otra etiqueta o con el nombre de un
    // panel, o se sale de su panel, prueba el otro lado; si tampoco cabe se omite (queda en el tooltip).
    id: 'gpValueLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const placed = [];
      const overlaps = box => placed.some(o => !(box.right < o.left || box.left > o.right || box.bottom < o.top || box.top > o.bottom));
      ctx.save();
      // Los nombres de los paneles (gpPanelLabels) también ocupan lugar.
      ctx.font = '600 11px Inter, sans-serif';
      Object.values(chart.scales).forEach(scale => {
        const label = scale.options.panelLabel;
        if (!label) return;
        const left = chart.chartArea.left + 4;
        placed.push({ left, right: left + ctx.measureText(label).width + 8, top: scale.top + 2, bottom: scale.top + 18 });
      });
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      chart.data.datasets.forEach((dataset, i) => {
        const points = chart.getDatasetMeta(i);
        if (!dataset.valueLabels || points.hidden) return;
        const scale = chart.scales[points.yAxisID];
        if (!scale) return;
        // Solo el panel de arriba (o el cuadro único) puede usar el margen superior del gráfico.
        const top = scale.top <= chart.chartArea.top + 1 ? chart.chartArea.top - 22 : scale.top;
        ctx.fillStyle = dataset.borderColor;
        points.data.forEach((point, k) => {
          const v = dataset.data[k];
          if (v == null || Number(v) === 0) return;
          const text = pointText(dataset.unit, v);
          const half = ctx.measureText(text).width / 2 + 2;
          const before = dataset.data[k - 1];
          const after = dataset.data[k + 1];
          const valley = before != null && after != null && v < before && v < after;
          const sides = valley ? [point.y + 13, point.y - 12] : [point.y - 12, point.y + 13];
          // Pegada al borde, la etiqueta se corre hacia adentro para no cortarse.
          const x = Math.min(Math.max(point.x, half), chart.width - half);
          const box = sides
            .map(y => ({ y, left: x - half, right: x + half, top: y - 6, bottom: y + 6 }))
            .find(b => b.top >= top && b.bottom <= scale.bottom && !overlaps(b));
          if (!box) return;
          placed.push(box);
          ctx.strokeText(text, x, box.y);
          ctx.fillText(text, x, box.y);
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

  // registry: los gráficos vivos de la pestaña, para destruirlos al repintar. combined: varios indicadores en un
  // solo cuadro.
  function drawLineChart(id, series, metrics, modeKey, registry = meta.charts, combined = false) {
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
          ...yScales(metrics, combined),
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
    return { modes: MODES, modeKey: MODES.some(m => m.key === savedMode) ? savedMode : 'daily' };
  }

  // Botón "Un solo cuadro": aparece con dos o más indicadores marcados, al final de los chips.
  const combineButton = (count, combined) => (count > 1
    ? `<button type="button" class="gp-chip gp-combine${combined ? ' active' : ''}" style="--gp-chip-c:var(--brand)" data-camp-combine aria-pressed="${combined}" title="${combined ? 'Volver a un panel por indicador' : 'Juntar los indicadores en un solo cuadro'}">Un solo cuadro</button>`
    : '');
  // Alto del gráfico: cada panel extra suma alto para que ninguno quede aplastado; en un solo cuadro, algo más de
  // alto para las etiquetas.
  const chartHeight = (count, combined) => (combined ? '380px' : count > 1 ? `${90 + 135 * count}px` : '');

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
    const combined = settings.combined && selected.length > 1;
    keepFocus(block.querySelector('[data-camp-modes]'), () => { block.querySelector('[data-camp-modes]').innerHTML = chipsHtml(modes, modeKey, `gp-camp-mode-${key}`, 'var(--brand)'); });
    keepFocus(block.querySelector('[data-camp-metrics]'), () => { block.querySelector('[data-camp-metrics]').innerHTML = chipsHtml(metrics, settings.metrics, `gp-camp-metric-${key}`, null, true) + combineButton(selected.length, combined); });
    const id = `chart-gp-camp-${key}`;
    if (settings.collapsed) {
      global.Charts.destroy(id);
      meta.charts.delete(id);
      return;
    }
    const series = campaignSeries(selected, modeKey, m, combined);
    block.querySelector('canvas').parentElement.style.height = chartHeight(selected.length, combined);
    block.querySelector('[data-camp-legend]').innerHTML = series.legend.join('');
    drawLineChart(id, series, selected, modeKey, meta.charts, combined);
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
    // Ventas y ROAS van junto al anuncio; el nombre enlaza a la vista previa en Meta.
    body.innerHTML = rows.map(a => {
      const before = previous.get(a.key);
      let days = '—';
      if (a.firstDate) days = Ciclo.rango(a.firstDate, a.lastDate);
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

  // ── Embudo y público ──
  // Impresiones, clics, compras, conversaciones e inversión salen de las filas del periodo (por día, exactas).
  // Visitas a la web, agregados al carrito y pagos iniciados llegan solo con un total por export (mes calendario):
  // cada export entra con la parte de su inversión que cae en el periodo (parts: { raw, f }). Un paso en null en
  // todos los exports = el export no trae la columna.
  function funnelTotals(rows, parts) {
    const t = summarize(rows);
    const prorated = f => {
      const values = parts.map(p => (p.raw.meta.totals[f] == null ? null : p.raw.meta.totals[f] * p.f)).filter(v => v != null);
      return values.length ? values.reduce((s, v) => s + v, 0) : null;
    };
    return {
      impressions: t.impressions, linkClicks: t.clicks, purchases: t.purchases, conversations: t.conversations, spend: t.spend,
      landingViews: prorated('landingViews'), addToCart: prorated('addToCart'), checkouts: prorated('checkouts'),
    };
  }

  function audienceOf(parts) {
    const merge = (field) => {
      const byKey = new Map();
      parts.forEach(({ raw, f }) => (raw.meta.audience?.[field] || []).forEach(item => {
        const prev = byKey.get(item[field]) || { [field]: item[field], spend: 0, purchases: 0, conversations: 0 };
        prev.spend += (item.spend || 0) * f; prev.purchases += (item.purchases || 0) * f; prev.conversations += (item.conversations || 0) * f;
        byKey.set(item[field], prev);
      }));
      return [...byKey.values()];
    };
    return { age: merge('age'), gender: merge('gender') };
  }

  // Exports que toca el periodo, con su parte (en Anual, cada export una vez y entero si cae completo en el año).
  function partsOf(period) {
    if (!period.annual) return period.month.parts;
    const byRaw = new Map();
    period.months.flatMap(m => m.parts).forEach(p => {
      const prev = byRaw.get(p.raw) || { raw: p.raw, f: 0, spend: 0 };
      prev.f += p.f; prev.spend += p.spend;
      byRaw.set(p.raw, prev);
    });
    return [...byRaw.values()];
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
    const parts = partsOf(period);
    const t = funnelTotals(period.rows, parts);
    const repartido = parts.some(p => p.f < 0.999);
    const archivos = parts.map(p => esc(p.raw.meta.source?.name || p.raw.label)).join(' + ');
    const what = period.annual ? `Acumulado ${period.year}` : archivos;
    const nota = repartido ? ' · los totales por mes de cada export se reparten según su inversión en el ciclo' : '';
    document.getElementById('gp-meta-funnel-sub').innerHTML = `De la impresión a la compra · % respecto al paso anterior · ${what}${repartido ? ' · visitas, carrito y pagos repartidos según la inversión de cada export en el ciclo' : ''}`;
    document.getElementById('gp-meta-audience-sub').innerHTML = `Compras e inversión por edad y sexo · ${what}${nota}`;
    renderFunnel(t);
    renderAudience(audienceOf(parts), t.spend);
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
    renderAlerts('gp-meta-alerts', 'meta', { label: period.annual ? String(period.year) : period.month.label }, period.annual ? [] : period.month.parts.map(p => p.raw));
    renderPeriod(period);
    renderKpis(period);
    renderDistribution(period);
    renderCampaigns(period, groups);
    renderFunnelAudience(period);
    renderPresupuesto(period.annual ? null : period.month.key);
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
        return;
      }
      const combine = e.target.closest('[data-camp-combine]');
      if (combine) {
        const key = combine.closest('.gp-camp-block').dataset.group;
        saveCampaignSettings(key, { combined: !campaignSettings(key).combined });
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
  // tone: el color de su línea en un solo cuadro, como en Meta.
  const G_METRICS = [
    { key: 'cost', label: 'Inversión', unit: 'money', daily: 'cost', tone: '#2563EB' },
    { key: 'clicks', label: 'Clics', unit: 'count', daily: 'clicks', tone: '#EA580C' },
    { key: 'purchases', label: 'Compras', dailyLabel: 'Conversiones', unit: 'count', daily: 'conversions', tone: '#0F766E' },
    { key: 'conversionValue', label: 'Valor de conversión', unit: 'money', daily: 'conversionValue', tone: '#7C3AED' },
    { key: 'impressions', label: 'Impresiones', unit: 'count', daily: null, tone: '#CA8A04' },
    // Cociente con los nombres de los KPIs y las tablas: costo por compra por mes y costo por conversión por día (el
    // informe por día no separa las compras). Sale de sumar las dos cifras del día o del mes; sin ellas, hueco.
    { key: 'costPerPurchase', label: 'Costo por compra', dailyLabel: 'Costo por conversión', unit: 'money', ratio: ['cost', 'purchases'], daily: ['cost', 'conversions'], tone: '#DB2777' },
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
  // Sumas que trae el informe por día (no trae impresiones ni compras) y de las que sale cada cociente.
  const G_DAILY_SUMS = ['cost', 'clicks', 'conversions', 'conversionValue'];
  const G_SUM_NAMES = { cost: 'inversión', clicks: 'clics', conversions: 'conversiones', conversionValue: 'valor de conversión' };
  const G_RATE_USES = { ctr: ['clicks', 'impressions'], cpc: ['cost', 'clicks'], costPerConversion: ['cost', 'conversions'], costPerPurchase: ['cost', 'purchases'], roas: ['conversionValue', 'cost'] };
  const gUses = key => G_RATE_USES[key] || [key];
  const listText = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items.join(''));

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

  // Un informe de Google Ads (un mes calendario): sus totales, campañas y tipos, el informe por día si lo trae, y
  // los días que cubre (start-end).
  function normalizeGoogleMonth(m) {
    const g = m.google;
    const [year, month] = m.id.split('-').map(Number);
    const finDeMes = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const cov = g.coverage?.start?.startsWith(m.id) ? g.coverage : null;
    const start = cov ? cov.start : `${m.id}-01`;
    const end = cov && cov.end.startsWith(m.id) ? cov.end : finDeMes;
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
      start, end, totals, campaigns, byType, detail, detailStart: dcov?.start || null, detailEnd: dcov?.end || null,
      conversionsByCategory: g.conversionsByCategory || null, campaignsComplete: g.campaignsComplete, raw: m,
    };
  }

  // Un mes del ciclo de venta con los informes que toca. Google llega con un total por mes, así que cada informe
  // entra con la parte de sus días que cae en el ciclo (f): totales, campañas y tipos son un estimado. El informe
  // por día y palabra clave sí se reagrupa por fecha.
  function googleCycle(c, reports) {
    const parts = reports.map(r => {
      const desde = maxIso(r.start, c.inicio);
      const hasta = minIso(r.end, c.fin);
      return desde > hasta ? null : { r, desde, hasta, f: (Ciclo.entre(desde, hasta) + 1) / (Ciclo.entre(r.start, r.end) + 1) };
    }).filter(Boolean);
    if (!parts.length) return null;
    const scaled = (x, f) => ({ ...x, ...gScale(x, f) });
    const sumBy = (items, keyOf) => {
      const by = new Map();
      items.forEach(x => {
        const key = keyOf(x);
        if (!by.has(key)) by.set(key, { first: x, items: [] });
        by.get(key).items.push(x);
      });
      return [...by.values()].map(({ first, items }) => ({ ...items[items.length - 1], ...first, ...gSum(items), status: items[items.length - 1].status }));
    };
    const campaigns = sumBy(parts.flatMap(p => p.r.campaigns.map(x => scaled(x, p.f))), x => x.name);
    const byType = sumBy(parts.flatMap(p => p.r.byType.map(x => scaled(x, p.f))), x => x.group.key);
    const totals = gSum(parts.map(p => gScale(p.r.totals, p.f)));
    const conversionsByCategory = {};
    parts.forEach(p => Object.entries(p.r.conversionsByCategory || {}).forEach(([k, v]) => { conversionsByCategory[k] = (conversionsByCategory[k] || 0) + (v || 0) * p.f; }));
    const conDetalle = parts.filter(p => p.r.detail);
    const detail = conDetalle.length
      ? conDetalle.flatMap(p => p.r.detail.filter(r => r.day >= c.inicio && r.day <= c.fin).map(r => ({ ...r, d: Ciclo.mesDe(r.day).dia })))
      : null;
    const dia = fecha => Ciclo.entre(c.inicio, fecha) + 1;
    const desde = parts.map(p => p.desde).reduce(minIso);
    const hasta = parts.map(p => p.hasta).reduce(maxIso);
    const dStart = conDetalle.length ? maxIso(c.inicio, conDetalle.map(p => p.r.detailStart).reduce(minIso)) : null;
    const dEnd = conDetalle.length ? minIso(c.fin, conDetalle.map(p => p.r.detailEnd).reduce(maxIso)) : null;
    const firstDay = dia(desde);
    const lastDay = dia(hasta);
    return {
      key: cicloKey(c), label: `${c.mes} ${c.year}`, name: c.mes, shortName: SHORT[c.mi], year: c.year, month: c.mi + 1, daysInMonth: c.dias,
      firstDay, lastDay, complete: firstDay === 1 && lastDay === c.dias, totals, campaigns, byType, detail,
      detailFirst: dStart ? dia(dStart) : null, detailLast: dEnd ? dia(dEnd) : null,
      conversionsByCategory, campaignsComplete: parts.every(p => p.r.campaignsComplete !== false),
      estimated: parts.some(p => p.f < 0.999), raws: parts.map(p => p.r.raw),
      hasData: gActive(totals),
    };
  }

  function buildGoogleMonths() {
    const reports = (state.data?.months || []).filter(m => m.google).map(normalizeGoogleMonth);
    // Ciclos que tocan los informes: el del primer y el del último día de cada uno
    const ciclos = new Map();
    reports.forEach(r => [r.start, r.end].forEach(f => {
      const c = Ciclo.mesDe(f);
      if (c.dia >= 1) ciclos.set(cicloKey(c), c);
    }));
    google.months = [...ciclos.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, c]) => googleCycle(c, reports)).filter(Boolean);
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

  // Tramo real del mes anterior (días from-to) para la cuenta o, con key, para un tipo de campaña: cada suma del
  // informe por día, solo si ese informe está completo para ella, es decir, si en el mes suma lo mismo que el
  // informe de campaña (totals). Cuando Google no detalla los términos con pocas impresiones suma menos y esa suma
  // queda fuera (se prorratea).
  function gTramo(prev, from, to, totals, key = null) {
    const tramo = {};
    if (!prev.detail) return tramo;
    const rows = key ? prev.detail.filter(r => r.group === key) : prev.detail;
    G_DAILY_SUMS.forEach(f => {
      const total = totals[f];
      // En 0 el prorrateo ya da lo mismo (0): no se nombra como tramo real.
      if (total == null || total === 0) return;
      const month = rows.reduce((s, r) => s + r[f], 0);
      if (Math.abs(month - total) > Math.max(0.05, Math.abs(total) * 0.002)) return;
      tramo[f] = rows.filter(r => r.d >= from && r.d <= to).reduce((s, r) => s + r[f], 0);
    });
    return tramo;
  }

  // Mes anterior en un mes en curso: las sumas del tramo real donde las hay y el resto prorrateado (factor); cada
  // cociente, del tramo si sus dos sumas son reales y si no, el del mes anterior completo (no cambia al prorratear).
  function gTramoTotals(totals, factor, tramo) {
    const real = gDerive({ ...gScale(totals, factor), ...tramo });
    const full = gDerive(totals);
    return { ...real, ...Object.fromEntries(Object.entries(G_RATE_USES).map(([k, uses]) => [k, uses.every(f => f in tramo) ? real[k] : full[k]])) };
  }

  // Textos de la comparación de un mes en curso con el tramo dado (el de la cuenta o el de un tipo): label para los
  // subtítulos y shortFor(uses) para cada KPI, el tramo si todas sus sumas son reales y si no, el prorrateo.
  function gCompareText(compare, tramo) {
    const { month: prev, from, to, days } = compare;
    const tramoLabel = rangeLabel(prev, from, to);
    const prorated = `${prev.name} prorrateado a ${days} ${days === 1 ? 'día' : 'días'}`;
    const real = G_DAILY_SUMS.filter(f => f in tramo);
    return {
      label: real.length ? `${tramoLabel} en ${listText(real.map(f => G_SUM_NAMES[f]))} (informe por día); el resto, ${prorated}` : prorated,
      shortFor: uses => (uses.length && uses.every(f => f in tramo) ? tramoLabel : `${prev.shortName} prorrateado`),
    };
  }

  // Mes cerrado: contra el mes anterior completo. Mes en curso: cada suma contra el mismo tramo del mes anterior
  // cuando el informe por día de ese mes la trae completa (inversión, clics, conversiones y valor); las demás
  // (impresiones, compras), contra el mes anterior prorrateado a los mismos días, porque el informe de campaña llega
  // con un total por mes.
  function gPeriodOf(m) {
    if (!m?.hasData) return null;
    const closed = m.complete || m.past;
    const days = m.lastDay - m.firstDay + 1;
    const prev = gPrevious(m);
    let compare = null;
    if (prev?.hasData) {
      const prevDays = prev.lastDay - prev.firstDay + 1;
      const factor = closed ? 1 : Math.min(1, days / prevDays);
      if (factor >= 1) {
        const full = rangeLabel(prev, prev.firstDay, prev.lastDay);
        compare = { month: prev, factor: 1, tramo: {}, label: full, shortFor: () => full };
      } else {
        compare = { month: prev, factor, from: m.firstDay, to: Math.min(m.lastDay, prev.daysInMonth), days };
        compare.tramo = gTramo(prev, compare.from, compare.to, prev.totals);
        Object.assign(compare, gCompareText(compare, compare.tramo));
      }
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
      label: `${Ciclo.corta(fechaCiclo(first, first.firstDay))} - ${Ciclo.corta(fechaCiclo(last, last.lastDay))}`,
      detail: withDetail.length ? withDetail.flatMap(m => m.detail) : null,
      detailLabel: withDetail.length ? withDetail.map(m => m.shortName).join(', ') : null,
    };
  }
  const gAnnualView = () => state.month === YEAR_KEY && Boolean(gYearPeriod(gViewYear()));
  const gCurrentPeriod = () => (gAnnualView() ? gYearPeriod(gViewYear()) : gPeriodOf(gSelectedMonth()));

  const gTotals = period => gDerive(period.annual ? gSum(period.months.map(m => m.totals)) : period.month.totals);
  const gPrevTotals = period => (period.compare ? gTramoTotals(period.compare.month.totals, period.compare.factor, period.compare.tramo) : null);

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
  // totalsOf(key, sums) da las cifras de cada tipo (para el mes anterior, con su tramo; ver renderGoogleCampaigns).
  function gGroups(months, campaigns, totalsOf = (key, sums) => gDerive(sums)) {
    const byKey = new Map();
    months.forEach(m => m.byType.forEach(x => {
      if (!byKey.has(x.group.key)) byKey.set(x.group.key, { ...x.group, items: [] });
      byKey.get(x.group.key).items.push(x);
    }));
    const groups = [...byKey.values()].map(g => ({ ...g, ...totalsOf(g.key, gSum(g.items)) })).filter(gActive);
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
    const c = period.compare;
    const estimado = period.month.estimated
      ? ` · Ciclo ${Ciclo.rangoMes(period.year, period.month.month - 1)}: Google llega con un total por mes calendario y se reparte por día (estimado)` : '';
    sub.textContent = (!c ? 'Sin mes anterior para comparar'
      : c.factor < 1 && !Object.keys(c.tramo).length ? `Comparación vs ${c.label} (Google llega con un total por mes)`
      : `Comparación vs ${c.label}`) + estimado;
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
      // Cada KPI dice contra qué se compara: el tramo real o el mes anterior prorrateado.
      if (previous) line = deltaHtml(current[k.key], previous[k.key], k.better, period.compare.shortFor(gUses(k.key)));
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
    period.months.forEach(m => Object.entries(m.conversionsByCategory || {}).forEach(([k, v]) => { categories[k] = (categories[k] || 0) + (v || 0); }));
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
    const incomplete = period.months.filter(m => m.campaignsComplete === false);
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
      // Como en Meta, abre por día (también una vista guardada en el acumulado, que ya no existe); sin informe por
      // día el cuadro cae a "Por mes".
      mode: MODES.some(m => m.key === saved.mode) ? saved.mode : 'daily',
      collapsed: saved.collapsed === true,
      combined: saved.combined === true,
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
      // En un mes en curso el tramo real es el del tipo (su informe por día puede estar completo o no).
      const label = before && period.compare.factor < 1 ? gCompareText(period.compare, before.tramo).label : period.compare.label;
      comparison = before ? ` vs ${label}` : `. Nuevo: no corría en ${period.compare.month.name}`;
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

  // Serie diaria de un indicador; un cociente (daily = [numerador, denominador]) se divide día a día.
  const gMetricDaily = (m, metric) => (Array.isArray(metric.daily)
    ? divideValues(gDailyValues(m, metric.daily[0], metric.group), gDailyValues(m, metric.daily[1], metric.group))
    : gDailyValues(m, metric.daily, metric.group));

  function gLineSeries(metric, modeKey, m, compare = true) {
    if (modeKey === 'monthly') {
      const year = gViewYear();
      const values = MONTHS.map((_, k) => {
        const month = gMonthByKey(`${year}-${pad(k + 1)}`);
        const items = month?.hasData ? month.byType.filter(x => x.group.key === metric.group) : [];
        if (!items.some(gActive)) return null;
        const sum = field => items.reduce((s, x) => s + (x[field] || 0), 0);
        return metric.ratio ? ratio(sum(metric.ratio[0]), sum(metric.ratio[1])) : sum(metric.key);
      });
      return {
        labels: SHORT,
        datasets: [{ label: metric.label, unit: metric.unit, data: values, borderColor: metric.color, backgroundColor: `${metric.color}1a`, fill: true, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: metric.color, tension: 0.25, spanGaps: false, valueLabels: true }],
        legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(metric.label)} por mes</b></span>`],
      };
    }
    const label = metric.dailyLabel || metric.label;
    const values = gMetricDaily(m, metric);
    const series = {
      labels: etiquetasCiclo(m),
      datasets: [{ label: compare ? m.name : label, unit: metric.unit, data: values, borderColor: metric.color, backgroundColor: `${metric.color}14`, fill: false, borderWidth: 2.5, pointRadius: dotRadius(values, 2), pointHoverRadius: 4, pointBackgroundColor: metric.color, tension: 0.2, spanGaps: false, valueLabels: true }],
      legend: [`<span><i class="gp-legend-line" style="background:${metric.color}"></i><b>${esc(m.name)} ${m.year} · informe por día (${esc(rangeLabel(m, m.detailFirst, m.detailLast))})</b></span>`],
    };
    const prev = gPrevious(m);
    if (compare && prev?.detail) {
      const prevValues = gMetricDaily(prev, metric).slice(0, m.daysInMonth);
      if (prevValues.some(v => v)) {
        series.datasets.push({ label: prev.name, unit: metric.unit, data: prevValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 });
        series.legend.push(`<span><i class="gp-legend-line dashed" style="color:${PREVIOUS_COLOR}"></i><b>${esc(prev.name)} (mismo día del ciclo)</b></span>`);
      }
    } else if (compare) {
      series.legend.push(`<span>${prev ? `${esc(prev.name)} no tiene informe por día para comparar.` : ''}</span>`);
    }
    return series;
  }

  // Como campaignSeries de Meta: un indicador contra el mes anterior, varios en paneles o, con combined, en un
  // solo cuadro.
  function gCampaignSeries(metrics, modeKey, m, combined = false) {
    if (metrics.length === 1) return gLineSeries(metrics[0], modeKey, m);
    const parts = metrics.map(metric => gLineSeries(combined ? { ...metric, color: metric.tone } : metric, modeKey, m, false));
    if (combined) {
      return combinedSeries(metrics, parts, modeKey === 'monthly'
        ? `Por mes, ${gViewYear()}`
        : `Por día, ${esc(m.name)} ${m.year} · informe por día (${esc(rangeLabel(m, m.detailFirst, m.detailLast))})`);
    }
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
    const combined = settings.combined && selected.length > 1;
    keepFocus(metricsHost, () => { metricsHost.innerHTML = chipsHtml(metrics, selected.map(x => x.key), `gp-gcamp-metric-${key}`, null, true) + combineButton(selected.length, combined); });
    const id = `chart-gp-gcamp-${key}`;
    if (settings.collapsed) {
      global.Charts.destroy(id);
      google.charts.delete(id);
      return;
    }
    const series = gCampaignSeries(selected, modeKey, m, combined);
    block.querySelector('canvas').parentElement.style.height = chartHeight(selected.length, combined);
    block.querySelector('[data-camp-legend]').innerHTML = series.legend.join('');
    drawLineChart(id, series, selected, modeKey, google.charts, combined);
  }

  function renderGoogleCampaigns(period, groups) {
    google.charts.forEach(id => global.Charts.destroy(id));
    google.charts.clear();
    // Cada tipo del mes anterior con la misma regla que el total, pero con el tramo de su propio informe por día.
    const c = period.compare;
    const previous = c ? gGroups([c.month], c.month.campaigns, (key, sums) => {
      const tramo = c.factor < 1 ? gTramo(c.month, c.from, c.to, sums, key) : {};
      return { ...gTramoTotals(sums, c.factor, tramo), tramo };
    }) : [];
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
    renderAlerts('gp-google-alerts', 'google', { label: period.annual ? String(period.year) : period.month.label }, period.annual ? [] : period.month.raws);
    renderGooglePeriod(period);
    renderGoogleKpis(period);
    renderGoogleDistribution(period);
    renderGoogleCampaigns(period, groups);
    renderGoogleTerms(period);
    renderPresupuesto(period.annual ? null : period.month.key);
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
        return;
      }
      const combine = e.target.closest('[data-camp-combine]');
      if (combine) {
        const key = combine.closest('.gp-camp-block').dataset.group;
        gSaveCampaignSettings(key, { combined: !gCampaignSettings(key).combined });
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

  function adCardHtml(ad, artes, div) {
    const art = artes.find(x => artKey(x.file) === artKey(ad.ad));
    // Familias creativas que cubre la pieza, según la clasificación del mes.
    const fams = (div?.tags.get(artKey(ad.ad)) || []).map(k => div.famByKey.get(k)?.label).filter(Boolean);
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
        ${fams.length ? `<div class="ad-card-fam" title="Familias de diversidad creativa que cubre">${esc(fams.join(' · '))}</div>` : ''}
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
    const div = diversityOf(period);
    const adSets = tree.reduce((n, c) => n + c.adSets.length, 0);
    const ads = tree.reduce((n, c) => n + c.adSets.reduce((m, s) => m + s.ads.length, 0), 0);
    host.innerHTML = `
      <div class="panel-title">Anuncios por campaña y conjunto | ${esc(period.label)} ${period.year}</div>
      <div class="panel-sub">${plural(tree.length, 'campaña', 'campañas')}, ${plural(adSets, 'conjunto', 'conjuntos')} y ${plural(ads, 'anuncio', 'anuncios')} con gasto en el periodo, de mayor a menor inversión. Cada anuncio muestra su arte de Drive o un cuadro referencial si no lo hay${div ? `, y cada conjunto el checklist de las ${div.familias.length} familias de diversidad creativa` : ''}.</div>
      ${div?.mes.comentario?.length ? `
        <details class="ad-div-note">
          <summary>Lectura de diversidad creativa · ${esc(div.mes.corte)}</summary>
          <ul class="ad-arte-notes">${div.mes.comentario.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </details>` : ''}
      ${tree.map(c => `
        <details class="ad-camp" open style="--gp-row-c:${c.groupColor}">
          <summary class="ad-camp-head">
            <span class="ad-camp-title"><i class="gp-dot-c"></i><span class="ad-camp-name">${esc(c.campaign)}</span><span class="ad-camp-group">${esc(c.groupLabel)}</span></span>
            <span class="ad-camp-stats">${treeStats(c)} · ${plural(c.adSets.length, 'conjunto', 'conjuntos')}</span>
          </summary>
          ${c.adSets.map(s => {
            const cov = div && coverageOf(s, c, div);
            return `
            <section class="ad-set">
              <div class="ad-set-head">
                <span class="ad-set-name">${esc(s.adset || '(sin conjunto)')}</span>
                <span class="ad-set-stats">${plural(s.ads.length, 'anuncio', 'anuncios')} · ${treeStats(s)}${cov ? ` · ${cov.unmeasured ? 'diversidad sin medir' : `<b>${cov.done} de ${div.familias.length}</b> familias`}` : ''}</span>
              </div>
              <div class="ad-card-grid">${s.ads.map(a => adCardHtml(a, artes, div)).join('')}</div>
              ${cov ? checklistHtml(cov, div) : ''}
            </section>`;
          }).join('')}
        </details>`).join('')}`;
    host.hidden = false;
  }

  // ── Diversidad creativa dentro de cada conjunto ──
  // La meta del reporte es que cada conjunto cubra las 6 familias creativas. La cobertura se calcula con los anuncios
  // que tienen gasto en el periodo y su clasificación (escrita a mano al revisar cada arte). Cada conjunto lleva un
  // checklist: las familias que ya cubre y los artes que faltan, con la sugerencia escrita para cubrirlos.
  function diversityOf(period) {
    const mes = !period.annual && state.propuestas?.months?.[period.month.key];
    if (!mes) return null;
    const familias = state.propuestas.familias || [];
    return {
      mes, familias,
      famByKey: new Map(familias.map(f => [f.key, f])),
      tags: new Map(Object.entries(mes.anuncios || {}).map(([name, keys]) => [artKey(name), keys])),
    };
  }

  function coverageOf(s, c, div) {
    const { familias, tags } = div;
    const present = new Map(familias.map(f => [f.key, []]));
    const unclassified = [];
    s.ads.forEach(({ ad }) => {
      const keys = tags.get(artKey(ad));
      if (!keys) { unclassified.push(ad); return; }
      keys.forEach(k => present.get(k)?.push(ad));
    });
    const entry = (div.mes.conjuntos || []).find(e => normalize(e.campana) === normalize(c.campaign)
      && e.conjuntos.some(n => normalize(n) === normalize(s.adset)));
    return {
      present, unclassified, entry,
      done: familias.filter(f => present.get(f.key).length).length,
      // Si ningún anuncio tiene arte, la cobertura no se puede medir: no es lo mismo que no cubrir nada.
      unmeasured: unclassified.length === s.ads.length,
    };
  }

  // Checklist del conjunto: primero los artes que faltan (con el formato que pide el reporte y la idea escrita para
  // cubrirlos), después las familias ya cubiertas. La lectura y las hipótesis quedan plegadas.
  function checklistHtml(cov, div) {
    const { familias } = div;
    const props = cov.entry?.propuestas || [];
    const missing = familias.length - cov.done;
    const head = cov.unmeasured ? 'Diversidad sin medir: ningún anuncio de este conjunto tiene arte en Drive'
      : missing ? `${missing === 1 ? 'Falta 1 arte' : `Faltan ${missing} artes`} para la diversidad creativa`
        : 'Diversidad creativa completa';
    const items = [...familias].sort((a, b) => cov.present.get(a.key).length - cov.present.get(b.key).length).map(f => {
      const ads = cov.present.get(f.key);
      const on = ads.length > 0;
      const detail = on ? `Lo cubre: ${ads.join(', ')}` : cov.unmeasured ? f.que : (f.formato || f.que);
      return `
        <li class="ad-check${on ? ' is-on' : ''}${cov.unmeasured ? ' is-unknown' : ''}">
          <span class="ad-check-box" aria-hidden="true">${on ? '✓' : cov.unmeasured ? '?' : ''}</span>
          <div>
            <span class="ad-check-label"><span class="sr-only">${on ? 'Cubierta' : cov.unmeasured ? 'Sin medir' : 'Falta'}: </span>${esc(f.label)}</span>
            <small>${esc(detail)}</small>
            ${props.filter(p => p.familia === f.key).map(p => `<small class="ad-check-idea">Idea: <b>${esc(p.titulo)}</b> · ${esc(p.formato)}</small>`).join('')}
          </div>
        </li>`;
    }).join('');
    const why = cov.entry?.lectura || props.length ? `
      <details class="ad-check-more">
        <summary>Lectura e hipótesis</summary>
        ${cov.entry?.lectura ? `<p>${esc(cov.entry.lectura)}</p>` : ''}
        ${props.length ? `<ul>${props.map(p => `<li><b>${esc(p.titulo)}</b> · ${esc(p.hipotesis)} <span>Se mide con: ${esc(p.metrica)}.</span></li>`).join('')}</ul>` : ''}
      </details>` : '';
    return `
      <div class="ad-checklist">
        <div class="ad-checklist-head">${esc(head)}</div>
        <ul class="ad-check-list">${items}</ul>
        ${cov.unclassified.length && !cov.unmeasured ? `<p class="ad-check-note">Sin clasificar por falta de arte en Drive: ${esc(cov.unclassified.join(', '))}.</p>` : ''}
        ${why}
      </div>`;
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
        // Abre en el último ciclo con datos (los informes van por mes calendario: el último puede ser de otro ciclo)
        state.month = [meta.latestKey, google.latestKey].filter(Boolean).sort().pop() || null;
      });
    }
    return ready;
  }

  // ── Presupuesto del mes comercial ──
  // Monto mensual por ciclo de venta y plataforma, desde el ciclo de octubre de 2026. El de Meta ya incluye
  // los S/. 1,000 para oportunidades.
  const PRESUPUESTO = { desde: '2026-10', meta: 2880, google: 1500 };

  // key: el mes del periodo que se ve (null en Anual, que no lleva presupuesto).
  function renderPresupuesto(key) {
    const host = document.getElementById('gp-presupuesto');
    if (!host) return;
    if (!key || key < PRESUPUESTO.desde) { host.hidden = true; return; }
    const m = monthByKey(key);
    const g = gMonthByKey(key);
    const [year, month] = key.split('-').map(Number);
    const p = Ciclo.periodo(year, month - 1);
    // Invertido en el ciclo y, si el informe aún no llega al cierre, al mismo ritmo hasta el 26
    // El ritmo se saca sobre los dias que cubre el informe, no sobre los que van de ciclo. La pauta
    // llega por mes de calendario y el ciclo arranca el 27: en octubre el informe empieza el dia 6
    // del ciclo, asi que dividir entre 29 repartia el gasto entre cinco dias de los que no hay dato
    // y la proyeccion salia por debajo de lo que ya se llevaba gastado por dia.
    const plat = (spend, firstDay, lastDay) => {
      const cubiertos = firstDay && lastDay ? lastDay - firstDay + 1 : 0;
      return {
        spend, firstDay, lastDay, cubiertos,
        proj: cubiertos && cubiertos < p.dias ? spend / cubiertos * p.dias : spend,
      };
    };
    const meta = plat(m?.hasData ? summarize(m.rows).spend : 0, m?.firstDay || 0, m?.lastDay || 0);
    const goo = plat(g?.hasData ? g.totals.cost || 0 : 0, g?.firstDay || 0, g?.lastDay || 0);
    const total = PRESUPUESTO.meta + PRESUPUESTO.google;
    // Lo que queda; si ya se pasó, cuánto
    const queda = (spend, budget) => (spend <= budget ? `queda ${money(budget - spend)}` : `<b style="color:var(--red-text)">${money(spend - budget)} por encima</b>`);
    const cerrado = Ciclo.estado(year, month - 1) === 'past';
    const bar = (value, budget) => {
      const r = budget ? value / budget : 0;
      return `<div class="kpi-bar" title="${pct(r * 100, 0)} del presupuesto"><i class="${r > 1 ? 'red' : r >= 0.9 ? 'amber' : 'green'}" style="width:${Math.min(r * 100, 100).toFixed(1)}%"></i></div>`;
    };
    const fechaDia = d => fechaCorta(Ciclo.fechaDe(year, month - 1, d));
    // Si el informe no arranca con el ciclo, se dice el tramo entero: «del 2 al 25 oct». Decir solo
    // «al 25 oct» daba a entender que lo invertido cubria tambien los dias de septiembre del ciclo.
    const tramo = x => (x.firstDay > 1 ? `del ${fechaDia(x.firstDay)} al ${fechaDia(x.lastDay)}` : `al ${fechaDia(x.lastDay)}`);
    const pill = (label, x, budget, nota) => `
      <div class="kpi-pill">
        <span>${label}</span>
        <strong>${money(x.spend)} <small class="muted">de ${money(budget)}</small></strong>
        ${bar(x.spend, budget)}
        <small>${!x.lastDay ? 'Sin informe del ciclo' : `${queda(x.spend, budget)} · ${x.cubiertos < p.dias && !cerrado
          ? `${tramo(x)} · al ritmo cierra en ${money(x.proj)}` : 'ciclo completo'}`}${nota ? ` · ${nota}` : ''}</small>
      </div>`;
    const totalX = {
      spend: meta.spend + goo.spend,
      proj: meta.proj + goo.proj,
      // El total no lleva tramo: cada plataforma puede empezar en un dia distinto (en octubre Meta
      // trae el 27-30 de septiembre y Google no, porque falta su archivo de septiembre). Se dice
      // hasta cuando llega, que es lo unico cierto de las dos, y la proyeccion suma las de cada una.
      firstDay: 1,
      lastDay: Math.min(meta.lastDay || p.dias, goo.lastDay || p.dias),
    };
    totalX.cubiertos = totalX.lastDay - totalX.firstDay + 1;
    host.hidden = false;
    host.innerHTML = `
      <div class="gp-period-head">
        <div class="panel-title">Presupuesto de ${esc(p.mes.toLowerCase())} · ciclo ${Ciclo.rangoMes(year, month - 1)}</div>
        <div class="panel-sub">${money(total)} al mes: ${money(PRESUPUESTO.meta)} Meta Ads (incluye ${money(1000)} para oportunidades) y ${money(PRESUPUESTO.google)} Google Ads. Lo invertido llega hasta el último día de los informes de Drive.</div>
      </div>
      <div class="kpi-strip gp-kpis" role="group" aria-label="Presupuesto del mes">
        ${pill('Meta Ads', meta, PRESUPUESTO.meta)}
        ${pill('Google Ads', goo, PRESUPUESTO.google, g?.estimated ? 'estimado: Google llega por mes calendario' : '')}
        ${pill('Total', totalX, total)}
      </div>`;
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
