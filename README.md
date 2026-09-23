# Lima Retail · Dashboard de Ventas 2026

Dashboard de ventas por canal (Tienda, Web, WhatsApp, Showroom, Instagram, Facebook) con comparativo YoY, distribución, análisis de productos web y simulador de objetivos.

Incluye además un módulo de planificación de pauta Meta Ads con modelos Web por
CPA y WhatsApp por CPL, estados separados por cliente, historial de versiones,
resumen copiable y exportación a Excel.

Los datos de 2026 se sincronizan automáticamente desde un Google Sheet mediante un pipeline que corre en GitHub Actions.

## Estructura

```
/
  index.html              Shell HTML (carga módulos separados)
  css/
    ds.css                Design system (tokens + componentes)
    dashboard.css         Estilos específicos del dashboard
  js/
    data-static.js        Datos 2025, productos web, targets por defecto
    data-live.js          Fetcher de data/ventas-2026.json
    charts.js             Instancias de Chart.js
    objectives.js         Vista de Objetivos (pace tracker, weekly charts)
    meta-planner.js       Planificador Meta Ads por cliente
    sheets.js             Indicador de sync + trigger de workflow
    main.js               Orquestación: init, navegación, render
  data/
    ventas-2026.json      Generado por el pipeline (no editar a mano)
  scripts/
    fetch-data.js         Lee Google Sheets → escribe data/ventas-2026.json
    build.js              Inlines css+js en dist/index.html y genera dist/.htaccess
  deploy/
    .htaccess             Plantilla de acceso (Basic Auth) y cabeceras de seguridad
  .github/workflows/
    update-data.yml       Sync horario del sheet + workflow_dispatch
    deploy.yml            Build + deploy al hosting de Lima Retail (FTPS) en cada push a main
```

## Desarrollo local

```bash
npm install
npm run dev          # live-server en http://localhost:3000
```

Si el navegador no tiene `data/ventas-2026.json`, el dashboard muestra un banner de error. Para generarlo desde un sheet privado (una sola vez):

1. Crear un service account en Google Cloud Console con permiso de lectura de Sheets API.
2. Descargar el JSON y guardarlo en `credentials/service-account.json` (ignorado por git).
3. Compartir el sheet con el email del service account.
4. Ejecutar:

```bash
npm run fetch
```

## Pipeline de datos

El workflow `update-data.yml` corre cada hora y ejecuta `node scripts/fetch-data.js` usando el secreto `SERVICE_ACCOUNT_JSON` (JSON del service account pegado entero como secreto del repo). Si hay cambios en `data/ventas-2026.json`, commitea a `main`, lo que dispara el deploy.

### Forzar una sincronización inmediata

Opción A — desde GitHub: `Actions → Actualizar datos de ventas → Run workflow`.

El botón **Actualizar** del dashboard solo recarga `data/ventas-2026.json` ya publicado. Ya no dispara el workflow: eso exigía guardar un Personal Access Token con scope `workflow` en el navegador, y el tablero lo abren clientes.

## Deploy

`deploy.yml` corre en cada push a `main`:

1. `node scripts/build.js` → genera `dist/index.html` con todos los `.css` y `.js` inlined, `dist/data/ventas-2026.json` y `dist/.htaccess`.
2. Sube `dist/` por FTPS a la carpeta del cliente.

También corre después de cada actualización de datos. Solo se publica `ventas-2026.json`: `alertas-*.json`, `objetivos-2026.json` y `csv-backups/` nunca salen del repo.

El acceso lo controla Apache con HTTP Basic Auth (una cuenta por cliente); no hay contraseña en el HTML. `dist/.htaccess` se genera desde `deploy/.htaccess` con la ruta del archivo de claves y una CSP con el hash de cada script.

## Configuración inicial (una vez)

1. En Google Cloud Console: habilitar **Sheets API** y crear un service account.
2. Descargar el JSON de credenciales y pegar su contenido completo como secret `SERVICE_ACCOUNT_JSON` en `Settings → Secrets → Actions`.
3. Compartir el spreadsheet con el email del service account (permiso lector).
4. En cPanel: **Dominios** > activar **Forzar redireccion HTTPS**; **Privacidad de directorios** > carpeta del cliente > activar proteccion y crear el usuario con una contraseña larga y aleatoria. cPanel crea el archivo de claves en `/home/<usuario_cpanel>/.htpasswds/<ruta_de_la_carpeta>/passwd`.
5. Secrets de Actions: `HTPASSWD_PATH` (ruta del paso 4), `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (cuenta FTP limitada a la carpeta del cliente) y `FTP_SERVER_DIR` (carpeta destino terminada en `/`).
6. Variable de Actions `DASHBOARD_URL`: URL del tablero en el hosting, usada en los correos de alerta.
7. Desactivar GitHub Pages (`Settings → Pages`) y dejar el repositorio en privado: los datos de ventas no deben quedar publicos.
8. Pushear a main — el primer deploy corre solo.

### Ciclo comercial de objetivos

El módulo **Objetivos 2026** usa ciclo comercial **26–25**: las ventas del día 26 al cierre calendario se acumulan al objetivo del mes siguiente. Los reportes comparativos generales conservan el mes calendario.

Hito de rollback antes de este cambio: `hito-pre-cierre-25-20260722`.
