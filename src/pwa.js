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
