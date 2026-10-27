/**
 * meta-api-sync.gs — alimenta desde la API de Meta la carpeta de pauta de una marca en Drive.
 *
 * Hasta hoy la hoja mensual de Meta la descargaba una persona del Administrador de anuncios y la
 * subía a mano. Este script hace lo mismo solo: pide las cifras a la API, arma la hoja con **las
 * mismas columnas que el export** y la deja en la carpeta, de modo que el barrido de cada tablero
 * la lee sin enterarse de que cambió el origen. Es el puente mientras Nexus no haga también Meta;
 * cuando lo haga, se apagan los disparadores y ya.
 *
 * Sirve a las tres marcas que leen una hoja mensual de Meta desde Drive —Royal Baby, Amador y
 * Terminal Pesquero—, con un proyecto de Apps Script por marca y el mismo código en los tres. Lo
 * que cambia va en las propiedades del script, no en el código. El archivo vive en este
 * repositorio aunque sirva a las tres porque ya estaba acá; los otros dos lo apuntan desde su
 * README.
 *
 * Corre en los servidores de Google con disparadores propios, así que no depende de que nadie tenga
 * un equipo encendido. Pensado para las 6:00, 13:00 y 18:00 de Lima, media hora antes de que el
 * barrido del tablero lea la carpeta.
 *
 * ── Puesta en marcha (una vez) ───────────────────────────────────────────────
 * 1. script.google.com → Nuevo proyecto → «<Marca> · Meta a Drive». Pega este archivo.
 * 2. Configuración del proyecto → Propiedades del script:
 *      PERFIL          royal-baby, amador o terminal-pesquero. Decide el nombre del archivo, las
 *                      columnas y si se pide el desglose por edad y sexo. Ver PERFILES más abajo.
 *      META_TOKEN      Token de acceso con permiso ads_read. Usa el de un usuario del sistema
 *                      (Business Manager → Usuarios del sistema → Generar token): no caduca a los
 *                      60 días como el de una persona. El mismo token sirve para las tres marcas
 *                      si el usuario del sistema tiene asignadas las tres cuentas.
 *      META_ACCOUNT_ID Id de la cuenta publicitaria, sin «act_». Los ids están en las notas
 *                      privadas de LR Suite, no acá: este repositorio es público.
 *      META_FOLDER_ID  Id de la carpeta de pauta de Meta de esa marca, la misma que lee su barrido.
 * 3. Ejecuta `sincronizarMeta` a mano una vez: autoriza los permisos y revisa el registro.
 * 4. Ejecuta `instalarDisparadores` una vez. Para cambiar los horarios, edita HORAS y vuelve a
 *    ejecutarla: borra los suyos antes de crear los nuevos, así que no se duplican.
 *
 * ── Lo que escribe y lo que no ───────────────────────────────────────────────
 * Una fila por día y anuncio —y además por edad y sexo en los perfiles que lo piden, que es como
 * viene el export de esa marca. «Resultados» y «Tipo de resultado»
 * no existen como tales en la API: los deduce del objetivo de optimización de cada conjunto, que es
 * de donde sale el resultado que cuenta Meta. Si un conjunto usa un objetivo que no está en
 * RESULTADO_POR_OBJETIVO, esas dos columnas van vacías y el registro lo avisa con el nombre del
 * objetivo, para poder añadirlo acá.
 */

const META_API = 'https://graph.facebook.com/v21.0';
// Las horas de Lima a las que se alimenta la carpeta. El barrido del tablero lee media hora después.
const HORAS = [6, 13, 18];
const ZONA = 'America/Lima';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
// Los primeros días del mes Meta todavía ajusta el mes anterior: se reescribe hasta el día 5.
const DIAS_REESCRIBIR_ANTERIOR = 5;

