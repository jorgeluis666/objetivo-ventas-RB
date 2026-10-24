/* ============================================================
   fuentes-drive.js — lectura de las hojas de Drive de la marca.

   La usan los botones Sincronizar del módulo Objetivos (navegador)
   y la corrida diaria (scripts/sync-objetivos.js y fetch-data.js):
   con la misma hoja, ambos producen las mismas cifras.

   - Objetivos: carpeta "Objetivos Royal Baby". Pestaña "Objetivos 2026":
     encabezado «Canal» con los meses a la derecha, una fila por canal
     y la fila «Total»; pestaña "Venta 2025" con la misma tabla, que es
     la referencia del año anterior. También lee el formato anterior
     (meses con columnas PROYECCIÓN / VENTA y el bloque "TRIMESTRE 2025"
     arriba). La venta del tablero sale siempre del histórico.
   - Ventas: carpeta "Ventas Royal Baby - 2026". Una pestaña por mes
     con pares de filas CANTIDAD / MONTO por día y la fecha en FECHA.
     Las ventas se agrupan por el ciclo de venta (js/ciclo.js: cada mes
     va del 27 del anterior al 26), según la fecha de cada día.

   Las carpetas son privadas: los archivos se descargan como .xlsx por
   el Apps Script de Royal Baby (scripts/disparar-actualizacion.gs),
   con su clave de lectura. En Node la URL y la clave llegan por
   RB_DRIVE_SCRIPT_URL y RB_DRIVE_READ_KEY; en el navegador, por
   window.RB_DRIVE_LECTURA, que solo existe dentro del HTML cifrado.
   Sin ellas se usa la exportación pública de Google Sheets.
   Expone window.FuentesDrive en el navegador y module.exports en Node.
   ============================================================ */

