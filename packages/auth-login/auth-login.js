/**
 * auth-login.js — Pantalla de acceso reutilizable
 *
 * USO:
 *   1. Copiar este archivo y login-bg.jpg al proyecto destino.
 *   2. Incluir el script antes del cierre de </body>:
 *        <script src="auth-login.js"></script>
 *   3. Llamar a AuthLogin.init({ password, bgImage, title, subtitle })
 *        justo después del <script>:
 *        AuthLogin.init({ password: 'MI_CLAVE' });
 *
 * OPCIONES:
 *   password  {string}  Contraseña requerida.              Default: 'RB2026'
 *   bgImage   {string}  Ruta a la imagen de fondo.         Default: 'login-bg.jpg'
 *   brand     {string}  Texto sobre el título.             Default: 'Lima Retail'
 *   title     {string}  Título grande del panel.           Default: 'Centro de\nControl'
 *   sessionKey{string}  Clave de sessionStorage.           Default: 'rb_auth'
 */

(function (global) {
  'use strict';

  const CSS = `
    #rb-auth-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      width: 100vw;
      height: 100vh;
    }
    #rb-auth-overlay.rb-auth-hidden { display: none; }

    #rb-auth-panel {
      width: 400px;
      flex-shrink: 0;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px 44px;
    }
    #rb-auth-inner { width: 100%; }

    #rb-auth-brand {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #b91c1c;
      margin-bottom: 16px;
      font-family: inherit;
    }
    #rb-auth-title {
      font-size: 38px;
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.02em;
      color: #0f172a;
      margin-bottom: 28px;
      white-space: pre-line;
      font-family: inherit;
    }
    #rb-auth-divider {
      width: 40px;
      height: 3px;
      background: #b91c1c;
      border-radius: 2px;
      margin-bottom: 36px;
    }
    #rb-auth-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #rb-auth-input {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1.5px solid #e5e7eb;
      background: #f8fafc;
      color: #0f172a;
      font-size: 14px;
      outline: none;
      transition: border-color .15s, background .15s;
      font-family: inherit;
      box-sizing: border-box;
    }
    #rb-auth-input::placeholder { color: #94a3b8; }
    #rb-auth-input:focus { border-color: #b91c1c; background: #fff; }

    #rb-auth-btn {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: #b91c1c;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.02em;
      transition: background .15s;
      font-family: inherit;
    }
    #rb-auth-btn:hover { background: #991b1b; }

    #rb-auth-error {
      display: none;
      margin-top: 12px;
      font-size: 12px;
      color: #dc2626;
      font-family: inherit;
    }
    #rb-auth-bg {
      flex: 1;
      height: 100%;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      filter: grayscale(20%);
    }
  `;

  function init(opts) {
    opts = opts || {};
    const PASSWORD   = opts.password   || 'RB2026';
    const BG_IMAGE   = opts.bgImage    || 'login-bg.jpg';
    const BRAND      = opts.brand      || 'Lima Retail';
    const TITLE      = opts.title      || 'Centro de\nControl';
    const SESSION_KEY = opts.sessionKey || 'rb_auth';

    // Inyectar CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Construir overlay
    const overlay = document.createElement('div');
    overlay.id = 'rb-auth-overlay';
    overlay.innerHTML = `
      <div id="rb-auth-panel">
        <div id="rb-auth-inner">
          <div id="rb-auth-brand">${BRAND}</div>
          <div id="rb-auth-title">${TITLE}</div>
          <div id="rb-auth-divider"></div>
          <form id="rb-auth-form" autocomplete="off">
            <input id="rb-auth-input" type="password" placeholder="Contraseña"
                   autocomplete="new-password" autofocus />
            <button type="submit" id="rb-auth-btn">Ingresar</button>
          </form>
          <div id="rb-auth-error">Contraseña incorrecta</div>
        </div>
      </div>
      <div id="rb-auth-bg"></div>
    `;
    document.body.insertBefore(overlay, document.body.firstChild);

    // Imagen de fondo
    document.getElementById('rb-auth-bg').style.backgroundImage = `url('${BG_IMAGE}')`;

    function unlock() {
      overlay.classList.add('rb-auth-hidden');
      sessionStorage.setItem(SESSION_KEY, '1');
    }

    // Si ya autenticó en esta sesión, desbloquear directo
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      unlock();
      return;
    }

    document.getElementById('rb-auth-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const input  = document.getElementById('rb-auth-input');
      const errMsg = document.getElementById('rb-auth-error');
      if (input.value === PASSWORD) {
        errMsg.style.display = 'none';
        unlock();
      } else {
        input.value = '';
        errMsg.style.display = 'block';
        input.focus();
      }
    });
  }

  global.AuthLogin = { init };

})(window);
