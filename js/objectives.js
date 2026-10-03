/* ============================================================
   objectives.js — vista de Objetivos 2026.
   Cruza el plan del cliente (data/objetivos-2026.json: canales y metas
   mínima +10% / ideal +20%) con las ventas del Sheet en ciclo 26-25.
   Renderiza el cuadro anual, month-tabs, pace cards y detalle semanal.
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
    plan: null,            // data/objetivos-2026.json
    scenario: 'minima',    // escenario de meta: 'minima' (+10%) o 'ideal' (+20%)
    d2026: null,
    weeklyData: null,
    transactions: null,
    avgTickets: {},
    d2025Ref: d2025,
    periodDays: monthDays,
    cycleLabel: 'calendario',
  };

  // Las metas vienen fijas del plan; el navegador solo recuerda el escenario elegido.
  const SCENARIO_KEY = 'rb_objetivos_escenario';
  try {
    const saved = localStorage.getItem(SCENARIO_KEY);
    if (saved === 'minima' || saved === 'ideal') state.scenario = saved;
  } catch (e) { /* storage no disponible */ }

  function setScenario(scenario) {
    state.scenario = scenario;
    try { localStorage.setItem(SCENARIO_KEY, scenario); } catch (e) { /* storage no disponible */ }
    renderPlanSection();
  }

  // ── Plan: cada canal del plan suma una o más columnas del Sheet ──
  // (Redes y WhatsApp = WhatsApp + Instagram + Facebook)
  const planChannels = () => state.plan?.canales || [];
  const chColor      = c => palette[c.sheet[0]] || '#64748B';
  const chReal       = (monthObj, c) => c.sheet.reduce((s, col) => s + ((monthObj || {})[col] || 0), 0);
  const chWeekReal   = (wk, c) => c.sheet.reduce((s, col) => s + (wk[chToUpper[col]] || 0), 0);
  const target       = (m, key) => state.plan?.metas?.[state.scenario]?.[m]?.[key] || 0;
  const monthTarget  = m => planChannels().reduce((s, c) => s + target(m, c.key), 0);
  const ref2025      = (m, key) => state.plan?.real2025?.[m]?.[key] || 0;
  const monthRef2025 = m => planChannels().reduce((s, c) => s + ref2025(m, c.key), 0);
  const scenarioName = () => state.plan?.escenarios?.[state.scenario]?.label || 'Meta';

  // Montos compactos para el cuadro anual (miles de soles)
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
    const idx = now.getDate() > 25 ? now.getMonth() + 1 : now.getMonth();
    return idx > 11 ? 12 : idx;
  }
  function objectiveDays(m) {
    return state.periodDays?.[m] || monthDays[m];
  }
  function currentCommercialDay() {
    const now = new Date();
    if (now.getDate() > 25) return now.getDate() - 25;
    const previousMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    return previousMonthDays - 25 + now.getDate();
  }
  function currentCalendarDay() {
    return new Date().getDate();
  }
  function visualRulerStart(m) {
    return state.cycleLabel === '26-25' ? '26' : '1';
  }
  function visualRulerEnd(m) {
    return state.cycleLabel === '26-25' ? '25' : String(objectiveDays(m));
  }
  function visualTodayPct(m) {
    return (daysPassed(m) / objectiveDays(m) * 100).toFixed(1);
  }
  function monthStatus(m) {
    const idx = months.indexOf(m);
    const cur = currentMonthIdx();
    if (idx < cur)  return 'past';
    if (idx > cur)  return 'future';
    return 'current';
  }
  function daysPassed(m) {
    const s = monthStatus(m);
    if (s === 'past')    return objectiveDays(m);
    if (s === 'future')  return 0;
    return Math.min(objectiveDays(m), currentCommercialDay());
  }
  function daysRemaining(m) {
    const s = monthStatus(m);
    if (s === 'past')    return 0;
    if (s === 'future')  return objectiveDays(m);
    return Math.max(0, objectiveDays(m) - currentCommercialDay());
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

  // ── Actualizar DOM de una fila (barra + % + brecha) ──
  function renderRowUI(m, c) {
    const real   = chReal(state.d2026?.[m], c);
    const tgt    = target(m, c.key);
    const p      = tgt > 0 ? real / tgt * 100 : 0;
    const status = monthStatus(m);

    const pb = document.getElementById(`pb-${m}-${c.key}`);
    const pv = document.getElementById(`pv-${m}-${c.key}`);
    const gv = document.getElementById(`gv-${m}-${c.key}`);
    if (!pb || !pv || !gv) return;

    if (status === 'future' || (status === 'current' && !isLiveMonth(m))) {
      pb.style.width = '0%'; pv.textContent = '—'; pv.style.color = 'var(--muted)';
      gv.textContent = status === 'future' ? 'futuro' : '—';
      gv.className = 'gap-val'; gv.style.color = 'var(--muted)';
    } else if (tgt === 0) {
      pb.style.width = '0%'; pv.textContent = 'sin meta'; pv.style.color = 'var(--muted)';
      gv.textContent = '—';
      gv.className = 'gap-val'; gv.style.color = 'var(--muted)';
    } else {
      setProgressFill(pb, p);
      pb.style.background = pctFill(p);
      pv.textContent = p.toFixed(0) + '%';
      pv.style.color = pctColor(p);
      const gap = real - tgt;
      gv.textContent = (gap >= 0 ? '+' : '') + 'S/. ' + fmt(gap);
      gv.className = 'gap-val ' + (gap >= 0 ? 'g-pos' : 'g-neg');
    }
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

    // Para meses futuros: solo la meta + proyección diaria si no pasa nada hasta que llegue
    if (status === 'future') {
      el.innerHTML = `
        <div class="pace-grid">
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Días del mes</div>
              <span class="pace-badge muted">futuro</span>
            </div>
            <div class="pace-val">${objectiveDays(m)}</div>
            <div class="pace-sub">mes futuro</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">${scenarioName()}</div>
              <span class="pace-badge muted">plan</span>
            </div>
            <div class="pace-val brand">S/. ${fmt(tt)}</div>
            <div class="pace-sub">plan del cliente</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Venta diaria necesaria</div>
              <span class="pace-badge muted">proyección</span>
            </div>
            <div class="pace-val">S/. ${fmt(tt / objectiveDays(m))}</div>
            <div class="pace-sub">para alcanzar la meta</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Ref. ${m} 2025</div>
              <span class="pace-badge muted">referencia</span>
            </div>
            <div class="pace-val">S/. ${fmt(monthRef2025(m))}</div>
            <div class="pace-sub">cierre 2025 según el plan</div>
          </div>
        </div>`;
      return;
    }

    if (status === 'current') {
      // Referencia: mes cerrado anterior (si hay). Si no, usa marzo de respaldo.
      const curIdx = months.indexOf(m);
      const refMonth = curIdx > 0 ? months[curIdx - 1] : 'Marzo';
      const refTxns = Math.round(Object.values(state.transactions?.[refMonth] || {}).reduce((a, b) => a + b, 0) / (objectiveDays(refMonth) || 30));
      const refTk   = state.avgTickets?.[refMonth]?.TOTAL || 0;

      const pctPassed = Math.round(passed / objectiveDays(m) * 100);
      const pctMissing = faltante > 0 ? Math.round(faltante / tt * 100) : 0;
      el.innerHTML = `
        <div class="pace-grid">
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Días restantes</div>
              <span class="pace-badge muted">${pctPassed}% del mes</span>
            </div>
            <div class="pace-val">${remDays}</div>
            <div class="pace-sub">de ${objectiveDays(m)} en ${m.toLowerCase()}</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Faltante para meta</div>
              <span class="pace-badge ${faltante > 0 ? 'red' : 'green'}">${faltante > 0 ? '▼ ' + pctMissing + '%' : '✓ cubierto'}</span>
            </div>
            <div class="pace-val ${faltante > 0 ? 'red' : 'green'}">S/. ${fmt(faltante)}</div>
            <div class="pace-sub">${scenarioName()}: S/. ${fmt(tt)}</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Venta diaria necesaria</div>
              <span class="pace-badge muted">${remDays} días</span>
            </div>
            <div class="pace-val">S/. ${fmt(dailyNeed)}</div>
            <div class="pace-sub">para los ${remDays} días restantes</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Transacciones necesarias</div>
              <span class="pace-badge muted">S/. ${avgTk} ticket</span>
            </div>
            <div class="pace-val brand">${txnsNeed}/día</div>
            <div class="pace-sub">ticket promedio S/. ${avgTk}</div>
          </div>
        </div>
        ${refTk > 0 ? `<div class="pace-footnote">
          Referencia de ${refMonth.toLowerCase()}: <strong>${refTxns} transacciones/día</strong>
          con ticket promedio <strong>S/. ${refTk}</strong> → para alcanzar la meta de ${m.toLowerCase()} necesitás mantener un ritmo similar o superior.
        </div>` : ''}`;
    } else {
      const totalTx = avgTk > 0 ? Math.round(real / avgTk) : 0;
      const closeColor = real >= tt ? 'green' : pctMet >= 90 ? 'amber' : 'red';
      const closeBadgeLabel = closeColor === 'green' ? '✓ alcanzado' : closeColor === 'amber' ? '↑ casi' : '▼ brecha';
      el.innerHTML = `
        <div class="pace-grid">
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Cierre del mes</div>
              <span class="pace-badge ${closeColor}">${closeBadgeLabel}</span>
            </div>
            <div class="pace-val ${closeColor}">${pctMet.toFixed(1)}%</div>
            <div class="pace-sub">${real >= tt ? '✓ Objetivo alcanzado' : 'de la meta'}</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">${real >= tt ? 'Excedente' : 'Brecha final'}</div>
              <span class="pace-badge ${real >= tt ? 'green' : 'red'}">vs meta</span>
            </div>
            <div class="pace-val ${real >= tt ? 'green' : 'red'}">${real >= tt ? '+' : ''}S/. ${fmt(real - tt)}</div>
            <div class="pace-sub">vs meta S/. ${fmt(tt)}</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Venta diaria real</div>
              <span class="pace-badge muted">${passed} días</span>
            </div>
            <div class="pace-val">S/. ${fmt(dailyReal)}</div>
            <div class="pace-sub">promedio sobre ${passed} días</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Transacciones totales</div>
              <span class="pace-badge muted">S/. ${state.avgTickets[m]?.TOTAL || 0} ticket</span>
            </div>
            <div class="pace-val brand">${totalTx}</div>
            <div class="pace-sub">ticket promedio S/. ${state.avgTickets[m]?.TOTAL || 0}</div>
          </div>
        </div>`;
    }
  }

  // ── Detalle semanal por canal (expandible desde la fila de la tabla) ──
  // wk.w es el número de semana DENTRO del mes (1 = primera semana del mes)
  const MONTH_ABR = { Enero:'ene', Febrero:'feb', Marzo:'mar', Abril:'abr', Mayo:'may',
    Junio:'jun', Julio:'jul', Agosto:'ago', Septiembre:'sep', Octubre:'oct',
    Noviembre:'nov', Diciembre:'dic' };

  function weekDateRange(m, w) {
    const start = (w - 1) * 7 + 1;
    const end   = Math.min(w * 7, objectiveDays(m));
    return `${start}–${end} ${MONTH_ABR[m]}`;
  }

  // Construye el HTML interno del desplegable semanal de un canal del plan.
  // Incluye meta efectiva con arrastre de brecha semana a semana.
  function buildChannelWeeklyHTML(m, c, status) {
    const weeks = state.weeklyData?.[m];
    if (!weeks || !weeks.length) {
      return '<div style="padding:8px 4px;font-size:12px;color:var(--muted);">Sin datos semanales para este canal.</div>';
    }
    const monthChTgt  = target(m, c.key);
    const baseWeekTgt = monthChTgt > 0 ? monthChTgt * 7 / objectiveDays(m) : 0;
    const curWeekNum  = status === 'current' ? Math.ceil(new Date().getDate() / 7) : -1;

    let carry = 0;   // brecha arrastrada de semanas anteriores

    const weekRows = weeks.map((wk, i) => {
      const weekNum       = wk.w;
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
             ↳ Brecha S/. ${fmt(Math.abs(brecha))} se traslada a sem. ${i + 2} · su nueva meta efectiva: S/. ${fmt(baseWeekTgt + Math.abs(brecha))}
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
          <span class="pace-badge ${cls}" style="font-size:10px;padding:2px 6px;">${badge}</span>
        </div>
        ${traspasoHtml}`;
    }).join('');

    const metaHdr = baseWeekTgt > 0 ? `meta sem. base ≈ S/. ${fmt(baseWeekTgt)}` : 'sin objetivo definido';
    return `
      <div class="ch-weeks-header">${c.label} · ${m} · ${metaHdr}</div>
      <div class="ch-wk-col-head">
        <span>Semana</span><span></span>
        <span>Real / Meta efectiva</span>
        <span class="r">%</span><span></span>
      </div>
      ${weekRows}`;
  }

  // ── Panel de alertas: objetivo cumplido + brecha a mitad de mes ──
  function refreshAlertPanel(m) {
    const el = document.getElementById(`alert-panel-${m}`);
    if (!el) return;

    const status = monthStatus(m);
    if (status === 'future' || !isLiveMonth(m)) { el.innerHTML = ''; return; }

    const d2026Month = state.d2026?.[m] || {};
    const passed     = daysPassed(m);
    const totalDays  = objectiveDays(m);

    // Estadísticas por canal del plan
    const stats = planChannels().map(c => {
      const real = chReal(d2026Month, c);
      const tgt  = target(m, c.key);
      const pct  = tgt > 0 ? real / tgt * 100 : 0;
      const expectedReal = tgt > 0 ? tgt * passed / totalDays : 0;
      return { ch: c.label, color: chColor(c), real, tgt, pct, expectedReal, surplus: real - tgt, gap: tgt - real };
    }).filter(s => s.tgt > 0);

    // Canales que superaron el objetivo mensual
    const achieved = stats.filter(s => s.pct >= 100);

    // Canales por debajo del ritmo esperado a mitad de mes
    const pastMidMonth = status === 'current' && passed >= Math.floor(totalDays / 2);
    const lagging = pastMidMonth
      ? stats.filter(s => s.pct < 100 && s.real < s.expectedReal * 0.80)
      : [];

    if (achieved.length === 0 && lagging.length === 0) { el.innerHTML = ''; return; }

    let html = '<div class="obj-alerts-wrap">';

    // ── Objetivo alcanzado + sugerencia de redistribución ──
    if (achieved.length > 0) {
      const totalSurplus = achieved.reduce((s, a) => s + a.surplus, 0);
      // Canales con mayor brecha que aún no alcanzaron el objetivo
      const topNeed = stats
        .filter(s => s.pct < 90 && !achieved.find(a => a.ch === s.ch))
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 2);

      html += `
        <div class="obj-alert obj-alert-green">
          <div class="obj-alert-head">
            <span class="obj-alert-icon">🎯</span>
            <div class="obj-alert-text">
              <div class="obj-alert-title">Objetivo alcanzado</div>
              <div class="obj-alert-sub">
                ${achieved.map(a =>
                  `<span class="ch-pip" style="background:${a.color};display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:3px;"></span>
                   <strong>${a.ch}</strong> ${a.pct.toFixed(0)}% · excedente S/. ${fmt(a.surplus)}`
                ).join(' &nbsp;·&nbsp; ')}
              </div>
            </div>
          </div>
          ${topNeed.length > 0 ? `
          <div class="obj-alert-sug">
            <span>💡</span>
            <span>
              Excedente total <strong>S/. ${fmt(totalSurplus)}</strong>.
              Considerá traspasar presupuesto a
              ${topNeed.map(n =>
                `<strong>${n.ch}</strong> <span style="color:var(--red-text)">(brecha S/. ${fmt(n.gap)})</span>`
              ).join(' y ')}
              para reforzar las campañas de mayor brecha.
            </span>
          </div>` : ''}
        </div>`;
    }

    // ── Alerta de brecha a mitad de mes ──
    if (lagging.length > 0) {
      html += `
        <div class="obj-alert obj-alert-amber">
          <div class="obj-alert-head">
            <span class="obj-alert-icon">⚠️</span>
            <div class="obj-alert-text">
              <div class="obj-alert-title">Brecha a mitad de mes · día ${passed} de ${totalDays}</div>
              <div class="obj-alert-sub">Canales por debajo del 80% del ritmo esperado</div>
            </div>
          </div>
          <div class="obj-alert-rows">
            ${lagging.map(b => `
              <div class="obj-alert-row">
                <span class="ch-pip" style="background:${b.color};display:inline-block;width:7px;height:7px;border-radius:2px;flex-shrink:0;"></span>
                <span>
                  <strong>${b.ch}</strong>:
                  real S/. ${fmt(b.real)} ·
                  esperado S/. ${fmt(b.expectedReal)} ·
                  <span style="color:var(--red-text);font-weight:600;">brecha S/. ${fmt(Math.abs(b.real - b.expectedReal))}</span>
                </span>
              </div>`).join('')}
          </div>
          <div class="obj-alert-sug">
            <span>💡</span>
            <span>
              Quedan <strong>${totalDays - passed} días</strong> en el mes.
              Para cerrar la brecha de
              <strong>S/. ${fmt(lagging.reduce((s, b) => s + b.gap, 0))}</strong>
              se necesita un incremento diario de
              <strong>S/. ${fmt(lagging.reduce((s, b) => s + b.gap, 0) / Math.max(totalDays - passed, 1))}</strong>.
            </span>
          </div>
        </div>`;
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // ── Render principal de la vista ──
  function render({ d2026, weeklyData, transactions, weekly2025, d2025Ref, periodDays, cycleLabel, plan }) {
    state.d2026        = d2026;
    state.weeklyData   = weeklyData;
    state.transactions = transactions;
    state.weekly2025   = weekly2025 || {};
    state.d2025Ref     = d2025Ref || d2025;
    state.periodDays   = periodDays || monthDays;
    state.cycleLabel   = cycleLabel || 'calendario';
    state.avgTickets   = computeAvgTickets(d2026, transactions);
    state.plan         = plan || null;

    // Chart combinado arriba de los month tabs (52 semanas 2025 + 2026 disponibles)
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

    wireScenarioToggle();
    renderPlanSection();
  }

  // ── Plan vs ventas: escenario, KPIs, cuadro anual y meses ──
  function renderPlanSection() {
    const host          = document.getElementById('plan-section');
    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!host || !monthTabsEl || !monthPanelsEl) return;

    document.querySelectorAll('#scenario-toggle .vt-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.scenario === state.scenario));

    if (!state.plan) {
      host.innerHTML = `<div class="insight err" style="margin-bottom:20px;">
        <b>Plan de metas no disponible:</b> no se pudo cargar <code>data/objetivos-2026.json</code>.</div>`;
      monthTabsEl.innerHTML = '';
      monthPanelsEl.innerHTML = '';
      return;
    }
    renderPlanKpis();
    renderAnnualTable();
    renderMonthPanels();
  }

  function wireScenarioToggle() {
    const el = document.getElementById('scenario-toggle');
    if (!el || el.dataset.wired) return;
    el.dataset.wired = '1';
    el.querySelectorAll('.vt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.scenario !== state.scenario) setScenario(btn.dataset.scenario);
      });
    });
  }

  // Rango legible de meses: "Ene–Sep", "Ene" o ''.
  const monthRange = list =>
    list.length === 0 ? '' : list.length === 1
      ? monthShort(list[0])
      : `${monthShort(list[0])}–${monthShort(list[list.length - 1])}`;

  // KPIs: acumulado de meses cerrados contra la meta del mismo período, y el año completo.
  function renderPlanKpis() {
    const el = document.getElementById('plan-kpis');
    if (!el) return;
    const closed     = months.filter(m => monthStatus(m) === 'past');
    const pending    = months.length - closed.length;
    const realClosed = closed.reduce((s, m) => s + tot(state.d2026?.[m] || {}), 0);
    const metaClosed = closed.reduce((s, m) => s + monthTarget(m), 0);
    const realYear   = months.reduce((s, m) => s + tot(state.d2026?.[m] || {}), 0);
    const metaYear   = months.reduce((s, m) => s + monthTarget(m), 0);
    const pctClosed  = metaClosed > 0 ? realClosed / metaClosed * 100 : 0;
    const pctYear    = metaYear > 0 ? realYear / metaYear * 100 : 0;
    const gapClosed  = realClosed - metaClosed;
    const falta      = Math.max(0, metaYear - realYear);
    const range      = monthRange(closed);

    const closedCards = closed.length ? `
      <div class="cum-kpi-card cum-kpi-card-current">
        <div class="cum-kpi-lbl">Venta 2026 · ${range}</div>
        <div class="cum-kpi-val">S/. ${fmt(realClosed)}</div>
        <div class="cum-kpi-sub">meses cerrados · ciclo 26-25</div>
      </div>
      <div class="cum-kpi-card">
        <div class="cum-kpi-lbl">${scenarioName()} · ${range}</div>
        <div class="cum-kpi-val" style="color:${pctColor(pctClosed)};">${pctClosed.toFixed(1)}%</div>
        <div class="cum-kpi-sub">${gapClosed >= 0 ? '+' : '−'}S/. ${fmt(Math.abs(gapClosed))} vs meta S/. ${fmt(metaClosed)}</div>
      </div>` : '';

    el.innerHTML = `
      <div class="cum-kpi-strip plan-kpi-strip">
        ${closedCards}
        <div class="cum-kpi-card">
          <div class="cum-kpi-lbl">${scenarioName()} · año</div>
          <div class="cum-kpi-val">S/. ${fmt(metaYear)}</div>
          <div class="cum-kpi-sub">venta del año S/. ${fmt(realYear)} · ${pctYear.toFixed(1)}%</div>
        </div>
        <div class="cum-kpi-card">
          <div class="cum-kpi-lbl">Falta para la meta anual</div>
          <div class="cum-kpi-val" style="color:${falta > 0 ? 'var(--red-text)' : 'var(--green-text)'};">S/. ${fmt(falta)}</div>
          <div class="cum-kpi-sub">${falta > 0 && pending > 0 ? `≈ S/. ${fmt(falta / pending)} por mes en ${pending} ${pending === 1 ? 'mes' : 'meses'}` : falta > 0 ? 'año cerrado' : 'meta anual cubierta'}</div>
        </div>
      </div>`;
  }

  // Celda del cuadro anual: venta, meta y avance del mes.
  function planCell(m, real, tgt) {
    const status   = monthStatus(m);
    const hasSales = status === 'past' || (status === 'current' && isLiveMonth(m));
    const metaTxt  = tgt > 0 ? fmtK(tgt) : 'sin meta';
    const cls      = 'r pc' + (status === 'current' ? ' pc-current' : '');
    if (!hasSales) {
      return `<td class="${cls}" title="Meta S/. ${fmt(tgt)}">
        <span class="pc-real muted">—</span><span class="pc-meta">${metaTxt}</span><span class="pc-pct">&nbsp;</span></td>`;
    }
    const p = tgt > 0 ? real / tgt * 100 : null;
    return `<td class="${cls}" title="Venta S/. ${fmt(real)} · meta S/. ${fmt(tgt)}">
      <span class="pc-real">${fmtK(real)}</span>
      <span class="pc-meta">/ ${metaTxt}</span>
      <span class="pc-pct" style="color:${p === null ? 'var(--muted)' : pctColor(p)};">${p === null ? '—' : p.toFixed(0) + '%'}</span></td>`;
  }

  // Celda de acumulado o de año: suma de venta y meta sobre una lista de meses.
  function planSumCell(list, realOf, tgtOf, extraCls) {
    if (!list.length) return `<td class="r pc ${extraCls}"><span class="pc-real muted">—</span></td>`;
    const real = list.reduce((s, m) => s + realOf(m), 0);
    const tgt  = list.reduce((s, m) => s + tgtOf(m), 0);
    const p    = tgt > 0 ? real / tgt * 100 : null;
    return `<td class="r pc ${extraCls}" title="Venta S/. ${fmt(real)} · meta S/. ${fmt(tgt)}">
      <span class="pc-real">${fmtK(real)}</span>
      <span class="pc-meta">/ ${tgt > 0 ? fmtK(tgt) : 'sin meta'}</span>
      <span class="pc-pct" style="color:${p === null ? 'var(--muted)' : pctColor(p)};">${p === null ? '—' : p.toFixed(0) + '%'}</span></td>`;
  }

  function renderAnnualTable() {
    const table = document.getElementById('plan-annual');
    const sub   = document.getElementById('plan-annual-sub');
    const notes = document.getElementById('plan-notes');
    if (!table) return;

    const closed = months.filter(m => monthStatus(m) === 'past');
    const range  = monthRange(closed);
    if (sub) sub.textContent = `${scenarioName()} · venta del Sheet en ciclo comercial 26-25 · montos en miles de S/.`;

    const head = `<thead><tr>
      <th>Canal</th>
      ${months.map(m => `<th class="r plan-month${monthStatus(m) === 'current' ? ' is-current' : ''}" data-month="${m}" title="Ver ${m}">${monthShort(m)}</th>`).join('')}
      <th class="r plan-col-sum">${range ? 'Acum. ' + range : 'Acum.'}</th>
      <th class="r plan-col-sum">Año</th>
    </tr></thead>`;

    const salesOf = (m, c) => chReal(state.d2026?.[m], c);
    let body = '';
    planChannels().forEach(c => {
      const hasParts = c.sheet.length > 1;
      body += `<tr class="plan-row">
        <td>
          <span class="ch-name">
            ${hasParts ? `<button class="ch-weeks-toggle plan-parts-toggle" data-parts="${c.key}" title="Ver ${c.sheet.join(', ')}" aria-expanded="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                   style="width:12px;height:12px;pointer-events:none;display:block;"><polyline points="9 18 15 12 9 6"/></svg>
            </button>` : '<span class="plan-toggle-spacer"></span>'}
            <span class="ch-pip" style="background:${chColor(c)}"></span>${c.label}
          </span>
        </td>
        ${months.map(m => planCell(m, salesOf(m, c), target(m, c.key))).join('')}
        ${planSumCell(closed, m => salesOf(m, c), m => target(m, c.key), 'plan-col-sum')}
        ${planSumCell(months, m => salesOf(m, c), m => target(m, c.key), 'plan-col-sum')}
      </tr>`;
      if (hasParts) {
        c.sheet.forEach(col => {
          const live = m => monthStatus(m) === 'past' || (monthStatus(m) === 'current' && isLiveMonth(m));
          const sumOf = list => list.reduce((s, m) => s + ((state.d2026?.[m] || {})[col] || 0), 0);
          body += `<tr class="plan-sub" data-parts-of="${c.key}" hidden>
            <td><span class="plan-sub-name">${col}</span></td>
            ${months.map(m => `<td class="r pc">${live(m) ? fmtK((state.d2026?.[m] || {})[col] || 0) : '—'}</td>`).join('')}
            <td class="r pc plan-col-sum">${closed.length ? fmtK(sumOf(closed)) : '—'}</td>
            <td class="r pc plan-col-sum">${fmtK(sumOf(months))}</td>
          </tr>`;
        });
      }
    });

    const totalOf = m => tot(state.d2026?.[m] || {});
    body += `<tr class="plan-total">
      <td><strong>Total</strong></td>
      ${months.map(m => planCell(m, totalOf(m), monthTarget(m))).join('')}
      ${planSumCell(closed, totalOf, monthTarget, 'plan-col-sum')}
      ${planSumCell(months, totalOf, monthTarget, 'plan-col-sum')}
    </tr>`;

    table.innerHTML = head + `<tbody>${body}</tbody>`;

    table.querySelectorAll('.plan-parts-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        btn.classList.toggle('open', open);
        table.querySelectorAll(`tr[data-parts-of="${btn.dataset.parts}"]`).forEach(tr => { tr.hidden = !open; });
      });
    });
    table.querySelectorAll('th.plan-month').forEach(th => {
      th.addEventListener('click', () => {
        selectMonth(th.dataset.month);
        document.getElementById('month-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    if (notes) {
      const chNotes = planChannels().filter(c => c.nota).map(c => `<div><strong>${c.label}:</strong> ${c.nota}</div>`).join('');
      notes.innerHTML = `
        ${chNotes}
        <div>El total suma toda la venta registrada, también la de canales sin meta en ese mes.</div>
        <div>El mes en curso va en cursiva: su avance es parcial. Clic en un mes para ver su detalle.</div>`;
    }
  }

  function selectMonth(m) {
    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!monthTabsEl || !monthPanelsEl) return;
    monthTabsEl.querySelectorAll('.month-tab').forEach(t => t.classList.toggle('active', t.dataset.month === m));
    monthPanelsEl.querySelectorAll('.mpanel').forEach(p => p.classList.toggle('visible', p.id === 'mpanel-' + m));
  }

  function renderMonthPanels() {
    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!monthTabsEl || !monthPanelsEl) return;
    // Al cambiar de escenario se vuelve a dibujar todo: se conserva el mes abierto.
    const openMonth = monthTabsEl.querySelector('.month-tab.active')?.dataset.month;
    monthTabsEl.innerHTML   = '';
    monthPanelsEl.innerHTML = '';

    // Tab activo por defecto: el mes en curso. Si today está fuera de 2026,
    // el último mes con datos (o Enero como fallback).
    const curIdx = currentMonthIdx();
    let defaultIdx = (curIdx >= 0 && curIdx < months.length) ? curIdx : 0;
    if (curIdx === 12) { // año ya pasado → último con datos reales
      for (let i = months.length - 1; i >= 0; i--) {
        if (isLiveMonth(months[i])) { defaultIdx = i; break; }
      }
    }
    if (openMonth && months.includes(openMonth)) defaultIdx = months.indexOf(openMonth);

    months.forEach((m, i) => {
      const status     = monthStatus(m);
      const d2026Month = state.d2026?.[m] || {};
      const monthTotal = tot(d2026Month);
      const total2025  = monthRef2025(m);

      // Panel HTML
      const panel = document.createElement('div');
      panel.className = 'mpanel' + (i === defaultIdx ? ' visible' : '');
      panel.id = 'mpanel-' + m;

      const showReal = status === 'past' || (status === 'current' && isLiveMonth(m));

      // ── Marcador del día actual sobre la barra ──
      // Posición proporcional: día transcurrido / días del mes
      const todayPct = status === 'current'
        ? visualTodayPct(m)
        : null;
      const todayPin = todayPct !== null
        ? `<div class="pb-today-pin" style="left:${todayPct}%" title="Día calendario ${currentCalendarDay()}">
             <span class="pb-today-day">${currentCalendarDay()}</span>
             <div class="pb-today-tri"></div>
           </div>`
        : '';

      let rows = '';
      planChannels().forEach(c => {
        const real       = chReal(d2026Month, c);
        const tgt        = target(m, c.key);
        const share      = showReal && monthTotal > 0 ? (real / monthTotal * 100).toFixed(1) : '—';
        const wkDetailId = `ch-weeks-${m}-${c.key}`;
        // Canales que agrupan varias columnas del Sheet muestran el desglose bajo el nombre.
        const parts = c.sheet.length > 1 && showReal
          ? `<div class="ch-parts">${c.sheet.map(col => `${col} S/. ${fmt(d2026Month[col] || 0)}`).join(' · ')}</div>`
          : '';
        rows += `<tr class="ch-obj-row">
          <td>
            <div class="ch-cell">
              <button class="ch-weeks-toggle" data-detail="${wkDetailId}"
                      title="Ver semanas" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round"
                     style="width:12px;height:12px;pointer-events:none;display:block;">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
              <span class="ch-name"><span class="ch-pip" style="background:${chColor(c)}"></span>${c.label}</span>
            </div>
            ${parts}
          </td>
          <td class="r mono text-2">S/. ${fmt(ref2025(m, c.key))}</td>
          <td class="r mono">${showReal ? 'S/. ' + fmt(real) : '<span class="muted">—</span>'}</td>
          <td class="r">${showReal ? share + '%' : '—'}</td>
          <td class="r mono">${tgt > 0 ? 'S/. ' + fmt(tgt) : '<span class="muted">sin meta</span>'}</td>
          <td class="r" style="min-width:150px;">
            <div class="pb-wrap">
              <div class="pb-outer">
                <div class="pb-ruler">
                  <div class="pb-bg"><div class="pb-fill" id="pb-${m}-${c.key}"></div></div>
                  ${todayPin}
                </div>
                <div class="pb-day-scale"><span>${visualRulerStart(m)}</span><span>${visualRulerEnd(m)}</span></div>
              </div>
              <span class="pct-val" id="pv-${m}-${c.key}"></span>
            </div>
          </td>
          <td class="r" id="gv-${m}-${c.key}"></td>
        </tr>
        <tr class="ch-weeks-row" id="${wkDetailId}" style="display:none;">
          <td colspan="7" style="padding:0;">
            <div class="ch-weeks-inner">
              ${buildChannelWeeklyHTML(m, c, status)}
            </div>
          </td>
        </tr>`;
      });

      const statusNote = status === 'current'
        ? `<div class="period-note">${m} 2026 está en curso · ciclo comercial 26-25 · día ${daysPassed(m)} de ${objectiveDays(m)} · Referencia 2025 (plan): <strong>S/. ${fmt(total2025)}</strong></div>`
        : status === 'future'
          ? `<div class="period-note" style="background:var(--brand-soft);border-color:var(--brand);color:var(--brand-text);">${m} 2026 es mes futuro · ${scenarioName().toLowerCase()} <strong>S/. ${fmt(monthTarget(m))}</strong> · referencia 2025 (plan) S/. ${fmt(total2025)}.</div>`
          : '';

      panel.innerHTML = `
        ${statusNote}
        <div id="pace-${m}" style="margin-bottom:16px;"></div>
        <div id="alert-panel-${m}"></div>
        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title">Avance por canal</div>
              <div class="panel-sub">${m} 2026 · ${scenarioName().toLowerCase()} del plan</div>
            </div>
          </div>
          <div class="plan-table-wrap"><table class="month-table">
            <thead><tr>
              <th>Canal</th>
              <th class="r">Ref. 2025</th>
              <th class="r">Real 2026</th>
              <th class="r">Participación</th>
              <th class="r">${scenarioName()}</th>
              <th class="r" style="min-width:140px;">Avance</th>
              <th class="r">Brecha</th>
            </tr></thead>
            <tbody>${rows}
              <tr style="background:#F8FAFC;">
                <td><strong>Total</strong></td>
                <td class="r mono text-2">S/. ${fmt(total2025)}</td>
                <td class="r mono">${showReal ? 'S/. ' + fmt(monthTotal) : '<span class="muted">—</span>'}</td>
                <td class="r">${showReal ? '100%' : '—'}</td>
                <td class="r mono text-2" id="mt-${m}"></td>
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
          </table></div>
        </div>`;

      monthPanelsEl.appendChild(panel);

      planChannels().forEach(c => renderRowUI(m, c));
      refreshObjTotal(m);
      refreshPaceCards(m);
      refreshAlertPanel(m);

      // Bind botones › de cada canal (expand/collapse semanal)
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

      // Month tab button
      const tab = document.createElement('button');
      const isCurrent = status === 'current';
      const classes = ['month-tab'];
      if (i === defaultIdx) classes.push('active');
      if (isCurrent)           classes.push('active-current');
      if (status === 'future') classes.push('future');
      if (status === 'past')   classes.push('past');
      tab.className = classes.join(' ');
      tab.dataset.month = m;
      tab.textContent = m + (isCurrent ? ' ◉' : '');
      tab.addEventListener('click', () => selectMonth(m));
      monthTabsEl.appendChild(tab);
    });
  }

  global.Objectives = { render, state };
})(window);
