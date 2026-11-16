'use strict';
(() => {
  const source = document.currentScript?.dataset.source;
  const fields = [
    ['top_rate', '% parte superior'], ['absolute_top_rate', '% superior absoluta'],
    ['top_share', 'Cuota parte superior'], ['absolute_top_share', 'Cuota superior absoluta'],
    ['lost_top_budget', 'Pérdida superior · presupuesto'], ['lost_top_rank', 'Pérdida superior · ranking']
  ];
  const fmt = (key, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Sin datos';
    if (['top_share','absolute_top_share'].includes(key) && Math.abs(value - 0.0999) < 1e-8) return '<10%';
    if (['lost_top_budget','lost_top_rank'].includes(key) && Math.abs(value - 0.9001) < 1e-8) return '>90%';
    return (value * 100).toLocaleString('es-PE', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%';
  };
  function mount(data) {
    const host = document.getElementById(window.NEXUS_VISIBILITY_HOST || 'view-obj');
    if (!host) return;
    document.getElementById('ads-visibility')?.remove();
    const panel = document.createElement('section'); panel.id = 'ads-visibility'; panel.className = 'ads-visibility';
    const heading = document.createElement('h2'); heading.textContent = 'Visibilidad en búsqueda · Google Ads'; panel.append(heading);
    const note = document.createElement('p'); note.textContent = 'Porcentajes del mes por campaña, calculados por Google. Las cuotas no se suman ni se promedian. «Sin datos» indica un valor no devuelto por Google o un periodo aún no leído.'; panel.append(note);
    const label = document.createElement('label'); label.textContent = 'Mes de visibilidad ';
    const select = document.createElement('select'); select.setAttribute('aria-label','Mes de visibilidad'); label.append(select); panel.append(label);
    const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Descargar indicadores CSV'; panel.append(download);
    const status = document.createElement('p'); status.setAttribute('role','status'); panel.append(status);
    const scroll = document.createElement('div'); scroll.className='ads-visibility-scroll';
    const table=document.createElement('table'); table.setAttribute('aria-label','Indicadores de visibilidad Google Ads'); scroll.append(table); panel.append(scroll);
    host.append(panel);
    const months = data?.visibilityByMonth || {};
    for (const month of Object.keys(months).sort().reverse()) { const option=document.createElement('option'); option.value=month; option.textContent=month; select.append(option); }
    let current=[];
    function render() {
      const block=months[select.value]; current=Array.isArray(block?.campaigns)?block.campaigns:[];
      status.textContent=block?.through ? `Periodo: ${select.value}-01 al ${block.through}. Lectura: ${block.at ? new Date(block.at).toLocaleString('es-PE') : 'Sin datos'}.` : 'Sin datos para este periodo.';
      table.replaceChildren(); const head=table.createTHead().insertRow();
      for (const title of ['Campaña',...fields.map(f=>f[1])]) { const th=document.createElement('th'); th.scope='col'; th.textContent=title; head.append(th); }
      const body=table.createTBody();
      for (const row of current) { const tr=body.insertRow(); tr.insertCell().textContent=row.campaign; for (const [key] of fields) tr.insertCell().textContent=fmt(key,row[key]); }
      if (!current.length) { const td=body.insertRow().insertCell(); td.colSpan=7; td.textContent='Sin datos de campañas para este periodo.'; }
    }
    select.addEventListener('change',render);
    download.addEventListener('click',()=>{
      // Quoted CSV plus formula neutralization for untrusted campaign names.
      const csvCell=v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
      const lines=[['Mes','Campaña',...fields.map(f=>f[1])],...current.map(r=>[select.value,r.campaign,...fields.map(([k])=>fmt(k,r[k]))])];
      const url=URL.createObjectURL(new Blob(['\ufeff'+lines.map(r=>r.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a'); a.href=url; a.download=`visibilidad-google-ads-${select.value||'sin-datos'}.csv`; a.click(); URL.revokeObjectURL(url);
    });
    render();
  }
  if (window.NEXUS_ADS_VISIBILITY) { mount(window.NEXUS_ADS_VISIBILITY); } else if (source) {
    fetch(source,{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('No disponible');return r.json();}).then(mount).catch(()=>mount(null));
  } else {
    window.addEventListener('tierra-films:data-ready',e=>mount(e.detail));
    if (window.TIERRA_FILMS_RETAIL_DATA) mount(window.TIERRA_FILMS_RETAIL_DATA);
  }
})();
