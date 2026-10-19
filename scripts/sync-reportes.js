#!/usr/bin/env node
/**
 * sync-reportes.js — lista la carpeta de reportes de Royal Baby en Drive y escribe data/reportes-2026.json.
 *
 * Es el índice del módulo Archivo de Reportes: nombre, tipo de archivo y fecha de cada documento.
 * El tipo de reporte (semanal, mensual, anual…) y su periodo los lee el tablero del nombre del archivo
 * (js/reportes.js), así que un reporte nuevo aparece solo, sin tocar este script.
 *
 * La carpeta está compartida como "Cualquier persona con el enlace": sin clave se lee la vista pública.
 * Con RB_DRIVE_API_KEY se usa la API de Drive. Un archivo que vuelve sin fecha conserva la que tenía.
 * El JSON no lleva la hora de la corrida: si la carpeta no cambió, el archivo queda igual y no hay commit.
 *
 * Uso:
 *   node scripts/sync-reportes.js           # escribe data/reportes-2026.json
 *   node scripts/sync-reportes.js --check   # informa sin escribir
 *
 * Si la carpeta no se puede leer, no escribe nada y sale con código 1.
 */

const fs = require('fs');
const path = require('path');
const { listFolder } = require('./drive-publico.js');

const FOLDER_ID = '1TxuNI5ig8xnakT0JhH56iv-M3zyKWeR6';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'reportes-2026.json');
const CHECK = process.argv.includes('--check');
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function previous() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch {
    return { files: [] };
  }
}

async function main() {
  const before = new Map((previous().files || []).map(f => [f.id, f]));
  const listed = (await listFolder(FOLDER_ID)).filter(f => f.mimeType !== FOLDER_MIME);
  const files = listed
    .map(f => ({
      id: f.id,
      name: f.name.trim(),
      mimeType: f.mimeType || null,
      // La API trae fecha y hora; la vista pública solo el día. Se guarda el día en los dos casos.
      modified: (f.modifiedTime || before.get(f.id)?.modified || '').slice(0, 10) || null,
    }))
    .sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')) || a.name.localeCompare(b.name, 'es'));

  const out = { folder: { id: FOLDER_ID, url: `https://drive.google.com/drive/folders/${FOLDER_ID}` }, files };
  const text = JSON.stringify(out, null, 2) + '\n';
  const added = files.filter(f => !before.has(f.id)).length;
  const gone = [...before.keys()].filter(id => !files.some(f => f.id === id)).length;
  console.log(`Reportes: ${files.length} archivos · ${added} nuevos · ${gone} ya no están · ${files.filter(f => !f.modified).length} sin fecha`);
  if (CHECK) return;
  fs.writeFileSync(OUTPUT_PATH, text);
  console.log(`  → ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch(err => {
  console.error(`✗ No se pudo leer la carpeta de reportes: ${err.message}`);
  process.exit(1);
});
