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
    main.js               Orquestación: init, navegación, render
  data/
    ventas-2026.json      Generado por fetch-data.js (no editar a mano)
    objetivos-2026.json   Objetivos de la marca desde Drive, generado por sync-objetivos.js (no editar a mano)
    ads-2026.json         Google Ads + Meta Ads desde Drive, para Gasto publicitario y Proyecciones (generado por sync-ads.js)
  scripts/
    fetch-data.js         Ventas: carpeta de Drive (2026) + Google Sheet (2025) → data/ventas-2026.json
    sync-objetivos.js     Objetivos: carpeta de Drive → data/objetivos-2026.json
    drive-publico.js      Encuentra la hoja de una carpeta de Drive compartida por enlace
    sync-ads.js           Lee las carpetas de Drive de Google Ads y Meta → data/ads-2026.json
    build.js              Arma dist/ (HTML con todo incrustado, cifrado con la clave)
    alertas.js            Correo semanal de alertas
    weekly-check.js       Revisión semanal del pipeline
  deploy/
    pages-gate.html       Pantalla de acceso que descifra el tablero
  .github/workflows/
    update-data.yml       Ventas, todos los días a las 06:00 Lima + workflow_dispatch
    sync-objetivos.yml    Objetivos, todos los días a las 06:05 Lima + workflow_dispatch
    sync-ads.yml          Sync diario de las carpetas de Meta Ads y Google Ads (07:00 Lima) + workflow_dispatch
    deploy.yml            Build cifrado + deploy a GitHub Pages
    alertas-semanales.yml Correo semanal después de cada actualización
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
| `update-data.yml` · *Actualizar datos de ventas* | 06:00 | `fetch-data.js` | `data/ventas-2026.json` |
| `sync-objetivos.yml` · *Sincronizar objetivos comerciales* | 06:05 | `sync-objetivos.js` | `data/objetivos-2026.json` |

