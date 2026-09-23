/* ============================================================
   sheets.js — indicador de sync + botón "Actualizar".
   Muestra cuándo fue la última generación del JSON y permite
   recargar los datos publicados sin refrescar la página.
   Los datos nuevos llegan solos: el workflow "Actualizar datos
   de ventas" corre cada lunes y vuelve a publicar el tablero.
   Antes el botón disparaba ese workflow con un Personal Access
   Token guardado en localStorage; se quitó porque el tablero lo
   abren clientes y un token con permiso `workflow` no debe vivir
   en su navegador. Para forzar una corrida: GitHub > Actions.
   Expone window.Sheets.
   ============================================================ */

(function (global) {
  const state = {
    generated: null,
    loading: false,
    onUpdate: null,
  };

  // ── Formatters ──
  function formatRelative(iso) {
    if (!iso) return 'sin datos';
    const then = new Date(iso.endsWith('Z') ? iso : iso + '-05:00');
    if (isNaN(then.getTime())) return iso;
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
    const classes = ['topbar-pill', 'sync'];
    classes.push(state.loading ? 'loading' : 'ok');
    el.className = classes.join(' ');
    const label = state.loading
      ? 'Recargando…'
      : `Sincronizado · ${formatRelative(state.generated)}`;
    el.innerHTML = '<span class="sync-dot"></span><span></span>';
    el.lastElementChild.textContent = label;
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
    const refresh = document.getElementById('btn-refresh');
    if (refresh) refresh.addEventListener('click', reload);
  }

  function updateGenerated(iso) {
    state.generated = iso;
    renderIndicator();
  }

  global.Sheets = { init, reload, updateGenerated };
})(window);
