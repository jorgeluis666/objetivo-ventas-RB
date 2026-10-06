#!/usr/bin/env node
/**
 * sync-objetivos.js — lee los objetivos comerciales de la marca desde Drive y escribe
 * data/objetivos-2026.json.
 *
 * Fuente: la hoja de cálculo de la carpeta "Objetivos Royal Baby" (compartida por enlace).
 * La meta de cada mes es su columna PROYECCIÓN; el bloque "TRIMESTRE 2025" es la referencia.
 * El formato lo lee js/fuentes-drive.js, el mismo código que usa el botón Sincronizar del tablero.
 *
 * Uso:
 *   node scripts/sync-objetivos.js           # escribe data/objetivos-2026.json
 *   node scripts/sync-objetivos.js --check   # informa sin escribir
 *
 * Si la carpeta o la hoja no se pueden leer, no escribe nada y sale con código 1.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const FD = require('../js/fuentes-drive.js');
const { hojaDeCarpeta } = require('./drive-publico.js');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'objetivos-2026.json');
const CHECK = process.argv.includes('--check');

const fmt = n => 'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const carpeta = FD.CARPETAS.objetivos;
  console.log(`[objetivos] carpeta ${FD.urlCarpeta(carpeta)}`);
  const hoja = await hojaDeCarpeta(carpeta);
  console.log(`[objetivos] hoja «${hoja.name}» (${hoja.id})`);

  const tabs = await FD.descargarLibro(hoja.id, { XLSX });
  const leido = FD.objetivosDelLibro(tabs);

  const doc = {
    version: '3',
    anio: 2026,
    sincronizado: FD.ahoraLima(),
    fuente: {
      carpeta,
      archivo: { id: hoja.id, nombre: hoja.name },
      pestana: leido.pestana,
    },
    nota: 'Generado por scripts/sync-objetivos.js desde Drive (no editar a mano). La meta es la columna PROYECCIÓN de cada mes.',
    canales: leido.canales,
    meses: leido.meses,
    metas: leido.metas,
    referencia: leido.referencia,
    avisos: leido.avisos,
  };

  console.log(`[objetivos] pestaña «${leido.pestana}» · meses: ${leido.meses.join(', ')}`);
  leido.meses.forEach(m => {
    const total = leido.canales.reduce((s, c) => s + leido.metas[m][c.key], 0);
    const detalle = leido.canales.map(c => `${c.key} ${fmt(leido.metas[m][c.key])}`).join(' · ');
    console.log(`  ${m.padEnd(11)} ${fmt(total).padStart(14)}  (${detalle})`);
  });
  if (leido.referencia) console.log(`[objetivos] referencia: ${leido.referencia.etiqueta}`);
  leido.avisos.forEach(a => console.warn(`  ! ${a}`));

  if (CHECK) {
    console.log('[objetivos] --check: no se escribe nada');
    return;
  }
  // Se escribe aunque las metas no cambien: "sincronizado" es la fecha de la última lectura correcta,
  // la que muestra el tablero.
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`[objetivos] escrito ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(`[objetivos] error: ${err.message}`);
  process.exit(1);
});
