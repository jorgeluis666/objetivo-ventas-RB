// Activador diario del tablero de Royal Baby. Proyecto independiente de script.google.com.
// Al cambiar este archivo: pegarlo en el proyecto "Royal Baby - Actualizacion diaria" y guardar.
//
// GitHub corre los cron de .github/workflows con 5 a 9 horas de atraso. Este script pide a GitHub,
// a las 10:30 de Lima (+-15 min), que corra los workflows de datos; un workflow_dispatch arranca en
// segundos. Al terminar cada uno, deploy.yml publica el tablero. Los cron de GitHub quedan de respaldo.
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

// Lo llama el activador diario. Si un workflow no arranca, lanza un error y Google avisa por correo.
function actualizarTablero() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Falta la propiedad GITHUB_TOKEN en Configuracion del proyecto');
  const fallidos = [];
  WORKFLOWS.forEach(workflow => {
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

// Ejecutar UNA vez a mano. Deja un solo activador diario a las 10:30 de Lima (+-15 min).
function instalarActivador() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(HANDLER)
    .timeBased().everyDays(1).atHour(RUN_HOUR).nearMinute(RUN_MINUTE)
    .inTimezone(TIMEZONE)
    .create();
  console.log(`Activador instalado: todos los dias a las ${RUN_HOUR}:${RUN_MINUTE} (${TIMEZONE}), +-15 min`);
}
