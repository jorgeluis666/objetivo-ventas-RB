#!/usr/bin/env node
/* ============================================================
   scripts/alertas.js — Alerta de objetivos de venta.

   Sale los lunes a las 6:00 p. m. (ALERTA_MOTIVO=lunes, una vez por semana) y cada vez que cambian
   las ventas del archivo de Drive (ALERTA_MOTIVO=ventas, después de "Actualizar datos de ventas":
   solo si las cifras de ventas-2026.json son otras que en el último envío).

   Lee:
     data/ventas-2026.json     → ventas reales acumuladas por canal
     data/objetivos-2026.json  → objetivos de la marca (Drive): canales y metas por mes
     data/alertas-config.json  → remitente y destinatarios por defecto
     Destinatarios: los que se configuran con la ruedita de Notificaciones del tablero (Web App de
     scripts/apps-script/alertas-destinatarios.gs, por RB_ALERTAS_URL y RB_ALERTAS_TOKEN); si no
     está conectado o todavía no se guardó una lista, los de alertas-config.json.

   Envía email HTML por el correo del hosting (SMTP) o, si no está configurado, por Resend.
   Registra el envío en data/alertas-envios.json (idempotencia).

   Uso:
     node scripts/alertas.js             # envío real
     node scripts/alertas.js --dry-run   # simula sin enviar
     node scripts/alertas.js --force     # ignora idempotencia (reenvía)
     node scripts/alertas.js --preview correo.html   # escribe el correo en un archivo, sin enviar

   Variables de entorno para el envío real (una de las dos opciones):
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS → cuenta de correo del hosting (alertas@limaretail.com)
     RESEND_API_KEY   → API key de Resend
   Variables opcionales:
     DRY_RUN=true     → equivale a --dry-run (para GitHub Actions)
     ALERTA_MOTIVO    → lunes | ventas | manual (por defecto, manual: como el lunes)
     RB_ALERTAS_URL, RB_ALERTAS_TOKEN → lista de destinatarios del tablero
   ============================================================ */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const FORCE   = process.argv.includes('--force');
// --preview archivo.html: escribe el correo en ese archivo y termina, sin enviar ni registrar.
const PREVIEW = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null;
const MOTIVO  = ['lunes', 'ventas'].includes(process.env.ALERTA_MOTIVO) ? process.env.ALERTA_MOTIVO : 'manual';

// ── Helpers ──────────────────────────────────────────────────
const fmt     = n => Math.round(n).toLocaleString('es-PE');
const pctOf   = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

// Lima = UTC-5 sin DST. Usamos UTC internamente y restamos 5h.
function limaDate() {
  const now = new Date();
  return new Date(now.getTime() - 5 * 3600 * 1000);
}

// Semana ISO 8601 — ej. "2026-W22"
function isoWeek(d) {
  const date   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Ciclo de venta de la marca: cada mes va del 27 del mes anterior al 26 (js/ciclo.js).
const Ciclo  = require('../js/ciclo.js');
const MONTHS = Ciclo.MESES;

// ── Cargar archivos ──────────────────────────────────────────
const salesData  = readJson(path.join(ROOT, 'data/ventas-2026.json'));
const objData    = readJson(path.join(ROOT, 'data/objetivos-2026.json'));
const config     = readJson(path.join(ROOT, 'data/alertas-config.json'));
// URL del tablero: la variable DASHBOARD_URL del repo, si existe, manda sobre el JSON.
if (process.env.DASHBOARD_URL) config.url_dashboard = process.env.DASHBOARD_URL;
const enviosPath = path.join(ROOT, 'data/alertas-envios.json');
const enviosData = readJson(enviosPath);

// ── Fecha Lima ───────────────────────────────────────────────
// Mes en curso por el ciclo de venta (desde el 27, el siguiente) y día dentro del ciclo.
const lima        = limaDate();
const weekKey     = isoWeek(lima);
const cicloHoy    = Ciclo.mesDe(lima.toISOString().slice(0, 10));
const monthIdx    = cicloHoy.mi;               // 0 = Enero
const dayOfMonth  = cicloHoy.dia;
const limaYear    = cicloHoy.year;
const curMonth    = MONTHS[monthIdx];
const curMonthDays = cicloHoy.dias;
const cicloLabel  = Ciclo.rangoMes(limaYear, monthIdx);

// Último día con ventas cargadas en la hoja (fuente2026.ultimoDia). La hoja se carga con uno o dos
// días de atraso: el ritmo, la proyección, lo esperado y los días que quedan se miden hasta ese día,
// no hasta hoy (con hoy, el ritmo divide la venta entre días sin cargar y la proyección queda baja).
// Sin el dato, hasta hoy.
const ultimoDia   = salesData.fuente2026?.ultimoDia || null;
const diasVentas  = ultimoDia ? Ciclo.diasHasta(limaYear, monthIdx, ultimoDia) : dayOfMonth;
const corteLabel  = Ciclo.corta(Ciclo.fechaDe(limaYear, monthIdx, diasVentas));

// Fecha legible en español (Lima)
const fechaLabel = lima.toLocaleDateString('es-PE', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
});

