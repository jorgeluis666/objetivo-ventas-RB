/* ============================================================
   ciclo.js — ciclo de venta de Royal Baby: cada mes cierra el 26.

   El mes M va del 27 del mes anterior al 26 de M: Octubre es del
   27 sep al 26 oct. Diciembre también cierra el 26: del 27 al 31 de
   diciembre es Enero del año siguiente. 2026 es el primer año con
   ciclo: su Enero arranca el 1 de enero (así viene la hoja) y 2025,
   que se compara contra él, se arma igual; su 27–31 dic no entra en
   ningún mes. La hoja de ventas de Drive ya viene armada así (la
   pestaña OCTUBRE empieza el 27/09).

   Todas las fechas son ISO (YYYY-MM-DD) y se calculan en UTC para
   no depender de la zona del navegador. «Hoy» es hoy en Lima.
   Expone window.Ciclo en el navegador y module.exports en Node.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ciclo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CIERRE = 26;
  // Primer año con ciclo: hasta este año, Enero arranca el 1 de enero (sin el 27–31 dic anterior).
  const PRIMER_ANIO = 2026;
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
    'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const DIA_MS = 86400000;
  const iso      = (y, mi, d) => new Date(Date.UTC(y, mi, d)).toISOString().slice(0, 10);
  const ms       = fecha => Date.parse(fecha + 'T00:00:00Z');
  const sumarDias = (fecha, n) => new Date(ms(fecha) + n * DIA_MS).toISOString().slice(0, 10);
  const entre    = (a, b) => Math.round((ms(b) - ms(a)) / DIA_MS);   // días de a a b
  const diaSemana = fecha => new Date(ms(fecha)).getUTCDay();        // 0 = domingo, 1 = lunes
  const hoyLima  = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

  // Periodo de un mes: { year, mi, mes, inicio, fin, dias }.
  function periodo(year, mi) {
    const inicio = mi === 0 && year <= PRIMER_ANIO ? iso(year, 0, 1) : iso(year, mi - 1, CIERRE + 1);
    const fin    = iso(year, mi, CIERRE);
    return { year, mi, mes: MESES[mi], inicio, fin, dias: entre(inicio, fin) + 1 };
  }
  const periodoDe = (year, mes) => periodo(year, MESES.indexOf(mes));

  // Mes del ciclo al que pertenece una fecha, con el día dentro del periodo (1 = el 27 del mes
  // anterior). Del 27 al 31 de diciembre es Enero del año siguiente; hasta el primer año con ciclo
  // esos días no entran en ningún mes y `dia` sale ≤ 0.
  function mesDe(fecha) {
    const y = +fecha.slice(0, 4), mi = +fecha.slice(5, 7) - 1, d = +fecha.slice(8, 10);
    const p = d > CIERRE ? (mi === 11 ? periodo(y + 1, 0) : periodo(y, mi + 1)) : periodo(y, mi);
    return { ...p, dia: entre(p.inicio, fecha) + 1 };
  }

  // Fecha del día `dia` (1…dias) del periodo.
  const fechaDe = (year, mi, dia) => sumarDias(periodo(year, mi).inicio, dia - 1);

  // 'past' | 'current' | 'future' del mes frente a una fecha (hoy en Lima por defecto).
  function estado(year, mi, hoy = hoyLima()) {
    const p = periodo(year, mi);
    return hoy > p.fin ? 'past' : hoy < p.inicio ? 'future' : 'current';
  }

  // Días del periodo cubiertos hasta la fecha `hasta`: 0 si es anterior, el periodo entero si es posterior.
  function diasHasta(year, mi, hasta) {
    const p = periodo(year, mi);
    if (!hasta || hasta < p.inicio) return 0;
    if (hasta >= p.fin) return p.dias;
    return entre(p.inicio, hasta) + 1;
  }

  // Semanas de lunes a domingo recortadas al periodo: [{ w, desde, hasta, inicio, fin, dias }],
  // con `desde`/`hasta` como días del periodo e `inicio`/`fin` como fechas.
  function semanas(year, mi) {
    const p = periodo(year, mi);
    const out = [];
    for (let dia = 1; dia <= p.dias; dia++) {
      const f = sumarDias(p.inicio, dia - 1);
      if (dia === 1 || diaSemana(f) === 1) out.push({ w: out.length + 1, desde: dia, inicio: f });
      Object.assign(out[out.length - 1], { hasta: dia, fin: f });
    }
    out.forEach(s => { s.dias = s.hasta - s.desde + 1; });
    return out;
  }

  // «27 sep», y el rango del periodo «27 sep – 26 oct».
  const corta = fecha => `${+fecha.slice(8, 10)} ${ABR[+fecha.slice(5, 7) - 1]}`;
  const rango = (desde, hasta) => desde === hasta ? corta(desde)
    : desde.slice(5, 7) === hasta.slice(5, 7) ? `${+desde.slice(8, 10)}–${corta(hasta)}` : `${corta(desde)} – ${corta(hasta)}`;
  const rangoMes = (year, mi) => { const p = periodo(year, mi); return rango(p.inicio, p.fin); };

  return {
    CIERRE, PRIMER_ANIO, MESES, ABR,
    periodo, periodoDe, mesDe, fechaDe, estado, diasHasta, semanas,
    sumarDias, entre, diaSemana, hoyLima, corta, rango, rangoMes,
  };
});
