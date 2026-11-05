/* ============================================================
   reporte-mensual.js — Archivo de Reportes · Generación de Reporte (modelo mensual).
   El reporte del mes del ciclo de venta (27 → 26) con las diez láminas del PDF «Modelo Reporte Royal
   Baby» de Lima Retail, en este orden: portada, contenido, resumen y ROAS real por canal, avance del
   objetivo, mejores anuncios de ventas web, mejores anuncios de WhatsApp, mejores anuncios de
   reconocimiento e interacción, Google Ads búsqueda, conclusiones y cierre. El modelo no lleva
   gráficos: cada lámina es métricas, una tabla y el recuadro «Clave».
   Cada página es una lámina de 1280×720 que se imprime tal cual: «Descargar PDF» abre el diálogo de
   impresión y sale una hoja 16:9 por lámina (css/reporte.css).
   Datos: Meta Ads y Google Ads de data/ads-2026.json (Gasto.load()), la venta real por canal del
   ciclo (data/ventas-2026.json), los objetivos del cliente (data/objetivos-2026.json) y los artes de
   los anuncios (data/artes-2026.json). El periodo corta en el último día que traen a la vez Meta y
   las ventas, para que el ROAS compare los mismos días.
   Los textos (lead, destacado, análisis, conclusiones y próximos pasos) salen propuestos con los
   números y se editan sobre la misma lámina; quedan guardados por mes en este navegador.
   También decide qué reporte se ve en la pestaña: este o el semanal (js/reporte-semanal.js).
   Expone window.ReporteMensual = { init }.
   ============================================================ */