console.log(`\n▶ Alerta semanal ${weekKey}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
console.log(`  Fecha Lima : ${fechaLabel}`);
console.log(`  Mes actual : ${curMonth} ${limaYear} (ciclo ${cicloLabel}) · hoy es el día ${dayOfMonth} de ${curMonthDays}`);
console.log(`  Ventas al  : ${corteLabel} (día ${diasVentas} de ${curMonthDays})`);

// ── Idempotencia ─────────────────────────────────────────────
// Huella de las ventas: ventas-2026.json se reescribe en cada lectura diaria (cambia "generated"),
// así que lo que cuenta es si cambiaron las cifras.
const huellaVentas = crypto.createHash('sha256').update(JSON.stringify(salesData.d2026 || {})).digest('hex').slice(0, 16);
console.log(`  Motivo     : ${MOTIVO}`);
if (!FORCE && !DRY_RUN && !PREVIEW) {
  if (MOTIVO === 'ventas' && enviosData.ultimaHuella === huellaVentas) {
    console.log('\n⏭  Las ventas no cambiaron desde el último envío: no hay alerta que mandar.\n');
    process.exit(0);
  }
  if (MOTIVO !== 'ventas' && enviosData.enviados[weekKey]) {
    console.log(`\n⏭  Semana ${weekKey} ya registrada (${enviosData.enviados[weekKey]}).`);
    console.log('   Usa --force para reenviar.\n');
    process.exit(0);
  }
}

// ── Cálculo de métricas ──────────────────────────────────────
// Canales de los objetivos de la marca: cada uno suma una o más columnas del histórico de
// ventas (Redes y WhatsApp = WhatsApp + Instagram + Facebook). La meta es la PROYECCIÓN del
// archivo de objetivos, que solo cubre algunos meses.
const d2026   = salesData.d2026 || {};
const canales = objData.canales;
const targets = objData.metas;

function calcMonth(m) {
  const data = d2026[m]   || {};
  const tgt  = targets[m] || {};
  const rows = canales.map(c => ({
    ch   : c.label,
    real : c.sheet.reduce((s, col) => s + (data[col] || 0), 0),
    meta : tgt[c.key] || 0,
  }));
  const real = rows.reduce((s, r) => s + r.real, 0);
  const meta = rows.reduce((s, r) => s + r.meta, 0);
  const byChannel = rows
    .filter(r => r.meta > 0)   // omitir canales sin objetivo
    .map(r => ({ ...r, pct: pctOf(r.real, r.meta) }));
  return { real, meta, byChannel };
}

// Mes en curso
const cur       = calcMonth(curMonth);
if (cur.meta === 0) {
  console.log(`\n⏭  ${curMonth} no tiene objetivos en data/objetivos-2026.json: no hay alerta que enviar.\n`);
  process.exit(0);
}
const ritmo    = diasVentas > 0 && cur.real > 0 ? cur.real / diasVentas : 0;
const proyeccion = ritmo > 0 ? ritmo * curMonthDays : 0;
const proyPct    = pctOf(proyeccion, cur.meta);
const diaPct     = Math.round(diasVentas / curMonthDays * 100);
const faltante   = Math.max(0, cur.meta - cur.real);
const diasRest   = Math.max(0, curMonthDays - diasVentas);
const dailyNeed  = diasRest > 0 && faltante > 0 ? faltante / diasRest : 0;

// Nivel de alerta
const NIVEL = proyPct >= 90 ? 'verde' : proyPct >= 70 ? 'ambar' : 'rojo';
const NIVEL_LABEL  = { verde:'✅ En track', ambar:'⚠️ Atención', rojo:'🚨 Riesgo' };

// Meses anteriores cerrados con objetivo (hasta 3)
const closedMonths = [];
for (let i = monthIdx - 1; i >= 0 && closedMonths.length < 3; i--) {
  const m = MONTHS[i];
  const { real, meta } = calcMonth(m);
  if (meta > 0) {
    closedMonths.push({ m, real, meta, pct: pctOf(real, meta) });
  }
}

// ── Canales que cumplieron el objetivo ───────────────────────
const achievedChannels = cur.byChannel.filter(r => r.pct >= 100);
const totalSurplus     = achievedChannels.reduce((s, r) => s + (r.real - r.meta), 0);

// Canales con mayor brecha (para sugerencia de redistribución)
const topNeedChannels  = cur.byChannel
  .filter(r => r.pct < 90 && !achievedChannels.find(a => a.ch === r.ch))
  .sort((a, b) => (b.meta - b.real) - (a.meta - a.real))
  .slice(0, 2);

// ── Alerta de brecha a mitad de mes ─────────────────────────
// Solo aplica si ya pasó la mitad del mes
const pastMidMonth = diasVentas >= Math.floor(curMonthDays / 2);
const laggingChannels = pastMidMonth
  ? cur.byChannel.filter(r => {
      const expectedReal = r.meta * diasVentas / curMonthDays;
      return r.pct < 100 && r.real < expectedReal * 0.80;
    }).map(r => ({
      ...r,
      expectedReal: r.meta * diasVentas / curMonthDays,
      lag: r.real - (r.meta * diasVentas / curMonthDays),
    }))
  : [];

// ── Log métricas ─────────────────────────────────────────────
console.log(`\n📊 ${curMonth} ${limaYear}:`);
console.log(`   Real acum.  : S/. ${fmt(cur.real)}`);
console.log(`   Proyección  : S/. ${fmt(proyeccion)}  (${proyPct.toFixed(1)}% de S/. ${fmt(cur.meta)})`);
console.log(`   Nivel       : ${NIVEL_LABEL[NIVEL]}`);
if (faltante > 0) {
  console.log(`   Faltante    : S/. ${fmt(faltante)} en ${diasRest} días (S/. ${fmt(dailyNeed)}/día)`);
}
console.log('\n   Por canal:');
cur.byChannel.forEach(r => {
  console.log(`     ${r.ch.padEnd(18)} real: S/. ${fmt(r.real).padStart(8)}  /  meta: S/. ${fmt(r.meta).padStart(8)}  →  ${r.pct.toFixed(1)}%`);
});
if (achievedChannels.length > 0) {
  console.log(`\n🎯 Objetivo alcanzado: ${achievedChannels.map(r => r.ch).join(', ')}  |  Excedente: S/. ${fmt(totalSurplus)}`);
}
if (laggingChannels.length > 0) {
  console.log(`\n⚠️  Brecha a mitad de mes (día ${diasVentas}/${curMonthDays}):`);
  laggingChannels.forEach(r => {
    console.log(`     ${r.ch.padEnd(18)} lag: S/. ${fmt(Math.abs(r.lag))}`);
  });
}

// ── Helpers HTML ─────────────────────────────────────────────
// El correo usa la estética del tablero (css/dashboard-minimal.css): fondo #f6f9fc, tarjetas blancas
// con borde #dbe5f2 y radio 12px, Inter, etiquetas en mayúsculas espaciadas, píldoras verde / ámbar /
// roja y el azul #2563eb de los botones. Todo va en tablas y estilos en línea para que Gmail y Outlook
// lo respeten.
const MARCA = 'Royal Baby';
const LOGO  = new URL('assets/logo-royal-baby.jpg', config.url_dashboard).href;
const C = {
  bg: '#f6f9fc', card: '#ffffff', border: '#dbe5f2', head: '#f8fbff',
  text: '#06132b', text2: '#52647d', muted: '#7b8da6', brand: '#2563eb', track: '#e2e8f0',
};
const FONT = "Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
// Tonos de las píldoras del tablero: texto, fondo, borde y el color de las cifras y barras.
const TONO = {
  verde: { fg: '#047857', bg: '#d1fae5', bd: '#a7f3d0', val: '#059669', box: '#ecfdf5' },
  ambar: { fg: '#b45309', bg: '#fef3c7', bd: '#fde68a', val: '#d97706', box: '#fffbeb' },
  rojo:  { fg: '#b91c1c', bg: '#fee2e2', bd: '#fecaca', val: '#dc2626', box: '#fef2f2' },
  gris:  { fg: '#52647d', bg: '#f1f5f9', bd: '#e2e8f0', val: '#52647d', box: '#f8fbff' },
};
const tonoDe = p => (p >= 90 ? TONO.verde : p >= 70 ? TONO.ambar : TONO.rojo);
const tonoNivel = TONO[NIVEL];
const money = n => `S/. ${fmt(n)}`;
const signed = n => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

const pill = (texto, t) =>
  `<span style="display:inline-block;background:${t.bg};color:${t.fg};border:1px solid ${t.bd};border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;">${texto}</span>`;

function pillAvance(p) {
  if (p >= 100) return pill('✓ alcanzado', TONO.verde);
  if (p >= 90)  return pill('▲ casi', TONO.verde);
  if (p >= 70)  return pill('⚠ atención', TONO.ambar);
  return pill('▼ brecha', TONO.rojo);
}

// Barra de avance como la del tablero: riel gris de 6px y el tramo cumplido en el color del avance.
function barra(p, t, ancho = 72) {
  const lleno = Math.max(2, Math.round(ancho * Math.min(p, 100) / 100));
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td width="${lleno}" height="6" style="width:${lleno}px;height:6px;background:${t.val};border-radius:3px 0 0 3px;font-size:0;line-height:0;">&nbsp;</td>
    ${ancho - lleno > 0 ? `<td width="${ancho - lleno}" height="6" style="width:${ancho - lleno}px;height:6px;background:${C.track};border-radius:0 3px 3px 0;font-size:0;line-height:0;">&nbsp;</td>` : ''}
  </tr></table>`;
}