// Cada marca lee su hoja con un barrido distinto y espera columnas distintas. No se trata de poner
// todas por si acaso: Terminal Pesquero y Amador suman edad y sexo en su propio barrido, así que
// pedirle a Meta ese desglose multiplicaría las filas sin añadir nada. El perfil se elige con la
// propiedad PERFIL y decide el nombre del archivo, las columnas y si se pide el desglose.
//
// La moneda del gasto no se escribe a mano: se lee de la cuenta y se mete en el encabezado, que es
// de donde la saca el barrido. Si algún día la cuenta deja de estar en soles, el tablero lo avisa
// solo en vez de contar dólares como si fueran soles.
const PERFILES = {
  'royal-baby': {
    marca: 'Royal Baby',
    desglose: true,
    columnas: ['Día', 'Edad', 'Sexo', 'Nombre del anuncio', 'Objetivo', 'Monto gastado (MONEDA)',
      'Impresiones', 'Alcance', 'Clics en el enlace', 'CTR (todos)', 'Interacciones',
      'Visitas a la página de destino del sitio web', 'Artículos agregados al carrito',
      'Pagos iniciados', 'Compras', 'Valor de conversión de compras',
      'Conversaciones con mensajes iniciadas', 'Tipo de resultado', 'Resultados',
      'Nombre de la campaña', 'Nombre del conjunto de anuncios', 'Enlace de vista previa']
  },
  // scripts/meta-drive-sync.gs de Objetivos-Amador: RAW_COLUMNS, sin edad ni sexo.
  'amador': {
    marca: 'Amador',
    desglose: false,
    columnas: ['Día', 'Nombre del anuncio', 'Objetivo', 'Monto gastado (MONEDA)', 'Impresiones',
      'Alcance', 'Clics en el enlace', 'Compras', 'Conversaciones con mensajes iniciadas',
      'Tipo de resultado', 'Resultados', 'Nombre de la campaña',
      'Nombre del conjunto de anuncios', 'Enlace de vista previa']
  },
  // scripts/google-sheets-sync.gs de Objetivos-Terminal-Pesquero: el mismo juego, más corto.
  'terminal-pesquero': {
    marca: 'Terminal Pesquero',
    desglose: false,
    columnas: ['Día', 'Nombre del anuncio', 'Nombre de la campaña', 'Nombre del conjunto de anuncios',
      'Tipo de resultado', 'Resultados', 'Monto gastado (MONEDA)', 'Impresiones', 'Alcance',
      'Clics en el enlace', 'Enlace de vista previa']
  }
};

// De dónde sale el valor de cada columna. Añadir una columna a un perfil es añadirla acá si no está.
const VALORES = {
  'Día': function (f) { return f.date_start; },
  'Edad': function (f) { return f.age || ''; },
  'Sexo': function (f) { return f.gender || ''; },
  'Nombre del anuncio': function (f) { return f.ad_name || ''; },
  'Objetivo': function (f) { return f.objective || ''; },
  'Monto gastado (MONEDA)': function (f) { return Number(f.spend) || 0; },
  'Impresiones': function (f) { return Number(f.impressions) || 0; },
  'Alcance': function (f) { return Number(f.reach) || 0; },
  'Clics en el enlace': function (f) { return Number(f.inline_link_clicks) || 0; },
  // Va en porcentaje, igual que en el export: el barrido lo multiplica por las impresiones para
  // reconstruir los clics de todo tipo, que es con lo que calcula el CTR.
  'CTR (todos)': function (f) { return Number(f.ctr) || 0; },
  'Interacciones': function (f) { return accion_(f.actions, 'post_engagement'); },
  'Visitas a la página de destino del sitio web': function (f) { return accion_(f.actions, 'landing_page_view'); },
  'Artículos agregados al carrito': function (f) { return accion_(f.actions, 'omni_add_to_cart'); },
  'Pagos iniciados': function (f) { return accion_(f.actions, 'omni_initiated_checkout'); },
  'Compras': function (f) { return accion_(f.actions, 'omni_purchase'); },
  'Valor de conversión de compras': function (f) { return accion_(f.action_values, 'omni_purchase'); },
  'Conversaciones con mensajes iniciadas': function (f) { return accion_(f.actions, 'onsite_conversion.messaging_conversation_started_7d'); },
  'Tipo de resultado': function (f, ctx) { return ctx.meta ? ctx.meta.etiqueta : ''; },
  'Resultados': function (f, ctx) { return ctx.resultados; },
  'Nombre de la campaña': function (f) { return f.campaign_name || ''; },
  'Nombre del conjunto de anuncios': function (f) { return f.adset_name || ''; },
  'Enlace de vista previa': function (f, ctx) { return ctx.enlaces[f.ad_id] || ''; }
};

