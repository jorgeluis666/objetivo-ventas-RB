# Royal Baby · Dashboard de Ventas 2026

Dashboard de ventas por canal (Tienda, Web, WhatsApp, Showroom, Instagram, Facebook) con seguimiento del plan de objetivos del cliente, comparativo YoY, distribución y análisis de productos web.

Incluye además un módulo de planificación de pauta Meta Ads con modelos Web por
CPA y WhatsApp por CPL, estados separados por cliente, historial de versiones,
resumen copiable y exportación a Excel, y el módulo **Gasto publicitario**, que
muestra la inversión y los resultados de Meta Ads y Google Ads desde sus carpetas
de Drive.

Los datos de 2026 se sincronizan automáticamente desde un Google Sheet mediante un pipeline que corre en GitHub Actions.

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
    objectives.js         Vista Objetivos 2026: plan del cliente vs ventas
    config.js             Usuarios y destinatarios de alertas
    sheets.js             Indicador de sync + botón Actualizar
    meta-planner.js       Planificador Meta Ads por cliente
    projections.js        Módulo Proyecciones
    gasto.js              Módulo Gasto publicitario (Meta Ads y Google Ads desde Drive)
    main.js               Orquestación: init, navegación, render
  data/
    ventas-2026.json      Generado por el pipeline (no editar a mano)
    objetivos-2026.json   Plan de metas del cliente: canales y escenarios mínima e ideal
    ads-data.json         Inversión publicitaria para Proyecciones
    ads-2026.json         Google Ads + Meta Ads desde Drive, para Gasto publicitario (generado por sync-ads.js)
  scripts/
    fetch-data.js         Lee Google Sheets → escribe data/ventas-2026.json
    sync-ads.js           Lee las carpetas de Drive de Google Ads y Meta → data/ads-2026.json
    build.js              Arma dist/ (HTML con todo incrustado, cifrado con la clave)
    alertas.js            Correo semanal de alertas
    weekly-check.js       Revisión semanal del pipeline
  deploy/
    pages-gate.html       Pantalla de acceso que descifra el tablero
  .github/workflows/
    update-data.yml       Sync del sheet (lunes) + workflow_dispatch
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

En local el tablero se abre sin clave y lee `data/ventas-2026.json`, `data/ads-data.json`, `data/objetivos-2026.json` y `data/ads-2026.json`. Si falta `data/ventas-2026.json`, muestra un banner de error. Para generarlo desde el sheet privado (una sola vez):

1. Crear un service account en Google Cloud Console con permiso de lectura de Sheets API.
2. Descargar el JSON y guardarlo en `credentials/service-account.json` (ignorado por git).
3. Compartir el sheet con el email del service account.
4. Ejecutar:

```bash
npm run fetch
```

## Pipeline de datos

El workflow `update-data.yml` corre los lunes (tres pasadas, para cubrir distintos horarios de carga del sheet) y ejecuta `node scripts/fetch-data.js` con el secret `SERVICE_ACCOUNT_JSON` (JSON del service account pegado entero). Si hay cambios en `data/ventas-2026.json`, commitea a `main`. Ese commit lo hace `GITHUB_TOKEN`, que no dispara otros workflows: el deploy y las alertas se encadenan con `workflow_run` al terminar la actualización.

Si la lectura de un mes cerrado falla, el script se detiene sin escribir: queda publicado el último JSON válido y el workflow termina en rojo.

Para forzar una sincronización: `Actions → Actualizar datos de ventas → Run workflow`.

El botón **Actualizar** del dashboard recarga la página para traer la última versión publicada. No dispara el workflow: eso exigiría guardar un token de GitHub en el navegador, y el tablero lo abren clientes.

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

Módulo del grupo Reportes, después de Proyecciones (`js/gasto.js`, vista `view-rep`). Solo usa las carpetas de Drive **Meta Files** y **Google Files**, a través de `data/ads-2026.json`. Publicado, el JSON va incrustado en el HTML cifrado (`window.RB_GASTO_DATA`, sin `rules`, `checks`, `repairs` ni las columnas diarias que la vista no usa); en local se lee con `fetch`.

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

## Publicación y acceso

