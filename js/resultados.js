/* ============================================================
   resultados.js — módulo «Resultados vs inversión»
   El cuadro con el que se decide a qué canal subirle la inversión: mes a mes,
   la venta real del xls de Drive contra la inversión publicitaria, y el ROAS
   que sale de dividirlas.

   La diferencia con el resto del tablero: acá el numerador del ROAS son las
   ventas de la hoja de Drive (data/ventas-2026.json), no el valor que atribuyen
   Meta y Google. Ese ROAS de plataforma va al lado, en su propia columna, para
   ver la brecha entre lo que la plataforma se adjudica y lo que la marca vendió.

   No tiene datos propios: los toma de otros dos módulos.
     Objetivos 2026      ventas por canal, por ciclo de venta y por día, 2026 y 2025
                         (data/ventas-2026.json).
     Gasto publicitario  inversión y resultados de Meta Ads y Google Ads
                         (data/ads-2026.json), por día y fuente vía js/pauta-dia.js.

   Todo va por el ciclo de venta de la marca (js/ciclo.js: cada mes va del 26 del
   anterior al 25). Los informes de pauta llegan por mes calendario, así que la
   inversión de cada ciclo se arma día por día. En un mes sin cerrar, ventas e
   inversión se cortan en el último día que tienen los dos, para que el ROAS no
   compare tramos distintos.

   De 2025 hay ventas pero no inversión: se compara la venta (el mismo tramo de
   días del ciclo), nunca el ROAS.

   Expone window.Resultados.render({ ventas, gasto }).
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const { months } = ds;
  const Ciclo = global.Ciclo;

  const YEAR = 2026;
  const FUENTES = global.PautaDia.FUENTES;

  // Las líneas del cuadro: qué canales del xls mueve cada grupo de campañas.
  //   Web              campañas de compras de Meta y Google Ads, que llevan a la tienda online
  //   Redes y WhatsApp campaña de mensajes de Meta, que termina en una conversación
  //   Total digital    toda la inversión, Alcance incluido, contra toda la venta digital
  const LINEAS = {
    total: {
      label: 'Total digital', corta: 'Total digital',
      ventas: ['Web', 'WhatsApp', 'Instagram', 'Facebook'], fuentes: ['ecom', 'google', 'wa', 'reach'],
      desc: 'Toda la venta digital contra toda la inversión, Alcance incluido',
    },
    web: {
      label: 'Web', corta: 'Web',
      ventas: ['Web'], fuentes: ['ecom', 'google'],
      desc: 'Venta de la tienda online contra las campañas de compras de Meta y Google Ads',
    },
    redes: {
      label: 'Redes y WhatsApp', corta: 'Redes y WA',
      ventas: ['WhatsApp', 'Instagram', 'Facebook'], fuentes: ['wa'],
      desc: 'Venta por conversación contra la campaña de mensajes de Meta',
    },
  };
  const LINEA_KEY = 'rb-res-linea';

  // ── Formato: igual que el resto del tablero ──
  const esc   = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, dec = 0) => 'S/. ' + (n || 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtR  = n => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(1) + 'x');
  const pctSigned = n => (n >= 0 ? '+' : '−') + Math.abs(Math.round(n * 100)) + '%';
  const sum   = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
  const ratio = (a, b) => (b > 0 ? a / b : null);
  const roasClass = r => (r == null ? 'gray' : r >= 3 ? 'green' : r >= 1.5 ? 'amber' : 'red');
  const corto = m => m.slice(0, 3);
  const lista = arr => (arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`);
  const $ = id => document.getElementById(id);

  let _ventas = null;   // { meses, dias, ultimoDia, meses2025, dias2025 }
  let _gasto = null;    // data/ads-2026.json
  let _adsDia = null;   // js/pauta-dia.js
  let _linea = 'total';
  try { if (LINEAS[localStorage.getItem(LINEA_KEY)]) _linea = localStorage.getItem(LINEA_KEY); } catch (e) { /* storage bloqueado */ }

  const idx = m => months.indexOf(m);
  const periodo = m => Ciclo.periodo(YEAR, idx(m));
  const minIso = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

  // ── Cálculo de un mes para una línea ────────────────────────
  // Corte: el último día del ciclo que tienen tanto las ventas como los informes de pauta de las
  // plataformas de la línea. Sin ese corte común, el ROAS dividiría una venta de 21 días entre la
  // inversión de 22.
  function calcMes(m, L) {
    const p = periodo(m);
    const plataformas = [...new Set(L.fuentes.map(k => (k === 'google' ? 'google' : 'meta')))];
    const gastoHasta = plataformas.reduce((a, plat) => minIso(a, _adsDia?.hasta[plat]), null);
    const corte = minIso(p.fin, minIso(gastoHasta, _ventas?.ultimoDia));
    if (!corte || corte < p.inicio) return { mes: m, p, sinDatos: true };

    const dias = Ciclo.entre(p.inicio, corte) + 1;
    const completo = corte >= p.fin;

    // Venta del xls: con el ciclo completo, el total publicado del mes; parcial, día por día.
    const ventaDe = (mesData, diasData, nDias, nTope) => {
      if (completo && mesData) return sum(L.ventas, col => mesData[col]);
      if (!diasData) return null;
      return sum(L.ventas, col => {
        const arr = diasData[col] || [];
        let s = 0;
        for (let i = 0; i < Math.min(nDias, nTope ?? arr.length, arr.length); i++) s += arr[i] || 0;
        return s;
      });
    };
    const venta = ventaDe(_ventas?.meses?.[m], _ventas?.dias?.[m], dias);

    // Inversión y valor atribuido por fuente, sumando los días del ciclo hasta el corte.
    const porFuente = {};
    for (const k of L.fuentes) {
      const f = porFuente[k] = { key: k, ...FUENTES[k], spend: 0, value: 0, sinTipo: 0, dias: 0 };
      for (const d of global.PautaDia.rangeIso(p.inicio, corte)) {
        const v = _adsDia?.dias.get(d)?.[k];
        if (!v) continue;
        f.spend += v.spend;
        f.value += v.value;
        f.sinTipo += v.spendSinTipo || 0;
        f.dias++;
      }
    }
    const inv = sum(Object.values(porFuente), f => f.spend);
    const valor = sum(Object.values(porFuente), f => f.value);
    // Inversión que se agrupó por el nombre de la campaña, sin el «Tipo de resultado» del informe.
    const sinTipo = sum(Object.values(porFuente), f => f.sinTipo);

    // 2025: el mismo tramo de días del ciclo. Su ciclo puede tener otra cantidad de días (el de
    // febrero, por ejemplo), así que el tramo se recorta a lo que tenga la serie.
    const p25 = Ciclo.periodo(YEAR - 1, idx(m));
    const venta25 = completo
      ? (_ventas?.meses2025?.[m] ? sum(L.ventas, col => _ventas.meses2025[m][col]) : null)
      : ventaDe(null, _ventas?.dias2025?.[m], dias, p25.dias);

    return {
      mes: m, p, corte, dias, completo,
      venta, inv, valor, porFuente, sinTipo,
      roas: ratio(venta, inv),
      roasPlat: ratio(valor, inv),
      venta25,
      varVenta: venta25 > 0 && venta != null ? venta / venta25 - 1 : null,
    };
  }

  // Meses con algo que mostrar: inversión o venta de la línea.
  function mesesDe(L) {
    return months.map(m => calcMes(m, L)).filter(r => !r.sinDatos && (r.inv > 0 || r.venta > 0));
  }

  // Suma de las filas, para el pie del cuadro.
  function totalDe(filas, L) {
    const t = {
      venta: sum(filas, r => r.venta), inv: sum(filas, r => r.inv), valor: sum(filas, r => r.valor),
      venta25: filas.every(r => r.venta25 == null) ? null : sum(filas, r => r.venta25),
      porFuente: {},
    };
    for (const k of L.fuentes) t.porFuente[k] = { key: k, ...FUENTES[k], spend: sum(filas, r => r.porFuente[k]?.spend) };
    t.roas = ratio(t.venta, t.inv);
    t.roasPlat = ratio(t.valor, t.inv);
    t.varVenta = t.venta25 > 0 ? t.venta / t.venta25 - 1 : null;
    return t;
  }

  // ── Selector de línea ───────────────────────────────────────
  function renderSelector() {
    const el = $('res-linea-selector');
    if (!el) return;
    el.innerHTML = Object.entries(LINEAS).map(([key, L]) => {
      const on = key === _linea;
      return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}" data-linea="${key}" aria-pressed="${on}" title="${esc(L.desc)}">${esc(L.label)}</button>`;
    }).join('');
    el.querySelectorAll('[data-linea]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.linea === _linea) return;
      _linea = btn.dataset.linea;
      try { localStorage.setItem(LINEA_KEY, _linea); } catch (e) { /* storage bloqueado */ }
      renderLinea();
    }));
  }

  // ── El cuadro ───────────────────────────────────────────────
  function renderTabla(filas, L) {
    const el = $('res-tabla');
    if (!el) return;
    if (!filas.length) {
      el.innerHTML = '<div class="gp-table-empty">Sin ventas ni inversión para esta línea.</div>';
      return;
    }
    // El pie suma solo los meses con inversión en esta línea: un mes con venta y sin campaña sumaría
    // al numerador del ROAS sin poner nada en el denominador.
    const conInv = filas.filter(r => r.inv > 0);
    const base = conInv.length ? conInv : filas;
    const t = totalDe(base, L);
    const varias = L.fuentes.length > 1;

    const celdaInv = r => {
      if (!(r.inv > 0)) return '<td class="r muted">—</td>';
      const split = varias ? `<small class="sub-val">${L.fuentes
        .filter(k => r.porFuente[k]?.spend > 0)
        .map(k => `${esc(FUENTES[k].label.replace('Meta · ', '').replace(' Ads', ''))} ${money(r.porFuente[k].spend)}`)
        .join(' · ')}</small>` : '';
      return `<td class="r res-inv">${money(r.inv)}${split}${r.sinTipo > 0
        ? `<span class="pill gray res-est" title="${money(r.sinTipo)} de campañas de Meta sin «Tipo de resultado» en el informe: se agruparon por el nombre de la campaña">por nombre</span>` : ''}</td>`;
    };

    const celdaRoas = r => (r.roas == null
      ? `<td class="r muted" title="${r.inv > 0 ? 'sin venta en los canales de esta línea' : 'sin inversión en esta línea: su venta no tiene con qué dividirse'}">—</td>`
      : `<td class="r"><span class="pill ${roasClass(r.roas)}" title="${money(r.venta)} de venta real ÷ ${money(r.inv)} de inversión">${fmtR(r.roas)}</span></td>`);

    const celdaPlat = r => {
      if (r.roasPlat == null) return '<td class="r muted">—</td>';
      // Sin valor atribuido no hay ROAS de plataforma que comparar: un 0,0x se leería como que no vendió.
      if (!(r.valor > 0)) return '<td class="r muted" title="Meta y Google no atribuyeron ninguna compra a estas campañas en el mes">sin atribución</td>';
      const brecha = r.roas != null ? r.roas / r.roasPlat - 1 : null;
      return `<td class="r">${fmtR(r.roasPlat)}${brecha != null
        ? `<small class="sub-val">xls ${pctSigned(brecha)}</small>` : ''}</td>`;
    };

    const celdas25 = r => {
      const v = r.venta25 == null ? '<td class="r muted">—</td>'
        : `<td class="r">${money(r.venta25)}${r.completo ? '' : '<small class="sub-val">mismo tramo</small>'}</td>`;
      const d = r.varVenta == null ? '<td class="r muted">—</td>'
        : `<td class="r"><span class="pill ${r.varVenta >= 0 ? 'green' : 'red'}">${pctSigned(r.varVenta)}</span></td>`;
      return v + d;
    };

    const fila = r => `
      <tr${r.completo ? '' : ' class="res-parcial"'}>
        <td><div><b>${esc(r.mes)}</b><small>${Ciclo.rango(r.p.inicio, r.p.fin)}${r.completo ? ''
          : ` · al ${Ciclo.corta(r.corte)}, ${r.dias} de ${r.p.dias} días`}</small></div></td>
        <td class="r">${r.venta == null ? '<span class="muted">—</span>' : money(r.venta)}</td>
        ${celdaInv(r)}
        ${celdaRoas(r)}
        ${celdaPlat(r)}
        ${celdas25(r)}
      </tr>`;

    el.innerHTML = `
      <div class="gp-table-wrap"><table class="rep-table res-table">
        <thead><tr>
          <th>Mes · ciclo de venta</th>
          <th class="r">Venta real (xls)</th>
          <th class="r">Inversión</th>
          <th class="r">ROAS real</th>
          <th class="r" title="Valor de compra que se atribuyen Meta y Google ÷ inversión">ROAS plataforma</th>
          <th class="r">Venta 2025</th>
          <th class="r">Δ venta</th>
        </tr></thead>
        <tbody>
          ${filas.map(fila).join('')}
          <tr class="gp-total-row">
            <td><b>${base.length === 1 ? base[0].mes.toLowerCase() : `${corto(base[0].mes)} – ${corto(base[base.length - 1].mes)}`}</b>${base.length < filas.length
              ? '<small title="Los meses sin inversión en esta línea quedan fuera del total: su venta no tiene inversión con la que dividirse">solo los meses con inversión</small>' : ''}</td>
            <td class="r"><b>${money(t.venta)}</b></td>
            <td class="r"><b>${money(t.inv)}</b></td>
            <td class="r"><span class="pill ${roasClass(t.roas)}"><b>${fmtR(t.roas)}</b></span></td>
            <td class="r"><b>${fmtR(t.roasPlat)}</b></td>
            <td class="r"><b>${t.venta25 == null ? '—' : money(t.venta25)}</b></td>
            <td class="r">${t.varVenta == null ? '<b>—</b>' : `<span class="pill ${t.varVenta >= 0 ? 'green' : 'red'}"><b>${pctSigned(t.varVenta)}</b></span>`}</td>
          </tr>
        </tbody>
      </table></div>
      <p class="gp-note">${notaCuadro(filas, base, L)}</p>`;
  }

  function notaCuadro(filas, base, L) {
    const partes = [];
    partes.push(`<b>ROAS real</b> = venta de ${esc(L.ventas.join(' + '))} en la hoja de Drive ÷ inversión de ${esc(L.fuentes.map(k => FUENTES[k].label).join(', '))}, los dos por ciclo de venta.`);
    const fuera = filas.filter(r => !base.includes(r));
    if (fuera.length) partes.push(`${lista(fuera.map(r => r.mes.toLowerCase()))} ${fuera.length > 1 ? 'quedan' : 'queda'} fuera del total: hubo venta pero ninguna campaña de esta línea, así que esa venta no tiene inversión con la que dividirse.`);
    if (_linea === 'total') {
      const alcance = sum(filas, r => r.porFuente.reach?.spend);
      if (alcance > 0) partes.push(`De la inversión, ${money(alcance)} fue a <b>Alcance</b>: sostiene la marca y la Tienda física, y no tiene canal de venta digital al que atribuirse, pero se cuenta porque salió del mismo presupuesto.`);
    }
    partes.push('De 2025 hay ventas pero no informes de pauta: se compara la venta, no el ROAS.');
    const parciales = filas.filter(r => !r.completo);
    if (parciales.length) partes.push(`${lista(parciales.map(r => r.mes))} ${parciales.length > 1 ? 'están' : 'está'} sin cerrar: ventas e inversión cortadas en el último día que tienen las dos.`);
    if (L.fuentes.includes('google')) partes.push('La inversión de Google Ads en cada ciclo es estimada: su informe llega con un total por mes y sin serie diaria, y se reparte entre los días que cubre.');
    const sinTipo = filas.filter(r => r.sinTipo > 0);
    if (sinTipo.length) partes.push(`<b>Aviso:</b> en ${lista(sinTipo.map(r => r.mes.toLowerCase()))} el informe de Meta no trae «Tipo de resultado» —las hojas que escribe Nexus no traen esa columna—, así que ${money(sum(sinTipo, r => r.sinTipo))} de inversión se agrupó por el nombre de la campaña. Mientras falte esa columna, el reparto entre Web y WhatsApp de esos meses depende de cómo se llame cada campaña.`);
    return partes.join(' ');
  }

  // ── La lectura del cuadro ───────────────────────────────────
  // Los tres pasos del proceso en una línea: ROAS real por canal, la brecha con la atribución de
  // las plataformas, y qué dice el histórico.
  function renderLectura(filas, L) {
    const el = $('res-lectura');
    if (!el) return;
    const cerrados = filas.filter(r => r.completo && r.inv > 0 && r.venta != null);
    if (!cerrados.length) {
      el.innerHTML = '<div class="insight info" style="margin:0;">Todavía no hay un ciclo cerrado con ventas e inversión: el ROAS real se puede leer recién al cierre del mes.</div>';
      return;
    }
    const ult = cerrados.slice(-3);
    const t = totalDe(ult, L);
    const rango = ult.length === 1 ? ult[0].mes.toLowerCase() : `${ult[0].mes.toLowerCase()}–${ult[ult.length - 1].mes.toLowerCase()}`;

    // Comparación entre líneas: decide a qué canal subirle, así que solo vale en los meses en que
    // las dos invirtieron. Con meses distintos no es una comparación, y se dice solo la línea activa.
    const porLinea = Object.entries(LINEAS)
      .filter(([key]) => key !== 'total')
      .map(([key, otra]) => ({
        key, label: otra.label, L: otra,
        filas: mesesDe(otra).filter(r => r.completo && ult.some(u => u.mes === r.mes) && r.inv > 0 && r.venta != null),
      }));
    const comunes = porLinea.length === 2
      ? porLinea[0].filas.map(r => r.mes).filter(m => porLinea[1].filas.some(r => r.mes === m))
      : [];
    const comp = comunes.length
      ? porLinea
        .map(x => ({ ...x, roas: totalDe(x.filas.filter(r => comunes.includes(r.mes)), x.L).roas }))
        .filter(x => x.roas != null)
        .sort((a, b) => b.roas - a.roas)
      : [];
    const rangoComun = comunes.length === 1 ? comunes[0].toLowerCase()
      : `${comunes[0]?.toLowerCase()}–${comunes[comunes.length - 1]?.toLowerCase()}`;

    const cuantos = comunes.length === 1 ? 'el único mes' : `los ${comunes.length} meses`;
    const cual = comp.length === 2
      ? `En ${rangoComun}, ${cuantos} con inversión en los dos canales, <b>${esc(comp[0].label)}</b> devolvió ${fmtR(comp[0].roas)} y ${esc(comp[1].label)} ${fmtR(comp[1].roas)}: cada sol puesto en ${esc(comp[0].label)} trajo ${money(comp[0].roas - comp[1].roas, 2)} más de venta real.`
      : `En ${rango}, ${esc(L.label)} devolvió ${fmtR(t.roas)} de venta real por sol invertido.`;

    const brecha = t.roasPlat > 0 && t.roas != null
      ? ` La atribución de las plataformas marcó ${fmtR(t.roasPlat)} para esta línea: el xls está ${pctSigned(t.roas / t.roasPlat - 1)} frente a eso.`
      : '';

    const hist = t.varVenta != null
      ? ` Contra 2025, la venta de ${rango} va ${pctSigned(t.varVenta)} (${money(t.venta)} contra ${money(t.venta25)}).`
      : ' Sin ventas de 2025 para esos meses, no hay histórico con qué compararlos.';

    el.innerHTML = `<div class="insight ${t.roas >= 3 ? 'ok' : t.roas >= 1.5 ? 'info' : 'warn'}" style="margin:0;">
      <b>Lectura:</b> ${cual}${brecha}${hist}</div>`;
  }

  // ── Inversión y ROAS mes a mes ──────────────────────────────
  function renderChart(filas, L) {
    global.Charts.destroy('chart-res');
    if (!filas.length) return;
    const labels = filas.map(r => corto(r.mes) + (r.completo ? '' : '*'));
    const barras = L.fuentes.map(k => ({
      type: 'bar',
      label: FUENTES[k].label,
      data: filas.map(r => Math.round(r.porFuente[k]?.spend || 0)),
      backgroundColor: FUENTES[k].color,
      stack: 'inv',
      yAxisID: 'y',
      borderRadius: 3,
      order: 2,
    }));
    const lineas = [
      {
        type: 'line', label: 'ROAS real (xls)',
        data: filas.map(r => (r.roas == null ? null : +r.roas.toFixed(2))),
        borderColor: '#0f172a', backgroundColor: '#0f172a',
        borderWidth: 2, pointRadius: 3, tension: 0.25, spanGaps: true,
        yAxisID: 'y1', order: 0,
      },
      {
        type: 'line', label: 'ROAS plataforma',
        data: filas.map(r => (r.roasPlat == null ? null : +r.roasPlat.toFixed(2))),
        borderColor: '#94A3B8', backgroundColor: '#94A3B8',
        borderWidth: 2, borderDash: [5, 4], pointRadius: 2, tension: 0.25, spanGaps: true,
        yAxisID: 'y1', order: 1,
      },
    ];

    global.Charts.mount('chart-res', {
      data: { labels, datasets: [...barras, ...lineas] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 10 }, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: {
            callbacks: {
              label: c => `${c.dataset.label}: ${c.dataset.yAxisID === 'y1' ? fmtR(c.parsed.y) : money(c.parsed.y)}`,
              afterBody: items => {
                const r = filas[items[0].dataIndex];
                return r.completo ? '' : `Al ${Ciclo.corta(r.corte)}: ${r.dias} de ${r.p.dias} días del ciclo`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { color: '#94A3B8', font: { size: 10 } }, grid: { display: false } },
          y: {
            stacked: true, position: 'left', beginAtZero: true,
            ticks: { color: '#94A3B8', font: { size: 10 }, callback: v => 'S/. ' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' },
            grid: { color: 'rgba(15,23,42,0.06)' },
          },
          y1: {
            position: 'right', beginAtZero: true,
            ticks: { color: '#94A3B8', font: { size: 10 }, callback: v => v + 'x' },
            grid: { display: false },
          },
        },
      },
    });
  }

  // ── Render ──────────────────────────────────────────────────
  function renderLinea() {
    const L = LINEAS[_linea];
    const filas = mesesDe(L);
    const desc = $('res-linea-desc');
    if (desc) desc.textContent = L.desc;
    renderSelector();
    renderLectura(filas, L);
    renderTabla(filas, L);
    renderChart(filas, L);
  }

  function render({ ventas, gasto }) {
    _ventas = ventas || null;
    _gasto = gasto || null;
    _adsDia = global.PautaDia.build(_gasto);

    const vacio = $('res-empty');
    const body = $('res-body');
    const hayGasto = (_gasto?.months || []).length > 0;
    const hayVentas = !!_ventas?.meses;
    if (!hayGasto || !hayVentas) {
      if (vacio) {
        vacio.hidden = false;
        vacio.innerHTML = !hayVentas
          ? 'No se pudieron cargar las ventas de Drive: sin ellas no hay ROAS real que calcular.'
          : 'No se pudieron cargar los informes de pauta de Drive: sin inversión no hay ROAS que calcular.';
      }
      if (body) body.hidden = true;
      return;
    }
    if (vacio) vacio.hidden = true;
    if (body) body.hidden = false;
    renderLinea();
  }

  global.Resultados = { render, LINEAS };
})(window);
