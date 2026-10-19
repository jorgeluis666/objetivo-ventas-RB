/* ============================================================
   reporte-semanal.js — Archivo de Reportes · Generación de Reporte.
   El reporte de una semana de lunes a domingo frente a la semana anterior, con el orden de
   los reportes de la carpeta Reportes de Drive: Meta Ads por grupo de campañas (E-commerce,
   Reconocimiento, WhatsApp…) y conjunto, con el mejor anuncio de cada uno; Google Ads por
   campaña; y conclusiones.
   No trae datos nuevos: usa data/ads-2026.json (Gasto.load()), las mismas filas por día,
   campaña, conjunto y anuncio de Gasto publicitario, sumadas por semana.
   Cada lunes la semana que acaba de cerrar pasa a ser la primera de la lista. Las conclusiones
   las escribe el equipo y quedan guardadas por semana en este navegador.
   Expone window.ReporteSemanal = { init }.
   ============================================================ */

(function (global) {
  const WEEKS_IN_LIST = 12;
  const NOTES_KEY = 'rb-week-notes-v1';
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // Los títulos de las conclusiones: el equipo reescribe el texto, no el orden.
  const NOTE_FIELDS = [
    { key: 'logro', label: 'Lo que funcionó' },
    { key: 'alerta', label: 'Lo que hay que corregir' },
    { key: 'siguiente', label: 'Recomendaciones y próximos pasos' },
  ];
  // Los mismos grupos de campaña que Gasto publicitario, cada uno con el resultado que mide.
  const GROUPS = [
    { key: 'ecommerce', label: 'E-commerce', match: /ventas|e-?commerce|catalogo/, color: '#1877F2', result: 'Compras', one: 'compra', many: 'compras', kpi: 'Compras web', field: 'purchases', commerce: true },
    { key: 'whatsapp', label: 'Mensajes WhatsApp', match: /whatsapp|mensajes/, color: '#25D366', result: 'Conversaciones', one: 'conversación', many: 'conversaciones', kpi: 'Conversaciones WhatsApp', field: 'conversations' },
    { key: 'reconocimiento', label: 'Reconocimiento', match: /reconocimiento|alcance|notoriedad|branding|thruplay/, color: '#7C3AED', result: 'ThruPlays', one: 'ThruPlay', many: 'ThruPlays', kpi: 'ThruPlays', field: 'results' },
    { key: 'interaccion', label: 'Interacción', match: /interacci/, color: '#E1306C', result: 'Interacciones', one: 'interacción', many: 'interacciones', kpi: 'Interacciones', field: 'results' },
    { key: 'trafico', label: 'Tráfico', match: /trafico/, color: '#0D9488', result: 'Resultados', one: 'resultado', many: 'resultados', kpi: 'Resultados de tráfico', field: 'results' },
  ];
  const OTHER = { key: 'otras', label: 'Otras campañas', color: '#64748B', result: 'Resultados', one: 'resultado', many: 'resultados', kpi: 'Otros resultados', field: 'results' };

  let data = null;
  let selected = '';
  let chart = null;
  let wired = false;

  // ── Formato (el del resto del tablero: "S/. " y es-PE) ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const money = (n, dec = 2) => (n == null || !Number.isFinite(n) ? '—' : 'S/. ' + n.toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  const num = n => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('es-PE'));
  const unitCost = n => (n != null && n > 0 && n < 0.1 ? 'S/. ' + n.toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 4 }) : money(n));
  const roasFmt = n => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(2) + 'x');
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);
  const ratio = (a, b) => (b ? a / b : null);
  const groupOf = campaign => GROUPS.find(g => g.match.test(norm(campaign))) || OTHER;

  // ── Fechas en hora de Lima ──
  const pad = n => String(n).padStart(2, '0');
  const todayIso = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const mondayOf = day => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  const dayLabel = day => `${+day.slice(8, 10)} ${MESES[+day.slice(5, 7) - 1]}`;
  // "6 – 12 oct 2026"; si cruza de mes, "29 sep – 5 oct 2026".
  function rangeLabel(monday, year = true) {
    const sunday = shift(monday, 6);
    const start = monday.slice(5, 7) === sunday.slice(5, 7) ? String(+monday.slice(8, 10)) : dayLabel(monday);
    return `${start} – ${dayLabel(sunday)}${year ? ' ' + sunday.slice(0, 4) : ''}`;
  }
  const fileLabel = monday => `${+monday.slice(8, 10)}${MESES[+monday.slice(5, 7) - 1]}-${+shift(monday, 6).slice(8, 10)}${MESES[+shift(monday, 6).slice(5, 7) - 1]}${shift(monday, 6).slice(0, 4)}`;

  // ── Filas de Meta y de Google por día ──
  function metaRows() {
    return (data?.months || []).flatMap(m => {
      const t = m.meta?.table;
      if (!t) return [];
      const at = Object.fromEntries(t.columns.map((c, i) => [c, i]));
      return t.rows.map(r => {
        const campaign = t.campaigns[r[at.campaign]] || '';
        const ad = t.ads[r[at.ad]] || {};
        return {
          day: `${m.id}-${pad(r[at.d])}`, campaign, group: groupOf(campaign),
          adset: t.adsets[r[at.adset]] || 'Sin conjunto', ad: ad.name || '(sin nombre)', link: safeUrl(ad.link),
          spend: r[at.spend] || 0, impressions: r[at.impressions] || 0, reach: r[at.reach] || 0,
          results: r[at.results] || 0, purchases: r[at.purchases] || 0, purchaseValue: r[at.purchaseValue] || 0, conversations: r[at.conversations] || 0,
        };
      });
    });
  }
  function googleRows() {
    return (data?.months || []).flatMap(m => {
      const t = m.google?.detail?.table;
      if (!t) return [];
      const at = Object.fromEntries(t.columns.map((c, i) => [c, i]));
      return t.rows.map(r => ({
        day: `${m.id}-${pad(r[at.d])}`, campaign: t.campaigns[r[at.campaign]] || '',
        cost: r[at.cost] || 0, clicks: r[at.clicks] || 0, conversions: r[at.conversions] || 0, conversionValue: r[at.conversionValue] || 0,
      }));
    });
  }
  // Último día que trae cada informe (Meta: el export llega hasta coverage.end aunque ese día no tenga gasto).
  const metaEnd = () => (data?.months || []).map(m => m.meta?.coverage?.end).filter(Boolean).sort().pop() || '';
  const googleDays = () => new Set((data?.months || []).flatMap(m => {
    const c = m.google?.detail?.coverage;
    if (!c?.start || !c?.end) return [];
    const days = [];
    for (let d = c.start; d <= c.end; d = shift(d, 1)) days.push(d);
    return days;
  }));

  const activity = r => r.spend > 0 || r.impressions > 0;
  const inWeek = (rows, monday) => rows.filter(r => r.day >= monday && r.day <= shift(monday, 6));

  // Semanas cerradas con entregas en Meta, de la más reciente a la más antigua.
  function weeks(rows) {
    const current = mondayOf(todayIso());
    const mondays = new Set(rows.filter(activity).map(r => mondayOf(r.day)).filter(m => m < current));
    return [...mondays].sort().reverse().slice(0, WEEKS_IN_LIST);
  }

  // ── Sumas ──
  function sums(rows, g) {
    const s = { spend: 0, reach: 0, impressions: 0, results: 0, value: 0 };
    rows.forEach(r => {
      s.spend += r.spend; s.impressions += r.impressions; s.reach += r.reach;
      s.results += r[g.field] || 0; s.value += r.purchaseValue;
    });
    s.cost = s.results > 0 ? s.spend / s.results : null;
    s.roas = g.commerce && s.spend > 0 ? s.value / s.spend : null;
    return s;
  }
  // El anuncio con más resultados (y, a igualdad, más inversión) de unas filas.
  function bestAd(rows, g) {
    const ads = new Map();
    rows.forEach(r => {
      const a = ads.get(r.ad) || { name: r.ad, link: r.link, rows: [] };
      a.rows.push(r);
      ads.set(r.ad, a);
    });
    return [...ads.values()].map(a => ({ ...a, ...sums(a.rows, g) }))
      .filter(a => a.results > 0)
      .sort((a, b) => b.results - a.results || b.spend - a.spend)[0] || null;
  }

  function buildReport(monday, rows, gRows) {
    const prevMonday = shift(monday, -7);
    const week = inWeek(rows, monday);
    const prev = inWeek(rows, prevMonday);
    const groups = [...GROUPS, OTHER].map(g => {
      const w = week.filter(r => r.group === g), p = prev.filter(r => r.group === g);
      if (!w.some(activity) && !p.some(activity)) return null;
      const sets = [...new Set([...w, ...p].map(r => r.adset))].map(name => {
        const ws = w.filter(r => r.adset === name), ps = p.filter(r => r.adset === name);
        return { name, now: sums(ws, g), before: sums(ps, g), best: bestAd(ws, g) || bestAd(ps, g), bestFromBefore: !bestAd(ws, g) };
      }).filter(s => s.now.spend > 0 || s.before.spend > 0 || s.now.results > 0 || s.before.results > 0)
        .sort((a, b) => b.now.results - a.now.results || b.now.spend - a.now.spend);
      const series = Array.from({ length: 7 }, (_, i) => {
        const day = shift(monday, i);
        const d = sums(w.filter(r => r.day === day), g);
        return { day, results: d.results, spend: d.spend };
      });
      return { g, now: sums(w, g), before: sums(p, g), sets, series };
    }).filter(Boolean);

    const covered = googleDays();
    const days = Array.from({ length: 7 }, (_, i) => shift(monday, i));
    const gWeek = inWeek(gRows, monday), gPrev = inWeek(gRows, prevMonday);
    const gSum = list => {
      const s = list.reduce((a, r) => ({ cost: a.cost + r.cost, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, value: a.value + r.conversionValue }), { cost: 0, clicks: 0, conversions: 0, value: 0 });
      return { ...s, cpa: s.conversions > 0 ? s.cost / s.conversions : null, roas: s.cost > 0 ? s.value / s.cost : null };
    };
    const google = {
      missing: days.filter(d => !covered.has(d)),
      campaigns: [...new Set([...gWeek, ...gPrev].map(r => r.campaign))]
        .map(name => ({ name, now: gSum(gWeek.filter(r => r.campaign === name)), before: gSum(gPrev.filter(r => r.campaign === name)) }))
        .filter(c => c.now.cost > 0 || c.before.cost > 0 || c.now.conversions > 0)
        .sort((a, b) => b.now.cost - a.now.cost),
    };

    const end = metaEnd();
    return {
      monday, prevMonday, groups, google,
      spend: { now: sums(week, OTHER).spend, before: sums(prev, OTHER).spend },
      missing: days.filter(d => d > end),
      metaEnd: end,
    };
  }

  // ── Pintado ──
  // Variación "+12% vs S/. 300"; sin semana anterior lo dice en vez de callarlo.
  function delta(now, before, kind, better = 'up') {
    const show = kind === 'money' ? money(before) : kind === 'cost' ? unitCost(before) : kind === 'roas' ? roasFmt(before) : num(before);
    if (before == null || !before) return now ? `${pill('gray', 'nuevo')} sin ${kind === 'count' ? 'resultados' : 'datos'} la semana anterior` : 'igual que la semana anterior';
    const v = (now / before - 1) * 100;
    const good = better === 'up' ? v >= 0 : v <= 0;
    return `${pill(Math.abs(v) < 0.5 || !better ? 'gray' : good ? 'green' : 'red',`${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}%`)} vs ${show}`;
  }
  const pill = (cls, text) => `<span class="pill ${cls}">${text}</span>`;
  const kpi = (label, value, sub) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const arrow = (a, b, f) => `<span class="text-2">${f(a)}</span> → <strong>${f(b)}</strong>`;

  // Lo que dice la semana de un grupo, como abren los reportes de la carpeta.
  function groupSummary(x) {
    const { g, now, before, sets } = x;
    if (!now.spend && !now.results) return `Sin entrega esta semana. La semana anterior: ${num(before.results)} ${before.results === 1 ? g.one : g.many} con ${money(before.spend)}.`;
    if (!before.spend && !before.results) return `Empieza esta semana: <strong>${num(now.results)}</strong> ${now.results === 1 ? g.one : g.many} con ${money(now.spend)}${now.cost != null ? `, ${unitCost(now.cost)} por ${g.one}` : ''}.`;
    const top = sets[0];
    const parts = [
      `${g.result} ${now.results >= before.results ? 'suben' : 'bajan'} de ${num(before.results)} a <strong>${num(now.results)}</strong>, con ${money(now.spend)} de inversión (${money(before.spend)} la semana anterior)`,
      now.cost != null ? `costo por ${g.one} ${unitCost(now.cost)}` : '',
      g.commerce && now.roas != null ? `ROAS ${roasFmt(now.roas)}` : '',
    ].filter(Boolean).join(', ');
    const lead = top && top.now.results > 0
      ? ` Se concentran en <strong>${esc(top.name)}</strong> (${num(top.now.results)})${top.best ? `, con «${esc(top.best.name)}» como mejor anuncio` : ''}.`
      : '';
    return `${parts}.${lead}`;
  }

  function groupHtml(x, i) {
    const { g, sets } = x;
    const rows = sets.map(s => `
      <tr>
        <td class="rep-camp-name">${esc(s.name)}</td>
        <td class="r">${arrow(s.before.results, s.now.results, num)}</td>
        <td class="r">${s.before.results || s.now.results ? `${s.now.results - s.before.results >= 0 ? '+' : '−'}${num(Math.abs(s.now.results - s.before.results))}` : '—'}</td>
        <td class="r">${money(s.now.spend)}</td>
        <td class="r">${arrow(s.before.cost, s.now.cost, unitCost)}</td>
        ${g.commerce ? `<td class="r">${arrow(s.before.roas, s.now.roas, roasFmt)}</td>` : ''}
        <td>${s.best ? `${s.best.link ? `<a href="${esc(s.best.link)}" target="_blank" rel="noopener">${esc(s.best.name)}</a>` : esc(s.best.name)}<div class="sub-val text-2">${num(s.best.results)} ${s.best.results === 1 ? g.one : g.many} · ${unitCost(s.best.cost)}${g.commerce && s.best.roas != null ? ` · ROAS ${roasFmt(s.best.roas)}` : ''}${s.bestFromBefore ? ' · semana anterior' : ''}</div>` : '<span class="text-2">Sin resultados</span>'}</td>
      </tr>`).join('');
    return `
      <div class="panel week-group" style="--gp-c:${g.color}">
        <div class="panel-head"><div>
          <div class="panel-title"><span class="week-group-dot"></span>Royal Baby | ${esc(g.label)}</div>
          <div class="panel-sub">${groupSummary(x)}</div>
        </div></div>
        ${g.commerce ? `<div class="chart-wrap week-chart"><canvas id="week-chart" role="img" aria-label="Compras e inversión por día"></canvas></div>` : ''}
        <div class="gp-table-wrap">
          <table class="rep-table week-table">
            <thead><tr><th>Conjunto</th><th class="r">${esc(g.result)} sem. ant. → sem.</th><th class="r">Var.</th><th class="r">Inversión</th><th class="r">Costo por ${esc(g.one)}</th>${g.commerce ? '<th class="r">ROAS</th>' : ''}<th>Mejor anuncio</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function googleHtml(r) {
    const { campaigns, missing } = r.google;
    const note = missing.length === 7
      ? 'El informe diario de Google Ads de la carpeta Google Files no cubre esta semana.'
      : missing.length ? `El informe diario de Google Ads no trae ${missing.map(dayLabel).join(', ')}: los totales de la semana pueden subir.` : '';
    if (!campaigns.length) {
      return `<div class="panel"><div class="gp-table-empty">${note || 'Google Ads no tiene gasto en esta semana.'}</div></div>`;
    }
    return `
      <div class="panel">
        <div class="panel-head"><div>
          <div class="panel-title">Royal Baby | Google Ads por campaña</div>
          <div class="panel-sub">Del informe diario por campaña y palabra clave de la carpeta Google Files.${note ? ' ' + note : ''}</div>
        </div></div>
        <div class="gp-table-wrap">
          <table class="rep-table week-table">
            <thead><tr><th>Campaña</th><th class="r">Inversión</th><th class="r">Clics</th><th class="r">Conversiones sem. ant. → sem.</th><th class="r">Costo por conversión</th><th class="r">Valor de conversión</th><th class="r">ROAS</th></tr></thead>
            <tbody>${campaigns.map(c => `
              <tr>
                <td class="rep-camp-name">${esc(c.name)}</td>
                <td class="r">${money(c.now.cost)}</td>
                <td class="r">${num(c.now.clicks)}</td>
                <td class="r">${arrow(c.before.conversions, c.now.conversions, num)}</td>
                <td class="r">${unitCost(c.now.cpa)}</td>
                <td class="r">${money(c.now.value)}</td>
                <td class="r">${roasFmt(c.now.roas)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Conclusiones ──
  function readNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) { return {}; }
  }
  function saveNote(monday, key, value) {
    const notes = readNotes();
    notes[monday] = { ...(notes[monday] || {}), [key]: value };
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch (e) { /* sin storage dura hasta recargar */ }
  }
  // Lo que se puede afirmar con los números; el porqué lo escribe el equipo encima.
  function suggested(r) {
    const up = r.groups.filter(x => x.now.results > x.before.results && x.now.results > 0);
    const down = r.groups.filter(x => x.now.results < x.before.results && (x.now.spend > 0 || x.now.results > 0));
    const off = r.groups.filter(x => !x.now.spend && !x.now.results);
    const best = r.groups.flatMap(x => x.sets.filter(s => s.best && !s.bestFromBefore).map(s => ({ g: x.g, s })))
      .sort((a, b) => (b.g.commerce ? 1 : 0) - (a.g.commerce ? 1 : 0) || b.s.best.results - a.s.best.results)[0];
    const logro = [
      up.map(x => `${x.g.label}: ${x.g.many} de ${num(x.before.results)} a ${num(x.now.results)}${x.now.cost != null ? ` (${unitCost(x.now.cost)} por ${x.g.one})` : ''}`).join('; '),
      best ? `El mejor anuncio de ${best.g.label}: «${best.s.best.name}» con ${num(best.s.best.results)} ${best.s.best.results === 1 ? best.g.one : best.g.many}` : '',
    ].filter(Boolean).join('. ');
    const alerta = [
      down.map(x => `${x.g.label}: ${x.g.many} de ${num(x.before.results)} a ${num(x.now.results)}`).join('; '),
      off.length ? `Sin entrega esta semana: ${off.map(x => x.g.label).join(', ')}` : '',
      r.missing.length ? `Faltan ${r.missing.map(dayLabel).join(', ')} en la descarga de Meta` : '',
    ].filter(Boolean).join('. ');
    return { logro: logro ? logro + '.' : '', alerta: alerta ? alerta + '.' : '', siguiente: '' };
  }
  function notesHtml(r) {
    const saved = readNotes()[r.monday] || {};
    const sug = suggested(r);
    return NOTE_FIELDS.map((f, i) => `
      <label class="week-note" for="week-note-${f.key}">
        <span class="week-note-head"><b>0${i + 1}</b> ${esc(f.label)}</span>
        <textarea id="week-note-${f.key}" data-week-note="${f.key}" rows="3" placeholder="Escribe la conclusión que va en el reporte">${esc(saved[f.key] != null ? saved[f.key] : sug[f.key])}</textarea>
      </label>`).join('');
  }

  function renderChart(r) {
    const canvas = document.getElementById('week-chart');
    const x = r.groups.find(y => y.g.commerce);
    if (chart) { chart.destroy(); chart = null; }
    if (!canvas || !x || typeof global.Chart !== 'function') return;
    chart = new global.Chart(canvas, {
      data: {
        labels: x.series.map(d => dayLabel(d.day)),
        datasets: [
          { type: 'bar', label: 'Compras', data: x.series.map(d => d.results), backgroundColor: x.g.color, borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Inversión', data: x.series.map(d => Math.round(d.spend * 100) / 100), borderColor: '#94a3b8', backgroundColor: '#94a3b8', borderWidth: 2, tension: 0.3, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, datalabels: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.dataset.yAxisID === 'y1' ? money(c.raw) : num(c.raw)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, title: { display: true, text: 'Compras', font: { size: 10 } } },
          y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, callback: v => 'S/. ' + v } },
        },
      },
    });
  }

  async function render() {
    const host = document.getElementById('week-report');
    if (!host) return;
    data = data || await global.Gasto?.load();
    const rows = metaRows();
    const list = weeks(rows);
    const select = document.getElementById('week-select');
    if (!list.length) {
      if (select) select.innerHTML = '<option value="">Sin semanas cerradas</option>';
      host.innerHTML = '<div class="panel"><div class="gp-table-empty">Todavía no hay una semana cerrada de lunes a domingo con entregas en Meta Ads.</div></div>';
      return;
    }
    if (!list.includes(selected)) selected = list[0];
    if (select) {
      select.innerHTML = list.map((m, i) => `<option value="${m}"${m === selected ? ' selected' : ''}>${esc(rangeLabel(m))}${i === 0 ? ' · semana que acaba de pasar' : ''}</option>`).join('');
    }
    const model = await global.Reportes?.latestWeekly();
    const modelHost = document.getElementById('week-model');
    if (modelHost) {
      modelHost.innerHTML = model
        ? `Modelo: <a href="${esc(model.links.open)}" target="_blank" rel="noopener">${esc(model.titulo)}</a>`
        : 'Modelo: el último reporte semanal de la carpeta Reportes';
    }

    const r = buildReport(selected, rows, googleRows());
    const kpis = [
      kpi('Inversión Meta Ads', money(r.spend.now), delta(r.spend.now, r.spend.before, 'money', null)),
      ...r.groups.filter(x => x.g !== OTHER).map(x => kpi(
        esc(x.g.kpi),
        num(x.now.results),
        `${delta(x.now.results, x.before.results, 'count')}${x.now.cost != null ? ` · ${unitCost(x.now.cost)} c/u` : ''}${x.g.commerce && x.now.roas != null ? ` · ROAS ${roasFmt(x.now.roas)}` : ''}`)),
    ];
    host.innerHTML = `
      <div class="week-doc" id="week-doc">
        <div class="panel week-cover">
          <div>
            <div class="week-cover-brand">Lima Retail · Data Driven Marketing</div>
            <div class="week-cover-title">Reporte de Publicidad · Royal Baby</div>
            <div class="week-cover-period">${esc(rangeLabel(r.monday))} frente a ${esc(rangeLabel(r.prevMonday, false))} · Meta Ads y Google Ads</div>
          </div>
          <div class="week-cover-meta">
            <span>${selected === list[0] ? 'Semana que acaba de pasar' : 'Semana cerrada'}</span>
            <b>${esc(rangeLabel(r.monday))}</b>
          </div>
        </div>
        ${r.missing.length ? `<div class="insight warn">La descarga de Meta llega hasta el ${esc(dayLabel(r.metaEnd))}: ${esc(r.missing.map(dayLabel).join(', '))} todavía no están, así que los totales pueden subir.</div>` : ''}

        <h2 class="week-h2">01 · Resumen de la semana</h2>
        <div class="kpi-strip week-kpis">${kpis.join('')}</div>

        <h2 class="week-h2">02 · Meta Ads por grupo de campañas</h2>
        ${r.groups.map(groupHtml).join('') || '<div class="panel"><div class="gp-table-empty">Meta Ads no tiene entregas en esta semana.</div></div>'}

        <h2 class="week-h2">03 · Google Ads</h2>
        ${googleHtml(r)}

        <h2 class="week-h2">04 · Conclusiones y recomendaciones</h2>
        <div class="panel week-notes-panel">
          <div class="panel-sub week-notes-sub">Los dos primeros textos vienen propuestos con lo que dicen los números de la semana. Se editan aquí y quedan guardados en este navegador.</div>
          <div class="week-notes">${notesHtml(r)}</div>
        </div>

        <div class="week-foot">Fuente: descargas de Meta Ads y Google Ads de las carpetas Meta Files y Google Files · ${esc(rangeLabel(r.monday))} · Lima Retail</div>
      </div>`;
    renderChart(r);
    host.querySelectorAll('[data-week-note]').forEach(f => f.addEventListener('input', () => saveNote(r.monday, f.dataset.weekNote, f.value)));
  }

  // El nombre del PDF lo pone el navegador con el título del documento: se cambia solo mientras imprime.
  function printReport() {
    if (!selected) return;
    const title = document.title;
    document.title = `Reporte_Royal-Baby_${fileLabel(selected)}`;
    const restore = () => { document.title = title; global.removeEventListener('afterprint', restore); };
    global.addEventListener('afterprint', restore);
    global.print();
    setTimeout(restore, 2000);
  }

  function init() {
    render();
    if (wired) return;
    wired = true;
    document.getElementById('week-select')?.addEventListener('change', e => { selected = e.target.value; render(); });
    document.getElementById('week-print')?.addEventListener('click', printReport);
  }

  global.ReporteSemanal = { init };
})(window);
