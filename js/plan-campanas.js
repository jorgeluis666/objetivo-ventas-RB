/* ============================================================
   plan-campanas.js — Proyecciones · pestaña «Plan por campaña» (Plano + Picos)
   Lleva al tablero la «Estrategia de Inversión · Plano + Picos · Q4 2026» de Lima Retail,
   con las cifras de las carpetas de Drive en vez de las del documento:
     Objetivos 2026      metas por canal y mes (data/objetivos-2026.json) e histórico de
                         ventas por mes calendario, con la curva semanal 2025 (data/ventas-2026.json).
     Gasto publicitario  inversión y resultados por campaña de Meta Ads y Google Ads
                         (data/ads-2026.json).
   Por campaña: inversión plana × ROAS real = facturación; cada pico suma su inversión × el
   ROAS de pico. Los ROAS salen de meses de referencia que se pueden cambiar en la vista (por
   defecto los de la estrategia: junio y julio para el plano, agosto para el pico); Google usa
   todos los meses cerrados. Solo las decisiones de la estrategia (picos, branding, escenarios
   de WhatsApp) viven en ESTRATEGIA.
   Expone window.PlanCampanas.render({ plan, ventas, gasto }) (lo llama projections.js).
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const { months, chToUpper } = ds;

  const YEAR = 2026;

  // ── Decisiones de la estrategia: lo único que no sale de Drive ──
  const ESTRATEGIA = {
    // Meses de referencia por defecto: normales, sin promo, para el plano; la gran promo para el pico
    referencia: { plano: ['Junio', 'Julio'], pico: ['Agosto'] },
    branding: 300,   // S/. por mes en Reconocimiento: presencia de marca y tráfico a la Tienda
    // Inversión extra solo en la ventana del pico (tomada de la curva 2025), al ROAS de pico.
    // campaña: cómo se reconoce en Meta la campaña del pico, por su nombre, para medir lo real.
    picos: [
      { mes: 'Noviembre', nombre: 'Black Days',    desde: 24, hasta: 28, inversion: 1000, campaña: /black\s*(days|friday)|cyber/i },
      { mes: 'Diciembre', nombre: 'Push Navideño', desde: 13, hasta: 16, inversion: 1000, campaña: /navid|christmas/i },
    ],
    // WhatsApp al escalar: la estrategia baja su ROAS de 16x a 13x y a 10x (se aplican esas proporciones)
    escenariosWA: [
      { factor: 1,       nombre: 'Actual',   lectura: 'Escenario actual: máxima eficiencia' },
      { factor: 13 / 16, nombre: 'Moderado', lectura: 'Escalamiento moderado' },
      { factor: 10 / 16, nombre: 'Alto',     lectura: 'Escalamiento alto / saturación' },
    ],
  };

  // Tienda física: se sostiene con branding, no por ROAS, y queda fuera del objetivo online.
  const FISICO = 'Tienda';
  // Columnas del histórico de cada canal si el archivo de objetivos no las trae (campo sheet).
  const DEFAULT_SHEETS = { Web: ['Web'], Redes: ['WhatsApp', 'Instagram', 'Facebook'], Outlet: ['Showroom'], Tienda: ['Tienda'] };
  // Líneas del plan, con los colores de fuente de Proyecciones y Gasto publicitario
  const LINEAS = {
    web:      { label: 'Plano · Web (E-Commerce)',                color: '#1877F2' },
    wa:       { label: 'Plano · WhatsApp',                        color: '#25D366' },
    google:   { label: 'Plano · Google (tráfico + remarketing)',  color: '#4285F4' },
    branding: { label: 'Branding · Reconocimiento (→ Tienda)',    color: '#E1306C' },
    pico:     { label: 'Pico',                                    color: '#8B5CF6' },
    otras:    { label: 'Fuera del plan · otras campañas de Meta', color: '#94A3B8' },
  };
  // Rol de cada tipo de campaña de Google en el embudo
  const ROL_GOOGLE = {
    'Búsqueda': 'Captura demanda',
    'Máximo rendimiento': 'Volumen y prospecting',
    'Shopping': 'Catálogo de productos',
    'Generación de demanda': 'Chats a WhatsApp (video)',
    'Video': 'Chats a WhatsApp (video)',
  };
  const REF_KEY = 'rb-plan-ref';
  const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const axisColor = '#94A3B8';
  const gridColor = 'rgba(15,23,42,0.06)';
  const objColor = '#f59e0b';
  const planoColor = '#2563eb';

  // ── Formato: "S/. " y es-PE, como el resto del tablero ──
  const esc   = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num   = n => Math.round(n || 0).toLocaleString('es-PE');
  const money = (n, dec = 0) => 'S/. ' + (n || 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const signed = n => (n >= 0 ? '+' : '−') + money(Math.abs(n));
  const fmtS  = n => {
    const a = Math.abs(n);
    if (a >= 1e6) return 'S/. ' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return 'S/. ' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return 'S/. ' + Math.round(n);
  };
  const fmtR  = n => (n == null ? '—' : n.toFixed(1) + 'x');
  const pctSigned = r => (r >= 0 ? '+' : '−') + Math.round(Math.abs(r) * 100) + '%';
  const sum   = (list, f = x => x) => list.reduce((s, x) => s + (f(x) || 0), 0);
  const ratio = (a, b) => (b > 0 ? a / b : null);
  // Presupuestos en soles redondos: al S/. 10 (WhatsApp hacia arriba, para no quedar debajo de su meta)
  const round10 = n => Math.round(n / 10) * 10;
  const ceil10  = n => Math.ceil(n / 10) * 10;

  let _plan = null;     // Objetivos: data/objetivos-2026.json
  let _ventas = null;   // Objetivos: { meses, semanas, dias, ultimoDia, semanas2025 } por mes calendario
  let _gasto = null;    // Gasto publicitario: data/ads-2026.json
  let _mes = null;
  let _refGuardada = null;
  try { _refGuardada = JSON.parse(localStorage.getItem(REF_KEY) || 'null'); } catch (e) { /* storage bloqueado o dato roto */ }

  // ── Calendario ──
  const monthIdx = m => months.indexOf(m);
  const monthId  = m => `${YEAR}-${String(monthIdx(m) + 1).padStart(2, '0')}`;
  const daysIn   = m => new Date(YEAR, monthIdx(m) + 1, 0).getDate();
  const lastIso  = m => `${monthId(m)}-${String(daysIn(m)).padStart(2, '0')}`;
  const corto    = m => SHORT[monthIdx(m)];
  const fecha    = iso => `${+iso.slice(8, 10)} ${SHORT[+iso.slice(5, 7) - 1]}`;
  const ayerLima = () => new Date(Date.now() - 29 * 3600 * 1000).toISOString().slice(0, 10);
  // Último día con ventas en el histórico (sin el dato, ayer en Lima)
  const ventasHasta = () => _ventas?.ultimoDia || ayerLima();
  // Mes cerrado: el histórico ya trae la venta del mes completa
  const cerrado = m => ventasHasta() >= lastIso(m);
  // "del mes", "al 4 oct" o, si el informe no trae fechas, "a la fecha"
  const alDia = (iso, m) => (!iso ? 'a la fecha' : iso === lastIso(m) ? 'del mes' : `al ${fecha(iso)}`);
  // "jun – jul", "ago", "ene – sep", "ene – ago (sin jul)" o, con más huecos, "feb, may, ago"
  function rangoMeses(list) {
    if (!list.length) return '—';
    const sorted = [...list].sort((a, b) => monthIdx(a) - monthIdx(b));
    if (sorted.length === 1) return corto(sorted[0]);
    const desde = monthIdx(sorted[0]);
    const hasta = monthIdx(sorted[sorted.length - 1]);
    const faltan = months.slice(desde, hasta + 1).filter(m => !sorted.includes(m));
    const rango = `${corto(sorted[0])} – ${corto(sorted[sorted.length - 1])}`;
    if (!faltan.length) return rango;
    return faltan.length <= 2 && sorted.length > 2 ? `${rango} (sin ${faltan.map(corto).join(' ni ')})` : sorted.map(corto).join(', ');
  }
  const ventana = p => `${p.desde} – ${p.hasta} ${corto(p.mes)}`;
  const delAl = p => `del ${p.desde} al ${p.hasta} ${corto(p.mes)}`;

  // ── Objetivos 2026: canales, metas y ventas ──
  const canal = key => (_plan?.canales || []).find(c => c.key === key) || null;
  const sheetOf = key => canal(key)?.sheet || DEFAULT_SHEETS[key] || [];
  const venta = (m, key) => sum(sheetOf(key), col => _ventas?.meses?.[m]?.[col]);
  const labelCanal = key => canal(key)?.label || key;
  // Canales online: todos los del archivo de objetivos menos la Tienda física, en el orden de la
  // estrategia (Web, WhatsApp, Outlet) y después cualquier otro.
  const ORDEN_ONLINE = ['Web', 'Redes', 'Outlet'];
  const onlineKeys = () => {
    const keys = (_plan?.canales || []).map(c => c.key).filter(k => k !== FISICO);
    const pos = k => (ORDEN_ONLINE.includes(k) ? ORDEN_ONLINE.indexOf(k) : ORDEN_ONLINE.length);
    return keys.length ? keys.sort((a, b) => pos(a) - pos(b)) : ORDEN_ONLINE;
  };
  const metaDe = (m, key) => _plan?.metas?.[m]?.[key] || 0;
  const planMeses = () => (_plan?.meses || []).filter(m => months.includes(m));

  // ── Gasto publicitario: campañas por línea del plan ──
  const gastoMonth = m => (_gasto?.months || []).find(x => x.id === monthId(m)) || null;

  // Línea del plan de una campaña de Meta en el mes m: la del pico del mes si su nombre coincide;
  // si no, por su tipo de resultado, como las fuentes de Proyecciones.
  function lineaMeta(c, m) {
    if (ESTRATEGIA.picos.some(p => p.mes === m && p.campaña?.test(c.campaign || ''))) return 'pico';
    if (c.resultType === 'Compras en el sitio web') return 'web';
    if (c.resultType === 'Conversaciones con mensajes iniciadas') return 'wa';
    if (c.objective === 'Reconocimiento') return 'branding';
    return 'otras';
  }

  // Meta Ads de un mes por línea del plan (null sin informe)
  function metaMes(m) {
    const block = gastoMonth(m)?.meta;
    if (!block) return null;
    const out = {};
    for (const k of ['web', 'wa', 'branding', 'pico', 'otras']) {
      out[k] = { spend: 0, value: 0, purchases: 0, conversations: 0, impressions: 0, campaigns: [] };
    }
    for (const c of block.campaigns || []) {
      const l = out[lineaMeta(c, m)];
      l.spend += c.spend || 0;
      l.value += c.purchaseValue || 0;
      l.purchases += c.purchases || 0;
      l.conversations += c.conversations || 0;
      l.impressions += c.impressions || 0;
      if (c.spend > 0) l.campaigns.push(c.campaign);
    }
    return out;
  }

  // Chats a WhatsApp de Google: conversiones de la categoría Contacto; sin ese desglose, las que no son compras
  function chatsGoogle(x) {
    const cats = x.conversionsByCategory;
    const contacto = cats && Object.keys(cats).find(k => /contacto/i.test(k));
    return contacto ? cats[contacto] || 0 : Math.max(0, (x.conversions || 0) - (x.purchases || 0));
  }

  // Días del mes que cubre el informe de una plataforma (null sin informe o si no trae fechas)
  function diasCubiertos(block, m) {
    const c = block?.coverage;
    if (!c) return null;
    if (c.complete) return daysIn(m);
    if (!c.end) return null;
    return c.end.slice(0, 7) === monthId(m) ? +c.end.slice(8, 10) : c.end > lastIso(m) ? daysIn(m) : 0;
  }

  // ── Meses de referencia ──────────────────────────────────────
  // Sirven de referencia los meses cerrados con informe completo de Meta Ads.
  const elegible = m => cerrado(m) && !!gastoMonth(m)?.meta?.coverage?.complete;
  const elegibles = () => months.filter(elegible);

  function referencia() {
    const ok = list => (Array.isArray(list) ? list : []).filter(m => months.includes(m) && elegible(m));
    let plano = ok(_refGuardada?.plano);
    if (!plano.length) plano = ok(ESTRATEGIA.referencia.plano);
    // Sin los meses de la estrategia: los dos últimos elegibles que no sean de pico
    if (!plano.length) plano = elegibles().filter(m => !ESTRATEGIA.referencia.pico.includes(m)).slice(-2);
    let pico = ok(_refGuardada?.pico);
    if (!pico.length) pico = ok(ESTRATEGIA.referencia.pico);
    if (!pico.length) {
      // Sin el mes de la estrategia: el de mayor ROAS Web
      const roasWeb = m => { const x = metaMes(m); return (x && ratio(venta(m, 'Web'), x.web.spend + x.pico.spend)) || 0; };
      const mejor = elegibles().sort((a, b) => roasWeb(b) - roasWeb(a))[0];
      pico = mejor ? [mejor] : [];
    }
    // «Volver a…» solo tiene sentido con una elección guardada distinta de la estrategia
    const igual = (a, b) => a.length === b.length && a.every(m => b.includes(m));
    const porDefecto = !_refGuardada || (igual(plano, ok(ESTRATEGIA.referencia.plano)) && igual(pico, ok(ESTRATEGIA.referencia.pico)));
    return { plano, pico, porDefecto };
  }

  function guardarReferencia(ref) {
    _refGuardada = { plano: ref.plano, pico: ref.pico };
    try { localStorage.setItem(REF_KEY, JSON.stringify(_refGuardada)); } catch (e) { /* storage bloqueado */ }
  }

  // ── ROAS real por campaña ────────────────────────────────────
  function calcRoas(ref) {
    const mm = Object.fromEntries(months.map(m => [m, metaMes(m)]));
    // Solo cuentan los meses en que la línea invirtió: sin campaña, sus ventas no tienen gasto con
    // qué dividirse. Si ninguno invirtió, quedan los marcados (para decir dónde faltó inversión).
    const conGasto = (lista, gasto) => {
      const con = lista.filter(m => mm[m] && gasto(m) > 0);
      return { meses: con.length ? con : lista, con };
    };
    // Lo que mueve la venta Web: las campañas de compras y, en un mes con pico, la del pico
    const gastoWeb = m => mm[m].web.spend + mm[m].pico.spend;

    // Web plano y pico: ventas Web reales ÷ inversión de las campañas de compras de Meta
    const w = conGasto(ref.plano, gastoWeb);
    const web = { meses: w.meses, ventas: sum(w.con, m => venta(m, 'Web')), spend: sum(w.con, gastoWeb) };
    web.roas = ratio(web.ventas, web.spend);
    web.invMes = web.spend / (w.con.length || 1);
    const pc = conGasto(ref.pico, gastoWeb);
    const pico = { meses: pc.meses, ventas: sum(pc.con, m => venta(m, 'Web')), spend: sum(pc.con, gastoWeb) };
    pico.roas = ratio(pico.ventas, pico.spend);

    // WhatsApp: ventas de Redes y WhatsApp ÷ campaña de mensajes. Su inversión plana es la que
    // lleva al objetivo promedio del canal en los meses del plan.
    const wm = conGasto(ref.plano, m => mm[m].wa.spend);
    const wa = {
      meses: wm.meses,
      ventas: sum(wm.con, m => venta(m, 'Redes')),
      spend: sum(wm.con, m => mm[m].wa.spend),
      conversations: sum(wm.con, m => mm[m].wa.conversations),
    };
    wa.roas = ratio(wa.ventas, wa.spend);
    wa.cpc = ratio(wa.spend, wa.conversations);
    const mp = planMeses();
    wa.objetivoProm = mp.length ? sum(mp, m => metaDe(m, 'Redes')) / mp.length : 0;

    // Google: valor de conversión ÷ costo de todos los meses cerrados con informe completo
    const gMeses = months.filter(m => cerrado(m) && gastoMonth(m)?.google?.coverage?.complete);
    const gTot = gMeses.map(m => gastoMonth(m).google.totals || {});
    const google = {
      meses: gMeses,
      cost: sum(gTot, t => t.cost),
      value: sum(gTot, t => t.conversionValue),
      purchases: sum(gTot, t => t.purchases),
      // El desglose por categoría de la cuenta va en el bloque de Google, no dentro de totals
      chats: sum(gMeses, m => {
        const g = gastoMonth(m).google;
        return chatsGoogle({ ...(g.totals || {}), conversionsByCategory: g.conversionsByCategory });
      }),
    };
    google.roas = ratio(google.value, google.cost);
    google.invMes = google.cost / (gMeses.length || 1);
    google.chatsMes = google.chats / (gMeses.length || 1);

    // Branding: CPM de Reconocimiento en los meses cerrados con inversión
    const bMeses = elegibles().filter(m => mm[m]?.branding.spend > 0);
    const branding = {
      meses: bMeses,
      spend: sum(bMeses, m => mm[m].branding.spend),
      impressions: sum(bMeses, m => mm[m].branding.impressions),
    };
    branding.cpm = branding.impressions ? branding.spend / branding.impressions * 1000 : null;
    branding.impresionesMes = branding.cpm ? ESTRATEGIA.branding / branding.cpm * 1000 : null;

    // Tienda física: venta promedio de los meses normales
    const tienda = { meses: ref.plano, ventaMes: sum(ref.plano, m => venta(m, FISICO)) / (ref.plano.length || 1) };

    return { web, pico, wa, google, branding, tienda };
  }

  // ── Plan de un mes ───────────────────────────────────────────
  function planMes(m, R) {
    const lineas = [];
    const linea = (key, inv, roas, extra = {}) => {
      const fact = inv != null && roas != null ? inv * roas : null;
      lineas.push({ key, ...LINEAS[key], inv, roas, fact, ...extra });
    };
    linea('web', R.web.roas != null ? round10(R.web.invMes) : null, R.web.roas);
    linea('wa', R.wa.roas ? ceil10(R.wa.objetivoProm / R.wa.roas) : null, R.wa.roas);
    linea('google', R.google.roas != null ? round10(R.google.invMes) : null, R.google.roas);
    linea('branding', ESTRATEGIA.branding, null, { branding: true });
    const pico = ESTRATEGIA.picos.find(p => p.mes === m) || null;
    if (pico) linea('pico', pico.inversion, R.pico.roas, { pico, label: `Pico · ${pico.nombre} (${ventana(pico)})` });

    const plano = lineas.filter(l => l.key !== 'pico');
    const objetivos = onlineKeys().map(k => ({ key: k, label: labelCanal(k), valor: metaDe(m, k) }));
    const p = {
      mes: m, lineas, pico,
      invPlano: sum(plano, l => l.inv),
      invPico: pico ? pico.inversion : 0,
      factPlano: sum(plano, l => l.fact),
      factPico: sum(lineas.filter(l => l.key === 'pico'), l => l.fact),
      objetivos,
      objetivo: sum(objetivos, o => o.valor),
    };
    p.inv = p.invPlano + p.invPico;
    p.fact = p.factPlano + p.factPico;
    p.roas = ratio(p.fact, p.inv);
    // Proyección parcial: alguna línea con ROAS se quedó sin él. Sin esa línea no hay veredicto.
    p.sinRoas = lineas.filter(l => !l.branding && l.fact == null);
    p.comparable = p.objetivo > 0 && !p.sinRoas.length;
    p.brecha = p.comparable ? p.fact - p.objetivo : null;
    p.sobre = p.comparable ? p.fact / p.objetivo - 1 : null;
    p.cumple = p.comparable && p.fact >= p.objetivo;
    return p;
  }

  // Lo real del mes: ventas del histórico (null si el mes aún no empieza) e inversión de Gasto
  // publicitario por línea del plan (null sin informes del mes).
  function realMes(m) {
    const u = ventasHasta();
    const hasta = u < `${monthId(m)}-01` ? null : u > lastIso(m) ? lastIso(m) : u;
    const ventas = hasta ? {
      hasta, dias: +hasta.slice(8, 10),
      online: sum(onlineKeys(), k => venta(m, k)),
      redes: venta(m, 'Redes'),
      tienda: venta(m, FISICO),
    } : null;

    const gm = gastoMonth(m);
    if (!gm || (!gm.meta && !gm.google)) return { ventas, gasto: null };
    const mm = metaMes(m);
    const g = gm.google;
    const diasMeta = diasCubiertos(gm.meta, m);
    const diasGoogle = diasCubiertos(g, m);
    const spend = {
      web: mm ? mm.web.spend : null,
      wa: mm ? mm.wa.spend : null,
      branding: mm ? mm.branding.spend : null,
      pico: mm ? mm.pico.spend : null,
      otras: mm ? mm.otras.spend : null,
      google: g ? g.totals?.cost || 0 : null,
    };
    // Hasta qué día llegan los informes: el más corto de los que traen fechas
    const conFechas = [diasMeta, diasGoogle].filter(d => d > 0);
    const fin = conFechas.length ? Math.min(...conFechas) : null;
    return {
      ventas,
      gasto: {
        spend,
        campañas: { pico: mm?.pico.campaigns || [], otras: mm?.otras.campaigns || [] },
        dias: { web: diasMeta, wa: diasMeta, branding: diasMeta, pico: diasMeta, otras: diasMeta, google: diasGoogle },
        total: sum(Object.values(spend)),
        hasta: fin ? `${monthId(m)}-${String(fin).padStart(2, '0')}` : null,
      },
    };
  }

  // ── Curva 2025: venta digital por semana (lunes a domingo, recortadas al mes, como el histórico) ──
  function curva2025(m) {
    const weeks = _ventas?.semanas2025?.[m];
    if (!weeks?.length) return null;
    const mi = monthIdx(m);
    const dias = new Date(YEAR - 1, mi + 1, 0).getDate();
    const rangos = [];
    for (let d = 1; d <= dias; d++) {
      if (d === 1 || new Date(YEAR - 1, mi, d).getDay() === 1) rangos.push({ desde: d, hasta: d });
      else rangos[rangos.length - 1].hasta = d;
    }
    const cols = [...sheetOf('Web'), ...sheetOf('Redes')].map(c => chToUpper[c] || c.toUpperCase());
    return rangos.map((r, i) => {
      const row = weeks.find(w => w.w === i + 1) || {};
      const valor = sum(cols, c => row[c]);
      const n = r.hasta - r.desde + 1;
      return { mes: m, ...r, valor, dias: n, porDia: valor / n };
    });
  }

  // Cuánto vendió en 2025 la ventana de un pico frente al resto de su mes (venta por día)
  function evidenciaPico(p) {
    const semanas = curva2025(p.mes);
    if (!semanas) return null;
    const dentro = semanas.filter(s => s.hasta >= p.desde && s.desde <= p.hasta);
    const fuera = semanas.filter(s => !dentro.includes(s));
    const porDia = list => ratio(sum(list, s => s.valor), sum(list, s => s.dias));
    const enPico = porDia(dentro);
    const resto = porDia(fuera);
    return {
      unaSemana: dentro.length === 1,
      desde: dentro[0]?.desde, hasta: dentro[dentro.length - 1]?.hasta,
      porDia: enPico, veces: enPico != null && resto ? enPico / resto : null,
    };
  }

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════
  const $ = id => document.getElementById(id);
  const goto = (view, text) => `<button type="button" class="btn ghost btn-sm" data-goto="${view}">${text}</button>`;
  const wireGoto = el => el.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelector(`.s-item[data-view="${btn.dataset.goto}"]`)?.click();
  }));
  const pip = color => `<span class="plan-pip" style="background:${color};"></span>`;

  function defaultMes() {
    const lista = planMeses();
    const hoy = ventasHasta().slice(0, 7);
    return lista.find(m => monthId(m) === hoy) || lista.find(m => monthId(m) > hoy) || lista[lista.length - 1] || null;
  }

  function renderMesSelector() {
    const el = $('plan-mes-selector');
    if (!el) return;
    el.innerHTML = planMeses().map(m => {
      const on = m === _mes;
      return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}" data-mes="${m}" aria-pressed="${on}" title="${m} ${YEAR}">${m.slice(0, 3)}</button>`;
    }).join('');
    el.querySelectorAll('[data-mes]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.mes === _mes) return;
      _mes = btn.dataset.mes;
      renderTodo();
      // renderTodo rehace los botones: el foco vuelve al mes elegido
      $('plan-mes-selector')?.querySelector(`[data-mes="${_mes}"]`)?.focus();
    }));
  }

  // Rol del mes en la estrategia, con lo que dicen las cifras
  function renderPeriodo(p, real) {
    const el = $('plan-periodo');
    if (!el) return;
    const sig = ESTRATEGIA.picos.find(x => monthIdx(x.mes) > monthIdx(p.mes) && planMeses().includes(x.mes));
    const rol = p.pico
      ? `<b>Pico</b> · ${esc(p.pico.nombre)}: ${money(p.pico.inversion)} extra ${delAl(p.pico)}`
      : `<b>Plano</b> · sin pico${sig ? `: se preparan los artes de ${esc(sig.nombre)} (${ventana(sig)})` : ''}`;
    const v = real.ventas;
    const dia = !v ? 'aún no empieza' : v.hasta === lastIso(p.mes) ? 'mes cerrado' : `día ${v.dias} de ${daysIn(p.mes)}`;
    // Un solo elemento: dentro del flex de .rep-period-meta, el texto corta como texto corrido
    el.innerHTML = `<span>${p.mes} ${YEAR} · ${dia} · ${rol}</span>`;
  }

  // De dónde sale cada dato, como la franja de la pestaña Ritmo del mes
  function renderFuentes(p, R) {
    const el = $('plan-fuentes');
    if (!el) return;
    const archivo = _plan?.fuente?.archivo?.nombre || 'Objetivos Royal Baby';
    const ventasTxt = _ventas?.ultimoDia ? `ventas al ${fecha(_ventas.ultimoDia)}` : 'sin fecha del histórico de ventas';
    const informes = (_gasto?.months || []).filter(x => x.id.startsWith(String(YEAR)));
    const ultimo = informes[informes.length - 1];
    const mesDe = x => months[+x.id.slice(5, 7) - 1];
    const plat = (name, block) => !block ? `${name}: sin informe de ${mesDe(ultimo).toLowerCase()}`
      : block.coverage?.complete ? `${name} con ${mesDe(ultimo).toLowerCase()} completo`
      : block.coverage?.end ? `${name} al ${fecha(block.coverage.end)}`
      : `${name}: el informe no trae fechas`;
    const gastoTxt = !informes.length ? 'no se pudieron cargar los informes de pauta'
      : `informes de ${rangoMeses(informes.map(mesDe))} · ${plat('Meta Ads', ultimo.meta)} · ${plat('Google Ads', ultimo.google)}`;
    el.innerHTML = `
      <div class="gp-source">
        <div class="gp-source-l">
          <span class="gp-dot ${p.objetivo > 0 && _ventas?.ultimoDia ? 'ok' : 'warn'}"></span>
          <span class="proj-src-text"><b>Objetivos 2026</b> · metas por canal y ventas<small>metas de ${rangoMeses(planMeses())} del archivo «${esc(archivo)}» · ${ventasTxt}</small></span>
        </div>
        ${goto('view-obj', 'Ver módulo')}
      </div>
      <div class="gp-source">
        <div class="gp-source-l">
          <span class="gp-dot ${R.web.roas != null && R.google.roas != null ? 'ok' : 'warn'}"></span>
          <span class="proj-src-text"><b>Gasto publicitario</b> · inversión y resultados por campaña<small>${gastoTxt}</small></span>
        </div>
        ${goto('view-rep', 'Ver módulo')}
      </div>`;
    wireGoto(el);
  }

  // ── KPIs del mes ─────────────────────────────────────────────
  function renderKpis(p, real) {
    const el = $('plan-kpis');
    if (!el) return;
    const pill = (label, value, subs, color) => `
      <div class="kpi-pill">
        <span>${label}</span>
        <strong${color ? ` style="color:${color}"` : ''}>${value}</strong>
        ${subs.filter(Boolean).map(s => `<small>${s}</small>`).join('')}
      </div>`;
    const { ventas: v, gasto: g } = real;
    el.innerHTML = [
      pill('Inversión del mes', money(p.inv), [
        p.invPico ? `Plano ${money(p.invPlano)} · Pico ${money(p.invPico)}` : `Plano ${money(p.invPlano)} · sin pico`,
        g ? `Ejecutado ${alDia(g.hasta, p.mes)}: ${money(g.total)} (Meta + Google)` : '',
      ]),
      pill('Facturación proyectada', money(p.fact), [
        p.invPico ? `Plano ${money(p.factPlano)} · Pico ${money(p.factPico)}` : `Plano ${money(p.factPlano)} · sin pico`,
        p.roas ? `ROAS del plan ~${fmtR(p.roas)}` : '',
      ]),
      pill('Objetivo online', p.objetivo > 0 ? money(p.objetivo) : '—', [
        p.objetivos.map(o => `${esc(o.label)} ${money(o.valor)}`).join(' · '),
        v && p.objetivo > 0 ? `Venta online ${alDia(v.hasta, p.mes)}: ${money(v.online)} (${Math.round(v.online / p.objetivo * 100)}%)` : '',
      ]),
      pill('Sobre el objetivo', p.sobre != null ? pctSigned(p.sobre) : '—', [
        !(p.objetivo > 0) ? 'Sin objetivo para el mes'
          : !p.comparable ? `Proyección parcial: sin ROAS de ${sinRoasTxt(p)}`
          : p.cumple ? `Cumple: ${signed(p.brecha)} de margen` : `No cumple: faltan ${money(-p.brecha)}`,
      ], p.comparable ? (p.cumple ? 'var(--green-text)' : 'var(--red-text)') : null),
    ].join('');
  }
  // "Web", "Web y WhatsApp", "Web, WhatsApp y Google": las líneas que se quedaron sin ROAS
  const sinRoasTxt = p => {
    const n = p.sinRoas.map(l => l.label.replace(/^(Plano|Pico) · /, '').replace(/ \(.*\)$/, ''));
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0] || '';
  };

  // ── Distribución del mes por campaña ─────────────────────────
  // Nombres de las campañas de una línea en Drive: los del mes elegido o, si no tiene, los del
  // último mes en que invirtió.
  function campañasDe(key) {
    const nombres = m => (key === 'google'
      ? (gastoMonth(m)?.google?.campaigns || []).filter(c => (c.cost || 0) > 0).map(c => c.campaign)
      : metaMes(m)?.[key]?.campaigns || []);
    for (const m of [_mes, ...[...months].reverse()]) {
      const list = nombres(m);
      if (list.length) return { list, mes: m };
    }
    return { list: [], mes: null };
  }

  function renderTabla(p, real, R) {
    const el = $('plan-tabla');
    if (!el) return;
    const g = real.gasto;

    // Inversión real de una línea y su ritmo frente a la inversión plana. El pico invierte solo en
    // su ventana: se compara lo invertido con su monto, sin llevarlo a ritmo mensual.
    const celdaReal = l => {
      if (!g) return '';
      const s = g.spend[l.key];
      if (s == null) return '<td class="r muted">—</td>';
      const real = `<span class="plan-real">${money(s)}</span>`;
      if (l.key === 'pico') {
        if (!s) return `<td class="r">${real}<span class="pill gray plan-ritmo" title="Ninguna campaña de Meta de ${esc(p.mes.toLowerCase())} con el nombre del pico">sin campaña</span></td>`;
        const pct = s / l.inv;
        // Mientras la ventana no termina, el avance es informativo; cerrada, se juzga como el plano
        const cerrada = !!g.hasta && +g.hasta.slice(8, 10) >= p.pico.hasta;
        const cls = !cerrada ? 'gray' : pct >= 0.85 && pct <= 1.15 ? 'green' : 'amber';
        return `<td class="r">${real}<span class="pill ${cls} plan-ritmo" title="Invertido en la campaña del pico frente a sus ${money(l.inv)}${cerrada ? '' : ' (la ventana aún no termina)'}">${Math.round(pct * 100)}% del pico</span></td>`;
      }
      const dias = g.dias[l.key];
      if (!dias) return `<td class="r">${real}</td>`;   // sin fechas en el informe no hay ritmo
      const ritmo = s / dias * daysIn(p.mes);
      const pct = l.inv ? ritmo / l.inv : null;
      const completo = dias === daysIn(p.mes);
      const cls = pct == null ? 'gray' : pct >= 0.85 && pct <= 1.15 ? 'green' : 'amber';
      const tip = pct == null ? '' : completo
        ? `Se invirtió el ${Math.round(pct * 100)}% de la inversión plana`
        : `Al ritmo de lo que va del mes (${money(ritmo)}/mes) cubre el ${Math.round(pct * 100)}% de la inversión plana`;
      return `<td class="r">${real}${pct != null
        ? `<span class="pill ${cls} plan-ritmo" title="${tip}">${completo ? '' : 'ritmo '}${Math.round(pct * 100)}%</span>` : ''}</td>`;
    };

    const sub = l => {
      if (l.key === 'pico') {
        const camp = g?.campañas.pico || [];
        return `${money(p.pico.inversion)} extra solo en la ventana, en video${camp.length ? ` · ${esc(camp.join(' · '))}` : ''}`;
      }
      const c = campañasDe(l.key);
      if (!c.list.length) return l.key === 'google' ? 'Sin campañas de Google en Drive' : 'Sin campaña en Drive';
      return esc(c.list.join(' · ')) + (c.mes !== p.mes ? ` <span class="muted">(${corto(c.mes)})</span>` : '');
    };

    const fila = l => `
      <tr>
        <td><div class="plan-concepto">${pip(l.color)}<div><b>${esc(l.label)}</b><small>${sub(l)}</small></div></div></td>
        <td class="r">${l.inv != null ? money(l.inv) : '—'}</td>
        <td class="r">${l.branding ? '<span class="pill gray">Branding</span>' : fmtR(l.roas)}</td>
        <td class="r">${l.branding ? '<span class="muted">Soporte Tienda</span>' : l.fact != null ? money(l.fact) : '—'}</td>
        ${celdaReal(l)}
      </tr>`;

    const sinPico = p.pico ? '' : `
      <tr class="plan-fuera">
        <td><div class="plan-concepto">${pip(LINEAS.pico.color)}<div><b>Pico</b><small>Sin pico este mes</small></div></div></td>
        <td class="r">${money(0)}</td><td class="r muted">—</td><td class="r muted">—</td>${g ? '<td class="r muted">—</td>' : ''}
      </tr>`;
    const otras = g && g.spend.otras > 0 ? `
      <tr class="plan-fuera">
        <td><div class="plan-concepto">${pip(LINEAS.otras.color)}<div><b>${LINEAS.otras.label}</b><small>${esc(g.campañas.otras.join(' · '))}</small></div></div></td>
        <td class="r muted">—</td><td class="r muted">—</td><td class="r muted">—</td>
        <td class="r"><span class="plan-real">${money(g.spend.otras)}</span></td>
      </tr>` : '';

    el.innerHTML = `
      <div class="gp-table-wrap"><table class="rep-table plan-camp-table">
        <thead><tr>
          <th>Concepto · campañas en Drive</th><th class="r">Inversión / mes</th><th class="r">ROAS</th><th class="r">Facturación</th>
          ${g ? `<th class="r">Real ${alDia(g.hasta, p.mes)}</th>` : ''}
        </tr></thead>
        <tbody>
          ${p.lineas.map(fila).join('')}
          ${sinPico}
          ${otras}
          <tr class="plan-total">
            <td><b>Total ${p.mes.toLowerCase()}</b></td>
            <td class="r"><b>${money(p.inv)}</b></td>
            <td class="r"><b>${p.roas ? '~' + fmtR(p.roas) : '—'}</b></td>
            <td class="r"><b>${money(p.fact)}</b></td>
            ${g ? `<td class="r"><b>${money(g.total)}</b></td>` : ''}
          </tr>
        </tbody>
      </table></div>
      <p class="gp-note">${claveMes(p, R)}${g ? ' La columna Real es la inversión de cada línea en Gasto publicitario; el % compara su ritmo mensual con la inversión plana (el pico, lo invertido con su monto).' : ''}</p>`;
  }

  // La «Clave» de cada mes en la estrategia, con las cifras del momento
  function claveMes(p, R) {
    const obj = !(p.objetivo > 0) ? 'sin objetivo para comparar'
      : !p.comparable ? `proyección parcial, sin ROAS de ${sinRoasTxt(p)}: no se compara con el objetivo online de ${money(p.objetivo)}`
      : `${p.cumple ? 'sobre' : 'bajo'} el objetivo online de ${money(p.objetivo)} (${pctSigned(p.sobre)})`;
    const falta = p.comparable && !p.cumple && R.web.roas
      ? ` Para cerrar la brecha harían falta ~${money(-p.brecha / R.web.roas)} más en Web al ROAS plano (${fmtR(R.web.roas)}).` : '';
    const pico = p.lineas.find(l => l.key === 'pico');
    const base = p.pico
      ? `el plano (${money(p.invPlano)}) más el pico de ${esc(p.pico.nombre)} —${money(p.pico.inversion)} ${delAl(p.pico)}${pico.fact != null ? `, ~${money(p.factPico)} al ROAS de pico de ${rangoMeses(R.pico.meses)}` : ''}— proyectan ${money(p.fact)}`
      : `el plano always-on (${money(p.invPlano)}) proyecta ${money(p.fact)}`;
    return `<b>Clave:</b> ${base}, ${obj}.${falta}`;
  }

  // ── Resumen del trimestre ────────────────────────────────────
  function renderResumen(planes) {
    const el = $('plan-resumen');
    if (!el) return;
    const tot = {
      invPlano: sum(planes, p => p.invPlano), invPico: sum(planes, p => p.invPico),
      fact: sum(planes, p => p.fact), objetivo: sum(planes, p => p.objetivo),
      sinRoas: planes.some(p => p.sinRoas.length),
      sinObjetivo: planes.some(p => !(p.objetivo > 0)),
    };
    // Sin ROAS en alguna línea la facturación es parcial; sin objetivo en algún mes no hay con qué comparar
    const cumple = (x, sinRoas, sinObjetivo) => (sinRoas
      ? '<span class="pill gray" title="Alguna línea se quedó sin ROAS: la facturación es parcial">Parcial</span>'
      : sinObjetivo ? `<span class="muted" title="${planes.length > 1 && x === tot ? 'Algún mes no tiene objetivo' : 'El mes no tiene objetivo'}">—</span>`
      : `<span class="pill ${x.fact >= x.objetivo ? 'green' : 'red'}">${x.fact >= x.objetivo ? 'Sí' : 'No'} · ${pctSigned(x.fact / x.objetivo - 1)}</span>`);
    // Inversión del mes con su reparto plano / pico debajo
    const inversion = x => `${money(x.invPlano + x.invPico)}<small class="plan-sub">plano ${num(x.invPlano)}${x.invPico ? ` + pico ${num(x.invPico)}` : ''}</small>`;
    el.innerHTML = `
      <div class="gp-table-wrap"><table class="rep-table">
        <thead><tr><th>Mes</th><th class="r">Inversión</th><th class="r">Facturación</th><th class="r">Objetivo online</th><th class="r">¿Cumple?</th></tr></thead>
        <tbody>
          ${planes.map(p => `
            <tr${p.mes === _mes ? ' class="plan-sel"' : ''}>
              <td><b>${p.mes}</b><small class="plan-sub">${p.pico ? `${esc(p.pico.nombre)} · ${ventana(p.pico)}` : 'sin pico'}</small></td>
              <td class="r">${inversion(p)}</td>
              <td class="r">${money(p.fact)}</td>
              <td class="r">${p.objetivo > 0 ? money(p.objetivo) : '—'}</td>
              <td class="r">${cumple(p, p.sinRoas.length > 0, !(p.objetivo > 0))}</td>
            </tr>`).join('')}
          <tr class="plan-total">
            <td><b>Total ${rangoMeses(planes.map(p => p.mes))}</b></td>
            <td class="r"><b>${inversion(tot)}</b></td>
            <td class="r"><b>${money(tot.fact)}</b></td>
            <td class="r"><b>${tot.objetivo > 0 ? money(tot.objetivo) : '—'}</b></td>
            <td class="r">${cumple(tot, tot.sinRoas, tot.sinObjetivo)}</td>
          </tr>
        </tbody>
      </table></div>
      <p class="gp-note">Facturación = plano (Web + WhatsApp + Google) + pico, contra el objetivo online: ${onlineKeys().map(k => esc(labelCanal(k))).join(' + ')}. Google suma su valor de conversión, que puede incluir ventas que también cuenta la Web: el reparto Meta/Google está por validar. La Tienda física se sostiene con branding, no con ROAS directo.</p>`;
  }

  function renderChartResumen(planes) {
    global.Charts.mount('chart-plan-resumen', {
      type: 'bar',
      data: {
        labels: planes.map(p => p.mes),
        datasets: [
          { type: 'bar', label: 'Facturación plano', data: planes.map(p => Math.round(p.factPlano)), backgroundColor: planoColor + 'CC', stack: 'f', borderRadius: 4, maxBarThickness: 46, order: 2 },
          { type: 'bar', label: 'Facturación pico', data: planes.map(p => Math.round(p.factPico)), backgroundColor: LINEAS.pico.color + 'CC', stack: 'f', borderRadius: 4, maxBarThickness: 46, order: 2 },
          { type: 'line', label: 'Objetivo online', data: planes.map(p => Math.round(p.objetivo)), borderColor: objColor, backgroundColor: objColor,
            borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${money(ctx.raw)}`,
            footer: items => {
              const p = planes[items[0].dataIndex];
              return `Inversión ${money(p.inv)}${p.sobre != null ? ` · ${pctSigned(p.sobre)} vs objetivo` : ''}`;
            },
          } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: axisColor, font: { size: 11 } } },
          y: { stacked: true, beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: fmtS }, grid: { color: gridColor } },
        },
      },
    });
  }

  // ── ROAS real por campaña y meses de referencia ──────────────
  function renderRoas(R, ref) {
    const el = $('plan-roas');
    if (!el) return;
    const tile = (label, roas, how, color) => `
      <div class="kpi-pill">
        <span>${pip(color)}${label}</span>
        <strong>${fmtR(roas)}</strong>
        <small>${how}</small>
      </div>`;
    const sinDatos = 'sin inversión en los meses de referencia';
    const def = ESTRATEGIA.referencia;
    el.innerHTML = `
      <div class="kpi-strip plan-roas-strip">
        ${tile(`Web plano · ${rangoMeses(R.web.meses)}`, R.web.roas, R.web.roas != null
          ? `Ventas Web ${money(R.web.ventas)} ÷ campañas de compras de Meta ${money(R.web.spend)}` : sinDatos, LINEAS.web.color)}
        ${tile(`Web pico · ${rangoMeses(R.pico.meses)}`, R.pico.roas, R.pico.roas != null
          ? `Ventas Web ${money(R.pico.ventas)} ÷ campañas de compras de Meta ${money(R.pico.spend)}` : sinDatos, LINEAS.pico.color)}
        ${tile(`WhatsApp · ${rangoMeses(R.wa.meses)}`, R.wa.roas, R.wa.roas != null
          ? `Ventas ${esc(labelCanal('Redes'))} ${money(R.wa.ventas)} ÷ campaña de mensajes ${money(R.wa.spend)}` : sinDatos, LINEAS.wa.color)}
        ${tile(`Google (Ecom) · ${rangoMeses(R.google.meses)}`, R.google.roas, R.google.roas != null
          ? `Valor conv. ${money(R.google.value)} ÷ costo ${money(R.google.cost)} · + ${num(R.google.chats)} chats de WhatsApp` : 'sin informes de Google Ads', LINEAS.google.color)}
      </div>
      <div class="plan-ref">
        <div class="proj-mes-wrap">
          <span class="proj-mes-label">Meses normales · plano</span>
          <div class="proj-mes-selector" data-ref="plano" role="group" aria-label="Meses de referencia del plano"></div>
        </div>
        <div class="proj-mes-wrap">
          <span class="proj-mes-label">Meses de pico</span>
          <div class="proj-mes-selector" data-ref="pico" role="group" aria-label="Meses de referencia del pico"></div>
        </div>
        ${ref.porDefecto ? '' : `<button type="button" class="btn ghost btn-sm" id="plan-ref-reset">Volver a ${rangoMeses(def.plano)} y ${rangoMeses(def.pico)}</button>`}
      </div>
      <p class="gp-note">ROAS = ventas reales del histórico (Objetivos 2026) ÷ inversión de la campaña (Gasto publicitario) en los meses marcados: normales, sin promo, para el plano y de gran promo para el pico. Google se mide con su valor de conversión en todos los meses cerrados; además genera tráfico y chats de WhatsApp que Meta remarketea. Los meses marcados se recuerdan en este navegador.</p>`;

    // Qué campañas faltaron en cada mes: esos meses no cuentan para el ROAS de esa línea
    const faltan = m => {
      const x = metaMes(m);
      return !x ? [] : [!(x.web.spend + x.pico.spend) && 'campaña de compras', !x.wa.spend && 'campaña de mensajes'].filter(Boolean);
    };
    for (const box of el.querySelectorAll('[data-ref]')) {
      const tipo = box.dataset.ref;
      box.innerHTML = months.filter(cerrado).map(m => {
        const ok = elegible(m);
        const on = ref[tipo].includes(m);
        const sin = ok ? faltan(m) : [];
        return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}${ok ? '' : ' sin-datos'}" data-m="${m}" aria-pressed="${on}"${ok ? '' : ' disabled'}
          title="${m}${ok ? (sin.length ? ` · sin ${sin.join(' ni ')}` : '') : ' · sin informe completo de Meta Ads'}">${m.slice(0, 3)}</button>`;
      }).join('');
      box.querySelectorAll('[data-m]:not(:disabled)').forEach(btn => btn.addEventListener('click', () => {
        const marcados = new Set(ref[tipo]);
        if (marcados.has(btn.dataset.m)) {
          if (marcados.size === 1) return;   // al menos un mes de referencia
          marcados.delete(btn.dataset.m);
        } else marcados.add(btn.dataset.m);
        guardarReferencia({ ...ref, [tipo]: months.filter(m => marcados.has(m)) });
        renderTodo();
        // renderTodo rehace los botones: el foco vuelve al mismo mes
        $('plan-roas')?.querySelector(`[data-ref="${tipo}"] [data-m="${btn.dataset.m}"]`)?.focus();
      }));
    }
    $('plan-ref-reset')?.addEventListener('click', () => {
      _refGuardada = null;
      try { localStorage.removeItem(REF_KEY); } catch (e) { /* storage bloqueado */ }
      renderTodo();
      $('plan-roas')?.querySelector('[data-ref="plano"] [data-m]:not(:disabled)')?.focus();
    });
  }

  // ── WhatsApp: escenarios de decrecimiento ────────────────────
  function renderWhatsApp(p, R, real) {
    const el = $('plan-wa');
    if (!el) return;
    const wa = p.lineas.find(l => l.key === 'wa');
    const redes = esc(labelCanal('Redes'));
    if (!R.wa.roas || !wa?.fact) {
      const motivo = !R.wa.meses.length ? 'No hay meses cerrados con el informe completo de Meta Ads para medir el ROAS de WhatsApp.'
        : !R.wa.spend ? `Sin inversión en la campaña de mensajes en ${rangoMeses(R.wa.meses)}: no hay ROAS de WhatsApp con el que armar los escenarios.`
        : !R.wa.ventas ? `Sin ventas de ${redes} en ${rangoMeses(R.wa.meses)}: el ROAS de WhatsApp sale 0x y no hay escenarios que armar.`
        : `El archivo de objetivos no trae meta de ${redes}: el plan no asigna inversión a la campaña de mensajes.`;
      el.innerHTML = `<p class="gp-note gp-note-top">${motivo}</p>`;
      return;
    }
    const factWA = wa.fact;
    const filas = ESTRATEGIA.escenariosWA.map(e => ({ ...e, roas: R.wa.roas * e.factor, inv: factWA / (R.wa.roas * e.factor) }));

    // Monitoreo: ROAS de WhatsApp en lo que va del mes (con tasas diarias, por si las ventas y el
    // informe de Meta llegan hasta días distintos), para ubicarlo en un escenario
    let monitoreo = '';
    const v = real.ventas;
    const g = real.gasto;
    if (v && g && g.spend.wa > 0 && g.dias.wa > 0) {
      const roasMes = (v.redes / v.dias) / (g.spend.wa / g.dias.wa);
      const cerca = filas.reduce((a, b) => (Math.abs(b.roas - roasMes) < Math.abs(a.roas - roasMes) ? b : a));
      const pocos = Math.min(v.dias, g.dias.wa) < 7;
      const lectura = pocos ? `Con ${Math.min(v.dias, g.dias.wa)} días de datos todavía no es una lectura firme.`
        : !v.redes ? `Sin ventas de ${redes} registradas en lo que va del mes: todavía no se puede ubicar en un escenario.`
        : roasMes >= filas[0].roas ? 'Rinde igual o mejor que la referencia.'
        : `Está cerca del escenario «${cerca.nombre}»: para sostener ${money(factWA)} harían falta ~${money(factWA / roasMes)}/mes.`;
      monitoreo = `<div class="insight ${pocos ? 'info' : v.redes && roasMes >= filas[1].roas ? 'ok' : 'warn'}" style="margin:12px 0 0;">
        <b>${p.mes} ${alDia(v.hasta, p.mes)}:</b> ventas ${redes} ${money(v.redes)} y campaña de mensajes ${money(g.spend.wa)}${g.dias.wa !== v.dias ? ` (${alDia(g.hasta, p.mes)})` : ''} = ROAS <b>${fmtR(roasMes)}</b>. ${lectura}
      </div>`;
    } else if (g && g.spend.wa === 0) {
      monitoreo = `<div class="insight warn" style="margin:12px 0 0;">La campaña de mensajes no registra inversión en ${p.mes.toLowerCase()} ${alDia(g.hasta, p.mes)}.</div>`;
    }

    el.innerHTML = `
      <div class="gp-table-wrap"><table class="rep-table">
        <thead><tr><th>Escenario</th><th class="r">ROAS WhatsApp</th><th class="r">Inversión para ${money(factWA)}</th></tr></thead>
        <tbody>${filas.map((f, i) => `
          <tr${i === 0 ? ' class="plan-sel"' : ''}>
            <td><b>${f.nombre}</b><small class="plan-sub">${f.lectura}</small></td>
            <td class="r">${fmtR(f.roas)}</td>
            <td class="r">${money(f.inv)}<small class="plan-sub">${i ? signed(f.inv - filas[0].inv) + ' vs actual' : 'plan'}</small></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      ${monitoreo}
      <p class="gp-note">Si al escalar baja el ROAS (rendimientos decrecientes), la inversión sube para sostener la misma facturación. La facturación de referencia es la del plano: ${money(wa.inv)}/mes al ${fmtR(R.wa.roas)} para cubrir el objetivo promedio de ${redes} (${money(R.wa.objetivoProm)}/mes en ${rangoMeses(planMeses())}).${R.wa.cpc ? ` Cada conversación costó ${money(R.wa.cpc, 2)} en ${rangoMeses(R.wa.meses)}.` : ''}</p>`;
  }

  // ── Google Ads: tráfico → remarketing ────────────────────────
  function renderGoogle(R) {
    const el = $('plan-google');
    if (!el) return;
    const G = R.google;
    if (!G.meses.length) {
      el.innerHTML = '<p class="gp-note gp-note-top">Sin informes cerrados de Google Ads en Drive.</p>';
      return;
    }
    // Campañas de los meses cerrados sumadas por nombre (tipo y estado del último mes en que aparecen)
    const porNombre = new Map();
    for (const m of G.meses) {
      for (const c of gastoMonth(m).google.campaigns || []) {
        const e = porNombre.get(c.campaign) || { campaign: c.campaign, cost: 0, value: 0, purchases: 0, chats: 0, complete: true };
        e.cost += c.cost || 0;
        e.value += c.conversionValue || 0;
        e.purchases += c.purchases || 0;
        e.chats += chatsGoogle(c);
        e.type = c.type || e.type;
        e.status = c.status || e.status;
        e.complete = e.complete && c.complete !== false;   // informe segmentado: sin costo por campaña
        porNombre.set(c.campaign, e);
      }
    }
    const lista = [...porNombre.values()].sort((a, b) => b.value - a.value || b.chats - a.chats || b.cost - a.cost);
    const rol = c => (c.purchases < 1 && c.chats >= 1 ? 'Chats a WhatsApp (JoinChat)' : ROL_GOOGLE[c.type] || c.type || '—');
    const estado = s => (!s ? '' : `<span class="pill ${/habilitad/i.test(s) ? 'green' : 'gray'}">${esc(s)}</span>`);
    el.innerHTML = `
      <dl class="rep-metrics">
        <div><dt>Costo / mes</dt><dd>${money(G.invMes)}</dd></div>
        <div><dt>Valor conv. / mes</dt><dd>${money(G.value / G.meses.length)}</dd></div>
        <div><dt>ROAS Ecom</dt><dd>${fmtR(G.roas)}</dd></div>
        <div><dt>Chats de WhatsApp / mes</dt><dd>${num(G.chatsMes)}</dd></div>
      </dl>
      <div class="gp-table-wrap" style="margin-top:12px;"><table class="rep-table">
        <thead><tr><th>Campaña · rol en el embudo</th><th class="r">Costo</th><th class="r">Valor conv.</th><th class="r">Resultado</th></tr></thead>
        <tbody>${lista.map(c => `
          <tr>
            <td><span class="rep-camp-name">${esc(c.campaign)}</span> ${estado(c.status)}<small class="plan-sub">${esc(rol(c))}${c.type ? ` · ${esc(c.type)}` : ''}</small></td>
            <td class="r">${c.complete ? money(c.cost) : '—'}</td>
            <td class="r">${c.value ? money(c.value) : '—'}</td>
            <td class="r">${[c.purchases >= 1 ? `${num(c.purchases)} compras` : '', c.chats >= 1 ? `${num(c.chats)} chats` : ''].filter(Boolean).join('<br>') || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="gp-note">Acumulado de ${rangoMeses(G.meses)}. Google genera demanda hacia la web y chats de WhatsApp (conversiones de contacto); Meta remarketea ese tráfico y cierra la venta. Por eso mantiene inversión propia, ~${money(round10(G.invMes))}/mes.</p>`;
  }

  // ── Branding → Tienda física ─────────────────────────────────
  function renderBranding(planes, R) {
    const el = $('plan-branding');
    if (!el) return;
    const B = R.branding;
    const tienda = esc(labelCanal(FISICO));
    el.innerHTML = `
      <dl class="rep-metrics">
        <div><dt>Inversión branding / mes</dt><dd>${money(ESTRATEGIA.branding)}</dd></div>
        <div><dt>CPM Reconocimiento</dt><dd>${B.cpm ? money(B.cpm, 2) : '—'}</dd></div>
        <div><dt>Impresiones / mes</dt><dd>${B.impresionesMes ? '~' + num(B.impresionesMes) : '—'}</dd></div>
        <div><dt>Ventas ${tienda} / mes</dt><dd>${money(R.tienda.ventaMes)}</dd></div>
      </dl>
      <div class="gp-table-wrap" style="margin-top:12px;"><table class="rep-table">
        <thead><tr><th>Mes</th><th class="r">Objetivo</th><th class="r">Venta</th><th class="r">Reconocimiento</th></tr></thead>
        <tbody>${planes.map(p => {
          const r = realMes(p.mes);
          return `<tr${p.mes === _mes ? ' class="plan-sel"' : ''}>
            <td><b>${p.mes}</b></td>
            <td class="r">${money(metaDe(p.mes, FISICO))}</td>
            <td class="r">${r.ventas ? `${money(r.ventas.tienda)}${r.ventas.hasta !== lastIso(p.mes) ? ` <small class="muted">al ${fecha(r.ventas.hasta)}</small>` : ''}` : '—'}</td>
            <td class="r">${r.gasto?.spend.branding != null ? money(r.gasto.spend.branding) : '—'}</td>
          </tr>`;
        }).join('')}
          <tr class="plan-total"><td><b>Total</b></td><td class="r"><b>${money(sum(planes, p => metaDe(p.mes, FISICO)))}</b></td><td></td><td></td></tr>
        </tbody>
      </table></div>
      <p class="gp-note">CPM de los meses cerrados con Reconocimiento: ${rangoMeses(B.meses)}. Las impresiones se estiman con él (Gasto publicitario no publica el alcance). ${tienda} no se mide por ROAS: ${money(ESTRATEGIA.branding)} no generan ${money(R.tienda.ventaMes)} de forma lineal. Es presencia de marca que alimenta el flujo a la tienda y a toda la cuenta (venta promedio de ${rangoMeses(R.tienda.meses)}).</p>`;
  }

  // ── Curva 2025: ventanas de los picos ────────────────────────
  function renderCurva(planes) {
    const el = $('plan-curva-nota');
    const semanas = planes.flatMap(p => curva2025(p.mes) || []);
    if (!semanas.length) {
      global.Charts.destroy('chart-plan-curva');
      if (el) el.textContent = 'Sin la curva semanal de 2025 en el histórico de ventas.';
      return;
    }
    const picoDe = s => ESTRATEGIA.picos.find(p => p.mes === s.mes && s.hasta >= p.desde && s.desde <= p.hasta);
    const etiqueta = s => `${s.desde}–${s.hasta} ${corto(s.mes)}`;
    global.Charts.mount('chart-plan-curva', {
      type: 'bar',
      data: {
        labels: semanas.map(etiqueta),
        datasets: [{
          label: 'Venta digital por día (2025)', data: semanas.map(s => Math.round(s.porDia)),
          backgroundColor: semanas.map(s => (picoDe(s) ? LINEAS.pico.color : planoColor + '55')),
          borderRadius: { topLeft: 3, topRight: 3 }, maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => `${etiqueta(semanas[items[0].dataIndex])} 2025`,
            label: ctx => ` ${money(ctx.raw)} por día`,
            footer: items => {
              const s = semanas[items[0].dataIndex];
              const p = picoDe(s);
              return `${money(s.valor)} en ${s.dias} días${p ? ` · ventana de ${p.nombre}` : ''}`;
            },
          } },
        },
        scales: {
          // Con un trimestre se ven todas las semanas; con más meses, Chart.js salta etiquetas
          x: { grid: { display: false }, ticks: { color: axisColor, font: { size: 9 }, maxRotation: 60, autoSkip: semanas.length > 20 } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: fmtS }, grid: { color: gridColor } },
        },
      },
    });
    if (!el) return;
    const textos = ESTRATEGIA.picos.filter(p => planMeses().includes(p.mes)).map(p => {
      const e = evidenciaPico(p);
      if (!e || e.porDia == null) return `<b>${esc(p.nombre)}</b> (${ventana(p)}): sin semanas de 2025 para comparar.`;
      return `<b>${esc(p.nombre)}</b> (${ventana(p)}): en 2025 ${e.unaSemana ? 'la semana' : 'las semanas'} del ${e.desde} al ${e.hasta} ${corto(p.mes)} ${e.unaSemana ? 'vendió' : 'vendieron'} ${money(e.porDia)} por día en digital${e.veces ? `, ${e.veces.toFixed(1)}× el resto de ${p.mes.toLowerCase()}` : ''}.`;
    });
    el.innerHTML = textos.join('<br>') || 'La estrategia no tiene picos en los meses del plan.';
  }

  // ── Todo ─────────────────────────────────────────────────────
  function renderVacio(texto) {
    $('plan-body').hidden = true;
    const empty = $('plan-empty');
    empty.hidden = false;
    empty.textContent = texto;
    ['chart-plan-resumen', 'chart-plan-curva'].forEach(id => global.Charts.destroy(id));
  }

  function renderTodo() {
    if (!$('plan-body')) return;
    if (!planMeses().length) {
      renderVacio(_plan ? 'El archivo de objetivos no trae meses con metas: el plan por campaña se arma sobre ellos.'
        : 'No se pudo cargar el archivo de objetivos (Objetivos 2026): el plan por campaña se arma sobre sus meses y metas.');
      return;
    }
    if (!_gasto?.months?.length) {
      renderVacio('No se pudieron cargar los informes de pauta (Gasto publicitario): el ROAS de cada campaña sale de ellos.');
      return;
    }
    // Sin histórico de ventas (data/ventas-2026.json no cargó) no hay ROAS de Web ni de WhatsApp
    if (!months.some(m => onlineKeys().some(k => venta(m, k) > 0))) {
      renderVacio('No se pudo cargar el histórico de ventas (Objetivos 2026): el ROAS de Web y de WhatsApp sale de él.');
      return;
    }
    if (!planMeses().includes(_mes)) _mes = defaultMes();
    $('plan-body').hidden = false;
    $('plan-empty').hidden = true;

    const ref = referencia();
    const R = calcRoas(ref);
    const planes = planMeses().map(m => planMes(m, R));
    const p = planes.find(x => x.mes === _mes);
    const real = realMes(_mes);

    renderMesSelector();
    renderPeriodo(p, real);
    renderFuentes(p, R);
    renderKpis(p, real);
    $('plan-tabla-titulo').textContent = `Distribución de ${p.mes.toLowerCase()} · plano + pico`;
    renderTabla(p, real, R);
    renderResumen(planes);
    renderChartResumen(planes);
    renderRoas(R, ref);
    renderWhatsApp(p, R, real);
    renderGoogle(R);
    renderBranding(planes, R);
    renderCurva(planes);
  }

  // plan: objetivos de la marca · ventas: histórico por mes calendario (con semanas2025) ·
  // gasto: data/ads-2026.json. Proyecciones lo llama al abrir la pestaña o con datos nuevos.
  function render({ plan, ventas, gasto }) {
    _plan = plan || null;
    _ventas = ventas || null;
    _gasto = gasto || null;
    renderTodo();
  }

  global.PlanCampanas = { render };

})(window);