`deploy.yml` corre en cada push a `main`, después de cada actualización de datos y a mano (`Run workflow`):

1. `node scripts/build.js` incrusta en `dist/index.html` el CSS, todos los `js/` y los datos (`ventas-2026.json`, `ads-data.json`, `objetivos-2026.json` y `ads-2026.json`, este último recortado a lo que lee el tablero). Falla si `index.html` carga algún archivo local que no se pueda incrustar o publicar.
2. Con el secret `RB_PAGE_PASSWORD` cifra ese HTML (AES-256-GCM, llave PBKDF2-SHA256 de 600 000 iteraciones) dentro de `deploy/pages-gate.html`. El navegador lo descifra con la clave; sin ella, el HTML publicado no muestra nada del tablero.
3. Sube `dist/` a GitHub Pages: solo `index.html`, `assets/` y `CNAME`. `data/`, `scripts/`, los CSV y este README no se publican.

El workflow falla si falta el secret o si `dist/index.html` sale sin cifrar o con alguno de los datos en claro (`RB_VENTAS_DATA`, `RB_ADS_DATA`, `RB_OBJETIVOS_DATA`, `RB_GASTO_DATA`).

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
3. Compartir el spreadsheet con el email del service account (permiso lector).
4. Secret `RB_PAGE_PASSWORD`: clave de acceso al tablero (16 caracteres o más).
5. Opcional: secret `RB_DRIVE_API_KEY` (clave de API de Google con Drive API habilitada) para que `sync-ads.yml` liste las carpetas con la API en vez de la vista pública.
6. Secret `RESEND_API_KEY` para el correo de alertas. Opcional: variable `DASHBOARD_URL` si el enlace del correo debe ser otro que el de `data/alertas-config.json`.
7. DNS de `limaretail.com`: registro CNAME `royalbaby` → `jorgeluis666.github.io`.
8. `Settings → Pages`: Source **GitHub Actions**, Custom domain `royalbaby.limaretail.com` y **Enforce HTTPS**.
9. Pushear a `main`: el deploy corre solo.

## Objetivos 2026

El módulo cruza el plan de metas del cliente con la venta registrada en el Sheet. El plan vive en `data/objetivos-2026.json` y es la única fuente de metas: lo leen el módulo Objetivos 2026, Proyecciones, el KPI anual del Comparativo YoY y el correo semanal (`alertas.js`). Al publicar, el build lo incrusta en la página.

- **Canales del plan**: Tienda Miraflores (`Tienda`), Página Web (`Web`), Redes y WhatsApp (`WhatsApp` + `Instagram` + `Facebook`) y Outlet (`Showroom`). Cada canal indica en `sheet` qué columnas del Sheet suma.
- **Outlet** son los saldos, que se venden en la web y en el Showroom. El Sheet no separa la venta outlet de la web, así que el canal Outlet mide solo el Showroom y la venta outlet de la web queda en Página Web.
- **Escenarios**: `minima` (+10% sobre 2025) e `ideal` (+20%). El módulo tiene un selector y cada navegador recuerda su elección. Proyecciones, el KPI anual y el correo usan siempre la mínima.
- **Metas**: copiadas tal cual del plan del cliente (*Plan Campañas 2026 final*), sin recalcular. Las de Redes y WhatsApp en noviembre y diciembre no salen del real 2025 × 1.1 / × 1.2: así vienen en el plan. La meta anual es la suma de los canales: S/ 1,082,150 la mínima y S/ 1,177,343 la ideal.
- **Total del mes**: suma toda la venta registrada, también la de canales sin meta ese mes (el Showroom de enero a junio).
- **Cambios**: las metas no se editan desde el tablero. Se cambian en `data/objetivos-2026.json` y se publican con un push.
- El módulo compara por ciclo comercial 26–25; el correo semanal, por mes calendario.

### Ciclo comercial de objetivos

El módulo **Objetivos 2026** usa ciclo comercial **26–25**: las ventas del día 26 al cierre calendario se acumulan al objetivo del mes siguiente. Los reportes comparativos generales conservan el mes calendario.

Hito de rollback antes de este cambio: `hito-pre-cierre-25-20260722`.
