/* ============================================================
   gasto.js — módulo "Gasto publicitario".
   Solo usa las carpetas de pauta de Royal Baby en Drive, una pestaña por fuente:
     Meta Ads    carpeta "Meta Files"    (export diario del Administrador de anuncios)
     Google Ads  carpeta "Google Files"  (informe de campaña, un total por mes)
   scripts/sync-ads.js las lee y escribe data/ads-2026.json; el workflow
   sync-ads.yml lo corre todos los días a las 07:00 (Lima). Publicado, el JSON
   viaja incrustado en el HTML cifrado (window.RB_GASTO_DATA, scripts/build.js).
   No hay botón para sincronizar: exigiría guardar un token de GitHub en el
   navegador y el tablero lo abren clientes (ver sheets.js).
   Expone window.Gasto.init() (main.js lo llama al abrir la vista) y Gasto.load(),
   la misma carga de datos, que main.js le pasa a Proyecciones.
   ============================================================ */

(function (global) {
  const FILE = 'data/ads-2026.json';
  // Mismos colores que Proyecciones: Meta E-Commerce y Google Search.
  const PLATFORMS = {
    meta: {
      label: 'Meta Ads', folderName: 'Meta Files', color: '#1877F2', letter: 'M',
      folder: 'https://drive.google.com/drive/folders/1kjz_QSgFpkd9semvyjrlLQi3ETH8-DPm',
    },
    google: {
      label: 'Google Ads', folderName: 'Google Files', color: '#4285F4', letter: 'G',
      folder: 'https://drive.google.com/drive/folders/1TT5KTVZuGlFc7OqvGAz9nuRVyJFvwJpd',
    },
  };
  // Tipo de resultado de Meta → color de su fuente en Proyecciones (E-Commerce, WhatsApp, Interacción).
  const RESULT_COLORS = {
    'Compras en el sitio web': '#1877F2',
    'Conversaciones con mensajes iniciadas': '#25D366',
    'Interacciones': '#E1306C',
  };
  const OTHER_RESULT_COLOR = '#94A3B8';
  const CONVERSATIONS = 'Conversaciones con mensajes iniciadas';
  const axisColor = '#94A3B8';
  const gridColor = 'rgba(15,23,42,0.06)';
  const inkColor = '#06132b';
  const TAB_KEY = 'rb-gp-tab';
  const PANE_CHARTS = {
    meta:   ['chart-gp-meta-daily', 'chart-gp-meta-spend', 'chart-gp-meta-roas'],
    google: ['chart-gp-google-spend'],
  };

  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const AGE_LABELS = { Unknown: 'Sin dato' };
  const GENDER_LABELS = { female: 'Mujeres', male: 'Hombres', unknown: 'Sin dato' };

  const state = { data: null, loaded: false, tab: 'meta', month: null, rendered: {} };

  // ── Formato (mismo criterio que el resto del tablero: "S/. " y es-PE) ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, dec = 0) => n == null || !Number.isFinite(n) ? '—'
    : 'S/. ' + n.toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const moneyShort = v => Math.abs(v) >= 1e3 ? 'S/. ' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : 'S/. ' + Math.round(v);
  const num = n => n == null ? '—' : Math.round(n).toLocaleString('es-PE');
  // Google Ads reparte conversiones entre campañas: pueden venir con decimales (19.75).
  const numDec = n => n == null ? '—' : n.toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const pct = (n, dec = 1) => n == null || !Number.isFinite(n) ? '—' : n.toFixed(dec) + '%';
  const ratio = (a, b) => (a == null || !b ? null : a / b);
  const roasFmt = n => n == null || !Number.isFinite(n) ? '—' : n.toFixed(1) + 'x';
  const sum = (items, field) => items.reduce((s, x) => s + (x[field] || 0), 0);
  // Los enlaces vienen de los archivos de Drive: solo se usan si son https.
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);

  // Fechas con hora se muestran en hora de Lima (UTC-5, sin horario de verano).
  function fechaHora(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (/T\d{2}:\d{2}/.test(iso) && Number.isFinite(t)) iso = new Date(t - 5 * 3600 * 1000).toISOString();
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return iso;
    const d = `${+m[3]} ${SHORT[+m[2] - 1].toLowerCase()} ${m[1]}`;
    return m[4] ? `${d}, ${m[4]}:${m[5]}` : d;
  }
  const fechaCorta = iso => { const [, mm, dd] = iso.split('-'); return `${+dd} ${SHORT[+mm - 1].toLowerCase()}`; };
  const shortOf = id => SHORT[+id.slice(5, 7) - 1];

  function deltaPill(cur, prev, { neutral = false } = {}) {
    if (cur == null || !prev) return '';
    const d = (cur - prev) / prev * 100;
    const cls = neutral ? 'gray' : d >= 0 ? 'green' : 'red';
    return `<span class="pill ${cls}">${d >= 0 ? '+' : ''}${pct(d)}</span>`;
  }
  // Mismos umbrales de ROAS que Proyecciones.
  const roasPill = (roas, purchases) => !purchases
    ? '<span class="pill gray">sin compras</span>'
    : `<span class="pill ${roas >= 3 ? 'green' : roas >= 1.5 ? 'amber' : 'red'}">${roasFmt(roas)}</span>`;

  const kpi = ({ label, value, subs = [] }) => `
    <div class="kpi-pill">
      <span>${label}</span>
      <strong>${value}</strong>
      ${subs.filter(Boolean).map(s => `<small>${s}</small>`).join('')}
    </div>`;

  // ── Carga: incrustado al publicar, data/ads-2026.json en local ──
  // Una sola vez: Proyecciones (main.js) usa los mismos datos con Gasto.load().
  let request = null;
  function loadData() {
    if (!request) request = fetchData();
    return request;
  }
  async function fetchData() {
    if (global.RB_GASTO_DATA) return global.RB_GASTO_DATA;
    try {
      const res = await fetch(FILE, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.warn('[gasto] no se pudo cargar', FILE, err);
      return null;
    }
  }

  const monthsOf = p => (state.data?.months || []).filter(m => m[p]);
  // El mes elegido se comparte entre pestañas; si una plataforma no lo tiene, muestra su último mes.
  const pickMonth = list => list.find(m => m.id === state.month) || list[list.length - 1];

  // ── Franjas y estados comunes ──
  function renderSync() {
    const gen = state.data?.generatedAt;
    document.getElementById('gp-sync-dot').className = `gp-dot ${gen ? 'ok' : 'warn'}`;
    document.getElementById('gp-sync-text').innerHTML =
      `<b>${gen ? 'Datos al ' + esc(fechaHora(gen)) : 'Aún no sincronizado'}</b> <span class="muted">· se sincroniza sola todos los días a las 07:00 (Lima)</span>`;
  }

  function renderSource(p) {
    const cfg = PLATFORMS[p];
    const src = state.data?.sources?.[p];
    const files = src?.files?.length || 0;
    const url = safeUrl(src?.folderUrl) || cfg.folder;
    document.getElementById(`gp-${p}-source`).innerHTML = `
      <div class="gp-source-l">
        <span class="gp-dot ${monthsOf(p).length ? 'ok' : 'warn'}"></span>
        <span><b>Fuente:</b> carpeta ${cfg.folderName} <span class="muted">· Google Drive · ${files} archivo${files === 1 ? '' : 's'}</span></span>
      </div>
      <div class="gp-source-r">
        <a class="btn ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir carpeta ↗</a>
      </div>`;
  }

  function emptyState(body, p) {
    const cfg = PLATFORMS[p];
    const url = safeUrl(state.data?.sources?.[p]?.folderUrl) || cfg.folder;
    body.innerHTML = `
      <div class="panel gp-empty">
        <div class="gp-empty-ic"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        <div class="gp-empty-title">${state.data ? `${cfg.label}: la carpeta todavía no tiene informes` : `${cfg.label} aún no sincronizado`}</div>
        <p class="gp-empty-text">${p === 'meta'
          ? 'Cuando se suba a la carpeta <b>Meta Files</b> el export del Administrador de anuncios (un archivo por mes, con desglose por día, edad, sexo y anuncio), se sincronizará solo y aparecerá aquí.'
          : 'Cuando se suba a la carpeta <b>Google Files</b> el informe de campañas de Google Ads (un archivo por mes, con el rango del mes), se sincronizará solo y aparecerá aquí.'}</p>
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir carpeta en Drive</a>
      </div>`;
  }

  function monthSelector(hostId, list, selected) {
    const host = document.getElementById(hostId);
    const year = selected.id.slice(0, 4);
    const has = new Set(list.map(m => m.id));
    host.innerHTML = SHORT.map((label, k) => {
      const id = `${year}-${String(k + 1).padStart(2, '0')}`;
      const on = id === selected.id;
      const ok = has.has(id);
      return `<button type="button" class="proj-mes-btn${on ? ' active' : ''}${ok ? '' : ' sin-datos'}" data-id="${id}"
        aria-pressed="${on}"${ok ? '' : ' disabled'} title="${MONTHS[k]} ${year}${ok ? '' : ' · sin datos'}">${label}</button>`;
    }).join('');
    host.querySelectorAll('.proj-mes-btn:not(.sin-datos)').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.id === selected.id) return;
      state.month = btn.dataset.id;
      // La otra pestaña se vuelve a pintar con el mes nuevo cuando se abra.
      state.rendered = { [state.tab]: true };
      RENDER[state.tab]();
    }));
  }

  function periodText(block, m) {
    const c = block.coverage;
    const range = c ? `Del ${fechaCorta(c.start)} al ${fechaCorta(c.end)}` : esc(m.label);
    const partial = c && !c.complete ? ' <span class="pill amber">mes parcial</span>' : '';
    return `${range}${partial} <span class="muted">· ${esc(block.source?.name || '')}</span>`;
  }

  // Avisos del sync: los de la plataforma en ese mes, los de su carpeta y lo pendiente.
  function renderAlerts(hostId, p, m) {
    const label = PLATFORMS[p].label;
    const monthPrefix = `${label} ${m.label}: `;
    const own = (m.warnings || []).filter(w => w.startsWith(monthPrefix)).map(w => w.slice(monthPrefix.length));
    const inMonths = new Set((state.data.months || []).flatMap(x => x.warnings || []));
    const folder = (state.data.warnings || []).filter(w => !inMonths.has(w) && w.startsWith(`${label}: `)).map(w => w.slice(label.length + 2));
    const pending = (state.data.pending || []).filter(w => w.startsWith(`${label}: `)).map(w => w.slice(label.length + 2));
    const host = document.getElementById(hostId);
    host.innerHTML = [
      ...pending.map(w => `<div class="insight warn"><b>Pendiente:</b> ${esc(w)}</div>`),
      own.length || folder.length ? `<div class="insight warn"><b>Avisos de ${esc(m.label)}</b>
        <ul class="gp-alert-list">${[...own, ...folder].map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '',
    ].join('');
    host.hidden = !host.innerHTML;
  }

  // Resalta en el eje X la etiqueta del mes elegido.
  function highlightX(chartId, idx) {
    const chart = global.Charts.getInstance(chartId);
    if (!chart) return;
    chart.options.scales.x.ticks.color = ctx => ctx.index === idx ? inkColor : axisColor;
    chart.options.scales.x.ticks.font = ctx => ({ size: 11, weight: ctx.index === idx ? 700 : 400 });
    chart.update('none');
  }

  function monthlyBarChart(id, list, values, color, footer) {
    global.Charts.mount(id, {
      type: 'bar',
      data: { labels: list.map(m => shortOf(m.id)), datasets: [{ label: 'Inversión', data: values, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 36 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => list[items[0].dataIndex].label,
            label: c => ` Inversión: ${money(c.parsed.y)}`,
            footer: items => footer(list[items[0].dataIndex]),
          } },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { size: 11 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: moneyShort }, grid: { color: gridColor } },
        },
      },
    });
  }

  // ════════════════════════════════════════════════════════════
  // META ADS
  // ════════════════════════════════════════════════════════════
  let metaBodyTpl = '';  // HTML original de #gp-meta-body (se guarda en init)

  const resultColor = type => RESULT_COLORS[type] || OTHER_RESULT_COLOR;
  function resultLabel(c) {
    if (!c.resultType) return 'Sin resultados';
    if (c.resultType === 'mixto') return 'Mixto: ' + Object.keys(c.resultsByType || {}).join(', ');
    return c.resultType;
  }

  function renderMeta() {
    renderSource('meta');
    const list = monthsOf('meta');
    const body = document.getElementById('gp-meta-body');
    if (!list.length) { emptyState(body, 'meta'); return; }
    // Si antes se mostró el estado vacío, se restaura la estructura del panel
    if (!body.querySelector('#gp-meta-kpis')) body.innerHTML = metaBodyTpl;

    const m = pickMonth(list);
    const i = list.indexOf(m);
    const prev = list[i - 1];
    const d = m.meta;
    const t = d.totals;
    const pt = prev?.meta.totals;
    const partial = !!d.coverage && !d.coverage.complete;
    const vs = prev ? ` vs ${shortOf(prev.id)}` : '';

    monthSelector('gp-meta-months', list, m);
    document.getElementById('gp-meta-range').innerHTML = periodText(d, m);
    renderAlerts('gp-meta-alerts', 'meta', m);

    // KPIs: la conversión es Compras; las conversaciones (WhatsApp) son el otro canal de venta.
    const messaging = d.campaigns.filter(c => c.resultType === CONVERSATIONS);
    const msgResults = sum(messaging, 'results');
    document.getElementById('gp-meta-kpis').innerHTML = [
      kpi({ label: 'Inversión', value: money(t.spend),
        subs: [prev ? `${deltaPill(t.spend, pt.spend, { neutral: true })}${vs}` : 'Importe gastado', `CPM ${money(t.cpm, 2)}`] }),
      kpi({ label: 'Compras', value: num(t.purchases),
        subs: [prev ? `${deltaPill(t.purchases, pt.purchases, { neutral: partial })}${vs}` : '', `Costo por compra ${money(t.costPerPurchase, 2)}`] }),
      kpi({ label: 'Valor de conversión', value: money(t.purchaseValue),
        subs: [prev ? `${deltaPill(t.purchaseValue, pt.purchaseValue, { neutral: partial })}${vs}` : '', `ROAS ${roasFmt(t.roas)} · atribución de Meta`] }),
      kpi({ label: 'Conversaciones iniciadas', value: num(t.conversations),
        subs: [prev ? `${deltaPill(t.conversations, pt.conversations, { neutral: partial })}${vs}` : '',
          messaging.length ? `${num(msgResults)} de campañas de mensajes · ${money(ratio(sum(messaging, 'spend'), msgResults), 2)} c/u` : 'WhatsApp y Messenger'] }),
    ].join('');

    renderFunnel(t);
    renderCampaigns(d, t);
    renderAds(d);
    renderAudience(d, t);

    metaDailyChart(m);
    if (!global.Charts.getInstance('chart-gp-meta-spend')) metaTrendCharts(list);
    highlightX('chart-gp-meta-spend', i);
    highlightX('chart-gp-meta-roas', i);
  }

  // Embudo: cada barra = conversión respecto al paso anterior registrado.
  function renderFunnel(t) {
    const steps = [
      ['Impresiones', t.impressions], ['Clics en el enlace', t.linkClicks], ['Visitas a la web', t.landingViews],
      ['Agregados al carrito', t.addToCart], ['Pagos iniciados', t.checkouts], ['Compras', t.purchases],
    ].filter(([, value]) => value != null);  // null = el export no trae esa columna
    let base = null;
    const untracked = [];
    let overflow = false;
    const rows = steps.map(([name, value], k) => {
      // En 0 con pasos posteriores > 0: Meta no recibió ese evento. No corta el embudo.
      if (value === 0 && steps.slice(k + 1).some(([, v]) => v > 0)) {
        untracked.push(name);
        return `<div class="gp-funnel-row is-off">
          <div class="gp-funnel-name">${name}</div>
          <div class="gp-funnel-bar"><div style="width:0"></div></div>
          <div class="gp-funnel-val mono">—</div>
          <div class="gp-funnel-rate">sin registro</div>
        </div>`;
      }
      const rate = base == null ? null : ratio(value, base);
      if (rate > 1) overflow = true;
      base = value;
      return `<div class="gp-funnel-row">
        <div class="gp-funnel-name">${name}</div>
        <div class="gp-funnel-bar"><div style="width:${rate == null ? 100 : Math.max(Math.min(rate * 100, 100), 1.5)}%"></div></div>
        <div class="gp-funnel-val mono">${num(value)}</div>
        <div class="gp-funnel-rate">${rate == null ? '' : pct(rate * 100)}</div>
      </div>`;
    });
    const notes = [];
    if (untracked.length) {
      notes.push(`Meta no registró ${untracked.map(n => `«${n}»`).join(' ni ')} este mes aunque sí hay pasos posteriores: el evento no está llegando desde la web. El paso siguiente se mide contra el anterior registrado.`);
    }
    if (overflow) notes.push('Un paso que supera al anterior indica que Meta no registra completo el evento anterior.');
    if (t.conversations) notes.push(`Aparte, <b>${num(t.conversations)} conversaciones</b> iniciadas por mensajes (WhatsApp): no pasan por la web.`);
    document.getElementById('gp-meta-funnel').innerHTML = rows.join('') + notes.map(n => `<p class="gp-note">${n}</p>`).join('');
  }

  function renderCampaigns(d, t) {
    document.getElementById('gp-meta-campaigns').innerHTML = `
      <div class="gp-table-wrap"><table class="rep-table gp-camp-table">
        <thead><tr>
          <th>Campaña</th><th>Objetivo</th><th>Tipo de resultado</th><th class="r">Resultados</th><th class="r">Costo / resultado</th>
          <th class="r">Inversión</th><th class="r">Compras</th><th class="r">ROAS</th>
        </tr></thead>
        <tbody>${d.campaigns.map(c => {
          const share = (ratio(c.spend, t.spend) || 0) * 100;
          return `<tr>
            <td><div class="rep-camp-name">${esc(c.campaign)}</div><div class="rep-bar"><div style="width:${share}%"></div></div></td>
            <td>${esc(c.objective || '—')}</td>
            <td><span class="gp-type"><span class="gp-pip" style="background:${resultColor(c.resultType)}"></span>${esc(resultLabel(c))}</span></td>
            <td class="r mono">${c.results == null ? '—' : num(c.results)}</td>
            <td class="r mono">${money(c.costPerResult, 2)}</td>
            <td class="r mono">${money(c.spend)}<span class="sub-val">${pct(share)}</span></td>
            <td class="r mono">${c.purchases ? num(c.purchases) : '—'}</td>
            <td class="r">${roasPill(c.roas, c.purchases)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  function renderAds(d) {
    const host = document.getElementById('gp-meta-ads');
    const sub = document.getElementById('gp-meta-ads-sub');
    if (!d.ads) {
      sub.textContent = 'Enlace a la vista previa del anuncio en Meta';
      host.innerHTML = '<p class="gp-note">El export de este mes no trae la columna «Nombre del anuncio».</p>';
      return;
    }
    const ads = d.ads.top;
    sub.textContent = `${ads.length} de ${d.ads.count} anuncios con entrega · por compras y luego conversaciones`;
    host.innerHTML = ads.length ? `
      <div class="gp-table-wrap"><table class="rep-table">
        <thead><tr><th>Anuncio</th><th class="r">Compras</th><th class="r">Conv.</th><th class="r">Inversión</th><th class="r">ROAS</th><th></th></tr></thead>
        <tbody>${ads.map((a, k) => {
          const link = safeUrl(a.link);
          return `<tr>
            <td>${k === 0 && a.purchases ? '<span class="rep-star" title="Más compras del mes">★</span>' : ''}${esc(a.ad)}<span class="sub-val">${esc(a.campaign)}</span></td>
            <td class="r mono">${a.purchases ? num(a.purchases) : '—'}</td>
            <td class="r mono">${a.conversations ? num(a.conversations) : '—'}</td>
            <td class="r mono">${money(a.spend)}</td>
            <td class="r">${roasPill(a.roas, a.purchases)}</td>
            <td class="r">${link ? `<a class="btn ghost btn-sm" href="${esc(link)}" target="_blank" rel="noopener" title="Vista previa en Meta">Ver ↗</a>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<p class="gp-note">Ningún anuncio registró compras ni conversaciones este mes.</p>';
  }

  // Público: barras por edad (compras, o inversión si no hubo compras) y reparto por sexo.
  function renderAudience(d, t) {
    const host = document.getElementById('gp-meta-audience');
    const ages = (d.audience?.age || []).filter(a => a.spend > 0 || a.purchases > 0 || a.conversations > 0);
    const genders = (d.audience?.gender || []).filter(g => g.spend > 0);
    if (!ages.length && !genders.length) {
      host.innerHTML = '<p class="gp-note">El export de este mes no trae el desglose por edad y sexo.</p>';
      return;
    }
    const byPurchases = ages.some(a => a.purchases > 0);
    const field = byPurchases ? 'purchases' : 'spend';
    const max = Math.max(...ages.map(a => a[field])) || 1;
    host.innerHTML = `
      ${ages.length ? `<div class="rep-subttl" style="margin-top:0">${byPurchases ? 'Compras' : 'Inversión'} por edad</div>
      ${ages.map(a => `<div class="gp-aud-row">
        <div class="gp-aud-name">${esc(AGE_LABELS[a.age] || a.age)}</div>
        <div class="gp-aud-bar"><div style="width:${a[field] / max * 100}%"></div></div>
        <div class="gp-aud-val">${byPurchases ? `<span class="mono">${num(a.purchases)}</span> <span class="muted">· ${money(a.spend)}</span>` : `<span class="mono">${money(a.spend)}</span>`}</div>
      </div>`).join('')}` : ''}
      ${genders.length ? `<div class="rep-subttl">Inversión por sexo</div>
      <dl class="rep-metrics rep-metrics-wide">${genders.map(g => `<div>
        <dt>${esc(GENDER_LABELS[g.gender] || g.gender)}</dt>
        <dd>${pct((ratio(g.spend, t.spend) || 0) * 100, 0)} de la inversión · ${num(g.purchases)} compras · ${num(g.conversations)} conv.</dd>
      </div>`).join('')}</dl>` : ''}`;
  }

  // Inversión diaria del mes (suma de campañas); el tooltip desglosa por campaña.
  function metaDailyChart(m) {
    const wrap = document.getElementById('gp-meta-daily-wrap');
    const note = document.getElementById('gp-meta-daily-note');
    const rows = m.meta.daily || [];
    if (!rows.length) {
      global.Charts.destroy('chart-gp-meta-daily');
      wrap.hidden = true;
      note.hidden = false;
      note.textContent = 'El export de este mes no trae la columna Día: no hay serie diaria.';
      return;
    }
    wrap.hidden = false;
    note.hidden = true;
    const byDay = new Map();
    const { start, end } = m.meta.coverage || { start: rows[0].day, end: rows[rows.length - 1].day };
    // Los días sin filas en el export van en cero para que el eje no salte.
    for (let day = new Date(start + 'T00:00:00Z'); day.toISOString().slice(0, 10) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      const iso = day.toISOString().slice(0, 10);
      byDay.set(iso, { day: iso, spend: 0, purchases: 0, conversations: 0, campaigns: [] });
    }
    for (const r of rows) {
      const x = byDay.get(r.day);
      if (!x) continue;
      x.spend += r.spend; x.purchases += r.purchases; x.conversations += r.conversations;
      if (r.spend) x.campaigns.push(r);
    }
    const days = [...byDay.values()];
    const cut = s => (s.length > 38 ? s.slice(0, 37) + '…' : s);
    global.Charts.mount('chart-gp-meta-daily', {
      type: 'bar',
      data: {
        labels: days.map(x => +x.day.slice(8)),
        datasets: [{ label: 'Inversión', data: days.map(x => x.spend), backgroundColor: PLATFORMS.meta.color, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 14 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => fechaCorta(days[items[0].dataIndex].day),
            label: c => ` Inversión: ${money(c.parsed.y, 2)}`,
            afterBody: items => days[items[0].dataIndex].campaigns
              .slice().sort((a, b) => b.spend - a.spend)
              .map(r => `  ${cut(r.campaign)}: ${money(r.spend, 2)}`),
            footer: items => { const x = days[items[0].dataIndex]; return `Compras: ${num(x.purchases)} · Conversaciones: ${num(x.conversations)}`; },
          } },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 6 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: axisColor, font: { size: 10 }, callback: moneyShort }, grid: { color: gridColor } },
        },
      },
    });
  }

  function metaTrendCharts(list) {
    monthlyBarChart('chart-gp-meta-spend', list, list.map(m => m.meta.totals.spend), PLATFORMS.meta.color, m => {
      const t = m.meta.totals;
      return `Compras: ${num(t.purchases)} · Conversaciones: ${num(t.conversations)}`;
    });
    global.Charts.mount('chart-gp-meta-roas', {
      type: 'line',
      data: { labels: list.map(m => shortOf(m.id)), datasets: [{
        label: 'ROAS', data: list.map(m => m.meta.totals.roas),
        borderColor: PLATFORMS.meta.color, backgroundColor: PLATFORMS.meta.color, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
        pointBackgroundColor: '#ffffff', pointBorderWidth: 2, tension: 0.25,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => list[items[0].dataIndex].label,
            label: c => ` ROAS: ${roasFmt(c.parsed.y)}`,
            footer: items => { const t = list[items[0].dataIndex].meta.totals; return `Valor ${money(t.purchaseValue)} ÷ inversión ${money(t.spend)}`; },
          } },
          datalabels: {
            display: true, align: 'top', offset: 4, color: '#52647d', font: { size: 10, weight: 600 },
            formatter: v => v == null ? '' : v.toFixed(1),
          },
        },
        scales: {
          x: { ticks: { color: axisColor, font: { size: 11 } }, grid: { display: false } },
          y: { beginAtZero: true, grace: '15%', ticks: { color: axisColor, font: { size: 10 }, callback: v => v + 'x' }, grid: { color: gridColor } },
        },
      },
    });
  }

  // ════════════════════════════════════════════════════════════
  // GOOGLE ADS
  // ════════════════════════════════════════════════════════════
  function renderGoogle() {
    renderSource('google');
    const list = monthsOf('google');
    const body = document.getElementById('gp-google-body');
    if (!list.length) { emptyState(body, 'google'); return; }

    const m = pickMonth(list);
    const i = list.indexOf(m);
    const prev = list[i - 1];
    const g = m.google;
    const t = g.totals;
    const pt = prev?.google.totals;
    const partial = !!g.coverage && !g.coverage.complete;
    const vs = prev ? ` vs ${shortOf(prev.id)}` : '';
    const complete = g.campaignsComplete;
    const categories = Object.entries(g.conversionsByCategory || {}).sort((a, b) => b[1] - a[1]);
    const campaigns = g.campaigns.slice().sort((a, b) => (b.purchases || 0) - (a.purchases || 0) || (b.conversions || 0) - (a.conversions || 0));
    const catText = cats => Object.entries(cats || {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${numDec(v)}`).join(' · ') || '—';
    // Las conversiones de Google suman Compra y Contacto (clics a WhatsApp): solo se explican cuando difieren de las compras.
    const contact = categories.find(([k, v]) => /contacto/i.test(k) && v);
    const conversionsNote = t.conversions != null && (t.conversions !== t.purchases || categories.some(([k, v]) => v && !/compra/i.test(k)))
      ? `<p class="gp-note gp-note-top">Conversiones del mes: <b>${numDec(t.conversions)}</b>${categories.length ? ` (${catText(g.conversionsByCategory)})` : ''}.
        ${contact ? 'Contacto son clics a WhatsApp y va aparte: el KPI de conversión es <b>Compras</b>.' : 'El KPI de conversión es <b>Compras</b>.'}</p>`
      : '';

    body.innerHTML = `
      <div class="rep-toolbar">
        <div class="proj-mes-wrap">
          <span class="proj-mes-label">Mes</span>
          <div class="proj-mes-selector" id="gp-google-months" role="group" aria-label="Mes de Google Ads"></div>
        </div>
        <span class="rep-period-meta">${periodText(g, m)}</span>
      </div>
      <div class="rep-stack">
        <div class="gp-alerts" id="gp-google-alerts"></div>
        <div class="kpi-strip gp-kpis">${[
          kpi({ label: 'Inversión', value: money(t.cost),
            subs: [prev ? `${deltaPill(t.cost, pt.cost, { neutral: true })}${vs}` : 'Costo del mes', `CPC ${money(t.cpc, 2)}`] }),
          kpi({ label: 'Compras', value: numDec(t.purchases),
            subs: [prev ? `${deltaPill(t.purchases, pt.purchases, { neutral: partial })}${vs}` : '', `Costo por compra ${money(t.costPerPurchase, 2)}`] }),
          kpi({ label: 'Valor de conversión', value: money(t.conversionValue),
            subs: [prev ? `${deltaPill(t.conversionValue, pt.conversionValue, { neutral: partial })}${vs}` : '', `ROAS ${roasFmt(t.roas)} · atribución de Google`] }),
          kpi({ label: 'CTR', value: pct(t.ctr == null ? null : t.ctr * 100, 2),
            subs: [`${num(t.clicks)} clics · ${num(t.impressions)} impresiones`] }),
        ].join('')}</div>
        ${conversionsNote}
        <div class="grid-2">
          <div class="panel">
            <div class="panel-head"><div>
              <div class="panel-title">Inversión por tipo de campaña</div>
              <div class="panel-sub">Costo, clics y compras del mes · cifras completas</div>
            </div></div>
            <div class="gp-table-wrap"><table class="rep-table">
              <thead><tr><th>Tipo</th><th class="r">Inversión</th><th class="r">Clics</th><th class="r">CTR</th><th class="r">Compras</th><th class="r">ROAS</th></tr></thead>
              <tbody>${g.byType.map(x => {
                const share = (ratio(x.cost, t.cost) || 0) * 100;
                return `<tr>
                  <td><div class="rep-camp-name">${esc(x.type)}</div><div class="rep-bar"><div style="width:${share}%"></div></div></td>
                  <td class="r mono">${money(x.cost)}<span class="sub-val">${pct(share)}</span></td>
                  <td class="r mono">${num(x.clicks)}</td>
                  <td class="r mono">${pct(x.ctr == null ? null : x.ctr * 100, 2)}</td>
                  <td class="r mono">${x.purchases ? numDec(x.purchases) : '—'}</td>
                  <td class="r">${roasPill(x.roas, x.purchases)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div>
              <div class="panel-title">Compras por campaña</div>
              <div class="panel-sub">${complete ? 'Inversión y compras de cada campaña' : 'Compras, valor y conversiones por categoría · sin costo por campaña'}</div>
            </div></div>
            ${campaigns.length ? `<div class="gp-table-wrap"><table class="rep-table">
              <thead><tr><th>Campaña</th>${complete ? '<th class="r">Inversión</th>' : ''}<th class="r">Compras</th><th class="r">Valor</th>${complete ? '<th class="r">ROAS</th>' : '<th class="r">Conversiones</th>'}</tr></thead>
              <tbody>${campaigns.map(c => `<tr>
                <td>${esc(c.campaign)}<span class="sub-val">${esc([c.type, c.status].filter(Boolean).join(' · '))}</span></td>
                ${complete ? `<td class="r mono">${money(c.cost)}</td>` : ''}
                <td class="r mono">${c.purchases ? numDec(c.purchases) : '—'}</td>
                <td class="r mono">${c.conversionValue ? money(c.conversionValue) : '—'}</td>
                ${complete ? `<td class="r">${roasPill(c.roas, c.purchases)}</td>` : `<td class="r gp-cats">${catText(c.conversionsByCategory)}</td>`}
              </tr>`).join('')}</tbody>
            </table></div>` : '<p class="gp-note">El informe de este mes no trae campañas.</p>'}
            ${complete ? '' : `<p class="gp-note">El informe viene segmentado por «${esc(g.segmentation)}»: por campaña solo trae conversiones y su valor. El costo, las impresiones y los clics de cada campaña no se conocen; la inversión completa está en «Inversión por tipo de campaña».</p>`}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div>
            <div class="panel-title">Inversión mensual</div>
            <div class="panel-sub">Costo en Google Ads por mes · el tooltip muestra compras y ROAS · Google llega con un total por mes, sin serie diaria</div>
          </div></div>
          <div class="chart-wrap h-220"><canvas id="chart-gp-google-spend" role="img" aria-label="Inversión mensual en Google Ads"></canvas></div>
        </div>
      </div>`;
    monthSelector('gp-google-months', list, m);
    renderAlerts('gp-google-alerts', 'google', m);

    monthlyBarChart('chart-gp-google-spend', list, list.map(x => x.google.totals.cost), PLATFORMS.google.color, x => {
      const gt = x.google.totals;
      return `Compras: ${numDec(gt.purchases)} · ROAS ${roasFmt(gt.roas)}`;
    });
    highlightX('chart-gp-google-spend', i);
  }

  // ════════════════════════════════════════════════════════════
  // Pestañas
  // ════════════════════════════════════════════════════════════
  const RENDER = { meta: renderMeta, google: renderGoogle };

  function showTab(name) {
    if (!RENDER[name]) name = 'meta';
    state.tab = name;
    document.querySelectorAll('.gp-tab').forEach(t => {
      const on = t.dataset.pane === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.gp-pane').forEach(p => { p.hidden = p.id !== 'gp-pane-' + name; });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* storage bloqueado */ }

    // Render perezoso: los charts se crean con la pestaña ya visible (y con los datos ya cargados)
    if (!state.loaded) return;
    if (!state.rendered[name]) {
      state.rendered[name] = true;
      RENDER[name]();
    } else {
      requestAnimationFrame(() => global.Charts.replay(PANE_CHARTS[name]));
    }
  }

  function wireTabs() {
    const tabs = [...document.querySelectorAll('.gp-tab')];
    tabs.forEach((t, k) => {
      // El color de cada plataforma sale de PLATFORMS: el mismo en pestañas, barras y gráficos.
      const cfg = PLATFORMS[t.dataset.pane];
      t.querySelector('.gp-tab-ic').style.background = cfg.color;
      document.getElementById('gp-pane-' + t.dataset.pane).style.setProperty('--gp-c', cfg.color);
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

  let started = false;
  async function init() {
    if (started) {
      requestAnimationFrame(() => global.Charts.replay(PANE_CHARTS[state.tab]));
      return;
    }
    started = true;
    metaBodyTpl = document.getElementById('gp-meta-body').innerHTML;
    wireTabs();
    state.data = await loadData();
    state.loaded = true;
    const months = state.data?.months || [];
    state.month = months.length ? months[months.length - 1].id : null;
    try { state.tab = localStorage.getItem(TAB_KEY) || 'meta'; } catch (e) { /* storage bloqueado */ }
    renderSync();
    showTab(state.tab);
  }

  global.Gasto = { init, load: loadData };
})(window);
