/* ============================================================
   main.js — entry point. Orquesta: carga de datos, navegación
   sidebar, render de vistas, wire del indicador de sync.
   ============================================================ */

(function () {
  const ds = window.DataStatic;
  const { channels, palette, d2025, months, monthsWith2026Data } = ds;

  const VIEW_TITLES = {
    'view-yoy':  'Comparativo interanual',
    'view-prod': 'Productos Web · 2026',
    'view-dist': 'Distribución por canal',
    'view-obj':  'Objetivos 2026',
  };

  // Charts que hay que re-animar al mostrar cada vista.
  // "*" al final = match por prefijo (weekly charts: week-chart-Enero, week-chart-Febrero…)
  const VIEW_CHARTS = {
    'view-yoy':  ['chart-evo'],
    'view-prod': ['chart-top-units', 'chart-top-rev', 'chart-types', 'chart-ticket'],
    'view-dist': ['chart-dist-2025', 'chart-dist-2026', 'chart-abs'],
    'view-obj':  ['chart-weekly-combined'],
  };

  const state = {
    d2026: null,
    weeklyData: null,
    transactions: null,
    weekly2025: null,
    generated: null,
    renderedProducts: false,
  };

  // ── Navegación ──
  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('visible'));
    document.querySelectorAll('.s-item').forEach(n => n.classList.remove('active'));
    const view = document.getElementById(id);
    const btn  = document.querySelector(`.s-item[data-view="${id}"]`);
    if (view) view.classList.add('visible');
    if (btn)  btn.classList.add('active');
    const title = document.getElementById('topbar-title');
    if (title) title.textContent = VIEW_TITLES[id] || '';
    history.replaceState(null, '', '#' + id);

    // Render perezoso de productos para no bloquear primera pantalla
    if (id === 'view-prod' && !state.renderedProducts) {
      renderProducts();
      state.renderedProducts = true;
    }

    // Replay de la animación de entrada en los charts de la vista
    // (si estaban ocultos cuando se animaron la primera vez, no se vieron).
    const charts = VIEW_CHARTS[id];
    if (charts && window.Charts?.replay) {
      // Siguiente frame: asegurar que el layout ya es visible antes de medir
      requestAnimationFrame(() => window.Charts.replay(charts));
    }
  }

  function wireNav() {
    document.querySelectorAll('.s-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });
  }

  // ── YoY ──
  const tot = o => channels.reduce((s, c) => s + (o[c] || 0), 0);
  const fmt = n => Math.round(n).toLocaleString('es-PE');

  // Meses 2026 con al menos un canal > 0. Si no hay ninguno, fallback al
  // hardcoded para que el dashboard no quede vacío en estado inicial.
  function activeMonths2026(d2026) {
    if (!d2026) return monthsWith2026Data;
    const live = months.filter(m => d2026[m] && Object.values(d2026[m]).some(v => v > 0));
    return live.length ? live : monthsWith2026Data;
  }

  function renderKpisYoY(d2026) {
    const el = document.getElementById('kpi-yoy');
    if (!el) return;
    el.innerHTML = '';
    // KPIs solo para meses con datos 2026 reales (filtrado dinámico)
    activeMonths2026(d2026).forEach(m => {
      const t25 = tot(d2025[m]);
      const t26 = tot(d2026[m]);
      if (t26 === 0) {
        el.insertAdjacentHTML('beforeend', `
          <div class="kpi-card">
            <div class="kpi-icon amber">⏳</div>
            <div class="kpi-lbl">${m} · en curso</div>
            <div class="kpi-val muted" style="font-size:20px;">—</div>
            <div class="kpi-sub"><span class="pill amber">2025 · S/. ${fmt(t25)}</span></div>
          </div>`);
      } else {
        const d = (t26 - t25) / t25 * 100;
        const up = d >= 0;
        el.insertAdjacentHTML('beforeend', `
          <div class="kpi-card">
            <div class="kpi-icon ${up ? 'green' : 'red'}">${up ? '▲' : '▼'}</div>
            <div class="kpi-lbl">${m} · YoY</div>
            <div class="kpi-val ${up ? 'green' : 'red'}">S/. ${fmt(t26)}</div>
            <div class="kpi-sub">
              <span class="pill ${up ? 'green' : 'red'}">${up ? '+' : ''}${d.toFixed(1)}%</span>
              <span class="muted">vs S/. ${fmt(t25)}</span>
            </div>
          </div>`);
      }
    });
  }

  // Meses 2026 cerrados (no el actual). Hoy en mayo → Ene-Abr.
  function closedMonths2026() {
    const today = new Date();
    if (today.getFullYear() < 2026) return [];
    if (today.getFullYear() > 2026) return months;
    return months.slice(0, today.getMonth());
  }

  function renderYoYTable(d2026) {
    const host = document.getElementById('yoy-tables');
    if (!host) return;
    const cmpMonths = closedMonths2026();
    if (cmpMonths.length === 0) {
      host.innerHTML = '<p class="muted" style="font-size:12px;">Aún no hay meses cerrados para comparar.</p>';
      return;
    }
    const activeCh = channels.filter(ch => cmpMonths.some(m => (d2025[m] || {})[ch] > 0 || (d2026[m] || {})[ch] > 0));
    let rows = '';
    activeCh.forEach(ch => {
      let cells = `<tr><td><span class="ch-name"><span class="ch-pip" style="background:${palette[ch]}"></span>${ch}</span></td>`;
      cmpMonths.forEach(m => {
        const v25 = (d2025[m] || {})[ch] || 0;
        const v26 = (d2026[m] || {})[ch] || 0;
        if (v25 === 0 && v26 === 0) cells += `<td class="r"><span class="muted">—</span></td>`;
        else if (v25 === 0)         cells += `<td class="r green">nuevo<span class="sub-val mono">S/. ${fmt(v26)}</span></td>`;
        else {
          const d = (v26 - v25) / v25 * 100;
          cells += `<td class="r ${d >= 0 ? 'green' : 'red'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%<span class="sub-val mono">S/. ${fmt(v26)}</span></td>`;
        }
      });
      rows += cells + '</tr>';
    });
    let totRow = '<tr style="background:#F8FAFC;"><td><strong>Total</strong></td>';
    cmpMonths.forEach(m => {
      const t25 = tot(d2025[m]);
      const t26 = tot(d2026[m]);
      const d = t25 > 0 ? (t26 - t25) / t25 * 100 : 0;
      totRow += `<td class="r ${d >= 0 ? 'green' : 'red'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%<span class="sub-val mono">S/. ${fmt(t26)}</span></td>`;
    });
    totRow += '</tr>';
    const thRows = cmpMonths.map(m => `<th class="r">${m}</th>`).join('');
    host.innerHTML = `<table>
      <thead><tr><th>Canal</th>${thRows}</tr></thead>
      <tbody>${rows}${totRow}</tbody>
    </table>`;
  }

  // ── Productos (estáticos salvo charts.js) ──
  function renderProducts() {
    // KPIs (texto estático derivado del análisis del cliente)
    const kpi = document.getElementById('kpi-prod');
    if (kpi) {
      kpi.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-icon blue"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
          <div class="kpi-lbl">Ingresos netos</div>
          <div class="kpi-val blue">S/. 29,055</div>
          <div class="kpi-sub">136 SKUs · 238 uds</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon green"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div class="kpi-lbl">Pedidos web</div>
          <div class="kpi-val green">225</div>
          <div class="kpi-sub">1.06 uds / pedido promedio</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon amber"><svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></div>
          <div class="kpi-lbl">Ticket promedio</div>
          <div class="kpi-val amber">S/. 129</div>
          <div class="kpi-sub">por unidad vendida</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon purple"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          <div class="kpi-lbl">Marca líder</div>
          <div class="kpi-val" style="font-size:18px;">Martín Aranda</div>
          <div class="kpi-sub">64.6% · S/. 18,778</div>
        </div>`;
    }

    // Charts de productos
    window.Charts.productCharts();

    // Copurchase cards
    const cpGrid = document.getElementById('copurchase-grid');
    if (cpGrid && !cpGrid.childElementCount) {
      ds.copurchaseData.forEach(c => {
        cpGrid.insertAdjacentHTML('beforeend', `
          <div class="copurchase-card">
            <div class="copurchase-icon">${c.icon}</div>
            <div class="copurchase-title">${c.title}</div>
            <div class="copurchase-desc">${c.desc}</div>
            <div class="copurchase-detail">${c.detail}</div>
          </div>`);
      });
    }

    // Next sales
    const ns = document.getElementById('next-sales-grid');
    if (ns && !ns.childElementCount) {
      ds.nextSales.forEach(x => {
        ns.insertAdjacentHTML('beforeend', `
          <div class="next-sale-card">
            <div class="next-sale-trigger">Si → ${x.trigger}</div>
            <div class="next-sale-suggest">${x.suggest}</div>
            <div class="next-sale-why">${x.why}</div>
          </div>`);
      });
    }

    // Multi-bars
    const mb = document.getElementById('multi-bars');
    if (mb && !mb.childElementCount) {
      ds.multiData.forEach(p => {
        const pct = Math.min((p.ratio / 2) * 100, 100);
        const color = p.ratio >= 2 ? 'var(--red)' : p.ratio >= 1.5 ? 'var(--amber)' : 'var(--brand)';
        const pillClass = p.ratio >= 2 ? 'red' : p.ratio >= 1.5 ? 'amber' : 'blue';
        mb.insertAdjacentHTML('beforeend', `
          <div class="multi-bar-row">
            <div class="multi-bar-name">${p.name}</div>
            <div class="multi-bar-track"><div class="multi-bar-fill" style="width:${pct}%;background:${color};"></div></div>
            <div><span class="pill ${pillClass}">${p.ratio.toFixed(1)}×</span></div>
            <div class="multi-bar-why">${p.why}</div>
          </div>`);
      });
      mb.insertAdjacentHTML('beforeend', `
        <div class="multi-bar-row" style="border-bottom:none;padding-bottom:0;">
          <span class="muted" style="font-size:11px;">Producto</span><span></span>
          <span class="muted" style="font-size:11px;text-align:center;">Uds/Pedido</span>
          <span class="muted" style="font-size:11px;">Razón probable</span>
        </div>`);
    }

    // Bundle ideas
    const bi = document.getElementById('bundle-ideas');
    if (bi && !bi.childElementCount) {
      ds.bundleIdeas.forEach(b => {
        bi.insertAdjacentHTML('beforeend', `
          <div class="bundle-card">
            <div class="bundle-head" style="background:${b.color};">
              <span class="bundle-icon">${b.icon}</span>
              <div>
                <div class="bundle-tag">${b.tag}</div>
                <div class="bundle-title">${b.title}</div>
              </div>
            </div>
            <div class="bundle-body">
              <div class="bundle-products">
                ${b.products.map(p => `<div class="bundle-product"><span class="arrow" style="color:${b.color};">▸</span>${p}</div>`).join('')}
              </div>
              <div class="bundle-mechanic">
                <div class="bundle-mechanic-lbl">Mecánica</div>
                <div class="bundle-mechanic-text">${b.mechanic}</div>
              </div>
              <div class="bundle-ticket-row">
                <span class="bundle-ticket-lbl">Ticket estimado</span>
                <span class="bundle-ticket-val" style="color:${b.color};">${b.ticket}</span>
              </div>
              <div class="bundle-why">${b.why}</div>
            </div>
          </div>`);
      });
    }
  }

  // ── Render completo con datos live ──
  function renderAll(liveData) {
    // Merge el 2025 live (12 meses) sobre el hardcoded (Ene-Abr).
    adoptLive2025(liveData.d2025_live);

    state.d2026        = liveData.d2026;
    state.weeklyData   = liveData.weeklyData;
    state.transactions = liveData.transactions;
    state.weekly2025   = liveData.weekly2025 || {};
    state.generated    = liveData.generated;

    renderKpisYoY(state.d2026);
    window.Charts.evoChart(state.d2026);
    renderYoYTable(state.d2026);

    // Distribución: usa meses cerrados (más representativo) o fallback a Ene-Mar.
    const closed = closedMonths2026();
    const distMonths = closed.length >= 3 ? closed : ['Enero', 'Febrero', 'Marzo'];
    window.Charts.distCharts(state.d2026, distMonths);
    window.Charts.absChart(state.d2026, distMonths);

    // Sub-text dinámico de la panel YoY
    const yoySub = document.querySelector('#view-yoy .panel:last-of-type .panel-sub');
    if (yoySub) {
      yoySub.textContent = closed.length === 0
        ? 'aún sin meses cerrados'
        : closed.length === 1
          ? `${closed[0]} (mes cerrado)`
          : `${closed[0]} – ${closed[closed.length - 1]} (meses cerrados)`;
    }

    window.Objectives.render({
      d2026: state.d2026,
      weeklyData: state.weeklyData,
      transactions: state.transactions,
      weekly2025: state.weekly2025,
    });
    window.Objectives.wireObjToolbar?.();

    if (state.renderedProducts) renderProducts();
    window.Sheets.updateGenerated(state.generated);
  }

  // Si el pipeline trajo d2025_live con valores, lo preferimos sobre el
  // hardcoded. Se mergea en el objeto compartido para que charts.js /
  // objectives.js lo vean sin cambios.
  function adoptLive2025(d2025Live) {
    if (!d2025Live) return;
    const hasValues = Object.values(d2025Live).some(
      m => m && Object.values(m).some(v => v > 0)
    );
    if (!hasValues) return;
    Object.keys(d2025Live).forEach(m => {
      ds.d2025[m] = { ...(ds.d2025[m] || {}), ...d2025Live[m] };
    });
  }

  // ── Init ──
  async function init() {
    Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels.display = false;
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif';

    wireNav();
    const hashView = window.location.hash.slice(1);
    showView(Object.keys(VIEW_TITLES).includes(hashView) ? hashView : 'view-yoy');

    const live = await window.DataLive.load();
    if (live.source === 'fallback') {
      const host = document.getElementById('kpi-yoy');
      if (host) host.insertAdjacentHTML('beforebegin', `
        <div class="insight err" style="margin-bottom:14px;">
          <b>Datos pendientes:</b> No se pudo cargar <code>data/ventas-2026.json</code>. El pipeline de GitHub Actions tiene que correr al menos una vez (o ejecutá <code>npm run fetch</code> local).
        </div>`);
    }
    renderAll(live);

    window.Sheets.init({
      generated: live.generated,
      onUpdate: updated => renderAll(updated),
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
