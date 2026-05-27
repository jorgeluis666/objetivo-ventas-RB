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
          <div class="pace-card dark">
            <div class="pace-lbl">Días del mes</div>
            <div class="pace-val">${monthDays[m]}</div>
            <div class="pace-sub">mes futuro</div>
          </div>
          <div class="pace-card brand-border">
            <div class="pace-lbl">Meta propuesta</div>
            <div class="pace-val brand">S/. ${fmt(tt)}</div>
            <div class="pace-sub">editable debajo</div>
          </div>
          <div class="pace-card amber-border">
            <div class="pace-lbl">Venta diaria necesaria</div>
            <div class="pace-val">S/. ${fmt(tt / monthDays[m])}</div>
            <div class="pace-sub">para alcanzar la meta</div>
          </div>
          <div class="pace-card">
            <div class="pace-lbl">Ref. ${m} 2025</div>
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

      el.innerHTML = `
        <div class="pace-grid">
          <div class="pace-card dark">
            <div class="pace-lbl">Días restantes</div>
            <div class="pace-val">${remDays}</div>
            <div class="pace-sub">de ${monthDays[m]} en ${m.toLowerCase()}</div>
          </div>
          <div class="pace-card ${faltante > 0 ? 'red-border' : 'green-border'}">
            <div class="pace-lbl">Faltante para meta</div>
            <div class="pace-val ${faltante > 0 ? 'red' : 'green'}">S/. ${fmt(faltante)}</div>
            <div class="pace-sub">Meta total: S/. ${fmt(tt)}</div>
          </div>
          <div class="pace-card amber-border">
            <div class="pace-lbl">Venta diaria necesaria</div>
            <div class="pace-val">S/. ${fmt(dailyNeed)}</div>
            <div class="pace-sub">para los ${remDays} días restantes</div>
          </div>
          <div class="pace-card brand-border">
            <div class="pace-lbl">Transacciones necesarias</div>
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
      el.innerHTML = `
        <div class="pace-grid">
          <div class="pace-card ${closeColor}-border">
            <div class="pace-lbl">Cierre del mes</div>
            <div class="pace-val ${closeColor}">${pctMet.toFixed(1)}%</div>
            <div class="pace-sub">${real >= tt ? '✓ Objetivo alcanzado' : 'de la meta'}</div>
          </div>
          <div class="pace-card ${real >= tt ? 'green-border' : 'red-border'}">
            <div class="pace-lbl">${real >= tt ? 'Excedente' : 'Brecha final'}</div>
            <div class="pace-val ${real >= tt ? 'green' : 'red'}">${real >= tt ? '+' : ''}S/. ${fmt(real - tt)}</div>
            <div class="pace-sub">vs meta S/. ${fmt(tt)}</div>
          </div>
          <div class="pace-card">
            <div class="pace-lbl">Venta diaria real</div>
            <div class="pace-val">S/. ${fmt(dailyReal)}</div>
            <div class="pace-sub">promedio sobre ${passed} días</div>
          </div>
          <div class="pace-card brand-border">
            <div class="pace-lbl">Transacciones totales</div>
            <div class="pace-val brand">${totalTx}</div>
            <div class="pace-sub">ticket promedio S/. ${state.avgTickets[m]?.TOTAL || 0}</div>
          </div>
        </div>`;
    }
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
      global.Charts.combinedWeeklyChart(state.weekly2025, state.weeklyData);
    }

    // ── Toggle Semanal / Mensual ──
    const toggleEl = document.getElementById('weekly-view-toggle');
    const titleEl  = document.getElementById('combined-chart-title');
    if (toggleEl) {
      // Siempre resetear a Semanal cuando se cargan datos frescos
      toggleEl.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
      const weeklyBtn = toggleEl.querySelector('[data-mode="weekly"]');
      if (weeklyBtn) weeklyBtn.classList.add('active');
      if (titleEl) titleEl.textContent = 'Evolución semanal · 2025 vs 2026';

      if (!toggleEl.dataset.wired) {
        toggleEl.dataset.wired = '1';
        const ALL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const MONTH_SHORT = { Enero:'Ene', Febrero:'Feb', Marzo:'Mar', Abril:'Abr', Mayo:'May', Junio:'Jun', Julio:'Jul', Agosto:'Ago', Septiembre:'Sep', Octubre:'Oct', Noviembre:'Nov', Diciembre:'Dic' };

        toggleEl.querySelectorAll('.vt-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            toggleEl.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const chart = global.Charts?.getInstance('chart-weekly-combined');
            if (!chart) return;

            if (btn.dataset.mode === 'monthly') {
              if (titleEl) titleEl.textContent = 'Evolución mensual · 2025 vs 2026';
              chart.data.labels = ALL_MONTHS.map(m => MONTH_SHORT[m]);
              chart.data.datasets[0].data = ALL_MONTHS.map(m => Math.round(tot(d2025[m] || {})));
              chart.data.datasets[1].data = ALL_MONTHS.map(m => {
                const v = tot(state.d2026?.[m] || {});
                return v > 0 ? Math.round(v) : null;
              });
              chart.update();
            } else {
              if (titleEl) titleEl.textContent = 'Evolución semanal · 2025 vs 2026';
              global.Charts.combinedWeeklyChart(state.weekly2025, state.weeklyData);
            }
          });
        });
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

      let rows = '';
      channels.forEach(ch => {
        const real  = d2026Month[ch] || 0;
        const ref25 = (d2025[m] || {})[ch] || 0;
        const share = showReal && monthTotal > 0 ? (real / monthTotal * 100).toFixed(1) : '—';
        rows += `<tr>
          <td><span class="ch-name"><span class="ch-pip" style="background:${palette[ch]}"></span>${ch}</span></td>
          <td class="r mono text-2">S/. ${fmt(ref25)}</td>
          <td class="r mono">${showReal ? 'S/. ' + fmt(real) : '<span class="muted">—</span>'}</td>
          <td class="r">${showReal ? share + '%' : '—'}</td>
          <td class="r"><div class="stepper">
            <button class="step-btn" data-step="-${STEP}" data-month="${m}" data-ch="${ch}">−</button>
            <input class="obj-input" type="number" id="inp-${m}-${ch}" value="${state.targets[m][ch]}" min="0" step="${STEP}">
            <button class="step-btn" data-step="${STEP}" data-month="${m}" data-ch="${ch}">+</button>
          </div></td>
          <td class="r" style="min-width:140px;"><div class="pb-wrap"><div class="pb-bg"><div class="pb-fill" id="pb-${m}-${ch}"></div></div><span class="pct-val" id="pv-${m}-${ch}"></span></div></td>
          <td class="r" id="gv-${m}-${ch}"></td>
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
                <td class="r" style="min-width:140px;"><div class="pb-wrap"><div class="pb-bg"><div class="pb-fill" id="pb-tot-${m}"></div></div><span class="pct-val" id="pv-tot-${m}"></span></div></td>
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

      // Month tab button
      const tab = document.createElement('button');
      const isCurrent = status === 'current';
      const classes = ['month-tab'];
      if (i === defaultIdx) classes.push('active');
      if (isCurrent)        classes.push('active-current');
      if (status === 'future') classes.push('future');
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

  global.Objectives = { render, state };
})(window);
