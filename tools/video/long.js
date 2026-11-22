// Long (~2.5 min) feature tour.
const {browser,replay,Scene,sleep,OUT}=require('./scene');
const PREVIEW=process.env.PREVIEW;
const C=(s,a,b)=>s.caption(a,b,false);
const SCENES={
  launch:async b=>{const s=await new Scene(b,'long_launch').init();await s.goto('');await s.overlay();
    if(PREVIEW)return s;
    await s.caption('Start from a showcase','Each tile is a feature from published human–swarm research');
    await s.hold(1.2);
    await s.moveTo(420,330,1);await s.hold(.6);
    await s.hold(4,async k=>{await s.page.evaluate(y=>window.scrollTo(0,y),Math.round(520*((k<.5)?2*k*k:1-Math.pow(-2*k+2,2)/2)));});
    await s.moveTo(880,420,1);await s.hold(1.5);await s.uncaption();return s;},
  pfm:async b=>{const s=await replay(b,'long_pfm','pfm-live-prism',{speed:4,seek:20});
    await s.fit({top:20,left:20,bottom:150,right:20});
    if(PREVIEW)return s;
    await C(s,'Predictive fleet management','While the mission runs, the PRISM model checker estimates when it will finish');
    await s.hold(1);await s.moveTo(1075,200,1.2);await s.hold(3.5);
    await s.uncaption();
        await C(s,'What if you add or remove a drone?','The buttons show the predicted change in finish time and cost before you press them');
        await s.page.evaluate(()=>{let e=document.querySelector('#add_agent');while(e&&!(e.scrollHeight>e.clientHeight+5&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)))e=e.parentElement;window.__sc=e||document.scrollingElement;});
    await s.hold(1.5,async k=>s.page.evaluate(v=>{window.__sc.scrollTop=v;},Math.round(330*k)));
    const {x,y}=await s.box('#add_agent');await s.moveTo(x,y,1);await s.hold(2.5);
    const r=await s.box('#remove_agent');await s.moveTo(r.x,r.y,.8);await s.hold(2.5);
    await s.uncaption();
    await C(s,'Three study conditions, one file each','Live prediction, a placebo predictor, or none');await s.hold(3);return s;},
  lens:async b=>{const s=await replay(b,'long_lens','lenses',{speed:1.5,seek:3});
    await s.fit({top:20,left:300,bottom:120,right:20},0,[0,.18],['agents']);
    if(PREVIEW)return s;
    await C(s,'Operator lenses','Overlays the experimenter can lock on or off, or hand to the operator');
    await s.hold(1.5);
    await s.clickSel('#ranges_toggle',1);await s.hold(2.2);
    await s.clickSel('#uncertainties_toggle',.7);await s.hold(1.8);
    await s.clickSel('#ranges_toggle',.7);await s.hold(1);
    await s.uncaption();
    await C(s,'Explored area and hazards','Built up live from where the drones have flown');
    await s.hold(1,async k=>{});
    await s.page.evaluate(()=>{MGReplay.speed=5});
    await s.hideCursor();await s.hold(5);return s;},
  triage:async b=>{const s=await replay(b,'long_triage','triage',{speed:3,seek:5});
    await s.fit({top:30,left:30,bottom:150,right:30},0,[0,1],['agents','targets']);
    if(PREVIEW)return s;
    await C(s,'Scan review and triage','Drones scan possible casualties, and the operator rates each find high, medium or low');
    await s.hold(6);await s.uncaption();
    await C(s,'People judge, robots act','Programmed ground vehicles serve the triaged targets in priority order');
    await s.hold(7);return s;},
  scout:async b=>{const s=await replay(b,'long_scout','scouting',{speed:2,seek:4});
    await s.fit({top:20,left:20,bottom:170,right:20},0,[0,.5],['agents','targets']);
    await s.page.evaluate(()=>window.__mgCapTop=1);
    if(PREVIEW)return s;
    await C(s,'Progressive-resolution scouting','Images sharpen as a drone closes in; classify early to free it for the next target');
    await s.hold(6);await s.uncaption();
    await C(s,'Human–swarm teaming against the clock','Scored on correct finds per minute times accuracy (AAMAS 2023 best demo)');
    await s.hold(6);return s;},
  heat:async b=>{const s=await replay(b,'long_heat','heatmap-lens',{speed:3,seek:4});
    await s.fit({top:20,left:20,bottom:60,right:260},0,[0,.3]);
    if(PREVIEW)return s;
    await C(s,'Adaptive abstraction','At high workload, drones and tasks become team clusters and mission zones');
    await s.hold(4);await s.uncaption();
    await C(s,'The allocation lens','Each team has a colour and letter; drag one onto a mission, and each mission shows which tasks are covered');
    await s.hold(4);
    await s.page.evaluate(()=>{MGReplay.speed=5});await s.hold(4);return s;},
  prog:async b=>{const s=await replay(b,'long_prog','programmer-limited-comms',{speed:3,seek:3});
    await s.fit({top:20,left:300,bottom:140,right:20},0,[0,.6],['agents']);
    if(PREVIEW)return s;
    await C(s,'The drone programmer','Each drone runs its own policy with local knowledge only, and reports through the hub when in range');
    await s.hold(8);return s;},
};
(async()=>{const name=process.argv[2];const b=await browser();const s=await SCENES[name](b);
 if(PREVIEW){await s.page.screenshot({path:OUT+'/pl_'+name+'.png'});}
 else s.encode(OUT+'/seg_long_'+name+'.mp4');
 await b.close();})().catch(e=>{console.error(process.argv[2],e);process.exit(1)});
