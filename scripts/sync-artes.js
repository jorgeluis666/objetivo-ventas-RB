#!/usr/bin/env node
/**
 * sync-artes.js — recorre la carpeta de artes en Drive y escribe data/artes-2026.json.
 *
 * La carpeta de artes de la marca tiene una subcarpeta por campaña, y dentro la pieza de cada
 * anuncio: un archivo suelto (video o imagen) o una subcarpeta «<anuncio> (Carrusel)» con una
 * imagen por lámina. El mes sale del nombre de la campaña («… - Octubre»).
 *
 * Antes este archivo se escribía a mano y solo cubría una campaña, así que los anuncios de las
 * demás salían como «Arte no disponible» aunque su pieza estuviera en Drive.
 *
 * Las notas de diseño se siguen escribiendo a mano: este script las conserva. Un arte que ya
 * estaba mantiene sus notas y su duración; uno nuevo entra sin notas, listo para redactarlas.
 *
 * Uso:
 *   node scripts/sync-artes.js           # escribe data/artes-2026.json
 *   node scripts/sync-artes.js --check   # informa sin escribir
 *
 * Si la carpeta no se puede leer, no escribe nada y sale con código 1.
 */

const fs = require('fs');
const path = require('path');
const { listFolder } = require('./drive-publico.js');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'artes-2026.json');
const CHECK = process.argv.includes('--check');
const ANIO = 2026;

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
const CARRUSEL_RE = /\s*\((carrusel|carousel)\)\s*$/i;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const sinAcentos = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// El mes de una campaña, por su nombre: «Royal Baby E-commerce - Octubre» → «2026-10».
function mesDeCampana(nombre) {
  const limpio = sinAcentos(nombre);
  const indice = MESES.findIndex(mes => limpio.includes(mes) || limpio.includes(mes.replace('septiembre', 'setiembre')));
  if (indice < 0) return null;
  return `${ANIO}-${String(indice + 1).padStart(2, '0')}`;
}

// La vista pública no trae el mimeType de las carpetas: se las reconoce porque no tienen ninguno
// y su nombre no acaba en extensión. Con la API de Drive sí viene y manda.
function esCarpeta(entrada) {
  if (entrada.mimeType) return entrada.mimeType === FOLDER_MIME;
  return !VIDEO_RE.test(entrada.name) && !IMAGE_RE.test(entrada.name);
}

function tipoDeArchivo(entrada) {
  if (entrada.mimeType?.startsWith('video/') || VIDEO_RE.test(entrada.name)) return 'video';
  if (entrada.mimeType?.startsWith('image/') || IMAGE_RE.test(entrada.name)) return 'imagen';
  return null;
}

async function main() {
  const previo = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const raiz = (previo.folder?.url || '').match(/folders\/([-\w]{20,})/)?.[1];
  if (!raiz) throw new Error('data/artes-2026.json no dice cuál es la carpeta de artes (folder.url)');

  // Lo escrito a mano se guarda por nombre de archivo para devolvérselo al arte que lo tenía.
  const notasPrevias = new Map();
  for (const mes of Object.values(previo.months || {})) {
    for (const arte of mes.artes || []) {
      if (arte.notes?.length || arte.seconds) notasPrevias.set(arte.file, { notes: arte.notes, seconds: arte.seconds });
    }
  }

  console.log(`[artes] carpeta raíz ${raiz}`);
  const campanas = await listFolder(raiz);
  const meses = {};
  const avisos = [];

  for (const campana of campanas) {
    if (!esCarpeta(campana)) continue;
    const mes = mesDeCampana(campana.name);
    if (!mes) {
      avisos.push(`La campaña «${campana.name}» no dice de qué mes es: sus artes no se muestran. Ponle el mes al final del nombre.`);
      console.warn(`  ! «${campana.name}»: sin mes en el nombre`);
      continue;
    }

    const entradas = await listFolder(campana.id).catch(err => {
      avisos.push(`No se pudo leer la campaña «${campana.name}»: ${err.message}`);
      return [];
    });

    for (const entrada of entradas) {
      if (esCarpeta(entrada)) {
        // Solo una subcarpeta «(Carrusel)» es un anuncio; cualquier otra se ignora.
        if (!CARRUSEL_RE.test(entrada.name)) continue;
        const laminas = (await listFolder(entrada.id).catch(() => []))
          .filter(hoja => tipoDeArchivo(hoja) === 'imagen')
          .sort((a, b) => a.name.localeCompare(b.name, 'es'));
        if (!laminas.length) {
          avisos.push(`El carrusel «${entrada.name}» no tiene imágenes dentro.`);
          continue;
        }
        (meses[mes] ||= []).push({
          file: entrada.name,
          campana: campana.name,
          driveId: laminas[0].id,
          kind: 'carrusel',
          // Las láminas no traen número en el nombre: el orden es alfabético y puede no ser el real.
          slides: laminas.map(hoja => hoja.id),
          ordenIncierto: true,
        });
        continue;
      }

      const kind = tipoDeArchivo(entrada);
      if (!kind) continue;
      (meses[mes] ||= []).push({ file: entrada.name, campana: campana.name, driveId: entrada.id, kind });
    }
  }

  // Se devuelven las notas y la duración a los artes que ya las tenían.
  for (const artes of Object.values(meses)) {
    for (const arte of artes) {
      const previa = notasPrevias.get(arte.file);
      if (previa?.seconds) arte.seconds = previa.seconds;
      if (previa?.notes?.length) arte.notes = previa.notes;
    }
    artes.sort((a, b) => a.file.localeCompare(b.file, 'es'));
  }

  const doc = {
    about: 'Artes de los anuncios por mes, de la carpeta de artes de la marca en Drive: una subcarpeta por campaña y, dentro, la pieza de cada anuncio (un archivo suelto, o una subcarpeta «(Carrusel)» con una imagen por lámina). Cada arte se identifica con su anuncio por el nombre del archivo, sin la extensión. Solo están los artes que hay en Drive: no todos los anuncios tienen uno. Lo escribe scripts/sync-artes.js; las tres notas de diseño se redactan a mano y el script las conserva.',
    folder: { name: '06 Artes', url: `https://drive.google.com/drive/folders/${raiz}` },
    sincronizado: new Date().toISOString(),
    avisos,
    months: Object.fromEntries(
      Object.keys(meses).sort().map(mes => [mes, {
        folder: { name: '06 Artes', url: `https://drive.google.com/drive/folders/${raiz}` },
        artes: meses[mes],
      }])
    ),
  };

  const total = Object.values(meses).reduce((suma, artes) => suma + artes.length, 0);
  const conNotas = Object.values(meses).flat().filter(arte => arte.notes?.length).length;
  console.log(`[artes] ${total} artes en ${Object.keys(meses).length} mes(es) · ${conNotas} con notas · ${avisos.length} aviso(s)`);
  for (const mes of Object.keys(meses).sort()) {
    console.log(`  ${mes}: ${meses[mes].length} (${meses[mes].filter(a => a.kind === 'carrusel').length} carrusel)`);
  }

  if (CHECK) {
    console.log('[artes] --check: no se escribió nada');
    return;
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`[artes] escrito ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch(err => {
  console.error(`[artes] ${err.message}`);
  process.exit(1);
});
