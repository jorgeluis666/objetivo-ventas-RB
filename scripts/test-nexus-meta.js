const assert=require('node:assert/strict');
const {parseMetaReport}=require('./sync-ads');
const header='level,day,id,name,campaign,adset,spend,impressions,clicks,inline_link_clicks,leads,purchases,messages,purchase_value';
const text=['NEXUS_META_V1,2026-10-28T13:00:00-05:00,247978639820195,PEN,2026-10,2026-10-28',header,
'campaign,2026-10-28,1,Campaign,Campaign,,10,100,9,5,1,2,3,40',
'ad,2026-10-28,2,Ad,Campaign,Set,10,100,9,5,1,2,3,40'].join('\n');
const r=parseMetaReport(text);assert.equal(r.totals.spend,10);assert.equal(r.totals.allClicks,9);assert.equal(r.totals.purchases,2);assert.equal(r.table.rows.length,1);assert.equal(r.audience.age,null);assert.equal(r.source,'nexus');assert.equal(r.capturedAt,'2026-10-28T13:00:00-05:00');
assert.throws(()=>parseMetaReport(text.replace('247978639820195','999')));
assert.throws(()=>parseMetaReport(text+'\n'+'ad,2026-10-28,2,Ad,Campaign,Set,10,100,9,5,1,2,3,40'));
console.log('Nexus Meta parity, no double counting, account isolation and missing dimensions OK');