const etiqueta = texto =>
  `<div style="font-size:11px;font-weight:700;color:${C.text2};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">${texto}</div>`;

function kpi(lbl, valor, color, sub, p, t) {
  return `<td valign="top" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:12px 14px;">
    <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.12em;">${lbl}</div>
    <div style="font-size:20px;font-weight:600;color:${color};letter-spacing:-0.02em;margin-top:6px;white-space:nowrap;">${valor}</div>
    ${p == null ? '' : `<div style="margin-top:8px;">${barra(p, t, 120)}</div>`}
    <div style="font-size:11px;color:${C.text2};margin-top:6px;">${sub}</div>
  </td>`;
}

const th = (texto, align = 'right') =>
  `<th style="padding:9px 12px;text-align:${align};font-size:11px;font-weight:700;color:${C.text2};text-transform:uppercase;letter-spacing:0.08em;background:${C.head};border-bottom:1px solid ${C.border};white-space:nowrap;">${texto}</th>`;

function channelRows(m) {
  return calcMonth(m).byChannel.map(r => {
    const t = tonoDe(r.pct);
    const gap = r.real - r.meta;
    const td = `padding:10px 12px;border-bottom:1px solid ${C.border};font-size:13px;color:${C.text};`;
    return `<tr>
      <td style="${td}font-weight:600;">${r.ch}</td>
      <td style="${td}text-align:right;white-space:nowrap;">${money(r.real)}</td>
      <td style="${td}text-align:right;white-space:nowrap;color:${C.muted};">${money(r.meta)}</td>
      <td style="${td}text-align:right;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="right" style="border-collapse:collapse;"><tr>
          <td style="padding-right:8px;">${barra(r.pct, t, 56)}</td>
          <td style="font-size:12px;font-weight:700;color:${t.val};white-space:nowrap;">${r.pct.toFixed(0)}%</td>
        </tr></table>
      </td>
      <td style="${td}text-align:right;white-space:nowrap;font-weight:600;color:${gap >= 0 ? TONO.verde.val : TONO.rojo.val};">${signed(gap)}</td>
    </tr>`;
  }).join('');
}

