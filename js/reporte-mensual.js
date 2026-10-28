/* ============================================================
   reporte-mensual.js — Archivo de Reportes · Generación de Reporte (modelo mensual).
   El reporte del mes del ciclo de venta (27 → 26) con el diseño del PDF «Modelo Reporte Royal Baby»
   de Lima Retail: portada, contenido, resumen y ROAS real por canal, ventas e-commerce, mensajes
   WhatsApp, distribución de la inversión, Google Ads búsqueda, conclusiones y cierre.
   Cada página es una lámina de 1280×720 que se imprime tal cual: «Descargar PDF» abre el diálogo de
   impresión y sale una hoja 16:9 por lámina (css/reporte.css).
   Datos: Meta Ads y Google Ads de data/ads-2026.json (Gasto.load()), la venta real por canal del
   ciclo (data/ventas-2026.json) y los artes de los anuncios (data/artes-2026.json). El periodo corta en
   el último día que traen a la vez Meta y las ventas, para que el ROAS compare los mismos días.
   Los textos (lead, destacado, análisis, conclusiones y próximos pasos) salen propuestos con los
   números y se editan sobre la misma lámina; quedan guardados por mes en este navegador.
   También decide qué reporte se ve en la pestaña: este o el semanal (js/reporte-semanal.js).
   Expone window.ReporteMensual = { init }.
   ============================================================ */

