/**
 * meta-api-sync.gs — alimenta desde la API de Meta la carpeta de pauta de una marca en Drive.
 *
 * Hasta hoy la hoja mensual de Meta la descargaba una persona del Administrador de anuncios y la
 * subía a mano. Este script hace lo mismo solo: pide las cifras a la API, arma la hoja con **las
 * mismas columnas que el export** y la deja en la carpeta, de modo que el barrido de cada tablero
 * la lee sin enterarse de que cambió el origen. Es el puente mientras Nexus no haga también Meta;
 * cuando lo haga, se apagan los disparadores y ya.
 *
 * Sirve a las marcas que leen una hoja mensual de Meta desde Drive —Royal Baby, Amador, Terminal
 * Pesquero y las tres de Inversiones Excambiare (Mex Cream, Gold Fusion y Sol y Tierra)—, con un
 * proyecto de Apps Script por marca y el mismo código en todos. Lo que cambia va en las propiedades
 * del script, no en el código. El archivo vive en este repositorio aunque sirva a todas porque ya
 * estaba acá; los demás lo apuntan desde su README.
 *
 * Corre en los servidores de Google con disparadores propios, así que no depende de que nadie tenga
 * un equipo encendido. Pensado para las 6:00, 13:00 y 18:00 de Lima, media hora antes de que el
 * barrido del tablero lea la carpeta.
 *
 * ── Puesta en marcha (una vez) ───────────────────────────────────────────────
 * 1. script.google.com → Nuevo proyecto → «<Marca> · Meta a Drive». Pega este archivo.
 * 2. Configuración del proyecto → Propiedades del script:
 *      PERFIL          royal-baby, amador, terminal-pesquero, mex-cream, gold-fusion o
 *                      sol-y-tierra. Decide el nombre del archivo, las columnas y si se pide el
 *                      desglose por edad y sexo. Ver PERFILES más abajo.
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
 *
 * ── Inversiones Excambiare (perfiles mex-cream, gold-fusion y sol-y-tierra) ───
 * Un proyecto por marca, con META_FOLDER_ID apuntando a la carpeta «01 Meta Ads» de esa marca (la
 * misma que DATA_FOLDER_<MARCA> del Web App de Objetivos-Excambiare). Diferencias con los demás:
 * - «Resultados» sale del campo results de la API, que es la columna «Resultados» del Administrador
 *   (comprobado con Mex Cream, octubre de 2026: 32,940 ThruPlay, 89,990 interacciones y 3,894
 *   visitas al perfil, igual que la descarga). Si la API rechazara ese campo, se deduce del
 *   objetivo como en las demás marcas, salvo las visitas al perfil, que la API no da como acción.
 * - No pisa una descarga subida a mano (respetarManuales): solo escribe los meses sin archivo y los
 *   que escribió ella misma (los marca en la descripción del archivo). Para cambiar una descarga
 *   manual por la de la API: propiedad MES_A_REEMPLAZAR = 2026-10 y ejecutar reemplazarMes.
 * - Para llenar los meses que faltan: ejecutar llenarMesesFaltantes (de enero al mes anterior), o
 *   uno solo con la propiedad MES_A_LLENAR = 2026-09 y sincronizarMes.
 * - Los seguidores que trajo cada anuncio (columna «Seguimientos de Instagram») no están en la
 *   lista de acciones documentada de Meta. Ejecutar verAcciones para ver las acciones que devuelve
 *   la cuenta y poner la que corresponda en la propiedad ACCION_SEGUIDORES; sin ella la columna no
 *   se escribe y el reporte dice que ese mes no trae seguidores.
 * - El enlace de vista previa lleva el ID del anuncio al final (#feed_demo_ad=<id>): el tablero lo
 *   usa para reconocer el anuncio, como en la descarga.
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
//
// Inversiones Excambiare: las columnas de RAW_COLUMNS de scripts/google-sheets-sync.gs de
// Objetivos-Excambiare, con edad y sexo como su descarga (el tablero suma el alcance de esas filas,
// así que sin el desglose saldría más bajo que en los meses subidos a mano). Las de interacción
// (reproducciones de 3 s, reacciones, guardados, compartidos y comentarios) son opcionales para el
// barrido y van con las acciones documentadas de Meta.
const EXCAMBIARE = {
  desglose: true,
  columnas: ['Día', 'Edad', 'Sexo', 'Nombre de la campaña', 'Nombre del conjunto de anuncios',
    'Nombre del anuncio', 'Monto gastado (MONEDA)', 'Impresiones', 'Alcance', 'Clics en el enlace',
    'Tipo de resultado', 'Resultados', 'Conversaciones con mensajes iniciadas',
    'Reproducciones de video de 3 segundos', 'Reacciones a la publicación', 'Publicaciones guardadas',
    'Veces que se compartieron las publicaciones', 'Comentarios en publicaciones',
    'Enlace de vista previa'],
  resultadosDeMeta: true,
  respetarManuales: true,
  enlaceConId: true,
  seguidores: true
};

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
  },
  // Los nombres de archivo que ya usa cada carpeta: «Mex - Octubre 2026», «Gold Fusion - …».
  'mex-cream': Object.assign({ marca: 'Mex' }, EXCAMBIARE),
  'gold-fusion': Object.assign({ marca: 'Gold Fusion' }, EXCAMBIARE),
  'sol-y-tierra': Object.assign({ marca: 'Sol y Tierra' }, EXCAMBIARE)
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
  // Tipos de acción de la referencia de Meta (Ads Action Stats): 3-Second Video Views, Post
  // Reactions, Post Saves, Post Shares y Post Comments.
  'Reproducciones de video de 3 segundos': function (f) { return accion_(f.actions, 'video_view'); },
  'Reacciones a la publicación': function (f) { return accion_(f.actions, 'post_reaction'); },
  'Publicaciones guardadas': function (f) { return accion_(f.actions, 'onsite_conversion.post_save'); },
  'Veces que se compartieron las publicaciones': function (f) { return accion_(f.actions, 'post'); },
  'Comentarios en publicaciones': function (f) { return accion_(f.actions, 'comment'); },
  // Solo con la propiedad ACCION_SEGUIDORES (ver perfil_ y verAcciones).
  'Seguimientos de Instagram': function (f, ctx) { return accion_(f.actions, ctx.accionSeguidores); },
  'Tipo de resultado': function (f, ctx) { return ctx.etiqueta; },
  'Resultados': function (f, ctx) { return ctx.resultados; },
  'Nombre de la campaña': function (f) { return f.campaign_name || ''; },
  'Nombre del conjunto de anuncios': function (f) { return f.adset_name || ''; },
  // Con enlaceConId el ID del anuncio va al final, después de #: el navegador no lo manda, así que
  // el enlace abre igual, y el tablero de Excambiare lo lee como en la descarga (feed_demo_ad=<id>).
  'Enlace de vista previa': function (f, ctx) {
    const enlace = ctx.enlaces[f.ad_id] || '';
    if (!ctx.perfil.enlaceConId || !f.ad_id) return enlace;
    return (enlace || 'https://www.facebook.com/') + '#feed_demo_ad=' + f.ad_id;
  }
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

// ── Resultados desde el campo results (perfiles con resultadosDeMeta) ────────
// results trae el indicador del que sale el resultado de cada fila y su valor, como la columna
// «Resultados» del Administrador. La etiqueta es la que escribe la descarga en «Tipo de resultado».
// Un indicador que no esté acá va con su nombre en crudo y el registro lo avisa para añadirlo.
const ETIQUETA_POR_INDICADOR = {
  'actions:post_engagement': 'Interacciones con la publicación',
  'video_thruplay_watched_actions': 'ThruPlay',
  'profile_visit_view': 'Visitas al perfil de Instagram',
  'actions:onsite_conversion.messaging_conversation_started_7d': 'Conversaciones con mensajes iniciadas',
  'actions:link_click': 'Clics en el enlace',
  'actions:landing_page_view': 'Visitas a la página de destino',
  'reach': 'Alcance',
  'impressions': 'Impresiones'
};

// Si la API no diera results, el resultado se deduce del objetivo del conjunto, con las etiquetas
// de la descarga. ThruPlay no está entre las acciones: es un campo aparte. Las visitas al perfil no
// tienen acción documentada, así que sin results quedan en 0 y el registro lo avisa.
const RESULTADO_SIN_RESULTS = {
  POST_ENGAGEMENT: { etiqueta: 'Interacciones con la publicación', valor: function (f) { return accion_(f.actions, 'post_engagement'); } },
  THRUPLAY: { etiqueta: 'ThruPlay', valor: function (f) { return total_(f.video_thruplay_watched_actions); } },
  PROFILE_VISIT: { etiqueta: 'Visitas al perfil de Instagram', valor: null },
  VISIT_INSTAGRAM_PROFILE: { etiqueta: 'Visitas al perfil de Instagram', valor: null },
  CONVERSATIONS: { etiqueta: 'Conversaciones con mensajes iniciadas', valor: function (f) { return accion_(f.actions, 'onsite_conversion.messaging_conversation_started_7d'); } },
  REACH: { etiqueta: 'Alcance', valor: function (f) { return Number(f.reach) || 0; } }
};

// El valor de la ventana de atribución por defecto (la del Administrador). results llega como lista
// de { indicator, values: [{ value, attribution_windows }] }; se acepta también un objeto suelto.
function resultadoDeMeta_(fila) {
  const lista = Array.isArray(fila.results) ? fila.results : (fila.results ? [fila.results] : []);
  for (var i = 0; i < lista.length; i++) {
    const item = lista[i] || {};
    const valores = Array.isArray(item.values) ? item.values : [];
    const porDefecto = valores.filter(function (v) {
      return !v.attribution_windows || v.attribution_windows.indexOf('default') >= 0;
    })[0] || valores[0];
    if (item.indicator) return { indicador: item.indicator, valor: porDefecto ? Number(porDefecto.value) || 0 : 0 };
  }
  return null;
}

function perfil_() {
  const clave = propiedad_('PERFIL');
  const perfil = PERFILES[clave];
  if (!perfil) {
    throw new Error('PERFIL «' + clave + '» no existe. Usa uno de: ' + Object.keys(PERFILES).join(', ') + '.');
  }
  // La columna de seguidores solo va cuando se sabe de qué acción sale (ver verAcciones).
  const accionSeguidores = perfil.seguidores ? propiedadOpcional_('ACCION_SEGUIDORES') : '';
  if (!accionSeguidores) return perfil;
  return Object.assign({}, perfil, {
    columnas: perfil.columnas.concat('Seguimientos de Instagram'),
    accionSeguidores: accionSeguidores
  });
}

function propiedadOpcional_(nombre) {
  return (PropertiesService.getScriptProperties().getProperty(nombre) || '').trim();
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
      escribirMes_(mes, perfil, false);
    } catch (error) {
      // Un mes que falla no se lleva por delante al otro, y la hoja anterior sigue en su sitio:
      // el tablero prefiere el dato de ayer a una hoja vacía.
      Logger.log('%s: %s', mes.nombre, error.message);
      console.error(error);
    }
  });
}

// Pide el mes a la API y escribe su hoja. Con respetarManuales, una hoja del mes que no escribió
// este script (una descarga subida a mano) se deja como está salvo que se fuerce.
function escribirMes_(mes, perfil, forzar) {
  if (perfil.respetarManuales) {
    const existente = archivoDelMes_(DriveApp.getFolderById(propiedad_('META_FOLDER_ID')), mes, perfil.marca, true);
    // Un .xlsx no se puede reescribir: escribir otra hoja dejaría dos archivos del mismo mes.
    if (existente && existente.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      Logger.log('%s: la descarga «%s» es un .xlsx; para que la API la reemplace, bórrala o '
        + 'conviértela a Hoja de cálculo de Google y vuelve a ejecutar.', mes.nombre, existente.getName());
      return false;
    }
    if (existente && !esDelPuente_(existente) && !forzar) {
      Logger.log('%s: ya está «%s», subida a mano; se respeta. Para cambiarla por la de la API: '
        + 'propiedad MES_A_REEMPLAZAR = %s y ejecutar reemplazarMes.', mes.nombre, existente.getName(), mes.clave);
      return false;
    }
  }
  const datos = filasDelMes_(mes, perfil);
  if (!datos.filas.length) {
    Logger.log('%s: la API no devolvió filas; la hoja se deja como estaba.', mes.nombre);
    return false;
  }
  escribirHoja_(mes, datos, perfil);
  Logger.log('%s: %s filas escritas en %s.', mes.nombre, datos.filas.length, datos.moneda);
  return true;
}

// Un mes que ya pasó, sin tocar una descarga subida a mano: propiedad MES_A_LLENAR = 2026-09 (el
// editor no deja pasar argumentos) o sincronizarMes('2026-09') desde otra función.
function sincronizarMes(clave) {
  const mes = mesDeClave_(clave || propiedad_('MES_A_LLENAR'));
  escribirMes_(mes, perfil_(), false);
}

// Cambia la hoja del mes por la de la API aunque sea una descarga subida a mano (por ejemplo una que
// trajo filas de otra cuenta): propiedad MES_A_REEMPLAZAR = 2026-10.
function reemplazarMes(clave) {
  const mes = mesDeClave_(clave || propiedad_('MES_A_REEMPLAZAR'));
  escribirMes_(mes, perfil_(), true);
}

// Crea la hoja de cada mes del año que no tenga archivo, de enero al mes anterior (abril y
// septiembre de 2026 en Excambiare). No toca los meses que ya tienen hoja. Un mes sin pauta no deja
// archivo. Si se acerca el límite de 6 minutos de Apps Script, para y lo dice: se vuelve a ejecutar.
function llenarMesesFaltantes() {
  const perfil = perfil_();
  const carpeta = DriveApp.getFolderById(propiedad_('META_FOLDER_ID'));
  const hoy = new Date();
  const año = Number(Utilities.formatDate(hoy, ZONA, 'yyyy'));
  const mesActual = Number(Utilities.formatDate(hoy, ZONA, 'M'));
  const inicio = Date.now();
  for (var numero = 1; numero < mesActual; numero++) {
    if (Date.now() - inicio > 4 * 60 * 1000) {
      Logger.log('Se acaba el tiempo de esta ejecución: vuelve a ejecutar llenarMesesFaltantes para seguir.');
      return;
    }
    const mes = mesDeClave_(año + '-' + ('0' + numero).slice(-2));
    if (archivoDelMes_(carpeta, mes, perfil.marca, true)) continue;
    try {
      escribirMes_(mes, perfil, false);
    } catch (error) {
      Logger.log('%s: %s', mes.nombre, error.message);
    }
  }
  Logger.log('Listo: los meses de %s sin hoja quedaron revisados.', año);
}

// Diagnóstico: las acciones que la API devuelve para la cuenta en un mes (MES_A_LLENAR o el mes
// anterior), con su total, y los indicadores de results. Sirve para elegir ACCION_SEGUIDORES:
// la que da casi lo mismo que la columna «Seguimientos de Instagram» de la descarga de ese mes.
function verAcciones() {
  const token = propiedad_('META_TOKEN');
  const cuenta = propiedad_('META_ACCOUNT_ID');
  const clave = propiedadOpcional_('MES_A_LLENAR');
  const mes = clave ? mesDeClave_(clave) : mesDe_(new Date(), -1);
  const url = function (conResults) {
    return META_API + '/act_' + cuenta + '/insights?level=campaign&limit=200'
      + '&time_range=' + encodeURIComponent(JSON.stringify({ since: mes.desde, until: mes.hasta }))
      + '&fields=campaign_name,spend,actions' + (conResults ? ',results' : '')
      + '&access_token=' + encodeURIComponent(token);
  };
  let filas;
  try {
    filas = pedirTodo_(url(true));
  } catch (error) {
    Logger.log('La API no dio el campo results (%s); se listan solo las acciones.', error.message);
    filas = pedirTodo_(url(false));
  }
  const acciones = {};
  filas.forEach(function (fila) {
    (fila.actions || []).forEach(function (item) {
      acciones[item.action_type] = (acciones[item.action_type] || 0) + (Number(item.value) || 0);
    });
    const resultado = resultadoDeMeta_(fila);
    Logger.log('%s · %s: results = %s (%s)', mes.nombre, fila.campaign_name,
      resultado ? resultado.valor : '—', resultado ? resultado.indicador : 'sin results');
  });
  Object.keys(acciones).sort().forEach(function (tipo) {
    Logger.log('%s%s = %s', /follow/i.test(tipo) ? '>> ' : '   ', tipo, acciones[tipo]);
  });
  Logger.log('Las marcadas con >> tienen «follow» en el nombre. Pon la de los seguidores en ACCION_SEGUIDORES.');
}

// 'yyyy-MM' → el mismo objeto que mesDe_, hasta hoy si es el mes en curso.
function mesDeClave_(clave) {
  const partes = String(clave || '').trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!partes || Number(partes[2]) < 1 || Number(partes[2]) > 12) {
    throw new Error('Mes «' + clave + '» no válido: escribe año-mes, por ejemplo 2026-09.');
  }
  const hoy = new Date();
  const desplazamiento = (Number(partes[1]) - Number(Utilities.formatDate(hoy, ZONA, 'yyyy'))) * 12
    + Number(partes[2]) - Number(Utilities.formatDate(hoy, ZONA, 'M'));
  if (desplazamiento > 0) throw new Error('El mes ' + clave + ' todavía no llega.');
  return mesDe_(hoy, desplazamiento);
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
  return { año: y, mes: m, desde: iso(1), hasta: hasta, nombre: MESES[m] + ' ' + y, clave: y + '-' + ('0' + (m + 1)).slice(-2) };
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

// Suma de un campo que llega como lista de { value } (por ejemplo video_thruplay_watched_actions).
const total_ = function (lista) {
  let total = 0;
  (lista || []).forEach(function (item) { total += Number(item.value) || 0; });
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
  ].concat(perfil.resultadosDeMeta ? ['video_thruplay_watched_actions'] : []);
  const url = function (lista) {
    return META_API + '/act_' + cuenta + '/insights'
      + '?level=ad&time_increment=1&limit=500'
      + (perfil.desglose ? '&breakdowns=age,gender' : '')
      + '&time_range=' + encodeURIComponent(JSON.stringify({ since: mes.desde, until: mes.hasta }))
      + '&fields=' + lista.join(',')
      + '&access_token=' + encodeURIComponent(token);
  };
  // results va aparte: si la API lo rechazara (con este desglose o en otra versión), se vuelve a
  // pedir sin él y el resultado se deduce del objetivo, en vez de dejar el mes sin hoja.
  let datos;
  if (perfil.resultadosDeMeta) {
    try {
      datos = pedirTodo_(url(campos.concat('results')));
    } catch (error) {
      Logger.log('%s: la API no dio el campo results (%s); el resultado se deduce del objetivo de cada conjunto.', mes.nombre, error.message);
      datos = pedirTodo_(url(campos));
    }
  } else {
    datos = pedirTodo_(url(campos));
  }

  const sinEtiqueta = {};
  let visitasSinResults = false;
  const filas = datos.map(function (fila) {
    const objetivo = objetivos[fila.adset_id];
    let etiqueta = '';
    let resultados = '';
    if (perfil.resultadosDeMeta) {
      const deMeta = resultadoDeMeta_(fila);
      const porObjetivo = RESULTADO_SIN_RESULTS[objetivo] || null;
      if (deMeta) {
        etiqueta = ETIQUETA_POR_INDICADOR[deMeta.indicador] || deMeta.indicador.replace(/^actions:/, '');
        if (!ETIQUETA_POR_INDICADOR[deMeta.indicador]) sinEtiqueta[deMeta.indicador] = true;
        resultados = deMeta.valor;
      } else if (porObjetivo) {
        etiqueta = porObjetivo.etiqueta;
        resultados = porObjetivo.valor ? porObjetivo.valor(fila) : 0;
        if (!porObjetivo.valor) visitasSinResults = true;
      } else if (objetivo) {
        sinMapear[objetivo] = true;
      }
    } else {
      const meta = RESULTADO_POR_OBJETIVO[objetivo] || null;
      if (!meta && objetivo) sinMapear[objetivo] = true;
      etiqueta = meta ? meta.etiqueta : '';
      resultados = meta && meta.accion ? accion_(fila.actions, meta.accion) : '';
    }
    const ctx = {
      etiqueta: etiqueta,
      resultados: resultados,
      enlaces: enlaces,
      perfil: perfil,
      accionSeguidores: perfil.accionSeguidores || ''
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
      + ' Añádelos a %s.', mes.nombre, pendientes.join(', '), perfil.resultadosDeMeta ? 'RESULTADO_SIN_RESULTS' : 'RESULTADO_POR_OBJETIVO');
  }
  const indicadores = Object.keys(sinEtiqueta);
  if (indicadores.length) {
    Logger.log('%s: indicadores de results sin etiqueta, van con su nombre en crudo: %s. Añádelos a ETIQUETA_POR_INDICADOR.',
      mes.nombre, indicadores.join(', '));
  }
  if (visitasSinResults) {
    Logger.log('%s: sin el campo results las visitas al perfil no se pueden calcular; esos conjuntos quedan con 0 resultados.', mes.nombre);
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
  const hoja = hojaDeLaDescarga_(libro);
  hoja.clear();
  hoja.getRange(1, 1, 1, encabezado.length).setValues([encabezado]);
  // El formato va ANTES de escribir: la fecha se queda como texto ISO, que es como la trae el
  // export y como la lee el barrido. Si se escribe primero, Google la reinterpreta según la
  // configuración regional del archivo y el día deja de cuadrar.
  hoja.getRange(2, 1, filas.length, 1).setNumberFormat('@');
  // De una sola vez: escribir fila por fila en una hoja de miles de filas se pasa del tiempo límite.
  hoja.getRange(2, 1, filas.length, encabezado.length).setValues(filas);
  hoja.setFrozenRows(1);
  // La marca de origen: con respetarManuales, solo se vuelve a escribir una hoja que tenga esta nota.
  DriveApp.getFileById(libro.getId()).setDescription(NOTA_DEL_PUENTE);
}

const NOTA_DEL_PUENTE = 'Escrita por meta-api-sync.gs desde la API de Meta. Se reescribe sola: no editar a mano.';

function esDelPuente_(archivo) {
  return String(archivo.getDescription() || '').indexOf('meta-api-sync.gs') >= 0;
}

// La pestaña de la descarga, por nombre y nunca por posición. Desde que Nexus escribe «Nexus Meta»
// en el mismo libro, la primera puede no ser la suya: con getSheets()[0] el clear() de arriba se
// llevaba por delante los datos de Nexus. El barrido busca las dos pestañas por nombre o por sus
// cabeceras, así que el orden no le importa a nadie más; este era el único lado posicional.
const HOJA_DESCARGA = 'Raw Data Report';

function hojaDeLaDescarga_(libro) {
  const porNombre = libro.getSheetByName(HOJA_DESCARGA);
  if (porNombre) return porNombre;
  // Un libro recién creado trae una sola pestaña vacía con el nombre que le pone Google, y los de
  // antes de Nexus traen solo la descarga. En los dos casos se reaprovecha esa, en vez de dejar una
  // pestaña suelta al lado.
  const hojas = libro.getSheets();
  if (hojas.length === 1) return hojas[0].setName(HOJA_DESCARGA);
  return libro.insertSheet(HOJA_DESCARGA);
}

// Devuelve la hoja del mes, reaprovechando la que ya esté en la carpeta. Si la que hay se llama
// distinto, se le cambia el nombre en vez de crear otra: dos archivos del mismo mes hacen que el
// barrido lea uno y avise del otro. Pasa de verdad — la de octubre está subida como «Octube 2026».
function libroDelMes_(carpeta, mes, marca) {
  const nombre = marca + ' - ' + mes.nombre;
  const existente = archivoDelMes_(carpeta, mes, marca);
  if (existente) {
    if (existente.getName() !== nombre) {
      Logger.log('%s: se reaprovecha «%s» y se renombra a «%s».', mes.nombre, existente.getName(), nombre);
      existente.setName(nombre);
    }
    return SpreadsheetApp.openById(existente.getId());
  }

  const libro = SpreadsheetApp.create(nombre);
  DriveApp.getFileById(libro.getId()).moveTo(carpeta);
  return libro;
}

// La hoja del mes en la carpeta: la de su nombre exacto o, si no, una del mismo mes mal escrita. Con
// conXlsx también cuenta una descarga subida como .xlsx (el barrido de Excambiare la lee igual): no
// se puede reescribir, pero si se pasara por alto quedarían dos archivos del mismo mes.
function archivoDelMes_(carpeta, mes, marca, conXlsx) {
  const existentes = carpeta.getFilesByName(marca + ' - ' + mes.nombre);
  while (existentes.hasNext()) {
    const archivo = existentes.next();
    if (archivo.isTrashed()) continue;
    if (archivo.getMimeType() === MimeType.GOOGLE_SHEETS || conXlsx) return archivo;
  }
  return buscarDelMes_(carpeta, mes, conXlsx ? [MimeType.GOOGLE_SHEETS, MimeType.MICROSOFT_EXCEL] : [MimeType.GOOGLE_SHEETS]);
}

// Una hoja de la carpeta que sea de este mes aunque esté mal escrita: basta con que su nombre lleve
// el año y empiece el mes igual. Con tres letras valen «Octube» y «Octubrel», y setiembre —como se
// escribe acá— se reconoce igual que septiembre.
const PREFIJOS_MES = [
  ['ene'], ['feb'], ['mar'], ['abr'], ['may'], ['jun'],
  ['jul'], ['ago'], ['sep', 'set'], ['oct'], ['nov'], ['dic']
];

function buscarDelMes_(carpeta, mes, tipos) {
  const prefijos = PREFIJOS_MES[mes.mes];
  const lista = tipos || [MimeType.GOOGLE_SHEETS];
  for (var t = 0; t < lista.length; t++) {
    const archivos = carpeta.getFilesByType(lista[t]);
    while (archivos.hasNext()) {
      const archivo = archivos.next();
      if (archivo.isTrashed()) continue;
      const nombre = sinTildes_(archivo.getName());
      if (nombre.indexOf(String(mes.año)) < 0) continue;
      for (var i = 0; i < prefijos.length; i++) {
        if (nombre.indexOf(prefijos[i]) >= 0) return archivo;
      }
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