// Recuadro de aviso con el tono de las píldoras (fondo suave y borde del mismo color).
const aviso = (t, titulo, cuerpo) =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.box};border:1px solid ${t.bd};border-radius:12px;">
      <tr><td style="padding:14px 18px;font-family:${FONT};">
        <div style="font-size:14px;font-weight:700;color:${t.fg};margin-bottom:6px;">${titulo}</div>
        <div style="font-size:13px;line-height:1.55;color:${C.text};">${cuerpo}</div>
      </td></tr>
    </table>
  </td></tr>`;

const tarjeta = cuerpo =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${FONT};">${cuerpo}</td></tr>
    </table>
  </td></tr>`;

const brechaTotal = laggingChannels.reduce((s, r) => s + (r.meta - r.real), 0);

// ── Template HTML del email ───────────────────────────────────
const htmlEmail = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>${MARCA} · Alerta semanal de ventas</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:${FONT};">

    <!-- Encabezado: marca como en el panel lateral del tablero -->
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;">
        <tr>
          <td style="padding:16px 12px 16px 20px;width:44px;" width="44"><img src="${LOGO}" width="44" height="44" alt="${MARCA}" style="display:block;width:44px;height:44px;border-radius:50%;border:0;"></td>
          <td style="padding:16px 0;">
            <div style="font-size:18px;font-weight:800;color:#0f172a;line-height:1.1;">${MARCA}</div>
            <div style="font-size:12px;color:${C.muted};margin-top:3px;">BI Agencia Lima Retail</div>
          </td>
          <td align="right" style="padding:16px 20px;">${pill(NIVEL_LABEL[NIVEL], tonoNivel)}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Resumen del mes -->
    ${tarjeta(`
      ${etiqueta(`${MOTIVO === 'ventas' ? 'Ventas actualizadas' : 'Alerta semanal de ventas'} · ${weekKey}`)}
      <div style="font-size:20px;font-weight:700;color:${C.text};letter-spacing:-0.02em;">${curMonth} ${limaYear}: ${proyPct.toFixed(0)}% del objetivo proyectado</div>
      <div style="font-size:14px;color:${C.text2};margin-top:6px;line-height:1.5;">
        ${fechaLabel.charAt(0).toUpperCase() + fechaLabel.slice(1)} · ventas cargadas al ${corteLabel}, día ${diasVentas} de ${curMonthDays} del ciclo ${cicloLabel} (${diaPct}% del mes).
        ${proyPct < 90
          ? `Al ritmo de <strong style="color:${C.text};">${money(ritmo)} por día</strong>, el mes cerraría en ${money(proyeccion)}, ${money(Math.abs(cur.meta - proyeccion))} ${proyeccion < cur.meta ? 'por debajo' : 'por encima'} de la meta.`
          : `Al ritmo de <strong style="color:${C.text};">${money(ritmo)} por día</strong>, el mes cerraría en ${money(proyeccion)}.`}
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        <tr>
          ${kpi('Real acumulado', money(cur.real), C.text, `${pctOf(cur.real, cur.meta).toFixed(0)}% de la meta · al ${corteLabel}`, pctOf(cur.real, cur.meta), TONO.gris)}
          <td width="10" style="width:10px;"></td>
          ${kpi('Proyección de cierre', money(proyeccion), tonoNivel.val, `${proyPct.toFixed(1)}% del objetivo`, proyPct, tonoNivel)}
          <td width="10" style="width:10px;"></td>
          ${kpi('Objetivo del mes', money(cur.meta), C.text, `Falta ${money(faltante)}`, null, null)}
        </tr>
      </table>
    `)}

    <!-- Avance por canal -->
    ${tarjeta(`
      ${etiqueta('Avance por canal')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        <thead><tr>${th('Canal', 'left')}${th('Real')}${th('Meta')}${th('Avance')}${th('Brecha')}</tr></thead>
        <tbody>${channelRows(curMonth)}</tbody>
      </table>
      ${ritmo > 0 && faltante > 0 ? `
      <div style="font-size:13px;color:${C.text2};margin-top:14px;line-height:1.55;">
        Para llegar a la meta hay que vender <strong style="color:${C.text};">${money(dailyNeed)} por día</strong> en los
        <strong style="color:${C.text};">${diasRest} días</strong> que quedan (ritmo actual: ${money(ritmo)} por día).
        Faltan <strong style="color:${TONO.rojo.val};">${money(faltante)}</strong>.
      </div>` : ritmo > 0 && faltante === 0 ? `
      <div style="margin-top:14px;">${pill(`Objetivo de ${curMonth} alcanzado · excedente ${money(cur.real - cur.meta)}`, TONO.verde)}</div>` : ''}
    `)}

    ${achievedChannels.length > 0 ? aviso(TONO.verde,
      `${achievedChannels.map(r => r.ch).join(' y ')} ${achievedChannels.length > 1 ? 'llegaron' : 'llegó'} a su meta`,
      `${achievedChannels.map(r => `<strong>${r.ch}</strong> va en ${r.pct.toFixed(0)}% de su meta, con ${money(r.real - r.meta)} de excedente.`).join(' ')}
      ${topNeedChannels.length > 0 ? `<br>Ese excedente (${money(totalSurplus)}) podría reforzar las campañas de ${topNeedChannels.map(n => `<strong>${n.ch}</strong> (brecha ${money(n.meta - n.real)})`).join(' y ')}.` : ''}`) : ''}

    ${laggingChannels.length > 0 ? aviso(TONO.ambar,
      `Brecha a mitad de mes · día ${diasVentas} de ${curMonthDays}`,
      `Estos canales van por debajo del 80% del ritmo esperado:
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;font-size:13px;">
        ${laggingChannels.map(r => `<tr>
          <td style="padding:4px 0;font-weight:600;color:${C.text};">${r.ch}</td>
          <td style="padding:4px 8px;text-align:right;color:${C.text2};white-space:nowrap;">real ${money(r.real)}</td>
          <td style="padding:4px 8px;text-align:right;color:${C.muted};white-space:nowrap;">esperado ${money(r.expectedReal)}</td>
          <td style="padding:4px 0;text-align:right;font-weight:700;color:${TONO.rojo.val};white-space:nowrap;">${money(Math.abs(r.lag))}</td>
        </tr>`).join('')}
      </table>
      Para cerrar ${money(brechaTotal)} en ${diasRest} días hacen falta ${money(brechaTotal / Math.max(diasRest, 1))} por día adicionales en estos canales.`) : ''}

    ${closedMonths.length > 0 ? tarjeta(`
      ${etiqueta('Meses anteriores')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        <thead><tr>${th('Mes', 'left')}${th('Real')}${th('Meta')}${th('Avance')}${th('', 'right')}</tr></thead>
        <tbody>
        ${closedMonths.map(({ m, real, meta, pct: p }) => {
          const td = `padding:10px 12px;border-bottom:1px solid ${C.border};font-size:13px;color:${C.text};`;
          return `<tr>
            <td style="${td}font-weight:600;">${m}</td>
            <td style="${td}text-align:right;white-space:nowrap;">${money(real)}</td>
            <td style="${td}text-align:right;white-space:nowrap;color:${C.muted};">${money(meta)}</td>
            <td style="${td}text-align:right;font-weight:700;color:${tonoDe(p).val};">${p.toFixed(1)}%</td>
            <td style="${td}text-align:right;">${pillAvance(p)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    `) : ''}

    <!-- Botón y pie -->
    <tr><td align="center" style="padding:22px 0 8px;">
      <a href="${config.url_dashboard}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Ver el tablero de ${MARCA}</a>
    </td></tr>
    <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.muted};font-family:${FONT};">
      ${config.workspace} · alerta automática (${weekKey}): los lunes a las 6:00 p. m. y cada vez que se actualizan las ventas.<br>
      Metas por canal del archivo de objetivos de Drive; ventas del histórico de ${MARCA}.
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;

if (PREVIEW) {
  fs.writeFileSync(PREVIEW, htmlEmail, 'utf8');
  console.log(`\n🖼  Vista previa escrita en ${PREVIEW} (sin envío).\n`);
  process.exit(0);
}

// Asunto: el nivel del total del mes manda; los canales que ya llegaron a su meta o van atrasados
// se nombran después (un canal en meta no significa que el mes lo esté).
const subjectDetalle = achievedChannels.length > 0
  ? ` · ${achievedChannels.map(r => r.ch).join(' y ')} en meta`
  : laggingChannels.length > 0
    ? ' · brecha a mitad de mes'
    : '';

const subject = `${NIVEL_LABEL[NIVEL]} · ${curMonth} ${limaYear} · ${proyPct.toFixed(0)}% proyectado${subjectDetalle} · Lima Retail`;

// ── Destinatarios ─────────────────────────────────────────────
// Los de la ruedita del tablero; si el Web App no está conectado, no responde o nunca se guardó una
// lista, los de alertas-config.json. Una lista guardada vacía significa que no se envía.
async function destinatarios() {
  const url = process.env.RB_ALERTAS_URL;
  const token = process.env.RB_ALERTAS_TOKEN;
  const porDefecto = { lista: config.destinatarios || [], fuente: 'data/alertas-config.json' };
  if (!url || !token) return porDefecto;
  try {
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (!Array.isArray(body.destinatarios)) return { ...porDefecto, fuente: 'data/alertas-config.json (el tablero todavía no guardó una lista)' };
    return { lista: body.destinatarios, fuente: 'configuración del tablero' };
  } catch (err) {
    console.warn(`::warning::No se pudo leer la lista del tablero (${err.message}); se usa data/alertas-config.json`);
    return porDefecto;
  }
}

// ── Registrar envío ──────────────────────────────────────────
function registrarEnvio() {
  if (MOTIVO !== 'ventas') enviosData.enviados[weekKey] = new Date().toISOString();
  enviosData.ultimaHuella = huellaVentas;
  enviosData.ultimoEnvio = { fecha: new Date().toISOString(), motivo: MOTIVO };
  fs.writeFileSync(enviosPath, JSON.stringify(enviosData, null, 2) + '\n', 'utf8');
  console.log(`📝 Registrado en alertas-envios.json: ${MOTIVO === 'ventas' ? 'ventas actualizadas' : weekKey}\n`);
}

// ── Envío por el correo del hosting (SMTP) ────────────────────
// El remitente es la misma cuenta que se autentica: los hostings rechazan un "From" de otra cuenta.
async function enviarSmtp(toList) {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = /@/.test(process.env.SMTP_USER) ? process.env.SMTP_USER : config.from_email;
  const info = await transporter.sendMail({
    from: `${config.from_name} <${from}>`,
    to: toList,
    subject,
    html: htmlEmail,
  });
  return info.messageId || '(sin id)';
}

(async () => {
  const { lista, fuente } = await destinatarios();
  const para = lista.map(d => (d.nombre ? `${d.nombre} <${d.email}>` : d.email)).join(', ');

  // ── Dry-run ───────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n─────────────────────────────────────────');
    console.log('[DRY-RUN] Email que se enviaría:');
    console.log('  Asunto :', subject);
    console.log('  Para   :', para || '(nadie)', `· ${fuente}`);
    console.log('  Tamaño :', Math.round(htmlEmail.length / 1024), 'KB');
    console.log('[DRY-RUN] Sin envíos reales. FIN.\n');
    return;
  }

  if (!lista.length) {
    console.log(`\n⏭  La lista de destinatarios está vacía (${fuente}): no se envía.\n`);
    return;
  }

  const toList = lista.map(d => d.email);
  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].every(name => process.env[name]);
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!smtp && !RESEND_KEY) {
    console.error('\n❌ Falta la configuración de envío: SMTP_HOST, SMTP_USER y SMTP_PASS (correo del hosting) o RESEND_API_KEY.');
    console.error('   Exportá las variables o usá --dry-run para simular.\n');
    process.exit(1);
  }

  console.log(`\n📧 Enviando a: ${para} (${fuente})`);
  console.log(`   Asunto: ${subject}`);

  if (smtp) {
    const id = await enviarSmtp(toList);
    console.log(`\n✅ Email enviado por el correo del hosting (${process.env.SMTP_HOST}). ID: ${id}`);
    registrarEnvio();
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from    : `${config.from_name} <${config.from_email}>`,
      to      : toList,
      subject,
      html    : htmlEmail,
    }),
  });

  const body = await res.json().catch(() => res.text());

  if (!res.ok) {
    console.error(`\n❌ Error Resend ${res.status}:`, JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`\n✅ Email enviado. Resend ID: ${body.id || '(desconocido)'}`);
  registrarEnvio();
})().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
