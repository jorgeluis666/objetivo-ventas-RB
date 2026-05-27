/* ============================================================
   objectives.js — vista de Objetivos 2026.
   Renderiza month-tabs, pace cards, weekly charts y tabla editable.
   Expone window.Objectives.render({ d2026, weeklyData, transactions }).
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const {
    channels, palette, d2025, defaultTargets, monthDays, months, STEP, chToUpper,
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

  // Estado interno
  const state = {
    targets: JSON.parse(JSON.stringify(defaultTargets)),
    d2026: null,
    weeklyData: null,
    transactions: null,
    avgTickets: {},
  };

  // ── localStorage — clave de almacenamiento ──
  const LS_KEY = 'lr_objetivos_2026';

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !saved.targets) return false;
      months.forEach(m => {
        if (saved.targets[m]) {
          channels.forEach(ch => {
            if (typeof saved.targets[m][ch] === 'number') {
              state.targets[m][ch] = saved.targets[m][ch];
            }
          });
        }
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version : '1',
        updated : new Date().toISOString().slice(0, 10),
        targets : state.targets,
      }));
      _updateStorageLabel();
    } catch (e) { /* ignore */ }
  }

  function _updateStorageLabel() {
    const el = document.getElementById('obj-guardado-label');
    if (!el) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        el.textContent = `Objetivos guardados en navegador · ${saved.updated || ''}`;
      } else {
        el.textContent = 'Objetivos por defecto (sin cambios guardados)';
      }
    } catch (e) { el.textContent = ''; }
  }

  function exportarObjetivos() {
    const payload = {
      version  : '1',
      anio     : YEAR,
      updated  : new Date().toISOString().slice(0, 10),
      nota     : 'Este archivo es la fuente de verdad para el sistema de alertas. El browser lo actualiza via "Exportar objetivos" y se commitea al repo.',
      targets  : state.targets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'objetivos-2026.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function restablecerObjetivos() {
    if (!confirm('¿Restaurar todos los objetivos a los valores originales?\nSe perderán los cambios guardados en este navegador.')) return;
    state.targets = JSON.parse(JSON.stringify(defaultTargets));
    localStorage.removeItem(LS_KEY);
    // Actualizar todos los inputs y la UI
    months.forEach(m => {
      channels.forEach(ch => {
        const inp = document.getElementById(`inp-${m}-${ch}`);
        if (inp) inp.value = state.targets[m][ch];
        renderRowUI(m, ch);
      });
      refreshObjTotal(m);
      refreshPaceCards(m);
    });
    _updateStorageLabel();
  }

  // Carga inicial desde localStorage (una vez al cargar el módulo)
  loadFromStorage();

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
  function monthStatus(m) {
    const idx = months.indexOf(m);
    const cur = currentMonthIdx();
    if (idx < cur)  return 'past';
    if (idx > cur)  return 'future';
    return 'current';
  }
  function daysPassed(m) {
    const s = monthStatus(m);
    if (s === 'past')    return monthDays[m];
    if (s === 'future')  return 0;
    return new Date().getDate();
  }
  function daysRemaining(m) {
    const s = monthStatus(m);
    if (s === 'past')    return 0;
    if (s === 'future')  return monthDays[m];
    return Math.max(0, monthDays[m] - new Date().getDate());
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

  // ── Actualizar DOM de una fila (barra + % + brecha) sin cascada ──
  // Usa state.targets[m][ch] directamente. Llamar desde el render inicial
  // para evitar N×refreshObjTotal + N×refreshPaceCards por mes.
  function renderRowUI(m, ch) {
    const real   = state.d2026?.[m]?.[ch] || 0;
    const tgt    = state.targets[m][ch] || 0;
    const p      = tgt > 0 ? real / tgt * 100 : 0;
    const status = monthStatus(m);

    const pb = document.getElementById(`pb-${m}-${ch}`);
    const pv = document.getElementById(`pv-${m}-${ch}`);
    const gv = document.getElementById(`gv-${m}-${ch}`);
    if (!pb || !pv || !gv) return;

    if (status === 'future' || (status === 'current' && !isLiveMonth(m))) {
      pb.style.width = '0%'; pv.textContent = '—'; pv.style.color = 'var(--muted)';
      gv.textContent = status === 'future' ? 'futuro' : '—';
      gv.className = 'gap-val'; gv.style.color = 'var(--muted)';
    } else {
      pb.style.width = Math.min(p, 100).toFixed(1) + '%';
      pb.style.background = pctFill(p);
      pv.textContent = p.toFixed(0) + '%';
      pv.style.color = pctColor(p);
      const gap = real - tgt;
      gv.textContent = (gap >= 0 ? '+' : '') + 'S/. ' + fmt(gap);
      gv.className = 'gap-val ' + (gap >= 0 ? 'g-pos' : 'g-neg');
    }
  }

  // Versión interactiva: lee el input, actualiza state y dispara cascada completa.
  // Usada por los event listeners de stepper e input.
  function refreshObjRow(m, ch) {
    state.targets[m][ch] = parseFloat(document.getElementById(`inp-${m}-${ch}`).value) || 0;
    renderRowUI(m, ch);
    refreshObjTotal(m);
    refreshPaceCards(m);
    rebuildChannelWeeklyDetail(m, ch);
    refreshAlertPanel(m);
    saveToStorage();
  }

  function refreshObjTotal(m) {
    const d2026Month = state.d2026?.[m] || {};
    const tr = channels.reduce((s, ch) => s + (d2026Month[ch] || 0), 0);
    const tt = channels.reduce((s, ch) => s + (state.targets[m][ch] || 0), 0);
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
      pb.style.width = Math.min(p, 100).toFixed(1) + '%';
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
    const tt        = channels.reduce((s, ch) => s + (state.targets[m][ch] || 0), 0);
    const real      = channels.reduce((s, ch) => s + (d2026Month[ch] || 0), 0);
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
            <div class="pace-val">${monthDays[m]}</div>
            <div class="pace-sub">mes futuro</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Meta propuesta</div>
              <span class="pace-badge muted">editable</span>
            </div>
            <div class="pace-val brand">S/. ${fmt(tt)}</div>
            <div class="pace-sub">ajustable abajo</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Venta diaria necesaria</div>
              <span class="pace-badge muted">proyección</span>
            </div>
            <div class="pace-val">S/. ${fmt(tt / monthDays[m])}</div>
            <div class="pace-sub">para alcanzar la meta</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Ref. ${m} 2025</div>
              <span class="pace-badge muted">referencia</span>
            </div>
            <div class="pace-val">S/. ${fmt(tot(d2025[m] || {}))}</div>
            <div class="pace-sub">cierre año anterior</div>
          </div>
        </div>`;
      return;
    }

    if (status === 'current') {
      // Referencia: mes cerrado anterior (si hay). Si no, usa marzo de respaldo.
      const curIdx = months.indexOf(m);
      const refMonth = curIdx > 0 ? months[curIdx - 1] : 'Marzo';
      const refTxns = Math.round(Object.values(state.transactions?.[refMonth] || {}).reduce((a, b) => a + b, 0) / (monthDays[refMonth] || 30));
      const refTk   = state.avgTickets?.[refMonth]?.TOTAL || 0;

      const pctPassed = Math.round(passed / monthDays[m] * 100);
      const pctMissing = faltante > 0 ? Math.round(faltante / tt * 100) : 0;
      el.innerHTML = `
        <div class="pace-grid">
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Días restantes</div>
              <span class="pace-badge muted">${pctPassed}% del mes</span>
            </div>
            <div class="pace-val">${remDays}</div>
            <div class="pace-sub">de ${monthDays[m]} en ${m.toLowerCase()}</div>
          </div>
          <div class="pace-card">
            <div class="pace-card-head">
              <div class="pace-lbl">Faltante para meta</div>
              <span class="pace-badge ${faltante > 0 ? 'red' : 'green'}">${faltante > 0 ? '▼ ' + pctMissing + '%' : '✓ cubierto'}</span>
            </div>
            <div class="pace-val ${faltante > 0 ? 'red' : 'green'}">S/. ${fmt(faltante)}</div>
            <div class="pace-sub">Meta total: S/. ${fmt(tt)}</div>
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
    const end   = Math.min(w * 7, monthDays[m]);
    return `${start}–${end} ${MONTH_ABR[m]}`;
  }

  // Construye el HTML interno del desplegable semanal de un canal concreto.
  // Incluye meta efectiva con arrastre de brecha semana a semana.
  function buildChannelWeeklyHTML(m, ch, status) {
    const weeks = state.weeklyData?.[m];
    if (!weeks || !weeks.length) {
      return '<div style="padding:8px 4px;font-size:12px;color:var(--muted);">Sin datos semanales para este canal.</div>';
    }
    const chKey       = chToUpper[ch];
    const monthChTgt  = state.targets[m][ch] || 0;
    const baseWeekTgt = monthChTgt > 0 ? monthChTgt * 7 / monthDays[m] : 0;
    const curWeekNum  = status === 'current' ? Math.ceil(new Date().getDate() / 7) : -1;

    let carry = 0;   // brecha arrastrada de semanas anteriores

    const weekRows = weeks.map((wk, i) => {
      const weekNum       = wk.w;
      const real          = wk[chKey] || 0;
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
      <div class="ch-weeks-header">${ch} · ${m} · ${metaHdr}</div>
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
    const totalDays  = monthDays[m];

    // Estadísticas por canal
    const stats = channels.map(ch => {
      const real = d2026Month[ch] || 0;
      const tgt  = state.targets[m][ch] || 0;
      const pct  = tgt > 0 ? real / tgt * 100 : 0;
      const expectedReal = tgt > 0 ? tgt * passed / totalDays : 0;
      return { ch, real, tgt, pct, expectedReal, surplus: real - tgt, gap: tgt - real };
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
                  `<span class="ch-pip" style="background:${palette[a.ch]};display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:3px;"></span>
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
                <span class="ch-pip" style="background:${palette[b.ch]};display:inline-block;width:7px;height:7px;border-radius:2px;flex-shrink:0;"></span>
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

  // Actualiza solo el contenido del desplegable cuando cambia el objetivo de un canal.
  function rebuildChannelWeeklyDetail(m, ch) {
    const detailRow = document.getElementById(`ch-weeks-${m}-${ch}`);
    if (!detailRow) return;
    const inner = detailRow.querySelector('.ch-weeks-inner');
    if (inner) inner.innerHTML = buildChannelWeeklyHTML(m, ch, monthStatus(m));
  }

  function refreshWeeklyAlert(m) {
    const el = document.getElementById(`weekly-alert-${m}`);
    if (!el) return;

    const status = monthStatus(m);
    if (status === 'future' || !isLiveMonth(m)) { el.innerHTML = ''; return; }

    const weeks = state.weeklyData?.[m];
    if (!weeks || !weeks.length) { el.innerHTML = ''; return; }

    const monthTarget = channels.reduce((s, ch) => s + (state.targets[m][ch] || 0), 0);
    if (monthTarget === 0) { el.innerHTML = ''; return; }

    // Meta semanal prorrateada: objetivo mensual × 7 / días del mes
    const weekTarget = monthTarget * 7 / monthDays[m];

    // Semana actual dentro del mes (1-based): ceil(día/7)
    const curWeekNum = status === 'current' ? Math.ceil(new Date().getDate() / 7) : -1;

    const rows = weeks.map((wk, i) => {
      const weekNum = wk.w;  // número de semana dentro del mes (1, 2, 3…)
      const real    = (wk.TOTAL != null && wk.TOTAL > 0)
                        ? wk.TOTAL
                        : channels.reduce((s, ch) => s + (wk[chToUpper[ch]] || 0), 0);

      const isCurrentWeek = status === 'current' && weekNum === curWeekNum;
      const isFuture      = status === 'current' && weekNum > curWeekNum;
      const pct           = weekTarget > 0 ? real / weekTarget * 100 : 0;
      const gap           = real - weekTarget;
      const detailId      = `wa-d-${m.replace(/\s/g,'')}-${weekNum}`;

      let cls, badge;
      if (isFuture)          { cls = 'muted';  badge = 'próxima'; }
      else if (isCurrentWeek){ cls = 'brand';  badge = '→ en curso'; }
      else if (pct >= 90)    { cls = 'green';  badge = '✓ en track'; }
      else if (pct >= 70)    { cls = 'amber';  badge = '⚠ atención'; }
      else                   { cls = 'red';    badge = '▼ brecha'; }

      const barColor  = { muted:'#e2e8f0', brand:'var(--brand)',
                          green:'var(--green)', amber:'var(--amber)', red:'var(--red)' }[cls];
      const textColor = { muted:'var(--muted)', brand:'var(--brand-text)',
                          green:'var(--green-text)', amber:'var(--amber-text)', red:'var(--red-text)' }[cls];

      const barW     = isFuture ? 0 : Math.min(pct, 100).toFixed(0);
      const gapLabel = (isFuture || isCurrentWeek) ? '' : (gap >= 0 ? '+' : '') + 'S/. ' + fmt(gap);
      const dateRange = weekDateRange(m, weekNum);

      // ── Detalle por canal (visible al expandir) ──
      const chRows = channels
        .filter(ch => (state.targets[m][ch] || 0) > 0 || (wk[chToUpper[ch]] || 0) > 0)
        .map(ch => {
          const chReal   = wk[chToUpper[ch]] || 0;
          const chTarget = (state.targets[m][ch] || 0) * 7 / monthDays[m];
          const chPct    = chTarget > 0 ? chReal / chTarget * 100 : 0;
          const chColor  = chPct >= 90 ? 'var(--green)' : chPct >= 70 ? 'var(--amber)' : (chReal > 0 ? 'var(--red)' : '#e2e8f0');
          return `
            <div class="wa-ch-row">
              <span class="ch-pip" style="background:${palette[ch]};width:8px;height:8px;border-radius:2px;flex-shrink:0;display:inline-block;"></span>
              <span class="wa-ch-name">${ch}</span>
              <div class="wa-ch-track">
                <div class="wa-ch-fill" style="width:${isFuture ? 0 : Math.min(chPct,100).toFixed(0)}%;background:${chColor};"></div>
              </div>
              <span class="wa-ch-amt">S/. ${fmt(chReal)}</span>
              <span class="wa-ch-pct" style="color:${chColor};">${chTarget > 0 ? chPct.toFixed(0) + '%' : '—'}</span>
              <span class="wa-ch-tgt" style="color:var(--muted);">/ S/. ${fmt(chTarget)}</span>
            </div>`;
        }).join('');

      return `
        <div class="wa-row${isCurrentWeek ? ' wa-row-current' : ''}${isFuture ? ' wa-row-future' : ''}"
             data-detail="${detailId}" role="button" tabindex="0" aria-expanded="false">
          <div class="wa-lbl">
            <span class="wa-sem">Sem. ${i + 1}</span>
            <span class="wa-wnum">${dateRange}</span>
          </div>
          <div class="wa-track">
            <div class="wa-fill" style="width:${barW}%;background:${barColor};"></div>
          </div>
          <div class="wa-amount">${isFuture ? '<span class="muted">—</span>' : 'S/. ' + fmt(real)}</div>
          <div class="wa-pct" style="color:${textColor};">
            ${isFuture ? '—' : (isCurrentWeek ? 'parcial' : pct.toFixed(0) + '%')}
          </div>
          <div class="wa-gap">${gapLabel ? `<span style="color:${textColor};font-size:11px;">${gapLabel}</span>` : ''}</div>
          <span class="pace-badge ${cls}">${badge}</span>
          <span class="wa-chevron${isFuture ? ' wa-chevron-hide' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </span>
        </div>
        <div class="wa-detail" id="${detailId}">
          <div class="wa-detail-inner">
            <div class="wa-ch-head">
              <span></span><span>Canal</span><span></span>
              <span class="r">Real sem.</span><span class="r">%</span>
              <span class="r">Meta sem.</span>
            </div>
            ${chRows}
            <div class="wa-detail-footer">
              Total semana: <strong>S/. ${fmt(real)}</strong> &nbsp;·&nbsp;
              Meta: <strong>S/. ${fmt(weekTarget)}</strong>
              ${!isFuture && !isCurrentWeek ? ` &nbsp;·&nbsp; <strong style="color:${textColor};">${pct.toFixed(1)}% alcanzado</strong>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="panel wa-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Alerta semanal
              <span style="font-weight:400;color:var(--muted);font-size:12px;">· ${m} ${YEAR}</span>
            </div>
            <div class="panel-sub">
              Meta semanal ≈ S/. ${fmt(weekTarget)} &nbsp;·&nbsp;
              objetivo mensual S/. ${fmt(monthTarget)} / ${monthDays[m]} días &nbsp;·&nbsp;
              <em>Clic en una semana para ver el detalle por canal</em>
            </div>
          </div>
        </div>
        <div class="wa-rows">${rows}</div>
      </div>`;

    // ── Event listeners de expand/collapse ──
    el.querySelectorAll('.wa-row[data-detail]').forEach(row => {
      if (row.classList.contains('wa-row-future')) return; // no expandir futuras
      row.addEventListener('click', () => {
        const detail   = document.getElementById(row.dataset.detail);
        const chevron  = row.querySelector('.wa-chevron');
        if (!detail) return;
        const isOpen = detail.classList.contains('wa-detail-open');
        detail.classList.toggle('wa-detail-open', !isOpen);
        chevron?.classList.toggle('wa-chevron-open', !isOpen);
        row.setAttribute('aria-expanded', String(!isOpen));
      });
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });
    });
  }

  // ── Render principal de la vista ──
  function render({ d2026, weeklyData, transactions, weekly2025 }) {
    state.d2026        = d2026;
    state.weeklyData   = weeklyData;
    state.transactions = transactions;
    state.weekly2025   = weekly2025 || {};
    state.avgTickets   = computeAvgTickets(d2026, transactions);

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

              const mData25 = ALL_MONTHS.map(m => Math.round(getChVal(d2025[m], selCh)));
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
                cum25 += Math.round(getChVal(d2025[m], selCh));
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

    const monthTabsEl   = document.getElementById('month-tabs');
    const monthPanelsEl = document.getElementById('month-panels');
    if (!monthTabsEl || !monthPanelsEl) return;
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

    months.forEach((m, i) => {
      const status     = monthStatus(m);
      const d2026Month = d2026[m] || {};
      const monthTotal = channels.reduce((s, ch) => s + (d2026Month[ch] || 0), 0);
      const total2025  = tot(d2025[m] || {});

      // Panel HTML
      const panel = document.createElement('div');
      panel.className = 'mpanel' + (i === defaultIdx ? ' visible' : '');
      panel.id = 'mpanel-' + m;

      const showReal = status === 'past' || (status === 'current' && isLiveMonth(m));

      // ── Marcador del día actual sobre la barra ──
      // Posición proporcional: día transcurrido / días del mes
      const todayPct = status === 'current'
        ? (daysPassed(m) / monthDays[m] * 100).toFixed(1)
        : null;
      const todayPin = todayPct !== null
        ? `<div class="pb-today-pin" style="left:${todayPct}%">
             <span class="pb-today-day">${daysPassed(m)}</span>
             <div class="pb-today-tri"></div>
           </div>`
        : '';

      let rows = '';
      channels.forEach(ch => {
        const real       = d2026Month[ch] || 0;
        const ref25      = (d2025[m] || {})[ch] || 0;
        const share      = showReal && monthTotal > 0 ? (real / monthTotal * 100).toFixed(1) : '—';
        const wkDetailId = `ch-weeks-${m}-${ch}`;
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
              <span class="ch-name"><span class="ch-pip" style="background:${palette[ch]}"></span>${ch}</span>
            </div>
          </td>
          <td class="r mono text-2">S/. ${fmt(ref25)}</td>
          <td class="r mono">${showReal ? 'S/. ' + fmt(real) : '<span class="muted">—</span>'}</td>
          <td class="r">${showReal ? share + '%' : '—'}</td>
          <td class="r"><div class="stepper">
            <button class="step-btn" data-step="-${STEP}" data-month="${m}" data-ch="${ch}">−</button>
            <input class="obj-input" type="number" id="inp-${m}-${ch}" value="${state.targets[m][ch]}" min="0" step="${STEP}">
            <button class="step-btn" data-step="${STEP}" data-month="${m}" data-ch="${ch}">+</button>
          </div></td>
          <td class="r" style="min-width:150px;">
            <div class="pb-wrap">
              <div class="pb-outer">
                <div class="pb-ruler">
                  <div class="pb-bg"><div class="pb-fill" id="pb-${m}-${ch}"></div></div>
                  ${todayPin}
                </div>
                <div class="pb-day-scale"><span>1</span><span>${monthDays[m]}</span></div>
              </div>
              <span class="pct-val" id="pv-${m}-${ch}"></span>
            </div>
          </td>
          <td class="r" id="gv-${m}-${ch}"></td>
        </tr>
        <tr class="ch-weeks-row" id="${wkDetailId}" style="display:none;">
          <td colspan="7" style="padding:0;">
            <div class="ch-weeks-inner">
              ${buildChannelWeeklyHTML(m, ch, status)}
            </div>
          </td>
        </tr>`;
      });

      const statusNote = status === 'current'
        ? `<div class="period-note">${m} 2026 está en curso · ${daysPassed(m)} días transcurridos · Referencia 2025: <strong>S/. ${fmt(total2025)}</strong></div>`
        : status === 'future'
          ? `<div class="period-note" style="background:var(--brand-soft);border-color:var(--brand);color:var(--brand-text);">${m} 2026 es mes futuro · Referencia 2025: <strong>S/. ${fmt(total2025)}</strong> · los objetivos se pueden planificar desde ya.</div>`
          : '';

      panel.innerHTML = `
        ${statusNote}
        <div id="pace-${m}" style="margin-bottom:16px;"></div>
        <div id="alert-panel-${m}"></div>
        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title">Avance por canal</div>
              <div class="panel-sub">${m} 2026 · ajustable</div>
            </div>
          </div>
          <table>
            <thead><tr>
              <th>Canal</th>
              <th class="r">Ref. 2025</th>
              <th class="r">Real 2026</th>
              <th class="r">% mes</th>
              <th class="r">Objetivo S/.</th>
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
                      <div class="pb-day-scale"><span>1</span><span>${monthDays[m]}</span></div>
                    </div>
                    <span class="pct-val" id="pv-tot-${m}"></span>
                  </div>
                </td>
                <td class="r" id="gv-tot-${m}"></td>
              </tr>
            </tbody>
          </table>
        </div>`;

      monthPanelsEl.appendChild(panel);

      // Bind stepper + input
      panel.querySelectorAll('.step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const m2 = btn.dataset.month, ch = btn.dataset.ch, step = parseFloat(btn.dataset.step);
          const inp = document.getElementById(`inp-${m2}-${ch}`);
          const cur = parseFloat(inp.value || 0);
          inp.value = Math.max(0, Math.round((cur + step) / STEP) * STEP);
          refreshObjRow(m2, ch);
        });
      });
      channels.forEach(ch => {
        document.getElementById(`inp-${m}-${ch}`).addEventListener('input', () => refreshObjRow(m, ch));
        renderRowUI(m, ch);
      });
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
      tab.textContent = m + (isCurrent ? ' ◉' : '');
      tab.addEventListener('click', () => {
        monthTabsEl.querySelectorAll('.month-tab').forEach(t => t.classList.remove('active'));
        monthPanelsEl.querySelectorAll('.mpanel').forEach(p => p.classList.remove('visible'));
        tab.classList.add('active');
        panel.classList.add('visible');
      });
      monthTabsEl.appendChild(tab);
    });
  }

  // ── Toolbar de objetivos: exportar y restablecer ──
  // Ejecutar una vez tras el primer render (los botones ya deben existir en el DOM).
  function wireObjToolbar() {
    const btnExp = document.getElementById('btn-exportar-obj');
    const btnRst = document.getElementById('btn-restablecer-obj');
    if (btnExp && !btnExp.dataset.wired) {
      btnExp.dataset.wired = '1';
      btnExp.addEventListener('click', exportarObjetivos);
    }
    if (btnRst && !btnRst.dataset.wired) {
      btnRst.dataset.wired = '1';
      btnRst.addEventListener('click', restablecerObjetivos);
    }
    _updateStorageLabel();
  }

  global.Objectives = { render, state, exportarObjetivos, restablecerObjetivos, wireObjToolbar };
})(window);
