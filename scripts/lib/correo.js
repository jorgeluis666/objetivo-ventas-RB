'use strict';
/**
 * Envío de correo, compartido por los avisos del tablero.
 *
 * Primero el correo del hosting (SMTP_HOST / SMTP_USER / SMTP_PASS); si no están, Resend
 * (RESEND_API_KEY). Es el mismo orden que usa scripts/alertas.js, que todavía lleva su propia
 * copia: ese script calcula el correo entero al cargarse y partirlo es un cambio aparte.
 *
 * El remitente va siendo la cuenta que se autentica: los hostings rechazan un "From" de otra.
 */

const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'alertas-config.json'), 'utf8'),
);

/** Los correos del equipo, para los avisos técnicos: nunca van a los destinatarios del cliente. */
function destinatariosTecnicos() {
  const delEntorno = (process.env.RB_ALERTAS_TECNICAS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (delEntorno.length) return delEntorno;
  const deConfig = (CONFIG.destinatarios_tecnicos || []).map(d => d.email).filter(Boolean);
  if (deConfig.length) return deConfig;
  return [];
}

async function enviar({ para, asunto, html }) {
  const lista = (para || []).filter(Boolean);
  if (!lista.length) throw new Error('No hay a quién enviarle.');

  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].every(nombre => process.env[nombre]);
  const resend = process.env.RESEND_API_KEY;
  if (!smtp && !resend) {
    throw new Error('Falta configurar el envío: SMTP_HOST, SMTP_USER y SMTP_PASS, o RESEND_API_KEY.');
  }

  if (smtp) {
    const nodemailer = require('nodemailer');
    const puerto = Number(process.env.SMTP_PORT) || 465;
    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: puerto === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const de = /@/.test(process.env.SMTP_USER) ? process.env.SMTP_USER : CONFIG.from_email;
    const info = await transporte.sendMail({
      from: `${CONFIG.from_name} <${de}>`,
      to: lista,
      subject: asunto,
      html,
    });
    return `correo del hosting (${process.env.SMTP_HOST}) · ${info.messageId || 'sin id'}`;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${CONFIG.from_name} <${CONFIG.from_email}>`,
      to: lista,
      subject: asunto,
      html,
    }),
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(cuerpo)}`);
  return `Resend · ${cuerpo?.id || 'sin id'}`;
}

module.exports = { CONFIG, destinatariosTecnicos, enviar };
