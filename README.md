# Royal Baby · Dashboard de Ventas 2026

Dashboard de ventas por canal (Tienda, Web, WhatsApp, Showroom, Instagram, Facebook) con los objetivos comerciales de la marca frente a su histórico de ventas, comparativo YoY, distribución y análisis de productos web.

Incluye además un módulo de planificación de pauta Meta Ads con modelos Web por
CPA y WhatsApp por CPL, estados separados por cliente, historial de versiones,
resumen copiable y exportación a Excel, y el módulo **Gasto publicitario**, que
muestra la inversión y los resultados de Meta Ads y Google Ads desde sus carpetas
de Drive.

Los objetivos y las ventas 2026 se leen de dos carpetas de Drive de la marca, todos los días, con workflows de GitHub Actions.

Publicado en **https://royalbaby.limaretail.com**, con clave.

## Estructura

```
/
  index.html              Shell HTML (carga módulos separados)
  CNAME                   Dominio del sitio (el build lo copia a dist/)
  assets/
    logo-royal-baby.jpg   Logo y favicon
    login-bg.jpg          Fondo de la pantalla de acceso
  css/
    ds.css                Design system (tokens + componentes)
    dashboard-minimal.css Estilos del dashboard
  js/
    data-static.js        Datos 2025 y productos web
    data-live.js          Datos 2026: incrustados en el sitio publicado, data/ventas-2026.json en local
    charts.js             Instancias de Chart.js
    fuentes-drive.js      Lectura de las hojas de Drive de objetivos y ventas (navegador y scripts)
    objectives.js         Vista Objetivos 2026: objetivos de la marca e histórico de ventas
    config.js             Usuarios y destinatarios de alertas
    sheets.js             Indicador de sync + botón Actualizar
    meta-planner.js       Planificador Meta Ads por cliente
    projections.js        Módulo Proyecciones (datos de Objetivos y Gasto publicitario): pestaña Ritmo del mes
    plan-campanas.js      Proyecciones · pestaña Plan por campaña (estrategia Plano + Picos)
    gasto.js              Módulo Gasto publicitario (Meta Ads y Google Ads desde Drive)
    reportes.js           Archivo de Reportes · pestaña Documentos en Drive (carpeta Reportes)
    reporte-semanal.js    Archivo de Reportes · pestaña Generación de Reporte (semana de lunes a domingo)
    main.js               Orquestación: init, navegación, render
  data/
    ventas-2026.json      Generado por fetch-data.js (no editar a mano)
    objetivos-2026.json   Objetivos de la marca desde Drive, generado por sync-objetivos.js (no editar a mano)
    ads-2026.json         Google Ads + Meta Ads desde Drive, para Gasto publicitario y Proyecciones (generado por sync-ads.js)
    reportes-2026.json    Lista de la carpeta Reportes de Drive, para Archivo de Reportes (generado por sync-reportes.js)
  scripts/
    fetch-data.js         Ventas: carpeta de Drive (2026) + Google Sheet (2025) → data/ventas-2026.json
    sync-objetivos.js     Objetivos: carpeta de Drive → data/objetivos-2026.json
    drive-publico.js      Encuentra la hoja de una carpeta de Drive compartida por enlace
    sync-ads.js           Lee las carpetas de Drive de Google Ads y Meta → data/ads-2026.json
    sync-reportes.js      Lista la carpeta Reportes de Drive → data/reportes-2026.json
    build.js              Arma dist/ (HTML con todo incrustado, cifrado con la clave)
    alertas.js            Correo de alertas: lunes 6:00 p. m. y cuando cambian las ventas
    apps-script/alertas-destinatarios.gs  Web App con los correos de las alertas (ruedita de Notificaciones)
    weekly-check.js       Revisión semanal del pipeline
  deploy/
    pages-gate.html       Pantalla de acceso que descifra el tablero
  .github/workflows/
    update-data.yml       Ventas, todos los días a las 10:30 Lima (Apps Script) y 06:00 de respaldo + workflow_dispatch
    sync-objetivos.yml    Objetivos, todos los días a las 06:05 Lima + workflow_dispatch
    sync-ads.yml          Sync diario de las carpetas de Meta Ads, Google Ads, artes y reportes (07:00 Lima) + workflow_dispatch
    deploy.yml            Build cifrado + deploy a GitHub Pages
    alertas-semanales.yml Correo de alertas: lunes 6:00 p. m. Lima y después de cada lectura de ventas que cambió las cifras
    weekly-check.yml      Revisión semanal del pipeline
```

## Desarrollo local

```bash
npm install
npm run dev          # live-server en http://localhost:3000
```

En local el tablero se abre sin clave y lee `data/ventas-2026.json`, `data/objetivos-2026.json` y `data/ads-2026.json`. Si falta `data/ventas-2026.json`, muestra un banner de error.

Para volver a generar los datos:

```bash
npm run sync:objetivos                      # objetivos desde Drive (sin credenciales)
node scripts/fetch-data.js --solo-2026      # ventas 2026 desde Drive; 2025 se conserva del JSON actual
npm run fetch                               # ventas 2026 desde Drive + 2025 desde su Google Sheet
```

`npm run fetch` necesita la cuenta de servicio para leer el Sheet de 2025 (una sola vez):

1. Crear un service account en Google Cloud Console con permiso de lectura de Sheets API.
2. Descargar el JSON y guardarlo en `credentials/service-account.json` (ignorado por git).
3. Compartir el Sheet de 2025 con el email del service account.

