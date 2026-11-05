#!/usr/bin/env node
'use strict';
/**
 * Vigila que la inversión publicitaria siga llegando al tablero.
 *
 * El 4/11/2026 los cron del hosting no se ejecutaron ni una vez: Nexus no capturó nada, no publicó
 * a Drive, y el tablero se quedó con la captura del 3/11 a las 18:00 sin que nadie se enterara
 * hasta el día siguiente. El sync de GitHub corrió en verde las cuatro veces, porque hizo bien su
 * trabajo: copió el dato que había. Nadie miraba la antigüedad de ese dato.
 *
 * Esto lo mira. Corre después de cada sincronización y revisa dos cosas en data/ads-2026.json:
 *
 *   1. Captura atrasada: Nexus publica a las 06, 13 y 18 de Lima. Si la captura más nueva es
 *      anterior a la última hora que ya tocó (con media hora de margen), algo se rompió entre el
 *      hosting y Drive.
 *   2. Mes en curso detenido: la cobertura del mes más nuevo no llega ni a ayer. Esto caza el caso
 *      en que Nexus sí publica, pero publica un mes que ya no avanza.
 *
 * Si hay hallazgo manda un correo al equipo —nunca a los destinatarios del cliente— y sale con
 * código 1. Ese rojo es toda la memoria que hace falta: antes de escribir, mira cómo terminó la
 * corrida anterior de este mismo workflow y, si ya estaba en rojo, no repite el correo. Así una
 * caída de tres días avisa una vez y no doce. Cuando el dato vuelve, avisa que se recuperó.
 * El repositorio es público: por eso la memoria va en el historial de corridas y no en un issue.
 *
 * Uso:
 *   node scripts/check-nexus.js              envía de verdad (necesita GITHUB_TOKEN y SMTP/Resend)
 *   node scripts/check-nexus.js --dry-run    solo imprime el diagnóstico
 */

const fs = require('fs');
const path = require('path');
const { CONFIG, destinatariosTecnicos, enviar } = require('./lib/correo.js');

const RAIZ = path.join(__dirname, '..');
const ADS = path.join(RAIZ, 'data', 'ads-2026.json');
const WORKFLOW = 'alerta-datos.yml';

// Las tres franjas en que Nexus captura y publica (hora de Lima).
const HORAS_NEXUS = [6, 13, 18];
// Margen antes de dar por perdida una franja: la captura y la subida a Drive tardan un minuto,
// pero el sync de GitHub puede leer la hoja hasta media hora después.
const MARGEN_MIN = 30;

