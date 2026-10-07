/* ============================================================
   projections.js — módulo Proyecciones (ritmo del mes + recálculo de inversión)
   No tiene datos propios: los toma de otros dos módulos del tablero.
     Objetivos 2026      objetivos de la marca (data/objetivos-2026.json) y su histórico de
                         ventas por mes calendario (data/ventas-2026.json).
     Gasto publicitario  inversión y resultados de Meta Ads y Google Ads (data/ads-2026.json).
   Mide la venta digital (Web + Redes y WhatsApp, los canales que mueve la pauta) contra la
   suma de sus objetivos, por mes calendario como Gasto publicitario y Objetivos.
   Los días que quedan del mes se proyectan con el ritmo de una base que elige quien mira:
   la última semana, las 2 últimas semanas o el mes anterior completo.
   Es la pestaña «Ritmo del mes»; la de «Plan por campaña» la dibuja js/plan-campanas.js con
   los mismos datos.
   Expone window.Projections.render({ plan, ventas, gasto }).
   ============================================================ */

(function (global) {
  const ds = global.DataStatic;
  const { months, chToUpper } = ds;

  const YEAR = 2026;
  // Canales del archivo de objetivos que mueve la pauta. Si el plan no carga, se usan sus columnas habituales.
  const DIGITAL = ['Web', 'Redes'];
  const DEFAULT_SHEETS = { Web: ['Web'], Redes: ['WhatsApp', 'Instagram', 'Facebook'] };
  // Fuentes de tráfico: las campañas de Meta se agrupan por tipo de resultado (mismos colores que Gasto publicitario).
  const SOURCES = {
    ecom:   { label: 'Meta · E-Commerce', platform: 'Meta Ads',   color: '#1877F2' },
    wa:     { label: 'Meta · WhatsApp',   platform: 'Meta Ads',   color: '#25D366' },
    google: { label: 'Google Ads',        platform: 'Google Ads', color: '#4285F4' },
    reach:  { label: 'Meta · Alcance',    platform: 'Meta Ads',   color: '#E1306C' },
  };
  const SOURCE_BY_RESULT = {
    'Compras en el sitio web': 'ecom',
    'Conversaciones con mensajes iniciadas': 'wa',
  };  // Interacciones, ThruPlay y el resto van a Alcance
  // Base de la proyección: de dónde sale el ritmo diario (venta, inversión, ROAS) de los días que quedan.
  const BASES = {
    semana:   { label: 'Última semana',     short: 'últimos 7 días',  days: 7 },
    quincena: { label: 'Últimas 2 semanas', short: 'últimos 14 días', days: 14 },
    mes:      { label: 'Mes anterior',      short: 'mes anterior',    days: null },  // completo
  };
  const BASE_KEY = 'rb-proj-base';
  const laBase = () => (BASES[_base].days ? `los ${BASES[_base].short}` : 'el mes anterior');
  const delaBase = () => (BASES[_base].days ? `de los ${BASES[_base].short}` : 'del mes anterior');
  const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const axisColor = '#94A3B8';
  const gridColor = 'rgba(15,23,42,0.06)';
  const valueColor = '#f59e0b';

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
  const fmtR  = n => n.toFixed(1) + 'x';
  const pct   = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—');
  const fecha = iso => `${+iso.slice(8, 10)} ${SHORT[+iso.slice(5, 7) - 1]}`;
  const sum   = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
  const roasClass = r => (r >= 3 ? 'green' : r >= 1.5 ? 'amber' : 'red');

  let _plan = null;     // Objetivos: data/objetivos-2026.json
  let _ventas = null;   // Objetivos: { meses, semanas, dias, ultimoDia } por mes calendario
  let _gasto = null;    // Gasto publicitario: data/ads-2026.json
  let _adsDia = null;   // Gasto publicitario por día y fuente (ver adsPorDia)
  let _mes = null;
  let _base = 'semana';
  try { if (BASES[localStorage.getItem(BASE_KEY)]) _base = localStorage.getItem(BASE_KEY); } catch (e) { /* storage bloqueado */ }
  let _p = null;        // cálculo del mes activo

  // ── Calendario ──
  const monthIdx = m => months.indexOf(m);
  const monthId  = m => `${YEAR}-${String(monthIdx(m) + 1).padStart(2, '0')}`;
  const daysIn   = m => new Date(YEAR, monthIdx(m) + 1, 0).getDate();

  // Fechas ISO (YYYY-MM-DD), en UTC para no depender de la zona del navegador.
  const isoDate  = (y, mIdx, d) => new Date(Date.UTC(y, mIdx, d)).toISOString().slice(0, 10);
  const addDays  = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const lastIso  = m => isoDate(YEAR, monthIdx(m), daysIn(m));
  const minIso   = (a, b) => (a < b ? a : b);
  function rangeIso(start, end) {
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }
  const lastDayOfId = id => isoDate(+id.slice(0, 4), +id.slice(5, 7), 0);   // id YYYY-MM
  const ayerLima = () => addDays(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10), -1);

  // Días del mes cubiertos hasta la fecha ISO `end`: 0 si es de un mes anterior, el mes entero si es de uno posterior.
  function daysUpTo(m, end) {
    if (!end) return null;
    const ym = end.slice(0, 7);
    if (ym < monthId(m)) return 0;
    if (ym > monthId(m)) return daysIn(m);
    return +end.slice(8, 10);
  }

  // Días que cubre el informe de una plataforma (coverage de data/ads-2026.json).
  function coverage(block, m) {
    const c = block?.coverage || {};
    const end = c.complete ? daysIn(m) : (daysUpTo(m, c.end) ?? daysIn(m));
    const start = c.start?.slice(0, 7) === monthId(m) ? +c.start.slice(8, 10) : 1;
    return { end, days: Math.max(0, end - start + 1), endIso: c.complete ? null : c.end };
  }

  const gastoMonth = m => (_gasto?.months || []).find(x => x.id === monthId(m)) || null;

  // ── Objetivos: venta y objetivo de cada canal digital ──
  function digitalChannels(m) {
    const ventaMes = _ventas?.meses?.[m] || {};
    return DIGITAL.map(key => {
      const sheet = (_plan?.canales || []).find(x => x.key === key)?.sheet || DEFAULT_SHEETS[key];
      return {
        key, sheet,
        venta: sum(sheet, col => ventaMes[col]),
        objetivo: _plan?.metas?.[m]?.[key] || 0,
      };
    });
  }

  // ── Base de la proyección ────────────────────────────────────
  // Días de la base: los 7 o 14 que terminan en `hasta` (pueden caer en el mes anterior), o el
  // mes anterior completo.
  function baseDates(m, hasta) {
    const b = BASES[_base];
    if (!b.days) {
      const i = monthIdx(m) - 1;   // enero → diciembre del año anterior (Date.UTC lo resuelve)
      return rangeIso(isoDate(YEAR, i, 1), isoDate(YEAR, i + 1, 0));
    }
    return hasta ? rangeIso(addDays(hasta, 1 - b.days), hasta) : [];
  }

  // Último día con ventas en el histórico (sin el dato, ayer).
  const ventasHasta = () => _ventas?.ultimoDia || ayerLima();

  // Venta de un día en las columnas `cols` del histórico. Con las ventas por día es la real; si
  // el histórico no las trae, el total del mes repartido entre sus días con ventas (estimado).
  function ventaDelDia(day, cols) {
    if (day.slice(0, 4) !== String(YEAR) || day > ventasHasta()) return null;
    const m = months[+day.slice(5, 7) - 1];
    const dias = _ventas?.dias?.[m];
    if (dias) return { value: sum(cols, col => dias[col]?.[+day.slice(8, 10) - 1]), estimated: false };
    const conDatos = daysUpTo(m, ventasHasta());
    if (!_ventas?.meses?.[m] || !conDatos) return null;
    return { value: sum(cols, col => _ventas.meses[m][col]) / conDatos, estimated: true };
  }

  // Venta digital por día en la base.
  function baseVentas(m, cols) {
    const dates = baseDates(m, minIso(ventasHasta(), lastIso(m)));
    const b = { dates, value: 0, days: 0, estimated: false };
    for (const day of dates) {
      const v = ventaDelDia(day, cols);
      if (!v) continue;
      b.value += v.value;
      b.days++;
      b.estimated = b.estimated || v.estimated;
    }
    b.rate = b.days ? b.value / b.days : 0;
    return b;
  }

  // Inversión y resultados por día y fuente, de todos los informes de Gasto publicitario:
  // { dias: Map(fecha → { ecom, wa, reach, google }), hasta: { meta, google } }. Meta llega por día
  // y campaña; Google, con un total por mes que se reparte entre los días que cubre (estimado).
  // Un día cubierto sin inversión cuenta igual, en 0.
  function adsPorDia() {
    const dias = new Map();
    const hasta = { meta: null, google: null };
    const add = (day, key, v = {}, estimated = false) => {
      if (!dias.has(day)) dias.set(day, {});
      const s = dias.get(day)[key] ||= { spend: 0, value: 0, purchases: 0, conversations: 0, estimated };
      s.spend += v.spend || 0;
      s.value += v.value || 0;
      s.purchases += v.purchases || 0;
      s.conversations += v.conversations || 0;
    };
    const span = (block, id) => {
      const c = block.coverage || {};
      return { start: c.start || `${id}-01`, end: c.complete || !c.end ? lastDayOfId(id) : c.end };
    };
    for (const gm of _gasto?.months || []) {
      if (gm.meta) {
        const { start, end } = span(gm.meta, gm.id);
        const sourceOf = Object.fromEntries((gm.meta.campaigns || []).map(c => [c.campaign, SOURCE_BY_RESULT[c.resultType] || 'reach']));
        for (const day of rangeIso(start, end)) ['ecom', 'wa', 'reach'].forEach(k => add(day, k));
        for (const r of gm.meta.daily || []) {
          if (r.day < start || r.day > end) continue;
          add(r.day, sourceOf[r.campaign] || 'reach', { spend: r.spend, value: r.purchaseValue, purchases: r.purchases, conversations: r.conversations });
        }
        if (!hasta.meta || end > hasta.meta) hasta.meta = end;
      }
      if (gm.google) {
        const { start, end } = span(gm.google, gm.id);
        const days = rangeIso(start, end);
        const t = gm.google.totals || {};
        for (const day of days) {
          add(day, 'google', { spend: (t.cost || 0) / days.length, value: (t.conversionValue || 0) / days.length, purchases: (t.purchases || 0) / days.length }, true);
        }
        if (!hasta.google || end > hasta.google) hasta.google = end;
      }
    }
    return { dias, hasta };
  }

  // Ritmo de una fuente en la base: inversión por día, ROAS atribuido y costo por conversación.
  function baseFuente(m, key) {
    const ultimo = _adsDia?.hasta[key === 'google' ? 'google' : 'meta'];
    const dates = baseDates(m, ultimo ? minIso(ultimo, lastIso(m)) : null);
    const b = { dates, spend: 0, value: 0, purchases: 0, conversations: 0, days: 0, estimated: false };
    for (const day of dates) {
      const v = _adsDia?.dias.get(day)?.[key];
      if (!v) continue;
      b.days++;
      b.spend += v.spend;
      b.value += v.value;
      b.purchases += v.purchases;
      b.conversations += v.conversations;
      b.estimated = b.estimated || v.estimated;
    }
    b.rate = b.days ? b.spend / b.days : 0;
    b.roas = b.spend ? b.value / b.spend : 0;
    b.cpc = b.conversations ? b.spend / b.conversations : 0;
    return b;
  }

  // ── Gasto publicitario: fuentes de tráfico del mes ──
  function sourcesOf(m) {
    const gm = gastoMonth(m);
    const dias = daysIn(m);
    const out = {};
    for (const key of Object.keys(SOURCES)) {
      out[key] = {
        key, ...SOURCES[key],
        spend: 0, value: 0, purchases: 0, conversations: 0, impressions: 0, clicks: 0,
        results: {}, campaigns: 0, daily: null, days: 0, end: 0, endIso: null, hasReport: false,
      };
    }

    const meta = gm?.meta;
    if (meta) {
      const cov = coverage(meta, m);
      const sourceOf = {};
      for (const c of meta.campaigns || []) {
        const s = out[SOURCE_BY_RESULT[c.resultType] || 'reach'];
        sourceOf[c.campaign] = s.key;
        s.campaigns++;
        s.spend += c.spend || 0;
        s.value += c.purchaseValue || 0;
        s.purchases += c.purchases || 0;
        s.conversations += c.conversations || 0;
        s.impressions += c.impressions || 0;
        s.clicks += c.linkClicks || 0;
        // Los resultados de tipos distintos no se suman entre sí
        const byType = c.resultType === 'mixto' ? (c.resultsByType || {}) : (c.resultType ? { [c.resultType]: c.results } : {});
        for (const [type, n] of Object.entries(byType)) if (n) s.results[type] = (s.results[type] || 0) + n;
      }
      // Serie diaria real por fuente (Meta llega por día y campaña)
      for (const key of ['ecom', 'wa', 'reach']) {
        Object.assign(out[key], cov, { hasReport: true });
        out[key].daily = Array.from({ length: cov.end }, () => ({ spend: 0, value: 0, conversations: 0 }));
      }
      for (const r of meta.daily || []) {
        const d = +r.day.slice(8, 10);
        const row = out[sourceOf[r.campaign] || 'reach'].daily[d - 1];
        if (!row || r.day.slice(0, 7) !== monthId(m)) continue;
        row.spend += r.spend || 0;
        row.value += r.purchaseValue || 0;
        row.conversations += r.conversations || 0;
      }
    }

    const g = gm?.google;
    if (g) {
      const t = g.totals || {};
      Object.assign(out.google, coverage(g, m), {
        hasReport: true,
        spend: t.cost || 0, value: t.conversionValue || 0, purchases: t.purchases || 0,
        clicks: t.clicks || 0, impressions: t.impressions || 0, cpc: t.cpc,
        campaigns: (g.campaigns || []).length,
        // Presupuesto diario configurado en las campañas habilitadas (dato del informe)
        budget: sum((g.campaigns || []).filter(c => /habilitad/i.test(c.status || '')), c => c.dailyBudget),
      });
    }

    for (const s of Object.values(out)) {
      s.rateMes = s.days > 0 ? s.spend / s.days : 0;         // inversión por día en lo que va del mes
      s.roas = s.spend > 0 ? s.value / s.spend : 0;          // del mes, atribución de cada plataforma
      s.base = baseFuente(m, s.key);
      s.rate = s.base.rate;                                  // ritmo con el que se proyecta
      s.left = Math.max(0, dias - s.end);                    // días que le faltan al informe
      s.projSpend = s.spend + s.rate * s.left;
    }
    return out;
  }

  // ── Cálculo del mes ──────────────────────────────────────────
  function calcMes(m) {
    if (!m) return null;
    const diasEnMes = daysIn(m);
    const canales = digitalChannels(m);
    const fuentes = sourcesOf(m);
    const lista = Object.values(fuentes);

    const ventas   = sum(canales, c => c.venta);
    const objTotal = sum(canales, c => c.objetivo);
    const diasConDatos  = daysUpTo(m, ventasHasta());
    const diasRestantes = Math.max(0, diasEnMes - diasConDatos);

    // Ritmo de la base elegida: venta digital e inversión por día
    const baseV = baseVentas(m, canales.flatMap(c => c.sheet));
    const gastoTotal      = sum(lista, s => s.spend);
    const tasaGastoDia    = sum(lista, s => s.rate);
    const gastoProyectado = sum(lista, s => s.projSpend);
    const tasaVentasDia   = baseV.rate;
    // ROAS de la marca en la base: venta digital del histórico ÷ inversión, con las tasas diarias
    // por si las ventas y los informes de pauta llegan hasta días distintos.
    const roasMarca = tasaGastoDia > 0 ? tasaVentasDia / tasaGastoDia : 0;

    const ventasProyectadas = ventas + tasaVentasDia * diasRestantes;
    const brecha = ventasProyectadas - objTotal;

    // Inversión diaria para cerrar la brecha en los días que quedan, al ROAS de la marca
    let presupuestoDiarioNecesario = null;
    let inversAdicionalDia = null;
    if (diasRestantes > 0 && roasMarca > 0 && objTotal > 0 && brecha < 0) {
      inversAdicionalDia = (objTotal - ventasProyectadas) / roasMarca / diasRestantes;
      presupuestoDiarioNecesario = tasaGastoDia + inversAdicionalDia;
    }

    return {
      mes: m, diasEnMes, diasConDatos, diasRestantes,
      canales, fuentes, hasGasto: !!gastoMonth(m), baseV,
      ventas, objTotal, gastoTotal, gastoProyectado, tasaGastoDia, tasaVentasDia, roasMarca,
      ventasProyectadas, brecha, presupuestoDiarioNecesario, inversAdicionalDia,
    };
  }

  // ── Meses: los que tienen informes de pauta o ventas ──
  const hasVentas = m => digitalChannels(m).some(c => c.venta > 0);
  const available = m => !!gastoMonth(m) || hasVentas(m);

  function defaultMes() {
    const today = new Date();
    const actual = today.getFullYear() === YEAR ? months[today.getMonth()] : null;
    if (actual && available(actual)) return actual;
    return [...months].reverse().find(available) || null;
  }

  function renderMesSelector() {
    const el = document.getElementById('proj-mes-selector');
    if (!el) return;
    el.innerHTML = months.map(m => {
      const ok = available(m);
      const on = m === _mes;
      return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}${ok ? '' : ' sin-datos'}" data-mes="${m}"
        aria-pressed="${on}"${ok ? '' : ' disabled'} title="${m} ${YEAR}${ok ? '' : ' · sin datos'}">${m.slice(0, 3)}</button>`;
    }).join('');
    el.querySelectorAll('.proj-mes-btn:not(.sin-datos)').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.mes === _mes) return;
      _mes = btn.dataset.mes;
      el.querySelectorAll('.proj-mes-btn').forEach(b => {
        const on = b.dataset.mes === _mes;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      renderMes();
    }));
  }

  // ── Periodo y fuentes de datos ───────────────────────────────
  function renderPeriodo(p) {
    const el = document.getElementById('proj-periodo');
    if (!el) return;
    if (!p) { el.textContent = ''; return; }
    el.innerHTML = p.diasRestantes === 0
      ? `${p.mes} ${YEAR} · <b>mes cerrado</b>`
      : p.diasConDatos === 0
        ? `${p.mes} ${YEAR} · aún sin ventas registradas`
        : `${p.mes} ${YEAR} · día ${p.diasConDatos} de ${p.diasEnMes} · <b>quedan ${p.diasRestantes} días</b>`;
  }

  // ── Selector de base ─────────────────────────────────────────
  function renderBase(p) {
    const el = document.getElementById('proj-base-selector');
    const info = document.getElementById('proj-base-rango');
    if (!el) return;
    const cerrado = !p || p.diasRestantes === 0;
    el.innerHTML = Object.entries(BASES).map(([key, b]) => {
      const on = key === _base;
      return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}" data-base="${key}" aria-pressed="${on}"${cerrado ? ' disabled' : ''}
        title="Proyectar con ${b.days ? `el ritmo de los ${b.short}` : 'el ritmo del mes anterior completo'}">${b.label}</button>`;
    }).join('');
    el.querySelectorAll('[data-base]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.base === _base) return;
      _base = btn.dataset.base;
      try { localStorage.setItem(BASE_KEY, _base); } catch (e) { /* storage bloqueado */ }
      renderMes();
    }));
    if (info) info.innerHTML = !p ? '' : cerrado ? 'Mes cerrado: se muestra el cierre real, sin proyección.' : baseText(p);
  }

  // Qué días entran en la base de cada dato y qué se estimó.
  function baseText(p) {
    const parcial = !!BASES[_base].days;
    const rango = dates => {
      if (!dates.length) return 'sin fechas';
      if (parcial) return `del ${fecha(dates[0])} al ${fecha(dates[dates.length - 1])}`;
      const y = dates[0].slice(0, 4);
      return `de ${months[+dates[0].slice(5, 7) - 1].toLowerCase()}${y !== String(YEAR) ? ' ' + y : ''} completo`;
    };
    const v = p.baseV;
    const meta = p.fuentes.ecom.base;
    const google = p.fuentes.google.base;
    const igual = [meta, google].every(x => x.dates[0] === v.dates[0] && x.dates[x.dates.length - 1] === v.dates[v.dates.length - 1]);
    const partes = igual
      ? [`Ritmo ${rango(v.dates)}: ventas, Meta Ads y Google Ads`]
      : [`Ventas ${rango(v.dates)}`, `Meta Ads ${rango(meta.dates)}`, `Google Ads ${rango(google.dates)}`];
    const avisos = [['ventas', v], ['Meta Ads', meta], ['Google Ads', google]]
      .filter(([, x]) => x.days < x.dates.length)
      .map(([n, x]) => `${n}: ${x.days} de ${x.dates.length} días con datos`);
    if (parcial && v.estimated) avisos.push('ventas repartidas por día desde el total del mes');
    if (parcial && google.estimated) avisos.push('Google Ads repartido por día desde su total del mes');
    return `${partes.join(' · ')}${avisos.length ? ` <span class="muted">· ${avisos.join(' · ')}</span>` : ''}`;
  }

  // Enlace a un módulo del sidebar (Objetivos 2026 o Gasto publicitario)
  const goto = (view, text) => `<button type="button" class="btn ghost btn-sm" data-goto="${view}">${text}</button>`;

  function renderFuentesDatos(p) {
    const el = document.getElementById('proj-fuentes');
    if (!el) return;
    if (!p) { el.innerHTML = ''; return; }
    const mes = p.mes.toLowerCase();

    const metas = _plan?.meses || [];
    const hayObjetivo = p.objTotal > 0;
    const ultimo = _ventas?.ultimoDia;
    const ventasTxt = p.diasConDatos === p.diasEnMes ? `venta de ${mes} completa`
      : ultimo && daysUpTo(p.mes, ultimo) > 0 ? `venta al ${fecha(ultimo)}` : `sin ventas de ${mes}`;
    const objetivoTxt = hayObjetivo
      ? `objetivo de ${mes} del archivo «${esc(_plan?.fuente?.archivo?.nombre || 'Objetivos Royal Baby')}»`
      : metas.length ? `sin objetivo para ${mes}: el archivo cubre ${metas[0].toLowerCase()} – ${metas[metas.length - 1].toLowerCase()}`
      : 'no se pudo cargar el archivo de objetivos';

    const plat = (name, s) => !s.hasReport ? `${name}: sin informe de ${mes}`
      : s.endIso ? `${name} al ${fecha(s.endIso)}` : `${name} con ${mes} completo`;
    const gastoTxt = !_gasto ? 'no se pudieron cargar los informes de pauta'
      : !p.hasGasto ? `sin informes de pauta de ${mes}`
      : `${plat('Meta Ads', p.fuentes.ecom)} · ${plat('Google Ads', p.fuentes.google)}`;
    const gastoOk = p.fuentes.ecom.hasReport && p.fuentes.google.hasReport;

    el.innerHTML = `
      <div class="gp-source">
        <div class="gp-source-l">
          <span class="gp-dot ${hayObjetivo && p.ventas > 0 ? 'ok' : 'warn'}"></span>
          <span class="proj-src-text"><b>Objetivos 2026</b> · ventas y objetivos<small>${ventasTxt} · ${objetivoTxt}</small></span>
        </div>
        ${goto('view-obj', 'Ver módulo')}
      </div>
      <div class="gp-source">
        <div class="gp-source-l">
          <span class="gp-dot ${gastoOk ? 'ok' : 'warn'}"></span>
          <span class="proj-src-text"><b>Gasto publicitario</b> · inversión y resultados<small>${gastoTxt}</small></span>
        </div>
        ${goto('view-rep', 'Ver módulo')}
      </div>`;
    el.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelector(`.s-item[data-view="${btn.dataset.goto}"]`)?.click();
    }));
  }

  // ── KPIs ─────────────────────────────────────────────────────
  function renderKpis(p) {
    const el = document.getElementById('kpi-proj');
    if (!el) return;
    if (!p) {
      el.innerHTML = '<div class="insight info" style="grid-column:1/-1;margin:0;">Todavía no hay ventas ni informes de pauta de 2026 para proyectar.</div>';
      return;
    }
    const pill = (label, src, value, subs) => `
      <div class="kpi-pill">
        <span class="proj-kpi-label">${label}${src ? ` <em>· ${src}</em>` : ''}</span>
        <strong>${value}</strong>
        ${subs.filter(Boolean).map(s => `<small>${s}</small>`).join('')}
      </div>`;
    const [web, redes] = p.canales;
    const f = p.fuentes;
    const meta = f.ecom.spend + f.wa.spend + f.reach.spend;
    const ok = p.brecha >= 0;
    const cerrado = p.diasRestantes === 0;
    const base = BASES[_base].short;
    const roasMes = p.gastoTotal > 0 ? p.ventas / p.gastoTotal : 0;

    el.innerHTML = [
      pill('Venta digital', 'Objetivos', money(p.ventas), [
        `Web ${money(web.venta)} · Redes y WhatsApp ${money(redes.venta)}`,
        cerrado ? `${money(p.ventas / p.diasEnMes)}/día en promedio` : `Ritmo ${money(p.tasaVentasDia)}/día · ${base}`,
      ]),
      pill('Objetivo del mes', 'Objetivos', p.objTotal > 0 ? money(p.objTotal) : '—', p.objTotal > 0 ? [
        `Web ${money(web.objetivo)} · Redes y WhatsApp ${money(redes.objetivo)}`,
        `${pct(p.ventas, p.objTotal)} cubierto a la fecha`,
      ] : ['El archivo de objetivos no tiene este mes']),
      pill('Inversión publicitaria', 'Gasto publicitario', p.hasGasto ? money(p.gastoTotal) : '—', p.hasGasto ? [
        `Meta ${money(meta)} · Google ${money(f.google.spend)}`,
        cerrado ? `${money(p.gastoTotal / p.diasEnMes)}/día en promedio` : `Ritmo ${money(p.tasaGastoDia)}/día · al cierre ${money(p.gastoProyectado)}`,
      ] : ['Sin informes de pauta del mes']),
      pill(cerrado ? 'Cierre del mes' : 'Proyección al cierre', cerrado ? '' : base, money(p.ventasProyectadas), [
        p.objTotal > 0
          ? `<b style="color:${ok ? 'var(--green-text)' : 'var(--red-text)'}">${signed(p.brecha)} vs objetivo · ${pct(p.ventasProyectadas, p.objTotal)}</b>`
          : 'sin objetivo para comparar',
        cerrado
          ? (roasMes > 0 ? `ROAS de la marca ${fmtR(roasMes)} (venta digital ÷ inversión)` : '')
          : (p.roasMarca > 0 ? `ROAS de la marca ${fmtR(p.roasMarca)} en la base (venta digital ÷ inversión)` : ''),
      ]),
    ].join('');
  }

  // ── Recálculo de inversión ───────────────────────────────────
  function renderRecalculo(p) {
    const el = document.getElementById('proj-recalculo');
    if (!el) return;
    if (!p) { el.hidden = true; return; }
    el.hidden = false;

    const box = (icon, html) => `<div class="recalc-box cerrado"><span class="recalc-icon">${icon}</span><div>${html}</div></div>`;
    if (!p.objTotal) {
      el.innerHTML = box('—', `<strong>Sin objetivo.</strong> ${p.mes} no está en el archivo de objetivos de la marca: no hay brecha que recalcular.`);
      return;
    }
    if (p.diasRestantes === 0) {
      el.innerHTML = box(p.brecha >= 0 ? '✓' : '—', `<strong>Mes cerrado.</strong> Venta digital ${money(p.ventas)} vs objetivo ${money(p.objTotal)} (${pct(p.ventas, p.objTotal)})${p.hasGasto ? `, con ${money(p.gastoTotal)} de inversión` : ''}.`);
      return;
    }
    if (!p.tasaGastoDia) {
      el.innerHTML = box('—', `<strong>Sin inversión en la base.</strong> Gasto publicitario no registra inversión en ${laBase()}: no se puede recalcular el presupuesto.`);
      return;
    }

    // .recalc-item pinta sus <span> como etiqueta: el color del valor va en el <strong>
    const items = rows => `<div class="recalc-row">${rows.map(([label, value, color, cls]) =>
      `<div class="recalc-item${cls ? ' ' + cls : ''}"><span>${label}</span><strong${color ? ` style="color:${color}"` : ''}>${value}</strong></div>`).join('')}</div>`;

    if (p.brecha >= 0) {
      el.innerHTML = `<div class="recalc-box verde">${items([
        ['Inversión diaria', `${money(p.tasaGastoDia)}/día`],
        ['Venta digital/día', `${money(p.tasaVentasDia)}/día`],
        ['Proyección al cierre', money(p.ventasProyectadas), 'var(--green-text)'],
        ['Objetivo del mes', money(p.objTotal)],
        ['Superávit estimado', signed(p.brecha), 'var(--green-text)'],
      ])}</div>`;
      return;
    }

    const faltan = p.objTotal - p.ventasProyectadas;
    el.innerHTML = `<div class="recalc-box alerta">${items([
      ['Inversión diaria', `${money(p.tasaGastoDia)}/día`],
      ['Días restantes', `${p.diasRestantes} días`],
      ['Faltan al cierre', money(faltan), 'var(--red-text)'],
      ['ROAS de la marca', p.roasMarca > 0 ? fmtR(p.roasMarca) : '—'],
      ['Inversión recomendada', p.presupuestoDiarioNecesario != null
        ? `${money(p.presupuestoDiarioNecesario)}/día <em>(+${money(p.inversAdicionalDia)})</em>` : '—',
        'var(--brand)', 'recalc-item-recom'],
    ])}
      <p class="recalc-note">${p.roasMarca > 0
        ? `Con el ritmo ${delaBase()} la venta digital cierra en ${money(p.ventasProyectadas)}. Supone que cada sol adicional rinde el ROAS de la marca de esa base (${fmtR(p.roasMarca)}).`
        : `Sin venta digital en ${laBase()}: no hay ROAS con el que recalcular la inversión.`}</p>
    </div>`;
  }

  // ── Tarjetas por fuente de tráfico ───────────────────────────
  function renderFuentes(p) {
    const el = document.getElementById('proj-channels');
    if (!el) return;
    global.Charts.destroy('chart-src-ecom');
    global.Charts.destroy('chart-src-wa');
    global.Charts.destroy('chart-src-google');
    global.Charts.destroy('chart-src-reach');
    if (!p) { el.innerHTML = ''; return; }

    const f = p.fuentes;
    const [web, redes] = p.canales;
    const costPer = (spend, n) => (n > 0 ? money(spend / n, 2) : '—');
    const resultados = Object.entries(f.reach.results).sort((a, b) => b[1] - a[1]).slice(0, 2);

    el.innerHTML = [
      cardHTML(f.ecom, p, {
        badge: roasBadge(f.ecom, 'Meta'),
        value: money(f.ecom.value), valueSub: 'valor de compras atribuido por Meta',
        stats: [['Compras', num(f.ecom.purchases)], ['Costo / compra', costPer(f.ecom.spend, f.ecom.purchases)], ['Venta Web', money(web.venta)]],
        chart: true,
      }),
      cardHTML(f.wa, p, {
        badge: f.wa.conversations > 0 ? `<span class="proj-ch-badge gray">${costPer(f.wa.spend, f.wa.conversations)} / conv.</span>` : '',
        value: num(f.wa.conversations), valueSub: 'conversaciones iniciadas',
        stats: [['Compras atribuidas', num(f.wa.purchases)], ['Valor atribuido', money(f.wa.value)], ['Venta Redes y WA', money(redes.venta)]],
        chart: true,
      }),
      cardHTML(f.google, p, {
        badge: roasBadge(f.google, 'Google'),
        value: money(f.google.value), valueSub: 'valor de conversión atribuido por Google',
        stats: [['Compras', num(f.google.purchases)], ['Clics', num(f.google.clicks)], ['CPC prom.', f.google.cpc != null ? money(f.google.cpc, 2) : '—']],
        chart: true, chartNote: 'Inversión por mes: Google Ads llega con un total por mes, sin serie diaria.',
      }),
      cardHTML(f.reach, p, {
        badge: '<span class="proj-ch-badge gray">Awareness</span>',
        value: money(f.reach.spend), valueSub: 'inversión en alcance e interacción',
        stats: [['Impresiones', num(f.reach.impressions)], ...resultados.map(([type, n]) => [type, num(n)])],
        chart: true, slider: false,
      }),
    ].join('');

    for (const s of Object.values(f)) {
      if (!s.spend) continue;
      if (s.key === 'google') mountGoogleChart(s);
      else mountDailyChart(s);
      wireSlider(s, p);
    }
  }

  function roasBadge(s, quien) {
    if (!s.spend) return '';
    if (!s.value) return `<span class="proj-ch-badge gray">${s.purchases ? 'compras sin valor' : 'sin compras'}</span>`;
    return `<span class="proj-ch-badge ${roasClass(s.roas)}" title="Atribución de ${quien}">ROAS ${fmtR(s.roas)}</span>`;
  }

  function cardHTML(s, p, { badge, value, valueSub, stats, chart, chartNote, slider = true }) {
    const head = `
      <div class="proj-ch-header">
        <span class="proj-ch-pip" style="background:${s.color};"></span>
        <span class="proj-ch-name">${s.label}</span>
        ${badge || ''}
      </div>`;
    if (!s.spend) {
      return `<div class="proj-ch-card is-empty">${head}
        <div class="proj-ch-empty">${s.hasReport ? `Sin inversión en ${p.mes.toLowerCase()}.` : `${s.platform}: sin informe de ${p.mes.toLowerCase()} en Gasto publicitario.`}</div>
      </div>`;
    }
    const google = s.key === 'google';
    const cerrado = p.diasRestantes === 0;
    const detalle = [
      `Inversión ${money(s.spend)}`,
      `${money(s.rateMes)}/día en ${cerrado ? 'promedio' : 'el mes'}`,
      google && s.budget ? `presupuesto configurado ${money(s.budget)}/día` : `${s.campaigns} campaña${s.campaigns === 1 ? '' : 's'}`,
    ].join(' · ');
    // Ritmo con el que se proyecta: el de la base elegida
    const b = s.base;
    const ritmo = !b.days ? 'sin datos'
      : [`${money(s.rate)}/día`,
        s.key === 'wa' ? (b.cpc ? `${money(b.cpc, 2)} por conversación` : 'sin conversaciones')
          : s.key === 'reach' ? '' : (b.roas ? `ROAS ${fmtR(b.roas)}` : 'sin compras atribuidas'),
      ].filter(Boolean).join(' · ');
    const conSlider = slider && s.left > 0;
    const max = Math.max(10, Math.ceil(s.rate * 3));
    return `
      <div class="proj-ch-card" data-src="${s.key}">
        ${head}
        <div class="proj-ch-val">${value} <small>${valueSub}</small></div>
        <div class="proj-ch-sub">${detalle}</div>
        ${cerrado ? '' : `<div class="proj-ch-base"><span>Base · ${BASES[_base].short}</span>${ritmo}</div>`}
        <div class="proj-ch-stats">
          ${stats.map(([label, val]) => `<div class="proj-ch-stat"><span>${esc(label)}</span><strong>${val}</strong></div>`).join('')}
        </div>
        ${chart ? `<div class="proj-src-chart-wrap"><canvas id="chart-src-${s.key}" role="img" aria-label="${google ? 'Inversión mensual en Google Ads' : `Inversión diaria de ${s.label}`}"></canvas></div>` : ''}
        ${chartNote ? `<p class="proj-chart-note">${chartNote}</p>` : ''}
        ${conSlider ? `
        <div class="proj-slider-wrap">
          <div class="proj-slider-label">
            <label for="slider-${s.key}">Inversión diaria los ${s.left} días que quedan</label>
            <strong id="slider-val-${s.key}"></strong>
          </div>
          <input type="range" class="proj-slider" id="slider-${s.key}" min="0" max="${max}" step="1" value="${Math.round(s.rate)}">
          <div class="proj-slider-result" id="slider-result-${s.key}" aria-live="polite"></div>
        </div>` : ''}
      </div>`;
  }

  // Inversión diaria real de Meta, con el valor atribuido (E-Commerce) o las conversaciones (WhatsApp).
  function mountDailyChart(s) {
    if (!s.daily?.length) return;
    const extra = s.key === 'ecom' ? { label: 'Valor atribuido', field: 'value', isCount: false }
      : s.key === 'wa' ? { label: 'Conversaciones', field: 'conversations', isCount: true } : null;
    const datasets = [{
      type: 'bar', label: 'Inversión', data: s.daily.map(d => d.spend), backgroundColor: s.color + 'B3',
      borderRadius: { topLeft: 3, topRight: 3 }, maxBarThickness: 10, yAxisID: 'y', order: 2,
    }];
    if (extra && s.daily.some(d => d[extra.field] > 0)) {
      datasets.push({
        type: 'line', label: extra.label, data: s.daily.map(d => d[extra.field]),
        borderColor: valueColor, backgroundColor: valueColor, borderWidth: 1.5, pointRadius: 1.5,
        cubicInterpolationMode: 'monotone', yAxisID: 'y2', order: 1,
      });
    }
    const dos = datasets.length > 1;
    const fmtY2 = v => (extra.isCount ? num(v) : money(v));
    global.Charts.mount(`chart-src-${s.key}`, {
      type: 'bar',
      data: { labels: s.daily.map((_, i) => i + 1), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: dos, position: 'top', align: 'end', labels: { boxWidth: 8, font: { size: 9 } } },
          tooltip: { callbacks: {
            title: items => `Día ${items[0].label}`,
            label: ctx => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'y2' ? fmtY2(ctx.raw) : money(ctx.raw, 2)}`,
          } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisColor, font: { size: 8 }, maxRotation: 0, autoSkipPadding: 6 } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 8 }, maxTicksLimit: 4, callback: fmtS }, grid: { color: gridColor } },
          ...(dos ? { y2: { position: 'right', beginAtZero: true, grid: { display: false },
            ticks: { color: axisColor, font: { size: 8 }, maxTicksLimit: 4, callback: v => (extra.isCount ? num(v) : fmtS(v)) } } } : {}),
        },
      },
    });
  }

  // Google Ads no tiene serie diaria: inversión de cada mes, con el mes elegido resaltado.
  function mountGoogleChart(s) {
    const list = (_gasto?.months || []).filter(x => x.google && x.id.startsWith(String(YEAR)));
    if (!list.length) return;
    const sel = monthId(_mes);
    global.Charts.mount('chart-src-google', {
      type: 'bar',
      data: {
        labels: list.map(x => SHORT[+x.id.slice(5, 7) - 1]),
        datasets: [{
          label: 'Inversión', data: list.map(x => x.google.totals?.cost || 0),
          backgroundColor: list.map(x => (x.id === sel ? s.color : s.color + '40')),
          borderRadius: { topLeft: 3, topRight: 3 }, maxBarThickness: 18,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => list[items[0].dataIndex].label,
            label: ctx => ` Inversión: ${money(ctx.raw)}`,
            footer: items => { const t = list[items[0].dataIndex].google.totals || {}; return `Compras: ${num(t.purchases)} · Valor ${money(t.conversionValue)}`; },
          } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: ctx => (list[ctx.index]?.id === sel ? '#06132b' : axisColor), font: { size: 9 } } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 8 }, maxTicksLimit: 4, callback: fmtS }, grid: { color: gridColor } },
        },
      },
    });
  }

  // Simulador: cambia la inversión diaria de una fuente los días que le quedan al mes. El efecto
  // se mide con el ROAS (o el costo por conversación) de la base elegida.
  function wireSlider(s, p) {
    const slider = document.getElementById(`slider-${s.key}`);
    const valEl  = document.getElementById(`slider-val-${s.key}`);
    const resEl  = document.getElementById(`slider-result-${s.key}`);
    if (!slider || !resEl) return;
    const base = +slider.value;   // posición inicial = ritmo de la base (redondeado al sol)

    const update = () => {
      const diario = +slider.value;
      valEl.textContent = `${money(diario)}/día`;
      const extraGasto = (diario - base) * s.left;
      const color = extraGasto > 0 ? 'var(--green-text)' : 'var(--red-text)';
      const delta = text => (extraGasto ? `<span style="color:${color};font-weight:600;">${text} vs el ritmo de la base</span>` : '<span>al ritmo de la base</span>');

      // WhatsApp: su resultado son conversaciones, al costo por conversación de la base
      if (s.key === 'wa') {
        const cpc = s.base.cpc;
        if (!cpc) { resEl.innerHTML = `<span>Sin conversaciones en ${laBase()}: no hay costo por conversación para estimar.</span>`; return; }
        const alCierre = s.conversations + (s.rate * s.left + extraGasto) / cpc;
        resEl.innerHTML = `<span>Conversaciones al cierre</span><strong>${num(alCierre)}</strong>
          ${delta(`${extraGasto > 0 ? '+' : '−'}${num(Math.abs(extraGasto / cpc))}`)}
          <span class="proj-slider-pct">${money(cpc, 2)} por conversación</span>`;
        return;
      }

      const roas = s.base.roas;
      if (!roas) { resEl.innerHTML = `<span>Sin compras atribuidas en ${laBase()}: no hay ROAS para estimar la venta.</span>`; return; }
      const extraVentas = extraGasto * roas;
      const proy = p.ventasProyectadas + extraVentas;
      resEl.innerHTML = `<span>Venta digital al cierre</span><strong>${money(proy)}</strong>
        ${delta(signed(extraVentas))}
        <span class="proj-slider-pct">${p.objTotal > 0 ? `${pct(proy, p.objTotal)} del objetivo` : `ROAS ${fmtR(roas)}`}</span>`;
    };

    slider.addEventListener('input', update);
    update();
  }

  // ── Gráfico: venta digital acumulada vs objetivo ─────────────
  // Día en que termina cada semana del histórico (las semanas del mes empiezan en lunes).
  function weekEnds(m) {
    const ends = [];
    for (let d = 1; d <= daysIn(m); d++) {
      const nextIsMonday = new Date(YEAR, monthIdx(m), d + 1).getDay() === 1;
      if (nextIsMonday || d === daysIn(m)) ends.push(d);
    }
    return ends;
  }

  function renderChartRitmo(p) {
    if (!p) { global.Charts.destroy('chart-proj-ritmo'); return; }
    const sheet = p.canales.flatMap(c => c.sheet);
    const cols = sheet.map(col => chToUpper[col] || col.toUpperCase());
    const dias = _ventas?.dias?.[p.mes];
    const semanas = _ventas?.semanas?.[p.mes] || [];
    const ends = weekEnds(p.mes);

    // Real: acumulado del histórico de Objetivos hasta el último día con ventas; por día si el
    // histórico trae las ventas diarias, si no al cierre de cada semana.
    const real = [{ x: 0, y: 0 }];
    if (dias) {
      let acc = 0;
      for (let d = 1; d <= p.diasConDatos; d++) {
        acc += sum(sheet, col => dias[col]?.[d - 1]);
        real.push({ x: d, y: Math.round(acc) });
      }
    } else if (semanas.length) {
      let acc = 0;
      for (const w of semanas) {
        const end = Math.min(ends[w.w - 1] || p.diasEnMes, p.diasConDatos);
        const start = w.w === 1 ? 1 : (ends[w.w - 2] || 0) + 1;
        if (start > p.diasConDatos) break;
        acc += sum(cols, col => w[col]);
        real.push({ x: end, y: Math.round(acc) });
      }
    } else if (p.diasConDatos) {
      real.push({ x: p.diasConDatos, y: Math.round(p.ventas) });
    }
    const last = real[real.length - 1];
    const datasets = [{
      label: 'Venta digital acumulada', data: real, borderColor: '#2563eb', backgroundColor: '#2563eb',
      borderWidth: 2.5, pointRadius: dias ? 0 : 3, pointHoverRadius: 5, cubicInterpolationMode: 'monotone', order: 1,
    }];
    if (p.diasRestantes > 0) {
      datasets.push({
        label: `Proyección · ${BASES[_base].short}`, data: [last, { x: p.diasEnMes, y: Math.round(p.ventasProyectadas) }],
        borderColor: '#2563eb', borderWidth: 2, borderDash: [5, 4], pointRadius: [0, 3], tension: 0, order: 2,
      });
    }
    if (p.objTotal > 0) {
      datasets.push({
        label: 'Objetivo (prorrateado por día)', data: [{ x: 0, y: 0 }, { x: p.diasEnMes, y: Math.round(p.objTotal) }],
        borderColor: valueColor, borderWidth: 2, pointRadius: 0, tension: 0, order: 3,
      });
    }

    global.Charts.mount('chart-proj-ritmo', {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: {
            title: items => `Día ${items[0].parsed.x} de ${p.mes.toLowerCase()}`,
            label: ctx => ` ${ctx.dataset.label}: ${money(ctx.parsed.y)}`,
          } },
        },
        scales: {
          x: { type: 'linear', min: 0, max: p.diasEnMes, grid: { display: false },
            ticks: { color: axisColor, font: { size: 9 }, stepSize: 5, callback: v => (v === 0 ? '' : v) },
            title: { display: true, text: 'Día del mes', color: axisColor, font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: fmtS }, grid: { color: gridColor } },
        },
      },
    });
  }

  // ── Gráfico: inversión vs valor atribuido por fuente ─────────
  function renderChartFuentes(p) {
    if (!p) { global.Charts.destroy('chart-proj-fuentes'); return; }
    const lista = Object.values(p.fuentes);
    global.Charts.mount('chart-proj-fuentes', {
      type: 'bar',
      data: {
        labels: lista.map(s => s.label),
        datasets: [
          { label: 'Inversión', data: lista.map(s => s.spend), backgroundColor: lista.map(s => s.color + '44'),
            borderColor: lista.map(s => s.color), borderWidth: 1, borderRadius: 4 },
          { label: 'Valor atribuido', data: lista.map(s => s.value), backgroundColor: lista.map(s => s.color + 'BB'), borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${money(ctx.raw || 0)}`,
            footer: items => { const s = lista[items[0].dataIndex]; return s.spend && s.value ? `ROAS ${fmtR(s.roas)} · atribución de ${s.platform}` : ''; },
          } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisColor, font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: fmtS }, grid: { color: gridColor } },
        },
      },
    });
  }

  // ── Render del mes activo ────────────────────────────────────
  function renderMes() {
    _p = calcMes(_mes);
    renderPeriodo(_p);
    renderBase(_p);
    renderFuentesDatos(_p);
    renderKpis(_p);
    renderRecalculo(_p);
    renderFuentes(_p);
    renderChartRitmo(_p);
    renderChartFuentes(_p);
  }

  function renderRitmo() {
    if (!_mes || !available(_mes)) _mes = defaultMes();
    renderMesSelector();
    renderMes();
  }

  // ── Pestañas: Ritmo del mes y Plan por campaña (js/plan-campanas.js) ──
  // Cada una se dibuja con su panel visible (los charts miden su contenedor) y solo cuando
  // llegan datos nuevos; al volver a una ya dibujada, se re-animan sus charts.
  const TABS = {
    ritmo: { render: renderRitmo, charts: ['chart-proj-ritmo', 'chart-proj-fuentes', 'chart-src-*'] },
    plan:  { render: () => global.PlanCampanas?.render(_data), charts: ['chart-plan-*'] },
  };
  const TAB_KEY = 'rb-proj-tab';
  let _tab = 'ritmo';
  try { if (TABS[localStorage.getItem(TAB_KEY)]) _tab = localStorage.getItem(TAB_KEY); } catch (e) { /* storage bloqueado */ }
  let _data = null;
  const _dirty = { ritmo: true, plan: true };

  function showTab(name) {
    if (!TABS[name]) name = 'ritmo';
    _tab = name;
    document.querySelectorAll('.proj-tab').forEach(t => {
      const on = t.dataset.pane === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.proj-pane').forEach(p => { p.hidden = p.id !== 'proj-pane-' + name; });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* storage bloqueado */ }
    if (!_data) return;
    if (_dirty[name]) {
      _dirty[name] = false;
      TABS[name].render();
    } else {
      requestAnimationFrame(() => global.Charts.replay(TABS[name].charts));
    }
  }

  let _wired = false;
  function wireTabs() {
    if (_wired) return;
    _wired = true;
    const tabs = [...document.querySelectorAll('.proj-tab')];
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => showTab(t.dataset.pane));
      // Flechas izquierda/derecha entre pestañas (patrón ARIA tablist)
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        showTab(next.dataset.pane);
      });
    });
  }

  // ── Render público ───────────────────────────────────────────
  // plan: objetivos de la marca · ventas: { meses, semanas, dias, ultimoDia, semanas2025 } del
  // histórico por mes calendario · gasto: data/ads-2026.json. Se llama de nuevo cuando Objetivos
  // sincroniza: las dos pestañas quedan por redibujar y se dibuja la visible.
  function render({ plan, ventas, gasto }) {
    _plan = plan || null;
    _ventas = ventas || null;
    if (gasto !== _gasto || !_adsDia) {
      _gasto = gasto || null;
      _adsDia = adsPorDia();
    }
    _data = { plan: _plan, ventas: _ventas, gasto: _gasto };
    _dirty.ritmo = _dirty.plan = true;
    wireTabs();
    showTab(_tab);
  }

  global.Projections = { render };

})(window);
