/* ============================================================
   projections.js — módulo Proyecciones (ritmo mensual + recálculo de inversión)
   Expone window.Projections.render({ d2026, targets, adsData })
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const { months } = ds;

  const fmt    = n => Math.round(n).toLocaleString('es-PE');
  const fmtS   = n => {
    const a = Math.abs(n);
    if (a >= 1e6) return 'S/. ' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return 'S/. ' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return 'S/. ' + Math.round(n);
  };
  const fmtR   = n => n.toFixed(1) + 'x';
  const pct    = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—';

  let _chartPace   = null;
  let _chartSrc    = null;
  let _mesActivo   = null;
  let _adsData     = null;
  let _targets     = null;

  // ── Mes activo por defecto: el último con datos de ads ───────
  function detectMesActivo(adsData) {
    const disponibles = Object.keys((adsData || {}).meses || {});
    if (!disponibles.length) return null;
    return disponibles[disponibles.length - 1];
  }

  // ── Cálculo de ritmo mensual ──────────────────────────────────
  function calcPacing(mes, adsData, targets) {
    const md = (adsData?.meses || {})[mes];
    if (!md) return null;

    const { diasEnMes, diasConDatos } = md;
    const diasRestantes = Math.max(0, diasEnMes - diasConDatos);

    // Meta E-Commerce
    const metaEc = md.meta?.ecommerce || {};
    const metaWa = md.meta?.whatsapp  || {};
    const metaIn = md.meta?.interaccion || {};
    const gSearch = md.google?.search || {};

    // Ventas digitales acumuladas (Meta E-Com + Google Search + WhatsApp atribuido)
    const ventasMetaEc = metaEc.valor  || 0;
    const ventasGoogle = gSearch.valor || 0;
    const ventasWa     = (metaWa.compras || 0) * (metaEc.valor && metaEc.compras ? metaEc.valor / metaEc.compras : 285);

    const gastoTotal  = (metaEc.gasto || 0) + (metaWa.gasto || 0) + (metaIn.gasto || 0) + (gSearch.gasto || 0);
    const ventasTotal = ventasMetaEc + ventasGoogle + ventasWa;

    // Tasas diarias
    const tasaVentasDia = diasConDatos > 0 ? ventasTotal / diasConDatos : 0;
    const tasaGastoDia  = diasConDatos > 0 ? gastoTotal  / diasConDatos : 0;
    const roasActual    = gastoTotal > 0 ? ventasTotal / gastoTotal : 0;

    // Proyección fin de mes
    const ventasProyectadas = ventasTotal + tasaVentasDia * diasRestantes;
    const gastoProyectado   = gastoTotal  + tasaGastoDia  * diasRestantes;

    // Objetivo del mes: Web + WhatsApp
    const objWeb = ((targets || {})[mes] || {}).Web      || 0;
    const objWa  = ((targets || {})[mes] || {}).WhatsApp || 0;
    const objTotal = objWeb + objWa;

    // Brecha y recálculo de inversión
    const brecha      = ventasProyectadas - objTotal;
    const brechaActual = ventasTotal - (objTotal * diasConDatos / diasEnMes); // vs ritmo esperado

    // Inversión necesaria para cerrar la brecha en días restantes
    let presupuestoDiarioNecesario = null;
    let inversAdicionalDia = null;
    if (diasRestantes > 0 && roasActual > 0 && objTotal > 0 && brecha < 0) {
      const ventasFaltantes     = objTotal - ventasProyectadas;
      const gastoAdicionalTotal = ventasFaltantes / roasActual;
      inversAdicionalDia       = gastoAdicionalTotal / diasRestantes;
      presupuestoDiarioNecesario = tasaGastoDia + inversAdicionalDia;
    }

    return {
      mes, diasEnMes, diasConDatos, diasRestantes,
      // Fuentes individuales
      fuentes: {
        metaEcommerce: {
          nombre: metaEc.nombre || 'Meta E-Commerce',
          gasto: metaEc.gasto || 0,
          ventas: ventasMetaEc,
          compras: metaEc.compras || 0,
          pagosIniciados: metaEc.pagosIniciados || 0,
          roas: metaEc.gasto > 0 ? ventasMetaEc / metaEc.gasto : 0,
          presupuestoDiario: metaEc.presupuestoDiario || 0,
          impresiones: metaEc.impresiones || 0,
          alcance: metaEc.alcance || 0,
          color: '#1877F2',
        },
        googleSearch: {
          nombre: gSearch.nombre || 'Google Search',
          gasto: gSearch.gasto || 0,
          ventas: ventasGoogle,
          conversiones: gSearch.conversiones || 0,
          roas: gSearch.gasto > 0 ? ventasGoogle / gSearch.gasto : 0,
          cpc: gSearch.cpc || 0,
          ctr: gSearch.ctr || 0,
          presupuestoDiario: gSearch.presupuestoDiario || 0,
          impresiones: gSearch.impresiones || 0,
          clics: gSearch.clics || 0,
          color: '#4285F4',
        },
        metaWhatsapp: {
          nombre: metaWa.nombre || 'Meta WhatsApp',
          gasto: metaWa.gasto || 0,
          ventas: ventasWa,
          conversaciones: metaWa.conversaciones || 0,
          compras: metaWa.compras || 0,
          roas: metaWa.gasto > 0 ? ventasWa / metaWa.gasto : 0,
          presupuestoDiario: metaWa.presupuestoDiario || 0,
          impresiones: metaWa.impresiones || 0,
          alcance: metaWa.alcance || 0,
          color: '#25D366',
        },
        metaInteraccion: {
          nombre: metaIn.nombre || 'Campaña Interacción',
          gasto: metaIn.gasto || 0,
          impresiones: metaIn.impresiones || 0,
          alcance: metaIn.alcance || 0,
          color: '#E1306C',
        },
      },
      // Totales
      gastoTotal, ventasTotal, gastoProyectado, ventasProyectadas,
      tasaVentasDia, tasaGastoDia, roasActual,
      objTotal, objWeb, objWa,
      brecha, brechaActual,
      presupuestoDiarioNecesario, inversAdicionalDia,
      progresoPct: objTotal > 0 ? ventasProyectadas / objTotal : 0,
    };
  }

  // ── Selector de mes ──────────────────────────────────────────
  function renderMesSelector(adsData) {
    const el = document.getElementById('proj-mes-selector');
    if (!el) return;
    const disponibles = new Set(Object.keys((adsData?.meses || {})));

    el.innerHTML = months.map(m => {
      const tieneDatos = disponibles.has(m);
      const activo = m === _mesActivo;
      return `<button class="proj-mes-btn${activo ? ' active' : ''}${!tieneDatos ? ' sin-datos' : ''}"
        data-mes="${m}" ${!tieneDatos ? 'title="Sin datos"' : ''}>${m.substring(0, 3)}</button>`;
    }).join('');

    el.querySelectorAll('.proj-mes-btn:not(.sin-datos)').forEach(btn => {
      btn.addEventListener('click', () => {
        _mesActivo = btn.dataset.mes;
        el.querySelectorAll('.proj-mes-btn').forEach(b => b.classList.toggle('active', b.dataset.mes === _mesActivo));
        renderMes(_adsData, _targets);
      });
    });
  }

  // ── KPI strip ────────────────────────────────────────────────
  function renderKpis(p) {
    const el = document.getElementById('kpi-proj');
    if (!el) return;
    el.className = 'kpi-strip';

    if (!p) {
      el.innerHTML = '<div class="insight info" style="grid-column:1/-1;margin:0;">Selecciona un mes con datos para ver el análisis.</div>';
      return;
    }

    const progColor = p.progresoPct >= 1 ? 'var(--green-text)' : p.progresoPct >= 0.8 ? 'var(--amber-text)' : 'var(--red-text)';
    const brechaColor = p.brecha >= 0 ? 'var(--green-text)' : 'var(--red-text)';
    const brechaSign  = p.brecha >= 0 ? '+' : '';

    el.innerHTML = `
      <div class="kpi-pill">
        <span>Gasto acumulado</span>
        <strong>${fmtS(p.gastoTotal)}</strong>
        <small>Día ${p.diasConDatos} de ${p.diasEnMes} · ${p.diasRestantes} días restantes</small>
      </div>
      <div class="kpi-pill">
        <span>Ventas generadas</span>
        <strong>${fmtS(p.ventasTotal)}</strong>
        <small>ROAS ${fmtR(p.roasActual)} · ~${fmtS(p.tasaVentasDia)}/día</small>
      </div>
      <div class="kpi-pill">
        <span>Proyección fin de mes</span>
        <strong style="color:${progColor};">${fmtS(p.ventasProyectadas)}</strong>
        <small>${(p.progresoPct * 100).toFixed(1)}% del objetivo · obj: ${fmtS(p.objTotal)}</small>
      </div>
      <div class="kpi-pill">
        <span>Brecha vs objetivo</span>
        <strong style="color:${brechaColor};">${brechaSign}${fmtS(p.brecha)}</strong>
        <small>${p.brecha >= 0 ? 'Por encima del objetivo' : 'Por debajo — ver recálculo'}</small>
      </div>`;
  }

  // ── Cards por fuente ─────────────────────────────────────────
  function renderFuentes(p) {
    const el = document.getElementById('proj-channels');
    if (!el || !p) { if (el) el.innerHTML = ''; return; }

    const f = p.fuentes;

    const cardEcom = srcCard({
      color: f.metaEcommerce.color,
      nombre: 'Meta E-Commerce',
      subtitulo: 'Ventas digitales · Facebook / Instagram',
      gasto: f.metaEcommerce.gasto,
      ventas: f.metaEcommerce.ventas,
      roas: f.metaEcommerce.roas,
      stat1: { label: 'Compras', val: f.metaEcommerce.compras },
      stat2: { label: 'Pagos iniciados', val: f.metaEcommerce.pagosIniciados },
      stat3: { label: 'Alcance', val: fmt(f.metaEcommerce.alcance) },
      presupuestoDiario: f.metaEcommerce.presupuestoDiario,
      diasRestantes: p.diasRestantes,
    });

    const cardGoogle = srcCard({
      color: f.googleSearch.color,
      nombre: 'Google Search',
      subtitulo: 'Búsquedas pagas · Search | LR',
      gasto: f.googleSearch.gasto,
      ventas: f.googleSearch.ventas,
      roas: f.googleSearch.roas,
      stat1: { label: 'Conversiones', val: f.googleSearch.conversiones },
      stat2: { label: 'Clics', val: fmt(f.googleSearch.clics) },
      stat3: { label: 'CPC prom.', val: 'S/. ' + f.googleSearch.cpc.toFixed(2) },
      presupuestoDiario: f.googleSearch.presupuestoDiario,
      diasRestantes: p.diasRestantes,
    });

    const cardWa = srcCard({
      color: f.metaWhatsapp.color,
      nombre: 'Meta → WhatsApp',
      subtitulo: 'Tráfico a mensajes directos',
      gasto: f.metaWhatsapp.gasto,
      ventas: f.metaWhatsapp.ventas,
      roas: f.metaWhatsapp.roas,
      stat1: { label: 'Conversaciones', val: fmt(f.metaWhatsapp.conversaciones) },
      stat2: { label: 'Compras attr.', val: f.metaWhatsapp.compras },
      stat3: { label: 'Alcance', val: fmt(f.metaWhatsapp.alcance) },
      presupuestoDiario: f.metaWhatsapp.presupuestoDiario,
      diasRestantes: p.diasRestantes,
    });

    const cardInt = `
      <div class="proj-ch-card">
        <div class="proj-ch-header">
          <span class="proj-ch-pip" style="background:${f.metaInteraccion.color};"></span>
          <span class="proj-ch-name">Meta Interacción</span>
          <span class="proj-ch-badge gray">Awareness</span>
        </div>
        <div class="proj-ch-val">${fmtS(f.metaInteraccion.gasto)}</div>
        <div class="proj-ch-sub">gasto en branding / alcance</div>
        <div class="proj-ch-stats">
          <div class="proj-ch-stat"><span>Impresiones</span><strong>${fmt(f.metaInteraccion.impresiones)}</strong></div>
          <div class="proj-ch-stat"><span>Alcance</span><strong>${fmt(f.metaInteraccion.alcance)}</strong></div>
        </div>
      </div>`;

    el.innerHTML = cardEcom + cardWa + cardGoogle + cardInt;
  }

  function srcCard({ color, nombre, subtitulo, gasto, ventas, roas, stat1, stat2, stat3, presupuestoDiario, diasRestantes }) {
    const roasBadgeClass = roas >= 3 ? 'green' : roas >= 1.5 ? 'amber' : 'red';
    const gastoRestante = presupuestoDiario * diasRestantes;
    return `
      <div class="proj-ch-card">
        <div class="proj-ch-header">
          <span class="proj-ch-pip" style="background:${color};"></span>
          <span class="proj-ch-name">${nombre}</span>
          <span class="proj-ch-badge ${roasBadgeClass}">ROAS ${fmtR(roas)}</span>
        </div>
        <div class="proj-ch-val">${fmtS(ventas)}</div>
        <div class="proj-ch-sub">${subtitulo}</div>
        <div class="proj-ch-stats">
          <div class="proj-ch-stat"><span>${stat1.label}</span><strong>${stat1.val}</strong></div>
          <div class="proj-ch-stat"><span>${stat2.label}</span><strong>${stat2.val}</strong></div>
          <div class="proj-ch-stat"><span>${stat3.label}</span><strong>${stat3.val}</strong></div>
        </div>
        <div class="proj-ch-budget">
          <span>Gasto acumulado</span>
          <strong>${fmtS(gasto)}</strong>
          ${diasRestantes > 0 ? `<span class="proj-ch-budget-rest">+${fmtS(gastoRestante)} estimado restante</span>` : ''}
        </div>
      </div>`;
  }

  // ── Recálculo de inversión ───────────────────────────────────
  function renderRecalculo(p) {
    const el = document.getElementById('proj-recalculo');
    if (!el || !p) { if (el) el.style.display = 'none'; return; }
    el.style.display = 'block';

    if (p.diasRestantes === 0) {
      el.innerHTML = `<div class="recalc-box cerrado">
        <span class="recalc-icon">✓</span>
        <div><strong>Mes cerrado.</strong> Resultado final: ${fmtS(p.ventasTotal)} vs objetivo ${fmtS(p.objTotal)}.</div>
      </div>`;
      return;
    }

    const tasaActDia = fmtS(p.tasaGastoDia);
    const ventasProyDia = fmtS(p.tasaVentasDia);

    if (p.brecha >= 0) {
      el.innerHTML = `<div class="recalc-box verde">
        <div class="recalc-title">Ritmo actual — en camino al objetivo</div>
        <div class="recalc-row">
          <div class="recalc-item"><span>Gasto diario actual</span><strong>${tasaActDia}/día</strong></div>
          <div class="recalc-item"><span>Ventas generadas/día</span><strong>${ventasProyDia}/día</strong></div>
          <div class="recalc-item"><span>Proyección cierre</span><strong style="color:var(--green-text)">${fmtS(p.ventasProyectadas)}</strong></div>
          <div class="recalc-item"><span>Objetivo mes</span><strong>${fmtS(p.objTotal)}</strong></div>
        </div>
        <div class="recalc-note">Mantén el presupuesto actual para superar el objetivo en <strong>${fmtS(p.brecha)}</strong>.</div>
      </div>`;
      return;
    }

    const nuevoPresupuesto = p.presupuestoDiarioNecesario;
    const aumento = p.inversAdicionalDia;
    const ventasFaltantes = p.objTotal - p.ventasProyectadas;

    el.innerHTML = `<div class="recalc-box alerta">
      <div class="recalc-title">Recálculo de inversión — para cerrar la brecha</div>
      <div class="recalc-row">
        <div class="recalc-item"><span>Gasto diario actual</span><strong>${tasaActDia}/día</strong></div>
        <div class="recalc-item"><span>Días restantes</span><strong>${p.diasRestantes} días</strong></div>
        <div class="recalc-item"><span>Ventas que faltan</span><strong style="color:var(--red-text)">${fmtS(ventasFaltantes)}</strong></div>
        <div class="recalc-item"><span>ROAS actual</span><strong>${fmtR(p.roasActual)}</strong></div>
      </div>
      <div class="recalc-accion">
        <span class="recalc-accion-label">Presupuesto diario recomendado</span>
        <span class="recalc-accion-valor">${fmtS(nuevoPresupuesto)}<small>/día</small></span>
        <span class="recalc-accion-delta">+${fmtS(aumento)}/día adicional en los próximos ${p.diasRestantes} días</span>
      </div>
      <div class="recalc-note">Con ROAS ${fmtR(p.roasActual)}, aumentar la inversión en <strong>${fmtS(aumento)}/día</strong> generará las <strong>${fmtS(ventasFaltantes)}</strong> en ventas que faltan para cerrar el mes en objetivo.</div>
    </div>`;
  }

  // ── Chart: ritmo diario de ventas vs objetivo proporcional ───
  function renderChartPace(p) {
    const canvas = document.getElementById('chart-proj-vs-obj');
    if (!canvas || !p) return;
    if (_chartPace) { _chartPace.destroy(); _chartPace = null; }

    const diasTotal = p.diasEnMes;
    const labels = Array.from({ length: diasTotal }, (_, i) => `D${i + 1}`);

    // Acumulado real (hasta dia diasConDatos)
    const acumReal = labels.map((_, i) => {
      if (i < p.diasConDatos) return Math.round(p.ventasTotal * (i + 1) / p.diasConDatos);
      return null;
    });

    // Proyección desde hoy al fin de mes
    const acumProyectado = labels.map((_, i) => {
      if (i < p.diasConDatos - 1) return null;
      const diasDesdeInicio = i + 1;
      return Math.round(p.ventasTotal + p.tasaVentasDia * (diasDesdeInicio - p.diasConDatos));
    });

    // Curva objetivo
    const objCurva = labels.map((_, i) => Math.round(p.objTotal * (i + 1) / diasTotal));

    _chartPace = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ventas acumuladas (real)',
            data: acumReal,
            borderColor: '#2563eb',
            borderWidth: 2.5,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
            order: 1,
          },
          {
            label: 'Proyección al cierre',
            data: acumProyectado,
            borderColor: '#2563eb',
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            tension: 0.3,
            order: 2,
          },
          {
            label: 'Objetivo mensual',
            data: objCurva,
            borderColor: '#f59e0b',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 3,
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
            mode: 'index',
            intersect: false,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtS(ctx.raw || 0)}` },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 9 }, maxTicksLimit: 10 },
          },
          y: {
            ticks: { font: { size: 10 }, callback: v => fmtS(v) },
            grid: { color: '#f1f5f9' },
          },
        },
      },
    });
  }

  // ── Chart: gasto por fuente (barras apiladas) ────────────────
  function renderChartSrc(p) {
    const canvas = document.getElementById('chart-proj-annual');
    if (!canvas || !p) return;
    if (_chartSrc) { _chartSrc.destroy(); _chartSrc = null; }

    const f = p.fuentes;
    const fuentes = [
      { label: 'Meta E-Commerce', gasto: f.metaEcommerce.gasto, ventas: f.metaEcommerce.ventas, color: f.metaEcommerce.color },
      { label: 'Google Search',   gasto: f.googleSearch.gasto,  ventas: f.googleSearch.ventas,  color: f.googleSearch.color },
      { label: 'Meta WhatsApp',   gasto: f.metaWhatsapp.gasto,  ventas: f.metaWhatsapp.ventas,  color: f.metaWhatsapp.color },
      { label: 'Meta Interacción',gasto: f.metaInteraccion.gasto, ventas: 0, color: f.metaInteraccion.color },
    ];

    _chartSrc = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: fuentes.map(f => f.label),
        datasets: [
          {
            label: 'Ventas generadas',
            data: fuentes.map(f => f.ventas),
            backgroundColor: fuentes.map(f => f.color + 'BB'),
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Gasto',
            data: fuentes.map(f => f.gasto),
            backgroundColor: fuentes.map(f => f.color + '44'),
            borderColor: fuentes.map(f => f.color),
            borderWidth: 1,
            borderRadius: 4,
            order: 3,
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
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtS(ctx.raw || 0)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { ticks: { font: { size: 10 }, callback: v => fmtS(v) }, grid: { color: '#f1f5f9' } },
        },
      },
    });
  }

  // ── Render del mes activo ────────────────────────────────────
  function renderMes(adsData, targets) {
    const p = calcPacing(_mesActivo, adsData, targets);
    renderKpis(p);
    renderFuentes(p);
    renderChartPace(p);
    renderChartSrc(p);
    renderRecalculo(p);
  }

  // ── Render público ───────────────────────────────────────────
  function render({ d2026, targets, adsData }) {
    _adsData  = adsData  || _adsData;
    _targets  = targets  || _targets;

    if (!_mesActivo) _mesActivo = detectMesActivo(_adsData);

    renderMesSelector(_adsData);
    renderMes(_adsData, _targets);
  }

  global.Projections = { render };

})(window);
