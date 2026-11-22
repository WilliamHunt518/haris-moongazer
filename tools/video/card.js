const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1.5});
const cards=JSON.parse(process.argv[2]);
for(const c of cards){const q=new URLSearchParams(c.q).toString();await p.goto('file://'+__dirname+'/cards/card.html?'+q);await p.waitForTimeout(300);await p.screenshot({path:(process.env.HARIS_VIDEO_OUT||__dirname+'/out')+'/'+c.name+'.png'});}
await b.close();})();
