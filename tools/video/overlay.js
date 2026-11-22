window.__mgOverlay = function(css){
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  const cap=document.createElement('div'); cap.id='mgcap'; cap.style.opacity=0; document.body.appendChild(cap);
  const cur=document.createElement('div'); cur.id='mgcur';
  cur.innerHTML='<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.5 L13.4 20.2 L10.4 13.7 L16.5 13.4 Z" fill="#fff" stroke="#0d2a40" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
};
window.__mgCaption=function(title,sub,big){const c=document.getElementById('mgcap'); if(!title){c.style.opacity=0;return;}
  c.className=(big?'big ':'')+(window.__mgCapTop?'top':''); c.innerHTML='<b>'+title+'</b>'+(sub?'<span>'+sub+'</span>':''); };
window.__mgCapOpacity=function(o){document.getElementById('mgcap').style.opacity=o;};
window.__mgCursor=function(x,y,down){const c=document.getElementById('mgcur'); c.style.left=x+'px'; c.style.top=y+'px'; c.classList.toggle('down',!!down);};
