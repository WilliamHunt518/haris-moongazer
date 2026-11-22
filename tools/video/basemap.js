// Injected before page scripts: swap Google's dev-mode (watermarked) tiles for a plain drawn basemap.
(function(){
  function install(){
    const g=window.google; if(!g||!g.maps||!g.maps.Map||g.maps.Map.__mg) return false;
    function Plain(){this.tileSize=new g.maps.Size(256,256);}
    Plain.prototype.maxZoom=22; Plain.prototype.minZoom=0; Plain.prototype.name='Plain';
    Plain.prototype.getTile=function(c,z,doc){
      const cv=doc.createElement('canvas'); cv.width=256; cv.height=256; const x=cv.getContext('2d');
      x.fillStyle='#e6ecf0'; x.fillRect(0,0,256,256);
      x.strokeStyle='rgba(19,61,91,0.06)'; x.lineWidth=1;
      for(let i=32;i<256;i+=32){x.beginPath();x.moveTo(i+.5,0);x.lineTo(i+.5,256);x.stroke();x.beginPath();x.moveTo(0,i+.5);x.lineTo(256,i+.5);x.stroke();}
      x.strokeStyle='rgba(19,61,91,0.13)';x.beginPath();x.moveTo(.5,0);x.lineTo(.5,256);x.moveTo(0,.5);x.lineTo(256,.5);x.stroke();
      return cv;
    };
    const Orig=g.maps.Map;
    function M(el,opts){ const m=new Orig(el,opts); m.mapTypes.set('mgplain',new Plain()); m.setMapTypeId('mgplain');
      const so=m.setMapTypeId.bind(m); m.setMapTypeId=function(){so('mgplain')}; (window.__mgMaps=window.__mgMaps||[]).push(m); return m; }
    M.prototype=Orig.prototype; Object.setPrototypeOf(M,Orig); M.__mg=true; g.maps.Map=M; return true;
  }
  const iv=setInterval(()=>{ if(install()) clearInterval(iv); },1);
  const css=document.createElement('style');
  css.textContent='div:has(> div > .dismissButton), div:has(> .dismissButton){display:none!important}';
  document.addEventListener('DOMContentLoaded',()=>document.head.appendChild(css));
})();
