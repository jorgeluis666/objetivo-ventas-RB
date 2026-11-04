const assert=require('node:assert/strict');
const {parseMetaReport}=require('./sync-ads');
const header='level,day,id,name,campaign,adset,spend,impressions,clicks,inline_link_clicks,leads,purchases,messages,purchase_value';
const text=['NEXUS_META_V1,2026-10-28T13:00:00-05:00,247978639820195,PEN,2026-10,2026-10-28',header,
'campaign,2026-10-28,1,Campaign,Campaign,,10,100,9,5,1,2,3,40',
'ad,2026-10-28,2,Ad,Campaign,Set,10,100,9,5,1,2,3,40'].join('\n');
const r=parseMetaReport(text);assert.equal(r.totals.spend,10);assert.equal(r.totals.allClicks,9);assert.equal(r.totals.purchases,2);assert.equal(r.table.rows.length,1);assert.equal(r.audience.age,null);assert.equal(r.source,'nexus');assert.equal(r.capturedAt,'2026-10-28T13:00:00-05:00');
assert.throws(()=>parseMetaReport(text.replace('247978639820195','999')));
assert.throws(()=>parseMetaReport(text+'\n'+'ad,2026-10-28,2,Ad,Campaign,Set,10,100,9,5,1,2,3,40'));

// Con `extended_fields` Nexus añade reach, objective, optimization_goal, result_type y results.
// Es lo que escribe desde el 3/11/2026 y lo que dejó al tablero sin Meta: las cifras de las 14
// primeras columnas tienen que salir iguales, y el alcance diario se sigue devolviendo vacío.
const extendido=['NEXUS_META_V1,2026-10-28T13:00:00-05:00,247978639820195,PEN,2026-10,2026-10-28',
header+',reach,objective,optimization_goal,result_type,results',
'campaign,2026-10-28,1,Campaign,Campaign,,10,100,9,5,1,2,3,40,90,OUTCOME_SALES,OFFSITE_CONVERSIONS,purchase,2',
'ad,2026-10-28,2,Ad,Campaign,Set,10,100,9,5,1,2,3,40,90,OUTCOME_SALES,OFFSITE_CONVERSIONS,purchase,2'].join('\n');
const e=parseMetaReport(extendido);
assert.equal(e.totals.spend,10);assert.equal(e.totals.allClicks,9);assert.equal(e.totals.purchases,2);
assert.equal(e.table.rows.length,1);assert.equal(e.source,'nexus');assert.equal(e.capturedAt,'2026-10-28T13:00:00-05:00');
assert.equal(e.table.rows[0][e.table.columns.indexOf('reach')],null);
assert.deepEqual(e.totals,r.totals);

// Las 14 primeras se leen por posición: si una cambia de nombre o se cuela otra en medio, no se lee.
assert.throws(()=>parseMetaReport(extendido.replace('clicks,inline_link_clicks','inline_link_clicks,clicks')));
assert.throws(()=>parseMetaReport(extendido.replace('level,day,id','level,day,reach,id')));

console.log('Nexus Meta parity, extended columns, no double counting, account isolation and missing dimensions OK');