(function (global) {
  // v2: al alinear las láminas con el PDF del modelo cambiaron los ids de los textos, así que lo
  // editado con la versión anterior no se reaprovecha.
  const NOTES_KEY = 'rb-rpt-notes-v2';
  const KIND_KEY = 'rb-rpt-kind';
  const CLIENTE = 'Royal Baby';
  const LOGO = 'assets/logo-lr.png';
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // Grupos de campaña de Meta: los mismos que Gasto publicitario y el reporte semanal.
  const GROUPS = [
    { key: 'ecommerce', label: 'Ventas E-Commerce', match: /ventas|e-?commerce|catalogo/ },
    { key: 'whatsapp', label: 'Mensajes WhatsApp', match: /whatsapp|mensajes/ },
    { key: 'reconocimiento', label: 'Reconocimiento (tienda)', match: /reconocimiento|alcance|notoriedad|branding|thruplay/ },
    { key: 'interaccion', label: 'Interacción', match: /interacci/ },
    { key: 'trafico', label: 'Tráfico', match: /trafico/ },
  ];
  const OTHER = { key: 'otras', label: 'Otras campañas' };
  // Columna de la meta del cliente (data/objetivos-2026.json) que le corresponde a cada canal.
  const META_COL = { web: 'Web', whatsapp: 'Redes', showroom: 'Outlet', tienda: 'Tienda' };

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

  let ads = null, ventas = null, artes = null, objetivos = null;
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
  // En el modelo el retorno siempre lleva la «x»: «14.1x», «0.84x dir.».
  const roasX = n => (fin(n) ? `${dec1(n)}x` : '—');
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
        json('RB_OBJETIVOS_DATA', 'data/objetivos-2026.json'),
      ]).then(([a, v, r, o]) => { ads = a; ventas = v; artes = r; objetivos = o; });
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
    const C = global.Ciclo;
    const inP = r => r.day >= per.inicio && r.day <= per.end;
    const meta = metaRows().filter(inP);
    const gDet = googleRows().filter(inP);
    const gCamps = googleCampaigns(per);
    const sales = salesOf(per);
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

    // 04 · Objetivo del cliente por canal. En un mes a medio cerrar la meta se prorratea por los días
    // cargados: es la regla de «lo esperado al corte» de Objetivos comerciales (js/objectives.js).
    const metas = objetivos?.metas?.[per.mes] || {};
    const fMeta = per.complete ? 1 : (C.entre(per.inicio, per.end) + 1) / (C.entre(per.inicio, per.fin) + 1);
    const objRow = (key, label, sub) => {
      const canal = canales.find(x => x.key === key);
      const bruta = metas[META_COL[key]];
      const target = fin(bruta) ? bruta * fMeta : null;
      return { label, sub, target, sale: canal.sale, done: target > 0 ? pct(canal.sale, target) : null };
    };
    const suma = (label, sub, list) => {
      const target = list.every(r => r.target == null) ? null : list.reduce((a, r) => a + (r.target || 0), 0);
      const sale = list.reduce((a, r) => a + r.sale, 0);
      return { label, sub, target, sale, done: target > 0 ? pct(sale, target) : null };
    };
    const online = [objRow('web', 'Web'), objRow('whatsapp', 'WhatsApp'), objRow('showroom', 'Outlet')];
    const tienda = objRow('tienda', 'Tienda física', 'Venta presencial');
    const obj = {
      online, tienda, prorrateada: !per.complete,
      sub: suma('Online', 'Web + WhatsApp + Outlet', online),
      total: suma('Total', '', [...online, tienda]),
    };

    // 05 · E-commerce
    const ecoRows = meta.filter(r => r.group.key === 'ecommerce');
    const eco = sum(ecoRows);
    const web = canales.find(c => c.key === 'web');

    // 06 · WhatsApp, por conjunto (el «nuevo número» de un conjunto suma con él)
    const waRows = meta.filter(r => r.group.key === 'whatsapp');
    const wa = sum(waRows);
    const waSets = [...byKey(waRows, r => waKey(r.adset)).entries()].map(([key, list]) => ({ key, ...waNames(list[0].adset, key), ...sum(list) }))
      .filter(s => s.spend > 0 || s.conversations > 0).sort((a, b) => b.conversations - a.conversations);

    // 07 · Marca: reconocimiento e interacción, por anuncio y ordenados por impresiones. Estas
    // campañas se miden por alcance, y la tabla por anuncio solo trae clics en el enlace (casi
    // ninguno en video de marca), así que el costo va en CPM: lo que cuesta llegar a mil personas.
    const porAnuncio = (rows, n) => [...byKey(rows, r => r.ad).entries()]
      .map(([name, list]) => { const s = sum(list); return { name, ...s, cpm: s.impressions ? (s.spend / s.impressions) * 1000 : null }; })
      .filter(a => a.spend > 0).sort((a, b) => b.impressions - a.impressions).slice(0, n);
    const reconRows = meta.filter(r => r.group.key === 'reconocimiento');
    const interRows = meta.filter(r => r.group.key === 'interaccion');
    const marca = {
      recon: { ...sum(reconRows), rows: porAnuncio(reconRows, 3) },
      inter: { ...sum(interRows), rows: porAnuncio(interRows, 2) },
    };
    // Cada pieza se juzga contra el CPM de su propio objetivo: el de interacción es naturalmente
    // más alto que el de reconocimiento y compararlos entre sí no diría nada.
    const cpmDe = g => (g.impressions ? (g.spend / g.impressions) * 1000 : null);
    marca.recon.cpm = cpmDe(marca.recon);
    marca.inter.cpm = cpmDe(marca.inter);
    marca.rows = [
      ...marca.recon.rows.map(r => ({ ...r, objetivo: 'Reconocimiento', ref: marca.recon.cpm })),
      ...marca.inter.rows.map(r => ({ ...r, objetivo: 'Interacción', ref: marca.inter.cpm })),
    ];
    // La lectura de la lámina va sobre reconocimiento, que es la campaña que lleva el alcance.
    const juzgables = (marca.recon.rows.length ? marca.rows.filter(r => r.objetivo === 'Reconocimiento') : marca.rows).filter(r => fin(r.cpm));
    marca.cheap = [...juzgables].sort((a, b) => a.cpm - b.cpm)[0] || null;
    const caro = [...juzgables].sort((a, b) => b.cpm - a.cpm)[0] || null;
    // «No replicar» solo si de verdad se despega del CPM de su objetivo; si no, nada que señalar.
    marca.dear = caro && caro !== marca.cheap && fin(caro.ref) && caro.cpm >= caro.ref * 1.5 ? caro : null;

    // 08 · Google búsqueda (informe por palabra clave)
    const gSum = list => list.reduce((a, r) => ({ cost: a.cost + r.cost, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, value: a.value + r.value }), { cost: 0, clicks: 0, conversions: 0, value: 0 });
    const gTot = gSum(gDet);
    const brand = gSum(gDet.filter(r => /marca/.test(norm(r.adGroup))));
    const keywords = [...byKey(gDet.filter(r => r.keyword), r => r.keyword).entries()]
      .map(([name, list]) => ({ name, group: list[0].adGroup, brand: /marca/.test(norm(list[0].adGroup)), ...gSum(list) }))
      .filter(k => k.clicks > 0).sort((a, b) => b.clicks - a.clicks);
    const gDays = [...new Set(gDet.map(r => r.day))].sort();

    return {
      per, meta, metaSpend, googleSpend, totalSpend, canales, ventaReal, lider, fuera, obj, marca,
      eco: { ...eco, web, ads: bestAds(ecoRows, 'purchases', per) },
      wa: { ...wa, sets: waSets, ads: bestAds(waRows, 'conversations', per),
        canal: canales.find(c => c.key === 'whatsapp'), showroom: canales.find(c => c.key === 'showroom') },
      google: { ...gTot, brand, keywords, roas: ratio(gTot.value, gTot.cost), from: gDays[0], to: gDays[gDays.length - 1] },
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
    const { per, canales, wa, eco, google, obj, marca } = R;
    const conInv = canales.filter(c => c.spend > 0 && c.roas != null).sort((a, b) => b.roas - a.roas);
    const pierden = conInv.filter(c => c.roas < 1);
    // El canal líder se nombra aparte (es el que concentra la venta), así que no se repite en la
    // lista de los rentables ni en los que se escalan con pauta.
    const escalables = conInv.filter(c => c !== R.lider);
    const ecoRoas = a => ratio(a.value, a.spend);
    const ecoMejor = [...eco.ads].filter(a => a.value > 0).sort((a, b) => ecoRoas(b) - ecoRoas(a))[0];
    const ecoVolumen = [...eco.ads].filter(a => a.purchases > 0).sort((a, b) => b.purchases - a.purchases)[0];
    const topWa = wa.sets[0];
    const cheapWa = [...wa.sets].filter(s => s.conversations > 0).sort((a, b) => a.spend / a.conversations - b.spend / b.conversations)[0];
    const outlet = wa.sets.find(s => isOutlet(s.label));
    const bestWaAd = wa.ads[0];
    const gCpc = ratio(google.cost, google.clicks);
    const bCpc = ratio(google.brand.cost, google.brand.clicks);
    const generic = { clicks: google.clicks - google.brand.clicks, cost: google.cost - google.brand.cost };
    const topKw = google.keywords[0];
    const mesTxt = per.mes.toLowerCase();
    const onlineTxt = obj.online.filter(r => r.done != null).map(r => `${r.label} ${pct0(r.done)}`).join(', ');
    const cumplen = obj.online.filter(r => r.done != null && r.done >= 100).length;

    const t = {};
    // 03 · Resumen y ROAS real por canal
    t['p3-lead'] = 'Cuánto se invirtió en Meta y Google, cuánto facturó cada canal real y qué retorno dejó.';
    t['p3-key'] = [
      !conInv.length ? 'Ningún canal tuvo inversión propia en el periodo.'
        : pierden.length ? `${pierden.map(c => c.label).join(' y ')} no ${pierden.length === 1 ? 'recupera' : 'recuperan'} lo invertido (ROAS ${pierden.map(c => roasX(c.roas)).join(' y ')}); el resto devuelve más de lo que cuesta.`
          : `Al separar los conjuntos, ${(escalables.length ? escalables : conInv).slice(0, 3).map(c => `${c.short} rinde ${roasX(c.roas)}`).join(', ')}.`,
      R.lider && R.ventaReal > 0 ? `${R.lider.label} deja el mayor retorno y concentra el ${pct0(pct(R.lider.sale, R.ventaReal))} de la venta del mes.` : '',
    ].filter(Boolean).join(' ');

    // 04 · Avance del objetivo
    t['p4-lead'] = 'Cómo cerró el mes frente a la meta del cliente, por canal.';
    t['p4-key'] = obj.total.done == null
      ? `No hay meta cargada para ${mesTxt} en los objetivos del cliente.`
      : [
        onlineTxt
          ? `${cumplen === obj.online.length ? 'Los tres canales online cumplieron o superaron su objetivo' : `${cumplen} de ${obj.online.length} canales online cumplieron su objetivo`} (online ${pct0(obj.sub.done)}): ${onlineTxt}.`
          : '',
        obj.tienda.done != null && obj.tienda.done < 100
          ? `La pauta funcionó; la brecha vs. el total (${pct0(obj.total.done)}) vino de la tienda física (${pct0(obj.tienda.done)}).`
          : `El total cerró en ${pct0(obj.total.done)}.`,
      ].filter(Boolean).join(' ');

    // 05 · Mejores anuncios · Ventas web
    t['p5-lead'] = 'Qué piezas trajeron las compras y a qué costo, sobre el público de remarketing.';
    t['p5-key'] = eco.ads.length ? [
      `Las compras salen del remarketing a CPC ${money2(ratio(eco.spend, eco.clicks))}.`,
      ecoMejor ? `«${esc(ecoMejor.name)}» deja el mejor ROAS (${roasX(ecoRoas(ecoMejor))}) con ${money(ecoMejor.spend)} de inversión.` : '',
      ecoVolumen && ecoVolumen !== ecoMejor ? `«${esc(ecoVolumen.name)}» trae más volumen (${plural(ecoVolumen.purchases, 'compra', 'compras')}) pero a menor retorno.` : '',
      !eco.purchases ? `Meta no atribuyó compras a la campaña; la venta web real del periodo fue ${money(eco.web.sale)}.` : '',
    ].filter(Boolean).join(' ') : 'La campaña de ventas web no tuvo entrega en el periodo.';

    // 06 · Mejores anuncios · WhatsApp
    t['p6-lead'] = 'Qué piezas traen las conversaciones y a qué costo, por conjunto.';
    t['p6-key'] = topWa ? [
      `${esc(topWa.label)} trae el mayor volumen de conversaciones (${num(topWa.conversations)}) a ${money2(ratio(topWa.spend, topWa.conversations))} cada una${cheapWa && cheapWa !== topWa ? `, y ${esc(cheapWa.label)} las consigue al costo más bajo (${money2(ratio(cheapWa.spend, cheapWa.conversations))})` : ''}.`,
      outlet && wa.showroom.roas != null ? `El conjunto de outlet las convierte en venta de showroom (ROAS ${roasX(wa.showroom.roas)}).` : '',
      bestWaAd ? `La pieza con más contactos es «${esc(bestWaAd.name)}».` : '',
    ].filter(Boolean).join(' ') : 'La campaña de mensajes no tuvo entrega en el periodo.';

    // 07 · Mejores anuncios · Reconocimiento e Interacción
    t['p7-lead'] = 'Los objetivos de marca (tráfico a tienda e interacción): qué funcionó y qué replicar.';
    t['p7-key'] = marca.rows.length ? [
      marca.cheap ? `«${esc(marca.cheap.name)}» lleva alcance al costo más bajo (CPM ${money2(marca.cheap.cpm)}).` : '',
      marca.dear ? `La pieza «${esc(marca.dear.name)}» subió el CPM a ${money2(marca.dear.cpm)} y rindió menos.` : '',
      marca.inter.spend > 0 ? `Interacción sostiene la presencia de marca con ${money(marca.inter.spend)} y ${num(marca.inter.impressions)} impresiones.` : '',
    ].filter(Boolean).join(' ') : 'No hubo entrega en reconocimiento ni interacción en el periodo.';
    t['p7-an'] = marca.rows.length ? [
      `<strong>Funcionó:</strong> ${marca.cheap ? `la narrativa de «${esc(marca.cheap.name)}», que genera alcance barato (${num(marca.cheap.impressions)} impresiones a CPM ${money2(marca.cheap.cpm)}) y alimenta el remarketing` : 'el alcance de marca'} — replicar en nuevos ángulos.`,
      marca.dear ? `<strong>No replicar:</strong> «${esc(marca.dear.name)}», con CPM ${money2(marca.dear.cpm)}: no aporta alcance eficiente.` : '',
      marca.inter.spend > 0 ? '<strong>Interacción:</strong> mantener 1-2 piezas como presencia de marca, sin escalar.' : '',
      '<strong>Acción:</strong> concentrar Reconocimiento en los videos de producto y tienda.',
    ].filter(Boolean).join(' ') : 'Sin inversión en reconocimiento ni interacción en este periodo.';

    // 08 · Google Ads · búsqueda
    t['p8-lead'] = 'Captura demanda activa de marca y categoría, y lleva ese tráfico de alta intención a la web.';
    t['p8-key'] = google.brand.clicks > 0
      ? `Los términos de marca capturan tráfico propio muy barato (CPC medio ${money2(bCpc)}) y defienden el nombre; los de categoría traen ${num(generic.clicks)} clics de tráfico nuevo a ${money2(ratio(generic.cost, generic.clicks))}.`
      : google.clicks > 0 ? `Search llevó ${num(google.clicks)} clics a la web a ${money2(gCpc)} cada uno.` : 'Sin clics de búsqueda en el informe del periodo.';
    t['p8-an'] = google.clicks > 0 ? [
      `<strong>Qué funcionó:</strong> Google llevó ${num(google.clicks)} clics de búsqueda activa a la web (CPC ${money2(gCpc)}).`,
      google.roas != null && google.roas < 1
        ? `El ROAS directo es bajo (${roasX(google.roas)}) no porque falle, sino porque Search no cierra al último clic: su tráfico asiste y convierte luego por el remarketing de Meta.`
        : google.roas != null ? `El ROAS directo de Search es ${roasX(google.roas)}.` : '',
      bCpc != null ? 'Más eficiente: la defensa de marca. Menos: las categorías a mayor CPC, pero abren público nuevo.' : '',
      topKw ? `<strong>Acción:</strong> reforzar los términos de mayor intención, empezando por «${esc(topKw.name)}» (${num(topKw.clicks)} clics).` : '',
    ].filter(Boolean).join(' ') : 'El informe de Google por palabra clave no tiene clics en este periodo.';

    // 09 · Conclusiones y próximos pasos
    t['p9-lead'] = `Cómo nos fue en ${mesTxt} y qué se hará en las próximas semanas.`;
    const suben = (escalables.length ? escalables : conInv).filter(c => c.key !== 'web');
    t['c1-t'] = suben.length >= 2 ? `Escalar ${suben[0].short} y ${suben[1].short}` : suben.length ? `Escalar ${suben[0].short}` : 'Retorno por canal';
    t['c1-p'] = suben.length
      ? `${suben.length >= 2 ? `Son los más rentables (${suben.slice(0, 2).map(c => roasX(c.roas)).join(' y ')})` : `Es el más rentable (${roasX(suben[0].roas)})`}: se escalan con línea propia.${eco.web.roas != null ? ` La web (${roasX(eco.web.roas)}) es el motor de volumen.` : ''}`
      : 'Sin inversión asignada a los canales de venta en el periodo.';
    t['c2-t'] = 'Google a Mensajes + rastreo';
    t['c2-p'] = google.clicks > 0
      ? `Google va con ${money(google.cost)} en búsqueda${google.roas != null ? ` y ROAS directo ${roasX(google.roas)}` : ''}. Cambiar el objetivo a Mensajes y marcar de dónde viene cada contacto (Meta vs. Google) para medir cuál fuente es más rentable.`
      : 'Sin clics de búsqueda en el periodo: revisar la campaña antes de reforzarla.';
    t['c3-t'] = 'Video de producto para tienda';
    t['c3-p'] = `Piezas con locución narrada que muestren los productos y lleven tráfico a ${R.lider ? R.lider.short : 'la tienda física'}, la de mayor venta. Variedad de versiones para ver cuál funciona más.`;
    t['p9-close'] = obj.sub.done != null && onlineTxt
      ? `En ${mesTxt} los canales online ${obj.sub.done >= 100 ? 'superaron su objetivo' : 'cerraron'} (${pct0(obj.sub.done)}): ${onlineTxt}${obj.tienda.done != null ? `; la tienda física quedó en ${pct0(obj.tienda.done)}` : ''}.`
      : `En ${mesTxt} la venta real fue ${money(R.ventaReal)} con ${money(R.totalSpend)} de inversión (ROAS ${roasX(ratio(R.ventaReal, R.totalSpend))}).`;
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

  // ── Piezas de la lámina ──
  const edit = (id, html, tag = 'p', cls = '') => `<${tag} class="${cls}" contenteditable="true" spellcheck="false" data-rpt-edit="${id}" data-placeholder="Escribe el texto">${html}</${tag}>`;
  const metric = (label, value, detail, badge = '') => `
    <div class="rpt-card rpt-metric">
      <div class="rpt-metric-head"><span class="rpt-metric-label">${label}</span>${badge}</div>
      <div class="rpt-metric-value">${value}</div>
      <div class="rpt-metric-detail" title="${esc(String(detail).replace(/<[^>]+>/g, ''))}">${detail}</div>
    </div>`;
  const head = (title, leadId, leadHtml, control) => `
    <div class="rpt-head">
      <div><h1>${title}</h1>${edit(leadId, leadHtml, 'p', 'rpt-lead')}</div>
      ${control ? `<span class="rpt-control">${icon('calendar')}${esc(control)}</span>` : ''}
    </div>`;
  const keyBox = (id, html) => `
    <div class="rpt-key">
      <span class="rpt-key-icon">${icon('bulb')}</span>
      <div><p class="rpt-key-label">Clave</p>${edit(id, html)}</div>
    </div>`;
  // El modelo cierra las láminas de marca y de Google con un panel de lectura, no con «Análisis».
  const analysis = (id, html, title = 'Análisis') => `
    <div class="rpt-panel">
      <div class="rpt-panel-head"><div class="rpt-panel-title">${icon('bars')}<strong>${title}</strong></div></div>
      <div class="rpt-panel-body">${edit(id, html, 'p', 'rpt-text')}</div>
    </div>`;
  const difBadge = done => {
    if (!fin(done)) return '';
    const d = Math.round(done - 100);
    return `<span class="rpt-badge ${d >= 0 ? 'ok' : 'rose'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}%</span>`;
  };

  // Las tres piezas del objetivo: formato y arte arriba, y las tres cifras que pide el modelo.
  function adCards(list, unidad, tercera) {
    if (!list.length) return '<div class="rpt-panel"><div class="rpt-panel-body"><p>Sin anuncios con entrega en el periodo.</p></div></div>';
    return `<div class="rpt-ads rpt-fill">${list.map((a, i) => {
      const art = a.arte;
      const id = art ? driveId(art.kind === 'carrusel' && art.slides?.length ? art.slides[0] : art.driveId) : null;
      const kindTxt = art ? (art.kind === 'video' ? 'Video' : art.kind === 'carrusel' ? 'Carrusel' : 'Imagen') : '';
      return `
        <div class="rpt-ad${i === 0 && a.results > 0 ? ' is-on' : ''}">
          <div class="rpt-ad-thumb">${id ? `<img src="https://drive.google.com/thumbnail?id=${id}&amp;sz=w800" alt="" referrerpolicy="no-referrer">` : '<span class="rpt-ad-none">Sin arte en Drive</span>'}${kindTxt ? `<span class="rpt-ad-kind">${kindTxt}</span>` : ''}</div>
          <div class="rpt-ad-body">
            <div class="rpt-ad-name" title="${esc(a.name)}">${esc(a.name)}</div>
            <div class="rpt-ad-set" title="${esc(a.adset)}">${esc(a.adset)}</div>
            <div class="rpt-ad-row"><span>Inversión</span><b>${money(a.spend)}</b></div>
            <div class="rpt-ad-row"><span>${unidad}</span><b>${num(a.results)}</b></div>
            <div class="rpt-ad-row"><span>${tercera.label}</span><b>${tercera.value(a)}</b></div>
            ${a.link ? `<a class="rpt-ad-link" href="${esc(a.link)}" target="_blank" rel="noopener">Ver anuncio »</a>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // ── Láminas: las diez del modelo, en su orden ──
  function pages(R, T) {
    const { per, obj, marca } = R;
    const mesAnio = `${per.mes} ${per.year}`;
    const mesTxt = mesAnio.toLowerCase();
    const range = rango(per.inicio, per.end);
    const cierre = `Cierre ${rango(per.inicio, per.end, false)}`;
    const emitido = global.Ciclo.hoyLima();
    const emitidoMes = global.Ciclo.mesDe(emitido);

    // 01 · Portada
    const cover = `
      <section class="rpt-page rpt-cover" data-foot="cover">
        <div class="rpt-main">
          <div class="rpt-brand"><img src="${LOGO}" alt=""><div><strong>Lima Retail</strong><span>Data Driven Marketing</span></div></div>
          <div class="rpt-cover-body">
            <div class="rpt-cover-tags"><span>M</span><span>G</span></div>
            <h1>Reporte de Publicidad</h1>
            <div class="rpt-cover-client">Cliente: <b>${CLIENTE}</b></div>
            <div class="rpt-cover-period"><span>${esc(mesAnio)} · ${esc(cierre)}</span><span>Meta Ads · Google Ads</span></div>
          </div>
          <footer class="rpt-foot"><span>Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics</span><span class="rpt-foot-brand"><img src="${LOGO}" alt=""><strong>Lima Retail</strong>Emitido el ${esc(corta(emitido))}. ${emitido.slice(0, 4)}</span></footer>
        </div>
      </section>`;

    // 02 · Contenido del reporte
    const toc = [
      ['pie', 'Resumen y ROAS por canal', 'Inversión, venta real y retorno de cada canal.', 3],
      ['flag', 'Avance del objetivo', `Cómo cerró ${per.mes.toLowerCase()} frente a la meta.`, 4],
      ['video', 'Mejores anuncios · Meta', 'Piezas por objetivo: ventas, WhatsApp, reconocimiento, interacción.', 5],
      ['search', 'Google Ads · búsqueda', 'Clics, términos y captura de demanda.', 8],
      ['bulb', 'Conclusiones', 'Qué funcionó y próximos pasos.', 9],
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
    const roasMeta = ratio(R.ventaReal, R.metaSpend);
    // El orden del modelo: los canales online y al final la tienda, que es la que más vende.
    const ORDEN = ['showroom', 'whatsapp', 'web', 'tienda'];
    const canalRows = ORDEN.map(k => R.canales.find(c => c.key === k)).filter(Boolean).map(c => `
      <tr class="${c === R.lider ? 'is-on' : ''}">
        <td><strong><i class="rpt-swatch" style="background:${c.color}"></i>${esc(c.label)}</strong></td>
        <td class="r">${c.spend > 0 ? money(c.spend) : '—'}</td>
        <td class="r"><strong>${money(c.sale)}</strong></td>
        <td class="r"><strong>${roasX(c.roas)}</strong></td>
      </tr>`).join('');
    const resumen = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Resumen y ROAS real por canal', 'p3-lead', T['p3-lead'], cierre)}
          <div class="rpt-metrics">
            ${metric('Inversión total', money(R.totalSpend), `Meta ${money(R.metaSpend)} · Google ${money(R.googleSpend)}`)}
            ${metric('Venta real', money(R.ventaReal), 'Cierre por canal del cliente')}
            ${metric('ROAS real total', roasX(roasTotal), roasTotal != null ? `S/ ${dec1(roasTotal)} por cada S/ 1 invertido` : 'Sin inversión', roasBadge(roasTotal))}
            ${metric('Canal líder', esc(R.lider?.label || '—'), R.lider && R.ventaReal > 0 ? `${pct0(pct(R.lider.sale, R.ventaReal))} de la venta del mes` : '')}
          </div>
          <div class="rpt-panel">
            <table>
              <thead><tr><th>Canal</th><th class="r">Inversión</th><th class="r">Venta real</th><th class="r">ROAS</th></tr></thead>
              <tbody>
                <tr class="rpt-section"><td colspan="4">Meta Ads · canales de venta</td></tr>
                ${canalRows}
                <tr class="rpt-subtotal">
                  <td><strong>Subtotal Meta</strong></td>
                  <td class="r">${money(R.metaSpend)}</td><td class="r">${money(R.ventaReal)}</td><td class="r">${roasX(roasMeta)}</td>
                </tr>
                <tr class="rpt-section"><td colspan="4">Google Ads</td></tr>
                <tr>
                  <td><strong><i class="rpt-swatch" style="background:#0ea5e9"></i>Search</strong><span class="rpt-sub">Asiste la venta web</span></td>
                  <td class="r">${R.googleSpend > 0 ? money(R.googleSpend) : '—'}</td><td class="r">—</td>
                  <td class="r"><strong>${R.google.roas != null ? `${roasX(R.google.roas)} dir.` : '—'}</strong></td>
                </tr>
                <tr class="rpt-total"><td>Total · Meta + Google</td><td class="r">${money(R.totalSpend)}</td><td class="r">${money(R.ventaReal)}</td><td class="r">${roasX(roasTotal)}</td></tr>
              </tbody>
            </table>
            <div class="rpt-panel-foot">Venta real del cierre por canal del cliente, no de la atribución de plataforma. El ROAS directo de Google sale del informe por palabra clave (lámina 08).${R.fuera > 0 ? ` Instagram y Facebook (${money(R.fuera)}) no entran en los cuatro canales.` : ''}</div>
          </div>
          ${keyBox('p3-key', T['p3-key'])}
          <footer class="rpt-foot"><span>Fuente: Meta Ads + Google Ads · ${esc(range)} · venta real por canal (cierre del cliente)</span></footer>
        </div>
      </section>`;

    // 04 · Avance del objetivo
    const objRow = (r, cls = '') => `
      <tr class="${cls}">
        <td><strong>${esc(r.label)}</strong>${r.sub ? `<span class="rpt-sub">${esc(r.sub)}</span>` : ''}</td>
        <td class="r">${r.target != null ? money(r.target) : '—'}</td>
        <td class="r"><strong>${money(r.sale)}</strong></td>
        <td class="r"><strong>${r.done != null ? pct0(r.done) : '—'}</strong></td>
      </tr>`;
    const diasCar = global.Ciclo.entre(per.inicio, per.end) + 1;
    const objetivo = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head(`Avance del objetivo de ${per.mes.toLowerCase()}`, 'p4-lead', T['p4-lead'], cierre)}
          <div class="rpt-metrics">
            ${metric(`Objetivo ${per.mes.toLowerCase()}`, obj.total.target != null ? money(obj.total.target) : '—', obj.prorrateada ? `Meta del cliente · ${plural(diasCar, 'día cargado', 'días cargados')}` : 'Meta del cliente')}
            ${metric('Venta real', money(R.ventaReal), 'Cierre por canal')}
            ${metric('Cumplimiento total', obj.total.done != null ? pct0(obj.total.done) : '—', 'Venta ÷ objetivo', difBadge(obj.total.done))}
            ${metric('Online', obj.sub.done != null ? pct0(obj.sub.done) : '—', 'Web + WhatsApp + Outlet', difBadge(obj.sub.done))}
          </div>
          <div class="rpt-panel">
            <table>
              <thead><tr><th>Canal</th><th class="r">Objetivo</th><th class="r">Venta real</th><th class="r">Cumplimiento</th></tr></thead>
              <tbody>
                ${obj.online.map(r => objRow(r, r.done != null && r.done >= 100 ? 'is-on' : '')).join('')}
                ${objRow(obj.sub, 'rpt-subtotal')}
                ${objRow(obj.tienda)}
                ${objRow(obj.total, 'rpt-total')}
              </tbody>
            </table>
            <div class="rpt-panel-foot">Objetivos del cliente en Drive (hoja de objetivos) frente a la venta real por canal del mismo periodo.${obj.prorrateada ? ` El mes no cerró todavía: la meta se prorratea por los ${num(diasCar)} días cargados.` : ''}</div>
          </div>
          ${keyBox('p4-key', T['p4-key'])}
          <footer class="rpt-foot"><span>Fuente: objetivos del cliente vs. venta real por canal · ${esc(mesTxt)}</span></footer>
        </div>
      </section>`;

    // 05 · Mejores anuncios · Ventas web
    const ventasWeb = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Mejores anuncios · Ventas web', 'p5-lead', T['p5-lead'], cierre)}
          ${adCards(R.eco.ads, 'Compras', { label: 'ROAS', value: a => roasX(ratio(a.value, a.spend)) })}
          ${keyBox('p5-key', T['p5-key'])}
          <footer class="rpt-foot"><span>Fuente: Meta Ads · campaña Ventas E-Commerce · ${esc(range)}</span></footer>
        </div>
      </section>`;

    // 06 · Mejores anuncios · WhatsApp
    const whatsapp = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Mejores anuncios · WhatsApp', 'p6-lead', T['p6-lead'], cierre)}
          ${adCards(R.wa.ads, 'Conversac.', { label: 'Costo/conv.', value: a => money2(ratio(a.spend, a.results)) })}
          ${keyBox('p6-key', T['p6-key'])}
          <footer class="rpt-foot"><span>Fuente: Meta Ads · campaña Tráfico a Mensajes WhatsApp · ${esc(range)}</span></footer>
        </div>
      </section>`;

    // 07 · Mejores anuncios · Reconocimiento e Interacción
    const marcaBadge = r => {
      if (!fin(r.cpm) || !fin(r.ref)) return '—';
      if (r.cpm <= r.ref * 0.9) return '<span class="rpt-badge ok">Replicar</span>';
      if (r.cpm >= r.ref * 1.5) return '<span class="rpt-badge rose">Revisar</span>';
      return '<span class="rpt-badge">OK</span>';
    };
    const marcaRows = marca.rows.map(r => `
      <tr class="${r === marca.cheap ? 'is-on' : ''}">
        <td>${r.objetivo === 'Reconocimiento' ? '<span class="rpt-badge amber">Reconocimiento</span>' : '<span class="rpt-badge">Interacción</span>'}</td>
        <td class="rpt-name" title="${esc(r.name)}">${esc(r.name)}</td>
        <td class="r">${money(r.spend)}</td>
        <td class="r">${num(r.impressions)}</td>
        <td class="r">${money2(r.cpm)}</td>
        <td>${marcaBadge(r)}</td>
      </tr>`).join('');
    const marcaPage = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Mejores anuncios · Reconocimiento e Interacción', 'p7-lead', T['p7-lead'], cierre)}
          <div class="rpt-metrics">
            ${metric('Reconocimiento', money(marca.recon.spend), 'Tráfico a tienda · ThruPlays')}
            ${metric('Impresiones (recon.)', num(marca.recon.impressions), 'Alcance de marca')}
            ${metric('Interacción', money(marca.inter.spend), 'Engagement de marca')}
            ${metric('Impresiones (interac.)', num(marca.inter.impressions), 'Alcance de interacción')}
          </div>
          <div class="rpt-panel">
            <table>
              <thead><tr><th>Objetivo</th><th>Anuncio</th><th class="r">Inv.</th><th class="r">Impresiones</th><th class="r">CPM</th><th>Qué pasó</th></tr></thead>
              <tbody>${marcaRows || '<tr><td colspan="6">Sin entrega en reconocimiento ni interacción.</td></tr>'}</tbody>
            </table>
          </div>
          ${keyBox('p7-key', T['p7-key'])}
          ${analysis('p7-an', T['p7-an'], 'Qué replicar y qué no')}
          <footer class="rpt-foot"><span>Fuente: Meta Ads · campañas Reconocimiento e Interacción · ${esc(range)}</span></footer>
        </div>
      </section>`;

    // 08 · Google Ads · búsqueda
    const G = R.google;
    const gCpc = ratio(G.cost, G.clicks);
    const kwTable = G.keywords.slice(0, 5).map((k, i) => `
      <tr class="${i === 0 ? 'is-on' : ''}">
        <td class="rpt-name" title="${esc(k.name)}">${esc(k.name)}</td>
        <td class="r">${i === 0 ? `<strong>${num(k.clicks)}</strong>` : num(k.clicks)}</td>
        <td class="r">${money2(ratio(k.cost, k.clicks))}</td>
        <td>${k.brand ? '<span class="rpt-badge sky">Marca</span>' : '<span class="rpt-badge blue">Categoría</span>'}</td>
        <td>${i === 0 ? '<span class="rpt-badge ok">Más tráfico</span>' : /bautiz/.test(norm(k.name)) ? '<span class="rpt-badge amber">Bautizos</span>' : k.brand ? '<span class="rpt-badge">Defensa marca</span>' : '<span class="rpt-badge">Genérico</span>'}</td>
      </tr>`).join('');
    const gNote = G.from ? (G.from !== per.inicio || G.to !== per.end ? `informe por palabra clave del ${rango(G.from, G.to)}` : 'informe por palabra clave') : 'sin informe por palabra clave en el periodo';
    const googlePage = `
      <section class="rpt-page">
        <div class="rpt-main">
          ${head('Google Ads · búsqueda', 'p8-lead', T['p8-lead'], mesAnio)}
          <div class="rpt-metrics cols-5">
            ${metric('Inversión', money(G.cost), 'Campaña Search · informe por término')}
            ${metric('Clics', num(G.clicks), 'Tráfico a la web')}
            ${metric('CPC prom.', money2(gCpc), 'Todos los términos')}
            ${metric('Conversiones', num(G.conversions), G.value > 0 ? `Valor atrib. ${money(G.value)}` : 'Conversiones de Google')}
            ${metric('ROAS directo', G.roas != null ? roasX(G.roas) : '—', 'Asiste vía remarketing')}
          </div>
          <div class="rpt-panel">
            <table>
              <thead><tr><th>Término</th><th class="r">Clics</th><th class="r">CPC</th><th>Rol</th><th>Nota</th></tr></thead>
              <tbody>${kwTable || '<tr><td colspan="5">El informe de Google por palabra clave no trae clics en este periodo.</td></tr>'}</tbody>
            </table>
          </div>
          ${keyBox('p8-key', T['p8-key'])}
          ${analysis('p8-an', T['p8-an'], 'Qué pasó y qué hacer')}
          <footer class="rpt-foot"><span>Fuente: Google Ads · campaña Search · ${esc(mesTxt)} (${esc(gNote)})</span></footer>
        </div>
      </section>`;

    // 09 · Conclusiones y próximos pasos
    const conclusiones = `
      <section class="rpt-page">
        <div class="rpt-main">
          <div class="rpt-head"><div><h1>Conclusiones y próximos pasos</h1>${edit('p9-lead', T['p9-lead'], 'p', 'rpt-lead')}</div></div>
          <div class="rpt-insights rpt-fill">${[['cart', 'c1'], ['search', 'c2'], ['video', 'c3']].map(([ic, id], i) => `
            <div class="rpt-card rpt-insight">
              <div class="rpt-insight-top"><span class="rpt-toc-icon">${icon(ic)}</span><span>${pad(i + 1)}</span></div>
              ${edit(`${id}-t`, T[`${id}-t`], 'h2')}
              ${edit(`${id}-p`, T[`${id}-p`])}
            </div>`).join('')}</div>
          ${edit('p9-close', T['p9-close'], 'p', 'rpt-close')}
          <footer class="rpt-foot"><span>Fuente: análisis Lima Retail sobre Meta Ads + Google Ads · ${CLIENTE} · ${esc(`${emitidoMes.mes} ${emitidoMes.year}`.toLowerCase())}</span></footer>
        </div>
      </section>`;

    // 10 · Cierre
    const closing = `
      <section class="rpt-page rpt-closing" data-foot="none">
        <div class="rpt-main">
          <div class="rpt-closing-card"><img src="${LOGO}" alt=""><strong>Lima Retail</strong><span>Data Driven Marketing</span><small>Power KPI · Digital Analytics</small></div>
        </div>
      </section>`;

    const list = [cover, contents, resumen, objetivo, ventasWeb, whatsapp, marcaPage, googlePage, conclusiones, closing];
    // Pie: marca, cliente, mes y número de página en las láminas interiores, como el modelo.
    return list.map((html, i) => (i === 0 || i === list.length - 1 ? html : html.replace('</span></footer>',
      `</span><span class="rpt-foot-brand"><img src="${LOGO}" alt=""><strong>Lima Retail</strong>${CLIENTE} · Reporte de ${esc(mesAnio)} · ${pad(i + 1)} / ${pad(list.length)}</span></footer>`)))
      .map(html => `<div class="rpt-frame">${html}</div>`).join('');
  }

  // ── Pintado ──
  let current = null;
  function texts0(R) {
    const T = texts(R);
    const saved = readNotes()[R.per.key] || {};
    Object.keys(saved).forEach(k => { if (typeof saved[k] === 'string') T[k] = saved[k]; });
    return T;
  }

  function fit() {
    const host = document.getElementById('rpt-report');
    const doc = host?.querySelector('.rpt');
    if (!doc) return;
    const w = host.clientWidth;
    if (w > 0) doc.style.setProperty('--rpt-s', String(Math.min(1, (w - 2) / 1282)));
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
  }

  // ── Edición ──
  function onInput(e) {
    const el = e.target.closest?.('[data-rpt-edit]');
    if (!el || !current) return;
    saveNote(current.R.per.key, el.dataset.rptEdit, cleanHtml(el));
  }
  function onPaste(e) {
    if (!e.target.closest?.('[data-rpt-edit]')) return;
    e.preventDefault();
    const text = (e.clipboardData || global.clipboardData)?.getData('text/plain') || '';
    document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
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
      if (host && typeof ResizeObserver === 'function') {
        resizer = new ResizeObserver(fit);
        resizer.observe(host);
      }
    }
    setKind(kind);
  }

  global.ReporteMensual = { init };
})(window);
