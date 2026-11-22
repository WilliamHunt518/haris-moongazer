// Frame-accurate scene recorder for HARIS videos.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const {execFileSync}=require('child_process');
const D=__dirname;
const OUT=process.env.HARIS_VIDEO_OUT||path.join(__dirname,'out');fs.mkdirSync(OUT,{recursive:true});
const BASEMAP=fs.readFileSync(D+'/basemap.js','utf8');
const OVJS=fs.readFileSync(D+'/overlay.js','utf8');
const OVCSS=fs.readFileSync(D+'/overlay.css','utf8');
const PNG1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=','base64');
const BASE=process.env.HARIS_URL||'http://localhost:44101';
const FPS=30;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

async function browser(){return chromium.launch({args:['--force-color-profile=srgb','--hide-scrollbars','--font-render-hinting=none']});}

class Scene{
  constructor(b,name,opts={}){this.b=b;this.name=name;this.dir=path.join(OUT,'frames',name);this.n=0;this.opts=opts;
    fs.rmSync(this.dir,{recursive:true,force:true});fs.mkdirSync(this.dir,{recursive:true});this.cx=-50;this.cy=-50;}
  async init(){
    const vp=this.vp=this.opts.viewport||{width:1280,height:720};
    this.ctx=await this.b.newContext({viewport:vp,deviceScaleFactor:1920/vp.width});
    if(!this.opts.realMap&&!process.env.REAL_MAP) await this.ctx.addInitScript({content:BASEMAP});
    await this.ctx.addInitScript({content:OVJS});
    await this.ctx.route(/^http:\/\/maps\.gstatic\.com\//,async r=>{
      try{const res=await r.fetch({url:r.request().url().replace('http:','https:')});await r.fulfill({response:res});}
      catch(e){await r.fulfill({status:200,contentType:'image/png',body:PNG1});}});
    await this.ctx.route(/w2ui\.com/,r=>r.fulfill({status:200,contentType:'text/css',body:''}));
    this.page=await this.ctx.newPage();
    this.cdp=await this.ctx.newCDPSession(this.page);
    if(this.opts.clock!==false) await this.page.clock.install({time:new Date('2026-11-22T12:00:00Z')});
    return this;
  }
  async goto(url){await this.page.goto(url.startsWith('http')?url:BASE+'/'+url);if(this.opts.clock!==false){await sleep(1500);await this.page.clock.pauseAt(new Date(Date.parse('2026-11-22T12:00:00Z')+60000));}await this.settle(3000);}
  async overlay(){await this.page.evaluate(css=>window.__mgOverlay(css),OVCSS);}
  // advance page time without capturing
  async settle(ms){for(let t=0;t<ms;t+=100){if(this.opts.clock!==false)await this.page.clock.runFor(100);await sleep(15);}}
  async frame(){
    if(this.opts.clock!==false) await this.page.clock.runFor(1000/FPS); else await sleep(1000/FPS);
    const r=await this.cdp.send('Page.captureScreenshot',{format:'jpeg',quality:93,clip:{x:0,y:0,width:this.vp.width,height:this.vp.height,scale:1920/this.vp.width}});
    fs.writeFileSync(path.join(this.dir,String(this.n++).padStart(6,'0')+'.jpg'),Buffer.from(r.data,'base64'));
  }
  async hold(sec,fn){const n=Math.round(sec*FPS);for(let i=0;i<n;i++){if(fn)await fn(i/n,i);await this.frame();}}
  async caption(title,sub,big){await this.page.evaluate(([a,b,c])=>window.__mgCaption(a,b,c),[title,sub,!!big]);
    await this.hold(.35,async k=>this.page.evaluate(o=>window.__mgCapOpacity(o),ease(k)));await this.page.evaluate(()=>window.__mgCapOpacity(1));}
  async uncaption(){await this.hold(.3,async k=>this.page.evaluate(o=>window.__mgCapOpacity(o),1-ease(k)));await this.page.evaluate(()=>window.__mgCapOpacity(0));}
  async cursor(x,y,down){this.cx=x;this.cy=y;await this.page.mouse.move(x,y);await this.page.evaluate(([x,y,d])=>window.__mgCursor(x,y,d),[x,y,!!down]);}
  async moveTo(x,y,sec=.8){const x0=this.cx<0?x+200:this.cx,y0=this.cy<0?y+150:this.cy;
    await this.hold(sec,async k=>{const e=ease(k);await this.cursor(x0+(x-x0)*e,y0+(y-y0)*e);});await this.cursor(x,y);}
  async box(sel){const bb=await this.page.locator(sel).first().boundingBox();if(!bb)throw new Error('no box '+sel);return {x:bb.x+bb.width/2,y:bb.y+bb.height/2,bb};}
  async clickSel(sel,sec=.8,{dx=0,dy=0}={}){const {x,y}=await this.box(sel);await this.moveTo(x+dx,y+dy,sec);await this.press();}
  async press(){await this.page.mouse.down();await this.cursor(this.cx,this.cy,true);await this.hold(.12);await this.page.mouse.up();await this.hold(.15);await this.cursor(this.cx,this.cy,false);}
  async drag(x1,y1,x2,y2,sec=1.2){await this.moveTo(x1,y1,.7);await this.page.mouse.down();await this.cursor(x1,y1,true);await this.hold(.2);
    await this.hold(sec,async k=>{const e=ease(k);const x=x1+(x2-x1)*e,y=y1+(y2-y1)*e;this.cx=x;this.cy=y;await this.page.mouse.move(x,y);await this.page.evaluate(([x,y])=>window.__mgCursor(x,y,true),[x,y]);});
    await this.hold(.3);await this.page.mouse.up();await this.cursor(x2,y2,false);}
  // Fit the main map to every agent/task/target position seen in the replay (or the live state)
  async fit(pad={top:60,left:40,bottom:60,right:40},zoomDelta=0,frac=[0,1],keys=['agents','tasks','targets']){
    await this.page.evaluate(([pad,zd,frac,keys])=>{const m=window.__mgMaps[0];const B=new google.maps.LatLngBounds();
      const fr=window.MGReplay&&MGReplay.full.length?MGReplay.full:[];const n=fr.length;
      const add=s=>{keys.forEach(k=>(s[k]||[]).forEach(o=>{if(o.coordinate&&(k!=='targets'||o.visible!==undefined))B.extend(new google.maps.LatLng(o.coordinate.latitude,o.coordinate.longitude));}));};
      if(n){for(let i=Math.floor(n*frac[0]);i<Math.min(n,Math.ceil(n*frac[1]));i+=Math.max(1,Math.floor(n/60)))add(fr[i]);}
      m.fitBounds(B,pad); if(zd) google.maps.event.addListenerOnce(m,'idle',()=>m.setZoom(m.getZoom()+zd));},[pad,zoomDelta,frac,keys]);
    await this.settle(1500);
  }
  async zoom(z,lat,lng){await this.page.evaluate(([z,lat,lng])=>{const m=window.__mgMaps[0];if(lat!=null)m.setCenter({lat,lng});if(z)m.setZoom(z);},[z,lat,lng]);await this.settle(1200);}
  hideCursor(){return this.cursor(-60,-60);}
  encode(out){execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(this.dir,'%06d.jpg'),'-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p',out]);return out;}
  async close(){await this.ctx.close();}
}
// replay helpers
async function replay(b,name,id,{speed=1,seek=null,opts={}}={}){
  const s=await new Scene(b,name,opts).init();
  await s.goto('sandbox.html?replay='+id);
  await s.page.click('text=Start Scenario',{timeout:5000}).catch(()=>{});
  await s.settle(600);
  await s.overlay();
  await s.page.evaluate(([sp,sk])=>{MGReplay.speed=sp;if(sk!==null)MGReplay.playT=sk;},[speed,seek]);
  await s.settle(1500);
  return s;
}
function post(p,data={}){return fetch(BASE+p,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});}
module.exports={browser,Scene,replay,sleep,ease,post,FPS,BASE,OUT};
