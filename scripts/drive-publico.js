/**
 * drive-publico.js — encuentra la hoja de cálculo de una carpeta de Drive compartida por enlace.
 *
 * Con RB_DRIVE_API_KEY (o GOOGLE_API_KEY) lista la carpeta con la API de Drive; sin clave, o si
 * la API falla, lee la vista pública de la carpeta (embeddedfolderview), igual que sync-ads.js.
 * La usan scripts/sync-objetivos.js y scripts/fetch-data.js.
 */

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const USER_AGENT = 'Mozilla/5.0 (compatible; RoyalBabyDashboard/1.0)';
const TIMEOUT_MS = 60000;

function apiKey() {
  return (process.env.RB_DRIVE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

async function listWithApi(folderId, key) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime)',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    key,
  });
  const payload = JSON.parse(await fetchText(`https://www.googleapis.com/drive/v3/files?${params}`));
  return (payload.files || []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime || null }));
}

// La vista pública trae el mimeType en el ícono de cada archivo (…/type/<mimeType>).
async function listWithPublicView(folderId) {
  const html = await fetchText(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`);
  const files = [];
  for (const block of html.split('<div class="flip-entry"').slice(1)) {
    const id = (block.match(/^\s*id="entry-([-\w]{20,})"/) || [])[1];
    const name = (block.match(/class="flip-entry-title">([^<]+)</) || [])[1];
    const mimeType = (block.match(/\/type\/([^"?]+)"/) || [])[1] || null;
    if (id && name) files.push({ id, name: decodeHtml(name.trim()), mimeType, modifiedTime: null });
  }
  return files;
}

async function listFolder(folderId) {
  const key = apiKey();
  if (key) {
    try {
      const files = await listWithApi(folderId, key);
      if (files.length) return files;
    } catch (err) {
      console.warn(`  ! la API de Drive falló (${err.message}); uso la vista pública`);
    }
  }
  const files = await listWithPublicView(folderId);
  if (!files.length) throw new Error('la carpeta no devolvió archivos (¿dejó de estar compartida por enlace?)');
  return files;
}

// La carpeta debe tener una sola hoja de cálculo de Google: con dos, no se adivina cuál es la buena.
async function hojaDeCarpeta(folderId) {
  const files = await listFolder(folderId);
  const hojas = files.filter(f => f.mimeType === SHEET_MIME);
  if (hojas.length === 0) {
    const otros = files.map(f => `«${f.name}»`).join(', ');
    throw new Error(`la carpeta no tiene una hoja de cálculo de Google (hay: ${otros}). Si es un Excel subido, ábrelo y usa Archivo → Guardar como Hojas de cálculo de Google`);
  }
  if (hojas.length > 1) {
    throw new Error(`la carpeta tiene ${hojas.length} hojas de cálculo (${hojas.map(f => `«${f.name}»`).join(', ')}); debe quedar solo una`);
  }
  return hojas[0];
}

module.exports = { listFolder, hojaDeCarpeta };
