/* ===== App instalable (PWA) ===== */
let installEvt=null;
const isStandalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function renderInstall(){const show=!isStandalone()&&(!!installEvt||isIOS());document.querySelectorAll('[data-install]').forEach(b=>b.hidden=!show)}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;renderInstall()});
window.addEventListener('appinstalled',()=>{installEvt=null;renderInstall();toast('📲 ¡App instalada! Ya la tenés en tu pantalla de inicio.')});
document.addEventListener('click',async e=>{
  if(!e.target.closest('[data-install]'))return;
  if(installEvt){installEvt.prompt();const r=await installEvt.userChoice.catch(()=>null);if(r?.outcome==='accepted')installEvt=null;renderInstall();return}
  $('#installModal').hidden=false;
});
if('serviceWorker' in navigator&&isSecureContext)navigator.serviceWorker.register('sw.js').catch(()=>{});
renderInstall();

/* ===== Modo celular ===== */
// Pestañas: ícono arriba y nombre corto abajo (se ve como barra de app en pantallas chicas).
(function(){const IC={inicio:['🏠','Inicio'],trabajos:['📋','Trabajos'],oficina:['🏢','Oficina'],entregas:['📦','Entregas'],chat:['💬','Chat'],admin:['👑','Admin']};
  document.querySelectorAll('nav.tabs [data-tab]').forEach(b=>{const m=IC[b.dataset.tab];if(!m||b.querySelector('.ti'))return;
    const count=b.querySelector('.count');const full=[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/^[^\p{L}]+/u,'').trim();
    [...b.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());
    b.insertAdjacentHTML('afterbegin',`<span class="ti" aria-hidden="true">${m[0]}</span><span class="tl" data-full="${esc(full)}">${esc(full)}</span>`);
    const tl=b.querySelector('.tl');const fit=()=>{tl.textContent=matchMedia('(max-width:640px)').matches?m[1]:tl.dataset.full};fit();matchMedia('(max-width:640px)').addEventListener('change',fit);
    if(count)b.appendChild(count)});
})();
// En pantallas táctiles no hay clic derecho: mantener apretado un muñeco abre sus opciones.
if(matchMedia('(pointer:coarse)').matches){
  const h=document.querySelector('.ohint');if(h)h.textContent='Tocá para hablar · mantené apretado para más opciones · arrastralos para moverlos';
  document.querySelectorAll('#tab-oficina p.muted').forEach(p=>{if(/clic derecho/i.test(p.textContent))p.textContent='Tocá un muñeco para hablar, mantenelo apretado para más opciones (sentarse, café, bailar, siesta…) y arrastralo para moverlo. Cuando trabajan en un paso, se sientan en su escritorio.'});
}
let lpT=null,lpAt=null;
document.addEventListener('pointerdown',e=>{const el=e.target.closest('.agent');if(!el||e.pointerType==='mouse')return;
  const id=el.id.replace(/^ag-/,'');lpAt={x:e.clientX,y:e.clientY};clearTimeout(lpT);
  lpT=setTimeout(()=>{lpT=null;if(!actors[id]||actors[id].pd?.drag)return;actors[id].pd=null;if($('#ctx').hidden)openCtx(id,lpAt.x,lpAt.y);navigator.vibrate?.(12)},550)},true);
document.addEventListener('pointermove',e=>{if(lpT&&lpAt&&Math.hypot(e.clientX-lpAt.x,e.clientY-lpAt.y)>8){clearTimeout(lpT);lpT=null}},true);
['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>{clearTimeout(lpT);lpT=null},true));
