// Activador diario del tablero de Royal Baby. Proyecto independiente de script.google.com.
// Al cambiar este archivo: pegarlo en el proyecto "Royal Baby - Actualizacion diaria", guardar y
// ejecutar instalarActivador una vez (pide de nuevo los permisos si se agrego alguno).
//
// GitHub corre los cron de .github/workflows con 5 a 9 horas de atraso. Este script pide a GitHub,
// a las 10:30 de Lima (+-15 min), que corra los workflows de datos; un workflow_dispatch arranca en
// segundos. Al terminar cada uno, deploy.yml publica el tablero. Los cron de GitHub quedan de respaldo.
//
// Ademas, cada 15 minutos revisa la carpeta de Drive de ventas 2026: si alguien edito la hoja y ya
// lleva QUIETO_MIN minutos sin cambios, lanza solo la lectura de ventas. Esa lectura dispara la alerta
// de ventas actualizadas (alertas-semanales.yml), que sale solo si cambiaron las cifras.
//
// Configuracion del proyecto > Propiedades del script: GITHUB_TOKEN = token fine-grained solo para
// el repo objetivo-ventas-RB con el permiso Actions: Read and write. Nunca escribirlo en este archivo.
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

// Ejecutar UNA vez a mano. Deja el activador diario a las 10:30 de Lima (+-15 min) y la revision de
// la carpeta de ventas cada 15 minutos. Las ediciones de antes de instalar no disparan nada.
function instalarActivador() {
  ScriptApp.getProjectTriggers()
    .filter(t => [HANDLER, HANDLER_VENTAS].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(HANDLER)
    .timeBased().everyDays(1).atHour(RUN_HOUR).nearMinute(RUN_MINUTE)
    .inTimezone(TIMEZONE)
    .create();
  ScriptApp.newTrigger(HANDLER_VENTAS)
    .timeBased().everyMinutes(REVISAR_CADA_MIN)
    .create();
  guardarLeidoHasta(ultimaEdicionVentas());
  console.log(`Activador instalado: todos los dias a las ${RUN_HOUR}:${RUN_MINUTE} (${TIMEZONE}), +-15 min`);
  console.log(`Revision de la carpeta de ventas: cada ${REVISAR_CADA_MIN} minutos`);
}
