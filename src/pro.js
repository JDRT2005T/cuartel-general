/* ===== Mejorar a Pro con Mercado Pago (lo hace cada usuario solo) ===== */
let proInfo=null;
const fmtLocal=(v,m)=>{try{return Number(v).toLocaleString('es',{style:'currency',currency:m,maximumFractionDigits:Number(v)%1?2:0})}catch(_){return m+' '+v}};
async function loadProInfo(){try{proInfo=await fn('pagos',{action:'info'})}catch(e){proInfo=null}renderUpgradeBtn();return proInfo}
function canUpgrade(){return perfil&&perfil.rol!=='admin'&&perfil.plan!=='pro'&&proInfo?.disponible}
function renderUpgradeBtn(){
  const b=$('#upBtn');if(!b)return;b.hidden=!canUpgrade();
  if(canUpgrade())b.textContent='⭐ Mejorar a Pro';
}
function openUpgrade(){
  if(!proInfo?.disponible){toast('Los pagos todavía no están activados. Avisale al administrador.');return}
  const precio=fmtLocal(proInfo.precio_local,proInfo.moneda);
  $('#upBody').innerHTML=`<div class="upcard">
    <p class="eyebrow">Plan Pro</p><div class="upprice">${esc(precio)} <small>/ mes</small></div>
    <ul class="upfeat"><li>🧠 <b>Motor Experto</b> (Claude Opus 5): el más potente, para trabajos difíciles, sitios y documentos largos</li><li>⚡ Rápido y ⚖️ Normal, como siempre</li><li>📎 Todo lo que ya tenés: archivos Word, PDF, Excel, adjuntos y tu equipo</li></ul>
    <p class="muted" style="font-size:13.5px;margin:0">Pagás una vez por mes con <b>Nequi, PSE, Bancolombia o tarjeta</b>. No se renueva solo: cuando se termina el mes, volvés a Gratis y podés pagar otro mes cuando quieras. Si ya sos Pro, el mes se suma.</p>
    ${proInfo.prueba?'<p class="muted" style="font-size:12.5px;margin:0">🧪 Modo prueba: no se cobra plata real.</p>':''}
    <button class="btn primary upgo" id="upGo">Pagar ${esc(precio)}</button>
    <small class="muted">Te llevamos a <b>Wompi</b> (de Bancolombia) para pagar de forma segura. Al terminar volvés acá y tu Pro se activa solo.</small></div>`;
  $('#upModal').hidden=false;
  $('#upGo').onclick=async()=>{const b=$('#upGo');b.disabled=true;b.innerHTML='<span class="spin"></span>Abriendo Wompi…';
    try{const r=await fn('pagos',{action:'checkout'});location.href=r.url}catch(e){toast(e.message);b.disabled=false;b.textContent=`Pagar ${precio}`}};
}
// Al volver de Wompi llega ?id=<transacción>: el servidor le pregunta a Wompi y activa el Pro si está aprobado.
async function handlePagoReturn(){
  const q=new URLSearchParams(location.search),id=q.get('id');if(!id)return;
  history.replaceState(null,'',location.pathname);
  notify({icon:'💳',title:'Confirmando tu pago…',body:'Le estamos preguntando a Wompi. Tarda unos segundos.',auto:true});
  for(let i=0;i<20;i++){
    let r=null;try{r=await fn('pagos',{action:'confirmar',id})}catch(e){if(i>=3){toast(e.message);return}}
    if(r?.estado==='approved'){await pollPro(30000,2000);return}
    if(r&&['declined','voided','error','monto_incorrecto'].includes(r.estado)){notify({icon:'⚠️',c:'#C53B3B',title:'El pago no se aprobó',body:'No se te cobró el plan. Podés intentar de nuevo desde ⭐ Mejorar a Pro, con otro medio de pago.'});return}
    if(r?.estado==='pending'&&i===2)notify({icon:'⏳',title:'Tu pago está en proceso',body:'Algunos medios (como PSE) tardan un poco. Cuando se apruebe, tu Pro se activa solo.',big:true});
    await new Promise(ok=>setTimeout(ok,i<5?3000:15000));
  }
  pollPro(20*60*1000,20000);
}
async function pollPro(maxMs,every){
  const t0=Date.now();
  while(Date.now()-t0<maxMs){
    const{data}=await sbc.rpc('cg_mi_consumo');const u=data?.[0];
    if(u?.plan==='pro'){perfil={...perfil,plan:'pro',pro_hasta:u.pro_hasta,limite:Number(u.limite_usd)};renderAccountPill();applyPlanUI();renderUpgradeBtn();
      notify({icon:'⭐',title:'¡Ya sos Pro!',body:`Tenés el motor Experto${u.pro_hasta?' hasta el '+new Date(u.pro_hasta).toLocaleDateString('es',{day:'numeric',month:'long'}):''}. ¡Gracias!`,big:true});
      AGENTS.forEach(a=>{say(a.id,pick(['¡Bienvenido a Pro! ⭐','¡Vamos con todo! 🚀','¡Gracias! 🙌']),3500);if(actors[a.id]&&!st.busy[a.id]){setPose(a.id,'hop');setTimeout(()=>{if(actors[a.id]?.pose==='hop')setPose(a.id,null)},1400)}});return}
    await new Promise(r=>setTimeout(r,every));
  }
}
const canUpgradeExtend=()=>perfil&&perfil.rol!=='admin'&&proInfo?.disponible;
$('#upBtn').onclick=openUpgrade;
document.addEventListener('click',e=>{if(e.target.closest('[data-upgrade]')){$('#acct').hidden=true;openUpgrade()}});
