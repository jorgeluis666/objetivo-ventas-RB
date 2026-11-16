'use strict';
// Read only Nexus-owned campaign-period columns. Never aggregate ratios.
const fs = require('fs');
const path = require('path');
const keys = ['top_rate','absolute_top_rate','top_share','absolute_top_share','lost_top_budget','lost_top_rank'];
function csv(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
function ratio(v) {
  if(v===null||v===undefined||String(v).trim()===''||String(v).trim()==='Sin datos')return null;
  const s=String(v).replace(/\s/g,'');if(s==='<10%')return .0999;if(s==='>90%')return .9001;
  const n=Number(s.replace('%','').replace(',','.'))/(s.includes('%')?100:1);
  return Number.isFinite(n)&&n>=0&&n<=1?n:null;
}
function parse(rows,at=null) {
  const index=rows.findIndex(r=>r.includes('Nexus visibilidad · periodo'));
  if(index<0)return {};
  const header=rows[index], offset=header.indexOf('Nexus visibilidad · periodo');
  if(header.slice(offset+1,offset+7).length!==6||!header.slice(offset+1,offset+7).every(v=>v.startsWith('Nexus campaña · ')))return {};
  const campaign=header.findIndex(h=>/^(campaña|campaign)$/i.test(h.trim()));if(campaign<0)return {};
  const out={};
  for(const row of rows.slice(index+1)) {
    const period=/^(\d{4}-\d{2})-01 - (\d{4}-\d{2}-\d{2})$/.exec(row[offset]||'');
    if(!period||!row[campaign])continue;
    const month=period[1], through=period[2];if(!through.startsWith(month))continue;
    if(!out[month])out[month]={through,at,campaigns:[]};
    if(out[month].through!==through)throw new Error('Mixed visibility periods');
    const item={campaign:row[campaign]};keys.forEach((k,i)=>item[k]=ratio(row[offset+1+i]));
    if(header[offset+7]==='Nexus conjuntos · JSON v1') {
      const groups=JSON.parse(row[offset+7]||'[]');if(!Array.isArray(groups))throw new Error('Invalid visibility groups');
      const seen=new Set();item.groups=groups.map(g=>{if(!g||typeof g.name!=='string'||!/^\d+$/.test(g.id)||seen.has(g.id))throw new Error('Invalid group identity');seen.add(g.id);const clean={id:g.id,name:g.name};for(const key of keys){if(g[key]!==null&&(typeof g[key]!=='number'||!Number.isFinite(g[key])||g[key]<0||g[key]>1))throw new Error('Invalid group ratio');clean[key]=g[key];}return clean;});
    }
    const old=out[month].campaigns.find(r=>r.campaign===item.campaign);
    if(old && JSON.stringify(old)!==JSON.stringify(item))throw new Error('Conflicting campaign visibility');
    if(!old)out[month].campaigns.push(item);
  }return out;
}
function read(root) {
  const out={};const directory=path.join(root,'data/csv-backups/drive');
  if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.csv')).sort())Object.assign(out,parse(csv(fs.readFileSync(path.join(directory,name),'utf8'))));
  const snapshot=path.join(root,'data/drive-snapshot.json');
  if(fs.existsSync(snapshot)){const data=JSON.parse(fs.readFileSync(snapshot,'utf8'));for(const sheet of data.sheets||[])Object.assign(out,parse(sheet.rows||[],data.generatedAt||null));}
  const ads=path.join(root,'data/ads-2026.json');
  if(fs.existsSync(ads))Object.assign(out,JSON.parse(fs.readFileSync(ads,'utf8')).visibilityByMonth||{});
  return {visibilityByMonth:out};
}
module.exports={csv,ratio,parse,read};
