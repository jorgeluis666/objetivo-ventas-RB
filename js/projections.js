/* ============================================================
   projections.js — módulo Proyecciones 2026
   Expone window.Projections.render({ d2026, targets })
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const { channels, palette, months } = ds;

  const fmt    = n => Math.round(n).toLocaleString('es-PE');
  const fmtK   = n => {
    const a = Math.abs(n);
    if (a >= 1e6) return 'S/. ' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return 'S/. ' + Math.round(n / 1e3) + 'k';
    return 'S/. ' + Math.round(n);
  };

  // Nombre corto para etiquetas de eje
  const MON_SHORT = { Enero:'Ene', Febrero:'Feb', Marzo:'Mar', Abril:'Abr',
    Mayo:'May', Junio:'Jun', Julio:'Jul', Agosto:'Ago', Septiembre:'Sep',
    Octubre:'Oct', Noviembre:'Nov', Diciembre:'Dic' };

  // Tipo de campaña: etiqueta descriptiva por canal
  const CAMPAIGN_TYPE = {
    Tienda:    'Tienda Física',
    Showroom:  'Showroom',
    WhatsApp:  'Mensajería Directa',
    Web:       'E-Commerce',
    Instagram: 'Social · Instagram',
    Facebook:  'Social · Facebook',
  };

  let _chartVsObj  = null;
  let _chartAnnual = null;
  let _d2026       = null;
  let _targets     = null;
  let _activeChannel = 'Tienda';

  // ── Proyección ──────────────────────────────────────────────
  function buildProjection(d2026, targets) {
    // Determina meses con datos reales (total > 0)
    const withData = months.filter(m => {
      const mo = d2026[m];
      return mo && channels.some(c => (mo[c] || 0) > 0);
    });

    const result = {};
    channels.forEach(ch => {
      // YTD
      const ytd = withData.reduce((s, m) => s + ((d2026[m] || {})[ch] || 0), 0);
      // Tasa mensual = promedio de meses con datos
      const rate = withData.length ? ytd / withData.length : 0;
      // Meses restantes (sin datos)
      const remaining = months.filter(m => !withData.includes(m));
      const projected = ytd + rate * remaining.length;
      // Objetivo anual = suma de 12 meses
      const annualTarget = months.reduce((s, m) => s + (((targets || {})[m] || {})[ch] || 0), 0);
      const gap = projected - annualTarget;
      const pct = annualTarget > 0 ? projected / annualTarget : 0;

      result[ch] = { ytd, rate, remaining: remaining.length, projected, annualTarget, gap, pct, withData };
    });

    // Totales
    const totYtd       = channels.reduce((s, c) => s + result[c].ytd, 0);
    const totProjected = channels.reduce((s, c) => s + result[c].projected, 0);
    const totTarget    = channels.reduce((s, c) => s + result[c].annualTarget, 0);
    result._total = { ytd: totYtd, projected: totProjected, annualTarget: totTarget,
      gap: totProjected - totTarget, pct: totTarget > 0 ? totProjected / totTarget : 0,
      withData };

    return result;
  }

  // ── KPI strip ───────────────────────────────────────────────
  function renderKpis(proj) {
    const el = document.getElementById('kpi-proj');
    if (!el) return;
    const tot = proj._total;
    const gapClass = tot.gap >= 0 ? 'green' : 'red';
    const gapSign  = tot.gap >= 0 ? '+' : '';
    const pctFmt   = (tot.pct * 100).toFixed(1);
    const closedN  = tot.withData.length;

    el.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-icon blue">S/</div>
        <div class="kpi-lbl">Acumulado YTD</div>
        <div class="kpi-val blue">S/. ${fmt(tot.ytd)}</div>
        <div class="kpi-sub">${closedN} ${closedN === 1 ? 'mes' : 'meses'} con datos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple">◎</div>
        <div class="kpi-lbl">Objetivo anual</div>
        <div class="kpi-val">${fmtK(tot.annualTarget)}</div>
        <div class="kpi-sub">suma 12 meses · todos los canales</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon amber">▶</div>
        <div class="kpi-lbl">Proyección diciembre</div>
        <div class="kpi-val amber">${fmtK(tot.projected)}</div>
        <div class="kpi-sub">${pctFmt}% del objetivo anual</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon ${gapClass}">${tot.gap >= 0 ? '▲' : '▼'}</div>
        <div class="kpi-lbl">Brecha vs objetivo</div>
        <div class="kpi-val ${gapClass}">${gapSign}${fmtK(tot.gap)}</div>
        <div class="kpi-sub">${tot.gap >= 0 ? 'por encima del objetivo' : 'por debajo del objetivo'}</div>
      </div>`;
  }

  // ── Cards por canal ─────────────────────────────────────────
  function renderChannelCards(proj) {
    const grid = document.getElementById('proj-channels');
    if (!grid) return;

    grid.innerHTML = channels.map(ch => {
      const p = proj[ch];
      if (!p) return '';
      const pct = Math.min(p.pct, 1.5); // cap visual a 150%
      const barW = Math.min(p.pct * 100, 100).toFixed(1);
      const color = palette[ch] || '#64748b';
      const badgeClass = p.pct >= 1 ? 'green' : p.pct >= 0.75 ? 'amber' : 'red';
      const badgeTxt   = p.pct >= 1 ? 'En objetivo' : p.pct >= 0.75 ? 'Cerca' : 'Por debajo';
      const gapSign = p.gap >= 0 ? '+' : '';

      return `
        <div class="proj-ch-card">
          <div class="proj-ch-header">
            <span class="proj-ch-pip" style="background:${color};"></span>
            <span class="proj-ch-name">${CAMPAIGN_TYPE[ch] || ch}</span>
            <span class="proj-ch-badge ${badgeClass}">${badgeTxt}</span>
          </div>
          <div class="proj-ch-val">${fmtK(p.projected)}</div>
          <div class="proj-ch-sub">YTD: S/. ${fmt(p.ytd)} · tasa ~S/. ${fmt(p.rate)}/mes</div>
          <div class="proj-bar-track">
            <div class="proj-bar-fill" style="width:${barW}%; background:${color};"></div>
          </div>
          <div class="proj-bar-labels">
            <span>${(p.pct * 100).toFixed(0)}% del objetivo</span>
            <span class="proj-target-lbl">Obj: ${fmtK(p.annualTarget)}</span>
          </div>
          ${p.annualTarget > 0 ? `<div style="margin-top:8px;font-size:10px;color:${p.gap>=0?'var(--green-text)':'var(--red-text)'};">
            Brecha: ${gapSign}S/. ${fmt(p.gap)}
          </div>` : ''}
        </div>`;
    }).join('');
  }

  // ── Channel selector ────────────────────────────────────────
  function renderSelector() {
    const el = document.getElementById('proj-selector');
    if (!el) return;
    el.innerHTML = channels.map(ch => `
      <button class="proj-sel-btn${ch === _activeChannel ? ' active' : ''}" data-ch="${ch}">
        <span class="pip" style="background:${palette[ch]};"></span>${ch}
      </button>`).join('');
    el.querySelectorAll('.proj-sel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeChannel = btn.dataset.ch;
        el.querySelectorAll('.proj-sel-btn').forEach(b => b.classList.toggle('active', b.dataset.ch === _activeChannel));
        renderVsObjChart(_d2026, _targets);
        renderGapRow(_d2026, _targets);
      });
    });
  }

  // ── Chart: ventas vs objetivo mensual (por canal seleccionado) ──
  function renderVsObjChart(d2026, targets) {
    const canvas = document.getElementById('chart-proj-vs-obj');
    if (!canvas) return;
    const ch = _activeChannel;
    const color = palette[ch] || '#2563eb';

    const labels = months.map(m => MON_SHORT[m] || m);
    const actual  = months.map(m => ((d2026[m] || {})[ch] || 0) || null);
    const target  = months.map(m => (((targets || {})[m] || {})[ch] || 0) || null);

    if (_chartVsObj) { _chartVsObj.destroy(); _chartVsObj = null; }

    _chartVsObj = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Real',
            data: actual,
            backgroundColor: color + 'CC',
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Objetivo',
            data: target,
            type: 'line',
            borderColor: '#f59e0b',
            borderWidth: 2,
            borderDash: [4, 3],
            pointRadius: 3,
            pointBackgroundColor: '#f59e0b',
            fill: false,
            tension: 0.3,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` S/. ${fmt(ctx.raw || 0)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            ticks: {
              font: { size: 10 },
              callback: v => fmtK(v),
            },
            grid: { color: '#f1f5f9' },
          },
        },
      },
    });
  }

  // ── Gap row ─────────────────────────────────────────────────
  function renderGapRow(d2026, targets) {
    const el = document.getElementById('proj-gap-row');
    if (!el || !_d2026) return;
    const ch = _activeChannel;
    const proj = buildProjection(d2026, targets)[ch];
    if (!proj || proj.annualTarget === 0) { el.style.display = 'none'; return; }
    const gapSign = proj.gap >= 0 ? '+' : '';
    const color   = proj.gap >= 0 ? 'var(--green-text)' : 'var(--red-text)';
    el.style.display = 'flex';
    el.innerHTML = `
      <span>Canal <strong>${ch}</strong> · Proyección:</span>
      <strong>${fmtK(proj.projected)}</strong>
      <span>vs objetivo</span>
      <strong>${fmtK(proj.annualTarget)}</strong>
      <span style="margin-left:auto; color:${color}; font-weight:600;">${gapSign}S/. ${fmt(proj.gap)}</span>`;
  }

  // ── Chart: proyección anual por canal (grouped bar) ─────────
  function renderAnnualChart(proj) {
    const canvas = document.getElementById('chart-proj-annual');
    if (!canvas) return;
    if (_chartAnnual) { _chartAnnual.destroy(); _chartAnnual = null; }

    const labels = channels;
    const ytd       = channels.map(ch => proj[ch]?.ytd || 0);
    const estimated = channels.map(ch => Math.max(0, (proj[ch]?.projected || 0) - (proj[ch]?.ytd || 0)));
    const target    = channels.map(ch => proj[ch]?.annualTarget || 0);

    _chartAnnual = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'YTD real',
            data: ytd,
            backgroundColor: channels.map(ch => (palette[ch] || '#64748b') + 'DD'),
            borderRadius: 4,
            stack: 'proj',
            order: 2,
          },
          {
            label: 'Estimado restante',
            data: estimated,
            backgroundColor: channels.map(ch => (palette[ch] || '#64748b') + '44'),
            borderRadius: 4,
            stack: 'proj',
            order: 2,
            borderColor: channels.map(ch => palette[ch] || '#64748b'),
            borderWidth: 1,
            borderDash: [4, 3],
          },
          {
            label: 'Objetivo anual',
            data: target,
            type: 'line',
            borderColor: '#f59e0b',
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: '#f59e0b',
            fill: false,
            tension: 0,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: S/. ${fmt(ctx.raw || 0)}`,
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            stacked: true,
            ticks: { font: { size: 10 }, callback: v => fmtK(v) },
            grid: { color: '#f1f5f9' },
          },
        },
      },
    });
  }

  // ── Render público ───────────────────────────────────────────
  function render({ d2026, targets }) {
    _d2026   = d2026;
    _targets = targets;

    const proj = buildProjection(d2026, targets);
    renderKpis(proj);
    renderChannelCards(proj);
    renderSelector();
    renderVsObjChart(d2026, targets);
    renderGapRow(d2026, targets);
    renderAnnualChart(proj);
  }

  global.Projections = { render };

})(window);