(function (global) {
  const NOTES_KEY = 'rb-rpt-notes-v1';
  const KIND_KEY = 'rb-rpt-kind';
  const CLIENTE = 'Royal Baby';
  const TITULO = 'Reporte Meta + Google Ads';
  const LOGO = 'assets/logo-lr.png';
  const MAX_STEPS = 3;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // Grupos de campaña de Meta (los mismos que Gasto publicitario y el reporte semanal) con el color de la distribución.
  const GROUPS = [
    { key: 'ecommerce', label: 'Ventas E-Commerce', match: /ventas|e-?commerce|catalogo/, color: '#2563eb', role: 'concentra la compra online' },
    { key: 'whatsapp', label: 'Mensajes WhatsApp', match: /whatsapp|mensajes/, color: '#14b8a6', role: 'mueve el showroom y las conversaciones' },
    { key: 'reconocimiento', label: 'Reconocimiento (tienda)', match: /reconocimiento|alcance|notoriedad|branding|thruplay/, color: '#f59e0b', role: 'impulsa la tienda física' },
    { key: 'interaccion', label: 'Interacción', match: /interacci/, color: '#94a3b8', role: 'sostiene la interacción en redes' },
    { key: 'trafico', label: 'Tráfico', match: /trafico/, color: '#6366f1', role: 'lleva tráfico a la web' },
  ];
  const OTHER = { key: 'otras', label: 'Otras campañas', color: '#cbd5e1', role: '' };
  const GOOGLE_TONES = { search: { color: '#0ea5e9', role: 'captura la demanda activa de marca y categoría' }, other: { color: '#a78bfa', role: 'amplía el alcance de Google' } };

  // Los cuatro canales reales de venta y la inversión que los mueve.
  const CANALES = [
    { key: 'tienda', label: 'Tienda física', short: 'la tienda física', col: 'Tienda', color: '#f59e0b', via: 'Campaña Reconocimiento', owns: r => r.group.key === 'reconocimiento' },
    { key: 'showroom', label: 'Outlet (showroom)', short: 'el showroom (outlet)', col: 'Showroom', color: '#22c55e', via: 'Conjunto WhatsApp · outlet', owns: r => r.group.key === 'whatsapp' && isOutlet(r.adset) },
    { key: 'whatsapp', label: 'WhatsApp', short: 'WhatsApp', col: 'WhatsApp', color: '#0ea5e9', via: 'Conjuntos de WhatsApp sin outlet', owns: r => r.group.key === 'whatsapp' && !isOutlet(r.adset) },
    { key: 'web', label: 'Web (e-commerce)', short: 'la web', col: 'Web', color: '#2563eb', via: 'Campaña Ventas E-Commerce', owns: r => r.group.key === 'ecommerce' },
  ];

  const ICONS = {
    pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path>',
    cart: '<circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><path d="M4 22v-7"></path>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>',
    calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>',
    bars: '<path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path>',
    video: '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m10 9 5 3-5 3z"></path>',
    store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path>',
  };
  const icon = name => `<svg class="rpt-ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.bars}</svg>`;

  let ads = null, ventas = null, artes = null;
  let selected = '';
  let kind = '';
  let wired = false;
  let resizer = null;

  // ── Formato (el del modelo: «S/ 3,629», ROAS «20.0», es-PE) ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fin = n => n != null && Number.isFinite(n);
  const money = n => (fin(n) ? 'S/ ' + Math.round(n).toLocaleString('es-PE') : '—');
  const money2 = n => (fin(n) ? 'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const num = n => (fin(n) ? Math.round(n).toLocaleString('es-PE') : '—');
  const dec1 = n => (fin(n) ? n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const pct1 = n => `${dec1(n)}%`;
  const pct0 = n => `${Math.round(n)}%`;
  const ratio = (a, b) => (b ? a / b : null);
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);
  const pad = n => String(n).padStart(2, '0');
  const plural = (n, one, many) => `${num(n)} ${Math.round(n) === 1 ? one : many}`;
  const groupOf = campaign => GROUPS.find(g => g.match.test(norm(campaign))) || OTHER;
  const isOutlet = adset => /outlet/.test(norm(adset));

  // ── Fechas ──
  const corta = iso => `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1]}`;
  const minIso = (...xs) => xs.filter(Boolean).sort()[0];
  const maxIso = (...xs) => xs.filter(Boolean).sort().pop();
  const rango = (a, b, year = true) => {
    const tail = year ? ' ' + b.slice(0, 4) : '';
    if (a === b) return corta(a) + tail;
    return a.slice(5, 7) === b.slice(5, 7) ? `${+a.slice(8, 10)} – ${corta(b)}${tail}` : `${corta(a)} – ${corta(b)}${tail}`;
  };
  const yesterday = () => global.Ciclo.sumarDias(global.Ciclo.hoyLima(), -1);

  // ── Carga ──
  async function json(globalName, file) {
    if (global[globalName]) return global[globalName];
    try {
      const res = await fetch(file, { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch (err) {
      console.warn('[reporte-mensual] no se pudo cargar', file, err);
      return null;
    }
  }
  let loading = null;
  function load() {
    if (!loading) {
      loading = Promise.all([
        global.Gasto?.load() || null,
        json('RB_VENTAS_DATA', 'data/ventas-2026.json'),
        json('RB_ARTES_DATA', 'data/artes-2026.json'),
      ]).then(([a, v, r]) => { ads = a; ventas = v; artes = r; });
    }
    return loading;
  }

  // ── Filas por día ──
  let metaCache = null, googleCache = null;
  function metaRows() {
    if (metaCache) return metaCache;
    metaCache = (ads?.months || []).flatMap(m => {
      const t = m.meta?.table;
      if (!t) return [];
      const at = Object.fromEntries(t.columns.map((c, i) => [c, i]));
      return t.rows.map(r => {
        const campaign = t.campaigns[r[at.campaign]] || '';
        const ad = t.ads[r[at.ad]] || {};
        return {
          day: `${m.id}-${pad(r[at.d])}`, month: m.id, campaign, group: groupOf(campaign),
          adset: t.adsets[r[at.adset]] || 'Sin conjunto', ad: ad.name || '(sin nombre)', link: safeUrl(ad.link),
          spend: r[at.spend] || 0, impressions: r[at.impressions] || 0, clicks: r[at.linkClicks] || 0,
          purchases: r[at.purchases] || 0, value: r[at.purchaseValue] || 0, conversations: r[at.conversations] || 0, results: r[at.results] || 0,
        };
      });
    });
    return metaCache;
  }
  function googleRows() {
    if (googleCache) return googleCache;
    googleCache = (ads?.months || []).flatMap(m => {
      const t = m.google?.detail?.table;
      if (!t) return [];
      const at = Object.fromEntries(t.columns.map((c, i) => [c, i]));
      return t.rows.map(r => {
        const ad = t.ads?.[r[at.ad]] || {};
        return {
          day: `${m.id}-${pad(r[at.d])}`, campaign: t.campaigns[r[at.campaign]] || '',
          adGroup: t.adGroups?.[r[at.adGroup]] || 'Sin grupo', ad: ad.name || null, url: safeUrl(ad.url),
          keyword: t.keywords?.[r[at.keyword]] || null,
          cost: r[at.cost] || 0, impressions: r[at.impressions] || 0, clicks: r[at.clicks] || 0,
          conversions: r[at.conversions] || 0, value: r[at.conversionValue] || 0,
        };
      });
    });
    return googleCache;
  }
  const metaEnd = () => (ads?.months || []).map(m => m.meta?.coverage?.end).filter(Boolean).sort().pop() || '';
  const salesEnd = () => ventas?.fuente2026?.ultimoDia || null;

  // Meses del ciclo con entregas en Meta, del más reciente al más antiguo.
  function periods() {
    const C = global.Ciclo;
    const year = +C.hoyLima().slice(0, 4);
    const rows = metaRows();
    const out = [];
    for (let mi = 0; mi < 12; mi += 1) {
      const p = C.periodo(year, mi);
      if (p.inicio > yesterday()) break;
      const end = minIso(p.fin, metaEnd(), salesEnd(), yesterday());
      if (!end || end < p.inicio) continue;
      if (!rows.some(r => r.day >= p.inicio && r.day <= end && r.spend > 0)) continue;
      out.push({ key: `${year}-${pad(mi + 1)}`, year, mi, mes: p.mes, inicio: p.inicio, fin: p.fin, end, complete: end === p.fin });
    }
    return out.reverse();
  }

  // ── Sumas ──
  function sum(rows) {
    const s = { spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0, conversations: 0 };
    rows.forEach(r => { s.spend += r.spend; s.impressions += r.impressions; s.clicks += r.clicks; s.purchases += r.purchases; s.value += r.value; s.conversations += r.conversations; });
    return s;
  }
  function byKey(rows, keyOf) {
    const map = new Map();
    rows.forEach(r => {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return map;
  }
  // Bloques de 5 días del periodo. Un resto de 1 o 2 días se suma al bloque anterior: solo, hundiría la curva.
  function blocks(per) {
    const C = global.Ciclo;
    const out = [];
    for (let d = per.inicio; d <= per.end; d = C.sumarDias(d, 5)) out.push({ from: d, to: minIso(C.sumarDias(d, 4), per.end) });
    const last = out[out.length - 1];
    if (out.length > 1 && C.entre(last.from, last.to) < 2) out.splice(-2, 2, { from: out[out.length - 2].from, to: last.to });
    return out.map(b => ({ ...b, label: rango(b.from, b.to, false) }));
  }
  const inBlock = (rows, b) => rows.filter(r => r.day >= b.from && r.day <= b.to);
  const argmax = values => values.reduce((best, v, i) => (v > values[best] ? i : best), 0);

  // Venta real del ciclo por columna de la hoja de ventas, hasta el corte del periodo.
  function salesOf(per) {
    const cols = ventas?.daily2026?.[per.mes] || {};
    const days = global.Ciclo.entre(per.inicio, per.end) + 1;
    const out = {};
    Object.keys(cols).forEach(col => { out[col] = (cols[col] || []).slice(0, days).reduce((a, v) => a + (v || 0), 0); });
    return out;
  }

  // Google por campaña: el informe diario por palabra clave donde lo hay; el resto del total mensual, prorrateado por día.
  function googleCampaigns(per) {
    const C = global.Ciclo;
    const det = googleRows().filter(r => r.day >= per.inicio && r.day <= per.end);
    const out = new Map();
    const add = (name, type, x, estimated) => {
      const c = out.get(name) || { name, type, cost: 0, clicks: 0, conversions: 0, estimated: false };
      c.cost += x.cost || 0; c.clicks += x.clicks || 0; c.conversions += x.conversions || 0;
      c.estimated = c.estimated || estimated;
      c.type = c.type || type;
      out.set(name, c);
    };
    (ads?.months || []).forEach(m => {
      const g = m.google;
      if (!g?.coverage?.start) return;
      const detCamps = new Set(g.detail?.table?.campaigns || []);
      det.filter(r => r.day.startsWith(m.id)).forEach(r => add(r.campaign, null, r, false));
      const desde = maxIso(per.inicio, g.coverage.start);
      const hasta = minIso(per.end, g.coverage.end);
      if (desde > hasta) return;
      const f = (C.entre(desde, hasta) + 1) / (C.entre(g.coverage.start, g.coverage.end) + 1);
      (g.campaigns || []).filter(c => !detCamps.has(c.campaign)).forEach(c => add(c.campaign, c.type, { cost: (c.cost || 0) * f, clicks: (c.clicks || 0) * f, conversions: (c.conversions || 0) * f }, true));
    });
    return [...out.values()].filter(c => c.cost > 0).map(c => {
      const search = /b[uú]squeda|search/i.test(`${c.type || ''} ${c.name}`);
      const type = c.type || (search ? 'Búsqueda' : /pmax/i.test(c.name) ? 'Máximo rendimiento' : 'Google Ads');
      return { ...c, type, search, label: `Google · ${type}` };
    }).sort((a, b) => b.cost - a.cost);
  }

  // Artes del periodo para la miniatura de cada anuncio (por nombre de archivo, como en Anuncios).
  const artKey = name => norm(String(name ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\s*\((carrusel|carousel)\)\s*$/i, '')).replace(/[^a-z0-9%]+/g, ' ').trim();
  const driveId = id => (/^[\w-]{20,}$/.test(String(id || '')) ? String(id) : null);
  function arteOf(per, adName) {
    const months = artes?.months || {};
    const keys = [per.end.slice(0, 7), per.inicio.slice(0, 7), ...Object.keys(months).sort().reverse()];
    for (const k of keys) {
      const hit = (months[k]?.artes || []).find(a => artKey(a.file) === artKey(adName));
      if (hit) return hit;
    }
    return null;
  }

  // Los tres anuncios con más resultados (y, a igualdad, más inversión).
  function bestAds(rows, field, per) {
    return [...byKey(rows, r => r.ad).entries()].map(([name, list]) => {
      const s = sum(list);
      const sets = [...byKey(list, r => r.adset).entries()].sort((a, b) => sum(b[1]).spend - sum(a[1]).spend);
      return { name, link: list.find(r => r.link)?.link || null, adset: sets[0]?.[0] || '', ...s, results: s[field], arte: arteOf(per, name) };
    }).filter(a => a.spend > 0).sort((a, b) => b.results - a.results || b.spend - a.spend).slice(0, 3);
  }

  // ── El reporte de un periodo ──
  function build(per) {
    const inP = r => r.day >= per.inicio && r.day <= per.end;
    const meta = metaRows().filter(inP);
    const gDet = googleRows().filter(inP);
    const gCamps = googleCampaigns(per);
    const sales = salesOf(per);
    const bl = blocks(per);
    const metaSpend = sum(meta).spend;
    const googleSpend = gCamps.reduce((a, c) => a + c.cost, 0);
    const totalSpend = metaSpend + googleSpend;

    const canales = CANALES.map(c => {
      const spend = sum(meta.filter(c.owns)).spend;
      const sale = sales[c.col] || 0;
      return { ...c, spend, sale, roas: spend > 0 ? sale / spend : null };
    });
    const ventaReal = canales.reduce((a, c) => a + c.sale, 0);
    const lider = [...canales].sort((a, b) => b.sale - a.sale)[0];
    const fuera = (sales.Instagram || 0) + (sales.Facebook || 0);

    // E-commerce
    const ecoRows = meta.filter(r => r.group.key === 'ecommerce');
    const eco = sum(ecoRows);
    const ecoSets = [...byKey(ecoRows, r => r.adset).entries()].map(([name, list]) => ({ name, ...sum(list) }))
      .filter(s => s.spend > 0).sort((a, b) => b.spend - a.spend);
    const web = canales.find(c => c.key === 'web');
    const ecoSeries = bl.map(b => sum(inBlock(ecoRows, b)).purchases);

    // WhatsApp, por conjunto (el «nuevo número» de un conjunto suma con él)
    const waRows = meta.filter(r => r.group.key === 'whatsapp');
    const wa = sum(waRows);
    const waSets = [...byKey(waRows, r => waKey(r.adset)).entries()].map(([key, list]) => ({ key, ...waNames(list[0].adset, key), ...sum(list) }))
      .filter(s => s.spend > 0 || s.conversations > 0).sort((a, b) => b.conversations - a.conversations);
    const waSeries = bl.map(b => sum(inBlock(waRows, b)).conversations);

    // Distribución
    const dist = [
      ...[...GROUPS, OTHER].map(g => ({ label: g.label, color: g.color, role: g.role, spend: sum(meta.filter(r => r.group === g)).spend, key: g.key })),
      ...gCamps.map(c => ({ label: c.label, color: (c.search ? GOOGLE_TONES.search : GOOGLE_TONES.other).color, role: (c.search ? GOOGLE_TONES.search : GOOGLE_TONES.other).role, spend: c.cost, key: c.search ? 'google' : 'google-otra', estimated: c.estimated })),
    ].filter(d => d.spend > 0).sort((a, b) => b.spend - a.spend);

    // Google búsqueda (informe por palabra clave)
    const gSum = list => list.reduce((a, r) => ({ cost: a.cost + r.cost, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, value: a.value + r.value }), { cost: 0, clicks: 0, conversions: 0, value: 0 });
    const gTot = gSum(gDet);
    const gGroups = [...byKey(gDet, r => r.adGroup).entries()].map(([name, list]) => ({ name, brand: /marca/.test(norm(name)), ...gSum(list) }))
      .filter(g => g.clicks > 0 || g.cost > 0).sort((a, b) => b.clicks - a.clicks);
    const brand = gSum(gDet.filter(r => /marca/.test(norm(r.adGroup))));
    const keywords = [...byKey(gDet.filter(r => r.keyword), r => r.keyword).entries()]
      .map(([name, list]) => ({ name, group: list[0].adGroup, brand: /marca/.test(norm(list[0].adGroup)), ...gSum(list) }))
      .filter(k => k.clicks > 0).sort((a, b) => b.clicks - a.clicks);
    const gAds = [...byKey(gDet.filter(r => r.ad), r => r.ad).entries()]
      .map(([name, list]) => ({ name, url: list.find(r => r.url)?.url || null, ...gSum(list) }))
      .filter(a => a.clicks > 0).sort((a, b) => b.clicks - a.clicks);
    const gDays = [...new Set(gDet.map(r => r.day))].sort();

    return {
      per, bl, meta, metaSpend, googleSpend, totalSpend, canales, ventaReal, lider, fuera,
      eco: { ...eco, sets: ecoSets, series: ecoSeries, web, ads: bestAds(ecoRows, 'purchases', per) },
      wa: { ...wa, sets: waSets, series: waSeries, ads: bestAds(waRows, 'conversations', per),
        canal: canales.find(c => c.key === 'whatsapp'), showroom: canales.find(c => c.key === 'showroom') },
      dist, gCamps,
      google: { ...gTot, groups: gGroups, brand, keywords, ads: gAds, from: gDays[0], to: gDays[gDays.length - 1] },
    };
  }

  const waKey = adset => norm(adset).replace(/\s*-?\s*nuevo\s+numero/g, '').replace(/^whatsapp\s*[-|·:]?\s*/, '').trim() || 'base';
  function waNames(adset, key) {
    if (key === 'base') return { label: 'WhatsApp (base)', short: 'Base' };
    const frag = String(adset).replace(/\s*-?\s*nuevo\s+n[uú]mero/ig, '').replace(/^\s*whatsapp\s*[-|·:]?\s*/i, '').trim();
    const short = frag.charAt(0).toUpperCase() + frag.slice(1);
    return { label: `WhatsApp · ${frag}`, short };
  }

  // ── Textos propuestos (el equipo los reescribe sobre la lámina) ──
  const roasBadge = r => (!fin(r) ? '' : r >= 10 ? '<span class="rpt-badge blue">Retorno alto</span>' : r >= 3 ? '<span class="rpt-badge blue">Rentable</span>' : r >= 1 ? '<span class="rpt-badge">Recupera</span>' : '<span class="rpt-badge rose">Bajo retorno</span>');

  function texts(R) {
    const { per, canales, wa, eco, google, bl } = R;
    const conInv = canales.filter(c => c.spend > 0 && c.roas != null).sort((a, b) => b.roas - a.roas);
    const pierden = conInv.filter(c => c.roas < 1);
    const roasList = conInv.map(c => `${c.short} ${dec1(c.roas)}`).join(', ');
    const waBest = argmax(wa.series);
    const waStart = wa.series.findIndex(v => v > 0);
    const ecoBest = argmax(eco.series);
    const topEcoSet = eco.sets[0];
    const topEcoBuy = [...eco.sets].sort((a, b) => b.purchases - a.purchases)[0];
    const bestEcoAd = eco.ads[0];
    const topWa = wa.sets[0];
    const cheapWa = [...wa.sets].filter(s => s.conversations > 0).sort((a, b) => a.spend / a.conversations - b.spend / b.conversations)[0];
    const outlet = wa.sets.find(s => isOutlet(s.label));
    const bestWaAd = wa.ads[0];
    const gCpc = ratio(google.cost, google.clicks);
    const bCpc = ratio(google.brand.cost, google.brand.clicks);
    const generic = { clicks: google.clicks - google.brand.clicks, cost: google.cost - google.brand.cost };
    const topKw = google.keywords[0];
    const mesTxt = per.mes.toLowerCase();

    const t = {};
    t['p3-lead'] = 'Cuánto se invirtió en Meta y Google, cuánto facturó cada canal real de venta y qué retorno dejó.';
    t['p3-key'] = [
      !conInv.length ? 'Ningún canal tuvo inversión propia en el periodo.'
        : pierden.length ? `${pierden.map(c => c.label).join(' y ')} no ${pierden.length === 1 ? 'recupera' : 'recuperan'} lo invertido (ROAS ${pierden.map(c => dec1(c.roas)).join(' y ')}); el resto devuelve más de lo que cuesta.`
          : `Cada canal es rentable: ${conInv.map(c => `${c.short} devuelve S/ ${dec1(c.roas)} por sol`).join(', ')}.`,
      waStart >= 0 && waStart < waBest
        ? `Las conversaciones de WhatsApp llegaron a ${num(wa.series[waBest])} en el bloque ${bl[waBest].label}, frente a ${num(wa.series[waStart])} ${waStart === 0 ? 'del primero' : `del ${bl[waStart].label}, cuando empezó la entrega`}.`
        : '',
    ].filter(Boolean).join(' ');

    t['p4-lead'] = topEcoSet
      ? `Objetivo de venta online. ${esc(topEcoSet.name)} concentra el ${pct0(pct(topEcoSet.spend, eco.spend))} del presupuesto y ${plural(topEcoSet.purchases, 'compra', 'compras')}; el CPC promedio es ${money2(ratio(eco.spend, eco.clicks))}.`
      : 'Objetivo de venta online: la campaña de ventas web no tuvo entrega en el periodo.';
    t['p4-key'] = topEcoBuy && eco.purchases > 0
      ? `El conjunto ${esc(topEcoBuy.name)} generó ${num(topEcoBuy.purchases)} de las ${num(eco.purchases)} compras con ${num(topEcoBuy.clicks)} clics y CPC ${money2(ratio(topEcoBuy.spend, topEcoBuy.clicks))}; es donde rinde el presupuesto.`
      : `La campaña no registró compras atribuidas en Meta; la venta web real del periodo fue ${money(eco.web.sale)}.`;
    t['p4-an'] = eco.spend > 0 ? [
      `<strong>Qué pasó:</strong> ${eco.purchases > 0 ? `las compras se concentraron en el bloque ${bl[ecoBest].label} (${num(eco.series[ecoBest])} de ${num(eco.purchases)}).` : 'Meta no atribuyó compras a la campaña en el periodo.'}`,
      `La venta web real fue ${money(eco.web.sale)}, ROAS ${dec1(eco.web.roas)} sobre ${money(eco.spend)} de inversión, con ${num(eco.clicks)} clics a la web.`,
      bestEcoAd && bestEcoAd.results > 0 ? `«${esc(bestEcoAd.name)}» es el anuncio con más compras (${num(bestEcoAd.results)}).` : '',
      `<strong>Acción:</strong> ${bestEcoAd ? `crear nuevas variaciones de «${esc(bestEcoAd.name)}»` : 'renovar los anuncios'}${topEcoBuy ? ` y reforzar ${esc(topEcoBuy.name)}` : ''} sobre quienes visitaron la web.`,
    ].filter(Boolean).join(' ') : 'Sin inversión en la campaña de ventas web en este periodo.';

    t['p5-lead'] = topWa
      ? `Conversaciones por conjunto: ${esc(topWa.label)} trae el mayor volumen${outlet && outlet !== topWa ? ' y el de outlet alimenta la venta de showroom' : ''}.`
      : 'La campaña de mensajes no tuvo entrega en el periodo.';
    t['p5-key'] = topWa
      ? `${esc(topWa.label)} trae ${num(topWa.conversations)} conversaciones a ${money2(ratio(topWa.spend, topWa.conversations))} c/u${outlet ? `; el de outlet convierte en la venta de showroom (ROAS ${dec1(wa.showroom.roas)})` : ''}.`
      : 'Sin conversaciones de WhatsApp en el periodo.';
    t['p5-an'] = topWa ? [
      `<strong>Qué pasó:</strong> ${num(wa.conversations)} conversaciones a ${money2(ratio(wa.spend, wa.conversations))} c/u.`,
      `${esc(topWa.label)} lidera en volumen (${num(topWa.conversations)})${cheapWa && cheapWa !== topWa ? ` y ${esc(cheapWa.label)} logra el menor costo (${money2(cheapWa.spend / cheapWa.conversations)})` : ''}.`,
      `La venta por WhatsApp fue ${money(wa.canal.sale)}${wa.canal.roas != null ? ` (ROAS ${dec1(wa.canal.roas)})` : ''} y la de showroom ${money(wa.showroom.sale)}${wa.showroom.roas != null ? ` (ROAS ${dec1(wa.showroom.roas)})` : ''}.`,
      bestWaAd ? `<strong>Acción:</strong> mantener «${esc(bestWaAd.name)}» como motor de conversaciones y sumar variaciones en ${esc((wa.sets[1] || topWa).label)}.` : '',
    ].filter(Boolean).join(' ') : 'Sin inversión en mensajes en este periodo.';

    t['p6-lead'] = 'Cómo se repartió el presupuesto entre campañas de Meta y Google durante el periodo.';
    t['p6-an'] = R.dist.map(d => `<strong>${esc(d.label)}</strong> (${pct0(pct(d.spend, R.totalSpend))})${d.role ? ` ${d.role}` : ''}`).join('. ') + '.';

    t['p7-lead'] = 'La campaña de Search captura a quien ya busca la marca y la categoría, y lleva ese tráfico de alta intención a la web.';
    t['p7-key'] = google.brand.clicks > 0
      ? `La marca capta ${num(google.brand.clicks)} clics a ${money2(bCpc)} y protege el nombre; los términos generales traen ${num(generic.clicks)} clics a ${money2(ratio(generic.cost, generic.clicks))}.`
      : `Search llevó ${num(google.clicks)} clics a la web a ${money2(gCpc)} cada uno.`;
    t['p7-an'] = google.clicks > 0 ? [
      `<strong>Qué pasó:</strong> Google captó ${num(google.clicks)} búsquedas activas y las llevó a la web (CPC ${money2(gCpc)}).`,
      topKw ? `El término con más clics fue «${esc(topKw.name)}» (${num(topKw.clicks)} a ${money2(ratio(topKw.cost, topKw.clicks))}).` : '',
      google.conversions > 0 ? `Registró ${plural(google.conversions, 'conversión', 'conversiones')}${google.value > 0 ? ` por ${money(google.value)}` : ''}.` : '',
      '<strong>Acción:</strong> sostener los términos de marca y reforzar las categorías de mayor intención con páginas de destino específicas.',
    ].filter(Boolean).join(' ') : 'El informe de Google por palabra clave no tiene clics en este periodo.';

    t['p8-lead'] = `Qué funcionó en ${mesTxt} y qué se hará en las próximas semanas.`;
    t['c1-t'] = pierden.length || !conInv.length ? 'Retorno por canal' : 'Cada canal es rentable';
    t['c1-p'] = conInv.length
      ? `ROAS real por canal: ${roasList}. ${R.lider ? `${R.lider.label} concentra el ${pct0(pct(R.lider.sale, R.ventaReal))} de la venta real del periodo.` : ''}`
      : 'Sin inversión asignada a los canales de venta en el periodo.';
    t['c2-t'] = 'WhatsApp mueve showroom y conversaciones';
    t['c2-p'] = topWa
      ? `${num(wa.conversations)} conversaciones a ${money2(ratio(wa.spend, wa.conversations))} c/u. ${esc(topWa.label)} trae el volumen; la venta por WhatsApp fue ${money(wa.canal.sale)} y la de showroom ${money(wa.showroom.sale)}.`
      : 'La campaña de mensajes no tuvo entrega en el periodo.';
    t['c3-t'] = 'Google capta la demanda activa';
    t['c3-p'] = google.clicks > 0
      ? `${num(google.clicks)} clics de búsqueda llevados a la web${bCpc != null ? `; la marca se defiende a ${money2(bCpc)} por clic` : ''}. Se sostendrán los términos de marca y se reforzarán las categorías de mayor intención.`
      : 'Sin clics de búsqueda en el informe del periodo.';
    t.steps = [
      { t: 'Escalar remarketing de ventas web', p: `Crear nuevas variaciones de ${bestEcoAd ? `«${esc(bestEcoAd.name)}» (el de más compras)` : 'los anuncios de venta'} y reforzar el remarketing sobre quienes visitaron la web.` },
      { t: 'Reforzar WhatsApp', p: bestWaAd ? `Mantener «${esc(bestWaAd.name)}» como motor de conversaciones y probar nuevas piezas en ${esc((wa.sets[1] || topWa).label)}.` : 'Retomar la campaña de mensajes con piezas nuevas para el showroom.' },
    ];
    return t;
  }

  // ── Textos guardados ──
  function readNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) { return {}; }
  }
  function writeNotes(notes) {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch (e) { /* sin storage dura hasta recargar */ }
  }
  function saveNote(key, id, value) {
    const notes = readNotes();
    notes[key] = { ...(notes[key] || {}), [id]: value };
    writeNotes(notes);
  }
  // Lo editado se guarda como texto con negritas y saltos de línea, nada más.
  function cleanHtml(node) {
    let out = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) out += esc(n.nodeValue);
      else if (n.nodeType === 1) {
        const tag = n.tagName;
        if (tag === 'BR') out += '<br>';
        else if (tag === 'STRONG' || tag === 'B') out += `<strong>${cleanHtml(n)}</strong>`;
        else if (tag === 'DIV' || tag === 'P') out += (out ? '<br>' : '') + cleanHtml(n);
        else out += cleanHtml(n);
      }
    });
    return out;
  }

  // ── Gráficos (SVG a escala 1:1 con la lámina) ──
  function niceScale(max, steps = 3) {
    const raw = Math.max(max, 1) / steps;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(c => c >= raw);
    return { step: Math.max(step, 1), top: Math.max(step, 1) * Math.ceil(Math.max(max, 1) / Math.max(step, 1)) };
  }
  function box(svg, h) {
    const w = Math.round(svg.clientWidth || svg.parentNode?.clientWidth || 560);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.height = `${h}px`;
    return w;
  }
  function lineChart(svg, { labels, values, h = 150 }) {
    const w = box(svg, h);
    const left = 40, right = 12, top = 26, base = h - 24;
    const sc = niceScale(Math.max(...values, 1));
    const y = v => base - (v / sc.top) * (base - top);
    const band = (w - left - right) / labels.length;
    const x = i => left + band * (i + 0.5);
    const on = argmax(values);
    let out = values.some(v => v > 0) ? `<rect class="c-band" x="${left + band * on + 2}" y="${top - 22}" width="${band - 4}" height="${base - top + 22}" rx="6"></rect>` : '';
    for (let v = sc.step; v <= sc.top; v += sc.step) {
      out += `<line class="c-grid" x1="${left - 4}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"></line><text class="c-tick" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`;
    }
    out += `<line class="c-base" x1="${left - 4}" x2="${w - right}" y1="${base}" y2="${base}"></line>`;
    out += `<path class="c-line" d="${values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}"></path>`;
    values.forEach((v, i) => {
      const a = i === on && v > 0;
      const prev = values[i - 1], next = values[i + 1];
      const peak = v >= Math.max(prev ?? -1, next ?? -1) || y(v) - top > 18;
      const ly = a || peak ? y(v) - 9 : y(v) + 17;
      out += `<circle class="c-point${a ? ' on' : ''}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${a ? 4.5 : 3}"></circle>`;
      out += `<text class="c-value${a ? ' on' : ''}" x="${x(i).toFixed(1)}" y="${Math.min(ly, base - 3).toFixed(1)}" text-anchor="middle">${num(v)}</text>`;
      out += `<text class="c-label${a ? ' on' : ''}" x="${x(i).toFixed(1)}" y="${base + 17}" text-anchor="middle">${esc(labels[i])}</text>`;
    });
    svg.innerHTML = out;
  }
  function barChart(svg, { labels, values, h = 150 }) {
    const w = box(svg, h);
    const left = 40, right = 12, top = 26, base = h - 24;
    const sc = niceScale(Math.max(...values, 1));
    const y = v => base - (v / sc.top) * (base - top);
    const band = (w - left - right) / labels.length;
    const bar = Math.min(56, band * 0.42);
    const on = argmax(values);
    let out = values.some(v => v > 0) ? `<rect class="c-band" x="${left + band * on + 3}" y="${top - 22}" width="${band - 6}" height="${base - top + 22}" rx="6"></rect>` : '';
    for (let v = sc.step; v <= sc.top; v += sc.step) {
      out += `<line class="c-grid" x1="${left - 4}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"></line><text class="c-tick" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`;
    }
    values.forEach((v, i) => {
      const cx = left + band * (i + 0.5);
      const a = i === on && v > 0;
      out += `<rect class="c-bar" x="${cx - bar / 2}" y="${y(v)}" width="${bar}" height="${Math.max(base - y(v), 0)}" rx="3"></rect>`;
      out += `<text class="c-value${a ? ' on' : ''}" x="${cx}" y="${y(v) - 7}" text-anchor="middle">${num(v)}</text>`;
      out += `<text class="c-label${a ? ' on' : ''}" x="${cx}" y="${base + 17}" text-anchor="middle">${esc(labels[i])}</text>`;
    });
    out += `<line class="c-base" x1="${left - 4}" x2="${w - right}" y1="${base}" y2="${base}"></line>`;
    svg.innerHTML = out;
  }
  function donut(svg, { items, center, sub }) {
    const size = 200;
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.style.height = `${size}px`;
    const r = 74, c = 2 * Math.PI * r, total = items.reduce((a, d) => a + d.value, 0) || 1;
    let acc = 0, out = '';
    items.forEach(d => {
      const len = (d.value / total) * c;
      out += `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${d.color}" stroke-width="30" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 100 100)"></circle>`;
      acc += len;
    });
    out += `<text class="c-center" x="100" y="104" text-anchor="middle">${esc(center)}</text><text class="c-center-sub" x="100" y="121" text-anchor="middle">${esc(sub)}</text>`;
    svg.innerHTML = out;
  }

  // ── Piezas de la lámina ──
  const edit = (id, html, tag = 'p', cls = '') => `<${tag} class="${cls}" contenteditable="true" spellcheck="false" data-rpt-edit="${id}" data-placeholder="Escribe el texto">${html}</${tag}>`;
  const metric = (label, value, detail, badge = '') => `
    <div class="rpt-card rpt-metric">
      <div class="rpt-metric-head"><span class="rpt-metric-label">${label}</span>${badge}</div>
      <div class="rpt-metric-value">${value}</div>
      <div class="rpt-metric-detail" title="${esc(String(detail).replace(/<[^>]+>/g, ''))}">${detail}</div>
    </div>`;
  const head = (title, leadId, leadHtml, R) => `
    <div class="rpt-head">
      <div><h1>${title}</h1>${edit(leadId, leadHtml, 'p', 'rpt-lead')}</div>
      ${R ? `<span class="rpt-control">${icon('calendar')}${esc(rango(R.per.inicio, R.per.end))}</span>` : ''}
    </div>`;
  const keyBox = (id, html) => `
    <div class="rpt-key">
      <span class="rpt-key-icon">${icon('bulb')}</span>
      <div><p class="rpt-key-label">Destacado</p>${edit(id, html)}</div>
    </div>`;
  const analysis = (id, html) => `
    <div class="rpt-panel">
      <div class="rpt-panel-head"><div class="rpt-panel-title">${icon('bars')}<strong>Análisis</strong></div></div>
      <div class="rpt-panel-body">${edit(id, html, 'p', 'rpt-text')}</div>
    </div>`;
  const panelHead = (ic, title, sub, right = '') => `
    <div class="rpt-panel-head"><div class="rpt-panel-title">${icon(ic)}<div><strong>${title}</strong>${sub ? `<p class="rpt-small">${sub}</p>` : ''}</div></div>${right}</div>`;
  const chartHead = (title, sub, legend) => `
    <div class="rpt-chart-head">
      <div><strong>${title}</strong><p class="rpt-small">${sub}</p></div>
      <div class="rpt-legend"><span><i class="rpt-dot"></i>${legend}</span><span><i class="rpt-dot band"></i>Mejor</span></div>
    </div>`;

  function adCards(list, unit) {
    if (!list.length) return '<div class="rpt-panel-body"><p>Sin anuncios con entrega en el periodo.</p></div>';
    return `<div class="rpt-ads">${list.map((a, i) => {
      const art = a.arte;
      const id = art ? driveId(art.kind === 'carrusel' && art.slides?.length ? art.slides[0] : art.driveId) : null;
      const kindTxt = art ? (art.kind === 'video' ? 'Video' : art.kind === 'carrusel' ? 'Carrusel' : 'Imagen') : '';
      return `
        <div class="rpt-ad${i === 0 && a.results > 0 ? ' is-on' : ''}">
          <div class="rpt-ad-thumb">${id ? `<img src="https://drive.google.com/thumbnail?id=${id}&amp;sz=w400" alt="" referrerpolicy="no-referrer">` : '<span class="rpt-ad-none">Sin arte en Drive</span>'}${kindTxt ? `<span class="rpt-ad-kind">${kindTxt}</span>` : ''}</div>
          <div class="rpt-ad-body">
            <div class="rpt-ad-name" title="${esc(a.name)}">${esc(a.name)}</div>
            <div class="rpt-ad-set" title="${esc(a.adset)}">${esc(a.adset)}</div>
            <div class="rpt-ad-row"><span>Inversión</span><span>${money(a.spend)}</span></div>
            <div class="rpt-ad-row"><span>Result.</span><b>${plural(a.results, unit[0], unit[1])}</b></div>
            <div class="rpt-ad-row"><span>Costo</span><span>${unit[2](a)}</span></div>
            ${a.link ? `<a class="rpt-ad-link" href="${esc(a.link)}" target="_blank" rel="noopener">Ver anuncio »</a>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // ── Láminas ──
  function pages(R, T) {
    const { per } = R;
    const mesAnio = `${per.mes} ${per.year}`;
    const range = rango(per.inicio, per.end);
    const emitido = global.Ciclo.hoyLima();

    const cover = `
      <section class="rpt-page rpt-cover" data-foot="cover">
        <div class="rpt-main">
          <div class="rpt-brand"><img src="${LOGO}" alt=""><div><strong>Lima Retail</strong><span>Data Driven Marketing</span></div></div>
          <div class="rpt-cover-body">
            <div class="rpt-cover-tags"><span>M</span><span>G</span></div>
            <h1>Reporte de Publicidad</h1>
            <div class="rpt-cover-client">Cliente: <b>${CLIENTE}</b></div>
            <div class="rpt-cover-period"><span>${esc(mesAnio)} · Periodo ${esc(rango(per.inicio, per.end, false))}</span><span>Meta Ads · Google Ads</span></div>
          </div>
          <footer class="rpt-foot"><span>Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics</span><span class="rpt-foot-brand"><img src="${LOGO}" alt=""><strong>Lima Retail</strong>Emitido el ${esc(corta(emitido))}. ${emitido.slice(0, 4)}</span></footer>
        </div>
      </section>`;

    const toc = [
      ['pie', 'Resumen y ROAS por canal', 'Inversión, venta real y retorno de cada canal.', 3],
      ['cart', 'Ventas E-Commerce (web)', 'Embudo, públicos y mejores anuncios de venta.', 4],
      ['chat', 'Mensajes WhatsApp', 'Conversaciones por conjunto: outlet y bautizos.', 5],
      ['pie', 'Distribución de inversión', 'Cómo se repartió el presupuesto por campaña.', 6],
      ['search', 'Google Ads · búsqueda', 'Clics, términos y captura de demanda activa.', 7],
      ['flag', 'Conclusiones', 'Qué funciona y próximos pasos.', 8],
    ];
    const contents = `
      <section class="rpt-page">
        <div class="rpt-main">
          <div class="rpt-head"><div><h1>Contenido del reporte</h1><p class="rpt-lead">Qué encontrarás en cada sección de este informe.</p></div></div>
          <div class="rpt-toc">${toc.map(([ic, name, desc, page], i) => `
            <div class="rpt-card rpt-toc-card">
              <div class="rpt-toc-top"><span class="rpt-toc-icon">${icon(ic)}</span><span class="rpt-toc-num">${pad(i + 1)}</span></div>
              <strong>${name}</strong><p>${desc}</p><em>Página ${pad(page)}</em>
            </div>`).join('')}</div>
          <footer class="rpt-foot"><span>Fuente: Meta Ads + Google Ads · ${esc(range)}</span></footer>
        </div>
      </section>`;

    // 03 · Resumen y ROAS real por canal
    const roasTotal = ratio(R.ventaReal, R.totalSpend);
    const canalRows = R.canales.map(c => `
      <tr class="${c === R.lider ? 'is-on' : ''}">
        <td><strong><i class="rpt-swatch" style="background:${c.color}"></i>${esc(c.label)}</strong><span class="rpt-sub">${esc(c.via)}</span></td>
        <td class="r">${c.spend > 0 ? money(c.spend) : '—'}</td>
        <td class="r"><strong>${money(c.sale)}</strong></td>
        <td class="r"><strong>${c.roas != null ? dec1(c.roas) : '—'}</strong></td>
      </tr>`).join('');
    const resumen = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Resumen y ROAS real por canal', 'p3-lead', T['p3-lead'], R)}
          <div class="rpt-metrics">
            ${metric('Inversión total', money(R.totalSpend), `Meta ${money(R.metaSpend)} · Google ${money(R.googleSpend)}`)}
            ${metric('Venta real', money(R.ventaReal), 'Tienda + web + showroom + WhatsApp')}
            ${metric('ROAS real total', dec1(roasTotal), roasTotal != null ? `S/ ${dec1(roasTotal)} por cada S/ 1 invertido` : 'Sin inversión', roasBadge(roasTotal))}
            ${metric('Canal líder', esc(R.lider?.label || '—'), R.lider ? `${pct0(pct(R.lider.sale, R.ventaReal))} de la venta del periodo` : '')}
          </div>
          <div class="rpt-split">
            <div class="rpt-col">
              <div class="rpt-card rpt-chart-panel">
                ${chartHead('Evolución de conversaciones (WhatsApp)', 'Contactos por bloque de 5 días', 'Conversaciones')}
                <svg class="rpt-chart" data-chart="wa-line" role="img" aria-label="Conversaciones de WhatsApp por bloque de 5 días"></svg>
              </div>
              ${keyBox('p3-key', T['p3-key'])}
            </div>
            <div class="rpt-panel">
              ${panelHead('pie', 'ROAS real por canal', 'Venta real del canal ÷ inversión de su campaña')}
              <table>
                <thead><tr><th>Canal</th><th class="r">Inversión</th><th class="r">Venta real</th><th class="r">ROAS</th></tr></thead>
                <tbody>${canalRows}
                  <tr class="rpt-total"><td>Total venta real · ${R.canales.length} canales</td><td class="r">${money(R.totalSpend)}</td><td class="r">${money(R.ventaReal)}</td><td class="r">${dec1(roasTotal)}</td></tr>
                </tbody>
              </table>
              <div class="rpt-panel-foot">La venta real proviene del cierre por canal del cliente (tienda, web, showroom y WhatsApp), no de la atribución de plataforma. La inversión total incluye Google e Interacción, que no se asignan a un canal.${R.fuera > 0 ? ` Instagram y Facebook (${money(R.fuera)}) no entran en los cuatro canales.` : ''}</div>
            </div>
          </div>
          <footer class="rpt-foot"><span>Fuente: Meta Ads + Google Ads · ${esc(range)} · venta real por canal (cierre del cliente)</span></footer>
        </div>
      </section>`;

    // 04 · Ventas E-Commerce
    const E = R.eco;
    const topBuy = [...E.sets].sort((a, b) => b.purchases - a.purchases)[0];
    const ecoTable = E.sets.slice(0, 4).map(s => `
      <tr class="${s === topBuy && s.purchases > 0 ? 'is-on' : ''}">
        <td class="rpt-name" title="${esc(s.name)}">${esc(s.name)}</td>
        <td class="r">${money(s.spend)}</td><td class="r">${s === topBuy ? `<strong>${num(s.purchases)}</strong>` : num(s.purchases)}</td>
        <td class="r">${money2(ratio(s.spend, s.clicks))}</td>
        <td>${/remarketing/.test(norm(s.name)) ? '<span class="rpt-badge sky">Remarketing</span>' : '<span class="rpt-badge blue">Prospección</span>'}</td>
      </tr>`).join('');
    const ecommerce = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Ventas E-Commerce (web)', 'p4-lead', T['p4-lead'], R)}
          <div class="rpt-metrics cols-5">
            ${metric('Inversión', money(E.spend), 'Campaña de ventas web')}
            ${metric('Compras (Meta)', num(E.purchases), 'Atribución de plataforma')}
            ${metric('Venta web real', money(E.web.sale), 'WooCommerce')}
            ${metric('ROAS web real', dec1(E.web.roas), 'Venta web ÷ inversión', roasBadge(E.web.roas))}
            ${metric('Clics a la web', num(E.clicks), `CTR ${pct1(pct(E.clicks, E.impressions))} · CPC ${money2(ratio(E.spend, E.clicks))}`)}
          </div>
          <div class="rpt-split">
            <div class="rpt-col">
              <div class="rpt-card rpt-chart-panel">
                ${chartHead('Compras por bloque de 5 días', 'Compras atribuidas por Meta a la campaña de ventas web.', 'Compras')}
                <svg class="rpt-chart" data-chart="eco-line" role="img" aria-label="Compras por bloque de 5 días"></svg>
              </div>
              <div class="rpt-panel">
                <table>
                  <thead><tr><th>Público (conjunto)</th><th class="r">Inversión</th><th class="r">Compras</th><th class="r">CPC</th><th>Rol</th></tr></thead>
                  <tbody>${ecoTable || '<tr><td colspan="5">Sin conjuntos con inversión.</td></tr>'}</tbody>
                </table>
              </div>
              ${keyBox('p4-key', T['p4-key'])}
            </div>
            <div class="rpt-col">
              <div class="rpt-panel">
                ${panelHead('cart', 'Mejores anuncios', 'Bajo cada nombre: conjunto · formato arriba')}
                ${adCards(E.ads, ['compra', 'compras', a => `CPC ${money2(ratio(a.spend, a.clicks))}`])}
              </div>
              ${analysis('p4-an', T['p4-an'])}
            </div>
          </div>
          <footer class="rpt-foot"><span>Fuente: Meta Ads · ${esc(range)} · campaña Ventas E-Commerce + venta web real (WooCommerce)</span></footer>
        </div>
      </section>`;

    // 05 · Mensajes WhatsApp
    const W = R.wa;
    const waTable = W.sets.slice(0, 4).map((s, i) => `
      <tr class="${i === 0 && s.conversations > 0 ? 'is-on' : ''}">
        <td class="rpt-name" title="${esc(s.label)}">${esc(s.label)}</td>
        <td class="r">${money(s.spend)}</td><td class="r">${i === 0 ? `<strong>${num(s.conversations)}</strong>` : num(s.conversations)}</td>
        <td class="r">${money2(ratio(s.spend, s.conversations))}</td>
        <td>${isOutlet(s.label) ? '<span class="rpt-badge sky">Showroom</span>' : i === 0 ? '<span class="rpt-badge ok">Más contactos</span>' : /bautiz/.test(norm(s.label)) ? '<span class="rpt-badge amber">Bautizos</span>' : '<span class="rpt-badge blue">WhatsApp</span>'}</td>
      </tr>`).join('');
    const whatsapp = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Mensajes WhatsApp', 'p5-lead', T['p5-lead'], R)}
          <div class="rpt-metrics cols-5">
            ${metric('Inversión', money(W.spend), 'Campaña de mensajes')}
            ${metric('Conversaciones', num(W.conversations), 'Contactos por WhatsApp')}
            ${metric('Costo/conversación', money2(ratio(W.spend, W.conversations)), 'Promedio de la campaña')}
            ${metric('Venta showroom', money(W.showroom.sale), W.showroom.roas != null ? `ROAS ${dec1(W.showroom.roas)}` : 'Sin conjunto de outlet')}
            ${metric('Venta WhatsApp', money(W.canal.sale), W.canal.roas != null ? `ROAS ${dec1(W.canal.roas)}` : 'Sin inversión propia')}
          </div>
          <div class="rpt-split">
            <div class="rpt-col">
              <div class="rpt-card rpt-chart-panel">
                ${chartHead('Conversaciones por conjunto', 'Cada conjunto de la campaña de mensajes.', 'Conversaciones')}
                <svg class="rpt-chart" data-chart="wa-bars" role="img" aria-label="Conversaciones por conjunto"></svg>
              </div>
              <div class="rpt-panel">
                <table>
                  <thead><tr><th>Conjunto</th><th class="r">Inversión</th><th class="r">Conversac.</th><th class="r">Costo/conv.</th><th>Canal</th></tr></thead>
                  <tbody>${waTable || '<tr><td colspan="5">Sin conjuntos con inversión.</td></tr>'}</tbody>
                </table>
              </div>
              ${keyBox('p5-key', T['p5-key'])}
            </div>
            <div class="rpt-col">
              <div class="rpt-panel">
                ${panelHead('chat', 'Mejores anuncios', 'Bajo cada nombre: conjunto · formato arriba')}
                ${adCards(W.ads, ['conv', 'conv', a => money2(ratio(a.spend, a.results))])}
              </div>
              ${analysis('p5-an', T['p5-an'])}
            </div>
          </div>
          <footer class="rpt-foot"><span>Fuente: Meta Ads · ${esc(range)} · campaña Tráfico a Mensajes WhatsApp + venta real por canal</span></footer>
        </div>
      </section>`;

    // 06 · Distribución de inversión
    const share = key => pct(R.dist.filter(d => key(d)).reduce((a, d) => a + d.spend, 0), R.totalSpend);
    const ecoPct = share(d => d.key === 'ecommerce');
    const gPct = share(d => d.key.startsWith('google'));
    const estimated = R.dist.some(d => d.estimated);
    const distribucion = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Distribución de inversión', 'p6-lead', T['p6-lead'], R)}
          <div class="rpt-metrics">
            ${metric('Inversión total', money(R.totalSpend), `${R.dist.length} campañas · Meta + Google`)}
            ${metric('Venta (ventas web)', pct0(ecoPct), 'Campaña Ventas E-Commerce')}
            ${metric('Búsqueda (Google)', pct0(gPct), 'Captura de demanda activa')}
            ${metric('Mensajes + branding', pct0(Math.max(0, 100 - ecoPct - gPct)), 'WhatsApp, reconocimiento, interacción')}
          </div>
          <div class="rpt-panel">
            ${panelHead('pie', 'Inversión por campaña', 'Cada campaña con su participación y función')}
            <div class="rpt-dist">
              <svg class="rpt-chart" data-chart="donut" role="img" aria-label="Participación de cada campaña en la inversión"></svg>
              <table>
                <thead><tr><th>Campaña</th><th class="r">Inversión</th><th class="r">% del total</th></tr></thead>
                <tbody>${R.dist.map(d => `<tr><td><i class="rpt-swatch" style="background:${d.color}"></i>${esc(d.label)}${d.estimated ? ' <span class="rpt-sub" style="display:inline">· estimado</span>' : ''}</td><td class="r">${money(d.spend)}</td><td class="r">${pct1(pct(d.spend, R.totalSpend))}</td></tr>`).join('')}
                  <tr class="rpt-total"><td>Total</td><td class="r">${money(R.totalSpend)}</td><td class="r">100%</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          ${analysis('p6-an', T['p6-an'])}
          <footer class="rpt-foot"><span>Fuente: Meta Ads + Google Ads · ${esc(range)}${estimated ? ' · Google llega con un total por mes: los días sin informe diario se prorratean (estimado)' : ''}</span></footer>
        </div>
      </section>`;

    // 07 · Google Ads búsqueda
    const G = R.google;
    const gCpc = ratio(G.cost, G.clicks);
    const bCpc = ratio(G.brand.cost, G.brand.clicks);
    const kwTable = G.keywords.slice(0, 4).map((k, i) => `
      <tr class="${i === 0 ? 'is-on' : ''}">
        <td class="rpt-name" title="${esc(k.name)}">${esc(k.name)}</td>
        <td class="r">${i === 0 ? `<strong>${num(k.clicks)}</strong>` : num(k.clicks)}</td>
        <td class="r">${money2(ratio(k.cost, k.clicks))}</td>
        <td>${k.brand ? '<span class="rpt-badge sky">Marca</span>' : '<span class="rpt-badge blue">Categoría</span>'}</td>
        <td>${i === 0 ? '<span class="rpt-badge ok">Más tráfico</span>' : /bautiz/.test(norm(k.name)) ? '<span class="rpt-badge amber">Bautizos</span>' : k.brand ? '<span class="rpt-badge">Defensa marca</span>' : '<span class="rpt-badge">Genérico</span>'}</td>
      </tr>`).join('');
    const serp = G.ads.slice(0, 2).map(a => {
      const shown = a.url ? a.url.replace(/^https:\/\//, '').replace(/\/$/, '') : '';
      return `
        <div class="rpt-serp-ad">
          <div class="rpt-serp-url"><span class="rpt-serp-tag">Anuncio</span><span>${esc(shown || 'Sin URL final')}</span></div>
          <div class="rpt-serp-title">${esc(a.name)}</div>
          <div class="rpt-serp-meta">${plural(a.clicks, 'clic', 'clics')} · CPC ${money2(ratio(a.cost, a.clicks))}${a.conversions > 0 ? ` · ${plural(a.conversions, 'conversión', 'conversiones')}` : ''}</div>
        </div>`;
    }).join('');
    const gNote = G.from ? (G.from !== per.inicio || G.to !== per.end ? `informe por palabra clave del ${rango(G.from, G.to)}` : 'informe por palabra clave') : 'sin informe por palabra clave en el periodo';
    const googlePage = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Google Ads · búsqueda', 'p7-lead', T['p7-lead'], R)}
          <div class="rpt-metrics cols-5">
            ${metric('Inversión', money(G.cost), 'Campaña Search')}
            ${metric('Clics', num(G.clicks), 'Tráfico a la web')}
            ${metric('CPC promedio', money2(gCpc), 'Todos los términos')}
            ${metric('CPC de marca', money2(bCpc), `${plural(G.brand.clicks, 'clic', 'clics')} de marca`, bCpc != null && gCpc && bCpc <= gCpc * 0.6 ? '<span class="rpt-badge blue">Muy eficiente</span>' : '')}
            ${metric('Conversiones', num(G.conversions), G.value > 0 ? `Valor atribuido ${money(G.value)}` : 'Conversiones de Google')}
          </div>
          ${G.clicks > 0 ? `
          <div class="rpt-split">
            <div class="rpt-col">
              <div class="rpt-card rpt-chart-panel">
                ${chartHead('Clics por grupo de anuncios', 'Términos generales vs. términos de marca', 'Clics')}
                <svg class="rpt-chart" data-chart="g-bars" role="img" aria-label="Clics por grupo de anuncios"></svg>
              </div>
              <div class="rpt-panel">
                <table>
                  <thead><tr><th>Término</th><th class="r">Clics</th><th class="r">CPC</th><th>Rol</th><th>Nota</th></tr></thead>
                  <tbody>${kwTable}</tbody>
                </table>
              </div>
              ${keyBox('p7-key', T['p7-key'])}
            </div>
            <div class="rpt-col">
              <div class="rpt-panel">
                ${panelHead('search', 'Anuncios de búsqueda', 'Los anuncios con más clics y su página de destino')}
                <div class="rpt-serp">${serp || '<p class="rpt-small">Sin anuncios con clics.</p>'}</div>
              </div>
              ${analysis('p7-an', T['p7-an'])}
            </div>
          </div>` : '<div class="rpt-notice">El informe de Google Ads por palabra clave no trae datos para este periodo.</div>'}
          <footer class="rpt-foot"><span>Fuente: Google Ads · ${esc(range)} · campaña Search (${esc(gNote)})</span></footer>
        </div>
      </section>`;

    // 08 · Conclusiones y próximos pasos
    const steps = T.steps.map((s, i) => `
      <div class="rpt-step" data-step="${i}">
        <span class="rpt-icon-box">${icon(['cart', 'chat', 'flag'][i] || 'flag')}</span>
        <div>${edit(`step-${i}-t`, s.t, 'strong')}${edit(`step-${i}-p`, s.p)}</div>
        <button class="rpt-step-del" type="button" data-rpt-step-del="${i}" title="Quitar este paso" aria-label="Quitar este paso">×</button>
      </div>`).join('');
    const conclusiones = `
      <section class="rpt-page">
        <div class="rpt-main">
          <div class="rpt-head"><div><h1>Conclusiones y próximos pasos</h1>${edit('p8-lead', T['p8-lead'], 'p', 'rpt-lead')}</div></div>
          <div class="rpt-insights">${[['cart', 'c1'], ['chat', 'c2'], ['search', 'c3']].map(([ic, id], i) => `
            <div class="rpt-card rpt-insight">
              <div class="rpt-insight-top"><span class="rpt-toc-icon">${icon(ic)}</span><span>${pad(i + 1)}</span></div>
              ${edit(`${id}-t`, T[`${id}-t`], 'h2')}
              ${edit(`${id}-p`, T[`${id}-p`])}
            </div>`).join('')}</div>
          <div class="rpt-panel">
            ${panelHead('flag', 'Próximos pasos', '')}
            <div class="rpt-steps">${steps}${T.steps.length < MAX_STEPS ? '<button class="rpt-step-add" type="button" data-rpt-step-add>+ Agregar paso</button>' : ''}</div>
          </div>
          <footer class="rpt-foot"><span>Fuente: análisis Lima Retail sobre Meta Ads + Google Ads · ${CLIENTE} · ${esc(mesAnio.toLowerCase())}</span></footer>
        </div>
      </section>`;

    const closing = `
      <section class="rpt-page rpt-closing" data-foot="none">
        <div class="rpt-main">
          <div class="rpt-closing-card"><img src="${LOGO}" alt=""><strong>Lima Retail</strong><span>Data Driven Marketing</span><small>Power KPI · Digital Analytics</small></div>
        </div>
      </section>`;

    const list = [cover, contents, resumen, ecommerce, whatsapp, distribucion, googlePage, conclusiones, closing];
    // Pie: marca, cliente, título, mes y número de página en las láminas interiores.
    return list.map((html, i) => (i === 0 || i === list.length - 1 ? html : html.replace('</span></footer>',
      `</span><span class="rpt-foot-brand"><img src="${LOGO}" alt=""><strong>Lima Retail</strong>${CLIENTE} · ${TITULO} · ${esc(mesAnio)} · ${pad(i + 1)} / ${pad(list.length)}</span></footer>`)))
      .map(html => `<div class="rpt-frame">${html}</div>`).join('');
  }

  // ── Pintado ──
  let current = null;
  function texts0(R) {
    const T = texts(R);
    const saved = readNotes()[R.per.key] || {};
    Object.keys(saved).forEach(k => { if (k !== 'steps' && typeof saved[k] === 'string') T[k] = saved[k]; });
    if (Array.isArray(saved.steps)) T.steps = saved.steps.slice(0, MAX_STEPS);
    return T;
  }

  function fit() {
    const host = document.getElementById('rpt-report');
    const doc = host?.querySelector('.rpt');
    if (!doc) return;
    const w = host.clientWidth;
    if (w > 0) doc.style.setProperty('--rpt-s', String(Math.min(1, (w - 2) / 1282)));
  }

  function drawCharts(R) {
    const host = document.getElementById('rpt-report');
    const q = name => host.querySelector(`[data-chart="${name}"]`);
    const labels = R.bl.map(b => b.label);
    if (q('wa-line')) lineChart(q('wa-line'), { labels, values: R.wa.series, h: 150 });
    if (q('eco-line')) lineChart(q('eco-line'), { labels, values: R.eco.series, h: 116 });
    if (q('wa-bars')) barChart(q('wa-bars'), { labels: R.wa.sets.slice(0, 4).map(s => s.short), values: R.wa.sets.slice(0, 4).map(s => s.conversations), h: 116 });
    if (q('g-bars')) barChart(q('g-bars'), { labels: R.google.groups.map(g => g.name), values: R.google.groups.map(g => g.clicks), h: 116 });
    if (q('donut')) donut(q('donut'), { items: R.dist.map(d => ({ value: d.spend, color: d.color })), center: money(R.totalSpend), sub: 'inversión total' });
  }

  async function render() {
    const host = document.getElementById('rpt-report');
    if (!host) return;
    await load();
    metaCache = googleCache = null;
    const list = periods();
    const select = document.getElementById('rpt-select');
    if (!list.length) {
      if (select) select.innerHTML = '<option value="">Sin meses con datos</option>';
      host.innerHTML = '<div class="panel"><div class="gp-table-empty">Todavía no hay un mes del ciclo con entregas en Meta Ads y ventas cargadas.</div></div>';
      return;
    }
    if (!list.some(p => p.key === selected)) selected = list[0].key;
    if (select) {
      select.innerHTML = list.map(p => `<option value="${p.key}"${p.key === selected ? ' selected' : ''}>${esc(`${p.mes} ${p.year}`)} · ${esc(rango(p.inicio, p.end))}${p.complete ? '' : ` · datos al ${esc(corta(p.end))}`}</option>`).join('');
    }
    const per = list.find(p => p.key === selected);
    const R = build(per);
    const T = texts0(R);
    current = { R, T };
    const note = document.getElementById('rpt-note');
    if (note) {
      note.textContent = per.complete
        ? `Ciclo ${rango(per.inicio, per.fin)} completo. Los textos se editan sobre la lámina y quedan guardados en este navegador.`
        : `Ciclo ${rango(per.inicio, per.fin)}: Meta llega al ${corta(metaEnd())} y las ventas al ${corta(salesEnd() || per.end)}, así que el reporte corta el ${corta(per.end)}. Los textos se editan sobre la lámina.`;
    }
    host.innerHTML = `<div class="rpt">${pages(R, T)}</div>`;
    fit();
    drawCharts(R);
  }

  // ── Edición ──
  function onInput(e) {
    const el = e.target.closest?.('[data-rpt-edit]');
    if (!el || !current) return;
    const id = el.dataset.rptEdit;
    const step = /^step-(\d+)-([tp])$/.exec(id);
    if (step) {
      const steps = current.T.steps.map(s => ({ ...s }));
      steps[+step[1]][step[2]] = cleanHtml(el);
      current.T.steps = steps;
      saveNote(current.R.per.key, 'steps', steps);
    } else {
      saveNote(current.R.per.key, id, cleanHtml(el));
    }
  }
  function onPaste(e) {
    if (!e.target.closest?.('[data-rpt-edit]')) return;
    e.preventDefault();
    const text = (e.clipboardData || global.clipboardData)?.getData('text/plain') || '';
    document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  }
  function onClick(e) {
    if (!current) return;
    const del = e.target.closest('[data-rpt-step-del]');
    const add = e.target.closest('[data-rpt-step-add]');
    if (!del && !add) return;
    const steps = current.T.steps.map(s => ({ ...s }));
    if (del) steps.splice(+del.dataset.rptStepDel, 1);
    if (add && steps.length < MAX_STEPS) steps.push({ t: 'Nuevo paso', p: 'Describe la acción, dónde se aplica y qué se espera.' });
    saveNote(current.R.per.key, 'steps', steps);
    render();
  }
  function resetTexts() {
    if (!current) return;
    if (!global.confirm(`¿Volver a los textos propuestos de ${current.R.per.mes.toLowerCase()}? Se pierden los cambios hechos a mano.`)) return;
    const notes = readNotes();
    delete notes[current.R.per.key];
    writeNotes(notes);
    render();
  }

  // El nombre del PDF lo pone el navegador con el título del documento: se cambia solo mientras imprime.
  function printReport() {
    if (!current) return;
    const title = document.title;
    document.title = `Reporte_Royal-Baby_${current.R.per.mes}-${current.R.per.year}`;
    const restore = () => { document.title = title; global.removeEventListener('afterprint', restore); };
    global.addEventListener('afterprint', restore);
    global.print();
    setTimeout(restore, 2000);
  }

  // ── Mensual o semanal ──
  function setKind(k) {
    kind = k === 'semanal' ? 'semanal' : 'mensual';
    try { localStorage.setItem(KIND_KEY, kind); } catch (e) { /* sin storage vuelve al mensual */ }
    document.querySelectorAll('[data-rpt-kind]').forEach(b => {
      b.classList.toggle('active', b.dataset.rptKind === kind);
      b.setAttribute('aria-selected', String(b.dataset.rptKind === kind));
    });
    document.querySelectorAll('[data-rpt-only]').forEach(el => { el.hidden = el.dataset.rptOnly !== kind; });
    if (kind === 'semanal') global.ReporteSemanal?.init();
    else render();
  }

  function init() {
    if (!wired) {
      wired = true;
      let saved = 'mensual';
      try { saved = localStorage.getItem(KIND_KEY) || 'mensual'; } catch (e) { /* mensual */ }
      kind = saved;
      document.querySelectorAll('[data-rpt-kind]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.rptKind)));
      document.getElementById('rpt-select')?.addEventListener('change', e => { selected = e.target.value; render(); });
      document.getElementById('rpt-print')?.addEventListener('click', printReport);
      document.getElementById('rpt-reset')?.addEventListener('click', resetTexts);
      const host = document.getElementById('rpt-report');
      host?.addEventListener('input', onInput);
      host?.addEventListener('paste', onPaste);
      host?.addEventListener('click', onClick);
      if (host && typeof ResizeObserver === 'function') {
        resizer = new ResizeObserver(fit);
        resizer.observe(host);
      }
    }
    setKind(kind);
  }

  global.ReporteMensual = { init };
})(window);
