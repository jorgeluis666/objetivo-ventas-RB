// Prints the dashboard's own generator. It never creates a replacement PDF layout.
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),cp=require('child_process');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'scripts/native-report.json'),'utf8'));
const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const date=process.env.REPORT_DATE||(process.env.NATIVE_SCHEDULED==='1'?now.toISOString().slice(0,10):today);
if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid report date');
const iso=d=>d.toISOString().slice(0,10),target=new Date(date+'T12:00:00Z'),end=iso(new Date(target-86400000)),from=end.slice(0,7)+'-01';
const types=[];if(target.getUTCDay()===1)types.push('weekly');if(date.endsWith('-01'))types.push('monthly');
if(!types.length){console.log('No reports due');process.exit(0);}
const output=path.join(root,'native-report-output');fs.mkdirSync(output,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{let p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.statusCode=404;return res.end();}res.setHeader('Content-Type',mime[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
let snapshotCommit=null;
function selectClosedSnapshot(){
 if(!config.periodSource)return;
 const matches=text=>{const d=JSON.parse(text);let m;if(config.kind==='tlm')m=d.months?.[Number(end.slice(5,7))-1];else m=d.months?.find(m=>m.id===end.slice(0,7));return config.kind==='tlm'?m?.lastDay===end:config.kind==='royal'?m?.meta?.coverage?.end===end&&m?.google?.coverage?.end===end:m?.period?.end===end;};
 if(matches(fs.readFileSync(path.join(root,config.periodSource),'utf8')))return;
 // Use the latest published snapshot for the requested closing date, never relabel today's totals.
 const revisions=cp.execFileSync('git',['log','-150','--format=%H','--',config.periodSource],{cwd:root,encoding:'utf8'}).trim().split(/\s+/);
 for(const revision of revisions){
  if(!/^[a-f0-9]{40}$/.test(revision))continue;
  const text=cp.execFileSync('git',['show',revision+':'+config.periodSource],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
  if(!matches(text))continue;
  for(const file of config.snapshotFiles||[config.periodSource]){
   const contents=cp.execFileSync('git',['show',revision+':'+file],{cwd:root,maxBuffer:64*1024*1024});fs.writeFileSync(path.join(root,file),contents);
  }
  snapshotCommit=revision;return;
 }
 throw Error('No published data snapshot closes exactly on '+end);
}
async function main(){
 selectClosedSnapshot();
 if(config.endpoint){
  const endpoint=process.env[config.endpoint];if(!endpoint||!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint))throw Error('Missing authorized data endpoint');
  const response=await fetch(endpoint+'?action=data',{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Source HTTP '+response.status);
  const data=await response.json();if(data.ok===false||!Array.isArray(data.months))throw Error('Invalid source snapshot');
  fs.writeFileSync(path.join(root,config.snapshot),JSON.stringify(data));
 }
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true});
 try{
  for(const type of types){
   const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
   // An explicit preview date exercises the same Sunday/month-end selector as the scheduled run.
   if(process.env.REPORT_DATE)await page.evaluateOnNewDocument(d=>{const NativeDate=Date,at=NativeDate.parse(d+'T12:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[at]));}static now(){return at;}};},date);
   const query=config.kind==='royal'?(type==='monthly'?`?rpt=mensual&periodo=${from.slice(0,7)}&calendario=1`:`?rpt=acumulado&corte=${end}&calendario=1`):'';
   await page.goto(`http://127.0.0.1:${server.address().port}/index.html${query}`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(c=>{const g=window[c.data];if(c.kind==='tlm'||c.kind==='royal')return !!window[c.module];return !!g&&(g.months?g.months().length:g.snapshot?g.snapshot()?.months?.length:g.meta?g.meta()?.months?.length:false);},{timeout:120000},config);
   await page.evaluate(async c=>{await window[c.module].init();},config);
   if(config.kind==='tierra'){
    await page.evaluate(t=>document.querySelector(`[data-week-type="${t==='monthly'?'mes':'avance'}"]`).click(),type);
   }
   const selector=config.kind==='royal'?(type==='monthly'?'#rpt-select':'#acc-select'):'#week-select';
   const value=config.kind==='tp'?`m:${from.slice(0,7)}:${Number(end.slice(8))}`:config.kind==='amador'?`${from.slice(0,7)}:${Number(end.slice(8))}`:config.kind==='tierra'?`avance:${end}`:config.kind==='royal'?(type==='monthly'?from.slice(0,7):end):from.slice(0,7);
   await page.waitForFunction((s,v)=>[...document.querySelectorAll(s+' option')].some(o=>o.value===v),{timeout:90000},selector,value);
   await page.select(selector,value);
   const deck=config.kind==='royal'?'#rpt-report .rpt':'#week-doc';
   await page.waitForSelector(deck+' section',{timeout:60000});
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForNetworkIdle({idleTime:500,timeout:15000}).catch(()=>{});
   const proof=await page.evaluate((c,deck,from,end)=>{
    if(c.kind==='royal'){const r=window.RB_REPORTE_LISTO;if(r?.inicio!==from||r?.fin!==end)throw Error('Royal Baby period mismatch');}
    if(['sumi','aquarius','hers'].includes(c.kind)){const m=window[c.data].months().find(m=>m.key===from.slice(0,7));if(m?.lastDay!==Number(end.slice(8))||m.firstDay!==1)throw Error('Monthly source does not cover requested range');}
    if(c.kind==='tlm'){const text=document.querySelector('#week-select').selectedOptions[0].textContent;if(!new RegExp('–\\s*'+Number(end.slice(8))+'\\s').test(text))throw Error('TLM source cutoff mismatch');}
    const host=document.querySelector(deck);if(!host||host.innerText.length<1000)throw Error('Empty report');
    const pages=host.querySelectorAll(c.kind==='royal'?'.rpt-page':':scope > section');if(!pages.length)throw Error('No report pages');
    const text=host.innerText;
    // Keep exactly the generated deck and the original styles; dashboard menus never enter the PDF.
    const original=(c.kind==='royal'?document.querySelector('#rpt-report'):host).cloneNode(true);document.body.replaceChildren(original);
    return {pages:pages.length,cover:pages[0].innerText,text};
   },config,deck,from,end);
   await page.addStyleTag({content:'@media print { body { margin:0!important;padding:0!important } .rp-deck,.rpt {display:block!important} .rp-page {zoom:1!important} }'});
   const name=`${config.brand}-${type}-${from}-${end}`,file=path.join(output,name+'.pdf');
   await page.pdf({path:file,printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
   const pdf=fs.readFileSync(file),commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
   const manifest={generator:'dashboard-native-v1',brand:config.brand,type,from,to:end,pages:proof.pages,commit,snapshot_commit:snapshotCommit,sha256:crypto.createHash('sha256').update(pdf).digest('hex'),generated_at:new Date().toISOString(),cover:proof.cover};
   fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(manifest,null,2));
   // Public repositories must never expose plaintext customer reports as workflow artifacts.
   const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
   const encrypted=Buffer.concat([cipher.update(Buffer.from(JSON.stringify({manifest,pdf:pdf.toString('base64')}))),cipher.final()]);
   const wrapped=crypto.publicEncrypt({key:fs.readFileSync(path.join(root,'scripts/native-preview-public.pem')),oaepHash:'sha256'},key);
   fs.writeFileSync(path.join(output,name+'.encrypted.json'),JSON.stringify({version:1,key:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));
   console.log(JSON.stringify(manifest));
   if(process.env.NATIVE_REPORT_TOKEN){
    const response=await fetch('https://nexus.limaretail.com/report-delivery/native-pdf',{method:'POST',headers:{'Content-Type':'application/json','X-Report-Token':process.env.NATIVE_REPORT_TOKEN},body:JSON.stringify({...manifest,pdf:pdf.toString('base64')}),signal:AbortSignal.timeout(120000)});
    const result=await response.json();if(!response.ok||!['ready','already-prepared'].includes(result.status))throw Error('Nexus did not accept original PDF: '+response.status);
    console.log('NEXUS_NATIVE_PDF_READY',name);
   }
   await page.close();
  }
 }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error.message);server.close();process.exitCode=1;});
