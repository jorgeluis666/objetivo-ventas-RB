#!/usr/bin/env node
/**
 * Chequeo semanal del pipeline de datos.
 *
 * Detecta:
 *   - Pipeline frío (generated > 30h, debería refrescar cada hora)
 *   - Mes en curso sin movimiento la última semana
 *   - Canales que tenían ventas la semana pasada y desaparecieron
 *   - Tabs 2025 incompletos (faltan meses)
 *
 * Imprime un Markdown que el workflow usa como body de un GitHub Issue.
 *   Exit code 0 = todo OK (no se crea issue)
 *   Exit code 1 = hay hallazgos (se crea issue con el reporte)
 */

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'data', 'ventas-2026.json');
const MONTHS_12 = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function loadJson() {
  if (!fs.existsSync(JSON_PATH)) {
    return { fatal: 'No existe data/ventas-2026.json' };
  }
  try { return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); }
  catch (e) { return { fatal: 'JSON ilegible: ' + e.message }; }
}

function fmtSoles(n) {
  return 'S/. ' + Math.round(n || 0).toLocaleString('es-PE');
}
function tot(monthObj) {
  if (!monthObj) return 0;
  return Object.values(monthObj).reduce((a, b) => a + (b || 0), 0);
}

// Encuentra el mes "actual" en 2026 según la última semana con TOTAL > 0
function lastActiveMonth2026(j) {
  for (let i = MONTHS_12.length - 1; i >= 0; i--) {
    const m = MONTHS_12[i];
    if (tot(j.d2026?.[m]) > 0) return m;
  }
  return null;
}

function checkFreshness(j, findings) {
  const gen = j.generated;
  if (!gen) {
    findings.push({ sev: 'warn', txt: 'El JSON no tiene timestamp `generated`.' });
    return;
  }
  // generated viene en hora Lima (UTC-5) sin zona — lo trato como tal
  const then = new Date(gen + '-05:00');
  const hoursAgo = (Date.now() - then.getTime()) / 3600000;
  // El sheet se actualiza los lunes; el JSON puede tener hasta ~7 días de antigüedad.
  // Alerta si supera 10 días (240 h) sin actualizar — señal de que el pipeline falló.
  if (hoursAgo > 240) {
    findings.push({
      sev: 'err',
      txt: `Pipeline frío: última actualización hace ${hoursAgo.toFixed(1)} h (debería ser < 240 h · 10 días). Revisar workflow \`update-data.yml\`.`,
    });
  }
}

function check2025Completeness(j, findings) {
  if (!j.weekly2025) return;
  const empty = MONTHS_12.filter(m => !(j.weekly2025[m]?.length > 0));
  if (empty.length > 0 && empty.length < 12) {
    findings.push({
      sev: 'warn',
      txt: `Faltan meses 2025 en el JSON: ${empty.join(', ')}.`,
    });
  }
}

function checkAnyActivity(j, findings) {
  const m = lastActiveMonth2026(j);
  if (!m) {
    findings.push({ sev: 'err', txt: 'Ningún mes 2026 tiene ventas registradas.' });
  }
}

// Compara los dos últimos meses CERRADOS — si un canal pasó de tener
// ventas significativas a cero, es señal de que algo se rompió.
function checkChannelDropoff(j, findings) {
  const today = new Date();
  const currentMonthIdx = today.getFullYear() === 2026 ? today.getMonth() : 12;
  // Mes cerrado más reciente y el anterior
  if (currentMonthIdx < 2) return; // necesitamos al menos 2 meses cerrados
  const last = MONTHS_12[currentMonthIdx - 1];
  const prev = MONTHS_12[currentMonthIdx - 2];
  const d2026 = j.d2026 || {};
  if (!d2026[last] || !d2026[prev]) return;
  const channels = ['Tienda', 'Web', 'WhatsApp', 'Showroom', 'Instagram'];
  const dropped = channels.filter(ch => (d2026[prev][ch] || 0) > 1000 && (d2026[last][ch] || 0) === 0);
  if (dropped.length) {
    findings.push({
      sev: 'warn',
      txt: `Canales que tenían ventas en ${prev} pero cayeron a 0 en ${last} (mes cerrado): ${dropped.join(', ')}.`,
    });
  }
}

function buildSummary(j) {
  const m = lastActiveMonth2026(j);
  const mTotal = m ? tot(j.d2026[m]) : 0;
  const ref25 = m && j.d2025_live?.[m] ? tot(j.d2025_live[m]) : (m && j.weekly2025?.[m] ? j.weekly2025[m].reduce((s,w)=>s+(w.TOTAL||0),0) : 0);
  const delta = ref25 > 0 ? ((mTotal - ref25) / ref25 * 100).toFixed(1) : null;
  return [
    `**Generado:** ${j.generated || '—'}`,
    `**Mes 2026 activo:** ${m || '—'} → ${fmtSoles(mTotal)}` +
      (delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta}% vs ${m} 2025 ${fmtSoles(ref25)})` : ''),
  ].join('\n');
}

function main() {
  const j = loadJson();
  if (j.fatal) {
    console.log('## ❌ Error fatal\n\n' + j.fatal);
    process.exit(1);
  }

  const findings = [];
  checkFreshness(j, findings);
  check2025Completeness(j, findings);
  checkAnyActivity(j, findings);
  checkChannelDropoff(j, findings);

  const summary = buildSummary(j);

  if (findings.length === 0) {
    console.log('## ✅ Sin hallazgos\n\n' + summary);
    process.exit(0);
  }

  const lines = [
    '## 🔍 Revisión semanal del pipeline',
    '',
    summary,
    '',
    '### Hallazgos',
    '',
  ];
  findings.forEach(f => {
    const icon = f.sev === 'err' ? '🔴' : f.sev === 'warn' ? '🟡' : 'ℹ️';
    lines.push(`- ${icon} ${f.txt}`);
  });
  lines.push('');
  lines.push('---');
  lines.push('_Generado automáticamente por `weekly-check.yml`. Cerrá este issue cuando lo resuelvas._');

  console.log(lines.join('\n'));
  process.exit(findings.some(f => f.sev === 'err') ? 2 : 1);
}

main();
