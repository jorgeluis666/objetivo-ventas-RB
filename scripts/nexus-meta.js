'use strict';
// Versioned, typed capture exported by Nexus. No second request to Meta.
module.exports = function parseNexus(rows, parseLegacy) {
  const [magic, capturedAt, account, currency, month, through] = rows[0];
  if (magic !== 'NEXUS_META_V1' || account !== '247978639820195' || currency !== 'PEN'
      || !/^20\d\d-\d\d$/.test(month) || !String(through).startsWith(month) || !Number.isFinite(Date.parse(capturedAt))) throw Error('Captura Nexus incompatible');
  const header=['level','day','id','name','campaign','adset','spend','impressions','clicks','inline_link_clicks','leads','purchases','messages','purchase_value'];
  if (rows[1].join('|') !== header.join('|')) throw Error('Columnas Nexus incompatibles');
  const levels={campaign:[],adset:[],ad:[]}, seen=new Set();
  for(const cells of rows.slice(2)) {
    if(!cells.some(Boolean))continue;
    const r=Object.fromEntries(header.map((h,i)=>[h,cells[i]??'']));
    if(!levels[r.level]||!/^\d+$/.test(r.id)||!r.day.startsWith(month)||r.day>through)throw Error('Fila Nexus inválida');
    const key=[r.level,r.day,r.id].join(':');if(seen.has(key))throw Error('Fila Nexus duplicada');seen.add(key);
    for(const field of header.slice(6)){r[field]=Number(r[field]);if(!Number.isFinite(r[field])||r[field]<0)throw Error('Métrica Nexus inválida');}
    levels[r.level].push(r);
  }
  const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const convert=(items,level)=>{
    const h=['Día','Nombre del anuncio','Nombre de la campaña','Nombre del conjunto de anuncios','Monto gastado (PEN)','Impresiones','Clics en el enlace','Clics (todos)','CTR (todos)','Compras','Valor de conversión de compras','Conversaciones con mensajes iniciadas','Enlace de vista previa'];
    const csv=[h,...items.map(r=>[r.day,r.name,level==='campaign'?r.name:r.campaign,r.adset,r.spend,r.impressions,r.inline_link_clicks,r.clicks,r.impressions?r.clicks/r.impressions*100:0,r.purchases,r.purchase_value,r.messages,level==='ad'?'https://www.facebook.com/ads/manager/account/ads/?act='+account+'&selected_ad_ids='+r.id:''])].map(r=>r.map(quote).join(',')).join('\n');
    if(!items.length)return null;
    return parseLegacy(csv);
  };
  const main=convert(levels.campaign,'campaign') || convert([{day:month+'-01',id:'0',name:'Sin actividad',campaign:'',adset:'',spend:0,impressions:0,inline_link_clicks:0,clicks:0,purchases:0,purchase_value:0,messages:0}], 'campaign');
  if(!levels.campaign.length){main.campaigns=[];main.rows=0;main.daily=[];}
  const detail=convert(levels.ad,'ad');
  main.table=detail?.table??null;main.ads=detail?.ads??null;main.audience={age:null,gender:null};
  main.source='nexus';main.capturedAt=capturedAt;main.accountId=account;main.partialDay=true;
  main.coverage.end=through;main.coverage.start=month+'-01';
  main.warnings=['Fuente Nexus: misma captura que el tablero interno. Sin desglose de edad/sexo ni alcance único; no se suman los niveles.'];
  // Unavailable metrics stay null, never invented zeros.
  main.totals.interactions=null;for(const c of main.campaigns)c.interactions=null;
  if(main.table){const i=main.table.columns.indexOf('reach');for(const row of main.table.rows)row[i]=null;}
  return main;
};
