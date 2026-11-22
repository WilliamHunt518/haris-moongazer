// Short (~25 s) high-level video: three scenes of execution with big captions.
const {browser,replay,OUT}=require('./scene');
const PREVIEW=process.env.PREVIEW;
const SCENES={
  heat:async b=>{const s=await replay(b,'short_heat','heatmap-lens',{speed:5,seek:4});
    await s.fit({top:20,left:20,bottom:60,right:260},0,[0,.3]);
    if(PREVIEW)return s;
    await s.hold(.3);await s.caption('Command teams, not drones','Drag a drone team onto a mission',true);await s.hold(6.2);return s;},
  pfm:async b=>{const s=await replay(b,'short_pfm','pfm-live-prism',{speed:8,seek:20});
    await s.fit({top:20,left:20,bottom:120,right:20},0,[0,1]);
    if(PREVIEW)return s;
    await s.hold(.3);await s.caption('Predict before you act','Live PRISM estimates of finish time and cost',true);await s.hold(6.2);return s;},
  scout:async b=>{const s=await replay(b,'short_scout','scouting',{speed:3,seek:4});
    await s.fit({top:20,left:20,bottom:150,right:20},0,[0,.5],['agents','targets']);
    if(PREVIEW)return s;
    await s.page.evaluate(()=>window.__mgCapTop=1);await s.hold(.3);await s.caption('Team up against the clock','Scouts classify casualties as images sharpen',true);await s.hold(6.2);return s;},
};
(async()=>{const name=process.argv[2];const b=await browser();const s=await SCENES[name](b);
 if(PREVIEW){await s.page.screenshot({path:OUT+'/pv_'+name+'.png'});}
 else s.encode(OUT+'/seg_short_'+name+'.mp4');
 await b.close();})();