// Lima es UTC-5 todo el año, sin horario de verano.
const LIMA = -5 * 3600000;
const partesLima = ms => {
  const d = new Date(ms + LIMA);
  return { a: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const desdeLima = (a, m, d, h) => Date.UTC(a, m, d, h) - LIMA;
const fechaLima = ms => new Date(ms + LIMA).toISOString().slice(0, 10);
const horaLima = ms => new Date(ms + LIMA).toISOString().slice(0, 16).replace('T', ' ');
const horas = ms => ms / 3600000;

/** La última franja de Nexus que ya debería haber publicado, con su margen. */
function ultimaFranjaDebida(ahora) {
  const limite = ahora - MARGEN_MIN * 60000;
  const p = partesLima(limite);
  let debida = null;
  for (const dia of [-1, 0]) {
    for (const h of HORAS_NEXUS) {
      const t = desdeLima(p.a, p.m, p.d + dia, h);
      if (t <= limite) debida = t;
    }
  }
  return debida;
}

function leerAds() {
  if (!fs.existsSync(ADS)) throw new Error('No existe data/ads-2026.json.');
  const j = JSON.parse(fs.readFileSync(ADS, 'utf8'));
  if (!Array.isArray(j.months) || !j.months.length) throw new Error('data/ads-2026.json no trae meses.');
  return j;
}

function revisar(ahora) {
  const j = leerAds();
  const hallazgos = [];

  // ── 1. ¿Cuándo fue la captura más nueva? ────────────────────────────────────
  const capturas = j.months
    .map(m => Date.parse(m.meta?.capturedAt || ''))
    .filter(ms => Number.isFinite(ms));
  const ultima = capturas.length ? Math.max(...capturas) : null;
  const debida = ultimaFranjaDebida(ahora);

  if (ultima === null) {
    hallazgos.push({
      titulo: 'Sin fecha de captura',
      detalle: 'Ningún mes de data/ads-2026.json trae meta.capturedAt. El dato no viene de Nexus.',
    });
  } else if (debida !== null && ultima < debida) {
    hallazgos.push({
      titulo: 'Nexus no publicó en su última franja',
      detalle:
        `La captura más nueva es del ${horaLima(ultima)} de Lima, hace ${horas(ahora - ultima).toFixed(1)} h. ` +
        `La franja de las ${new Date(debida + LIMA).getUTCHours()}:00 del ${fechaLima(debida)} ya tendría que haber publicado. ` +
        'Suele ser el cron del hosting, la autorización de Drive o el token de Meta.',
    });
  }

  // ── 2. ¿El mes en curso sigue avanzando? ────────────────────────────────────
  const mes = [...j.months].sort((a, b) => String(a.id).localeCompare(String(b.id))).pop();
  const hasta = mes?.meta?.coverage?.end;
  const ayer = fechaLima(ahora - 24 * 3600000);
  if (hasta && hasta < ayer) {
    hallazgos.push({
      titulo: 'El mes en curso no avanza',
      detalle:
        `${mes.label || mes.id} llega hasta el ${hasta} y ayer fue el ${ayer}. ` +
        'Nexus está publicando, pero con un mes que se quedó quieto.',
    });
  }

  const resumen = [
    `Última captura : ${ultima !== null ? `${horaLima(ultima)} de Lima (hace ${horas(ahora - ultima).toFixed(1)} h)` : '—'}`,
    `Franja debida  : ${debida !== null ? `${horaLima(debida)} de Lima` : '—'}`,
    `Mes más nuevo  : ${mes ? `${mes.label || mes.id} hasta el ${hasta || '—'}` : '—'}`,
  ].join('\n');

  return { ok: hallazgos.length === 0, hallazgos, resumen };
}

// ── Cómo terminó la corrida anterior: eso es la memoria ───────────────────────
async function github(ruta) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const res = await fetch(`https://api.github.com/repos/${repo}${ruta}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} en ${ruta}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** true si la corrida anterior ya terminó en rojo, o sea que el correo ya salió. */
async function yaAvisado() {
  const datos = await github(`/actions/workflows/${WORKFLOW}/runs?status=completed&per_page=10`);
  if (!datos) return false;
  const propio = String(process.env.GITHUB_RUN_ID || '');
  const anterior = (datos.workflow_runs || []).find(r => String(r.id) !== propio);
  return anterior ? anterior.conclusion === 'failure' : false;
}

// ── Correo ────────────────────────────────────────────────────────────────────
const AZUL = '#2563eb';
const envoltura = (titulo, color, cuerpo) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:${color};color:#fff;padding:16px 20px;font-size:16px;font-weight:600">${titulo}</div>
    <div style="padding:20px;color:#0f172a;font-size:14px;line-height:1.6">${cuerpo}</div>
    <div style="padding:14px 20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
      ${CONFIG.workspace} · <a href="${CONFIG.url_dashboard}" style="color:${AZUL}">abrir el tablero</a>
    </div>
  </div>
</div>`;

const correoFalla = informe =>
  envoltura(
    'La inversión publicitaria dejó de actualizarse',
    '#b91c1c',
    `<p>El tablero de Royal Baby sigue mostrando cifras, pero son las de la última captura buena. Las de hoy no llegaron.</p>
     ${informe.hallazgos.map(h => `<p><strong>${h.titulo}.</strong> ${h.detalle}</p>`).join('')}
     <p style="margin-top:18px;padding:12px;background:#f8fafc;border-left:3px solid ${AZUL};color:#334155">
       Para revisarlo, en la Terminal de cPanel:<br>
       <code style="font-size:12px">tail -n 20 ~/apps/nexus/storage/meta-sync.log</code>
     </p>
     <p style="color:#64748b;font-size:13px">No se repite este correo mientras el problema siga abierto. Cuando el dato vuelva, te aviso.</p>`,
  );

const correoVuelta = informe =>
  envoltura(
    'La inversión publicitaria volvió a actualizarse',
    '#15803d',
    `<p>Ya está entrando el dato otra vez.</p>
     <pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:12px;color:#334155">${informe.resumen}</pre>`,
  );

// ── Principal ─────────────────────────────────────────────────────────────────
async function principal() {
  const informe = revisar(Date.now());

  console.log(informe.ok ? '✅ El dato está al día\n' : '🔴 El dato está atrasado\n');
  console.log(informe.resumen + '\n');
  informe.hallazgos.forEach(h => console.log(`  · ${h.titulo}: ${h.detalle}`));

  // Sin token no se puede saber si el correo ya salió, y repetirlo cada seis horas es peor que no
  // mandarlo: fuera de GitHub Actions esto solo diagnostica.
  const simulacro = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true' || !process.env.GITHUB_TOKEN;
  if (simulacro) {
    console.log('\n[simulación] No se envía correo.');
    return;
  }

  const avisado = await yaAvisado();
  const para = destinatariosTecnicos();

  if (informe.ok) {
    if (!avisado) return;
    const detalle = await enviar({
      para,
      asunto: '✅ Royal Baby · la inversión volvió a actualizarse',
      html: correoVuelta(informe),
    });
    console.log(`\nAvisado que se recuperó, a ${para.join(', ')} por ${detalle}.`);
    return;
  }

  if (avisado) {
    console.log('\nLa corrida anterior ya quedó en rojo: el correo ya salió y no se repite.');
  } else {
    const detalle = await enviar({
      para,
      asunto: '🔴 Royal Baby · la inversión publicitaria dejó de actualizarse',
      html: correoFalla(informe),
    });
    console.log(`\nCorreo enviado a ${para.join(', ')} por ${detalle}.`);
  }

  // El rojo es lo que recuerda, en la corrida siguiente, que esto ya se avisó.
  process.exitCode = 1;
}

if (require.main === module) {
  principal().catch(err => {
    console.error('\n❌ ' + err.message);
    process.exit(1);
  });
}

module.exports = { revisar, ultimaFranjaDebida, HORAS_NEXUS, MARGEN_MIN };
