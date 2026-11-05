/* ============================================================
   franjas.js — cuándo tendría que haber llegado la última captura.

   Nexus captura la inversión de Meta y la publica a Drive a las 06,
   13 y 18 de Lima. El dato del tablero es viejo cuando la captura
   más nueva es anterior a la última de esas franjas que ya pasó, con
   media hora de margen para la subida a Drive y para que el sync de
   GitHub lea la hoja.

   Hasta el 4/11/2026 el tablero medía otra cosa: la hora en que el
   sync de GitHub escribió el archivo. Ese día el sync corrió cuatro
   veces y copió bien lo que había —una captura del 3/11— así que el
   indicador se veía verde con el dato de dos días antes.

   Lima es UTC-5 todo el año. Todo se calcula en UTC para no depender
   de la zona del navegador. Expone window.Franjas y module.exports.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Franjas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HORAS = [6, 13, 18];
  const MARGEN_MIN = 30;
  const LIMA = -5 * 3600000;

  const partes = ms => {
    const d = new Date(ms + LIMA);
    return { a: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  };
  const desde = (a, m, d, h) => Date.UTC(a, m, d, h) - LIMA;

  const fechaLima = ms => new Date(ms + LIMA).toISOString().slice(0, 10);
  const horaLima = ms => new Date(ms + LIMA).toISOString().slice(0, 16).replace('T', ' ');

  /** La última franja que ya debería haber publicado, con su margen. null si no hay ninguna. */
  function ultimaFranjaDebida(ahora) {
    const limite = ahora - MARGEN_MIN * 60000;
    const p = partes(limite);
    let debida = null;
    for (const dia of [-1, 0]) {
      for (const h of HORAS) {
        const t = desde(p.a, p.m, p.d + dia, h);
        if (t <= limite) debida = t;
      }
    }
    return debida;
  }

  /** true si esa captura ya se saltó una franja. Sin captura no se opina: false. */
  function atrasada(captura, ahora) {
    const t = typeof captura === 'number' ? captura : Date.parse(captura || '');
    if (!Number.isFinite(t)) return false;
    const debida = ultimaFranjaDebida(ahora);
    return debida !== null && t < debida;
  }

  return { HORAS, MARGEN_MIN, ultimaFranjaDebida, atrasada, fechaLima, horaLima };
});
