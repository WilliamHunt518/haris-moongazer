// Captionless loops and stills for the website.
const {browser,replay,Scene,OUT:BASEOUT}=require('./scene');
const fs=require('fs');
const OUT=BASEOUT+'/site';fs.mkdirSync(OUT,{recursive:true});
const F={all:[{top:20,left:20,bottom:120,right:20},0,[0,1]],
  heat:[{top:20,left:20,bottom:60,right:260},0,[0,.3]],
  ag:[{top:20,left:260,bottom:120,right:20},0,[0,.6],['agents']],
  at:[{top:30,left:30,bottom:150,right:30},0,[0,.6],['agents','targets']]};
const CLIPS={
  pfm_live:['pfm-live-prism',6,20,8,'all'], pfm_placebo:['pfm-placebo',6,20,8,'all'], pfm_none:['pfm-no-prediction',6,20,8,'all'],
  tri:['triage',3,5,10,'at'], scout:['scouting',2,4,8,'at'],
  heat_lens:['heatmap-lens',4,4,8,'heat'], heat_teams:['heatmap-teams',4,4,8,'all'], heat_study:['heatmap',2,3,8,'all'],
  prog_c:['programmer-limited-comms',3,3,8,'ag'], prog_u:['programmer-full-comms',3,3,8,'ag'],
};
async function clip(b,name){const [id,sp,sk,dur,f]=CLIPS[name];const s=await replay(b,'clip_'+name,id,{speed:sp,seek:sk});
  await s.fit(...F[f]);await s.hold(dur);s.encode(OUT+'/'+name+'_raw.mp4');await s.close();}
async function launch(b){const s=await new Scene(b,'launchstill',{viewport:{width:1200,height:800}}).init();await s.goto('');await s.page.screenshot({path:OUT+'/launch.png'});await s.close();}
(async()=>{const b=await browser();for(const n of process.argv.slice(2)){
  if(n==='launch')await launch(b);else await clip(b,n);console.log('done',n);}
 await b.close();})().catch(e=>{console.error(e);process.exit(1)});
