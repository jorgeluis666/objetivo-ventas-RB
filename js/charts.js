/* ============================================================
   charts.js — todas las instancias de Chart.js del dashboard.
   Usa window.DataStatic y recibe datos 2026 vivos en runtime.
   Expone window.Charts con builders que pueden re-ejecutarse.
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const { channels, palette, typeColors, d2025, months, prodTopUnits, prodTopRev, prodTopTicket, prodTypes } = ds;

  // Defaults visuales comunes
  const axisColor = '#94A3B8';
  const gridColor = 'rgba(15,23,42,0.06)';
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif';

  // ── Animaciones ──
  // Barras: crecen desde la base del eje (axis = 'y' para verticales, 'x' para horizontales).
  const barGrow = (axis = 'y') => ({
    duration: 900,
    easing: 'easeOutCubic',
    animations: {
      [axis]: {
        from: ctx => ctx.chart.scales[axis]?.getPixelForValue(0) ?? 0,
      },
    },
  });

  // Líneas: trazo de izquierda a derecha, cada segmento sale del punto anterior.
  function lineDraw(totalDuration = 1400) {
    const previousY = ctx => {
      if (ctx.index === 0) return ctx.chart.scales.y.getPixelForValue(0);
      const meta = ctx.chart.getDatasetMeta(ctx.datasetIndex);
      const prev = meta.data[ctx.index - 1];
      return prev ? prev.getProps(['y'], true).y : ctx.chart.scales.y.getPixelForValue(0);
    };
    const segmentFor = ctx => {
      const count = ctx.chart.data.labels?.length || 1;
      return totalDuration / count;
    };
    return {
      duration: totalDuration,
      x: {
        type: 'number',
        easing: 'linear',
        duration: segmentFor,
        from: NaN,
        delay(ctx) {
          if (ctx.type !== 'data' || ctx.xStarted) return 0;
          ctx.xStarted = true;
          return ctx.index * segmentFor(ctx);
        },
      },
      y: {
        type: 'number',
        easing: 'linear',
        duration: segmentFor,
        from: previousY,
        delay(ctx) {
          if (ctx.type !== 'data' || ctx.yStarted) return 0;
          ctx.yStarted = true;
          return ctx.index * segmentFor(ctx);
        },
      },
    };
  }

  const instances = new Map();
  function destroy(id) {
    if (instances.has(id)) {
      instances.get(id).destroy();
      instances.delete(id);
    }
  }
  function mount(id, config) {
    destroy(id);
    const el = document.getElementById(id);
    if (!el) return null;
    const chart = new Chart(el, config);
    instances.set(id, chart);
    return chart;
  }

  // Re-ejecuta la animación de entrada de los charts indicados.
  // Útil al cambiar de vista — los charts ocultos no se "ven" animarse.
  function replay(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach(id => {
      // Admite prefijos tipo "week-chart-" para grupos.
      if (id.endsWith('*')) {
        const prefix = id.slice(0, -1);
        instances.forEach((chart, key) => {
          if (key.startsWith(prefix)) { chart.reset(); chart.update(); }
        });
        return;
      }
      const chart = instances.get(id);
      if (chart) { chart.reset(); chart.update(); }
    });
  }

  // ── Helpers ──
  const tot = obj => obj ? channels.reduce((s, c) => s + (obj[c] || 0), 0) : 0;
  const fmt = n => Math.round(n).toLocaleString('es-PE');

  // ── Evolución mensual ──
  // Muestra los 12 meses. 2025 se pinta completo (12 pts), 2026 solo hasta
  // donde el pipeline trajo datos (el resto queda en null → spanGaps:false).
  const MONTH_SHORT_EVO = { Enero:'Ene', Febrero:'Feb', Marzo:'Mar', Abril:'Abr', Mayo:'May', Junio:'Jun', Julio:'Jul', Agosto:'Ago', Septiembre:'Sep', Octubre:'Oct', Noviembre:'Nov', Diciembre:'Dic' };
  function evoChart(d2026) {
    return mount('chart-evo', {
      type: 'line',
      data: {
        labels: months.map(m => MONTH_SHORT_EVO[m] || m),
        datasets: [
          {
            label: '2025',
            data: months.map(m => Math.round(tot(d2025[m]))),
            borderColor: '#94A3B8',
            backgroundColor: 'rgba(148,163,184,0.08)',
            borderWidth: 1.5,
            pointBackgroundColor: '#94A3B8',
            pointRadius: 4,
            tension: 0.35,
            fill: true,
            borderDash: [5, 4],
          },
          {
            label: '2026',
            data: months.map(m => tot(d2026[m]) > 0 ? Math.round(tot(d2026[m])) : null),
            borderColor: '#2563EB',
            backgroundColor: 'rgba(37,99,235,0.1)',
            borderWidth: 2.5,
            pointBackgroundColor: '#2563EB',
            pointRadius: 5,
            tension: 0.35,
            fill: true,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: lineDraw(1600),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => months[ctx[0]?.dataIndex] || '',
              label: ctx => ctx.raw !== null
                ? ' ' + ctx.dataset.label + ': S/. ' + ctx.raw.toLocaleString('es-PE')
                : ' ' + ctx.dataset.label + ': sin datos',
            },
          },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { family: fontFamily, size: 11 } }, grid: { display: false } },
          y: {
            ticks: { color: axisColor, font: { size: 11 }, callback: v => 'S/. ' + (v / 1000).toFixed(0) + 'k' },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // ── Distribución stacked (2025 y 2026) ──
  function distCharts(d2026, distMonths) {
    ['2025', '2026'].forEach(yr => {
      const src = yr === '2025' ? d2025 : d2026;
      const legEl = document.getElementById('leg-' + yr);
      if (legEl) {
        legEl.innerHTML = '';
        channels
          .filter(ch => distMonths.some(m => src[m][ch] > 0))
          .forEach(ch =>
            legEl.insertAdjacentHTML(
              'beforeend',
              `<span class="legend-item"><span class="lsq" style="background:${palette[ch]}"></span>${ch}</span>`
            )
          );
      }
      mount('chart-dist-' + yr, {
        type: 'bar',
        data: {
          labels: distMonths,
          datasets: channels.map(ch => ({
            label: ch,
            data: distMonths.map(m => {
              const t = tot(src[m]);
              return t > 0 ? parseFloat((src[m][ch] / t * 100).toFixed(1)) : 0;
            }),
            backgroundColor: palette[ch],
            borderRadius: 3,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: barGrow('y'),
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + ctx.raw + '%' } },
          },
          scales: {
            x: { stacked: true, ticks: { color: axisColor }, grid: { display: false } },
            y: { stacked: true, max: 100, ticks: { color: axisColor, font: { size: 11 }, callback: v => v + '%' }, grid: { color: gridColor } },
          },
        },
      });
    });
  }

  // ── Barras absolutas 2025 vs 2026 ──
  function absChart(d2026, distMonths) {
    const legAbs = document.getElementById('leg-abs');
    if (legAbs) {
      legAbs.innerHTML = '';
      channels
        .filter(ch => distMonths.some(m => d2025[m][ch] > 0 || d2026[m][ch] > 0))
        .forEach(ch =>
          legAbs.insertAdjacentHTML(
            'beforeend',
            `<span class="legend-item"><span class="lsq" style="background:${palette[ch]}55"></span><span class="lsq" style="background:${palette[ch]};margin-left:2px;"></span> ${ch}</span>`
          )
        );
    }
    mount('chart-abs', {
      type: 'bar',
      data: {
        labels: distMonths,
        datasets: channels.flatMap(ch => [
          {
            label: ch + ' 2025',
            data: distMonths.map(m => Math.round(d2025[m][ch])),
            backgroundColor: palette[ch] + '55',
            borderRadius: 3,
            stack: ch,
          },
          {
            label: ch + ' 2026',
            data: distMonths.map(m => Math.round(d2026[m][ch])),
            backgroundColor: palette[ch],
            borderRadius: 3,
            stack: ch + 'b',
          },
        ]),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: barGrow('y'),
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': S/. ' + ctx.raw.toLocaleString('es-PE') } },
        },
        scales: {
          x: { ticks: { color: axisColor }, grid: { display: false } },
          y: {
            ticks: { color: axisColor, font: { size: 11 }, callback: v => 'S/. ' + (v / 1000).toFixed(0) + 'k' },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // ── Productos web (estáticos) ──
  function hBar(id, labels, data, colors, suffix) {
    return mount(id, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4 }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: barGrow('x'),
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${suffix} ${ctx.raw.toLocaleString('es-PE')}` } },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: '#0F172A', font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  }

  function productCharts() {
    hBar(
      'chart-top-units',
      prodTopUnits.map(p => p.name),
      prodTopUnits.map(p => p.uds),
      prodTopUnits.map(() => '#2563EB'),
      'uds'
    );
    hBar(
      'chart-top-rev',
      prodTopRev.map(p => p.name),
      prodTopRev.map(p => p.rev),
      prodTopRev.map(() => '#7C3AED'),
      'S/.'
    );

    mount('chart-types', {
      type: 'doughnut',
      data: {
        labels: prodTypes.map(t => t.type),
        datasets: [{
          data: prodTypes.map(t => t.uds),
          backgroundColor: typeColors,
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { font: { size: 11 }, color: '#475569', padding: 10, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} uds` } },
        },
      },
    });

    mount('chart-ticket', {
      type: 'bar',
      data: {
        labels: prodTopTicket.map(p => p.name),
        datasets: [{
          data: prodTopTicket.map(p => p.tk),
          backgroundColor: ['#2563EB', '#D97706', '#7C3AED', '#059669', '#DB2777'],
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: barGrow('x'),
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` S/. ${ctx.raw}/pedido` } },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { size: 10 }, callback: v => 'S/. ' + v }, grid: { color: gridColor } },
          y: { ticks: { color: '#0F172A', font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  }

  // ── Combined weekly — 2025 full year (ref) + 2026 available ──
  // weeklyRef  = 12 meses del año anterior (referencia, gris punteada)
  // weeklyCurrent = meses disponibles del año en curso (azul sólido)
  function combinedWeeklyChart(weeklyRef, weeklyCurrent) {
    const ALL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const MONTH_SHORT = { Enero:'Ene', Febrero:'Feb', Marzo:'Mar', Abril:'Abr', Mayo:'May', Junio:'Jun', Julio:'Jul', Agosto:'Ago', Septiembre:'Sep', Octubre:'Oct', Noviembre:'Nov', Diciembre:'Dic' };

    // Aplana las semanas del año en una serie continua
    const flatten = (weekMap) => {
      const labels = [];
      const values = [];
      ALL_MONTHS.forEach(m => {
        const weeks = weekMap[m] || [];
        weeks.forEach((w, i) => {
          // Primera semana del mes muestra la abreviatura; las demás solo "S<n>"
          labels.push(i === 0 ? `${MONTH_SHORT[m]} S${w.w}` : `S${w.w}`);
          values.push(w.TOTAL || 0);
        });
      });
      return { labels, values };
    };

    // La referencia (2025) da la longitud del eje X (año completo)
    const ref = flatten(weeklyRef);
    const cur = flatten(weeklyCurrent);

    // El año en curso se alinea al inicio de la serie (primera semana = Enero)
    const curAligned = ref.labels.map((_, i) =>
      i < cur.values.length && cur.values[i] > 0 ? cur.values[i] : null
    );

    return mount('chart-weekly-combined', {
      type: 'line',
      data: {
        labels: ref.labels,
        datasets: [
          {
            label: '2025 (referencia)',
            data: ref.values,
            borderColor: '#94A3B8',
            backgroundColor: 'rgba(148,163,184,0.08)',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointBackgroundColor: '#94A3B8',
            pointRadius: 2.5,
            pointHoverRadius: 5,
            tension: 0.3,
            fill: false,
          },
          {
            label: '2026',
            data: curAligned,
            borderColor: '#2563EB',
            backgroundColor: 'rgba(37,99,235,0.1)',
            borderWidth: 2.5,
            pointBackgroundColor: '#2563EB',
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: true,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: lineDraw(2000),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.raw !== null
                ? ` ${ctx.dataset.label}: S/. ${ctx.raw.toLocaleString('es-PE')}`
                : ` ${ctx.dataset.label}: sin datos`,
            },
          },
          datalabels: { display: false },
        },
        scales: {
          x: {
            ticks: {
              color: axisColor,
              font: { size: 10 },
              autoSkip: true,
              maxRotation: 0,
              callback(v, i) {
                const lbl = this.getLabelForValue(v);
                // Solo mostrar los labels que empiezan con abreviatura de mes
                return /^[A-Z][a-z]{2} /.test(lbl) ? lbl.split(' ')[0] : '';
              },
            },
            grid: { display: false },
          },
          y: {
            ticks: { color: axisColor, font: { size: 10 }, callback: v => 'S/. ' + (v / 1000).toFixed(0) + 'k' },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  global.Charts = {
    evoChart, distCharts, absChart, productCharts, combinedWeeklyChart,
    destroy, replay,
    destroyAll: () => { instances.forEach(c => c.destroy()); instances.clear(); },
    tot, fmt,
  };
})(window);
