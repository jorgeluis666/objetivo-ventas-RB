// Activador diario del tablero de Royal Baby. Proyecto independiente de script.google.com.
// Al cambiar este archivo: pegarlo en el proyecto "Royal Baby - Actualizacion diaria", guardar y
// ejecutar instalarActivador una vez (pide de nuevo los permisos si se agrego alguno).
//
// GitHub corre los cron de .github/workflows con 5 a 9 horas de atraso. Este script pide a GitHub,
// a las 10:30 de Lima (+-15 min), que corra los workflows de datos; un workflow_dispatch arranca en
// segundos. Al terminar cada uno, deploy.yml publica el tablero. Los cron de GitHub quedan de respaldo.
//
// La inversion publicitaria va aparte, tres veces al dia: Nexus escribe los archivos de Google Ads
// en Drive a las 6:00, 13:00 y 18:00, y scripts/meta-api-sync.gs escribe los de Meta a esas mismas
// horas, asi que sync-ads.yml se lanza a las y media, cuando las dos carpetas ya estan completas.
// Solo ese workflow: ventas y objetivos siguen una vez al dia, para no repetir sus alertas.
//
// Ademas, cada 15 minutos revisa la carpeta de Drive de ventas 2026: si alguien edito la hoja y ya
// lleva QUIETO_MIN minutos sin cambios, lanza solo la lectura de ventas. Esa lectura dispara la alerta
// de ventas actualizadas (alertas-semanales.yml), que sale solo si cambiaron las cifras.
//
// Configuracion del proyecto > Propiedades del script: GITHUB_TOKEN = token fine-grained solo para
// el repo objetivo-ventas-RB con el permiso Actions: Read and write. Nunca escribirlo en este archivo.
//
// Tambien es el lector de las carpetas privadas (ver "Lectura de Drive" al final): publicado como
// aplicacion web, entrega a los scripts de GitHub y a los botones Sincronizar del tablero las hojas de
// ventas, objetivos e inversion publicitaria, que ya no se comparten por enlace. Propiedad LECTURA_CLAVE =
// la misma clave del secret RB_DRIVE_READ_KEY. Al cambiar el codigo: Implementar > Gestionar
// implementaciones > lapiz > Version: Nueva version, para que la URL (secret RB_DRIVE_SCRIPT_URL) no cambie.
const REPO = 'jorgeluis666/objetivo-ventas-RB';
const TIMEZONE = 'America/Lima';
const RUN_HOUR = 10;
const RUN_MINUTE = 30;
const HANDLER = 'actualizarTablero';
const WORKFLOWS = [
  'update-data.yml',     // Actualizar datos de ventas (zona de ventas de Objetivos 2026)
  'sync-objetivos.yml',  // Sincronizar objetivos comerciales
  'sync-ads.yml',        // Sincronizar inversion publicitaria
];

// Inversion publicitaria sola, media hora despues de cada carga de Nexus y de Meta.
const ADS_HOURS = [6, 13, 18];
const ADS_MINUTE = 30;
const HANDLER_ADS = 'actualizarAnuncios';
const WORKFLOW_ADS = 'sync-ads.yml';

// Carpeta "Ventas Royal Baby - 2026" (la misma que lee scripts/fetch-data.js).
const CARPETA_VENTAS = '1JJdjIzDu2CrhcBI9gBUTUuPAXnKYUQal';
const HANDLER_VENTAS = 'revisarVentas';
const REVISAR_CADA_MIN = 15;
// Minutos sin ediciones antes de leer: evita una lectura (y una alerta) por cada celda que se escribe.
const QUIETO_MIN = 10;
const PROP_VENTAS = 'VENTAS_LEIDAS_HASTA';

// Lo llama el activador diario. Si un workflow no arranca, lanza un error y Google avisa por correo.
function actualizarTablero() {
  const edicion = ultimaEdicionVentas();
  lanzar(WORKFLOWS);
  guardarLeidoHasta(edicion);
}

// Lo llaman los activadores de las 6:30, 13:30 y 18:30. El de las 10:30 ya lanza sync-ads.yml junto
// con los demas, asi que a esa hora no hace falta repetirlo.
function actualizarAnuncios() {
  lanzar([WORKFLOW_ADS]);
}

// Lo llama el activador de cada 15 minutos.
function revisarVentas() {
  const props = PropertiesService.getScriptProperties();
  const edicion = ultimaEdicionVentas();
  const leidoHasta = Number(props.getProperty(PROP_VENTAS)) || 0;
  if (edicion <= leidoHasta) return;
  const quieto = (Date.now() - edicion) / 60000;
  if (quieto < QUIETO_MIN) {
    console.log(`Ventas editadas hace ${quieto.toFixed(0)} min: se espera a que dejen de editar`);
    return;
  }
  lanzar(['update-data.yml']);
  guardarLeidoHasta(edicion);
}

// Fecha (ms) de la ultima edicion de cualquier archivo de la carpeta de ventas.
function ultimaEdicionVentas() {
  const archivos = DriveApp.getFolderById(CARPETA_VENTAS).getFiles();
  let ultima = 0;
  while (archivos.hasNext()) ultima = Math.max(ultima, archivos.next().getLastUpdated().getTime());
  return ultima;
}

function guardarLeidoHasta(edicion) {
  PropertiesService.getScriptProperties().setProperty(PROP_VENTAS, String(edicion));
}

function lanzar(workflows) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Falta la propiedad GITHUB_TOKEN en Configuracion del proyecto');
  const fallidos = [];
  workflows.forEach(workflow => {
    const res = UrlFetchApp.fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        payload: JSON.stringify({ ref: 'main' }),
        muteHttpExceptions: true,
      });
    const code = res.getResponseCode();
    if (code === 204) console.log(`${workflow}: lanzado`);
    else fallidos.push(`${workflow}: GitHub respondio ${code} ${res.getContentText()}`);
  });
  if (fallidos.length) throw new Error(fallidos.join('\n'));
}