- **Ventas 2026**: la hoja de la carpeta [Ventas Royal Baby - 2026](https://drive.google.com/drive/folders/1JJdjIzDu2CrhcBI9gBUTUuPAXnKYUQal). Es la fuente de 2026 de todo el tablero (Objetivos, YoY, Distribución, Proyecciones y correo). **2025** sigue saliendo de su Google Sheet con el secret `SERVICE_ACCOUNT_JSON` (JSON del service account pegado entero).
- **Objetivos**: la hoja de la carpeta [Objetivos Royal Baby](https://drive.google.com/drive/folders/1wfOOM4F3TRcxehX_dfZWDYSTVBPrPgjg).
- Las carpetas están compartidas como "Cualquier persona con el enlace": se leen sin credenciales (vista pública de la carpeta y exportación `.xlsx` de la hoja). Con el secret opcional `RB_DRIVE_API_KEY` la carpeta se lista con la API de Drive.
- Cada carpeta debe tener **una sola** hoja de cálculo de Google. Si el archivo se reemplaza por otro, la corrida siguiente lo encuentra solo.
- Si una lectura falla (archivo no compartido, falta la pestaña de un mes cerrado, falta la columna PROYECCIÓN, canal desconocido), el script no escribe nada: queda publicado el último JSON válido y el workflow termina en rojo.

Esos commits los hace `GITHUB_TOKEN`, que no dispara otros workflows: el deploy y las alertas se encadenan con `workflow_run` al terminar cada uno. Para forzar una corrida: `Actions → <workflow> → Run workflow`.

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

- **Google Ads** ([carpeta](https://drive.google.com/drive/folders/1TT5KTVZuGlFc7OqvGAz9nuRVyJFvwJpd)): `Royal Baby GA - <Mes> 2026`, informe de campaña del mes.
- **Meta Ads** ([carpeta](https://drive.google.com/drive/folders/1kjz_QSgFpkd9semvyjrlLQi3ETH8-DPm)): `Royal Baby - <Mes> 2026`, export del Administrador de anuncios con desglose diario, por edad, sexo y anuncio.

Los archivos son hojas de cálculo de Google: se descargan exportándolas a CSV (solo la primera pestaña). Un CSV subido sin convertir también se lee. Con la variable `RB_DRIVE_API_KEY` usa la API de Drive; sin ella, la vista pública de la carpeta.

- **Mes**: sale del contenido (rango del informe en Google Ads, columna Día en Meta); el nombre del archivo es solo respaldo. Un mes puede tener una sola plataforma.
- **Meta**: la serie diaria va por día y campaña (`daily`), con edad, sexo y anuncio sumados. Por mes se guardan además el público por edad y sexo (`audience`) y los 10 anuncios con más compras y conversaciones (`ads.top`, con su enlace de vista previa; dos anuncios con el mismo nombre se separan por el ID del enlace). Alcance y frecuencia no se suman ni se publican. CTR, CPM y costo por resultado se recalculan sobre los totales. Cada campaña conserva su objetivo y su tipo de resultado, y el mes no suma resultados de tipos distintos.
- **Embudo de Meta**: impresiones → clics en el enlace → visitas a la página de destino (`landingViews`) → agregados al carrito (`addToCart`) → pagos iniciados (`checkouts`) → compras, en el total del mes y en cada campaña. Si el export no trae alguna de esas columnas, queda en `null` y se avisa.
- **KPI de conversión: Compras** (`purchases`, `costPerPurchase`). En Google Ads es la columna *Conversiones por compras*; en Meta, *Compras*. Las *Conversiones* de Google Ads incluyen la categoría Contacto (clics a WhatsApp) y quedan aparte (`conversions`, `conversionsByCategory`). Si el export no trae *Conversiones por compras*, las compras de Google Ads quedan en `null` y se avisa.
- **Google Ads**: llega mensual, así que su serie diaria es estimada (`granularity: "mensual"`) y el consolidado lo marca (`dailyBasis: "mixto"`).
- **Informe segmentado**: si trae la columna *Categoría de conversión*, las campañas salen con costo, impresiones y clics en cero. Entonces los KPIs del mes se toman de *Total: Cuenta*, el desglose real queda por tipo de campaña (`byType`) y cada campaña sale con `complete: false` y esas cifras en `null`. El JSON lo avisa en `pending`.
- **Validación**: la suma por tipo y la de campañas se comparan contra *Total: Cuenta*; lo que no cuadra va a `warnings`. Las filas *Total: Campañas* y *Total: Campañas filtradas* son la suma de las campañas, no un tipo. Las hojas de Google Ads se armaron importando el CSV con coma decimal, y las impresiones o clics que terminaban en cero perdieron esos ceros (`122,200` → `122,2`). El script los completa, lo anota en `repairs` y la validación confirma que cuadran.
- Si falla la descarga o la lectura de algún archivo, no escribe nada y termina con código 1.

### Sincronización automática

`sync-ads.yml` corre todos los días a las 07:00 de Lima (`0 12 * * *` UTC) y a mano (`Actions → Sincronizar inversión publicitaria → Run workflow`). Ejecuta `npm ci` y `node scripts/sync-ads.js`, y commitea `data/ads-2026.json` solo si cambió (con `git pull --rebase` antes del push, por si otro workflow de datos commiteó). Como ese commit lo hace `GITHUB_TOKEN`, el deploy se encadena con `workflow_run`.

Si un archivo falla, el workflow queda en rojo, el JSON anterior se conserva y no hay deploy. El secret `RB_DRIVE_API_KEY` es opcional: sin él se usa la vista pública de las carpetas.

## Gasto publicitario

Módulo del grupo Reportes, después de Proyecciones (`js/gasto.js`, vista `view-rep`). Solo usa las carpetas de Drive **Meta Files** y **Google Files**, a través de `data/ads-2026.json`. Publicado, el JSON va incrustado en el HTML cifrado (`window.RB_GASTO_DATA`, sin `rules`, `checks`, `repairs` ni las columnas diarias que el tablero no usa); en local se lee con `fetch`.

- **Arriba**: la fecha de los datos y el aviso «se sincroniza sola todos los días a las 07:00 (Lima)». No hay botón para sincronizar: exigiría un token de GitHub en el navegador, y el tablero lo abren clientes.
- **Pestañas Meta Ads y Google Ads**: cada una con su franja de fuente, el botón «Abrir carpeta», el selector de mes (compartido entre pestañas) y los avisos del sync (`pending` y los `warnings` del mes). Si la carpeta no tiene informes, muestra un estado vacío con el enlace a la carpeta.
- **Meta Ads**:
  - KPIs: Inversión, Compras, Valor de conversión y Conversaciones iniciadas (WhatsApp), con su variación contra el mes anterior.
  - Embudo de impresiones a compras. Un paso en 0 con pasos posteriores mayores se marca «sin registro» (el evento no llega a Meta) y no corta el embudo.
  - Inversión diaria, con el desglose por campaña en el tooltip.
  - Campañas con objetivo, tipo de resultado, resultados, costo por resultado, inversión, compras y ROAS.
  - Top anuncios con su vista previa, público por edad y sexo, e inversión y ROAS por mes.
- **Google Ads**:
  - KPIs: Inversión, Compras (*Conversiones por compras*), Valor de conversión y CTR. Las *Conversiones* con Contacto (clics a WhatsApp) se muestran aparte.
  - Inversión por tipo de campaña (`byType`, completa).
  - Por campaña, mientras el informe venga segmentado: solo compras, valor y conversiones por categoría, con una nota. Si se reexporta sin segmentar (`campaignsComplete: true`), la tabla suma inversión y ROAS por campaña.
  - Inversión mensual. Google llega con un total por mes: no hay serie diaria.
- **Diseño**: tema claro del tablero (`css/dashboard-minimal.css`); reusa `.kpi-strip`/`.kpi-pill` y el selector de mes de Proyecciones. Colores por plataforma, los mismos de Proyecciones: Meta `#1877F2`, Google `#4285F4`; los tipos de resultado de Meta usan los de sus fuentes (compras `#1877F2`, conversaciones `#25D366`, interacciones `#E1306C`).

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
- **Otros paneles**: resumen del trimestre con gráfico, escenarios de WhatsApp si su ROAS baja al escalar (mismas proporciones que 16x → 13x → 10x de la estrategia) con el ROAS del mes en curso, Google Ads por campaña en los meses cerrados (chats de WhatsApp = conversiones de contacto), Branding → Tienda (CPM de Reconocimiento e impresiones estimadas; Gasto publicitario no publica el alcance) y la curva semanal 2025 con las ventanas de los picos.
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
6. Secret `RESEND_API_KEY` para el correo de alertas. Opcional: variable `DASHBOARD_URL` si el enlace del correo debe ser otro que el de `data/alertas-config.json`.
7. DNS de `limaretail.com`: registro CNAME `royalbaby` → `jorgeluis666.github.io`.
8. `Settings → Pages`: Source **GitHub Actions**, Custom domain `royalbaby.limaretail.com` y **Enforce HTTPS**.
9. Pushear a `main`: el deploy corre solo.

## Objetivos 2026

El módulo tiene dos zonas, cada una con su fuente de Drive, su fecha de sincronización y su botón **Sincronizar**:

1. **Objetivos comerciales** (arriba): las metas que fija la marca, con su avance. Cuadro de metas por canal y mes (meta, venta y avance, referencia del año anterior) y una pestaña por mes con ritmo, alertas y detalle semanal.
2. **Ventas 2026 · histórico de la marca** (abajo): ventas por canal y mes calendario, y la evolución semanal 2025 vs 2026.

`data/objetivos-2026.json` es la única fuente de metas: lo leen el módulo, Proyecciones, el KPI anual del Comparativo YoY y el correo semanal (`alertas.js`). Al publicar, el build lo incrusta en la página.

**Formato del archivo de objetivos** (hoy *LIMA REATIL ULTIMO TRIMESTRE 2026*):

- Una fila con los meses (OCTUBRE, NOVIEMBRE…) y debajo, en el bloque de cada mes, las columnas **PROYECCIÓN** y **VENTA**. La meta es la PROYECCIÓN.
- Una fila por canal con su nombre a la izquierda: `WHATSAPP` (o `REDES`), `TIENDA`, `WEB`, `OUTLET` (o `SHOWROOM`). Un canal con otro nombre hace fallar la lectura, para no perderlo en silencio.
- Arriba, opcional, un bloque con un título con año (`TRIMESTRE 2025`) y una fila de montos por canal en el mismo orden: es la referencia del año anterior.
- Solo hay metas para los meses del archivo: la pestaña por mes, Proyecciones y el correo solo muestran objetivo en esos meses. El KPI anual del YoY compara contra objetivo solo si el archivo cubre los 12 meses.
- La columna **VENTA** del archivo no se usa: la venta sale del histórico de ventas, siempre con el mismo criterio.

**Canales**: Tienda Miraflores (`Tienda`), Página Web (`Web`), Redes y WhatsApp (`WhatsApp` + `Instagram` + `Facebook`; en el archivo, `WHATSAPP`) y Outlet (`Showroom`). Cada canal indica en `sheet` qué columnas del histórico suma. **Outlet** son los saldos, que se venden en la web y en el Showroom; el histórico no separa la venta outlet de la web, así que el canal Outlet mide solo el Showroom.

El total de cada mes suma toda la venta registrada.

### Mes calendario

Desde el 6 de octubre de 2026 el módulo compara por **mes calendario** (del 1 al último día del mes), igual que el histórico de la marca, Proyecciones y el correo semanal. Las semanas del detalle van de lunes a domingo, recortadas al mes; la meta de cada semana es proporcional a sus días.

Entre el 22 de julio y el 6 de octubre usó el ciclo comercial 26–25 (las ventas del 26 al fin de mes contaban para el mes siguiente). El pipeline sigue generando los campos `*_commercial` de `data/ventas-2026.json`, aunque el tablero ya no los usa. Hito de rollback antes del ciclo 26–25: `hito-pre-cierre-25-20260722`.
