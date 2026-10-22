/**
 * Royal Baby · destinatarios de la alerta de ventas.
 *
 * Guarda la lista de correos que se edita con la ruedita de Notificaciones del tablero. La alerta
 * (scripts/alertas.js) la lee antes de cada envío. La lista y la clave viven en las propiedades de
 * este script, no en el repositorio.
 *
 * Puesta en marcha (una vez):
 *   1. Crear un proyecto en script.google.com y pegar este archivo.
 *   2. Ejecutar instalar() y copiar la clave que aparece en el registro de ejecución.
 *   3. Implementar → Nueva implementación → Aplicación web: Ejecutar como "Yo",
 *      Quién tiene acceso "Cualquier persona". Copiar la URL /exec.
 *   4. En GitHub (objetivo-ventas-RB → Settings → Secrets) crear RB_ALERTAS_URL con la URL
 *      y RB_ALERTAS_TOKEN con la clave.
 *
 * GET  ?token=…                          → { ok, destinatarios: [{ nombre, email }] | null, actualizado }
 * POST { token, destinatarios } (texto)   → guarda la lista y responde lo mismo.
 * destinatarios es null mientras nadie guardó una lista: la alerta usa entonces la del repositorio.
 */

const MAX_DESTINATARIOS = 25;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

function instalar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  Logger.log('Clave para el secret RB_ALERTAS_TOKEN de GitHub: ' + token);
}

function doGet(e) {
  return responder_(() => {
    autorizar_(e.parameter.token);
    return leer_();
  });
}

function doPost(e) {
  return responder_(() => {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    autorizar_(body.token);
    const lista = limpiar_(body.destinatarios);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      PropertiesService.getScriptProperties().setProperties({
        DESTINATARIOS: JSON.stringify(lista),
        ACTUALIZADO: new Date().toISOString(),
      });
    } finally {
      lock.releaseLock();
    }
    return leer_();
  });
}

function leer_() {
  const props = PropertiesService.getScriptProperties();
  const guardada = props.getProperty('DESTINATARIOS');
  return { ok: true, destinatarios: guardada ? JSON.parse(guardada) : null, actualizado: props.getProperty('ACTUALIZADO') || '' };
}

function autorizar_(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado) throw new Error('Falta ejecutar instalar() en el editor de Apps Script.');
  if (String(token || '') !== esperado) throw new Error('Clave no válida.');
}

// Nombre opcional (hasta 60 caracteres) y correo válido; los correos repetidos quedan una sola vez.
function limpiar_(lista) {
  if (!Array.isArray(lista)) throw new Error('La lista de destinatarios no es válida.');
  if (lista.length > MAX_DESTINATARIOS) throw new Error('Máximo ' + MAX_DESTINATARIOS + ' correos.');
  const vistos = {};
  return lista
    .map(d => ({ nombre: String((d && d.nombre) || '').trim().slice(0, 60), email: String((d && d.email) || '').trim().toLowerCase() }))
    .filter(d => {
      if (!EMAIL.test(d.email)) throw new Error('Correo no válido: ' + (d.email || '(vacío)'));
      if (vistos[d.email]) return false;
      vistos[d.email] = true;
      return true;
    });
}

function responder_(fn) {
  let body;
  try {
    body = fn();
  } catch (err) {
    body = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
