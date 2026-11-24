/* ============================================================
   pauta-dia.js — la inversión publicitaria por día y por fuente de tráfico.
   Una sola definición para los módulos que suman la pauta por el ciclo de venta
   (js/ciclo.js: cada mes va del 26 del anterior al 25), porque los informes de
   Drive llegan por mes calendario:
     Proyecciones            js/projections.js y js/plan-campanas.js
     Resultados vs inversión js/resultados.js
   Meta Ads llega por día y campaña: su serie es real. Google Ads llega con un
   total por mes y sin serie diaria: se reparte entre los días que cubre el
   informe, y eso queda marcado con `estimated`.
   Las campañas de Meta se agrupan por tipo de resultado, los mismos cuatro
   grupos y colores que usa Gasto publicitario.
   Expone window.PautaDia.build(gasto) → { dias, hasta, google }.
   ============================================================ */

(function (global) {
  const Ciclo = global.Ciclo;

  // Fuentes de tráfico: cómo se agrupan las campañas y con qué color se dibujan.
  const FUENTES = {
    ecom:   { label: 'Meta · E-Commerce', platform: 'Meta Ads',   color: '#1877F2' },
    wa:     { label: 'Meta · WhatsApp',   platform: 'Meta Ads',   color: '#25D366' },
    google: { label: 'Google Ads',        platform: 'Google Ads', color: '#4285F4' },
    reach:  { label: 'Meta · Alcance',    platform: 'Meta Ads',   color: '#E1306C' },
  };
  const FUENTE_POR_RESULTADO = {
    'Compras en el sitio web': 'ecom',
    'Conversaciones con mensajes iniciadas': 'wa',
  };  // Interacciones, ThruPlay y el resto van a Alcance

  // Respaldo cuando el informe no trae «Tipo de resultado»: las hojas de Meta que escribe Nexus
  // (de septiembre de 2026 en adelante) no traen esa columna ni «Objetivo», y sin respaldo toda la
  // inversión de Meta caería en Alcance. Queda el nombre de la campaña, que la agencia nombra por
  // su propósito. El orden importa: «Tráfico a Mensajes | WhatsApp» es de mensajes, no de tráfico.
  const FUENTE_POR_NOMBRE = [
    [/e-?commerce|\bventas?\b|\bcompras?\b|cat[áa]logo|advantage\+?\s*shopping/i, 'ecom'],
    [/whats|mensaje/i, 'wa'],
  ];  // lo que no cae en ninguna —reconocimiento, interacción, tráfico— va a Alcance

  // Fuente de una campaña. `porNombre` avisa de que se agrupó sin el tipo de resultado del informe.
  function fuenteDe(c, nombre) {
    if (c?.resultType) return { key: FUENTE_POR_RESULTADO[c.resultType] || 'reach', porNombre: false };
    const hit = FUENTE_POR_NOMBRE.find(([re]) => re.test(nombre || c?.campaign || ''));
    return { key: hit ? hit[1] : 'reach', porNombre: true };
  }

  const addDays = Ciclo.sumarDias;
  function rangeIso(start, end) {
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }
  // Último día del mes del id YYYY-MM
  const lastDayOfId = id => new Date(Date.UTC(+id.slice(0, 4), +id.slice(5, 7), 0)).toISOString().slice(0, 10);

  // Inversión y resultados por día y fuente, de todos los informes de Gasto publicitario:
  // { dias: Map(fecha → { ecom, wa, reach, google }), hasta: { meta, google }, google: Map(fecha → informe) }.
  // Así la inversión se puede sumar por el ciclo de venta, que no coincide con el mes de los
  // informes. Un día cubierto sin inversión cuenta igual, en 0.
  function build(gasto) {
    const dias = new Map();
    const hasta = { meta: null, google: null };
    const google = new Map();
    const add = (day, key, v = {}, estimated = false) => {
      if (!dias.has(day)) dias.set(day, {});
      const s = dias.get(day)[key] ||= { spend: 0, value: 0, purchases: 0, conversations: 0, impressions: 0, clicks: 0, spendSinTipo: 0, results: {}, campaigns: new Set(), estimated };
      for (const f of ['spend', 'value', 'purchases', 'conversations', 'impressions', 'clicks', 'spendSinTipo']) s[f] += v[f] || 0;
      for (const [type, n] of Object.entries(v.results || {})) if (n) s.results[type] = (s.results[type] || 0) + n;
      if (v.campaign) s.campaigns.add(v.campaign);
    };
    const span = (block, id) => {
      const c = block.coverage || {};
      return { start: c.start || `${id}-01`, end: c.complete || !c.end ? lastDayOfId(id) : c.end };
    };
    for (const gm of gasto?.months || []) {
      if (gm.meta) {
        const { start, end } = span(gm.meta, gm.id);
        const campana = Object.fromEntries((gm.meta.campaigns || []).map(c => [c.campaign, c]));
        for (const day of rangeIso(start, end)) ['ecom', 'wa', 'reach'].forEach(k => add(day, k));
        for (const r of gm.meta.daily || []) {
          if (r.day < start || r.day > end) continue;
          const c = campana[r.campaign] || {};
          // Los resultados de tipos distintos no se suman entre sí. Una campaña que mezcla tipos no
          // los separa por día: su total del mes se reparte según la inversión del día.
          const results = c.resultType === 'mixto'
            ? Object.fromEntries(Object.entries(c.resultsByType || {}).map(([type, n]) => [type, c.spend ? n * (r.spend || 0) / c.spend : 0]))
            : c.resultType ? { [c.resultType]: r.results || 0 } : {};
          const f = fuenteDe(c, r.campaign);
          add(r.day, f.key, {
            spend: r.spend, value: r.purchaseValue, purchases: r.purchases, conversations: r.conversations,
            impressions: r.impressions, clicks: r.linkClicks, results, campaign: r.spend ? r.campaign : null,
            spendSinTipo: f.porNombre ? r.spend : 0,
          });
        }
        if (!hasta.meta || end > hasta.meta) hasta.meta = end;
      }
      if (gm.google) {
        const { start, end } = span(gm.google, gm.id);
        const days = rangeIso(start, end);
        // Las hojas de Google que escribe Nexus traen una fila por día y campaña: con esa serie la
        // inversión del día es real. El informe exportado a mano llega con un total por mes y sin
        // serie: se reparte entre los días que cubre, y queda marcado como estimado.
        const diaria = (gm.google.daily || []).filter(r => r.day >= start && r.day <= end);
        if (diaria.length) {
          for (const day of days) { add(day, 'google', {}, false); google.set(day, gm.google); }
          for (const r of diaria) {
            add(r.day, 'google', {
              spend: r.cost, value: r.conversionValue, purchases: r.purchases,
              impressions: r.impressions, clicks: r.clicks, campaign: r.cost ? r.campaign : null,
            }, false);
          }
        } else {
          const t = gm.google.totals || {};
          const parte = f => (t[f] || 0) / days.length;
          for (const day of days) {
            add(day, 'google', { spend: parte('cost'), value: parte('conversionValue'), purchases: parte('purchases'), impressions: parte('impressions'), clicks: parte('clicks') }, true);
            google.set(day, gm.google);
          }
        }
        if (!hasta.google || end > hasta.google) hasta.google = end;
      }
    }
    return { dias, hasta, google };
  }

  global.PautaDia = { build, fuenteDe, FUENTES, FUENTE_POR_RESULTADO, FUENTE_POR_NOMBRE, rangeIso, lastDayOfId };
})(window);