## Pipeline de datos

Dos workflows leen las carpetas de Drive de la marca todos los días y commitean a `main`:

| Workflow | Hora (Lima) | Script | Escribe |
|---|---|---|---|
| `update-data.yml` · *Actualizar datos de ventas* | 10:30 (respaldo 06:00) | `fetch-data.js` | `data/ventas-2026.json` |
| `sync-objetivos.yml` · *Sincronizar objetivos comerciales* | 10:30 (respaldo 06:05) | `sync-objetivos.js` | `data/objetivos-2026.json` |

- **Ventas 2026**: la hoja de la carpeta [Ventas Royal Baby - 2026](https://drive.google.com/drive/folders/1JJdjIzDu2CrhcBI9gBUTUuPAXnKYUQal). Es la fuente de 2026 de todo el tablero (Objetivos, YoY, Distribución, Proyecciones y correo). **2025** sigue saliendo de su Google Sheet con el secret `SERVICE_ACCOUNT_JSON` (JSON del service account pegado entero).
- **Objetivos**: la hoja de la carpeta [Objetivos Royal Baby](https://drive.google.com/drive/folders/1wfOOM4F3TRcxehX_dfZWDYSTVBPrPgjg).
- Las carpetas están compartidas como "Cualquier persona con el enlace": se leen sin credenciales (vista pública de la carpeta y exportación `.xlsx` de la hoja). Con el secret opcional `RB_DRIVE_API_KEY` la carpeta se lista con la API de Drive.
- Cada carpeta debe tener **una sola** hoja de cálculo de Google. Si el archivo se reemplaza por otro, la corrida siguiente lo encuentra solo.
- Si una lectura falla (archivo no compartido, falta la pestaña de un mes cerrado, falta la fila de meses, canal desconocido), el script no escribe nada: queda publicado el último JSON válido y el workflow termina en rojo.

Esos commits los hace `GITHUB_TOKEN`, que no dispara otros workflows: el deploy y las alertas se encadenan con `workflow_run` al terminar cada uno. Para forzar una corrida: `Actions → <workflow> → Run workflow`.

### Corrida diaria de las 10:30

GitHub corre los cron con 5 a 9 horas de atraso (el de las 06:00 sale entre las 11:00 y las 15:00). Para que el tablero esté al día a media mañana, el proyecto de Apps Script **Royal Baby - Actualizacion diaria** (`scripts/disparar-actualizacion.gs`, se pega en script.google.com) lanza con `workflow_dispatch` `update-data.yml`, `sync-objetivos.yml` y `sync-ads.yml` todos los días a las **10:30 de Lima (±15 min)**; arrancan en segundos y el deploy sigue al terminar. Los cron de GitHub quedan de respaldo.

- El token va en *Configuración del proyecto → Propiedades de script* como `GITHUB_TOKEN`: fine-grained, solo este repo, permiso **Actions: Read and write**. Cuando venza, crear otro y reemplazar la propiedad.
- Si GitHub rechaza la orden, el activador falla y Google avisa por correo.
- La venta del día anterior aparece solo si ya está cargada en la hoja de Drive a esa hora.

### Botones Sincronizar

Cada zona del módulo Objetivos tiene un botón **Sincronizar** que vuelve a leer su hoja de Drive en el navegador y redibuja la zona al instante (la de ventas, todo el tablero). Lo que se sincroniza así vale para quien lo presionó y hasta que recargue la página: para todos, el tablero publicado se actualiza con la corrida diaria. El botón lee la hoja de la que salió lo publicado; si en Drive se reemplazó el archivo por otro, lo toma recién la corrida diaria (el navegador no puede listar la carpeta).

El navegador y los scripts leen las hojas con el mismo código (`js/fuentes-drive.js`, con SheetJS), así que dan las mismas cifras.

El botón **Actualizar** de la barra superior recarga la página para traer la última versión publicada.

## Inversión publicitaria desde Drive

```bash
npm run sync:ads              # escribe data/ads-2026.json
node scripts/sync-ads.js --check   # informa sin escribir
```

Lee dos carpetas compartidas por enlace, una por plataforma:

- **Google Ads** ([carpeta](https://drive.google.com/drive/folders/1TT5KTVZuGlFc7OqvGAz9nuRVyJFvwJpd)): informe de campaña del mes (`Royal Baby GA - <Mes> 2026`) y, opcional, el informe de anuncios por día y palabra clave del mismo mes (`Royal Baby - <Mes> 2026`). El script los distingue por el contenido, no por el nombre (octubre tiene los nombres cruzados: `Royal Baby - Octubrel 2026` es el de campaña).
- **Meta Ads** ([carpeta](https://drive.google.com/drive/folders/1kjz_QSgFpkd9semvyjrlLQi3ETH8-DPm)): `Royal Baby - <Mes> 2026`, export del Administrador de anuncios con desglose diario, por edad, sexo y anuncio. El gasto puede venir como «Importe gastado» o «Monto gastado» (nombre de Meta desde octubre de 2026).

Los archivos son hojas de cálculo de Google: se descargan exportándolas a CSV (solo la primera pestaña). Un CSV subido sin convertir también se lee. Con la variable `RB_DRIVE_API_KEY` usa la API de Drive; sin ella, la vista pública de la carpeta.

- **Mes**: sale del contenido (rango del informe en Google Ads, columna Día en Meta); el nombre del archivo es solo respaldo. Un mes puede tener una sola plataforma.
- **Meta**: la serie diaria va por día y campaña (`daily`), con edad, sexo y anuncio sumados. Por mes se guardan además el público por edad y sexo (`audience`) y los 10 anuncios con más compras y conversaciones (`ads.top`, con su enlace de vista previa; dos anuncios con el mismo nombre se separan por el ID del enlace). Para el módulo va también `table`: una fila por día, campaña, conjunto y anuncio (edad y sexo sumados) con inversión, impresiones, alcance, clics en el enlace, compras, valor, conversaciones y resultados con su tipo; los nombres van una vez en sus listas (`campaigns`, `adsets`, `ads`, `types`) y cada fila lleva su índice. El alcance solo va en `table` (suma de las filas del export, como en los reportes de la agencia); los totales y las campañas no lo traen. CTR, CPM y costo por resultado se recalculan sobre los totales. Cada campaña conserva su objetivo y su tipo de resultado, y el mes no suma resultados de tipos distintos.
- **Embudo de Meta**: impresiones → clics en el enlace → visitas a la página de destino (`landingViews`) → agregados al carrito (`addToCart`) → pagos iniciados (`checkouts`) → compras, en el total del mes y en cada campaña. Si el export no trae alguna de esas columnas, queda en `null` y se avisa.
- **KPI de conversión: Compras** (`purchases`, `costPerPurchase`). En Google Ads es la columna *Conversiones por compras*; en Meta, *Compras*. Las *Conversiones* de Google Ads incluyen la categoría Contacto (clics a WhatsApp) y quedan aparte (`conversions`, `conversionsByCategory`). Si el export no trae *Conversiones por compras*, las compras de Google Ads quedan en `null` y se avisa.
- **Google Ads**: llega mensual, así que su serie diaria es estimada (`granularity: "mensual"`) y el consolidado lo marca (`dailyBasis: "mixto"`).
- **Informe segmentado**: si trae la columna *Categoría de conversión*, las campañas salen con costo, impresiones y clics en cero. Entonces los KPIs del mes se toman de *Total: Cuenta*, el desglose real queda por tipo de campaña (`byType`) y cada campaña sale con `complete: false` y esas cifras en `null`. El JSON lo avisa en `pending`.
- **Validación**: la suma por tipo y la de campañas se comparan contra *Total: Cuenta*; lo que no cuadra va a `warnings`. Las filas *Total: Campañas* y *Total: Campañas filtradas* son la suma de las campañas, no un tipo. Las hojas de Google Ads se armaron importando el CSV con coma decimal, y las impresiones o clics que terminaban en cero perdieron esos ceros (`122,200` → `122,2`). El script los completa, lo anota en `repairs` y la validación confirma que cuadran.
- **Informe de Google Ads por día y palabra clave** (Día, Campaña, Grupo de anuncios, Anuncio, URL final, Palabra clave de la búsqueda, Costo, Clics, Conversiones, Valor de conv.): el nombre del anuncio sale de *Anuncio*; el informe de anuncios que se baja desde octubre de 2026 no la trae, y entonces sale de *Nombre del anuncio* o, en los anuncios de búsqueda responsivos (que no tienen nombre), de *Título 1*. Si hay dos informes por día del mismo mes, se usa el modificado más reciente y se avisa. El script lo reconoce por el encabezado y lo guarda en `google.detail` del mes del *Informe de campaña* (sin informe de campaña de ese mes no se usa). `detail.table` lleva una fila por día, campaña, grupo, anuncio y término, con los nombres una vez en sus listas (`campaigns`, `adGroups`, `ads` con `{ name, url }`, `keywords`). Suma menos que el informe de campaña (Google no detalla los términos con pocas impresiones): los totales del mes salen siempre del *Informe de campaña*. Los dos informes pueden venir con el formato de siempre (`1,093.10`) o el de español de España (`615,28`, `Coste`, `Conversiones de compras`); se detecta por los porcentajes de cada archivo.
- Si falla la descarga o la lectura de un archivo, no frena a los demás: si otro archivo cubre ese mes y plataforma se usa ese; si no, el mes de esa plataforma queda como estaba en el JSON anterior. El fallo va a `pending` (el tablero lo muestra como «Pendiente» en la pestaña de la plataforma) y como anotación del workflow. Solo si no se puede listar una carpeta no escribe nada y termina con código 1.

### Sincronización automática

`sync-ads.yml` corre todos los días a las 07:00 de Lima (`0 12 * * *` UTC) y a mano (`Actions → Sincronizar inversión publicitaria → Run workflow`). Ejecuta `npm ci` y `node scripts/sync-ads.js`, y commitea `data/ads-2026.json` solo si cambió (con `git pull --rebase` antes del push, por si otro workflow de datos commiteó). Como ese commit lo hace `GITHUB_TOKEN`, el deploy se encadena con `workflow_run`.

Si un archivo falla, el workflow queda en rojo, el JSON anterior se conserva y no hay deploy. El secret `RB_DRIVE_API_KEY` es opcional: sin él se usa la vista pública de las carpetas.

## Archivo de Reportes

Módulo del menú con dos pestañas (vistas `view-arch` y `view-week`; el menú marca Archivo de Reportes en las dos).

- **Documentos en Drive** (`js/reportes.js`): los reportes de la carpeta [Reportes](https://drive.google.com/drive/folders/1TxuNI5ig8xnakT0JhH56iv-M3zyKWeR6), con búsqueda, filtro por tipo y, por documento, vista previa dentro del tablero, enlace a Drive y PDF. La lista la escribe `scripts/sync-reportes.js` en `data/reportes-2026.json` dentro del workflow `sync-ads.yml` (publicada, va incrustada como `window.RB_REPORTES_DATA`). El tipo (Semanal, Mensual, Anual, Ejecutivo, Estrategia) sale del nombre del archivo: un reporte nuevo aparece solo.
- **Generación de Reporte** (`js/reporte-semanal.js`): la semana cerrada de lunes a domingo frente a la anterior, en el orden de los reportes semanales de la carpeta (el último va enlazado como modelo). Meta Ads por grupo de campañas (E-commerce, Mensajes WhatsApp, Reconocimiento, Interacción) con sus conjuntos, la variación de resultados, el costo por resultado, el ROAS en E-commerce y el mejor anuncio; Google Ads por campaña con el informe por día (`google.detail`), avisando los días que no cubre; y tres conclusiones editables, las dos primeras propuestas con los números y guardadas por semana en el navegador (`rb-week-notes-v1`). Usa los mismos datos que Gasto publicitario (`Gasto.load()`); **Descargar PDF** imprime solo el documento (`@media print`).

## Gasto publicitario

Módulo del grupo Reportes, después de Proyecciones (`js/gasto.js`, vista `view-rep`). Solo usa las carpetas de Drive **Meta Files** y **Google Files**, a través de `data/ads-2026.json`. Publicado, el JSON va incrustado en el HTML cifrado (`window.RB_GASTO_DATA`, sin `rules`, `checks`, `repairs`, el top de anuncios ni las columnas diarias que el tablero no usa); en local se lee con `fetch`.

- **Sincronización**: va en el desplegable de la píldora de la barra superior (`js/sheets.js`, mismo patrón que Terminal Pesquero). En esta vista muestra hasta qué día llega Meta y Google, cuándo cambiaron los datos (`generatedAt`), el próximo automático (10:30 Lima) y las dos carpetas con su número de archivos y el enlace «Abrir». En las demás vistas muestra lo mismo para las ventas. Si los datos no cambian hace más de 36 h, la píldora pasa a ámbar. No hay botón para sincronizar: exigiría un token de GitHub en el navegador, y el tablero lo abren clientes.
- **Pestañas Meta Ads y Google Ads**: cada una con sus pestañas de mes (el mes se comparte entre las dos) y los avisos del sync (`pending` y los `warnings` del mes). Si la carpeta no tiene informes, muestra un estado vacío con el enlace a la carpeta.
- **Meta Ads**: la misma estructura que el tablero de Terminal Pesquero, con los componentes y colores de Royal Baby. Todo sale de `meta.table` (una fila por día, campaña, conjunto y anuncio; edad y sexo sumados).
  - Pestañas de Enero a Diciembre y **Anual** (acumula los meses con export). La pestaña Google Ads sigue el mes elegido; en Anual muestra su último mes.
  - **Periodo**: el tramo del mes y, debajo, Inversión, Impresiones, Alcance, Frecuencia, CPM, Compras, Valor de conversión (ROAS) y Conversaciones iniciadas, con la variación contra el mismo tramo del mes anterior (1-13 Oct vs 1-13 Sep; un mes cerrado se compara completo). En Anual no hay comparación: los KPIs muestran su promedio mensual (meses cerrados).
  - **Distribución de inversión por campaña**: resultados, costo por resultado, inversión y su %, impresiones, alcance, frecuencia, CPM, clics, CTR, compras y ROAS, con el total del periodo. Debajo, un cuadro por grupo de campañas (Ventas E-Commerce, Mensajes WhatsApp, Interacción, Reconocimiento; el grupo sale del nombre de la campaña): KPIs contra el mes anterior, su gráfico y sus conjuntos de anuncios. El gráfico va **por día** (abre así) o **por mes**; no hay acumulado del mes, porque un total corrido siempre sube y exagera el crecimiento (una vista guardada en acumulado vuelve a Por día). Indicadores: el resultado del grupo, inversión, impresiones, alcance y **costo por resultado** (inversión / resultados de cada día o mes; un día sin resultados queda como hueco). Uno solo va contra el mes anterior en el mismo día; varios van cada uno en su panel con su escala o, con el botón **Un solo cuadro** (aparece con dos o más), juntos en un cuadro, un color por indicador y cada uno con su escala sin eje visible. Cada punto lleva su valor (arriba en un pico, abajo en un valle; sin etiqueta en los ceros y omitida si choca con otra, queda en el tooltip); los soles van sin decimales salvo montos menores a S/. 10. Cada cuadro se minimiza y recuerda sus indicadores, su vista y si va en un solo cuadro (`localStorage`, `rb-gp-camp-charts-v1`).
  - Cada cuadro termina con sus **anuncios**: de más a menos resultados, con el líder marcado y el nombre como enlace a la vista previa en Meta. Si el grupo tiene compras, **Ventas** (valor de las compras, con cuántas debajo) y **ROAS** van junto al anuncio; después, resultados del mes anterior y variación, costo por resultado, inversión y % de la campaña, impresiones, alcance, CPM, clics y días activos. Un anuncio es su nombre dentro de un grupo: si corre en varios conjuntos se suma. La tabla de todos los anuncios está en el módulo **Anuncios**.
  - **Embudo** de impresiones a compras y **Público** por edad y sexo, del archivo del mes (en Anual, la suma de los meses). Un paso del embudo en 0 con pasos posteriores mayores se marca «sin registro» (el evento no llega a Meta) y no corta el embudo.
  - El alcance es la suma de las filas del export, como en los reportes de la agencia: no es alcance único.
- **Google Ads**: la misma estructura que Meta Ads. El informe de campaña (un total por mes) da el periodo, los KPIs, la distribución y los cuadros; el informe por día y palabra clave del mes (`google.detail`, si está en la carpeta) da la serie diaria, los grupos de anuncios, los anuncios y los términos de búsqueda.
  - Pestañas de Enero a Diciembre y **Anual**, compartidas con Meta.
  - **Periodo**: Inversión, Impresiones, Clics, CTR, CPC, Compras (*Conversiones por compras*, con costo por compra), Valor de conversión (ROAS) y Conversiones. Un mes cerrado se compara completo. **El mes en curso se compara con el mismo tramo real del mes anterior** (1-18 Oct vs 1-18 Sep) en cada suma que el informe por día de ese mes trae completa (inversión, clics, conversiones y valor: completa es que en el mes suma lo mismo que el informe de campaña); las demás (impresiones y compras, o todas si ese mes no tiene informe por día completo) contra el mes anterior **prorrateado a los mismos días**. CTR, CPC, costos y ROAS salen del tramo cuando sus dos sumas son reales y si no, son los del mes anterior completo (no cambian al prorratear). El subtítulo dice qué sumas van con tramo real y cada KPI, contra qué se compara («1-18 Septiembre» o «Sep prorrateado»); los cuadros de cada tipo usan el informe por día de ese tipo. Si las conversiones incluyen Contacto (clics a WhatsApp), una nota lo separa: el KPI de conversión es Compras.
  - **Distribución de inversión por campaña**, con tipo, estado, inversión y %, impresiones, clics, CTR, CPC, conversiones, compras, costo por compra, valor y ROAS. Si el informe viene segmentado, las cifras por campaña que no informa quedan en «—» y una nota lo explica. Debajo, un cuadro por **tipo de campaña** (Búsqueda, Máximo rendimiento, Shopping, Generación de demanda, Video, Display; de `byType`, que viene completo): KPIs contra el mes anterior, gráfico **por mes** siempre y **por día** cuando el mes trae informe por día (sin impresiones, que ese informe no trae; sin acumulado, como en Meta), y sus **grupos de anuncios**. Entre los indicadores está el **costo por compra** (inversión / compras de cada mes; por día, **costo por conversión**, porque el informe por día no separa las compras; sin compras o conversiones, hueco). Valor en cada punto y botón **Un solo cuadro** como en Meta. Recuerda indicadores, vista y un solo cuadro (`rb-gp-gcamp-charts-v1`).
  - Cada cuadro termina con sus **anuncios**, del informe por día: el nombre enlaza a la URL final; **Ventas** (valor de las conversiones) y **ROAS** junto al anuncio; después grupo, conversiones (contra el mismo tramo del mes anterior si ese mes también tiene informe por día), costo por conversión, inversión y % del tipo, clics, CPC, términos y días activos. La tabla de todos los anuncios está en el módulo **Anuncios**.
  - **Términos de búsqueda**, del informe por día: inversión y %, clics, CPC, conversiones, ROAS y días activos. Sin informe por día, los paneles dicen qué subir.
  - El informe por día suma menos que el de campaña (octubre: S/ 577.83 de S/ 615.28) porque Google no detalla los términos con pocas impresiones: cada panel muestra esa cobertura.
- **Diseño**: tema claro del tablero (`css/dashboard-minimal.css`); reusa `.kpi-strip`/`.kpi-pill` y las pestañas de mes de Objetivos. Colores por plataforma, los mismos de Proyecciones: Meta `#1877F2`, Google `#4285F4`; los grupos de Meta usan los de sus fuentes (E-Commerce `#1877F2`, WhatsApp `#25D366`, Interacción `#E1306C`, Reconocimiento `#7C3AED`) y los tipos de Google, los de la marca (Búsqueda `#4285F4`, Máximo rendimiento `#F9AB00`, Shopping `#34A853`, Generación de demanda `#EA4335`).

## Anuncios

Módulo del menú, después de Gasto publicitario (vista `view-ads`, en `js/gasto.js`: `Gasto.initAds()`). Solo revisa los anuncios, con los mismos datos, periodos y comparaciones que Gasto publicitario, y comparte con ese módulo el mes elegido: cada vista se repinta al abrirse si el mes cambió en la otra.

- **Pestañas Meta Ads y Google Ads** (se recuerda la última en `rb-ads-tab`), cada una con sus pestañas de mes y Anual.
- **Top 3 de anuncios que generaron ventas**: los de más valor atribuido en el periodo (a igual valor, más compras), con su grupo y campaña, ventas, compras o conversiones, ROAS e inversión. En Meta son las compras (incluidas las que llegan por WhatsApp); en Google, el valor de las conversiones del informe por día.
- **Tabla de anuncios**: el nombre del anuncio enlaza a su vista previa (Meta) o a su página (Google), y **Ventas** (valor, con la cantidad debajo) y **ROAS** van al lado del anuncio. Después, en Meta: campaña y conjunto, resultado, resultados del mes anterior y variación, costo por resultado, inversión, impresiones, alcance, CPM, clics y días activos; en Google, del informe por día (su periodo es el que cubre ese informe): campaña y grupo, inversión, conversiones del mes anterior y variación, costo por conversión, clics, CPC, términos y días activos. Las dos con cabecera fija, Grupo/Tipo y Anuncio anclados, filtro, densidad compacta (`rb-gp-ads-compact-v1`, `rb-gp-gads-compact-v1`) y pantalla completa (las pestañas de mes se mueven al panel; `Esc` sale).

## Proyecciones

Módulo del grupo Reportes (`js/projections.js`, vista `view-proj`). No tiene datos propios: los toma de otros dos módulos, y una franja arriba dice hasta qué día llega cada uno, con un botón para abrirlo.

- **Objetivos 2026**: los objetivos de la marca (`data/objetivos-2026.json`) y su histórico de ventas por mes calendario (`data/ventas-2026.json`). Cuando se pulsa **Sincronizar** en Objetivos, Proyecciones se vuelve a dibujar con lo nuevo.
- **Gasto publicitario**: la inversión y los resultados de Meta Ads y Google Ads (`data/ads-2026.json`, la misma carga que usa ese módulo con `Gasto.load()`).

Cómo calcula:

- **Por mes calendario**, como Gasto publicitario y Objetivos.
- **Venta digital**: Web + Redes y WhatsApp, los canales que mueve la pauta, con las columnas del histórico que indica cada canal del archivo de objetivos (`sheet`). Se compara con la suma de los objetivos de esos dos canales; los meses que no están en el archivo quedan sin objetivo.
- **Proyección**: lo que va del mes (real) más los días que quedan al ritmo de la **base** que se elige en «Proyectar con»: **Última semana** (los 7 días que terminan en el último día con datos), **Últimas 2 semanas** (14 días) o **Mes anterior** (completo). Las ventanas de 7 y 14 días cruzan al mes anterior cuando hace falta. La elección se recuerda en el navegador; en un mes cerrado no hay proyección y el selector queda inactivo.
- **Ritmo de la base**: las ventas, hasta el último día con ventas del histórico (`fuente2026.ultimoDia`), salen de `daily2026` (ventas por día y canal; si el JSON no lo trae, el total del mes se reparte entre sus días). Cada plataforma, hasta donde llega su informe (`coverage`): Meta, con su serie diaria real; Google, con su total del mes repartido entre los días que cubre (estimado). Una franja bajo el selector dice qué días entraron y qué se estimó.
- **ROAS de la marca** = venta digital ÷ inversión, ambas de la base. El recálculo da la inversión diaria para cerrar la brecha suponiendo que cada sol adicional rinde ese ROAS.
- **Fuentes de tráfico**: las campañas de Meta se agrupan por tipo de resultado (compras en el sitio web → E-Commerce, conversaciones → WhatsApp, el resto → Alcance) y Google Ads va entero. Valor y ROAS de cada tarjeta son lo del mes, con la atribución de su plataforma; debajo va su ritmo en la base (inversión por día y ROAS, o costo por conversación). Meta trae la serie diaria real; Google, solo el total del mes, así que su tarjeta muestra la inversión por mes. El simulador de cada tarjeta cambia la inversión diaria de los días que le quedan al informe: en E-Commerce y Google mueve la venta digital al cierre con el ROAS de la base; en WhatsApp, las conversaciones al costo por conversación de la base.

Todo lo anterior es la pestaña **Ritmo del mes**. La pestaña se recuerda en el navegador.

### Plan por campaña

Segunda pestaña de Proyecciones (`js/plan-campanas.js`). Lleva al tablero la *Estrategia de Inversión · Plano + Picos · Q4 2026* de Lima Retail con las cifras de las carpetas de Drive (a través de los mismos tres JSON), no con las del documento: cuando las carpetas se actualizan, el plan se recalcula solo.

- **Meses del plan**: los del archivo de objetivos (hoy octubre a diciembre). Por mes: inversión, facturación proyectada, objetivo online y cuánto lo supera.
- **Líneas del plan** (campañas de Drive):
  - *Plano · Web*: las campañas de Meta con resultado «Compras en el sitio web». ROAS = venta Web del histórico ÷ su inversión en los meses normales; inversión = su promedio mensual en esos meses.
  - *Plano · WhatsApp*: las campañas de Meta con resultado «Conversaciones con mensajes iniciadas». ROAS = venta de Redes y WhatsApp ÷ su inversión en los meses normales; inversión = la que cubre el objetivo promedio del canal en los meses del plan.
  - *Plano · Google*: todo Google Ads. ROAS = valor de conversión ÷ costo de todos los meses cerrados; inversión = su promedio mensual.
  - *Branding · Reconocimiento*: las campañas de Meta con objetivo Reconocimiento, sin ROAS (sostiene la Tienda física).
  - *Pico*: inversión extra solo en la ventana del pico, al ROAS Web de los meses de pico.
  - Facturación = inversión × ROAS. Las inversiones se redondean a S/. 10 (WhatsApp hacia arriba).
- **Meses de referencia**: por defecto, junio y julio (normales, sin promo) para el plano y agosto (gran promo) para el pico, como la estrategia. Se cambian con los botones del panel de ROAS y se recuerdan en el navegador. Solo sirven los meses cerrados con el informe de Meta completo.
- **Objetivo online**: la suma de los objetivos de todos los canales del archivo menos la Tienda (Web, Redes y WhatsApp, Outlet). La facturación suma el valor de conversión de Google, que puede contar ventas que también cuenta la Web: la vista lo avisa.
- **Real**: en el mes en curso, la inversión de cada línea según Gasto publicitario y su ritmo mensual frente a la inversión plana; las campañas de Meta que no son de ninguna línea van aparte («fuera del plan»).
- **Otros paneles**: resumen del trimestre con gráfico, escenarios de WhatsApp si su ROAS baja al escalar (mismas proporciones que 16x → 13x → 10x de la estrategia) con el ROAS del mes en curso, Google Ads por campaña en los meses cerrados (chats de WhatsApp = conversiones de contacto), Branding → Tienda (CPM de Reconocimiento e impresiones estimadas; el alcance de Gasto publicitario es una suma de filas, no alcance único) y la curva semanal 2025 con las ventanas de los picos.
- **Decisiones de la estrategia** (no están en Drive): las ventanas y montos de los picos (Black Days 24–28 nov y Push Navideño 13–16 dic, S/. 1.000 cada uno), el branding de S/. 300 al mes y los escenarios de WhatsApp. Están en `ESTRATEGIA`, al principio de `js/plan-campanas.js`.

## Publicación y acceso

`deploy.yml` corre en cada push a `main`, después de cada actualización de datos y a mano (`Run workflow`):

1. `node scripts/build.js` incrusta en `dist/index.html` el CSS, todos los `js/` y los datos (`ventas-2026.json`, `objetivos-2026.json` y `ads-2026.json`, este último recortado a lo que lee el tablero). Falla si `index.html` carga algún archivo local que no se pueda incrustar o publicar.
2. Con el secret `RB_PAGE_PASSWORD` cifra ese HTML (AES-256-GCM, llave PBKDF2-SHA256 de 600 000 iteraciones) dentro de `deploy/pages-gate.html`. El navegador lo descifra con la clave; sin ella, el HTML publicado no muestra nada del tablero.
3. Sube `dist/` a GitHub Pages: solo `index.html`, `assets/` y `CNAME`. `data/`, `scripts/`, los CSV y este README no se publican.

El workflow falla si falta el secret o si `dist/index.html` sale sin cifrar o con alguno de los datos en claro (`RB_VENTAS_DATA`, `RB_OBJETIVOS_DATA`, `RB_GASTO_DATA`).

`deploy.yml` se encadena (`workflow_run`) a «Actualizar datos de ventas» y a «Sincronizar inversión publicitaria», solo cuando terminan en verde.

Al entrar, la llave derivada (no la clave) queda en `sessionStorage`: la clave se pide en cada pestaña nueva y otra vez después de cada deploy.

El repositorio es público: lo que está en `data/` y en el historial se puede ver en GitHub aunque el sitio tenga clave.

### Cambiar la clave

1. `Settings → Secrets and variables → Actions → RB_PAGE_PASSWORD → Update secret`.
2. `Actions → Deploy a GitHub Pages → Run workflow`.

Las sesiones abiertas con la clave anterior siguen hasta que se cierre la pestaña o haya otro deploy.

## Configuración inicial (una vez)

1. En Google Cloud Console: habilitar **Sheets API** y crear un service account.
2. Pegar el JSON de credenciales completo como secret `SERVICE_ACCOUNT_JSON` en `Settings → Secrets and variables → Actions`.
3. Compartir el Google Sheet de 2025 con el email del service account (permiso lector).
4. Secret `RB_PAGE_PASSWORD`: clave de acceso al tablero (16 caracteres o más).
5. Opcional: secret `RB_DRIVE_API_KEY` (clave de API de Google con Drive API habilitada) para que `sync-ads.yml`, `update-data.yml` y `sync-objetivos.yml` listen las carpetas con la API en vez de la vista pública.
6. Secrets `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y `SMTP_PASS` para el correo de alertas: la cuenta alertas@limaretail.com del hosting, que también es el remitente. Sin ellos se usa `RESEND_API_KEY` si existe. Secrets `RB_ALERTAS_URL` y `RB_ALERTAS_TOKEN` para la lista de correos que se edita en el tablero (ver [Alerta de ventas](#alerta-de-ventas)). Opcional: variable `DASHBOARD_URL` si el enlace del correo debe ser otro que el de `data/alertas-config.json`.
7. DNS de `limaretail.com`: registro CNAME `royalbaby` → `jorgeluis666.github.io`.
8. `Settings → Pages`: Source **GitHub Actions**, Custom domain `royalbaby.limaretail.com` y **Enforce HTTPS**.
9. Pushear a `main`: el deploy corre solo.

## Alerta de ventas

Correo con el avance del mes contra la meta (real acumulado, proyección de cierre, avance por canal y avisos), con la estética del tablero. Lo envía `scripts/alertas.js` desde `alertas-semanales.yml`:

- **Lunes a las 6:00 p. m. de Lima**, una vez por semana.
- **Cada vez que se actualizan las ventas**: después de cada corrida de «Actualizar datos de ventas», solo si las cifras de `data/ventas-2026.json` cambiaron desde el último envío (el archivo se reescribe en cada lectura, así que se compara una huella de las ventas, guardada en `data/alertas-envios.json`).
- A mano: `Actions → Alerta semanal de ventas → Run workflow`, con «Simulación» para no enviar y «Reenviar» para mandarla aunque ya haya salido esa semana. `node scripts/alertas.js --preview correo.html` escribe el correo en un archivo sin enviarlo.

**Destinatarios**: se configuran con la ruedita del panel de Notificaciones del tablero (nombre opcional y correo; hasta 25). La lista vive en el Web App de `scripts/apps-script/alertas-destinatarios.gs` (propiedades del script, no en el repo): el tablero publicado la edita con la URL y la clave que el build deja dentro del HTML cifrado, y la alerta la lee antes de cada envío. Mientras nadie guardó una lista, o si el Web App no responde, se usan los destinatarios de `data/alertas-config.json`; una lista guardada vacía no envía nada. Puesta en marcha del Web App: ver el encabezado del `.gs` (ejecutar `instalar()`, implementar como aplicación web con acceso «Cualquier persona» y crear los secrets `RB_ALERTAS_URL` y `RB_ALERTAS_TOKEN`).

## Objetivos 2026

Arriba van las dos fuentes de Drive (objetivos y ventas), cada una con su fecha de sincronización y su botón **Sincronizar**:

1. **Objetivos y ventas por canal**: pestañas Enero–Diciembre y Anual. Cada mes junta la meta del archivo de objetivos y la venta del histórico en un solo cuadro, una fila por canal de ventas, con dos vistas: **Avance vs meta** (meta, esperado al último día con ventas, avance, brecha y detalle semanal) y **Ventas vs 2025** (mismo mes de 2025, participación, transacciones y ticket). La meta de cada objetivo va a la columna de ventas que nombra (WHATSAPP → WhatsApp, OUTLET → Showroom); Instagram y Facebook van con meta 0. Es solo en este cuadro: Proyecciones, el plan por campaña y el correo siguen midiendo «Redes y WhatsApp» con las tres columnas. Los meses sin metas solo tienen la vista de ventas; Anual muestra los 12 meses y la meta del período.
2. **Evolución semanal 2025 vs 2026**: el gráfico semanal, mensual o acumulado por canal. Va dentro del mismo recuadro, debajo del cuadro y sus notas, en el mes que esté abierto.

`data/objetivos-2026.json` es la única fuente de metas: lo leen el módulo, Proyecciones, el KPI anual del Comparativo YoY y el correo semanal (`alertas.js`). Al publicar, el build lo incrusta en la página.

**Formato del archivo de objetivos** (hoy *Royal Baby - Objetivos trimestre*, la única hoja de cálculo de la carpeta Objetivos):

- Pestaña **Objetivos 2026**: una fila de encabezado con `Canal` y los meses a la derecha (`Octubre`, `Noviembre`…), una fila por canal y la fila `Total`. La meta de cada mes es el monto de su columna. Los totales y la fila «Crecimiento sobre 2025» son fórmulas; el tablero solo usa el total para avisar si no cuadra con la suma de canales.
- Pestaña **Venta 2025**: la misma tabla con la venta del año anterior. Es la referencia; el año sale del nombre de la pestaña.
- Canales, con su nombre en la columna `Canal`: `Tienda Miraflores` (o `Tienda`), `Página Web` (o `Web`), `Redes y WhatsApp` (o `WhatsApp`, `Redes`), `Outlet (Showroom)` (o `Outlet`, `Showroom`). Un canal con otro nombre hace fallar la lectura, para no perderlo en silencio.
- El lector también acepta el formato anterior: una fila con los meses (OCTUBRE, NOVIEMBRE…) con las columnas **PROYECCIÓN** y **VENTA** debajo, y arriba el bloque `TRIMESTRE 2025` como referencia.
- Solo hay metas para los meses del archivo: la pestaña por mes, Proyecciones y el correo solo muestran objetivo en esos meses. El KPI anual del YoY compara contra objetivo solo si el archivo cubre los 12 meses.
- El archivo no lleva la venta: la venta sale del histórico de ventas, siempre con el mismo criterio.

**Canales**: Tienda Miraflores (`Tienda`), Página Web (`Web`), Redes y WhatsApp (`WhatsApp` + `Instagram` + `Facebook`; en el archivo, `WHATSAPP`) y Outlet (`Showroom`). Cada canal indica en `sheet` qué columnas del histórico suma. **Outlet** son los saldos, que se venden en la web y en el Showroom; el histórico no separa la venta outlet de la web, así que el canal Outlet mide solo el Showroom.

El total de cada mes suma toda la venta registrada.

### Mes calendario

Desde el 6 de octubre de 2026 el módulo compara por **mes calendario** (del 1 al último día del mes), igual que el histórico de la marca, Proyecciones y el correo semanal. Las semanas del detalle van de lunes a domingo, recortadas al mes; la meta de cada semana es proporcional a sus días.

Entre el 22 de julio y el 6 de octubre usó el ciclo comercial 26–25 (las ventas del 26 al fin de mes contaban para el mes siguiente). El pipeline sigue generando los campos `*_commercial` de `data/ventas-2026.json`, aunque el tablero ya no los usa. Hito de rollback antes del ciclo 26–25: `hito-pre-cierre-25-20260722`.
