/* ============================================================
   reportes.js — Archivo de Reportes · Documentos en Drive.
   La lista de la carpeta Reportes de Drive (data/reportes-2026.json, que escribe
   scripts/sync-reportes.js cada día; al publicar va incrustado como RB_REPORTES_DATA).
   El tipo de reporte y su periodo salen del nombre del archivo: un reporte nuevo en la
   carpeta aparece solo, sin tocar este archivo.
   Expone window.Reportes = { init, load, latestWeekly }.
   ============================================================ */

(function (global) {
  const FILE = 'data/reportes-2026.json';
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const state = { data: null, query: '', type: '', wired: false };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fecha = iso => (iso ? `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—');

  // ── Carga: incrustado al publicar, data/reportes-2026.json en local ──
  let request = null;
  function load() {
    if (!request) {
      request = global.RB_REPORTES_DATA
        ? Promise.resolve(global.RB_REPORTES_DATA)
        : fetch(FILE, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(err => {
          console.warn('[reportes] no se pudo cargar', FILE, err);
          return null;
        });
    }
    return request;
  }

  // ── Lo que dice el nombre ──
  // «Reporte Royal Baby | Reporte 02 - 08 vs 09 - 15 Febrero» → semanal, «02 - 08 vs 09 - 15 Febrero».
  function tipoDe(name) {
    const n = norm(name);
    if (/\bvs\b/.test(n)) return 'Semanal';
    if (/estrategia/.test(n)) return 'Estrategia';
    if (/ejecutivo/.test(n)) return 'Ejecutivo';
    if (/reporte 20\d\d\s*$/.test(n)) return 'Anual';
    return 'Mensual';
  }
  function tituloDe(name) {
    const t = String(name || '')
      .replace(/^\s*reporte(\s+ejecutivo)?\s+royal baby\s*\|\s*/i, '')
      .replace(/^\s*royal baby\s*\|\s*/i, '')
      .replace(/^\s*reporte\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : name;
  }

  // Vista previa, enlace y PDF según el tipo de archivo (los reportes son presentaciones de Google).
  const GOOGLE = {
    'application/vnd.google-apps.presentation': 'presentation',
    'application/vnd.google-apps.document': 'document',
    'application/vnd.google-apps.spreadsheet': 'spreadsheets',
  };
  function enlaces(f) {
    const id = encodeURIComponent(f.id);
    const g = GOOGLE[f.mimeType];
    if (g) {
      return {
        preview: `https://docs.google.com/${g}/d/${id}/preview`,
        open: `https://docs.google.com/${g}/d/${id}/edit`,
        pdf: `https://docs.google.com/${g}/d/${id}/export/pdf`,
      };
    }
    return {
      preview: `https://drive.google.com/file/d/${id}/preview`,
      open: `https://drive.google.com/file/d/${id}/view`,
      pdf: f.mimeType === 'application/pdf' ? `https://drive.google.com/uc?export=download&id=${id}` : null,
    };
  }

  const files = () => (state.data?.files || []).map(f => ({ ...f, tipo: tipoDe(f.name), titulo: tituloDe(f.name), links: enlaces(f) }));

  // El último reporte semanal de la carpeta: es el modelo de Generación de Reporte.
  async function latestWeekly() {
    await load().then(d => { state.data = state.data || d; });
    return files().filter(f => f.tipo === 'Semanal').sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')))[0] || null;
  }

  // ── Pintado ──
  function render() {
    const body = document.getElementById('arch-body');
    const sub = document.getElementById('arch-sub');
    if (!body) return;
    if (!state.data) {
      body.innerHTML = '<tr><td class="gp-table-empty" colspan="4">No se pudo leer la lista de la carpeta de reportes.</td></tr>';
      if (sub) sub.textContent = 'Sin datos de la carpeta';
      return;
    }
    const all = files();
    const typeSel = document.getElementById('arch-type');
    if (typeSel && typeSel.options.length <= 1) {
      const tipos = ['Semanal', 'Mensual', 'Anual', 'Ejecutivo', 'Estrategia'].filter(t => all.some(f => f.tipo === t));
      typeSel.insertAdjacentHTML('beforeend', tipos.map(t => `<option value="${t}">${t}</option>`).join(''));
    }
    const q = norm(state.query);
    const shown = all.filter(f => (!state.type || f.tipo === state.type) && (!q || norm(`${f.name} ${f.tipo}`).includes(q)));
    const last = all.find(f => f.modified);
    if (sub) sub.textContent = `${all.length} ${all.length === 1 ? 'documento' : 'documentos'}${last ? ` · el más reciente es del ${fecha(last.modified)}` : ''}${shown.length !== all.length ? ` · ${shown.length} con este filtro` : ''}`;

    body.innerHTML = shown.length ? shown.map(f => `
      <tr>
        <td><button class="arch-name" type="button" data-arch-preview="${esc(f.id)}" title="${esc(f.name)}">${esc(f.titulo)}</button></td>
        <td><span class="pill ${f.tipo === 'Semanal' ? 'blue' : 'gray'}">${esc(f.tipo)}</span></td>
        <td class="text-2">${esc(fecha(f.modified))}</td>
        <td class="r">
          <div class="arch-actions">
            <button class="gp-tool-btn" type="button" data-arch-preview="${esc(f.id)}">Ver</button>
            <a class="gp-tool-btn" href="${esc(f.links.open)}" target="_blank" rel="noopener">Drive</a>
            ${f.links.pdf ? `<a class="gp-tool-btn" href="${esc(f.links.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}
          </div>
        </td>
      </tr>`).join('')
      : '<tr><td class="gp-table-empty" colspan="4">Ningún documento coincide con la búsqueda.</td></tr>';
  }

  // ── Vista previa en el tablero ──
  function openPreview(id) {
    const f = files().find(x => x.id === id);
    const overlay = document.getElementById('arch-preview');
    if (!f || !overlay) return;
    document.getElementById('arch-preview-title').textContent = f.titulo;
    document.getElementById('arch-preview-open').href = f.links.open;
    document.getElementById('arch-preview-frame').src = f.links.preview;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('visible'));
    overlay.querySelector('[data-arch-close]')?.focus();
  }
  function closePreview() {
    const overlay = document.getElementById('arch-preview');
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('visible');
    overlay.hidden = true;
    document.getElementById('arch-preview-frame').src = 'about:blank';
  }

  function wire() {
    if (state.wired) return;
    state.wired = true;
    document.getElementById('arch-search')?.addEventListener('input', e => { state.query = e.target.value; render(); });
    document.getElementById('arch-type')?.addEventListener('change', e => { state.type = e.target.value; render(); });
    document.getElementById('arch-body')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-arch-preview]');
      if (btn) openPreview(btn.dataset.archPreview);
    });
    const overlay = document.getElementById('arch-preview');
    overlay?.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-arch-close]')) closePreview(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });
  }

  async function init() {
    wire();
    state.data = await load();
    render();
  }

  global.Reportes = { init, load, latestWeekly };
})(window);
