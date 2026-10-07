#!/usr/bin/env node
/* Browser measurement of story scenes — the ground truth the static validator only estimates.
     NODE_PATH=$(npm root -g) CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
       VW=360 VH=740 node scripts/measure-story.js PY-02 PY-03 ...
   Opens each reel in a phone-sized Chromium, plays every story scene at 7 points of the narration and
   reports actors that fall off the stage (OFF), are clipped (CLIP) or overlap while visible (OVERLAP).
   Text output only. Always run at VW=360 (the smallest common phone: stage is only ~292px wide there). */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.png':'image/png'};
const srv=http.createServer((q,r)=>{let f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});r.end(b)})});
(async()=>{
 await new Promise(r=>srv.listen(0,r));
 const b=await chromium.launch({executablePath:process.env.CHROMIUM});
 const p=await b.newPage({viewport:{width:+(process.env.VW||390),height:+(process.env.VH||844)}});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 let problems=0,scenes=0;
 for(const id of process.argv.slice(2)){
  await p.goto('http://localhost:'+srv.address().port+'/?reel='+id);await p.waitForTimeout(1200);
  await p.mouse.click(+(process.env.VW||390)/2,400);await p.waitForTimeout(300);
  await p.evaluate(()=>SS.feed.activePlayer().skipHook());
  const n=await p.evaluate(()=>SS.feed.activePlayer().data.scenes.map(s=>s.type));
  for(let i=0;i<n.length;i++){ if(n[i]!=='story')continue; scenes++;
   await p.evaluate(i=>{const pl=SS.feed.activePlayer();pl._clearTimers();pl._stopSpeech();pl.sceneIdx=i;pl._scene();pl._clearTimers();pl._stopSpeech();},i);
   await p.waitForTimeout(500);
   for(const f of [0.05,0.2,0.35,0.5,0.65,0.8,1]){
     await p.evaluate(f=>SS.feed.activePlayer()._cue(f),f);
     await p.waitForTimeout(1500);
     const bad=await p.evaluate(()=>{
       const stg=document.querySelector('.st-stage:last-of-type')||[...document.querySelectorAll('.st-stage')].pop();
       const sr=stg.getBoundingClientRect(), out=[];
       const els=[...stg.querySelectorAll('.st-a.on')].map(e=>({e,r:e.getBoundingClientRect(),k:[...e.classList].find(c=>/^st-(panel|chip|pkg|tag|term|code)$/.test(c)),t:(e.textContent||'').trim().slice(0,18)}));
       els.forEach(a=>{ const r=a.r; if(r.left<sr.left-2||r.right>sr.right+2||r.top<sr.top-2||r.bottom>sr.bottom+2) out.push('OFF '+a.t); 
         if(a.k==='st-chip'||a.k==='st-tag'){ if(a.e&&0){} const el=a.e; if(el.scrollWidth>el.clientWidth+2) out.push('CLIP '+a.t);} });
       stg.querySelectorAll('.st-code.on').forEach(c=>{const cr=c.getBoundingClientRect(),o=c.querySelector('.cd-out.on'),ot=o?o.getBoundingClientRect().top:cr.bottom;
         c.querySelectorAll('.cl.on').forEach(l=>{ if(l.scrollWidth>l.clientWidth+1||l.getBoundingClientRect().right>cr.right+1) out.push('CODE-CLIP '+l.textContent.trim().slice(0,20)); if(l.getBoundingClientRect().bottom>ot+1) out.push('CODE-COVERED '+l.textContent.trim().slice(0,20)); }); });
       const cont=k=>k==='st-panel'||k==='st-term'||k==='st-code';
       for(let x=0;x<els.length;x++)for(let y=x+1;y<els.length;y++){const A=els[x],B=els[y];
         const o=!(A.r.right-3<=B.r.left||B.r.right-3<=A.r.left||A.r.bottom-3<=B.r.top||B.r.bottom-3<=A.r.top); if(!o)continue;
         const ca=cont(A.k),cb=cont(B.k); if(ca!==cb){const I=ca?B.r:A.r,O=ca?A.r:B.r; if(I.left>=O.left-2&&I.right<=O.right+2&&I.top>=O.top-2&&I.bottom<=O.bottom+2)continue;}
         out.push('OVERLAP '+A.t+' x '+B.t);}
       return out;});
     if(bad.length){problems+=bad.length;console.log(id,'scene',i,'f='+f,[...new Set(bad)].join(' | '))}
   }
  }
 }
 console.log(`measured ${scenes} story scenes — ${problems} layout problem(s); js errors: ${JSON.stringify(errs)}`); process.exitCode = problems || errs.length ? 1 : 0;
 await b.close();srv.close();
})();
