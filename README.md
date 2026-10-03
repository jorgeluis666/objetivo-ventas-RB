# Royal Baby · Dashboard de Ventas 2026

Dashboard de ventas por canal (Tienda, Web, WhatsApp, Showroom, Instagram, Facebook) con seguimiento del plan de objetivos del cliente, comparativo YoY, distribución y análisis de productos web.

Incluye además un módulo de planificación de pauta Meta Ads con modelos Web por
CPA y WhatsApp por CPL, estados separados por cliente, historial de versiones,
resumen copiable y exportación a Excel.

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
    main.js               Orquestación: init, navegación, render
  data/
    ventas-2026.json      Generado por el pipeline (no editar a mano)
    objetivos-2026.json   Plan de metas del cliente: canales y escenarios mínima e ideal
    ads-data.json         Inversión publicitaria para Proyecciones
  scripts/
    fetch-data.js         Lee Google Sheets → escribe data/ventas-2026.json
    build.js              Arma dist/ (HTML con todo incrustado, cifrado con la clave)
    alertas.js            Correo semanal de alertas
    weekly-check.js       Revisión semanal del pipeline
  deploy/
    pages-gate.html       Pantalla de acceso que descifra el tablero
  .github/workflows/
    update-data.yml       Sync del sheet (lunes) + workflow_dispatch
    deploy.yml            Build cifrado + deploy a GitHub Pages
    alertas-semanales.yml Correo semanal después de cada actualización
    weekly-check.yml      Revisión semanal del pipeline
```

## Desarrollo local

```bash
npm install
npm run dev          # live-server en http://localhost:3000
```

En local el tablero se abre sin clave y lee `data/ventas-2026.json`, `data/ads-data.json` y `data/objetivos-2026.json`. Si falta `data/ventas-2026.json`, muestra un banner de error. Para generarlo desde el sheet privado (una sola vez):

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

## Publicación y acceso

`deploy.yml` corre en cada push a `main`, después de cada actualización de datos y a mano (`Run workflow`):

1. `node scripts/build.js` incrusta en `dist/index.html` el CSS, todos los `js/` y los datos (`ventas-2026.json`, `ads-data.json` y `objetivos-2026.json`). Falla si `index.html` carga algún archivo local que no se pueda incrustar o publicar.
2. Con el secret `RB_PAGE_PASSWORD` cifra ese HTML (AES-256-GCM, llave PBKDF2-SHA256 de 600 000 iteraciones) dentro de `deploy/pages-gate.html`. El navegador lo descifra con la clave; sin ella, el HTML publicado no muestra nada del tablero.
3. Sube `dist/` a GitHub Pages: solo `index.html`, `assets/` y `CNAME`. `data/`, `scripts/`, los CSV y este README no se publican.

El workflow falla si falta el secret o si `dist/index.html` sale sin cifrar.

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
5. Secret `RESEND_API_KEY` para el correo de alertas. Opcional: variable `DASHBOARD_URL` si el enlace del correo debe ser otro que el de `data/alertas-config.json`.
6. DNS de `limaretail.com`: registro CNAME `royalbaby` → `jorgeluis666.github.io`.
7. `Settings → Pages`: Source **GitHub Actions**, Custom domain `royalbaby.limaretail.com` y **Enforce HTTPS**.
8. Pushear a `main`: el deploy corre solo.

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
