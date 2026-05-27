/* ============================================================
   config.js — Módulo Usuarios y Claves.
   Gestiona los destinatarios del sistema de alertas semanales.
   Sin Supabase: persistencia en localStorage + export a JSON.

   Expone window.Config.render() y window.Config.state
   ============================================================ */

(function (global) {

  const LS_KEY = 'lr_alertas_config';

  // Defaults precargados (los dos admins del sistema)
  const DEFAULT_USUARIOS = [
    { nombre: 'Jorge Luis', email: 'jorgeluis@limaretail.com', orden: 1, rol: 'Superadmin', estado: 'activo', alertas: true },
    { nombre: 'Diego',      email: 'diego@limaretail.com',     orden: 2, rol: 'Superadmin', estado: 'activo', alertas: true },
  ];

  const state = {
    usuarios: [],
    editando: null,   // email del usuario en modo edición
  };

  // ── Persistencia ─────────────────────────────────────────────
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.usuarios) && saved.usuarios.length > 0) {
        state.usuarios = saved.usuarios;
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function saveToStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version  : '1',
        updated  : new Date().toISOString().slice(0, 10),
        usuarios : state.usuarios,
      }));
    } catch (e) { /* ignore */ }
  }

  function exportarConfig() {
    const payload = {
      workspace    : 'Lima Retail · Dashboard Ventas',
      url_dashboard: 'https://jorgeluis666.github.io/objetivo-canales-ventas/',
      from_name    : 'Lima Retail Alertas',
      from_email   : 'alertas@limaretail.com',
      destinatarios: state.usuarios
        .filter(u => u.estado === 'activo' && u.alertas !== false)
        .sort((a, b) => (a.orden || 99) - (b.orden || 99))
        .map(u => ({ email: u.email, nombre: u.nombre })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'alertas-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMsg('Archivo descargado. Reemplazá <code>data/alertas-config.json</code> en el repo y hacé push.', 'ok');
  }

  // ── Helpers UI ────────────────────────────────────────────────
  function showMsg(html, type) {
    const el = document.getElementById('cfg-msg');
    if (!el) return;
    el.innerHTML = html;
    el.style.display = 'block';
    el.className = 'cfg-msg cfg-msg-' + (type || 'ok');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  function alertasPill(alertas) {
    const on  = alertas !== false;
    const cls = on ? 'green' : 'muted';
    const lbl = on ? '📧 Alertas ON' : 'Sin alertas';
    return `<span class="cfg-pill cfg-pill-${cls}">${lbl}</span>`;
  }

  function rolPill(rol) {
    const map = {
      'Superadmin': 'brand',
      'Admin'     : 'brand',
      'Editor'    : 'amber',
      'Viewer'    : 'muted',
    };
    const cls = map[rol] || 'muted';
    return `<span class="cfg-pill cfg-pill-${cls}">${rol}</span>`;
  }

  function estadoPill(estado) {
    const cls = estado === 'activo' ? 'green' : 'amber';
    const lbl = estado === 'activo' ? 'Activo' : 'Pendiente';
    return `<span class="cfg-pill cfg-pill-${cls}">${lbl}</span>`;
  }

  // ── Render principal ──────────────────────────────────────────
  function render() {
    const host = document.getElementById('config-usuarios-list');
    if (!host) return;

    if (state.usuarios.length === 0) {
      host.innerHTML = `
        <div class="panel" style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">
          Sin usuarios. Agregá el primero con el formulario de arriba.
        </div>`;
      return;
    }

    host.innerHTML = state.usuarios
      .slice()
      .sort((a, b) => (a.orden || 99) - (b.orden || 99))
      .map(u => renderUserCard(u))
      .join('');

    // Bind botones de cada card
    state.usuarios.forEach(u => bindCard(u.email));

    // Bind exportar
    const btnExp = document.getElementById('cfg-btn-exportar');
    if (btnExp && !btnExp.dataset.wired) {
      btnExp.dataset.wired = '1';
      btnExp.addEventListener('click', exportarConfig);
    }
  }

  function renderUserCard(u) {
    const isEditing = state.editando === u.email;
    return `
    <div class="panel cfg-user-card" id="cfg-card-${CSS.escape(u.email)}" style="margin-bottom:12px;">
      <div class="cfg-user-head">
        <div class="cfg-user-info">
          <div class="cfg-user-name">${u.nombre}</div>
          <div class="cfg-user-email">${u.email}</div>
        </div>
        <div class="cfg-user-actions">
          ${estadoPill(u.estado)}
          ${rolPill(u.rol || 'Admin')}
          ${alertasPill(u.alertas)}
          <button class="btn ghost btn-sm cfg-edit-btn" data-email="${u.email}">
            ${isEditing ? 'Cancelar' : 'Editar'}
          </button>
        </div>
      </div>

      ${isEditing ? `
      <div class="cfg-edit-form">
        <div class="cfg-edit-grid">
          <div class="cfg-field">
            <label class="cfg-label">Clave (email)</label>
            <input class="inp" type="email" id="cfg-edit-email-${u.email}" value="${u.email}" autocomplete="off">
          </div>
          <div class="cfg-field">
            <label class="cfg-label">Nombre</label>
            <input class="inp" type="text" id="cfg-edit-nombre-${u.email}" value="${u.nombre}" autocomplete="off">
          </div>
          <div class="cfg-field cfg-field-sm">
            <label class="cfg-label">Orden</label>
            <input class="inp" type="number" id="cfg-edit-orden-${u.email}" value="${u.orden || 1}" min="1" max="99">
          </div>
          <div class="cfg-field">
            <label class="cfg-label">Rol</label>
            <select class="inp" id="cfg-edit-rol-${u.email}">
              <option value="Superadmin"  ${u.rol === 'Superadmin' ? 'selected' : ''}>Superadmin</option>
              <option value="Admin"       ${u.rol === 'Admin'      ? 'selected' : ''}>Admin</option>
              <option value="Editor"      ${u.rol === 'Editor'     ? 'selected' : ''}>Editor</option>
              <option value="Viewer"      ${u.rol === 'Viewer'     ? 'selected' : ''}>Viewer</option>
            </select>
          </div>
          <div class="cfg-field cfg-field-check">
            <label class="cfg-label">Alertas</label>
            <label class="cfg-check-label">
              <input type="checkbox" id="cfg-edit-alertas-${u.email}" ${u.alertas !== false ? 'checked' : ''}>
              Recibir alerta semanal por email
            </label>
          </div>
        </div>
        <div class="cfg-edit-actions">
          <button class="btn primary cfg-guardar-btn" data-email="${u.email}">Guardar</button>
          <button class="btn danger cfg-eliminar-btn" data-email="${u.email}">Eliminar</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  function bindCard(email) {
    // Editar / Cancelar
    const editBtn = document.querySelector(`.cfg-edit-btn[data-email="${email}"]`);
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        state.editando = state.editando === email ? null : email;
        render();
      });
    }

    // Guardar
    const guardarBtn = document.querySelector(`.cfg-guardar-btn[data-email="${email}"]`);
    if (guardarBtn) {
      guardarBtn.addEventListener('click', () => {
        const newEmail   = document.getElementById(`cfg-edit-email-${email}`)?.value?.trim();
        const newNombre  = document.getElementById(`cfg-edit-nombre-${email}`)?.value?.trim();
        const newOrden   = parseInt(document.getElementById(`cfg-edit-orden-${email}`)?.value) || 1;
        const newRol     = document.getElementById(`cfg-edit-rol-${email}`)?.value || 'Admin';
        const newAlertas = !!(document.getElementById(`cfg-edit-alertas-${email}`)?.checked);

        if (!newEmail || !newNombre) {
          showMsg('Nombre y email son obligatorios.', 'err');
          return;
        }

        const idx = state.usuarios.findIndex(u => u.email === email);
        if (idx >= 0) {
          state.usuarios[idx] = { ...state.usuarios[idx], email: newEmail, nombre: newNombre, orden: newOrden, rol: newRol, alertas: newAlertas };
        }

        state.editando = null;
        saveToStorage();
        render();
        showMsg('Usuario actualizado.', 'ok');
      });
    }

    // Eliminar
    const eliminarBtn = document.querySelector(`.cfg-eliminar-btn[data-email="${email}"]`);
    if (eliminarBtn) {
      eliminarBtn.addEventListener('click', () => {
        const u = state.usuarios.find(u => u.email === email);
        if (!confirm(`¿Eliminar a ${u?.nombre || email} del sistema de alertas?`)) return;
        state.usuarios = state.usuarios.filter(u => u.email !== email);
        state.editando = null;
        saveToStorage();
        render();
        showMsg('Usuario eliminado.', 'ok');
      });
    }
  }

  // ── Wire formulario de agregar ────────────────────────────────
  function wireAddForm() {
    const btn = document.getElementById('cfg-btn-agregar');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const nombre  = document.getElementById('cfg-nombre')?.value?.trim();
      const email   = document.getElementById('cfg-email')?.value?.trim()?.toLowerCase();
      const orden   = parseInt(document.getElementById('cfg-orden')?.value) || (state.usuarios.length + 1);
      const alertas = document.getElementById('cfg-alertas')?.checked !== false;

      if (!nombre || !email) {
        showMsg('Nombre y email son obligatorios.', 'err');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMsg('El email no tiene un formato válido.', 'err');
        return;
      }
      if (state.usuarios.some(u => u.email === email)) {
        showMsg('Ya existe un usuario con ese email.', 'err');
        return;
      }

      state.usuarios.push({ nombre, email, orden, rol: 'Admin', estado: 'activo', alertas });
      saveToStorage();

      // Reset form
      document.getElementById('cfg-nombre').value = '';
      document.getElementById('cfg-email').value  = '';
      document.getElementById('cfg-orden').value  = '';

      render();
      showMsg(`Usuario <strong>${nombre}</strong> agregado.`, 'ok');
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const loaded = loadFromStorage();
    if (!loaded) {
      state.usuarios = JSON.parse(JSON.stringify(DEFAULT_USUARIOS));
    }
    wireAddForm();
    render();

    // Bind exportar (puede estar fuera de render si la vista ya existía)
    const btnExp = document.getElementById('cfg-btn-exportar');
    if (btnExp && !btnExp.dataset.wired) {
      btnExp.dataset.wired = '1';
      btnExp.addEventListener('click', exportarConfig);
    }
  }

  global.Config = { init, render, state, exportarConfig };

})(window);