(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./ciclo.js') : root.Ciclo);
  if (node) module.exports = api;
  else root.FuentesDrive = api;
})(typeof self !== 'undefined' ? self : this, function (Ciclo) {
  const CARPETAS = {
    objetivos: '1wfOOM4F3TRcxehX_dfZWDYSTVBPrPgjg',
    ventas:    '1JJdjIzDu2CrhcBI9gBUTUuPAXnKYUQal',
  };

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
    'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const urlHoja  = id => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
  const urlXlsx  = id => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx`;
  const urlCarpeta = id => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

  // Mayúsculas sin tildes ni espacios sobrantes: "Proyección " → "PROYECCION".
  const norm = v => String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();

  // Nombre de mes normalizado → nombre del tablero. En Perú se escribe también "Setiembre".
  const MES_POR_NOMBRE = Object.fromEntries(MESES.map(m => [norm(m), m]));
  MES_POR_NOMBRE.SETIEMBRE = 'Septiembre';

  const round2 = n => Math.round(n * 100) / 100;

  // Monto de una celda: número crudo o texto con formato peruano ("S/ 4.034,50")
  // o inglés ("S/.1,721.20"). El último separador seguido de 1 o 2 dígitos es el decimal.
  function toNumber(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v).replace(/S\/\.?/gi, '').replace(/\s/g, '');
    if (s === '' || /^-+$/.test(s)) return 0;
    const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    s = last >= 0 && /^\d{1,2}$/.test(s.slice(last + 1))
      ? s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1)
      : s.replace(/[.,]/g, '');
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  const esVacia = v => v == null || String(v).trim() === '';

  // ── Descarga ─────────────────────────────────────────────────────

  // { url, clave } del lector privado (Apps Script), o null si no está configurado.
  function lecturaPrivada() {
    const env = typeof process !== 'undefined' && process.env ? process.env : {};
    const cfg = env.RB_DRIVE_SCRIPT_URL
      ? { url: env.RB_DRIVE_SCRIPT_URL, clave: env.RB_DRIVE_READ_KEY }
      : (typeof globalThis !== 'undefined' && globalThis.RB_DRIVE_LECTURA) || {};
    const url = String(cfg.url || '').trim();
    const clave = String(cfg.clave || '').trim();
    return url && clave ? { url, clave } : null;
  }

  // Le pide algo al Apps Script. La clave va en el cuerpo del POST, nunca en la URL; el cuerpo como
  // formulario no necesita preflight de CORS y el Apps Script lo lee en event.parameter.
  async function pedirLectura(campos, { fetchImpl, timeoutMs = 120000 } = {}) {
    const cfg = lecturaPrivada();
    if (!cfg) throw new Error('falta la URL o la clave del lector de Drive');
    const opts = { method: 'POST', body: new URLSearchParams({ ...campos, clave: cfg.clave }), redirect: 'follow' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(timeoutMs);
    const res = await (fetchImpl || fetch)(cfg.url, opts);
    if (!res.ok) throw new Error(`el lector de Drive respondió HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`el lector de Drive no lo entregó: ${body.error || 'respuesta inválida'}`);
    return body;
  }

  // Los archivos de una carpeta privada: [{ id, name, mimeType, modifiedTime }].
  async function listarPrivado(carpeta, opts) {
    return (await pedirLectura({ action: 'listar', carpeta }, opts)).files || [];
  }

  // Un archivo de una carpeta privada como bytes. Las hojas de Google salen en `formato` (xlsx o csv).
  async function descargarPrivado(id, formato, opts) {
    const { base64 } = await pedirLectura({ action: 'descargar', id, formato }, opts);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64 || '', 'base64'));
    const bin = atob(base64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Devuelve { pestaña: filas } con los valores crudos de cada celda. Las filas arrancan
  // siempre en A1, aunque la hoja tenga filas o columnas vacías al inicio: los índices
  // de columna del parser de ventas dependen de eso.
  async function descargarLibro(id, { XLSX, fetchImpl, timeoutMs = 60000 } = {}) {
    if (!XLSX) throw new Error('falta la librería SheetJS (XLSX)');
    let bytes;
    if (lecturaPrivada()) {
      bytes = await descargarPrivado(id, 'xlsx', { fetchImpl, timeoutMs: Math.max(timeoutMs, 120000) });
    } else {
      const opts = { redirect: 'follow' };
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(timeoutMs);
      const res = await (fetchImpl || fetch)(urlXlsx(id), opts);
      if (!res.ok) throw new Error(`Drive respondió HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    // Un .xlsx es un zip ("PK"). Si el archivo no es accesible, Drive devuelve una página de acceso.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('Drive no devolvió una hoja de cálculo (la carpeta es privada: falta el lector de Drive)');
    }
    const wb = XLSX.read(bytes, { type: 'array' });
    const tabs = {};
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) { tabs[name] = []; return; }
      const range = XLSX.utils.decode_range(ws['!ref']);
      range.s.r = 0;
      range.s.c = 0;
      tabs[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range });
    });
    return tabs;
  }

  // ── Objetivos ────────────────────────────────────────────────────

  // Canales del tablero. Las etiquetas del archivo se reconocen por sus alias.
  // "WHATSAPP" del archivo es el canal Redes y WhatsApp (su referencia 2025 incluye Instagram y Facebook).
  const CANALES = [
    { key: 'Tienda', label: 'Tienda Miraflores', sheet: ['Tienda'], alias: ['TIENDA', 'TIENDA MIRAFLORES', 'TIENDA FISICA'] },
    { key: 'Web',    label: 'Página Web',        sheet: ['Web'],    alias: ['WEB', 'PAGINA WEB'] },
    { key: 'Redes',  label: 'Redes y WhatsApp',  sheet: ['WhatsApp', 'Instagram', 'Facebook'],
      alias: ['WHATSAPP', 'REDES', 'REDES Y WHATSAPP', 'REDES Y WSP'] },
    { key: 'Outlet', label: 'Outlet (Showroom)', sheet: ['Showroom'], alias: ['OUTLET', 'SHOWROOM', 'OUTLET (SHOWROOM)'],
      nota: 'Mide solo el Showroom: las ventas outlet de la web se registran en Web y el histórico no las separa.' },
  ];
  const CANAL_POR_ALIAS = {};
  CANALES.forEach(c => c.alias.forEach(a => { CANAL_POR_ALIAS[a] = c; }));

  // Lee la pestaña de objetivos. Lanza un error si falta la fila de meses, la columna
  // PROYECCIÓN de algún mes o si aparece un canal que el tablero no conoce.
  function parseObjetivos(filas) {
    const avisos = [];

    // 1. Fila de meses: la que más nombres de mes tiene.
    let filaMeses = -1, meses = [];
    filas.forEach((fila, r) => {
      const encontrados = [];
      (fila || []).forEach((celda, c) => {
        const mes = MES_POR_NOMBRE[norm(celda)];
        if (mes) encontrados.push({ mes, col: c });
      });
      if (encontrados.length > meses.length) { filaMeses = r; meses = encontrados; }
    });
    if (filaMeses < 0) throw new Error('no encontré la fila con los meses (OCTUBRE, NOVIEMBRE…)');
    meses.sort((a, b) => a.col - b.col);

    // 2. Debajo, dentro del bloque de cada mes, la columna PROYECCIÓN es la meta.
    const sub = filas[filaMeses + 1] || [];
    meses.forEach((m, i) => {
      const fin = i + 1 < meses.length ? meses[i + 1].col : Math.max(sub.length, m.col + 1);
      for (let c = m.col; c < fin; c++) {
        if (/^(PROYEC|META|OBJETIVO)/.test(norm(sub[c]))) { m.colMeta = c; break; }
      }
      if (m.colMeta == null) throw new Error(`no encontré la columna PROYECCIÓN de ${m.mes}`);
    });
    const primeraCol = meses[0].col;
    const etiquetaDe = fila => {
      for (let c = 0; c < primeraCol; c++) if (!esVacia(fila[c])) return String(fila[c]).trim();
      return '';
    };

    // 3. Filas de canal: etiqueta a la izquierda del primer mes, hasta la primera fila sin etiqueta.
    const canales = [];
    const metas = Object.fromEntries(meses.map(m => [m.mes, {}]));
    let r = filaMeses + 2;
    for (; r < filas.length; r++) {
      const fila = filas[r] || [];
      const etiqueta = etiquetaDe(fila);
      if (!etiqueta) break;
      const def = CANAL_POR_ALIAS[norm(etiqueta)];
      if (!def) throw new Error(`canal desconocido «${etiqueta}»: el tablero reconoce Tienda, Web, WhatsApp/Redes y Outlet`);
      if (canales.some(c => c.key === def.key)) throw new Error(`el canal «${etiqueta}» aparece dos veces`);
      const { alias, ...canal } = def;
      canales.push({ ...canal, etiqueta });
      meses.forEach(m => { metas[m.mes][def.key] = round2(toNumber(fila[m.colMeta])); });
    }
    if (!canales.length) throw new Error('no encontré filas de canal debajo de los meses');

    // La fila siguiente, sin etiqueta, es el total del archivo: solo se usa para avisar si no cuadra.
    const filaTotal = filas[r] || [];
    meses.forEach(m => {
      if (esVacia(filaTotal[m.colMeta])) return;
      const suma = canales.reduce((s, c) => s + metas[m.mes][c.key], 0);
      const total = toNumber(filaTotal[m.colMeta]);
      if (Math.abs(total - suma) > 1) avisos.push(`${m.mes}: el total del archivo (S/ ${round2(total)}) no coincide con la suma de canales (S/ ${round2(suma)})`);
    });

    // 4. Referencia del año anterior: arriba, un título con año ("TRIMESTRE 2025") y filas sin
    //    etiqueta en el mismo orden que los canales; la última puede ser el total.
    let referencia = null;
    let filaTitulo = -1, anioRef = null, tituloRef = '';
    for (let i = 0; i < filaMeses; i++) {
      for (const celda of filas[i] || []) {
        const anio = String(celda).match(/\b(20\d{2})\b/);
        if (anio) { filaTitulo = i; anioRef = Number(anio[1]); tituloRef = String(celda).trim(); break; }
      }
      if (filaTitulo >= 0) break;
    }
    if (filaTitulo >= 0) {
      const filasRef = [];
      for (let i = filaTitulo + 1; i < filaMeses; i++) {
        const fila = filas[i] || [];
        if (meses.some(m => !esVacia(fila[m.colMeta]))) filasRef.push(fila);
      }
      if (filasRef.length === canales.length || filasRef.length === canales.length + 1) {
        const valores = Object.fromEntries(meses.map(m => [m.mes,
          Object.fromEntries(canales.map((c, k) => [c.key, round2(toNumber(filasRef[k][m.colMeta]))]))]));
        referencia = { anio: anioRef, etiqueta: tituloRef, valores };
      } else {
        avisos.push(`la referencia «${tituloRef}» tiene ${filasRef.length} filas con montos y hay ${canales.length} canales: no se usa`);
      }
    }

    return { canales, meses: meses.map(m => m.mes), metas, referencia, avisos };
  }

  // Formato tabla (el archivo de objetivos desde octubre de 2026): una fila de encabezado con «Canal»
  // y los meses a su derecha («Octubre», «Noviembre»…), una fila por canal debajo y, al final, la fila
  // «Total». Devuelve null si la pestaña no tiene ese encabezado; lanza un error si lo tiene pero un
  // canal no se reconoce.
  function parseTablaObjetivos(filas) {
    const mesDe = celda => MES_POR_NOMBRE[norm(celda).replace(/\s*\b20\d{2}$/, '')];
    let filaHead = -1, colCanal = -1, meses = [];
    filas.forEach((fila, r) => {
      if (filaHead >= 0) return;
      const c = (fila || []).findIndex(celda => norm(celda) === 'CANAL');
      if (c < 0) return;
      const encontrados = [];
      (fila || []).forEach((celda, col) => { if (col > c && mesDe(celda)) encontrados.push({ mes: mesDe(celda), col }); });
      if (encontrados.length) { filaHead = r; colCanal = c; meses = encontrados; }
    });
    if (filaHead < 0) return null;

    const avisos = [];
    const canales = [];
    const metas = Object.fromEntries(meses.map(m => [m.mes, {}]));
    let filaTotal = null;
    for (let r = filaHead + 1; r < filas.length; r++) {
      const fila = filas[r] || [];
      const etiqueta = esVacia(fila[colCanal]) ? '' : String(fila[colCanal]).trim();
      if (!etiqueta) break;
      if (norm(etiqueta).startsWith('TOTAL')) { filaTotal = fila; break; }
      const def = CANAL_POR_ALIAS[norm(etiqueta)];
      if (!def) throw new Error(`canal desconocido «${etiqueta}»: el tablero reconoce Tienda, Web, WhatsApp/Redes y Outlet`);
      if (canales.some(c => c.key === def.key)) throw new Error(`el canal «${etiqueta}» aparece dos veces`);
      const { alias, ...canal } = def;
      canales.push({ ...canal, etiqueta });
      meses.forEach(m => { metas[m.mes][def.key] = round2(toNumber(fila[m.col])); });
    }
    if (!canales.length) throw new Error('no encontré filas de canal debajo del encabezado «Canal»');
    if (filaTotal) {
      meses.forEach(m => {
        if (esVacia(filaTotal[m.col])) return;
        const suma = canales.reduce((s, c) => s + metas[m.mes][c.key], 0);
        const total = toNumber(filaTotal[m.col]);
        if (Math.abs(total - suma) > 1) avisos.push(`${m.mes}: el total del archivo (S/ ${round2(total)}) no coincide con la suma de canales (S/ ${round2(suma)})`);
      });
    }
    return { canales, meses: meses.map(m => m.mes), metas, avisos };
  }

  // Libro en formato tabla: la pestaña con «Objetivo» en el nombre trae las metas y otra pestaña con un
  // año en el nombre («Venta 2025»), la referencia del año anterior. null si ninguna pestaña es una tabla.
  function objetivosDeTablas(tabs) {
    const tablas = Object.entries(tabs)
      .map(([pestana, filas]) => ({ pestana, tabla: parseTablaObjetivos(filas) }))
      .filter(t => t.tabla);
    if (!tablas.length) return null;
    const principal = tablas.find(t => norm(t.pestana).includes('OBJETIVO')) || tablas[0];
    const { canales, meses, metas, avisos } = principal.tabla;
    let referencia = null;
    const ref = tablas.find(t => t !== principal && /\b20\d{2}\b/.test(t.pestana));
    if (ref) {
      const valores = Object.fromEntries(meses.map(mes => [mes,
        Object.fromEntries(canales.map(c => [c.key, (ref.tabla.metas[mes] || {})[c.key] || 0]))]));
      referencia = { anio: Number(ref.pestana.match(/\b(20\d{2})\b/)[1]), etiqueta: ref.pestana.trim(), valores };
      ref.tabla.avisos.forEach(a => avisos.push(`${ref.pestana.trim()}: ${a}`));
    }
    return { pestana: principal.pestana, canales, meses, metas, referencia, avisos };
  }

  // Busca la pestaña con objetivos: el formato tabla si el libro lo tiene; si no, el formato anterior
  // (meses con PROYECCIÓN y VENTA), la primera pestaña que se puede leer.
  function objetivosDelLibro(tabs) {
    const tablas = objetivosDeTablas(tabs);
    if (tablas) return tablas;
    let primerError = null;
    for (const [pestana, filas] of Object.entries(tabs)) {
      try {
        return { pestana, ...parseObjetivos(filas) };
      } catch (err) {
        primerError = primerError || `${pestana}: ${err.message}`;
      }
    }
    throw new Error(primerError || 'el archivo no tiene pestañas');
  }

  // ── Ventas ───────────────────────────────────────────────────────

  function monthsForYear(year) {
    const bisiesto = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const dias = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return MESES.map((name, monthIndex) => ({ sheet: norm(name), name, monthIndex, days: dias[monthIndex] }));
  }

  // Columnas de la pestaña de cada mes:
  //   2025 (A–H): FECHA | CANT/MONTO | WHATSAPP | INSTAGRAM | FACEBOOK | WEB | TIENDA | TOTAL
  //   2026 (A–I): FECHA | CANT/MONTO | WHATSAPP | INSTAGRAM | FACEBOOK | SHOWROOM | WEB | TIENDA | TOTAL
  const COLS_2025 = [
    { col: 2, upper: 'WHATSAPP',  title: 'WhatsApp'  },
    { col: 3, upper: 'INSTAGRAM', title: 'Instagram' },
    { col: 4, upper: 'FACEBOOK',  title: 'Facebook'  },
    { col: 5, upper: 'WEB',       title: 'Web'       },
    { col: 6, upper: 'TIENDA',    title: 'Tienda'    },
    // Showroom no existe en 2025 — se completa con 0
    { col: null, upper: 'SHOWROOM', title: 'Showroom' },
  ];
  const COLS_2026 = [
    { col: 2, upper: 'WHATSAPP',  title: 'WhatsApp'  },
    { col: 3, upper: 'INSTAGRAM', title: 'Instagram' },
    { col: 4, upper: 'FACEBOOK',  title: 'Facebook'  },
    { col: 5, upper: 'SHOWROOM',  title: 'Showroom'  },
    { col: 6, upper: 'WEB',       title: 'Web'       },
    { col: 7, upper: 'TIENDA',    title: 'Tienda'    },
  ];

  // Pestaña real que corresponde a un mes, ignorando mayúsculas, tildes y espacios.
  function resolveTabName(wanted, availableTabs) {
    const mes = MES_POR_NOMBRE[norm(wanted)];
    return availableTabs.find(t => MES_POR_NOMBRE[norm(t)] === mes) || null;
  }

  // Un mes está cerrado si su ciclo ya terminó (después del 26; diciembre, después del 31).
  // Sus ventas ya existen: si no se pueden leer, publicar 0 falsearía el tablero.
  function isClosedMonth(year, monthIndex, today = Ciclo.hoyLima()) {
    return Ciclo.estado(year, monthIndex, today) === 'past';
  }

  // Meses que se leen de un año: el año completo si ya pasó; si está en curso, hasta el mes del
  // ciclo actual + 1 (margen para la pestaña recién creada).
  function monthsUpTo(year, today = Ciclo.hoyLima()) {
    const all = monthsForYear(year);
    const actual = Ciclo.mesDe(today);
    if (actual.year < year) return [];
    if (actual.year > year) return all;
    return all.slice(0, actual.mi + 2);
  }

  // Fecha ISO de la celda FECHA: número de serie de Sheets/Excel, Date, «27/09/2026» (día/mes/año)
  // o «2026-09-27». null si la celda no trae una fecha.
  function parseFecha(v) {
    if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  // Días de una pestaña: [{ fecha, totals, transactions }]. La fecha sale de FECHA (en la fila
  // CANTIDAD); si una fila no la trae, es el día siguiente al anterior (o el 1 del mes de la pestaña,
  // como en las hojas viejas sin fechas). Lanza un error si una fecha no cae en el mes de la pestaña
  // ni en su ciclo: un año o un mes mal tipeado movería ventas a otro mes sin aviso.
  function parseSheet(rows, monthConfig, year, cols) {
    const ciclo = Ciclo.periodo(year, monthConfig.monthIndex);
    const calendario = { inicio: `${year}-${String(monthConfig.monthIndex + 1).padStart(2, '0')}-01` };
    calendario.fin = Ciclo.sumarDias(calendario.inicio, monthConfig.days - 1);
    const dentro = f => (f >= ciclo.inicio && f <= ciclo.fin) || (f >= calendario.inicio && f <= calendario.fin);

    const dailyRows = [];
    let pendingCantidad = null;
    let anterior = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const label = String(row[1] || '').trim().toUpperCase();
      if (label === 'CANTIDAD') {
        pendingCantidad = row;
      } else if (label === 'MONTO' && pendingCantidad) {
        const totals = {};
        const transactions = {};
        cols.forEach(c => { totals[c.title] = 0; transactions[c.upper] = 0; });
        for (const c of cols) {
          if (c.col == null) continue; // Canal no presente en la hoja (ej. Showroom en 2025)
          transactions[c.upper] += toNumber(pendingCantidad[c.col]);
          totals[c.title] = round2(totals[c.title] + toNumber(row[c.col]));
        }

        const conFecha = parseFecha(pendingCantidad[0]) || parseFecha(row[0]);
        const cantidad = pendingCantidad;
        pendingCantidad = null;
        // Las plantillas traen filas de más al final, sin fecha y vacías (el «día 31» de junio).
        if (!conFecha && cols.every(c => c.col == null || (esVacia(cantidad[c.col]) && esVacia(row[c.col])))) continue;
        const fecha = conFecha || (anterior ? Ciclo.sumarDias(anterior, 1) : calendario.inicio);
        if (!dentro(fecha)) {
          throw new Error(`la fila del ${fecha} no corresponde a ${monthConfig.name} (ciclo ${Ciclo.rango(ciclo.inicio, ciclo.fin)})`);
        }
        anterior = fecha;
        dailyRows.push({ fecha, totals, transactions });
      }
    }
    return dailyRows;
  }

  // Agrupa los días por el ciclo de venta de `year`: totales, transacciones, semanas de lunes a
  // domingo recortadas al ciclo (con sus fechas) y ventas por día del ciclo. Los días de otro año
  // no entran.
  function agruparPorCiclo(dailyRows, year, cols) {
    const totals = {};
    const transactions = {};
    const weekly = {};
    const daily = {};
    const periodos = {};
    const conDias = new Set();
    MESES.forEach((mes, mi) => {
      const p = Ciclo.periodo(year, mi);
      periodos[mes] = { inicio: p.inicio, fin: p.fin, dias: p.dias };
      totals[mes] = Object.fromEntries(cols.map(c => [c.title, 0]));
      transactions[mes] = Object.fromEntries(cols.map(c => [c.upper, 0]));
      weekly[mes] = Ciclo.semanas(year, mi).map(s => {
        const row = { w: s.w, desde: s.inicio, hasta: s.fin, TOTAL: 0 };
        cols.forEach(c => { row[c.upper] = 0; });
        return row;
      });
      daily[mes] = Object.fromEntries(cols.map(c => [c.title, []]));
    });

    for (const dr of dailyRows) {
      const p = Ciclo.mesDe(dr.fecha);
      if (p.year !== year || p.dia < 1) continue;
      conDias.add(p.mes);
      const week = weekly[p.mes].find(w => dr.fecha >= w.desde && dr.fecha <= w.hasta);
      cols.forEach(c => {
        const amount = dr.totals[c.title] || 0;
        totals[p.mes][c.title] += amount;
        transactions[p.mes][c.upper] += dr.transactions[c.upper] || 0;
        week[c.upper] += amount;
        week.TOTAL += amount;
        daily[p.mes][c.title][p.dia - 1] = amount;
      });
    }

    MESES.forEach(mes => {
      Object.keys(totals[mes]).forEach(k => { totals[mes][k] = round2(totals[mes][k]); });
      weekly[mes].forEach(wr => {
        wr.TOTAL = round2(wr.TOTAL);
        cols.forEach(c => { wr[c.upper] = round2(wr[c.upper]); });
      });
      // Un mes sin días leídos no tiene semanas ni ventas por día (como antes, sin pestaña).
      if (!conDias.has(mes)) { weekly[mes] = []; delete daily[mes]; }
    });
    return { totals, transactions, weekly, daily, periodos };
  }

  // Lee las pestañas de un año y agrupa sus días por el ciclo de venta. getRows(mes, pestaña)
  // devuelve las filas (o una promesa). Si falta la pestaña de un mes cerrado o una pestaña no se
  // puede leer, cuenta como falla; si una fecha aparece en dos pestañas, también (se sumaría dos veces).
  async function leerAnio({ year, cols, tabs, getRows, today = Ciclo.hoyLima(), log = () => {} }) {
    const dailyRows = [];
    const failures = [];
    const vistas = new Map();   // fecha → pestaña

    const enCurso = Ciclo.mesDe(today).year === year;
    for (const m of (enCurso ? monthsUpTo(year, today) : monthsForYear(year))) {
      const pestana = tabs ? resolveTabName(m.sheet, tabs) : m.sheet;
      if (!pestana) {
        if (isClosedMonth(year, m.monthIndex, today)) failures.push(`${year} ${m.name}: falta la pestaña de un mes cerrado`);
        continue;
      }
      let dias;
      try {
        dias = parseSheet(await getRows(m, pestana), m, year, cols);
      } catch (err) {
        failures.push(`${year} ${pestana}: ${err.message}`);
        continue;
      }
      for (const d of dias) {
        if (vistas.has(d.fecha)) failures.push(`${year}: el ${d.fecha} está en «${vistas.get(d.fecha)}» y en «${pestana}»`);
        vistas.set(d.fecha, pestana);
      }
      dailyRows.push(...dias);
      const total = round2(dias.reduce((s, d) => s + Object.values(d.totals).reduce((a, b) => a + b, 0), 0));
      const rango = dias.length ? ` ${Ciclo.rango(dias[0].fecha, dias[dias.length - 1].fecha)}` : '';
      log(`${year} · ${m.name} («${pestana}»${rango}): S/. ${total.toLocaleString('es-PE')}`);
    }
    dailyRows.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    return { ...agruparPorCiclo(dailyRows, year, cols), dailyRows, failures };
  }

  // Campos 2026 de data/ventas-2026.json a partir de las pestañas del libro de ventas.
  async function ventas2026(tabs, { today = Ciclo.hoyLima(), log } = {}) {
    const leido = await leerAnio({
      year: 2026, cols: COLS_2026, tabs: Object.keys(tabs), today, log,
      getRows: (m, pestana) => tabs[pestana],
    });
    const conVentas = leido.dailyRows.filter(d => Object.values(d.totals).some(v => v > 0));
    return {
      failures: leido.failures,
      ultimoDia: conVentas.length ? conVentas[conVentas.length - 1].fecha : null,
      fields: camposVentas(leido, 2026),
    };
  }

  // Campos de un año leído con leerAnio: 2026 con sus nombres de siempre y 2025 con los suyos.
  function camposVentas(leido, year) {
    if (year === 2026) {
      return {
        ciclo:        { cierre: Ciclo.CIERRE, periodos: leido.periodos },
        d2026:        leido.totals,
        weeklyData:   leido.weekly,
        transactions: leido.transactions,
        daily2026:    leido.daily,     // { Octubre: { Web: [día 1 del ciclo (27 sep), …] } }
      };
    }
    return {
      ciclo2025:        { cierre: Ciclo.CIERRE, periodos: leido.periodos },
      d2025_live:       leido.totals,
      weekly2025:       leido.weekly,
      transactions2025: leido.transactions,
      daily2025:        leido.daily,
    };
  }

  // Marca de tiempo en hora Lima (UTC-5, sin horario de verano), sin zona: "2026-10-05T07:00:00".
  // El tablero la lee añadiendo "-05:00" (ver sheets.js formatRelative).
  function ahoraLima() {
    return new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '');
  }

  return {
    CARPETAS, MESES, CANALES, COLS_2025, COLS_2026,
    urlHoja, urlXlsx, urlCarpeta, ahoraLima,
    toNumber, round2, descargarLibro, lecturaPrivada, listarPrivado, descargarPrivado,
    parseObjetivos, parseTablaObjetivos, objetivosDelLibro,
    monthsForYear, monthsUpTo, isClosedMonth, resolveTabName,
    parseFecha, parseSheet, agruparPorCiclo, leerAnio, camposVentas, ventas2026,
  };
});