// Ejecutar UNA vez a mano. Deja el activador diario, los tres de inversion publicitaria y la
// revision de la carpeta de ventas cada 15 minutos. Las ediciones de antes de instalar no disparan
// nada. Borra los suyos antes de crearlos, asi que se puede volver a ejecutar al cambiar un horario.
function instalarActivador() {
  ScriptApp.getProjectTriggers()
    .filter(t => [HANDLER, HANDLER_ADS, HANDLER_VENTAS].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(HANDLER)
    .timeBased().everyDays(1).atHour(RUN_HOUR).nearMinute(RUN_MINUTE)
    .inTimezone(TIMEZONE)
    .create();
  ADS_HOURS.forEach(hora => {
    ScriptApp.newTrigger(HANDLER_ADS)
      .timeBased().everyDays(1).atHour(hora).nearMinute(ADS_MINUTE)
      .inTimezone(TIMEZONE)
      .create();
  });
  ScriptApp.newTrigger(HANDLER_VENTAS)
    .timeBased().everyMinutes(REVISAR_CADA_MIN)
    .create();
  guardarLeidoHasta(ultimaEdicionVentas());
  const horariosAds = ADS_HOURS.map(h => `${h}:${ADS_MINUTE}`).join(', ');
  console.log(`Activador diario: a las ${RUN_HOUR}:${RUN_MINUTE} (${TIMEZONE}), +-15 min`);
  console.log(`Inversion publicitaria: a las ${horariosAds} (${TIMEZONE}), +-15 min`);
  console.log(`Revision de la carpeta de ventas: cada ${REVISAR_CADA_MIN} minutos`);
}

// ── Lectura de Drive ─────────────────────────────────────────────────────────────────────────────
// Las carpetas de abajo ya no se comparten por enlace (sus IDs estan en el repositorio publico). Este
// script corre con la cuenta de Lima Retail, que si tiene acceso, y solo responde con la clave
// LECTURA_CLAVE (enviada por POST, nunca en la URL):
//   action=listar&carpeta=<id>             → los archivos de la carpeta (sin subcarpetas)
//   action=descargar&id=<id>&formato=xlsx  → el archivo en base64; las hojas de Google se exportan a
//                                            xlsx o csv, los archivos subidos (CSV) se entregan tal cual
// Solo entrega archivos que esten dentro de estas carpetas. Las de Artes y Reportes siguen compartidas
// por enlace (el tablero muestra sus miniaturas) y no pasan por aqui.
const CARPETAS_LECTURA = {
  '1JJdjIzDu2CrhcBI9gBUTUuPAXnKYUQal': 'Ventas',
  '1wfOOM4F3TRcxehX_dfZWDYSTVBPrPgjg': 'Objetivos',
  '1TT5KTVZuGlFc7OqvGAz9nuRVyJFvwJpd': 'Google Files',
  '1kjz_QSgFpkd9semvyjrlLQi3ETH8-DPm': 'Meta Files',
};
const FORMATOS = { xlsx: 'xlsx', csv: 'csv' };

function doPost(event) {
  const params = (event && event.parameter) || {};
  const clave = PropertiesService.getScriptProperties().getProperty('LECTURA_CLAVE');
  if (!clave || String(params.clave || '') !== clave) return respuesta_({ ok: false, error: 'Clave no valida.' });
  try {
    if (params.action === 'listar') return respuesta_(listarCarpeta_(String(params.carpeta || '')));
    if (params.action === 'descargar') return respuesta_(descargarArchivo_(String(params.id || ''), String(params.formato || '')));
    return respuesta_({ ok: false, error: 'Solicitud no valida.' });
  } catch (error) {
    console.error('lectura', error);
    return respuesta_({ ok: false, error: 'No se pudo leer Drive.' });
  }
}

function listarCarpeta_(carpeta) {
  if (!CARPETAS_LECTURA[carpeta]) return { ok: false, error: 'Carpeta no permitida.' };
  const files = [];
  const archivos = DriveApp.getFolderById(carpeta).getFiles();
  while (archivos.hasNext()) {
    const file = archivos.next();
    files.push({
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      modifiedTime: file.getLastUpdated().toISOString(),
    });
  }
  return { ok: true, files: files };
}

function descargarArchivo_(id, formato) {
  const file = DriveApp.getFileById(id);
  const padres = file.getParents();
  let permitido = false;
  while (padres.hasNext()) permitido = permitido || Boolean(CARPETAS_LECTURA[padres.next().getId()]);
  if (!permitido) return { ok: false, error: 'Archivo no permitido.' };
  let bytes;
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    if (!FORMATOS[formato]) return { ok: false, error: 'Formato no valido.' };
    const res = UrlFetchApp.fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=${FORMATOS[formato]}`, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error(`Export ${id}: ${res.getResponseCode()}`);
    bytes = res.getBlob().getBytes();
  } else {
    bytes = file.getBlob().getBytes();
  }
  return { ok: true, name: file.getName(), mimeType: file.getMimeType(), base64: Utilities.base64Encode(bytes) };
}

function respuesta_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// Ejecutar una vez desde el editor para aceptar el permiso de Drive (y comprobar que lee las carpetas).
function probarLectura() {
  Object.keys(CARPETAS_LECTURA).forEach(carpeta => {
    const nombres = listarCarpeta_(carpeta).files.map(f => f.name);
    console.log(`${CARPETAS_LECTURA[carpeta]}: ${nombres.join(', ') || 'sin archivos'}`);
  });
}
