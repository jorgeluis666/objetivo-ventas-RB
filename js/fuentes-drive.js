/* ============================================================
   fuentes-drive.js — lectura de las hojas de Drive de la marca.

   La usan los botones Sincronizar del módulo Objetivos (navegador)
   y la corrida diaria (scripts/sync-objetivos.js y fetch-data.js):
   con la misma hoja, ambos producen las mismas cifras.

   - Objetivos: carpeta "Objetivos Royal Baby". Meses con columnas
     PROYECCIÓN / VENTA, una fila por canal y, arriba, el bloque de
     referencia del año anterior ("TRIMESTRE 2025"). La meta es la
     columna PROYECCIÓN; la columna VENTA no se usa (la venta sale
     del histórico).
   - Ventas: carpeta "Ventas Royal Baby - 2026". Una pestaña por mes
     con pares de filas CANTIDAD / MONTO por día.

   Los archivos se descargan como .xlsx desde la exportación pública
   de Google Sheets (compartidos por enlace, sin credenciales).
   Expone window.FuentesDrive en el navegador y module.exports en Node.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuentesDrive = api;
})(typeof self !== 'undefined' ? self : this, function () {
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

  // Devuelve { pestaña: filas } con los valores crudos de cada celda. Las filas arrancan
  // siempre en A1, aunque la hoja tenga filas o columnas vacías al inicio: los índices
  // de columna del parser de ventas dependen de eso.
  async function descargarLibro(id, { XLSX, fetchImpl, timeoutMs = 60000 } = {}) {
    if (!XLSX) throw new Error('falta la librería SheetJS (XLSX)');
    const doFetch = fetchImpl || fetch;
    const opts = { redirect: 'follow' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(urlXlsx(id), opts);
    if (!res.ok) throw new Error(`Drive respondió HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Un .xlsx es un zip ("PK"). Si el archivo dejó de estar compartido, Drive devuelve una página de acceso.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('Drive no devolvió una hoja de cálculo (¿el archivo dejó de estar compartido por enlace?)');
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
    { key: 'Outlet', label: 'Outlet (Showroom)', sheet: ['Showroom'], alias: ['OUTLET', 'SHOWROOM'],
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

  // Busca la pestaña con objetivos: la primera que se puede leer.
  function objetivosDelLibro(tabs) {
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

  // Un mes está cerrado si es de un año anterior o de un mes anterior al actual del año en curso.
  // Sus ventas ya existen: si no se pueden leer, publicar 0 falsearía el tablero.
  function isClosedMonth(year, monthIndex, today = new Date()) {
    return year < today.getFullYear() || (year === today.getFullYear() && monthIndex < today.getMonth());
  }

  // Meses que se leen de un año: el año completo si ya pasó; si está en curso, hasta el mes
  // actual + 1 (margen para el mes recién creado).
  function monthsUpTo(year, today = new Date()) {
    const all = monthsForYear(year);
    if (today.getFullYear() < year) return [];
    if (today.getFullYear() > year) return all;
    return all.slice(0, today.getMonth() + 2);
  }

  /**
   * Agrupa días del mes en semanas calendario (Lun–Dom, clipadas al mes).
   * Día 1 arranca en W1; cada lunes subsecuente incrementa el número de semana.
   */
  function buildWeekMap(year, monthIndex, daysInMonth) {
    const dayToWeek = new Array(daysInMonth + 1);
    let weekNum = 1;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, monthIndex, d).getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
      if (d > 1 && dow === 1) weekNum++;
      dayToWeek[d] = weekNum;
    }
    return dayToWeek;
  }

  function parseSheet(rows, monthConfig, year, cols) {
    const totals = {};
    const transactions = {};
    cols.forEach(c => { totals[c.title] = 0; transactions[c.upper] = 0; });

    const dayToWeek = buildWeekMap(year, monthConfig.monthIndex, monthConfig.days);
    const weekCount = dayToWeek[monthConfig.days];

    const weeklyTotals = [];
    const dailyRows = [];
    for (let w = 1; w <= weekCount; w++) {
      const row = { w, TOTAL: 0 };
      cols.forEach(c => { row[c.upper] = 0; });
      weeklyTotals.push(row);
    }

    let dayCounter = 0;
    let pendingCantidad = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const label = String(row[1] || '').trim().toUpperCase();
      if (label === 'CANTIDAD') {
        pendingCantidad = row;
      } else if (label === 'MONTO' && pendingCantidad) {
        dayCounter++;
        if (dayCounter > monthConfig.days) break;
        const w = dayToWeek[dayCounter];
        const weekRow = weeklyTotals[w - 1];

        const dailyTotals = {};
        const dailyTransactions = {};
        cols.forEach(c => { dailyTotals[c.title] = 0; dailyTransactions[c.upper] = 0; });

        for (const c of cols) {
          if (c.col == null) continue; // Canal no presente en la hoja (ej. Showroom en 2025)
          const qty = toNumber(pendingCantidad[c.col]);
          const amount = toNumber(row[c.col]);
          transactions[c.upper] += qty;
          totals[c.title] += amount;
          weekRow[c.upper] += amount;
          weekRow.TOTAL += amount;
          dailyTransactions[c.upper] += qty;
          dailyTotals[c.title] += amount;
        }

        dailyRows.push({
          year,
          monthIndex: monthConfig.monthIndex,
          day: dayCounter,
          totals: dailyTotals,
          transactions: dailyTransactions,
        });
        pendingCantidad = null;
      }
    }

    cols.forEach(c => { totals[c.title] = round2(totals[c.title]); });
    weeklyTotals.forEach(wr => {
      wr.TOTAL = round2(wr.TOTAL);
      cols.forEach(c => { wr[c.upper] = round2(wr[c.upper]); });
    });
    dailyRows.forEach(dr => {
      Object.keys(dr.totals).forEach(k => { dr.totals[k] = round2(dr.totals[k]); });
    });

    return { totals, transactions, weeklyTotals, dailyRows };
  }

  function commercialPeriodDays(year, targetMonthIndex) {
    const start = new Date(year, targetMonthIndex - 1, 26);
    const end = new Date(year, targetMonthIndex, 25);
    return Math.round((end - start) / 86400000) + 1;
  }

  function buildEmptyWeekly(cols, days) {
    const weekCount = Math.ceil(days / 7);
    const weeks = [];
    for (let w = 1; w <= weekCount; w++) {
      const row = { w, TOTAL: 0 };
      cols.forEach(c => { row[c.upper] = 0; });
      weeks.push(row);
    }
    return weeks;
  }

  // Ciclo comercial 26–25: las ventas del 26 al fin de mes cuentan para el mes siguiente.
  function buildCommercialYear(dailyRows, sourceYear, cols) {
    const monthConfigs = monthsForYear(sourceYear);
    const totals = {};
    const weekly = {};
    const transactions = {};
    const periodDays = {};

    monthConfigs.forEach(m => {
      periodDays[m.name] = commercialPeriodDays(sourceYear, m.monthIndex);
      totals[m.name] = Object.fromEntries(cols.map(c => [c.title, 0]));
      transactions[m.name] = Object.fromEntries(cols.map(c => [c.upper, 0]));
      weekly[m.name] = buildEmptyWeekly(cols, periodDays[m.name]);
    });

    dailyRows.forEach(dr => {
      let targetYear = dr.year;
      let targetMonthIndex = dr.monthIndex;
      let periodDay;

      if (dr.day > 25) {
        targetMonthIndex = dr.monthIndex + 1;
        periodDay = dr.day - 25;
        if (targetMonthIndex > 11) {
          targetMonthIndex = 0;
          targetYear += 1;
        }
      } else {
        const previousMonthDays = new Date(dr.year, dr.monthIndex, 0).getDate();
        periodDay = previousMonthDays - 25 + dr.day;
      }

      if (targetYear !== sourceYear) return;
      const monthName = monthConfigs[targetMonthIndex]?.name;
      if (!monthName || !totals[monthName]) return;

      const weekIndex = Math.max(0, Math.ceil(periodDay / 7) - 1);
      const weekRow = weekly[monthName][weekIndex];
      if (!weekRow) return;

      cols.forEach(c => {
        const amount = dr.totals[c.title] || 0;
        const qty = dr.transactions[c.upper] || 0;
        totals[monthName][c.title] += amount;
        transactions[monthName][c.upper] += qty;
        weekRow[c.upper] += amount;
        weekRow.TOTAL += amount;
      });
    });

    Object.values(totals).forEach(month => {
      Object.keys(month).forEach(k => { month[k] = round2(month[k]); });
    });
    Object.values(weekly).forEach(weeks => weeks.forEach(wr => {
      wr.TOTAL = round2(wr.TOTAL);
      cols.forEach(c => { wr[c.upper] = round2(wr[c.upper]); });
    }));

    return { totals, weekly, transactions, periodDays };
  }

  // Lee las pestañas de un año. getRows(mes, pestaña) devuelve las filas (o una promesa);
  // las pestañas que no existen se completan con 0 y, si el mes ya cerró, cuentan como falla.
  async function leerAnio({ year, cols, tabs, getRows, today = new Date(), log = () => {} }) {
    const totals = {};
    const weekly = {};
    const transactions = {};
    const dailyRows = [];
    const failures = [];
    const vacio = () => ({
      totals: Object.fromEntries(cols.map(c => [c.title, 0])),
      transactions: Object.fromEntries(cols.map(c => [c.upper, 0])),
    });

    for (const m of (today.getFullYear() === year ? monthsUpTo(year, today) : monthsForYear(year))) {
      const pestana = tabs ? resolveTabName(m.sheet, tabs) : m.sheet;
      if (!pestana) {
        if (isClosedMonth(year, m.monthIndex, today)) failures.push(`${year} ${m.name}: falta la pestaña de un mes cerrado`);
        const v = vacio();
        totals[m.name] = v.totals; transactions[m.name] = v.transactions; weekly[m.name] = [];
        continue;
      }
      let rows;
      try {
        rows = await getRows(m, pestana);
      } catch (err) {
        failures.push(`${year} ${pestana}: ${err.message}`);
        const v = vacio();
        totals[m.name] = v.totals; transactions[m.name] = v.transactions; weekly[m.name] = [];
        continue;
      }
      const parsed = parseSheet(rows, m, year, cols);
      totals[m.name]       = parsed.totals;
      transactions[m.name] = parsed.transactions;
      weekly[m.name]       = parsed.weeklyTotals;
      dailyRows.push(...parsed.dailyRows);
      const total = round2(Object.values(parsed.totals).reduce((a, b) => a + b, 0));
      log(`${year} · ${m.name} («${pestana}»): S/. ${total.toLocaleString('es-PE')}`);
    }
    return { totals, weekly, transactions, dailyRows, failures };
  }

  // Ventas por día, por mes calendario y canal: { Octubre: { Web: [día 1, día 2, …], … } }.
  // Proyecciones mide con ellas el ritmo de los últimos 7 o 14 días.
  function dailyByMonth(dailyRows, cols) {
    const out = {};
    for (const dr of dailyRows) {
      const mes = out[MESES[dr.monthIndex]] ||= Object.fromEntries(cols.map(c => [c.title, []]));
      cols.forEach(c => { mes[c.title][dr.day - 1] = dr.totals[c.title] || 0; });
    }
    return out;
  }

  // Campos 2026 de data/ventas-2026.json a partir de las pestañas del libro de ventas.
  async function ventas2026(tabs, { today = new Date(), log } = {}) {
    const leido = await leerAnio({
      year: 2026, cols: COLS_2026, tabs: Object.keys(tabs), today, log,
      getRows: (m, pestana) => tabs[pestana],
    });
    const commercial = buildCommercialYear(leido.dailyRows, 2026, COLS_2026);
    const conVentas = leido.dailyRows.filter(d => Object.values(d.totals).some(v => v > 0));
    const ultimo = conVentas[conVentas.length - 1];
    return {
      failures: leido.failures,
      ultimoDia: ultimo ? `2026-${String(ultimo.monthIndex + 1).padStart(2, '0')}-${String(ultimo.day).padStart(2, '0')}` : null,
      fields: {
        d2026:                   leido.totals,
        d2026_calendar:          leido.totals,
        d2026_commercial:        commercial.totals,
        weeklyData:              leido.weekly,
        weeklyData_calendar:     leido.weekly,
        weeklyData_commercial:   commercial.weekly,       // nombre legacy, usado por objectives.js
        weekly2026:              leido.weekly,
        weekly2026_calendar:     leido.weekly,
        weekly2026_commercial:   commercial.weekly,       // alias explícito
        transactions:            leido.transactions,
        transactions_calendar:   leido.transactions,
        transactions_commercial: commercial.transactions,
        commercialPeriodDays:    commercial.periodDays,   // legacy → usado por pace cards
        daily2026:               dailyByMonth(leido.dailyRows, COLS_2026),
      },
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
    toNumber, round2, descargarLibro,
    parseObjetivos, objetivosDelLibro,
    monthsForYear, monthsUpTo, isClosedMonth, resolveTabName,
    parseSheet, buildCommercialYear, dailyByMonth, leerAnio, ventas2026,
  };
});