// De qué acción sale el «resultado» según para qué está optimizando el conjunto. Es la misma
// correspondencia que usa el Administrador de anuncios para su columna «Resultados».
const RESULTADO_POR_OBJETIVO = {
  OFFSITE_CONVERSIONS: { accion: 'omni_purchase', etiqueta: 'Compras en el sitio web' },
  VALUE: { accion: 'omni_purchase', etiqueta: 'Compras en el sitio web' },
  LEAD_GENERATION: { accion: 'lead', etiqueta: 'Clientes potenciales' },
  QUALITY_LEAD: { accion: 'lead', etiqueta: 'Clientes potenciales' },
  CONVERSATIONS: { accion: 'onsite_conversion.messaging_conversation_started_7d', etiqueta: 'Conversaciones con mensajes iniciadas' },
  POST_ENGAGEMENT: { accion: 'post_engagement', etiqueta: 'Interacciones' },
  PAGE_LIKES: { accion: 'like', etiqueta: 'Me gusta de la página' },
  LINK_CLICKS: { accion: 'link_click', etiqueta: 'Clics en el enlace' },
  LANDING_PAGE_VIEWS: { accion: 'landing_page_view', etiqueta: 'Visitas a la página de destino' },
  THRUPLAY: { accion: 'video_thruplay_watched', etiqueta: 'ThruPlay' },
  REACH: { accion: '', etiqueta: 'Alcance' },
  IMPRESSIONS: { accion: '', etiqueta: 'Impresiones' },
  AD_RECALL_LIFT: { accion: '', etiqueta: 'Aumento estimado del recuerdo del anuncio (personas)' },
  PROFILE_VISIT: { accion: 'profile_visit', etiqueta: 'Visitas al perfil' },
  VISIT_INSTAGRAM_PROFILE: { accion: 'profile_visit', etiqueta: 'Visitas al perfil de Instagram' }
};

function perfil_() {
  const clave = propiedad_('PERFIL');
  const perfil = PERFILES[clave];
  if (!perfil) {
    throw new Error('PERFIL «' + clave + '» no existe. Usa uno de: ' + Object.keys(PERFILES).join(', ') + '.');
  }
  return perfil;
}

function columnas_(perfil, moneda) {
  return perfil.columnas.map(function (nombre) { return nombre.replace('(MONEDA)', '(' + moneda + ')'); });
}

function propiedad_(nombre) {
  const valor = (PropertiesService.getScriptProperties().getProperty(nombre) || '').trim();
  if (!valor) throw new Error('Falta la propiedad de script ' + nombre + '.');
  return valor;
}

// ── Lo que se ejecuta ────────────────────────────────────────────────────────
function sincronizarMeta() {
  const perfil = perfil_();
  const hoy = new Date();
  const dia = Number(Utilities.formatDate(hoy, ZONA, 'd'));
  const meses = [mesDe_(hoy, 0)];
  if (dia <= DIAS_REESCRIBIR_ANTERIOR) meses.push(mesDe_(hoy, -1));
  Logger.log('Perfil «%s»: %s columnas, desglose por edad y sexo %s.',
    perfil.marca, perfil.columnas.length, perfil.desglose ? 'sí' : 'no');

  meses.forEach(function (mes) {
    try {
      const datos = filasDelMes_(mes, perfil);
      if (!datos.filas.length) {
        Logger.log('%s: la API no devolvió filas; la hoja se deja como estaba.', mes.nombre);
        return;
      }
      escribirHoja_(mes, datos, perfil);
      Logger.log('%s: %s filas escritas en %s.', mes.nombre, datos.filas.length, datos.moneda);
    } catch (error) {
      // Un mes que falla no se lleva por delante al otro, y la hoja anterior sigue en su sitio:
      // el tablero prefiere el dato de ayer a una hoja vacía.
      Logger.log('%s: %s', mes.nombre, error.message);
      console.error(error);
    }
  });
}

function mesDe_(fecha, desplazamiento) {
  const año = Number(Utilities.formatDate(fecha, ZONA, 'yyyy'));
  const mes = Number(Utilities.formatDate(fecha, ZONA, 'M')) - 1 + desplazamiento;
  const base = new Date(Date.UTC(año, mes, 1));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = function (d) { return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2); };
  // El mes en curso se pide hasta hoy: pedir días futuros no devuelve nada y alarga la consulta.
  const hoyIso = Utilities.formatDate(fecha, ZONA, 'yyyy-MM-dd');
  const hasta = iso(ultimo) > hoyIso ? hoyIso : iso(ultimo);
  return { año: y, mes: m, desde: iso(1), hasta: hasta, nombre: MESES[m] + ' ' + y };
}

