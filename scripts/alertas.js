#!/usr/bin/env node
/* ============================================================
   scripts/alertas.js — Alerta semanal de objetivos de venta.

   Lee:
     data/ventas-2026.json     → ventas reales acumuladas por canal
     data/objetivos-2026.json  → metas por mes / canal
     data/alertas-config.json  → destinatarios y config de envío

   Envía email HTML via Resend API.
   Registra el envío en data/alertas-envios.json (idempotencia).

   Uso:
     node scripts/alertas.js             # envío real
     node scripts/alertas.js --dry-run   # simula sin enviar
     node scripts/alertas.js --force     # ignora idempotencia (reenvía)

   Variables de entorno requeridas (envío real):
     RESEND_API_KEY   → API key de Resend
   Variables opcionales:
     DRY_RUN=true     → equivale a --dry-run (para GitHub Actions)
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const FORCE   = process.argv.includes('--force');

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

const MONTHS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];
const MONTH_DAYS = {
  Enero:31,Febrero:28,Marzo:31,Abril:30,Mayo:31,Junio:30,
  Julio:31,Agosto:31,Septiembre:30,Octubre:31,Noviembre:30,Diciembre:31,
};
const CHANNELS = ['Tienda','Web','WhatsApp','Showroom','Instagram','Facebook'];

const CANAL_ICONS = {
  Tienda:'🏪', Web:'🌐', WhatsApp:'💬', Showroom:'🛍️', Instagram:'📸', Facebook:'📘',
};

// ── Cargar archivos ──────────────────────────────────────────
const salesData  = readJson(path.join(ROOT, 'data/ventas-2026.json'));
const objData    = readJson(path.join(ROOT, 'data/objetivos-2026.json'));
const config     = readJson(path.join(ROOT, 'data/alertas-config.json'));
const enviosPath = path.join(ROOT, 'data/alertas-envios.json');
const enviosData = readJson(enviosPath);

// ── Fecha Lima ───────────────────────────────────────────────
const lima        = limaDate();
const weekKey     = isoWeek(lima);
const monthIdx    = lima.getUTCMonth();        // 0 = Enero
const dayOfMonth  = lima.getUTCDate();
const limaYear    = lima.getUTCFullYear();
const curMonth    = MONTHS[monthIdx];
const curMonthDays = MONTH_DAYS[curMonth];

// Fecha legible en español (Lima)
const fechaLabel = lima.toLocaleDateString('es-PE', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
});

console.log(`\n▶ Alerta semanal ${weekKey}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
console.log(`  Fecha Lima : ${fechaLabel}`);
console.log(`  Mes actual : ${curMonth} ${limaYear} · día ${dayOfMonth} de ${curMonthDays}`);

// ── Idempotencia ─────────────────────────────────────────────
if (!FORCE && !DRY_RUN && enviosData.enviados[weekKey]) {
  console.log(`\n⏭  Semana ${weekKey} ya registrada (${enviosData.enviados[weekKey]}).`);
  console.log('   Usa --force para reenviar.\n');
  process.exit(0);
}

// ── Cálculo de métricas ──────────────────────────────────────
const d2026   = salesData.d2026  || {};
const targets = objData.targets  || {};

function calcMonth(m) {
  const data = d2026[m]   || {};
  const tgt  = targets[m] || {};
  const real = CHANNELS.reduce((s, ch) => s + (data[ch] || 0), 0);
  const meta = CHANNELS.reduce((s, ch) => s + (tgt[ch]  || 0), 0);
  const byChannel = CHANNELS
    .filter(ch => (tgt[ch] || 0) > 0)   // omitir canales sin objetivo
    .map(ch => ({
      ch,
      real : data[ch] || 0,
      meta : tgt[ch]  || 0,
      pct  : pctOf(data[ch] || 0, tgt[ch] || 0),
    }));
  return { real, meta, byChannel };
}

// Mes en curso
const cur       = calcMonth(curMonth);
const ritmo     = dayOfMonth > 0 && cur.real > 0 ? cur.real / dayOfMonth : 0;
const proyeccion = ritmo > 0 ? ritmo * curMonthDays : 0;
const proyPct    = pctOf(proyeccion, cur.meta);
const diaPct     = Math.round(dayOfMonth / curMonthDays * 100);
const faltante   = Math.max(0, cur.meta - cur.real);
const diasRest   = Math.max(0, curMonthDays - dayOfMonth);
const dailyNeed  = diasRest > 0 && faltante > 0 ? faltante / diasRest : 0;

// Nivel de alerta
const NIVEL = proyPct >= 90 ? 'verde' : proyPct >= 70 ? 'ambar' : 'rojo';
const NIVEL_LABEL  = { verde:'✅ En track', ambar:'⚠️ Atención', rojo:'🚨 Riesgo' };
const NIVEL_COLOR  = { verde:'#16a34a', ambar:'#d97706', rojo:'#dc2626' };
const NIVEL_BG     = { verde:'#f0fdf4', ambar:'#fffbeb', rojo:'#fef2f2' };
const NIVEL_BORDER = { verde:'#bbf7d0', ambar:'#fde68a', rojo:'#fecaca' };

// Meses anteriores cerrados (hasta 3)
const closedMonths = [];
for (let i = monthIdx - 1; i >= 0 && closedMonths.length < 3; i--) {
  const m = MONTHS[i];
  const { real, meta } = calcMonth(m);
  if (real > 0 || meta > 0) {
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
const pastMidMonth = dayOfMonth >= Math.floor(curMonthDays / 2);
const laggingChannels = pastMidMonth
  ? cur.byChannel.filter(r => {
      const expectedReal = r.meta * dayOfMonth / curMonthDays;
      return r.pct < 100 && r.real < expectedReal * 0.80;
    }).map(r => ({
      ...r,
      expectedReal: r.meta * dayOfMonth / curMonthDays,
      lag: r.real - (r.meta * dayOfMonth / curMonthDays),
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
  console.log(`     ${r.ch.padEnd(12)} real: S/. ${fmt(r.real).padStart(8)}  /  meta: S/. ${fmt(r.meta).padStart(8)}  →  ${r.pct.toFixed(1)}%`);
});
if (achievedChannels.length > 0) {
  console.log(`\n🎯 Objetivo alcanzado: ${achievedChannels.map(r => r.ch).join(', ')}  |  Excedente: S/. ${fmt(totalSurplus)}`);
}
if (laggingChannels.length > 0) {
  console.log(`\n⚠️  Brecha a mitad de mes (día ${dayOfMonth}/${curMonthDays}):`);
  laggingChannels.forEach(r => {
    console.log(`     ${r.ch.padEnd(12)} lag: S/. ${fmt(Math.abs(r.lag))}`);
  });
}

// ── Helpers HTML ─────────────────────────────────────────────
function pill(p) {
  const [bg, color, label] =
    p >= 100 ? ['#f0fdf4','#16a34a','✓ alcanzado'] :
    p >= 90  ? ['#f0fdf4','#16a34a','▲ casi']       :
    p >= 70  ? ['#fffbeb','#d97706','⚠ atención']   :
               ['#fef2f2','#dc2626','▼ brecha'];
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">${label}</span>`;
}

function channelRows(m) {
  return calcMonth(m).byChannel.map(r => {
    const barW  = Math.min(r.pct, 100).toFixed(0);
    const color = r.pct >= 90 ? '#16a34a' : r.pct >= 70 ? '#d97706' : '#dc2626';
    const gap   = r.real - r.meta;
    return `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#374151;">${CANAL_ICONS[r.ch] || ''} ${r.ch}</td>
        <td style="padding:8px 12px;text-align:right;font-size:13px;color:#374151;">S/. ${fmt(r.real)}</td>
        <td style="padding:8px 12px;text-align:right;font-size:12px;color:#9ca3af;">/ S/. ${fmt(r.meta)}</td>
        <td style="padding:8px 12px;text-align:right;">
          <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
            <div style="width:56px;height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
              <div style="width:${barW}%;height:100%;background:${color};border-radius:3px;"></div>
            </div>
            <span style="font-size:12px;font-weight:700;color:${color};min-width:32px;text-align:right;">${r.pct.toFixed(0)}%</span>
          </div>
        </td>
        <td style="padding:8px 12px;text-align:right;font-size:12px;color:${gap >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">
          ${gap >= 0 ? '+' : ''}S/. ${fmt(gap)}
        </td>
      </tr>`;
  }).join('');
}

// ── Template HTML del email ───────────────────────────────────
const htmlEmail = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

    <!-- ═══ HEADER ════ -->
    <tr><td style="background:#b91c1c;border-radius:12px 12px 0 0;padding:24px 32px;">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;line-height:1;">Lima Retail</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;font-weight:500;">Alerta semanal de ventas · ${weekKey}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px;text-transform:capitalize;">${fechaLabel}</div>
    </td></tr>

    <!-- ═══ ALERTA BANNER ════ -->
    <tr><td style="background:${NIVEL_BG[NIVEL]};border:1px solid ${NIVEL_BORDER[NIVEL]};border-top:none;padding:18px 32px;">
      <div style="font-size:16px;font-weight:700;color:${NIVEL_COLOR[NIVEL]};margin-bottom:6px;">${NIVEL_LABEL[NIVEL]} · ${curMonth} ${limaYear}</div>
      <div style="font-size:13px;color:#374151;line-height:1.5;">
        Proyección al cierre:
        <strong style="color:${NIVEL_COLOR[NIVEL]};font-size:15px;">S/. ${fmt(proyeccion)}</strong>
        <span style="color:#9ca3af;margin:0 6px;">·</span>
        <strong style="color:${NIVEL_COLOR[NIVEL]};">${proyPct.toFixed(1)}%</strong> del objetivo mensual
        ${proyPct < 90 ? `<br><span style="font-size:12px;color:#6b7280;">Con el ritmo actual de <strong>S/. ${fmt(ritmo)}/día</strong> se estima un cierre de S/. ${fmt(proyeccion)}, S/. ${fmt(Math.abs(cur.meta - proyeccion))} ${proyeccion < cur.meta ? 'por debajo' : 'por encima'} de la meta.</span>` : ''}
      </div>
    </td></tr>

    <!-- ═══ MES EN CURSO ════ -->
    <tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;padding:24px 32px;">

      <!-- título de sección -->
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:18px;">
        ${curMonth} ${limaYear} &nbsp;·&nbsp; Día ${dayOfMonth} de ${curMonthDays} &nbsp;(${diaPct}% del mes)
      </div>

      <!-- KPIs 3 columnas -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
        <tr>
          <td style="text-align:center;padding:14px 10px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Real acumulado</div>
            <div style="font-size:24px;font-weight:800;color:#111827;margin-top:6px;letter-spacing:-0.02em;">S/. ${fmt(cur.real)}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${diaPct}% del mes</div>
          </td>
          <td width="10"></td>
          <td style="text-align:center;padding:14px 10px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Proyección cierre</div>
            <div style="font-size:24px;font-weight:800;color:${NIVEL_COLOR[NIVEL]};margin-top:6px;letter-spacing:-0.02em;">S/. ${fmt(proyeccion)}</div>
            <div style="font-size:11px;color:${NIVEL_COLOR[NIVEL]};margin-top:2px;">${proyPct.toFixed(1)}% del objetivo</div>
          </td>
          <td width="10"></td>
          <td style="text-align:center;padding:14px 10px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Objetivo mensual</div>
            <div style="font-size:24px;font-weight:800;color:#374151;margin-top:6px;letter-spacing:-0.02em;">S/. ${fmt(cur.meta)}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${curMonth} ${limaYear}</div>
          </td>
        </tr>
      </table>

      <!-- Tabla por canal -->
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">Avance por canal</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Canal</th>
            <th style="padding:9px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Real MTD</th>
            <th style="padding:9px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Objetivo</th>
            <th style="padding:9px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Avance</th>
            <th style="padding:9px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Brecha</th>
          </tr>
        </thead>
        <tbody>
          ${channelRows(curMonth)}
        </tbody>
      </table>

      ${ritmo > 0 && faltante > 0 ? `
      <!-- Nota de ritmo -->
      <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:13px;color:#374151;border:1px solid #e5e7eb;">
        📈 Ritmo actual: <strong>S/. ${fmt(ritmo)}/día</strong> &nbsp;·&nbsp;
        Para alcanzar la meta necesitás vender <strong>S/. ${fmt(dailyNeed)}/día</strong>
        durante los próximos <strong>${diasRest} días</strong>.
        Faltante total: <strong style="color:#dc2626;">S/. ${fmt(faltante)}</strong>.
      </div>` : ritmo > 0 && faltante === 0 ? `
      <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:13px;color:#16a34a;border:1px solid #bbf7d0;font-weight:600;">
        🎉 ¡Objetivo de ${curMonth} alcanzado! Excedente: S/. ${fmt(cur.real - cur.meta)}.
      </div>` : ''}

    </td></tr>

    ${closedMonths.length > 0 ? `
    <!-- ═══ MESES CERRADOS ════ -->
    <tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;padding:16px 32px 20px;">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Meses anteriores</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${closedMonths.map(({ m, real, meta, pct: p }) => {
          const color = p >= 90 ? '#16a34a' : p >= 70 ? '#d97706' : '#dc2626';
          const gap   = real - meta;
          return `
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;font-size:13px;color:#374151;font-weight:600;width:120px;">${m}</td>
            <td style="padding:10px 0;text-align:right;font-size:13px;color:#374151;">S/. ${fmt(real)}</td>
            <td style="padding:10px 0;text-align:right;font-size:12px;color:#9ca3af;">/ S/. ${fmt(meta)}</td>
            <td style="padding:10px 12px;text-align:right;font-size:14px;font-weight:700;color:${color};">${p.toFixed(1)}%</td>
            <td style="padding:10px 0;text-align:right;font-size:12px;font-weight:600;color:${color};">${gap >= 0 ? '+' : ''}S/. ${fmt(gap)}</td>
            <td style="padding:10px 0 10px 12px;">${pill(p)}</td>
          </tr>`;
        }).join('')}
      </table>
    </td></tr>` : ''}

    ${achievedChannels.length > 0 ? `
    <!-- ═══ OBJETIVO CUMPLIDO ════ -->
    <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-top:none;padding:20px 32px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:20px;flex-shrink:0;">🎯</span>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#16a34a;margin-bottom:6px;">
            Objetivo alcanzado · ${achievedChannels.map(r => r.ch).join(', ')}
          </div>
          <div style="font-size:12px;color:#374151;margin-bottom:10px;">
            ${achievedChannels.map(r =>
              `<strong>${r.ch}</strong> llegó al ${r.pct.toFixed(0)}% con un excedente de <strong>S/. ${fmt(r.real - r.meta)}</strong>`
            ).join(' · ')}
          </div>
          ${topNeedChannels.length > 0 ? `
          <div style="background:rgba(255,255,255,0.7);border-radius:8px;padding:10px 14px;border:1px solid #bbf7d0;font-size:12px;color:#374151;">
            💡 <strong>Sugerencia:</strong> El excedente de <strong>S/. ${fmt(totalSurplus)}</strong> podría
            redistribuirse a
            ${topNeedChannels.map(n =>
              `<strong>${n.ch}</strong> (brecha S/. ${fmt(n.meta - n.real)})`
            ).join(' y ')}
            para reforzar sus campañas de marketing.
          </div>` : ''}
        </div>
      </div>
    </td></tr>` : ''}

    ${laggingChannels.length > 0 ? `
    <!-- ═══ ALERTA BRECHA MID-MONTH ════ -->
    <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-top:none;padding:20px 32px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:20px;flex-shrink:0;">⚠️</span>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#d97706;margin-bottom:4px;">
            Alerta de brecha · día ${dayOfMonth} de ${curMonthDays}
          </div>
          <div style="font-size:12px;color:#92400e;margin-bottom:10px;">
            Los siguientes canales están por debajo del 80% del ritmo esperado a mitad de mes:
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;">
            ${laggingChannels.map(r => `
            <tr>
              <td style="padding:5px 0;color:#374151;font-weight:600;">${CANAL_ICONS[r.ch] || ''} ${r.ch}</td>
              <td style="padding:5px 8px;text-align:right;color:#374151;">real S/. ${fmt(r.real)}</td>
              <td style="padding:5px 8px;text-align:right;color:#9ca3af;">esperado S/. ${fmt(r.expectedReal)}</td>
              <td style="padding:5px 0;text-align:right;color:#dc2626;font-weight:700;">brecha S/. ${fmt(Math.abs(r.lag))}</td>
            </tr>`).join('')}
          </table>
          <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:10px 14px;margin-top:10px;border:1px solid #fde68a;font-size:12px;color:#374151;">
            💡 Quedan <strong>${curMonthDays - dayOfMonth} días</strong>.
            Para cerrar la brecha de
            <strong>S/. ${fmt(laggingChannels.reduce((s, r) => s + (r.meta - r.real), 0))}</strong>
            se necesita un promedio de
            <strong>S/. ${fmt(laggingChannels.reduce((s, r) => s + (r.meta - r.real), 0) / Math.max(curMonthDays - dayOfMonth, 1))}/día adicional</strong>
            en estos canales.
          </div>
        </div>
      </div>
    </td></tr>` : ''}

    <!-- ═══ CTA ════ -->
    <tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;padding:16px 32px 28px;text-align:center;">
      <a href="${config.url_dashboard}"
         style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;
                padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
                letter-spacing:-0.01em;">
        Ver dashboard completo →
      </a>
    </td></tr>

    <!-- ═══ FOOTER ════ -->
    <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
      <div style="font-size:11px;color:#9ca3af;line-height:1.6;">
        ${config.workspace} &nbsp;·&nbsp; Alerta automática semanal (${weekKey})<br>
        Ajustar objetivos: <a href="${config.url_dashboard}" style="color:#b91c1c;text-decoration:none;">${config.url_dashboard}</a>
      </div>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;

// Asunto — añade prefijos especiales si hay alertas destacadas
const subjectPrefix = achievedChannels.length > 0
  ? `🎯 Objetivo alcanzado ·`
  : laggingChannels.length > 0
    ? `⚠️ Brecha a mitad de mes ·`
    : NIVEL_LABEL[NIVEL].split(' ')[0];

const subject = `${subjectPrefix} ${curMonth} ${limaYear} · ${proyPct.toFixed(0)}% proyectado · Lima Retail`;

// ── Dry-run ───────────────────────────────────────────────────
if (DRY_RUN) {
  console.log('\n─────────────────────────────────────────');
  console.log('[DRY-RUN] Email que se enviaría:');
  console.log('  Asunto :', subject);
  console.log('  Para   :', config.destinatarios.map(d => `${d.nombre} <${d.email}>`).join(', '));
  console.log('  Tamaño :', Math.round(htmlEmail.length / 1024), 'KB');
  console.log('[DRY-RUN] Sin envíos reales. FIN.\n');
  process.exit(0);
}

// ── Envío via Resend ──────────────────────────────────────────
(async () => {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.error('\n❌ Falta RESEND_API_KEY en el entorno.');
    console.error('   Exportá la variable o usá --dry-run para simular.\n');
    process.exit(1);
  }

  const toList = config.destinatarios.map(d => d.email);
  console.log(`\n📧 Enviando a: ${config.destinatarios.map(d => `${d.nombre} <${d.email}>`).join(', ')}`);
  console.log(`   Asunto: ${subject}`);

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

  // ── Registrar envío ──────────────────────────────────────────
  enviosData.enviados[weekKey] = new Date().toISOString();
  fs.writeFileSync(enviosPath, JSON.stringify(enviosData, null, 2) + '\n', 'utf8');
  console.log(`📝 Registrado en alertas-envios.json: ${weekKey}\n`);
})().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
