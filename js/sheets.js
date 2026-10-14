/* ============================================================
   sheets.js — indicador de sync + botón "Actualizar".
   Muestra cuándo fue la última generación del JSON y permite
   recargar los datos publicados sin refrescar la página.
   Los datos nuevos llegan solos: los workflows "Actualizar datos
   de ventas" y "Sincronizar objetivos comerciales" corren cada día
   y vuelven a publicar el tablero.
   Antes el botón disparaba ese workflow con un Personal Access
   Token guardado en localStorage; se quitó porque el tablero lo
   abren clientes y un token con permiso `workflow` no debe vivir
   en su navegador. Para forzar una corrida: GitHub > Actions.
   La píldora abre un desplegable con el detalle de la sincronización
   (fechas, próximo automático y carpetas de Drive), como en Terminal
   Pesquero. Cada vista puede registrar su detalle con setDetail(); las
   que no lo hacen muestran el de las ventas ('default', main.js).
   Expone window.Sheets.
   ============================================================ */

(function (global) {
  // Hora del activador diario de scripts/disparar-actualizacion.gs (Lima): lanza ventas, objetivos y pauta.
  const SYNC_HOUR = 10;
  const SYNC_MINUTE = 30;
  // Más de un día y medio sin cambios: la fecha de los JSON solo cambia cuando cambian los datos,
  // así que no prueba que la corrida falló, pero con descargas diarias es para revisar.
  const STALE_MS = 36 * 3600 * 1000;
  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const state = {
    generated: null,
    loading: false,
    onUpdate: null,
    view: null,
    details: {},   // { [viewId | 'default']: { generated, rows, sources, note } }
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);

  // Fechas sin zona (las ventas) vienen en hora de Lima; las ISO con Z, en UTC.
  const parseStamp = iso => {
    if (!iso) return null;
    const t = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + '-05:00');
    return isNaN(t.getTime()) ? null : t;
  };
  // "mar 13 oct, 17:23" en hora de Lima (UTC-5, sin horario de verano).
  function formatStamp(date) {
    const l = new Date(date.getTime() - 5 * 3600 * 1000);
    const hh = String(l.getUTCHours()).padStart(2, '0');
    const mm = String(l.getUTCMinutes()).padStart(2, '0');
    return `${DAYS[l.getUTCDay()]} ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]}, ${hh}:${mm}`;
  }
  function nextSync() {
    const now = Date.now();
    const l = new Date(now - 5 * 3600 * 1000);
    let t = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), SYNC_HOUR + 5, SYNC_MINUTE);
    if (t <= now) t += 24 * 3600 * 1000;
    return new Date(t);
  }

  const currentDetail = () => state.details[state.view] || state.details.default || { generated: state.generated };
  const isStale = generated => {
    const t = parseStamp(generated);
    return !!t && Date.now() - t.getTime() > STALE_MS;
  };

  // ── Formatters ──
  function formatRelative(iso) {
    if (!iso) return 'sin datos';
    const then = parseStamp(iso);
    if (!then) return iso;
    const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
    if (diffMin < 1)   return 'hace segundos';
    if (diffMin < 60)  return `hace ${diffMin} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24)    return `hace ${diffH} h`;
    const diffD = Math.round(diffH / 24);
    return `hace ${diffD} d`;
  }

  // ── Render del indicador ──
  function renderIndicator() {
    const el = document.getElementById('sync-indicator');
    if (!el) return;
    const { generated } = currentDetail();
    const classes = ['topbar-pill', 'sync'];
    classes.push(state.loading ? 'loading' : !generated || isStale(generated) ? 'warn' : 'ok');
    el.className = classes.join(' ');
    const label = state.loading
      ? 'Recargando…'
      : generated ? `Sincronizado · ${formatRelative(generated)}` : 'Aún no sincronizado';
    el.innerHTML = '<span class="sync-dot"></span><span></span><svg class="status-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    el.children[1].textContent = label;
    renderCard();
  }

  // ── Desplegable con el detalle ──
  const row = ({ label, value, href }) => {
    const url = safeUrl(href);
    return `<div class="data-status-row"><span>${esc(label)}</span><strong>${esc(value || '—')}${url
      ? ` <a href="${esc(url)}" target="_blank" rel="noopener">Abrir ↗</a>` : ''}</strong></div>`;
  };

  function renderCard() {
    const card = document.getElementById('sync-card');
    if (!card) return;
    const d = currentDetail();
    const t = parseStamp(d.generated);
    const note = d.note || (t && isStale(d.generated)
      ? `Los datos no cambian desde ${formatRelative(d.generated)}.` : '');
    card.innerHTML = `
      <div class="data-status-head">Sincronización de los datos</div>
      ${(d.rows || []).map(row).join('')}
      ${row({ label: 'Datos actualizados', value: t ? formatStamp(t) : 'sin registro' })}
      ${row({ label: 'Próximo automático', value: `${formatStamp(nextSync())} · cada día a las ${SYNC_HOUR}:${String(SYNC_MINUTE).padStart(2, '0')}` })}
      ${(d.sources || []).length ? `<div class="data-status-head data-status-sub">Fuentes en Google Drive</div>${d.sources.map(row).join('')}` : ''}
      ${note ? `<p class="data-status-note">${esc(note)}</p>` : ''}`;
  }

  function wireCard() {
    const button = document.getElementById('sync-indicator');
    const card = document.getElementById('sync-card');
    if (!button || !card) return;
    const close = () => {
      card.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = card.hidden;
      // El próximo automático depende de la hora: se recalcula al abrir.
      if (open) renderCard();
      card.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
      if (!card.hidden && !card.contains(event.target) && !button.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }

  function renderRefreshButton() {
    const btn = document.getElementById('btn-refresh');
    if (!btn) return;
    btn.classList.toggle('loading', state.loading);
    btn.disabled = state.loading;
  }

  function setLoading(on) {
    state.loading = on;
    renderIndicator();
    renderRefreshButton();
  }

  // ── Recarga data/ventas-2026.json (la última versión publicada) ──
  async function reload() {
    setLoading(true);
    // Publicado, los datos vienen dentro de la página: la última versión llega recargándola.
    if (global.DataLive.embedded) {
      global.location.reload();
      return;
    }
    try {
      const live = await global.DataLive.load();
      if (live.source !== 'live') throw new Error(live.error || 'sin datos');
      state.generated = live.generated;
      if (typeof state.onUpdate === 'function') state.onUpdate(live);
    } catch (err) {
      console.error('[sheets] no se pudo recargar', err);
      alert('No se pudieron recargar los datos. Intentá de nuevo en unos minutos.');
    } finally {
      setLoading(false);
    }
  }

  // ── API pública ──
  function init({ generated, onUpdate }) {
    state.generated = generated || null;
    state.onUpdate  = onUpdate;
    renderIndicator();
    renderRefreshButton();
    wireCard();
    const refresh = document.getElementById('btn-refresh');
    if (refresh) refresh.addEventListener('click', reload);
  }

  function updateGenerated(iso) {
    state.generated = iso;
    renderIndicator();
  }

  // detail: { generated, rows: [{ label, value, href? }], sources: [...], note? }
  function setDetail(key, detail) {
    state.details[key] = detail;
    renderIndicator();
  }

  // main.js avisa qué vista está abierta: la píldora muestra la sincronización de esa vista.
  function setView(id) {
    state.view = id;
    renderIndicator();
  }

  global.Sheets = { init, reload, updateGenerated, setDetail, setView, formatRelative };
})(window);