// ── La API ───────────────────────────────────────────────────────────────────
function pedir_(url) {
  const respuesta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const cuerpo = respuesta.getContentText();
  if (respuesta.getResponseCode() !== 200) {
    const detalle = (JSON.parse(cuerpo).error || {}).message || cuerpo.slice(0, 200);
    throw new Error('la API de Meta respondió ' + respuesta.getResponseCode() + ': ' + detalle);
  }
  return JSON.parse(cuerpo);
}

// Recorre las páginas de un endpoint hasta que se acaban. Meta pagina por cursor.
function pedirTodo_(url) {
  const datos = [];
  let siguiente = url;
  let vueltas = 0;
  while (siguiente && vueltas < 200) {
    const pagina = pedir_(siguiente);
    Array.prototype.push.apply(datos, pagina.data || []);
    siguiente = (pagina.paging || {}).next || '';
    vueltas += 1;
  }
  return datos;
}

// El objetivo de optimización de cada conjunto, que es lo que decide cuál es su «resultado».
// Va por id y no por nombre: la cuenta tiene conjuntos repetidos («18+», «RM RB») con objetivos
// distintos, y emparejarlos por nombre le pondría a uno el resultado del otro.
function objetivosPorConjunto_(cuenta, token) {
  const url = META_API + '/act_' + cuenta + '/adsets?fields=id,optimization_goal&limit=200&access_token=' + encodeURIComponent(token);
  const mapa = {};
  pedirTodo_(url).forEach(function (conjunto) { mapa[conjunto.id] = conjunto.optimization_goal; });
  return mapa;
}

// El enlace de vista previa de cada anuncio: el tablero lo usa para abrir la pieza en Meta, y el
// barrido lo usa para distinguir dos anuncios que se llamen igual.
function enlacesPorAnuncio_(cuenta, token) {
  const url = META_API + '/act_' + cuenta + '/ads?fields=id,preview_shareable_link&limit=200&access_token=' + encodeURIComponent(token);
  const mapa = {};
  pedirTodo_(url).forEach(function (anuncio) {
    if (anuncio.preview_shareable_link) mapa[anuncio.id] = anuncio.preview_shareable_link;
  });
  return mapa;
}

function monedaDeCuenta_(cuenta, token) {
  const url = META_API + '/act_' + cuenta + '?fields=currency&access_token=' + encodeURIComponent(token);
  return pedir_(url).currency || 'PEN';
}

const accion_ = function (lista, tipo) {
  let total = 0;
  (lista || []).forEach(function (item) { if (item.action_type === tipo) total += Number(item.value) || 0; });
  return total;
};

function filasDelMes_(mes, perfil) {
  const token = propiedad_('META_TOKEN');
  const cuenta = propiedad_('META_ACCOUNT_ID');
  const moneda = monedaDeCuenta_(cuenta, token);
  const objetivos = objetivosPorConjunto_(cuenta, token);
  const enlaces = enlacesPorAnuncio_(cuenta, token);
  const sinMapear = {};

  const campos = [
    'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'objective', 'spend',
    'impressions', 'reach', 'inline_link_clicks', 'ctr', 'actions', 'action_values'
  ].join(',');
  const url = META_API + '/act_' + cuenta + '/insights'
    + '?level=ad&time_increment=1&limit=500'
    + (perfil.desglose ? '&breakdowns=age,gender' : '')
    + '&time_range=' + encodeURIComponent(JSON.stringify({ since: mes.desde, until: mes.hasta }))
    + '&fields=' + campos
    + '&access_token=' + encodeURIComponent(token);

  const filas = pedirTodo_(url).map(function (fila) {
    const objetivo = objetivos[fila.adset_id];
    const meta = RESULTADO_POR_OBJETIVO[objetivo] || null;
    if (!meta && objetivo) sinMapear[objetivo] = true;
    const ctx = {
      meta: meta,
      enlaces: enlaces,
      resultados: meta && meta.accion ? accion_(fila.actions, meta.accion) : ''
    };
    return perfil.columnas.map(function (nombre) {
      const valor = VALORES[nombre];
      if (!valor) throw new Error('La columna «' + nombre + '» no tiene de dónde salir. Añádela a VALORES.');
      return valor(fila, ctx);
    });
  });

  const pendientes = Object.keys(sinMapear);
  if (pendientes.length) {
    Logger.log('%s: objetivos de optimización sin equivalencia, «Resultados» va vacío en sus filas: %s.'
      + ' Añádelos a RESULTADO_POR_OBJETIVO.', mes.nombre, pendientes.join(', '));
  }
  return { filas: filas, moneda: moneda };
}

