/* ============================================================
   Datos vivos — data/ventas-2026.json generado por el pipeline
   scripts/fetch-data.js (GitHub Actions / local), por ciclo de venta
   (js/ciclo.js: cada mes va del 27 del anterior al 26).
   En el sitio publicado no hay carpeta data/: scripts/build.js
   incrusta el JSON en window.RB_VENTAS_DATA, dentro del HTML cifrado.
   En local (npm run dev) se lee el archivo.
   Expone window.DataLive.load() → { d2026, weeklyData, transactions, generated }
   ============================================================ */

(function (global) {
  const DATA_URL = 'data/ventas-2026.json';
  const embedded = global.RB_VENTAS_DATA || null;

  const MONTHS_12 = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // Shape de fallback usado cuando no hay JSON disponible (lighthouse / primera carga).
  // Usa DataStatic.monthsWith2026Data para que los meses cubiertos queden sincronizados
  // con data-static.js — solo hay que actualizar ese array cuando avance el año.
  function emptyShape() {
    const liveMonths = global.DataStatic?.monthsWith2026Data || MONTHS_12.slice(0, 4);
    const zero = () => ({ Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 });
    const zeroTx = () => ({ TIENDA: 0, WEB: 0, WHATSAPP: 0, SHOWROOM: 0, INSTAGRAM: 0, FACEBOOK: 0 });
    const monthsShape = (names, factory) =>
      Object.fromEntries(names.map(n => [n, factory()]));
    const weeksShape = names =>
      Object.fromEntries(names.map(n => [n, []]));

    return {
      generated: null,
      d2026:        monthsShape(liveMonths, zero),
      weeklyData:   weeksShape(liveMonths),
      transactions: monthsShape(liveMonths, zeroTx),
      weekly2025:        weeksShape(MONTHS_12),
      d2025_live:        monthsShape(MONTHS_12, zero),
      transactions2025:  monthsShape(MONTHS_12, zeroTx),
    };
  }

  async function load() {
    try {
      let json = embedded;
      if (!json) {
        const res = await fetch(DATA_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        json = await res.json();
      }
      return {
        generated:         json.generated || null,
        fuente2026:        json.fuente2026 || null,  // hoja de Drive de la que salió 2026
        d2026:             json.d2026,
        weeklyData:        json.weeklyData,
        transactions:      json.transactions,
        daily2026:               json.daily2026               || null,  // ventas por día del ciclo (Proyecciones)
        // Nuevos (2025 live completo)
        weekly2025:        json.weekly2025       || {},
        d2025_live:        json.d2025_live       || {},
        transactions2025:  json.transactions2025 || {},
        source: 'live',
      };
    } catch (err) {
      console.warn('[data-live] no se pudo cargar', DATA_URL, err);
      return { ...emptyShape(), source: 'fallback', error: err.message };
    }
  }

  global.DataLive = { load, DATA_URL, embedded: !!embedded };
})(window);
