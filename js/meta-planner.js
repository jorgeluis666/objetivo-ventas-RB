/* ============================================================
   meta-planner.js — planificación de pauta Web (CPA) + WhatsApp (CPL)
   Persistencia local por cliente e historial de versiones.
   ============================================================ */

(function (global) {
  const STORE_KEY = 'rb_meta_planner_v1';

  const WEB_DEFAULTS = [
    { name: 'Martín Aranda', pct: 0.434, ticket: 224, cpa: 30, adjusted: null },
    { name: 'Remarketing Martín Aranda', pct: 0.266, ticket: 224, cpa: 30, adjusted: null },
    { name: 'Benedetta', pct: 0.124, ticket: 331, cpa: 30, adjusted: null },
    { name: 'Remarketing Benedetta', pct: 0.076, ticket: 331, cpa: 30, adjusted: null },
    { name: 'Diversidad Creativa', pct: 0.1, ticket: 224, cpa: 30, adjusted: null },
  ];

  const MESSAGE_DEFAULTS = [
    { name: 'Martín Aranda', messages: 100, cpl: 2.5 },
    { name: 'Benedetta', messages: 100, cpl: 2.5 },
    { name: 'Outlet', messages: 100, cpl: 2.5 },
  ];

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const money = value => `S/ ${Math.round(value).toLocaleString('es-PE')}`;
  const numeric = value => Math.round(value).toLocaleString('es-PE');
  const decimal = value => number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function defaultSimulation() {
    return {
      webTarget: 12687,
      webActual: 0,
      messageTarget: 6090,
      messageActual: 0,
      messageTicket: 300,
      globalCpl: 2.5,
      webSets: clone(WEB_DEFAULTS),
      messageSets: clone(MESSAGE_DEFAULTS),
    };
  }

  function defaultStore() {
    const id = uid();
    return {
      activeClientId: id,
      clients: [{ id, name: 'Royal Baby', current: defaultSimulation(), versions: [] }],
    };
  }

  let store = defaultStore();
  let initialized = false;
  let els = {};

  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved?.clients?.length) store = saved;
    } catch (error) {
      console.warn('[meta-planner] no se pudo leer el estado guardado', error);
    }
    if (!store.clients.some(client => client.id === store.activeClientId)) {
      store.activeClientId = store.clients[0].id;
    }
  }

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  function activeClient() {
    return store.clients.find(client => client.id === store.activeClientId) || store.clients[0];
  }

  function calculate(simulation = activeClient().current) {
    const webRemaining = Math.max(0, number(simulation.webTarget) - number(simulation.webActual));
    let webBase = 0;
    let webAdjusted = 0;
    let webSales = 0;
    let webInvestment = 0;

    const webRows = simulation.webSets.map(set => {
      const base = webRemaining * number(set.pct);
      const adjusted = set.adjusted === null || set.adjusted === '' ? Math.round(base) : number(set.adjusted);
      const sales = adjusted / Math.max(1, number(set.ticket, 1));
      const investment = sales * number(set.cpa);
      webBase += base;
      webAdjusted += adjusted;
      webSales += sales;
      webInvestment += investment;
      return { ...set, base, adjusted, delta: adjusted - base, sales, investment };
    });

    const messageRemaining = Math.max(0, number(simulation.messageTarget) - number(simulation.messageActual));
    const messageSales = Math.ceil(messageRemaining / Math.max(1, number(simulation.messageTicket, 1)));
    let messageInvestment = 0;
    const messageRows = simulation.messageSets.map(set => {
      const investment = number(set.messages) * number(set.cpl);
      messageInvestment += investment;
      return { ...set, investment };
    });

    return {
      webRemaining, webBase, webAdjusted, webSales, webInvestment, webRows,
      messageRemaining, messageSales, messageInvestment, messageRows,
      totalInvestment: webInvestment + messageInvestment,
    };
  }

  function cacheElements() {
    [
      'meta-client-select', 'meta-version-name', 'meta-web-target', 'meta-web-actual',
      'meta-msg-target', 'meta-msg-actual', 'meta-msg-ticket', 'meta-msg-cpl',
      'meta-web-rows', 'meta-msg-rows', 'meta-history', 'meta-feedback',
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function renderClientSelect() {
    els['meta-client-select'].innerHTML = store.clients
      .map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`)
      .join('');
    els['meta-client-select'].value = store.activeClientId;
  }

  function renderInputs() {
    const sim = activeClient().current;
    els['meta-web-target'].value = sim.webTarget;
    els['meta-web-actual'].value = sim.webActual;
    els['meta-msg-target'].value = sim.messageTarget;
    els['meta-msg-actual'].value = sim.messageActual;
    els['meta-msg-ticket'].value = sim.messageTicket;
    els['meta-msg-cpl'].value = sim.globalCpl;
  }

  function numberInput(value, attrs = '', extraClass = '') {
    return `<input class="inp ${extraClass}" type="number" value="${value}" ${attrs}>`;
  }

  function renderTables() {
    const result = calculate();
    els['meta-web-rows'].innerHTML = result.webRows.map((row, index) => `
      <tr data-index="${index}">
        <td><input class="inp meta-name-input" data-field="name" type="text" value="${escapeHtml(row.name)}"></td>
        <td class="r">${numberInput(Number((row.pct * 100).toFixed(1)), 'data-field="pct" min="0" max="100" step="0.1"')}</td>
        <td class="r">${money(row.base)}</td>
        <td class="r">${numberInput(Math.round(row.adjusted), 'data-field="adjusted" min="0" step="50"', 'meta-adjust-input')}</td>
        <td class="r">${deltaMarkup(row.delta)}</td>
        <td class="r">${numberInput(row.ticket, 'data-field="ticket" min="1" step="1"')}</td>
        <td class="r">${numeric(row.sales)}</td>
        <td class="r">${numberInput(row.cpa, 'data-field="cpa" min="0" step="1"')}</td>
        <td class="r"><strong>${money(row.investment)}</strong></td>
      </tr>`).join('');

    els['meta-msg-rows'].innerHTML = result.messageRows.map((row, index) => `
      <tr data-index="${index}">
        <td><input class="inp meta-name-input" data-field="name" type="text" value="${escapeHtml(row.name)}"></td>
        <td class="r">${numberInput(row.messages, 'data-field="messages" min="0" step="10"')}</td>
        <td class="r">${numberInput(row.cpl, 'data-field="cpl" min="0" step="0.1"')}</td>
        <td class="r"><strong>${money(row.investment)}</strong></td>
      </tr>`).join('');
  }

  function renderKpis() {
    const sim = activeClient().current;
    const result = calculate(sim);
    setText('meta-web-remaining', money(result.webRemaining));
    setText('meta-web-base', money(result.webBase));
    setText('meta-web-adjusted', money(result.webAdjusted));
    setText('meta-web-sales', numeric(result.webSales));
    setText('meta-web-investment', money(result.webInvestment));
    document.getElementById('meta-web-adjusted-card').classList.toggle(
      'warning',
      Math.abs(result.webAdjusted - result.webBase) / Math.max(1, result.webBase) > 0.05
    );

    setText('meta-msg-target-kpi', money(sim.messageTarget));
    setText('meta-msg-actual-kpi', money(sim.messageActual));
    setText('meta-msg-remaining', money(result.messageRemaining));
    setText('meta-msg-sales', numeric(result.messageSales));
    setText('meta-msg-investment', money(result.messageInvestment));
    const remainingCard = document.getElementById('meta-msg-remaining-card');
    remainingCard.classList.toggle('warning', result.messageRemaining > 0 && result.messageRemaining / Math.max(1, sim.messageTarget) > 0.5);
    remainingCard.classList.toggle('success', result.messageRemaining <= 0);

    setText('meta-total-web', money(result.webInvestment));
    setText('meta-total-msg', money(result.messageInvestment));
    setText('meta-total-all', money(result.totalInvestment));
  }

  function renderHistory() {
    const versions = activeClient().versions || [];
    if (!versions.length) {
      els['meta-history'].innerHTML = '<div class="meta-history-empty">Todavía no hay versiones guardadas para este cliente.</div>';
      return;
    }
    els['meta-history'].innerHTML = `<div class="meta-history-list">${versions.map(version => `
      <div class="meta-history-item">
        <div>
          <div class="meta-history-name">${escapeHtml(version.name)}</div>
          <div class="meta-history-date">${new Date(version.createdAt).toLocaleString('es-PE')}</div>
        </div>
        <div class="meta-history-actions">
          <button class="btn ghost btn-sm" data-version-load="${version.id}">Cargar</button>
          <button class="btn danger btn-sm" data-version-delete="${version.id}">Eliminar</button>
        </div>
      </div>`).join('')}</div>`;
  }

  function renderAll() {
    renderClientSelect();
    renderInputs();
    renderTables();
    renderKpis();
    renderHistory();
  }

  function syncTopLevel(field, value) {
    activeClient().current[field] = number(value);
    if (field === 'globalCpl') {
      activeClient().current.messageSets.forEach(set => { set.cpl = number(value); });
    }
    persist();
    renderTables();
    renderKpis();
  }

  function handleTableInput(event, type, shouldRenderTable = false) {
    const target = event.target;
    const row = target.closest('tr[data-index]');
    const field = target.dataset.field;
    if (!row || !field) return;
    const index = Number(row.dataset.index);
    const sets = type === 'web' ? activeClient().current.webSets : activeClient().current.messageSets;
    if (field === 'name') {
      sets[index][field] = target.value;
    } else if (field === 'pct') {
      sets[index].pct = number(target.value) / 100;
      sets[index].adjusted = null;
    } else {
      sets[index][field] = target.value === '' && field === 'adjusted' ? null : number(target.value);
    }
    persist();
    renderKpis();
    if (shouldRenderTable && field !== 'name') renderTables();
  }

  function saveVersion() {
    const name = els['meta-version-name'].value.trim();
    if (!name) {
      feedback('Escribe un nombre para la versión.', true);
      els['meta-version-name'].focus();
      return;
    }
    activeClient().versions.unshift({
      id: uid(),
      name,
      createdAt: new Date().toISOString(),
      simulation: clone(activeClient().current),
    });
    els['meta-version-name'].value = '';
    persist();
    renderHistory();
    feedback('Versión guardada.');
  }

  function addClient() {
    const name = prompt('Nombre del nuevo cliente:');
    if (!name?.trim()) return;
    const client = { id: uid(), name: name.trim(), current: defaultSimulation(), versions: [] };
    store.clients.push(client);
    store.activeClientId = client.id;
    persist();
    renderAll();
  }

  function renameClient() {
    const client = activeClient();
    const name = prompt('Nuevo nombre del cliente:', client.name);
    if (!name?.trim()) return;
    client.name = name.trim();
    persist();
    renderClientSelect();
  }

  function copySummary() {
    const client = activeClient();
    const result = calculate(client.current);
    const lines = [
      `PLAN DE INVERSIÓN META ADS · ${client.name}`,
      '',
      'WEB / CPA',
      ...result.webRows.map(row =>
        `• ${row.name}: ${money(row.adjusted)} ÷ S/ ${decimal(row.ticket)} = ${numeric(row.sales)} ventas × CPA S/ ${decimal(row.cpa)} = ${money(row.investment)}`
      ),
      `Subtotal Web: ${money(result.webInvestment)}`,
      '',
      'MENSAJES / WHATSAPP',
      ...result.messageRows.map(row =>
        `• ${row.name}: ${numeric(row.messages)} mensajes × S/ ${decimal(row.cpl)} = ${money(row.investment)}`
      ),
      `Subtotal Mensajes: ${money(result.messageInvestment)}`,
      '',
      `INVERSIÓN TOTAL META ADS: ${money(result.totalInvestment)}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => feedback('Resumen copiado al portapapeles.'))
      .catch(() => feedback('No se pudo acceder al portapapeles.', true));
  }

  function exportXlsx() {
    if (!global.XLSX) {
      feedback('No se pudo cargar el generador de Excel.', true);
      return;
    }
    const client = activeClient();
    const result = calculate(client.current);
    const rows = [
      [`PLAN DE INVERSIÓN META ADS · ${client.name}`],
      [],
      ['MÓDULO 1 · WEB / CPA'],
      ['Conjunto', '% fact.', 'Fact. base (S/)', 'Fact. ajustada (S/)', 'Δ', 'Ticket (S/)', 'Ventas', 'CPA (S/)', 'Inversión (S/)'],
      ...result.webRows.map(row => [
        row.name, row.pct, Math.round(row.base), Math.round(row.adjusted), Math.round(row.delta),
        row.ticket, Math.round(row.sales), row.cpa, Math.round(row.investment),
      ]),
      ['Subtotal Web', '', '', '', '', '', '', '', Math.round(result.webInvestment)],
      [],
      ['MÓDULO 2 · MENSAJES / WHATSAPP'],
      ['Conjunto', 'Mensajes objetivo', 'Costo/Lead (S/)', 'Inversión (S/)'],
      ...result.messageRows.map(row => [row.name, row.messages, row.cpl, Math.round(row.investment)]),
      ['Subtotal Mensajes', '', '', Math.round(result.messageInvestment)],
      [],
      ['INVERSIÓN TOTAL META ADS', '', '', Math.round(result.totalInvestment)],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 21 }, { wch: 12 }, { wch: 13 }, { wch: 11 }, { wch: 12 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plan Meta Ads');
    const safeName = client.name.replace(/[^\p{L}\p{N}-]+/gu, '_');
    XLSX.writeFile(workbook, `Plan_Meta_Ads_${safeName}.xlsx`);
    feedback('Excel generado.');
  }

  function wireEvents() {
    const topLevel = {
      'meta-web-target': 'webTarget',
      'meta-web-actual': 'webActual',
      'meta-msg-target': 'messageTarget',
      'meta-msg-actual': 'messageActual',
      'meta-msg-ticket': 'messageTicket',
      'meta-msg-cpl': 'globalCpl',
    };
    Object.entries(topLevel).forEach(([id, field]) => {
      els[id].addEventListener('input', event => syncTopLevel(field, event.target.value));
    });

    els['meta-web-rows'].addEventListener('input', event => handleTableInput(event, 'web'));
    els['meta-msg-rows'].addEventListener('input', event => handleTableInput(event, 'messages'));
    els['meta-web-rows'].addEventListener('change', event => handleTableInput(event, 'web', true));
    els['meta-msg-rows'].addEventListener('change', event => handleTableInput(event, 'messages', true));
    els['meta-client-select'].addEventListener('change', event => {
      store.activeClientId = event.target.value;
      persist();
      renderAll();
    });
    document.getElementById('meta-client-add').addEventListener('click', addClient);
    document.getElementById('meta-client-rename').addEventListener('click', renameClient);
    document.getElementById('meta-version-save').addEventListener('click', saveVersion);
    document.getElementById('meta-web-reset').addEventListener('click', () => {
      activeClient().current.webSets = clone(WEB_DEFAULTS);
      persist();
      renderTables();
      renderKpis();
      feedback('Ajustes Web restablecidos.');
    });
    document.getElementById('meta-copy-summary').addEventListener('click', copySummary);
    document.getElementById('meta-export-xlsx').addEventListener('click', exportXlsx);
    els['meta-history'].addEventListener('click', event => {
      const loadId = event.target.dataset.versionLoad;
      const deleteId = event.target.dataset.versionDelete;
      if (loadId) {
        const version = activeClient().versions.find(item => item.id === loadId);
        if (version) {
          activeClient().current = clone(version.simulation);
          persist();
          renderAll();
          feedback(`Versión “${version.name}” cargada.`);
        }
      }
      if (deleteId) {
        activeClient().versions = activeClient().versions.filter(item => item.id !== deleteId);
        persist();
        renderHistory();
      }
    });
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function deltaMarkup(delta) {
    if (Math.abs(delta) < 1) return '<span class="meta-delta-zero">—</span>';
    if (delta > 0) return `<span class="meta-delta-pos">+${numeric(delta)}</span>`;
    return `<span class="meta-delta-neg">${numeric(delta)}</span>`;
  }

  function feedback(message, isError = false) {
    els['meta-feedback'].textContent = message;
    els['meta-feedback'].style.color = isError ? 'var(--red-text)' : 'var(--green-text)';
    clearTimeout(feedback.timer);
    feedback.timer = setTimeout(() => { els['meta-feedback'].textContent = ''; }, 3000);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[char]);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    loadStore();
    cacheElements();
    wireEvents();
    renderAll();
  }

  global.MetaPlanner = { init, calculate };
})(window);