// ── La hoja ──────────────────────────────────────────────────────────────────
// Se reutiliza el archivo del mes si ya existe, en vez de crear uno nuevo: el barrido avisa cuando
// encuentra dos del mismo mes, y además así no se pierde el historial de versiones de Drive.
function escribirHoja_(mes, datos, perfil) {
  const filas = datos.filas;
  const encabezado = columnas_(perfil, datos.moneda);
  const carpeta = DriveApp.getFolderById(propiedad_('META_FOLDER_ID'));
  const libro = libroDelMes_(carpeta, mes, perfil.marca);
  // El barrido no lee la hoja: la exporta a CSV. En una hoja en español el CSV sale con la coma
  // como separador decimal, «1,34» se parte en dos columnas y el informe entero queda corrido.
  // Las hojas nuevas nacen con el idioma de la cuenta (es_ES), así que hay que forzarlo.
  if (libro.getSpreadsheetLocale() !== 'en_US') libro.setSpreadsheetLocale('en_US');
  const hoja = libro.getSheets()[0];
  hoja.clear();
  hoja.getRange(1, 1, 1, encabezado.length).setValues([encabezado]);
  // El formato va ANTES de escribir: la fecha se queda como texto ISO, que es como la trae el
  // export y como la lee el barrido. Si se escribe primero, Google la reinterpreta según la
  // configuración regional del archivo y el día deja de cuadrar.
  hoja.getRange(2, 1, filas.length, 1).setNumberFormat('@');
  // De una sola vez: escribir fila por fila en una hoja de miles de filas se pasa del tiempo límite.
  hoja.getRange(2, 1, filas.length, encabezado.length).setValues(filas);
  hoja.setFrozenRows(1);
}

// Devuelve la hoja del mes, reaprovechando la que ya esté en la carpeta. Si la que hay se llama
// distinto, se le cambia el nombre en vez de crear otra: dos archivos del mismo mes hacen que el
// barrido lea uno y avise del otro. Pasa de verdad — la de octubre está subida como «Octube 2026».
function libroDelMes_(carpeta, mes, marca) {
  const nombre = marca + ' - ' + mes.nombre;
  const existentes = carpeta.getFilesByName(nombre);
  if (existentes.hasNext()) return SpreadsheetApp.openById(existentes.next().getId());

  const anterior = buscarDelMes_(carpeta, mes);
  if (anterior) {
    Logger.log('%s: se reaprovecha «%s» y se renombra a «%s».', mes.nombre, anterior.getName(), nombre);
    anterior.setName(nombre);
    return SpreadsheetApp.openById(anterior.getId());
  }

  const libro = SpreadsheetApp.create(nombre);
  DriveApp.getFileById(libro.getId()).moveTo(carpeta);
  return libro;
}

// Una hoja de la carpeta que sea de este mes aunque esté mal escrita: basta con que su nombre lleve
// el año y empiece el mes igual. Con tres letras valen «Octube» y «Octubrel», y setiembre —como se
// escribe acá— se reconoce igual que septiembre.
const PREFIJOS_MES = [
  ['ene'], ['feb'], ['mar'], ['abr'], ['may'], ['jun'],
  ['jul'], ['ago'], ['sep', 'set'], ['oct'], ['nov'], ['dic']
];

function buscarDelMes_(carpeta, mes) {
  const prefijos = PREFIJOS_MES[mes.mes];
  const archivos = carpeta.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (archivos.hasNext()) {
    const archivo = archivos.next();
    const nombre = sinTildes_(archivo.getName());
    if (nombre.indexOf(String(mes.año)) < 0) continue;
    for (var i = 0; i < prefijos.length; i++) {
      if (nombre.indexOf(prefijos[i]) >= 0) return archivo;
    }
  }
  return null;
}

function sinTildes_(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Disparadores ─────────────────────────────────────────────────────────────
function instalarDisparadores() {
  ScriptApp.getProjectTriggers().forEach(function (disparador) {
    if (disparador.getHandlerFunction() === 'sincronizarMeta') ScriptApp.deleteTrigger(disparador);
  });
  HORAS.forEach(function (hora) {
    ScriptApp.newTrigger('sincronizarMeta').timeBased().atHour(hora).nearMinute(0).everyDays(1).inTimezone(ZONA).create();
  });
  Logger.log('Disparadores a las %s de Lima.', HORAS.join(', '));
}
