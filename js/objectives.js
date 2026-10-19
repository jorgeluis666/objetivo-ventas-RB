/* ============================================================
   objectives.js — vista de Objetivos 2026, en dos zonas con fuente en Drive:
     1. Objetivos comerciales (data/objetivos-2026.json): KPIs, cuadro de
        metas por canal y una pestaña por mes con ritmo y detalle semanal.
     2. Ventas 2026, histórico de la marca: ventas por canal y mes y la
        evolución semanal 2025 vs 2026.
   Todo va por mes calendario, como el histórico de la marca. Cada zona tiene un botón
   Sincronizar que relee su hoja de Drive en el navegador (fuentes-drive.js).
   Expone window.Objectives.render({ d2026, weeklyData, transactions, plan, … }).
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const {
    channels, palette, d2025, monthDays, months, chToUpper,
  } = ds;

  const fmt = n => Math.round(n).toLocaleString('es-PE');
  const tot = o => channels.reduce((s, c) => s + (o[c] || 0), 0);

  // Formato compacto para etiquetas dentro del gráfico (k / M)
  const fmtShort = v => {
    if (v == null) return null;
    const a = Math.abs(v);
    if (a >= 1e6) return 'S/. ' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return 'S/. ' + Math.round(v / 1e3) + 'k';
    return 'S/. ' + Math.round(v);
  };

  // Extrae el valor de un mes según canal seleccionado ('' = Total de todos los canales)
  const getChVal = (monthObj, chName) =>
    chName ? ((monthObj || {})[chName] || 0) : tot(monthObj || {});

  // Aplica datalabels al gráfico semanal (2026 encima, 2025 sin label por densidad).
  // Se llama después de cada render de combinedWeeklyChart.
  const applyWeeklyLabels = () => {
    const c = global.Charts?.getInstance('chart-weekly-combined');
    if (!c) return;
    // 2025: sin etiqueta — 52 puntos, demasiado denso
    c.data.datasets[0].datalabels = { display: false };
    // 2026: valor compacto sobre cada nodo con dato real
    c.data.datasets[1].datalabels = {
      display: ctx => ctx.dataset.data[ctx.dataIndex] !== null,
      color: '#2563eb',
      anchor: 'end',
      align: 'top',
      offset: 3,
      font: { size: 9, weight: '600' },
      formatter: v => fmtShort(v),
    };
    c.options.plugins.datalabels = { display: true };
    c.options.layout = { padding: { top: 24, bottom: 4 } };
    c.update('none'); // aplicar sin reanimar las líneas
  };

  const pctFill  = p => p >= 100 ? 'var(--green)' : p >= 80 ? 'var(--amber)' : 'var(--brand)';
  const pctColor = p => p >= 100 ? 'var(--green-text)' : p >= 80 ? 'var(--amber-text)' : 'var(--brand-text)';
  const setProgressFill = (el, pct) => {
    const safePct = Math.max(0, Math.min(pct, 100));
    el.style.width = safePct > 0 ? safePct.toFixed(1) + '%' : '6px';
    el.classList.toggle('is-zero', safePct <= 0);
  };

  // Estado interno
  const state = {
    plan: null,            // data/objetivos-2026.json: objetivos de la marca (Drive)
    d2026: null,           // ventas 2026 por mes calendario
    ventasInfo: null,      // { generated, fuente } de las ventas mostradas
    vista: 'avance',       // vista del cuadro del mes: 'avance' (vs meta) o 'ventas' (vs 2025)
    weeklyData: null,
    daily2026: null,       // ventas por día y columna: { Octubre: { Web: [día 1, …] } } (Notificaciones)
    notifOpen: false,
    transactions: null,
    avgTickets: {},
    d2025Ref: d2025,
    onSyncVentas: null,
    onPlanChange: null,
  };

  // ── Objetivos: cada canal suma una o más columnas del histórico de ventas ──
  // (Redes y WhatsApp = WhatsApp + Instagram + Facebook). Solo hay metas para los meses del archivo.
  const planChannels = () => state.plan?.canales || [];
  const objMonths    = () => (state.plan?.meses || []).filter(m => months.includes(m));
  const chColor      = c => palette[c.sheet[0]] || '#64748B';
  const chReal       = (monthObj, c) => c.sheet.reduce((s, col) => s + ((monthObj || {})[col] || 0), 0);
  const chWeekReal   = (wk, c) => c.sheet.reduce((s, col) => s + (wk[chToUpper[col]] || 0), 0);
  const target       = (m, key) => state.plan?.metas?.[m]?.[key] || 0;
  const monthTarget  = m => planChannels().reduce((s, c) => s + target(m, c.key), 0);
  const ref2025      = (m, key) => state.plan?.referencia?.valores?.[m]?.[key] || 0;
  const monthRef2025 = m => planChannels().reduce((s, c) => s + ref2025(m, c.key), 0);
  const refLabel     = () => state.plan?.referencia?.anio ? `Ref. ${state.plan.referencia.anio}` : 'Ref.';

  // Textos que vienen de Drive (nombres de archivo, etiquetas, avisos) se escapan antes de ir al HTML.
  const esc = v => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const FD = () => global.FuentesDrive;
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

  // Montos compactos para el histórico (miles de soles)
  const fmtK = n => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  };
  const monthShort = m => m.slice(0, 3);

  // ── Calendar helpers (año en curso = 2026) ──
  const YEAR = 2026;

  // Índice del mes que estamos viviendo hoy dentro de months[] (0=Enero, 11=Diciembre).
  // -2 si todo el año es futuro, 12 si todo es pasado.
  // Llama new Date() en cada invocación para que funcione correctamente si la
  // página queda abierta de un día para otro.
  function currentMonthIdx() {
    const now = new Date();
    if (now.getFullYear() < YEAR) return -2;
    if (now.getFullYear() > YEAR) return 12;
    return now.getMonth();
  }
  function objectiveDays(m) {
    return monthDays[m];
  }
  function currentCalendarDay() {
    return new Date().getDate();
  }
  function visualRulerStart(m) {
    return '1';
  }
  function visualRulerEnd(m) {
    return String(objectiveDays(m));
  }
  function visualTodayPct(m) {
    return (daysPassed(m) / objectiveDays(m) * 100).toFixed(1);
  }
  // Último día con ventas del histórico (fuente2026.ultimoDia, "2026-10-11"). La hoja se carga con
  // un día o dos de atraso: el avance se mide hasta ese día, no hasta hoy.
  function ultimoDiaVentas() {
    const u = state.ventasInfo?.fuente?.ultimoDia;
    return u ? { monthIndex: +u.slice(5, 7) - 1, day: +u.slice(8, 10) } : null;
  }
  function monthStatus(m) {
    const idx = months.indexOf(m);
    const cur = currentMonthIdx();
    if (idx < cur)  return 'past';
    if (idx > cur)  return 'future';
    return 'current';
  }
  // Días del mes en curso con ventas cargadas; sin la fecha del histórico, los días hasta hoy.
  function daysPassed(m) {
    const s = monthStatus(m);
    if (s === 'past')    return objectiveDays(m);
    if (s === 'future')  return 0;
    const u = ultimoDiaVentas();
    if (!u) return Math.min(objectiveDays(m), currentCalendarDay());
    return u.monthIndex === months.indexOf(m) ? Math.min(objectiveDays(m), u.day) : 0;
  }
  function daysRemaining(m) {
    return Math.max(0, objectiveDays(m) - daysPassed(m));
  }
  // Lo que debería llevar vendido a la fecha de corte si avanzara parejo hacia la meta.
  const expectedTo = (m, tgt) => tgt * daysPassed(m) / objectiveDays(m);
  // Fecha de corte de las ventas: "11 oct" en el mes en curso, "cierre" en uno pasado.
  const corteLabel = m => monthStatus(m) === 'current' ? `${daysPassed(m)} ${MONTH_ABR[m]}` : 'cierre';

  // Píldoras y tarjetas KPI: los mismos componentes que Gasto publicitario y Proyecciones.
  const pill = (cls, text, title) => `<span class="pill ${cls}"${title ? ` title="${esc(title)}"` : ''}>${text}</span>`;
  const kpi = ({ label, value, subs = [], extra = '' }) => `
    <div class="kpi-pill">
      <span>${label}</span>
      <strong>${value}</strong>
      ${extra}
      ${subs.filter(Boolean).map(s => `<small>${s}</small>`).join('')}
    </div>`;
  // Barra de cumplimiento de la meta, con una marca en lo esperado a la fecha de corte.
  const kpiBar = (pct, cls, mark, title) => `
    <div class="kpi-bar" title="${esc(title)}">
      <i class="${cls}" style="width:${Math.max(0, Math.min(pct, 100)).toFixed(1)}%"></i>
      ${mark != null ? `<b style="left:${Math.min(mark, 100).toFixed(1)}%"></b>` : ''}
    </div>`;
  // Vendido frente a lo esperado a la fecha: verde al ritmo o adelantado, ámbar hasta 10 % abajo.
  function vsExpectedPill(real, expected, corte) {
    if (!expected) return '';
    const r = real / expected;
    const cls = r >= 1 ? 'green' : r >= 0.9 ? 'amber' : 'red';
    const d = Math.round((r - 1) * 100);
    return pill(cls, `${d >= 0 ? '+' : '−'}${Math.abs(d)}%`, `Vendido frente a lo esperado al ${corte}: S/. ${fmt(expected)}`);
  }

  // ── ISO week number del año (1-53) ──
  function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  // ── Avg ticket por canal (monto / qty) — tolera meses sin data 2026 ──
  function computeAvgTickets(d2026, transactions) {
    const out = {};
    months.forEach(m => {
      const row = {}; let totalAmount = 0, totalQty = 0;
      const d2026Month = d2026[m] || {};
      const txMonth = transactions[m] || {};
      channels.forEach(ch => {
        const up = chToUpper[ch];
        const amt = d2026Month[ch] || 0;
        const qty = txMonth[up] || 0;
        row[up] = qty > 0 ? Math.round(amt / qty) : 0;
        totalAmount += amt;
        totalQty    += qty;
      });
      row.TOTAL = totalQty > 0 ? Math.round(totalAmount / totalQty) : 0;
      out[m] = row;
    });
    return out;
  }

  // Un mes está "vivo" (con datos 2026) si hay facturación registrada.
  function isLiveMonth(m) {
    const d = state.d2026?.[m];
    return !!d && channels.some(ch => (d[ch] || 0) > 0);
  }

  // Total del mes: toda la venta registrada contra la suma de metas de los canales.
  function refreshObjTotal(m) {
    const tr = tot(state.d2026?.[m] || {});
    const tt = monthTarget(m);
    const p = tt > 0 ? tr / tt * 100 : 0;
    const status = monthStatus(m);

    const pb = document.getElementById(`pb-tot-${m}`);
    const pv = document.getElementById(`pv-tot-${m}`);
    const gv = document.getElementById(`gv-tot-${m}`);
    const mt = document.getElementById(`mt-${m}`);
    if (!pb || !pv || !gv) return;
    if (mt) mt.textContent = 'S/. ' + fmt(tt);

    if (status === 'future' || (status === 'current' && !isLiveMonth(m))) {
      pb.style.width = '0%'; pv.textContent = '—'; pv.style.color = 'var(--muted)';
      gv.textContent = status === 'future' ? 'futuro' : '—';
      gv.className = 'gap-val'; gv.style.color = 'var(--muted)';
    } else {
      setProgressFill(pb, p);
      pb.style.background = pctFill(p);
      pv.textContent = p.toFixed(0) + '%';
      pv.style.color = pctColor(p);
      const gap = tr - tt;
      gv.textContent = (gap >= 0 ? '+' : '') + 'S/. ' + fmt(gap);
      gv.className = 'gap-val ' + (gap >= 0 ? 'g-pos' : 'g-neg');
    }
  }

  function refreshPaceCards(m) {
    const el = document.getElementById(`pace-${m}`);
    if (!el) return;
    if (!hasMeta(m)) { el.innerHTML = ventasKpis(m); return; }

    const d2026Month = state.d2026?.[m] || {};
    const tt        = monthTarget(m);
    const real      = tot(d2026Month);
    const status    = monthStatus(m);
    const remDays   = daysRemaining(m);
    const passed    = daysPassed(m);
    const faltante  = Math.max(0, tt - real);
    const dailyNeed = remDays > 0 ? faltante / remDays : 0;
    const avgTk     = state.avgTickets[m]?.TOTAL || 0;
    const txnsNeed  = dailyNeed > 0 && avgTk > 0 ? Math.ceil(dailyNeed / avgTk) : 0;

    const pctMet    = tt > 0 ? real / tt * 100 : 0;
    const dailyReal = passed > 0 ? real / passed : 0;
    const ref       = monthRef2025(m);
    const tkPill    = tk => tk > 0 ? pill('gray', `ticket S/. ${fmt(tk)}`) : '';

    // 1. El objetivo y cuánto se cumplió con las ventas del histórico. El color sigue al ritmo:
    //    en el mes en curso, vendido frente a lo esperado al corte; en uno cerrado, frente a la meta.
    const refAnio = state.plan?.referencia?.anio || 2025;
    const refTxt  = ref > 0 ? `${pill('gray', `${tt >= ref ? '+' : '−'}${Math.abs(Math.round((tt / ref - 1) * 100))}% vs ${refAnio}`)} ${m.toLowerCase()} ${refAnio}: S/. ${fmt(ref)}` : 'objetivos de la marca';
    const withSales = status !== 'future' && passed > 0 && tt > 0;
    const expPct    = status === 'current' ? passed / objectiveDays(m) * 100 : 100;
    const ritmo     = expPct > 0 ? pctMet / expPct : 0;
    const cumpleCls = ritmo >= 1 ? 'green' : ritmo >= 0.9 ? 'amber' : 'red';
    const metaKpi = kpi({
      label: 'Meta del mes', value: `S/. ${fmt(tt)}`,
      extra: withSales ? kpiBar(pctMet, cumpleCls, status === 'current' ? expPct : null,
        status === 'current' ? `${pctMet.toFixed(0)}% cumplido · lo esperado al ${corteLabel(m)} es ${expPct.toFixed(0)}%` : `${pctMet.toFixed(0)}% cumplido`) : '',
      subs: withSales
        ? [`${pill(cumpleCls, `${pctMet.toFixed(0)}% cumplido`)} S/. ${fmt(real)} vendidos${status === 'current' ? ` al ${corteLabel(m)}` : ''}`, refTxt]
        : [refTxt],
    });

    let cards;
    if (status === 'future') {
      cards = [
        metaKpi,
        kpi({ label: 'Venta diaria necesaria', value: `S/. ${fmt(tt / objectiveDays(m))}`,
          subs: [`${pill('gray', `${objectiveDays(m)} días`)} si el mes avanza parejo`] }),
        kpi({ label: 'Ventas', value: '—', subs: [`${pill('gray', 'mes futuro')} sin ventas todavía`] }),
        kpi({ label: 'Días del mes', value: objectiveDays(m), subs: [m.toLowerCase() + ' 2026'] }),
      ];
    } else if (status === 'current') {
      // 2. Cómo va: lo vendido hasta el último día cargado frente a lo esperado a esa fecha.
      const corte    = corteLabel(m);
      const esperado = expectedTo(m, tt);
      const pctMissing = faltante > 0 && tt > 0 ? Math.round(faltante / tt * 100) : 0;
      // Referencia: el mes anterior (si es enero, marzo de respaldo).
      const curIdx   = months.indexOf(m);
      const refMonth = curIdx > 0 ? months[curIdx - 1] : 'Marzo';
      const refTxns  = Math.round(Object.values(state.transactions?.[refMonth] || {}).reduce((a, b) => a + b, 0) / (objectiveDays(refMonth) || 30));
      const refTk    = state.avgTickets?.[refMonth]?.TOTAL || 0;
      cards = [
        metaKpi,
        kpi({ label: `Vendido al ${corte}`, value: passed > 0 ? `S/. ${fmt(real)}` : '—',
          subs: passed > 0
            ? [`${vsExpectedPill(real, esperado, corte)} vs esperado S/. ${fmt(esperado)}`, `${passed} de ${objectiveDays(m)} días con ventas cargadas`]
            : [`${pill('gray', 'sin ventas')} todavía no hay ventas cargadas del mes`] }),
        kpi({ label: 'Faltante para la meta', value: `S/. ${fmt(faltante)}`,
          subs: [faltante > 0 ? `${pill('red', `${pctMissing}% por vender`)} S/. ${fmt(dailyNeed)} por día` : pill('green', '✓ meta cubierta'),
            faltante > 0 ? `en los ${remDays} días que quedan` : ''] }),
        kpi({ label: 'Transacciones necesarias', value: `${txnsNeed}/día`,
          subs: [`${tkPill(avgTk)} promedio del mes`, refTk > 0 ? `${refMonth.toLowerCase()}: ${refTxns}/día con ticket S/. ${fmt(refTk)}` : ''] }),
      ];
    } else {
      const totalTx = avgTk > 0 ? Math.round(real / avgTk) : 0;
      const closeCls = real >= tt ? 'green' : pctMet >= 90 ? 'amber' : 'red';
      cards = [
        metaKpi,
        kpi({ label: 'Vendido en el mes', value: `S/. ${fmt(real)}`,
          subs: [`${pill(closeCls, `${pctMet.toFixed(0)}% de la meta`)} ${real >= tt ? 'objetivo alcanzado' : ''}`] }),
        kpi({ label: real >= tt ? 'Excedente' : 'Brecha final', value: `${real >= tt ? '+' : '−'}S/. ${fmt(Math.abs(real - tt))}`,
          subs: [`${pill(real >= tt ? 'green' : 'red', 'vs meta')} S/. ${fmt(dailyReal)} por día en promedio`] }),
        kpi({ label: 'Transacciones', value: fmt(totalTx),
          subs: [`${tkPill(avgTk)} ${fmt(totalTx / objectiveDays(m))} por día`] }),
      ];
    }
    el.innerHTML = `<div class="kpi-strip obj-kpis">${cards.join('')}</div>`;
  }

  // ── Detalle semanal por canal (expandible desde la fila de la tabla) ──
  // wk.w es el número de semana DENTRO del mes (1 = primera semana del mes)
  const MONTH_ABR = { Enero:'ene', Febrero:'feb', Marzo:'mar', Abril:'abr', Mayo:'may',
    Junio:'jun', Julio:'jul', Agosto:'ago', Septiembre:'sep', Octubre:'oct',
    Noviembre:'nov', Diciembre:'dic' };

  // Semanas del mes como las arma el pipeline (fuentes-drive.js buildWeekMap): de lunes a
  // domingo, recortadas al mes; la primera y la última pueden tener menos de 7 días.
  function monthWeeks(m) {
    const mi = months.indexOf(m);
    const weeks = [];
    for (let d = 1; d <= objectiveDays(m); d++) {
      if (d === 1 || new Date(YEAR, mi, d).getDay() === 1) weeks.push({ w: weeks.length + 1, start: d, end: d });
      weeks[weeks.length - 1].end = d;
    }
    weeks.forEach(wk => { wk.days = wk.end - wk.start + 1; });
    return weeks;
  }

  function weekDateRange(m, w) {
    const wk = monthWeeks(m)[w - 1];
    if (!wk) return '';
    return wk.start === wk.end ? `${wk.start} ${MONTH_ABR[m]}` : `${wk.start}–${wk.end} ${MONTH_ABR[m]}`;
  }

  // Construye el HTML interno del desplegable semanal de un canal del plan.
  // Incluye meta efectiva con arrastre de brecha semana a semana.
  function buildChannelWeeklyHTML(m, c, status) {
    const weeks = state.weeklyData?.[m];
    if (!weeks || !weeks.length) {
      return '<div style="padding:8px 4px;font-size:12px;color:var(--muted);">Sin datos semanales para este canal.</div>';
    }
    const monthChTgt  = target(m, c.key);
    // La meta de cada semana es proporcional a sus días (las semanas de borde son más cortas).
    const semanas     = monthWeeks(m);
    const weekTgt     = w => monthChTgt > 0 && semanas[w - 1] ? monthChTgt * semanas[w - 1].days / objectiveDays(m) : 0;
    const fullWeekTgt = monthChTgt > 0 ? monthChTgt * 7 / objectiveDays(m) : 0;
    const hoy         = currentCalendarDay();
    const curWeekNum  = status === 'current' ? (semanas.find(s => hoy >= s.start && hoy <= s.end)?.w ?? -1) : -1;

    let carry = 0;   // brecha arrastrada de semanas anteriores

    const weekRows = weeks.map((wk, i) => {
      const weekNum       = wk.w;
      const baseWeekTgt   = weekTgt(weekNum);
      const real          = chWeekReal(wk, c);
      const isCurrentWeek = status === 'current' && weekNum === curWeekNum;
      const isFuture      = status === 'current' && weekNum > curWeekNum;

      // Meta efectiva = base + brecha arrastrada de semana previa
      const prevCarry    = carry;
      const effectiveTgt = baseWeekTgt + prevCarry;
      const pct          = !isFuture && effectiveTgt > 0 ? real / effectiveTgt * 100 : 0;
      const brecha       = real - effectiveTgt;
      const dateRange    = weekDateRange(m, weekNum);

      // Actualizar carry para la siguiente semana (solo semanas pasadas cerradas)
      if (!isFuture && !isCurrentWeek) {
        carry = brecha < 0 ? Math.abs(brecha) : 0;
      }

      let cls, badge;
      if (isFuture)           { cls = 'muted'; badge = 'próxima'; }
      else if (isCurrentWeek) { cls = 'brand'; badge = '→ en curso'; }
      else if (pct >= 90)     { cls = 'green'; badge = '✓ en track'; }
      else if (pct >= 70)     { cls = 'amber'; badge = '⚠ atención'; }
      else                    { cls = 'red';   badge = '▼ brecha'; }

      const barColor  = { muted:'#e2e8f0', brand:'var(--brand)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)' }[cls];
      const textColor = { muted:'var(--muted)', brand:'var(--brand-text)', green:'var(--green-text)', amber:'var(--amber-text)', red:'var(--red-text)' }[cls];
      const barW      = isFuture ? 0 : Math.min(pct, 100).toFixed(0);

      // Etiqueta de meta: si hay arrastre se muestra de dónde viene
      const metaLabel = isFuture ? '—'
        : prevCarry > 0
          ? `<span class="ch-wk-meta-base">S/. ${fmt(effectiveTgt)}</span>
             <span class="ch-wk-meta-carry">(base S/. ${fmt(baseWeekTgt)} + arrastre S/. ${fmt(prevCarry)})</span>`
          : `S/. ${fmt(effectiveTgt)}`;

      // Indicador de traspaso hacia la siguiente semana
      const traspasoHtml = (!isFuture && !isCurrentWeek && brecha < 0 && i < weeks.length - 1)
        ? `<div class="ch-wk-traspaso">
             ↳ Brecha S/. ${fmt(Math.abs(brecha))} se traslada a sem. ${i + 2} · su nueva meta efectiva: S/. ${fmt(weekTgt(weekNum + 1) + Math.abs(brecha))}
           </div>`
        : (!isFuture && !isCurrentWeek && brecha >= 0 && pct >= 90)
          ? `<div class="ch-wk-traspaso ch-wk-traspaso-ok">✓ Sem. ${i + 1} cubierta · no genera arrastre</div>`
          : '';

      return `
        <div class="ch-week-row${isCurrentWeek ? ' ch-week-current' : ''}${isFuture ? ' ch-week-future' : ''}">
          <div class="ch-wk-lbl">
            <span class="ch-wk-sem">Sem. ${i + 1}</span>
            <span class="ch-wk-range">${dateRange}</span>
          </div>
          <div class="ch-wk-track"><div class="ch-wk-fill" style="width:${barW}%;background:${barColor};"></div></div>
          <div class="ch-wk-amt-group">
            <span class="ch-wk-amt">${isFuture ? '<span style="color:var(--muted)">—</span>' : 'S/. ' + fmt(real)}</span>
            <span class="ch-wk-meta-lbl">/ ${metaLabel}</span>
          </div>
          <span class="ch-wk-pct" style="color:${textColor};">${isFuture ? '—' : isCurrentWeek ? 'parcial' : pct.toFixed(0) + '%'}</span>
          ${pill({ muted: 'gray', brand: 'blue' }[cls] || cls, badge)}
        </div>
        ${traspasoHtml}`;
    }).join('');

    const metaHdr = fullWeekTgt > 0 ? `meta por semana de 7 días ≈ S/. ${fmt(fullWeekTgt)}` : 'sin objetivo definido';
    return `
      <div class="ch-weeks-header">${c.label} · ${m} · ${metaHdr}</div>
      <div class="ch-wk-col-head">
        <span>Semana</span><span></span>
        <span>Real / Meta efectiva</span>
        <span class="r">%</span><span></span>
      </div>
      ${weekRows}`;
  }

  // ── Notificaciones: los avisos del mes en curso, en el desplegable de la barra superior ──
  // Venta de una columna en un día del mes; los días ≤ 0 caen en el mes anterior.
  function ventaDia(m, col, d) {
    let mi = months.indexOf(m);
    while (d < 1 && mi > 0) { mi--; d += objectiveDays(months[mi]); }
    return d < 1 ? 0 : state.daily2026?.[months[mi]]?.[col]?.[d - 1] || 0;
  }
  function diaLabel(m, d) {
    let mi = months.indexOf(m);
    while (d < 1 && mi > 0) { mi--; d += objectiveDays(months[mi]); }
    return { d, mes: MONTH_ABR[months[mi]] };
  }
  const rangoLabel = (m, desde, hasta) => {
    const a = diaLabel(m, desde), b = diaLabel(m, hasta);
    return a.mes === b.mes ? `${a.d}–${b.d} ${b.mes}` : `${a.d} ${a.mes} – ${b.d} ${b.mes}`;
  };
  const pctTxt = p => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`;

  // Últimos 7 días con ventas frente a los 7 anteriores, por columna del archivo de ventas.
  // Solo se comparan canales que vendieron en la semana previa (sin base no hay porcentaje).
  function crecimientoSemanal(m) {
    const fin = daysPassed(m);
    if (!state.daily2026 || fin < 1) return null;
    const suma = (col, desde, hasta) => { let s = 0; for (let d = desde; d <= hasta; d++) s += ventaDia(m, col, d); return s; };
    const filas = VENTAS_COLS.map(col => {
      const actual = suma(col, fin - 6, fin), previa = suma(col, fin - 13, fin - 7);
      return { col, actual, previa, pct: previa > 0 ? (actual / previa - 1) * 100 : null };
    });
    const medibles = filas.filter(f => f.pct !== null).sort((a, b) => b.pct - a.pct);
    if (!medibles.length) return null;
    return {
      lider: medibles[0], resto: medibles.slice(1),
      nuevos: filas.filter(f => f.pct === null && f.actual > 0),
      actual: rangoLabel(m, fin - 6, fin), previa: rangoLabel(m, fin - 13, fin - 7),
    };
  }

  // Avisos del mes: crecimiento semanal, brecha a mitad de mes y objetivos alcanzados.
  function avisosMes(m) {
    const items = [];
    const cs = crecimientoSemanal(m);
    if (cs) {
      const { lider: l } = cs;
      items.push({
        tone: l.pct > 0 ? 'green' : 'amber',
        titulo: l.pct > 0 ? `${colName(l.col)} creció más rápido esta semana` : `Ningún canal creció · ${colName(l.col)} cayó menos`,
        lineas: [
          `S/. ${fmt(l.actual)} del ${cs.actual} frente a S/. ${fmt(l.previa)} del ${cs.previa} (${l.actual >= l.previa ? '+' : '−'}S/. ${fmt(Math.abs(l.actual - l.previa))})`,
          cs.resto.length ? `Le siguen: ${cs.resto.map(f => `${f.col} ${pctTxt(f.pct)}`).join(' · ')}` : '',
          cs.nuevos.length ? `Sin ventas la semana previa: ${cs.nuevos.map(f => `${f.col} S/. ${fmt(f.actual)}`).join(' · ')}` : '',
        ],
        badge: { valor: pctTxt(l.pct), etiqueta: 'vs sem. ant.' },
      });
    }

    if (!hasMeta(m)) return items;
    const status     = monthStatus(m);
    const d2026Month = state.d2026?.[m] || {};
    const passed     = daysPassed(m);
    const totalDays  = objectiveDays(m);
    const stats = planChannels().map(c => {
      const real = chReal(d2026Month, c);
      const tgt  = target(m, c.key);
      return { ch: esc(c.label), color: chColor(c), real, tgt, pct: tgt > 0 ? real / tgt * 100 : 0,
        expectedReal: tgt > 0 ? tgt * passed / totalDays : 0, surplus: real - tgt, gap: tgt - real };
    }).filter(s => s.tgt > 0);
    const nombre = s => `<span class="ch-name"><span class="ch-pip" style="background:${s.color}"></span>${s.ch}</span>`;

    // Canales por debajo del 80 % del ritmo esperado, desde la mitad del mes
    const lagging = status === 'current' && passed >= Math.floor(totalDays / 2)
      ? stats.filter(s => s.pct < 100 && s.real < s.expectedReal * 0.80) : [];
    lagging.forEach(b => items.push({
      tone: 'red',
      titulo: `Brecha a mitad de mes · ${nombre(b)}`,
      lineas: [`S/. ${fmt(b.real)} vendidos · esperado al ${corteLabel(m)} S/. ${fmt(b.expectedReal)} · brecha S/. ${fmt(b.expectedReal - b.real)}`],
      badge: { valor: `${Math.round(b.real / b.expectedReal * 100)}%`, etiqueta: 'del ritmo' },
    }));
    if (lagging.length) {
      const falta = lagging.reduce((s, b) => s + b.gap, 0);
      const quedan = Math.max(totalDays - passed, 1);
      items.push({
        tone: 'amber',
        titulo: `Faltan S/. ${fmt(falta)} para la meta de ${lagging.length === 1 ? 'este canal' : `estos ${lagging.length} canales`}`,
        lineas: [`Se necesitan S/. ${fmt(falta / quedan)} por día en los ${totalDays - passed} días que quedan del mes.`],
        badge: { valor: totalDays - passed, etiqueta: 'días' },
      });
    }

    // Canales que superaron el objetivo mensual + a dónde llevar el excedente
    const achieved = stats.filter(s => s.pct >= 100);
    achieved.forEach(a => items.push({
      tone: 'green',
      titulo: `Objetivo alcanzado · ${nombre(a)}`,
      lineas: [`S/. ${fmt(a.real)} vendidos de una meta de S/. ${fmt(a.tgt)} · excedente S/. ${fmt(a.surplus)}`],
      badge: { valor: `${a.pct.toFixed(0)}%`, etiqueta: 'de la meta' },
    }));
    const topNeed = stats.filter(s => s.pct < 90 && !achieved.includes(s)).sort((a, b) => b.gap - a.gap).slice(0, 2);
    if (achieved.length && topNeed.length) {
      items.push({
        tone: 'blue',
        titulo: `Redistribuir el excedente de S/. ${fmt(achieved.reduce((s, a) => s + a.surplus, 0))}`,
        lineas: [`Considera traspasar presupuesto a ${topNeed.map(n => `<strong>${n.ch}</strong> <span class="notif-neg">(brecha S/. ${fmt(n.gap)})</span>`).join(' y ')} para reforzar las campañas de mayor brecha.`],
      });
    }
    return items;
  }

  // El mes de los avisos: el que está en curso; si aún no tiene ventas, el último que las tiene.
  const notifMonth = () => [months[currentMonthIdx()]].find(m => m && conVentas(m)) || [...months].reverse().find(conVentas);

  function renderNotificaciones() {
    const zone = document.getElementById('notif-zone');
    if (!zone) return;
    const m = notifMonth();
    if (!m) { zone.hidden = true; return; }
    const items = avisosMes(m);
    const open  = state.notifOpen;
    const countTone = items.some(i => i.tone === 'red') ? 'red' : items.length ? 'blue' : 'none';
    const corte = monthStatus(m) === 'current' ? `ventas al ${corteLabel(m)}` : 'mes cerrado';
    const itemHTML = i => `
      <button class="notif-item ${i.tone}" type="button" data-notif-month="${m}" title="Abrir ${m.toLowerCase()} en Objetivos 2026">
        <span>
          <strong>${i.titulo}</strong>
          ${i.lineas.filter(Boolean).map(l => `<span class="notif-meta">${l}</span>`).join('')}
        </span>
        ${i.badge ? `<span class="notif-badge"><strong>${i.badge.valor}</strong><span>${i.badge.etiqueta}</span></span>` : ''}
      </button>`;
    zone.hidden = false;
    zone.innerHTML = `
      <button class="notif-toggle${open ? ' open' : ''}" id="notif-toggle" type="button" aria-expanded="${open}" aria-controls="notif-panel" title="Notificaciones del mes">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="notif-toggle-text">Notificaciones</span>
        <span class="notif-count ${countTone}">${items.length}</span>
      </button>
      <div class="notif-panel" id="notif-panel" role="dialog" aria-label="Notificaciones del mes"${open ? '' : ' hidden'}>
        <div class="notif-head">
          <div>
            <strong>Avisos de ${m.toLowerCase()} 2026</strong>
            <p>${corte} · ${items.length ? `${items.length} ${items.length === 1 ? 'aviso' : 'avisos'}` : 'sin avisos'}</p>
          </div>
          <button class="notif-close" type="button" data-notif-close>Cerrar</button>
        </div>
        <div class="notif-list">
          ${items.length ? items.map(itemHTML).join('') : '<div class="notif-empty">No hay avisos para este mes.</div>'}
        </div>
        <p class="notif-foot">La semana es de los últimos 7 días con ventas cargadas frente a los 7 anteriores. Haz clic en un aviso para abrir el mes en Objetivos 2026.</p>
      </div>`;

    const toggle = v => { state.notifOpen = typeof v === 'boolean' ? v : !state.notifOpen; renderNotificaciones(); };
    zone.querySelector('#notif-toggle').addEventListener('click', e => { e.stopPropagation(); toggle(); });
    zone.querySelector('[data-notif-close]').addEventListener('click', () => toggle(false));
    zone.querySelectorAll('[data-notif-month]').forEach(b => b.addEventListener('click', () => {
      toggle(false);
      document.querySelector('.s-item[data-view="view-obj"]')?.click();
      selectMonth(b.dataset.notifMonth);
    }));
    // Se cierra al hacer clic fuera o con Escape (una sola vez por página).
    if (!state.notifWired) {
      state.notifWired = true;
      document.addEventListener('click', e => { if (state.notifOpen && !document.getElementById('notif-zone')?.contains(e.target)) toggle(false); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.notifOpen) toggle(false); });
    }
  }

  // ── Render principal de la vista ──
  function render({ d2026, weeklyData, transactions, weekly2025, d2025Ref, plan,
                   ventasInfo, onSyncVentas, onPlanChange, daily2026 }) {
    state.d2026        = d2026;
    state.daily2026    = daily2026 || null;
    state.weeklyData   = weeklyData;
    state.transactions = transactions;
    state.weekly2025   = weekly2025 || {};
    state.d2025Ref     = d2025Ref || d2025;
    state.avgTickets   = computeAvgTickets(d2026, transactions);
    state.plan         = plan || null;
    state.ventasInfo   = ventasInfo || null;
    state.onSyncVentas = onSyncVentas || null;
    state.onPlanChange = onPlanChange || null;

    // Primero el cuadro del mes: monta el bloque del gráfico en su recuadro, así Chart.js lo crea con tamaño.
    renderPlanSection();

    // Evolución semanal (52 semanas 2025 + 2026 disponibles), dentro del recuadro del mes abierto
    if (global.Charts?.combinedWeeklyChart) {
      const initSelCh = document.getElementById('chart-channel-select')?.value || '';
      const initChKey = initSelCh ? chToUpper[initSelCh] : 'TOTAL';
      global.Charts.combinedWeeklyChart(state.weekly2025, state.weeklyData, initChKey);
      applyWeeklyLabels();
    }

    // ── Toggle Semanal / Mensual ──
    const toggleEl = document.getElementById('weekly-view-toggle');
    const titleEl  = document.getElementById('combined-chart-title');
    if (toggleEl) {
      // Siempre resetear a Semanal cuando se cargan datos frescos
      toggleEl.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
      const weeklyBtn = toggleEl.querySelector('[data-mode="weekly"]');
      if (weeklyBtn) weeklyBtn.classList.add('active');
      const initLabel = document.getElementById('chart-channel-select')?.value || 'Total';
      if (titleEl) titleEl.textContent = `Evolución semanal · ${initLabel} · 2025 vs 2026`;

      if (!toggleEl.dataset.wired) {
        toggleEl.dataset.wired = '1';
        const ALL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const MONTH_SHORT = { Enero:'Ene', Febrero:'Feb', Marzo:'Mar', Abril:'Abr', Mayo:'May', Junio:'Jun', Julio:'Jul', Agosto:'Ago', Septiembre:'Sep', Octubre:'Oct', Noviembre:'Nov', Diciembre:'Dic' };

        const cumStrip = document.getElementById('cum-kpi-strip');

        // Helper: etiqueta del canal seleccionado para usar en títulos
        const getSelCh   = () => document.getElementById('chart-channel-select')?.value || '';
        const getChLabel = () => getSelCh() || 'Total';
        const getChKey   = () => { const c = getSelCh(); return c ? chToUpper[c] : 'TOTAL'; };

        toggleEl.querySelectorAll('.vt-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            toggleEl.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const chart = global.Charts?.getInstance('chart-weekly-combined');
            if (!chart) return;

            const selCh    = getSelCh();
            const chLabel  = getChLabel();

            if (btn.dataset.mode === 'monthly') {
              if (titleEl) titleEl.textContent = `Evolución mensual · ${chLabel} · 2025 vs 2026`;
              if (cumStrip) cumStrip.style.display = 'none';

              const mData25 = ALL_MONTHS.map(m => Math.round(getChVal(state.d2025Ref[m], selCh)));
              const mData26 = ALL_MONTHS.map(m => {
                const v = getChVal(state.d2026?.[m], selCh);
                return v > 0 ? Math.round(v) : null;
              });

              chart.data.labels = ALL_MONTHS.map(m => MONTH_SHORT[m]);
              chart.data.datasets[0].data = mData25;
              chart.data.datasets[1].data = mData26;

              // ── Datalabels: valor + delta por nodo ──
              chart.data.datasets[0].datalabels = {
                display: true,
                color: '#94a3b8',
                anchor: 'end',
                align: 'bottom',
                offset: 5,
                font: { size: 10, weight: '400' },
                formatter: v => fmtShort(v),
              };
              chart.data.datasets[1].datalabels = {
                display: ctx => ctx.dataset.data[ctx.dataIndex] !== null,
                color: '#2563eb',
                anchor: 'end',
                align: 'top',
                offset: 5,
                font: { size: 10, weight: '600' },
                formatter: (v, ctx) => {
                  if (v === null) return null;
                  const ref = mData25[ctx.dataIndex];
                  if (!ref) return fmtShort(v);
                  const pct = (v - ref) / ref * 100;
                  const sign = pct >= 0 ? '+' : '';
                  return `${fmtShort(v)}\n${sign}${pct.toFixed(0)}%`;
                },
              };
              chart.options.plugins.datalabels = { display: true };
              chart.options.layout = { padding: { top: 32, bottom: 8 } };
              chart.update();

            } else if (btn.dataset.mode === 'cumulative') {
              if (titleEl) titleEl.textContent = `Acumulado interanual · ${chLabel} · 2025 vs 2026`;

              // ── Calcular running totals por canal ──
              let cum25 = 0, cum26 = 0;
              const cum25Data = [], cum26Data = [];

              ALL_MONTHS.forEach(m => {
                cum25 += Math.round(getChVal(state.d2025Ref[m], selCh));
                const v26 = getChVal(state.d2026?.[m], selCh);
                cum25Data.push(cum25);
                if (v26 > 0) {
                  cum26 += Math.round(v26);
                  cum26Data.push(cum26);
                } else {
                  cum26Data.push(null);
                }
              });

              chart.data.labels = ALL_MONTHS.map(m => MONTH_SHORT[m]);

              // Dataset 2025: línea gris más gruesa para que sea legible como acumulado
              chart.data.datasets[0].data = cum25Data;
              chart.data.datasets[0].borderWidth = 2;

              // Dataset 2026: línea azul sólida
              chart.data.datasets[1].data = cum26Data;
              chart.data.datasets[1].borderWidth = 3;
              chart.data.datasets[1].fill = false;

              // ── Datalabels: acumulado + delta por nodo ──
              chart.data.datasets[0].datalabels = {
                display: true,
                color: '#94a3b8',
                anchor: 'end',
                align: 'bottom',
                offset: 5,
                font: { size: 10, weight: '400' },
                formatter: v => fmtShort(v),
              };
              chart.data.datasets[1].datalabels = {
                display: ctx => ctx.dataset.data[ctx.dataIndex] !== null,
                color: '#2563eb',
                anchor: 'end',
                align: 'top',
                offset: 5,
                font: { size: 10, weight: '600' },
                formatter: (v, ctx) => {
                  if (v === null) return null;
                  const ref = cum25Data[ctx.dataIndex];
                  if (!ref) return fmtShort(v);
                  const pct = (v - ref) / ref * 100;
                  const sign = pct >= 0 ? '+' : '';
                  return `${fmtShort(v)}\n${sign}${pct.toFixed(0)}%`;
                },
              };
              chart.options.plugins.datalabels = { display: true };
              chart.options.layout = { padding: { top: 32, bottom: 8 } };
              chart.update();

              // ── KPI strip: diferencia YTD ──
              const lastIdx = cum26Data.reduce((li, v, i) => v !== null ? i : li, -1);
              if (cumStrip && lastIdx >= 0) {
                const periodLabel = lastIdx === 0
                  ? MONTH_SHORT[ALL_MONTHS[0]]
                  : `Ene–${MONTH_SHORT[ALL_MONTHS[lastIdx]]}`;
                const ytd25  = cum25Data[lastIdx];
                const ytd26  = cum26Data[lastIdx];
                const diff   = ytd26 - ytd25;
                const diffPct = ytd25 > 0 ? diff / ytd25 * 100 : 0;
                const isAhead = diff >= 0;
                const diffColor = isAhead ? 'var(--green-text)' : 'var(--red-text)';
                const diffBg    = isAhead ? 'var(--green-soft)' : 'var(--red-soft)';
                const diffBorder= isAhead ? '#6ee7b7' : '#fca5a5';

                cumStrip.style.display = '';
                cumStrip.innerHTML = `
                  <div class="cum-kpi-strip">
                    <div class="cum-kpi-card">
                      <div class="cum-kpi-lbl">2025 · ${periodLabel}</div>
                      <div class="cum-kpi-val">S/. ${fmt(ytd25)}</div>
                      <div class="cum-kpi-sub">acumulado referencia${selCh ? ' · ' + selCh : ''}</div>
                    </div>
                    <div class="cum-kpi-card cum-kpi-card-current">
                      <div class="cum-kpi-lbl">2026 · ${periodLabel}</div>
                      <div class="cum-kpi-val" style="color:var(--brand);">S/. ${fmt(ytd26)}</div>
                      <div class="cum-kpi-sub">acumulado en curso${selCh ? ' · ' + selCh : ''}</div>
                    </div>
                    <div class="cum-kpi-card" style="background:${diffBg};border-color:${diffBorder};">
                      <div class="cum-kpi-lbl">Diferencia YoY</div>
                      <div class="cum-kpi-val" style="color:${diffColor};">${isAhead ? '+' : ''}S/. ${fmt(diff)}</div>
                      <div class="cum-kpi-sub" style="color:${diffColor};font-weight:600;">
                        ${isAhead ? '▲' : '▼'} ${Math.abs(diffPct).toFixed(1)}% vs 2025
                      </div>
                    </div>
                  </div>`;
              }

            } else {
              if (titleEl) titleEl.textContent = `Evolución semanal · ${chLabel} · 2025 vs 2026`;
              if (cumStrip) cumStrip.style.display = 'none';
              // Restaurar anchos de línea, datalabels y layout que pudieron modificarse
              const chart2 = global.Charts?.getInstance('chart-weekly-combined');
              if (chart2) {
                chart2.data.datasets[0].borderWidth = 1.5;
                chart2.data.datasets[1].borderWidth = 2;
                chart2.data.datasets[0].datalabels = { display: false };
                chart2.data.datasets[1].datalabels = { display: false };
                chart2.options.plugins.datalabels = { display: false };
                chart2.options.layout = { padding: 0 };
              }
              global.Charts.combinedWeeklyChart(state.weekly2025, state.weeklyData, getChKey());
              applyWeeklyLabels();
            }
          });
        });

        // ── Dropdown de canal: re-dispara el modo activo al cambiar ──
        const channelSel = document.getElementById('chart-channel-select');
        if (channelSel) {
          channelSel.addEventListener('change', () => {
            const activeBtn = toggleEl.querySelector('.vt-btn.active');
            if (!activeBtn) return;
            // Quita 'active' momentáneamente para que el handler del click proceda
            activeBtn.classList.remove('active');
            activeBtn.click();
          });
        }
      }
    }

    wireSync();
  }

  // ── Botones Sincronizar ──
  // Leen la hoja de Drive en este navegador: la zona se actualiza al instante para quien
  // sincroniza. El tablero publicado se actualiza solo con la corrida diaria.
  function wireSync() {
    const wire = (id, fn) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', fn);
    };
    wire('btn-sync-objetivos', () => runSync('objetivos', syncObjetivos));
    wire('btn-sync-ventas', () => runSync('ventas', () => {
      if (!state.onSyncVentas) throw new Error('sincronización no disponible');
      return state.onSyncVentas();
    }));
  }

  async function runSync(zona, fn) {
    const btn    = document.getElementById(`btn-sync-${zona}`);
    const status = document.getElementById(`${zona}-sync-status`);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('loading');
    if (status) { status.className = 'zone-status'; status.textContent = 'Leyendo Drive…'; }
    try {
      await fn();
      if (status) { status.className = 'zone-status ok'; status.textContent = 'Actualizado desde Drive en este navegador'; }
    } catch (err) {
      console.error(`[objetivos] no se pudo sincronizar ${zona}`, err);
      if (status) { status.className = 'zone-status err'; status.textContent = `No se pudo sincronizar: ${err.message}`; }
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }

  async function syncObjetivos() {
    const fuente = state.plan?.fuente;
    if (!fuente?.archivo?.id) throw new Error('los objetivos publicados no indican qué hoja de Drive leer');
    const tabs  = await FD().descargarLibro(fuente.archivo.id, { XLSX: global.XLSX });
    const leido = FD().objetivosDelLibro(tabs);
    state.plan = {
      ...state.plan,
      sincronizado: FD().ahoraLima(),
      fuente: { ...fuente, pestana: leido.pestana },
      canales: leido.canales,
      meses: leido.meses,
      metas: leido.metas,
      referencia: leido.referencia,
      avisos: leido.avisos,
    };
    renderPlanSection();
    state.onPlanChange?.(state.plan);
  }

  // "Objetivos: <archivo> (Drive) · sincronizado hace 2 h"
  function fuenteHTML(fuente, fecha, extra = '', label = 'Fuente') {
    if (!fuente?.archivo?.id) return `${label}: Drive (sin datos de la última sincronización)`;
    const hace = global.Sheets?.formatRelative ? global.Sheets.formatRelative(fecha) : (fecha || '');
    return `${label}: <a href="${FD().urlHoja(fuente.archivo.id)}" target="_blank" rel="noopener">${esc(fuente.archivo.nombre)}</a>
      (Drive) · sincronizado <span title="${esc(fecha || '')}">${esc(hace)}</span>${extra}`;
  }

  const fechaCorta = iso => {
    if (!iso) return '';
    const [y, mo, d] = iso.split('-').map(Number);
    return `${d} ${MONTH_ABR[months[mo - 1]]} ${y}`;
  };

  const hasSales = m => monthStatus(m) === 'past' || (monthStatus(m) === 'current' && isLiveMonth(m));

  // ── Objetivos y ventas por mes ──
  // Una pestaña por mes (Enero–Diciembre) y Anual. Cada mes junta la meta del archivo de objetivos y
  // la venta del histórico en un solo cuadro, una fila por canal de ventas, con dos vistas:
  // Avance vs meta y Ventas vs 2025.

  // Columnas en el orden del archivo de ventas.
  const VENTAS_COLS = ['WhatsApp', 'Instagram', 'Facebook', 'Showroom', 'Web', 'Tienda'];
  const ANUAL = 'Anual';

  // El canal del archivo de objetivos que nombra la columna (WHATSAPP → WhatsApp, OUTLET → Showroom).
  // Las columnas que ningún objetivo nombra (Instagram, Facebook) van con meta 0. Es solo para este
  // cuadro: Proyecciones, el plan por campaña y el correo siguen midiendo "Redes y WhatsApp" con las
  // tres columnas que suma.
  const planOfCol = col => planChannels().find(c => c.sheet[0] === col) || null;
  const colMeta   = (m, col) => { const c = planOfCol(col); return c ? target(m, c.key) : 0; };
  const colRef    = (m, col) => { const c = planOfCol(col); return c ? ref2025(m, c.key) : 0; };
  const txOf      = (m, cols) => cols.reduce((s, col) => s + ((state.transactions?.[m] || {})[chToUpper[col]] || 0), 0);
  const hasMeta   = m => monthTarget(m) > 0;
  const conVentas = m => tot(state.d2026?.[m] || {}) > 0;
  const monthRange = list => list.length <= 1 ? (list[0] || '') : `${monthShort(list[0])}–${monthShort(list[list.length - 1])}`;
  const colPip    = col => palette[col] || '#64748B';
  const colName   = col => `<span class="ch-name"><span class="ch-pip" style="background:${colPip(col)}"></span>${col}</span>`;
  // La columna que más vendió en los meses dados.
  const topCol = list => VENTAS_COLS
    .map(col => ({ col, v: list.reduce((s, m) => s + ((state.d2026?.[m] || {})[col] || 0), 0) }))
    .sort((a, b) => b.v - a.v)[0];

  function renderPlanSection() {
    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!monthTabsEl || !monthPanelsEl) return;

    const objFuente = document.getElementById('objetivos-fuente');
    if (objFuente) objFuente.innerHTML = fuenteHTML(state.plan?.fuente, state.plan?.sincronizado, '', 'Objetivos');
    const ventasFuente = document.getElementById('ventas-fuente');
    const info = state.ventasInfo || {};
    if (ventasFuente) {
      const ultimo = info.fuente?.ultimoDia ? ` · último día con ventas: ${fechaCorta(info.fuente.ultimoDia)}` : '';
      ventasFuente.innerHTML = fuenteHTML(info.fuente, info.generated, ultimo, 'Ventas');
    }

    // Sin objetivos el cuadro sigue mostrando las ventas, sin vista de avance.
    const errorEl = document.getElementById('plan-error');
    if (errorEl) {
      errorEl.hidden = !!(state.plan && objMonths().length);
      errorEl.innerHTML = state.plan
        ? '<b>Sin objetivos:</b> el archivo de objetivos de Drive no tiene meses con PROYECCIÓN.'
        : '<b>Objetivos no disponibles:</b> no se pudo cargar <code>data/objetivos-2026.json</code>.';
    }
    renderMonthPanels();
    renderPlanNotes();
    renderNotificaciones();
  }

  // Debajo del cuadro solo van los avisos de la lectura del archivo de objetivos (vacío si no hay
  // problemas). Lo demás se explica donde se usa: títulos de encabezados, celdas, píldoras y filas.
  function renderPlanNotes() {
    const notes = document.getElementById('plan-notes');
    if (!notes) return;
    notes.innerHTML = (state.plan?.avisos || []).map(a => `<div class="plan-aviso">⚠ ${esc(a)}</div>`).join('');
  }

  function selectMonth(m) {
    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!monthTabsEl || !monthPanelsEl) return;
    monthTabsEl.querySelectorAll('.month-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.month === m);
      t.setAttribute('aria-pressed', String(t.dataset.month === m));
    });
    monthPanelsEl.querySelectorAll('.mpanel').forEach(p => p.classList.toggle('visible', p.id === 'mpanel-' + m));
    mountShared(m);
  }

  // Las notas y la evolución semanal son una sola pieza (un solo gráfico): van al final del
  // recuadro del mes abierto. Antes de redibujar los meses vuelven a #obj-shared para no perderse.
  const SHARED_IDS = ['plan-notes', 'weekly-block'];
  function mountShared(m) {
    const slot = document.querySelector(`#mpanel-${m} .obj-shared-slot`);
    if (!slot) return;
    SHARED_IDS.forEach(id => { const n = document.getElementById(id); if (n) slot.appendChild(n); });
  }
  function parkShared() {
    const holder = document.getElementById('obj-shared');
    if (!holder) return;
    SHARED_IDS.forEach(id => { const n = document.getElementById(id); if (n) holder.appendChild(n); });
  }

  // Vista del cuadro, la misma en todos los meses. Un mes sin metas (o Anual) solo tiene Ventas.
  function applyVista() {
    document.querySelectorAll('#month-panels .mpanel').forEach(p => {
      const v = p.dataset.meta === '1' ? state.vista : 'ventas';
      p.querySelectorAll('[data-vista-tabla]').forEach(t => { t.hidden = t.dataset.vistaTabla !== v; });
      p.querySelectorAll('.vt-btn[data-vista]').forEach(b => {
        b.classList.toggle('active', b.dataset.vista === v);
        b.setAttribute('aria-pressed', String(b.dataset.vista === v));
      });
    });
  }
  const vistaToggle = (meta, why) => `
    <div class="view-toggle" role="group" aria-label="Vista del cuadro">
      <button type="button" class="vt-btn" data-vista="avance"${meta ? '' : ` disabled title="${esc(why)}"`}>Avance vs meta</button>
      <button type="button" class="vt-btn" data-vista="ventas">Ventas vs 2025</button>
    </div>`;

  function renderMonthPanels() {
    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!monthTabsEl || !monthPanelsEl) return;
    // Al volver a dibujar (sincronización) se conserva el mes abierto.
    const openMonth = monthTabsEl.querySelector('.month-tab.active')?.dataset.month;
    parkShared();
    monthTabsEl.innerHTML   = '';
    monthPanelsEl.innerHTML = '';

    const tabs = [...months, ANUAL];
    const disponible = m => m === ANUAL ? months.some(conVentas) : conVentas(m) || hasMeta(m);
    const cur = months[currentMonthIdx()];
    const defaultMonth = [openMonth, cur].find(m => m && disponible(m))
      || [...months].reverse().find(conVentas) || tabs.find(disponible);

    tabs.forEach(m => {
      const ok = disponible(m);
      const status = m === ANUAL ? 'past' : monthStatus(m);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = ['month-tab', m === defaultMonth ? 'active' : '', m === cur ? 'active-current' : '',
        ok && status !== 'future' ? 'past' : 'future'].filter(Boolean).join(' ');
      tab.dataset.month = m;
      tab.setAttribute('aria-pressed', String(m === defaultMonth));
      tab.textContent = m + (m === cur ? ' ◉' : '');
      if (!ok) {
        tab.disabled = true;
        tab.title = `Sin ventas ni metas de ${m.toLowerCase()}`;
      } else {
        tab.addEventListener('click', () => selectMonth(m));
      }
      monthTabsEl.appendChild(tab);
      if (!ok) return;

      const panel = document.createElement('div');
      panel.className = 'mpanel' + (m === defaultMonth ? ' visible' : '');
      panel.id = 'mpanel-' + m;
      panel.dataset.meta = m !== ANUAL && hasMeta(m) ? '1' : '0';
      panel.innerHTML = m === ANUAL ? anualPanelHTML() : monthPanelHTML(m);
      monthPanelsEl.appendChild(panel);

      if (m === ANUAL) {
        document.getElementById('pace-' + ANUAL).innerHTML = anualKpis();
      } else {
        if (hasMeta(m)) refreshObjTotal(m);
        refreshPaceCards(m);
      }

      // Botones › de cada canal (detalle semanal)
      panel.querySelectorAll('.ch-weeks-toggle').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const detailRow = document.getElementById(btn.dataset.detail);
          if (!detailRow) return;
          const isOpen = detailRow.style.display !== 'none';
          detailRow.style.display = isOpen ? 'none' : 'table-row';
          btn.setAttribute('aria-expanded', String(!isOpen));
          btn.classList.toggle('open', !isOpen);
        });
      });
      panel.querySelectorAll('.vt-btn[data-vista]:not(:disabled)').forEach(btn => btn.addEventListener('click', () => {
        state.vista = btn.dataset.vista;
        applyVista();
      }));
    });
    applyVista();
    if (defaultMonth) mountShared(defaultMonth);
  }

  // ── Un mes: estado, tarjetas, alertas y el cuadro con sus dos vistas ──
  function monthPanelHTML(m) {
    const status = monthStatus(m);
    const meta   = hasMeta(m);
    const live   = status !== 'future' && isLiveMonth(m);
    const corte  = corteLabel(m);
    const refTxt = meta && state.plan?.referencia ? ` · ${refLabel().replace('Ref.', 'referencia')}: <strong>S/. ${fmt(monthRef2025(m))}</strong>` : '';
    const hoy    = currentCalendarDay();
    const statusNote = status === 'current'
      ? `<div class="period-note">${m} 2026 está en curso · ventas cargadas al ${corte} (día ${daysPassed(m)} de ${objectiveDays(m)})${hoy > daysPassed(m) ? ` · hoy es ${hoy}` : ''}${refTxt}</div>`
      : status === 'future'
        ? `<div class="period-note">${m} 2026 es mes futuro${meta ? ` · meta <strong>S/. ${fmt(monthTarget(m))}</strong>` : ''}${refTxt}</div>`
        : '';
    const sub = [`${m} 2026`, meta ? 'meta del archivo de objetivos' : 'sin metas en el archivo de objetivos', live ? `ventas al ${corte}` : '']
      .filter(Boolean).join(' · ');
    return `
      ${statusNote}
      <div id="pace-${m}" style="margin-bottom:16px;"></div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Ventas y avance por canal</div>
            <div class="panel-sub">${sub}</div>
          </div>
          ${vistaToggle(meta, 'Este mes no tiene metas en el archivo de objetivos')}
        </div>
        ${meta ? `<div class="plan-table-wrap" data-vista-tabla="avance">${avanceTableHTML(m)}</div>` : ''}
        <div class="plan-table-wrap" data-vista-tabla="ventas">${ventasTableHTML(m)}</div>
        <div class="obj-shared-slot"></div>
      </div>`;
  }

  // Vista Avance vs meta: una fila por canal de ventas con su meta (0 si ningún objetivo la nombra),
  // lo esperado al corte, la venta, el avance y la brecha.
  function avanceTableHTML(m) {
    const status     = monthStatus(m);
    const d2026Month = state.d2026?.[m] || {};
    const monthTotal = tot(d2026Month);
    const showReal   = hasSales(m);
    const live       = status !== 'future' && isLiveMonth(m);
    const corte      = corteLabel(m);
    const share      = v => showReal && monthTotal > 0 ? (v / monthTotal * 100).toFixed(1) + '%' : '—';
    const realCell   = v => showReal ? 'S/. ' + fmt(v) : '<span class="muted">—</span>';
    const todayPct   = status === 'current' ? visualTodayPct(m) : null;
    const todayPin   = todayPct !== null
      ? `<div class="pb-today-pin" style="left:${todayPct}%" title="Ventas cargadas al ${corte} · hoy es ${currentCalendarDay()}">
           <span class="pb-today-day">${daysPassed(m)}</span>
           <div class="pb-today-tri"></div>
         </div>`
      : '';
    // Barra de avance: con meta, el relleno es venta / meta; sin meta (0) no hay avance que medir.
    const bar = (id, real, meta) => {
      const p = meta > 0 ? real / meta * 100 : 0;
      const fill = !showReal || !meta ? 'width:0%' : `width:${p > 0 ? Math.min(p, 100).toFixed(1) + '%' : '6px'};background:${pctFill(p)}`;
      const pct = !showReal ? '—' : meta > 0 ? p.toFixed(0) + '%' : 'meta 0';
      return `
        <div class="pb-wrap">
          <div class="pb-outer">
            <div class="pb-ruler">
              <div class="pb-bg"><div class="pb-fill" id="pb-${id}" style="${fill}"></div></div>
              ${todayPin}
            </div>
            <div class="pb-day-scale"><span>${visualRulerStart(m)}</span><span>${visualRulerEnd(m)}</span></div>
          </div>
          <span class="pct-val" id="pv-${id}" style="color:${showReal && meta > 0 ? pctColor(p) : 'var(--muted)'}">${pct}</span>
        </div>`;
    };
    const gapCell = (real, meta) => {
      if (!showReal) return `<span class="gap-val" style="color:var(--muted)">${status === 'future' ? 'futuro' : '—'}</span>`;
      const gap = real - meta;
      return `<span class="gap-val ${gap >= 0 ? 'g-pos' : 'g-neg'}">${gap >= 0 ? '+' : ''}S/. ${fmt(gap)}</span>`;
    };

    const rows = VENTAS_COLS.map(col => {
      const c        = planOfCol(col);
      const real     = d2026Month[col] || 0;
      const meta     = colMeta(m, col);
      const esperado = live && meta > 0 ? expectedTo(m, meta) : 0;
      // Detalle semanal con la meta del canal y la venta de esta columna sola.
      const wkDetailId = `ch-weeks-${m}-${col}`;
      const weeks = c && meta > 0 ? `
        <tr class="ch-weeks-row" id="${wkDetailId}" style="display:none;">
          <td colspan="8" style="padding:0;">
            <div class="ch-weeks-inner">${buildChannelWeeklyHTML(m, { ...c, label: col, sheet: [col] }, status)}</div>
          </td>
        </tr>` : '';
      const toggle = weeks ? `
        <button class="ch-weeks-toggle" data-detail="${wkDetailId}" title="Ver semanas" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round"
               style="width:12px;height:12px;pointer-events:none;display:block;">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>` : '<span class="ch-weeks-spacer"></span>';
      return `<tr class="ch-obj-row">
          <td>
            <div class="ch-cell">${toggle}${colName(col)}</div>
            <div class="ch-parts${c?.nota ? ' has-note' : ''}" title="${c
              ? `Meta de «${esc(c.etiqueta)}» (columna PROYECCIÓN del archivo de objetivos)${c.nota ? ` · ${esc(c.nota)}` : ''}`
              : 'Ningún objetivo del archivo nombra este canal: va con meta 0'}">${c ? `meta «${esc(c.etiqueta)}»` : 'sin meta propia'}</div>
          </td>
          <td class="r mono text-2">${c && state.plan?.referencia ? 'S/. ' + fmt(colRef(m, col)) : '—'}</td>
          <td class="r mono${meta > 0 ? '' : ' text-2'}">S/. ${fmt(meta)}</td>
          <td class="r mono text-2">${live ? 'S/. ' + fmt(esperado) : '<span class="muted">—</span>'}</td>
          <td class="r mono">${realCell(real)}${showReal && esperado ? vsExpectedPill(real, esperado, corte) : ''}</td>
          <td class="r">${share(real)}</td>
          <td class="r" style="min-width:150px;">${bar(`${m}-${col}`, real, meta)}</td>
          <td class="r">${gapCell(real, meta)}</td>
        </tr>${weeks}`;
    }).join('');

    const tt = monthTarget(m);
    return `<table class="month-table">
      <thead><tr>
        <th>Canal</th>
        <th class="r" title="Referencia del archivo de objetivos">${refLabel()}</th>
        <th class="r">Meta</th>
        <th class="r" title="Meta repartida por días hasta el último día con ventas">Esperado al ${corte}</th>
        <th class="r">Real 2026</th>
        <th class="r">Participación</th>
        <th class="r" style="min-width:140px;">Avance</th>
        <th class="r">Brecha</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="ch-total-row">
          <td><strong>Total</strong></td>
          <td class="r mono text-2">${state.plan?.referencia ? 'S/. ' + fmt(monthRef2025(m)) : '—'}</td>
          <td class="r mono" id="mt-${m}"></td>
          <td class="r mono text-2">${live && tt > 0 ? 'S/. ' + fmt(expectedTo(m, tt)) : '<span class="muted">—</span>'}</td>
          <td class="r mono">${realCell(monthTotal)}${showReal && live ? vsExpectedPill(monthTotal, expectedTo(m, tt), corte) : ''}</td>
          <td class="r">${showReal ? '100%' : '—'}</td>
          <td class="r" style="min-width:150px;">
            <div class="pb-wrap">
              <div class="pb-outer">
                <div class="pb-ruler">
                  <div class="pb-bg"><div class="pb-fill" id="pb-tot-${m}"></div></div>
                  ${todayPin}
                </div>
                <div class="pb-day-scale"><span>${visualRulerStart(m)}</span><span>${visualRulerEnd(m)}</span></div>
              </div>
              <span class="pct-val" id="pv-tot-${m}"></span>
            </div>
          </td>
          <td class="r" id="gv-tot-${m}"></td>
        </tr>
      </tbody>
    </table>`;
  }

  // Vista Ventas vs 2025: venta del mes, el mismo mes de 2025, participación, transacciones y ticket.
  function ventasTableHTML(m) {
    const mes     = state.d2026?.[m] || {};
    const ref     = state.d2025Ref?.[m] || {};
    const total   = tot(mes);
    const enCurso = monthStatus(m) === 'current';
    const conV    = conVentas(m);
    const varPill = (v26, v25) => {
      if (!conV || !v25) return '<span class="muted">—</span>';
      const d = Math.round((v26 / v25 - 1) * 100);
      return pill(enCurso ? 'gray' : d >= 0 ? 'green' : 'red', `${d >= 0 ? '+' : '−'}${Math.abs(d)}%`,
        enCurso ? `${daysPassed(m)} días de 2026 frente al mes completo de 2025` : `${m} 2026 frente a ${m} 2025`);
    };
    const cells = (v26, v25, q) => `
      <td class="r mono">${conV ? 'S/. ' + fmt(v26) : '<span class="muted">—</span>'}</td>
      <td class="r mono text-2">${v25 ? 'S/. ' + fmt(v25) : '—'}</td>
      <td class="r">${varPill(v26, v25)}</td>
      <td class="r">${conV && total > 0 ? (v26 / total * 100).toFixed(1) + '%' : '—'}</td>
      <td class="r mono">${q ? fmt(q) : '—'}</td>
      <td class="r mono">${q ? 'S/. ' + fmt(v26 / q) : '—'}</td>`;
    const rows = VENTAS_COLS.map(col => `
      <tr class="ch-obj-row">
        <td>${colName(col)}</td>
        ${cells(mes[col] || 0, ref[col] || 0, txOf(m, [col]))}
      </tr>`).join('');
    return `<table class="month-table">
      <thead><tr>
        <th>Canal</th>
        <th class="r">${m} 2026</th>
        <th class="r" title="Histórico de ventas 2025">${m} 2025</th>
        <th class="r">Var.</th>
        <th class="r">Participación</th>
        <th class="r">Transacciones</th>
        <th class="r" title="Venta / transacciones">Ticket promedio</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="ch-total-row">
          <td><strong>Total</strong></td>
          ${cells(total, tot(ref), txOf(m, VENTAS_COLS))}
        </tr>
      </tbody>
    </table>`;
  }

  // Tarjetas de un mes sin metas: la venta frente a 2025, transacciones, ticket y el canal que más vende.
  function ventasKpis(m) {
    const real    = tot(state.d2026?.[m] || {});
    const r25     = tot(state.d2025Ref?.[m] || {});
    const enCurso = monthStatus(m) === 'current';
    const q       = txOf(m, VENTAS_COLS);
    const dias    = daysPassed(m);
    const top     = topCol([m]);
    const d       = r25 ? Math.round((real / r25 - 1) * 100) : null;
    const cards = [
      kpi({ label: enCurso ? `Vendido al ${corteLabel(m)}` : `Vendido en ${m.toLowerCase()}`, value: `S/. ${fmt(real)}`,
        subs: [d !== null ? `${pill(enCurso ? 'gray' : d >= 0 ? 'green' : 'red', `${d >= 0 ? '+' : '−'}${Math.abs(d)}% vs 2025`)} ${m.toLowerCase()} 2025: S/. ${fmt(r25)}` : 'sin referencia 2025',
          'sin metas en el archivo de objetivos'] }),
      kpi({ label: 'Transacciones', value: q ? fmt(q) : '—', subs: [q && dias ? `${pill('gray', `${dias} días`)} ${fmt(q / dias)} por día` : ''] }),
      kpi({ label: 'Ticket promedio', value: q ? `S/. ${fmt(real / q)}` : '—', subs: ['venta / transacciones'] }),
      kpi({ label: 'Canal que más vende', value: top && top.v > 0 ? top.col : '—',
        subs: [top && real > 0 ? `${pill('gray', `${(top.v / real * 100).toFixed(0)}% del mes`)} S/. ${fmt(top.v)}` : ''] }),
    ];
    return `<div class="kpi-strip obj-kpis">${cards.join('')}</div>`;
  }

  // ── Anual: acumulado del año y el cuadro de los 12 meses ──
  function anualKpis() {
    const mesesV    = months.filter(conVentas);
    const real      = mesesV.reduce((s, m) => s + tot(state.d2026[m]), 0);
    const q         = mesesV.reduce((s, m) => s + txOf(m, VENTAS_COLS), 0);
    const metaMeses = objMonths().filter(hasMeta);
    const metaTot   = metaMeses.reduce((s, m) => s + monthTarget(m), 0);
    const realMeta  = metaMeses.filter(conVentas).reduce((s, m) => s + tot(state.d2026[m]), 0);
    const espMeta   = metaMeses.reduce((s, m) => s + (monthStatus(m) === 'future' ? 0 : expectedTo(m, monthTarget(m))), 0);
    const ritmo     = espMeta > 0 ? realMeta / espMeta : 0;
    const cls       = ritmo >= 1 ? 'green' : ritmo >= 0.9 ? 'amber' : 'red';
    const cumplido  = metaTot > 0 ? realMeta / metaTot * 100 : 0;
    const top       = topCol(mesesV);
    const cards = [
      kpi({ label: 'Vendido 2026', value: `S/. ${fmt(real)}`,
        subs: [`${pill('gray', `${mesesV.length} meses`)} promedio S/. ${fmt(mesesV.length ? real / mesesV.length : 0)} por mes`] }),
      metaTot > 0
        ? kpi({ label: `Meta ${monthRange(metaMeses)}`, value: `S/. ${fmt(metaTot)}`,
            extra: kpiBar(cumplido, cls, null, `${cumplido.toFixed(0)}% cumplido`),
            subs: [`${pill(cls, `${cumplido.toFixed(0)}% cumplido`)} S/. ${fmt(realMeta)} vendidos`] })
        : kpi({ label: 'Meta', value: '—', subs: ['sin metas en el archivo de objetivos'] }),
      kpi({ label: 'Transacciones 2026', value: fmt(q), subs: [q ? `${pill('gray', `ticket S/. ${fmt(real / q)}`)} promedio del año` : ''] }),
      kpi({ label: 'Canal que más vende', value: top && top.v > 0 ? top.col : '—',
        subs: [top && real > 0 ? `${pill('gray', `${(top.v / real * 100).toFixed(0)}% del año`)} S/. ${fmt(top.v)}` : ''] }),
    ];
    return `<div class="kpi-strip obj-kpis">${cards.join('')}</div>`;
  }

  function anualPanelHTML() {
    const data = state.d2026 || {};
    const val  = (m, cols) => cols.reduce((s, col) => s + ((data[m] || {})[col] || 0), 0);
    const celda = (m, v, strong) => {
      if (!conVentas(m)) return '<td class="r pc">—</td>';
      const txt = fmtK(v);
      return `<td class="r pc" title="${m}: S/. ${fmt(v)}">${strong ? `<strong>${txt}</strong>` : txt}</td>`;
    };
    const fila = (name, cols, cls, strong) => {
      const totalAnio = months.reduce((s, m) => s + val(m, cols), 0);
      return `<tr class="${cls}">
        <td>${name}</td>
        ${months.map(m => celda(m, val(m, cols), strong)).join('')}
        <td class="r pc plan-col-sum" title="S/. ${fmt(totalAnio)}">${strong ? `<strong>${fmtK(totalAnio)}</strong>` : fmtK(totalAnio)}</td>
      </tr>`;
    };
    const rows = VENTAS_COLS.map(col => fila(colName(col), [col], 'ch-obj-row')).join('');
    return `
      <div id="pace-${ANUAL}" style="margin-bottom:16px;"></div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Ventas por canal y mes</div>
            <div class="panel-sub">2026 por mes calendario, como lo registra la marca</div>
          </div>
          ${vistaToggle(false, 'Las metas se ven en cada mes')}
        </div>
        <div class="plan-table-wrap" data-vista-tabla="ventas"><table class="plan-table ventas-table">
          <thead><tr>
            <th>Canal</th>
            ${months.map(m => `<th class="r">${monthShort(m)}</th>`).join('')}
            <th class="r plan-col-sum">Total 2026</th>
          </tr></thead>
          <tbody>${rows}${fila('<strong>Total</strong>', VENTAS_COLS, 'plan-total', true)}</tbody>
        </table></div>
        <div class="obj-shared-slot"></div>
      </div>`;
  }

  global.Objectives = { render, state };
})(window);
