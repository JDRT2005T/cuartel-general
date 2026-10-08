/* ===== Panel de administración (pantalla propia) ===== */
let admTab='resumen',admUsers=[];
const usd=v=>{v=Number(v)||0;const a=Math.abs(v);if(a<0.0005)return'US$ 0';return(v<0?'−':'')+'US$ '+(a>=1000?a.toLocaleString('es',{maximumFractionDigits:0}):a>=10?a.toFixed(0):a>=1?a.toFixed(2):a.toFixed(a>=0.01?2:3))};
const MOTOR={'claude-haiku-4-5':'⚡ Rápido (Haiku)','claude-sonnet-5':'⚖️ Normal (Sonnet)','claude-opus-5':'🧠 Experto (Opus)'};
const motorName=m=>MOTOR[m]||Object.entries(MOTOR).find(([k])=>String(m).startsWith(k))?.[1]||m;
const dayLabel=d=>new Date(d+'T12:00').toLocaleDateString('es',{day:'numeric',month:'short'});
const monthLabel=m=>new Date(m+'-15T12:00').toLocaleDateString('es',{month:'short'}).replace('.','');

const _goBase=go;
go=function(tab){
  if(tab==='admin'){
    if(perfil?.rol!=='admin')return;
    ['inicio','trabajos','oficina','entregas','chat'].forEach(t=>$('#tab-'+t).hidden=true);
    $('#tab-admin').hidden=false;document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab==='admin'));
    st.tab='admin';adminTab(admTab);window.scrollTo({top:0,behavior:'smooth'});return;
  }
  $('#tab-admin').hidden=true;_goBase(tab);
};
openAdmin=()=>{admTab='config';go('admin')};
$('#adminBtn').onclick=()=>go('admin');
$('#admSeg').onclick=e=>{const b=e.target.closest('[data-adm]');if(b)adminTab(b.dataset.adm)};

async function adminTab(t){
  admTab=t;segOn('#admSeg','adm',t);const box=$('#admBody');
  box.innerHTML='<p class="muted"><span class="spin"></span>Cargando…</p>';
  try{
    if(t==='resumen')await admResumen(box);
    else if(t==='usuarios'||t==='invitaciones')await admClassic(box,t);
    else if(t==='config')await admConfig(box);
    else if(t==='pagos')await admPagos(box);
    else if(t==='avisos')await admAvisos(box);
  }catch(e){box.innerHTML=`<div class="empty"><b>No pude cargar esta sección</b>${esc(e.message||String(e))}<div style="margin-top:12px"><button class="btn sm" onclick="adminTab('${t}')">Reintentar</button></div></div>`}
}

/* --- Gráficos SVG (columnas y barras) con tooltip --- */
const charts={};
function niceScale(max,ticks=4){
  if(!(max>0))return{max:1,step:.25};
  const raw=max/ticks,mag=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/mag;
  const step=(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;
  return{max:Math.ceil(max/step)*step,step};
}
function roundTop(x,y,w,h,r){r=Math.min(r,w/2,h);if(h<=0)return'';return`M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`}
function colChart(id,{rows,labels,series,fmt,tip,every=1,endLabels=false}){
  const W=680,H=230,L=56,R=12,T=14,B=30,pw=W-L-R,ph=H-T-B;
  const max=Math.max(0,...rows.flatMap(r=>series.map(s=>r[s.key]||0)));const sc=niceScale(max);
  const band=pw/rows.length,ns=series.length,bw=Math.min(24,(band*0.7-(ns-1)*2)/ns);
  const yv=v=>T+ph-(v/sc.max)*ph;
  let g='';
  for(let v=0;v<=sc.max+1e-9;v+=sc.step){const y=yv(v);g+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="${v===0?'ax':'gr'}"/><text x="${L-8}" y="${y+4}" text-anchor="end" class="tk">${esc(fmt(v))}</text>`}
  let bars='',hits='',xl='',lab='';
  rows.forEach((r,i)=>{
    const cx=L+band*i+band/2,gw=ns*bw+(ns-1)*2;
    series.forEach((s,j)=>{const v=r[s.key]||0,x=cx-gw/2+j*(bw+2),y=yv(v);bars+=`<path d="${roundTop(x,y,bw,T+ph-y,4)}" fill="var(${s.color})"/>`;
      if(endLabels&&i===rows.length-1&&v>0)lab+=`<text x="${x+bw/2}" y="${y-6}" text-anchor="middle" class="vl">${esc(fmt(v))}</text>`});
    hits+=`<rect x="${L+band*i}" y="${T}" width="${band}" height="${ph}" fill="transparent" data-i="${i}"/>`;
    if(i%every===0||i===rows.length-1)xl+=`<text x="${cx}" y="${H-10}" text-anchor="middle" class="tk">${esc(labels[i])}</text>`;
  });
  charts[id]={rows,tip};
  return`<div class="chartwrap" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(id)}">${g}${bars}${lab}${xl}<g class="hits">${hits}</g></svg><div class="ctip" hidden></div></div>`;
}
function hbarChart(id,{rows,label,value,fmt,tip}){
  const W=680,rowH=34,L=170,R=80,H=rows.length*rowH+8,pw=W-L-R;
  const max=Math.max(...rows.map(value),0)||1;let s='';
  rows.forEach((r,i)=>{const v=value(r),w=Math.max(2,v/max*pw),y=4+i*rowH+(rowH-20)/2;
    s+=`<text x="${L-10}" y="${y+14}" text-anchor="end" class="lb">${esc(label(r))}</text><path d="${roundRight(L,y,w,20,4)}" fill="var(--s1)"/><text x="${L+w+8}" y="${y+14}" class="vl">${esc(fmt(v))}</text><rect x="0" y="${4+i*rowH}" width="${W}" height="${rowH}" fill="transparent" data-i="${i}"/>`});
  charts[id]={rows,tip};
  return`<div class="chartwrap" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(id)}"><line x1="${L}" x2="${L}" y1="0" y2="${H}" class="ax"/>${s}</svg><div class="ctip" hidden></div></div>`;
}
function roundRight(x,y,w,h,r){r=Math.min(r,h/2,w);return`M${x},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h-r}Q${x+w},${y+h} ${x+w-r},${y+h}H${x}Z`}
document.addEventListener('mousemove',e=>{
  const wrap=e.target.closest?.('.chartwrap');document.querySelectorAll('.chartwrap .ctip').forEach(t=>{if(!wrap||!wrap.contains(t))t.hidden=true});
  if(!wrap)return;const hit=e.target.closest('[data-i]'),tipEl=wrap.querySelector('.ctip');if(!hit){tipEl.hidden=true;return}
  const c=charts[wrap.dataset.chart];if(!c)return;tipEl.innerHTML=c.tip(c.rows[+hit.dataset.i]);tipEl.hidden=false;
  const r=wrap.getBoundingClientRect();let x=e.clientX-r.left+14,y=e.clientY-r.top+14;
  if(x+tipEl.offsetWidth>r.width)x=e.clientX-r.left-tipEl.offsetWidth-14;tipEl.style.left=x+'px';tipEl.style.top=y+'px';
});

async function admResumen(box){
  const d=await fn('admin',{action:'dashboard'}),t=d.tot,gan=t.cobrado_mes-t.gastado_mes;
  const mesNom=new Date().toLocaleDateString('es',{month:'long'});
  box.innerHTML=`
  <div class="admhero">
    <div><p class="eyebrow">Ganancia de ${mesNom}</p><div class="hero ${gan<0?'neg':''}">${usd(gan)}</div>
      <p class="muted" style="margin:4px 0 0">${gan>=0?'▲ Ganando':'▼ Perdiendo'}: cobraste ${usd(t.cobrado_mes)} y la IA costó ${usd(t.gastado_mes)}.</p></div>
    <div class="admtiles">
      <div class="kpi"><span>Cobrado este mes</span><b>${usd(t.cobrado_mes)}</b></div>
      <div class="kpi"><span>Gastado en IA este mes</span><b>${usd(t.gastado_mes)}</b></div>
      <div class="kpi"><span>Usuarios activos (30 días)</span><b>${t.activos_30d} <small class="muted">de ${t.usuarios}</small></b></div>
      <div class="kpi"><span>Pedidos este mes</span><b>${t.pedidos_mes.toLocaleString('es')}</b></div>
    </div>
  </div>
  ${saldoCard(d.saldo)}
  <p class="muted admtotal">Desde el inicio: cobraste <b>${usd(t.cobrado_total)}</b> · la IA costó <b>${usd(t.gastado_total)}</b> · <b>${t.pro}</b> usuario${t.pro===1?'':'s'} Pro.</p>
  <div class="admgrid">
    <div class="card"><h3>Gasto en IA por día</h3><p class="csub">Últimos 30 días</p>
      ${colChart('Gasto en IA por día',{rows:d.dias,labels:d.dias.map(x=>dayLabel(x.dia)),series:[{key:'gastado',color:'--s1'}],fmt:usd,every:5,
        tip:r=>`<b>${dayLabel(r.dia)}</b><br>${usd(r.gastado)} · ${r.pedidos} pedido${r.pedidos===1?'':'s'}`})}
      <details class="tview"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>Día</th><th>Gastado</th><th>Pedidos</th></tr></thead><tbody>${d.dias.filter(x=>x.pedidos).map(x=>`<tr><td>${dayLabel(x.dia)}</td><td class="mono">${usd(x.gastado)}</td><td class="mono">${x.pedidos}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Sin pedidos todavía</td></tr>'}</tbody></table></details></div>
    <div class="card"><h3>Cobrado y gastado por mes</h3><p class="csub">Últimos 6 meses</p>
      <div class="legend"><span><i style="background:var(--s1)"></i>Cobrado</span><span><i style="background:var(--s2)"></i>Gastado en IA</span></div>
      ${colChart('Cobrado y gastado por mes',{rows:d.meses,labels:d.meses.map(x=>monthLabel(x.mes)),series:[{key:'cobrado',color:'--s1'},{key:'gastado',color:'--s2'}],fmt:usd,endLabels:true,
        tip:r=>`<b>${monthLabel(r.mes)}</b><br><i class="sw" style="background:var(--s1)"></i>Cobrado ${usd(r.cobrado)}<br><i class="sw" style="background:var(--s2)"></i>Gastado ${usd(r.gastado)}<br>Ganancia ${usd(r.cobrado-r.gastado)}`})}</div>
    <div class="card"><h3>Gasto por motor</h3><p class="csub">Este mes</p>
      ${d.motores.length?hbarChart('Gasto por motor',{rows:d.motores,label:r=>motorName(r.modelo),value:r=>r.gastado,fmt:usd,tip:r=>`<b>${esc(motorName(r.modelo))}</b><br>${usd(r.gastado)} · ${r.pedidos} pedidos`}):'<p class="muted">Todavía no hay pedidos este mes.</p>'}</div>
    <div class="card"><h3>Quién más usa la app</h3><p class="csub">Este mes</p>
      ${d.top.length?`<table class="tbl toptbl"><thead><tr><th>Usuario</th><th>Plan</th><th>Pedidos</th><th>Gastado</th></tr></thead><tbody>${(()=>{const mx=Math.max(...d.top.map(x=>x.gastado))||1;return d.top.map(x=>`<tr><td>${esc(x.nombre)}</td><td>${x.plan==='pro'?'⭐ Pro':'Gratis'}</td><td class="mono">${x.pedidos}</td><td><div class="ibar"><i style="width:${Math.max(3,x.gastado/mx*100)}%"></i><span class="mono">${usd(x.gastado)}</span></div></td></tr>`).join('')})()}</tbody></table>`:'<p class="muted">Todavía no hay pedidos este mes.</p>'}</div>
  </div>`;
}

/* Saldo en Anthropic: cuánto cargaste, cuánto se gastó desde ese día y cuánto queda */
const saldoBajo=s=>s&&(s.restante_usd<Math.max(2,s.cargado_usd*0.2));
function saldoCard(s){
  if(!s)return`<div class="card saldo"><h3>💰 Tu saldo en Anthropic</h3><p class="csub">Decime cuánto saldo tenés cargado en console.anthropic.com (Billing) y te aviso cuando se esté por acabar.</p>
    <div class="addstep"><input class="in mono" type="number" id="saldoIn" min="0" step="1" placeholder="Ej: 10" style="max-width:140px" aria-label="Saldo en US$"><button class="btn sm primary" data-saldo="fijar">Guardar saldo</button></div></div>`;
  const pct=s.cargado_usd>0?Math.max(0,Math.min(100,s.restante_usd/s.cargado_usd*100)):0,low=saldoBajo(s);
  return`<div class="card saldo"><div class="fh"><h3 style="margin:0">💰 Tu saldo en Anthropic</h3>${low?'<span class="warn">⚠️ Se está acabando</span>':''}</div>
    <div class="big ${low?'warn':''}">${usd(s.restante_usd)} <small class="muted" style="font-size:14px;font-weight:500">de ${usd(s.cargado_usd)}</small></div>
    <div class="meter ${low?'low':''}"><i style="width:${pct}%"></i></div>
    <p class="muted" style="margin:0;font-size:13.5px">Gastado desde el ${new Date(s.desde).toLocaleDateString('es',{day:'numeric',month:'short'})}: ${usd(s.gastado_usd)} · ritmo de ${usd(s.por_dia_usd)} por día${s.dias_restantes!=null?` · alcanza para unos <b>${Math.max(0,s.dias_restantes)} días</b>`:''}.${low?' Cargá saldo en console.anthropic.com → Billing para que la app no se corte.':''}</p>
    <div class="addstep"><input class="in mono" type="number" id="saldoIn" min="0" step="1" placeholder="US$" style="max-width:120px" aria-label="Monto en US$"><button class="btn sm primary" data-saldo="recarga">➕ Recargué este monto</button><button class="btn sm ghost" data-saldo="fijar" title="Arranca la cuenta de nuevo desde hoy con este saldo">Corregir saldo</button></div>
    <small class="muted">Es un cálculo con lo que gasta la app; el número exacto lo ves en console.anthropic.com.</small></div>`;
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-saldo]');if(!b)return;
  const v=+$('#saldoIn')?.value;if(!(v>=0)||$('#saldoIn').value===''){toast('Poné el monto en dólares');return}
  try{await fn('admin',{action:'set_saldo',monto_usd:v,modo:b.dataset.saldo});toast(b.dataset.saldo==='recarga'?'Recarga anotada':'Saldo guardado');adminTab('resumen');checkSaldo()}catch(err){toast(err.message)}});
// Aviso al administrador cuando entra y el saldo está bajo.
async function checkSaldo(){
  if(perfil?.rol!=='admin')return;
  try{const d=await fn('admin',{action:'dashboard'});document.getElementById('saldoAviso')?.remove();
    if(saldoBajo(d.saldo))$('#avisos').insertAdjacentHTML('afterbegin',`<div class="aviso t-importante" id="saldoAviso"><span class="aic">💰</span><div><b>Tu saldo en Anthropic se está acabando</b> <span class="atag">Solo vos lo ves</span><p>Quedan unos ${usd(d.saldo.restante_usd)}${d.saldo.dias_restantes!=null?` (≈ ${Math.max(0,d.saldo.dias_restantes)} días)`:''}. Cargá saldo en console.anthropic.com → Billing y anotalo en 👑 Admin.</p></div></div>`);
  }catch(e){}
}

/* Usuarios, invitaciones y configuración: reutiliza el panel anterior, una sección por pestaña */
async function admClassic(box,t){
  // renderAdmin (de app.js) arma las tres secciones en #adminBody; se arma en un contenedor oculto y se muestra solo la pedida.
  const tmp=document.createElement('div');tmp.id='adminBody';tmp.hidden=true;document.body.appendChild(tmp);
  try{await _renderAdminBase();const rows=[...tmp.querySelectorAll('.connrow')];const sec=rows[{config:0,usuarios:1,invitaciones:2}[t]];
    box.innerHTML='';if(sec){sec.classList.add('card');box.appendChild(sec)}
  }finally{tmp.remove()}
}
// Cuando una acción del panel pide "volver a dibujar", se recarga la pestaña actual.
const _renderAdminBase=renderAdmin;
renderAdmin=async function(){if(document.getElementById('adminBody'))return _renderAdminBase();return adminTab(admTab)};

/* Configuración: clave de Claude + cobros con Wompi (Colombia: Nequi, PSE, Bancolombia, tarjetas) */
async function admConfig(box){
  await admClassic(box,'config');
  const[w,lm]=await Promise.all([fn('admin',{action:'wompi_status'}),fn('admin',{action:'get_limites'})]);const c=w.config,L=lm.limites;
  const ganancia=c?.precio_usd!=null?Number(c.precio_usd)*0.96-L.pro:null;
  box.insertAdjacentHTML('beforeend',`<div class="card mpcard"><div class="fh"><h3 style="margin:0">📊 Límite de uso de IA por plan</h3><span class="state ok">✓ Automático</span></div>
    <p class="csub">Cada usuario recibe solo el límite de su plan: arranca en <b>Gratis</b>, al pagar el Pro sube a <b>Pro</b> y cuando se le vence vuelve a Gratis. El uso se reinicia el 1 de cada mes. Es lo máximo que cada uno le puede gastar a tu saldo de Claude.</p>
    <div class="payform" style="grid-template-columns:1fr 1fr">
      <label>Gratis (US$ por mes)<input class="in mono" type="number" id="limG" min="0" max="1000" step="0.5" value="${L.gratis}"></label>
      <label>⭐ Pro (US$ por mes)<input class="in mono" type="number" id="limP" min="0" max="1000" step="0.5" value="${L.pro}"></label></div>
    <div class="crow" style="justify-content:space-between"><small class="muted" id="limNote"></small><button class="btn primary" id="limSave">Guardar límites</button></div></div>`);
  const limNote=()=>{const p=+$('#limP').value,g=ganancia==null?null:Number(c.precio_usd)*0.96-p;
    $('#limNote').innerHTML=g==null?'':g>=0?`Si un Pro usa todo, igual te quedan unos <b>${usd(g)}</b> por mes (después de la comisión de Wompi).`:`<b style="color:var(--bad)">⚠️ Con este límite un Pro que use todo te hace perder ${usd(-g)} por mes.</b> Bajalo o subí el precio.`};
  limNote();$('#limP').oninput=limNote;
  $('#limSave').onclick=async()=>{const b=$('#limSave');b.disabled=true;
    try{await fn('admin',{action:'set_limites',gratis:+$('#limG').value,pro:+$('#limP').value});toast('Límites guardados: ya aplican a todos 📊')}catch(e){toast(e.message)}b.disabled=false};
  box.insertAdjacentHTML('beforeend',`<div class="card mpcard"><div class="fh"><h3 style="margin:0">💳 Cobros con Wompi</h3>${w.configurado?(c.prueba?'<span class="state">🧪 Modo prueba</span>':'<span class="state ok">✓ Cobrando de verdad</span>'):'<span class="state">Sin conectar</span>'}</div>
    <p class="csub">Tus usuarios tocan <b>⭐ Mejorar a Pro</b>, pagan con Nequi, PSE, Bancolombia o tarjeta y el Pro se les activa solo. Vos lo ves en 💵 Pagos y en el Resumen.</p>
    ${w.configurado?`<dl><dt>Comercio</dt><dd>${esc(c.comercio||'—')}</dd><dt>Precio del Pro</dt><dd><b>${esc(fmtLocal(c.precio_local,'COP'))}</b> por mes · cuenta como ${usd(c.precio_usd)} en tus gráficos</dd>${w.pendientes?`<dt>Pendientes</dt><dd>${w.pendientes} pago${w.pendientes===1?'':'s'} sin terminar (pueden ser pagos abandonados)</dd>`:''}</dl>`:''}
    <details class="tview" ${w.configurado?'':'open'}><summary>Cómo conseguir las llaves de Wompi</summary>
    <ol class="ghsteps"><li>Entrá a <b>comercios.wompi.co</b> y creá tu cuenta de comercio (podés como persona natural).</li>
      <li>En el menú andá a <b>Desarrolladores</b> → <b>Llaves</b>. Arriba elegí el ambiente: <b>Sandbox</b> (prueba, sin plata real) o <b>Producción</b> (cobro real).</li>
      <li>Copiá la <b>Llave pública</b> (<code>pub_test_…</code>), el <b>Secreto de integridad</b> (<code>test_integrity_…</code>) y el <b>Secreto de eventos</b> (<code>test_events_…</code>). Los tres tienen que ser del mismo ambiente.</li>
      <li>En esa misma pantalla, en <b>URL de Eventos</b>, pegá esta dirección y guardá:<br><code class="wh">${esc(w.webhook)}</code> <button class="btn sm ghost" data-copy="${esc(w.webhook)}">Copiar</button></li>
      <li>Pegá las tres llaves acá abajo, poné el precio en pesos y tocá <b>Conectar Wompi</b>.</li></ol></details>
    <div class="payform" style="grid-template-columns:1fr 1fr 1fr">
      <label>Llave pública<input class="in" id="wPub" placeholder="pub_test_…" autocomplete="off" value=""></label>
      <label>Secreto de integridad<input class="in" type="password" id="wInt" placeholder="test_integrity_…" autocomplete="off"></label>
      <label>Secreto de eventos<input class="in" type="password" id="wEvt" placeholder="test_events_…" autocomplete="off"></label>
      <label>Precio del Pro (pesos)<input class="in mono" type="number" id="wPrecio" min="1500" step="500" value="${c?.precio_local??20000}"></label>
      <label>Equivale a (US$)<input class="in mono" type="number" id="wUsd" min="0.5" step="0.5" value="${c?.precio_usd??5}"></label>
    </div>
    <div class="crow" style="justify-content:space-between"><small class="muted">${w.configurado?'Para cambiar solo el precio, dejá las llaves vacías. ':''}Los secretos se guardan cifrados en tu Supabase. Nunca los pegues en un chat.</small><button class="btn primary" id="wSave">${w.configurado?'Guardar cambios':'Conectar Wompi'}</button></div></div>`);
  $('#wSave').onclick=async()=>{const b=$('#wSave');b.disabled=true;
    try{const r=await fn('admin',{action:'set_wompi',public_key:$('#wPub').value,integrity:$('#wInt').value,events:$('#wEvt').value,precio_local:+$('#wPrecio').value,precio_usd:+$('#wUsd').value});
      toast(r.config.prueba?'Wompi conectado en modo prueba 🧪':'¡Wompi conectado! Ya podés cobrar 💳');adminTab('config')}catch(e){toast(e.message);b.disabled=false}};
}

async function admPagos(box){
  const[us,pg]=await Promise.all([fn('admin',{action:'list_users'}),fn('admin',{action:'list_payments'})]);admUsers=us.rows;
  const total=pg.rows.reduce((s,p)=>s+p.monto_usd,0);
  box.innerHTML=`<details class="card manualpay"><summary><b>✍️ Registrar un pago manual</b> <span class="muted">(efectivo o transferencia; los pagos con Wompi se anotan solos)</span></summary><p class="csub">Cuando alguien te paga por fuera de la app, anotalo acá para que cuente en tus ganancias.</p>
    <div class="payform">
      <label>Quién pagó<select class="in" id="payUser"><option value="">— Sin usuario —</option>${us.rows.filter(u=>u.rol!=='admin').map(u=>`<option value="${u.id}">${esc(u.nombre)} (${esc(u.email)})</option>`).join('')}</select></label>
      <label>Monto en US$<input class="in mono" id="payAmt" type="number" min="0.5" step="0.5" placeholder="5"></label>
      <label>Concepto<input class="in" id="payCon" value="Plan Pro · 1 mes" maxlength="120"></label>
      <label>Darle ⭐ Pro por<select class="in" id="payMeses"><option value="1" selected>1 mes</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option><option value="0">No cambiar su plan</option></select></label>
      <button class="btn primary" id="payAdd">Registrar pago</button>
    </div></details>
    <div class="card" style="margin-top:16px"><div class="fh"><h3 style="margin:0">Pagos registrados</h3><span class="muted">Total: <b>${usd(total)}</b></span></div>
    ${pg.rows.length?`<div class="tablewrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Fecha</th><th>Usuario</th><th>Cómo</th><th>Concepto</th><th>Monto</th><th></th></tr></thead><tbody>${pg.rows.map(p=>`<tr><td>${new Date(p.creado).toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'})}</td><td>${esc(p.nombre||'—')}</td><td>${p.proveedor==='wompi'?'<span class="provtag mp">💳 Wompi</span>':p.proveedor==='mercadopago'?'<span class="provtag mp">💳 Mercado Pago</span>':'<span class="provtag">✍️ Manual</span>'}</td><td>${esc(p.concepto)}</td><td class="mono">${p.monto_local&&p.moneda?esc(fmtLocal(p.monto_local,p.moneda))+'<br><small class="muted">≈ '+usd(p.monto_usd)+'</small>':usd(p.monto_usd)}</td><td>${p.proveedor!=='manual'?'':`<button class="btn sm ghost danger" data-delpay="${p.id}">${st.confirmPay===p.id?'¿Seguro?':'Borrar'}</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted" style="margin-top:10px">Todavía no registraste pagos.</p>'}</div>`;
  $('#payAdd').onclick=async()=>{const amt=+$('#payAmt').value,uid=$('#payUser').value;if(!(amt>0)){toast('Poné el monto');return}
    const b=$('#payAdd');b.disabled=true;
    const meses=uid?+$('#payMeses').value:0;
    try{await fn('admin',{action:'add_payment',user_id:uid||null,monto_usd:amt,concepto:$('#payCon').value,meses});
      toast(meses?`Pago registrado · ⭐ Pro por ${meses} ${meses===1?'mes':'meses'} (se suma si ya tenía)`:'Pago registrado');admPagos(box)}catch(e){toast(e.message);b.disabled=false}};
  box.querySelectorAll('[data-delpay]').forEach(b=>b.onclick=async()=>{const id=+b.dataset.delpay;
    if(st.confirmPay!==id){st.confirmPay=id;b.textContent='¿Seguro?';setTimeout(()=>{if(st.confirmPay===id){st.confirmPay=null;b.textContent='Borrar'}},4000);return}
    st.confirmPay=null;try{await fn('admin',{action:'delete_payment',id});toast('Pago borrado');admPagos(box)}catch(e){toast(e.message)}});
}

const AV_TIPO={info:['ℹ️','Información'],nuevo:['✨','Novedad'],mantenimiento:['🛠️','Mantenimiento'],importante:['⚠️','Importante']};
async function admAvisos(box){
  const av=await fn('admin',{action:'list_avisos'});
  box.innerHTML=`<div class="card"><h3>📣 Publicar un aviso</h3><p class="csub">Les aparece a todos los usuarios arriba de su Inicio. Cada uno lo puede cerrar.</p>
    <div class="avform">
      <label>Tipo<select class="in" id="avTipo">${Object.entries(AV_TIPO).map(([k,[i,l]])=>`<option value="${k}">${i} ${l}</option>`).join('')}</select></label>
      <label>Dura<select class="in" id="avDias"><option value="0">Hasta que lo apague</option><option value="1">1 día</option><option value="3">3 días</option><option value="7" selected>1 semana</option><option value="30">1 mes</option></select></label>
      <label class="full">Título<input class="in" id="avTit" maxlength="80" placeholder="Ej: ¡Nuevo! Ahora podés corregir tus entregas"></label>
      <label class="full">Mensaje (opcional)<textarea class="in" id="avTxt" rows="3" maxlength="500" placeholder="Contá los detalles…"></textarea></label>
    </div>
    <div class="crow" style="justify-content:flex-end"><button class="btn primary" id="avAdd">Publicar aviso</button></div></div>
    <div class="card" style="margin-top:16px"><h3>Avisos publicados</h3>
    ${av.rows.length?av.rows.map(a=>{const[i,l]=AV_TIPO[a.tipo]||AV_TIPO.info,venc=a.hasta&&new Date(a.hasta)<new Date();
      return `<div class="avitem ${a.activo&&!venc?'':'off'}"><div><b>${i} ${esc(a.titulo)}</b><small class="muted">${l} · ${new Date(a.creado).toLocaleDateString('es',{day:'numeric',month:'short'})} · ${venc?'Vencido':!a.activo?'Apagado':a.hasta?'Visible hasta el '+new Date(a.hasta).toLocaleDateString('es',{day:'numeric',month:'short'}):'Visible'}</small>${a.texto?`<p>${esc(a.texto)}</p>`:''}</div>
        <div class="crow" style="margin:0;gap:6px">${venc?'':`<button class="btn sm" data-avtog="${a.id}" data-on="${a.activo?0:1}">${a.activo?'Apagar':'Encender'}</button>`}<button class="btn sm ghost danger" data-avdel="${a.id}">Borrar</button></div></div>`}).join(''):'<p class="muted">Todavía no publicaste avisos.</p>'}</div>`;
  $('#avAdd').onclick=async()=>{const titulo=$('#avTit').value.trim();if(!titulo){toast('Escribí un título');return}
    try{await fn('admin',{action:'create_aviso',titulo,texto:$('#avTxt').value,tipo:$('#avTipo').value,dias:+$('#avDias').value});toast('Aviso publicado para todos');admAvisos(box);loadAvisos()}catch(e){toast(e.message)}};
  box.querySelectorAll('[data-avtog]').forEach(b=>b.onclick=async()=>{try{await fn('admin',{action:'toggle_aviso',id:+b.dataset.avtog,activo:b.dataset.on==='1'});admAvisos(box);loadAvisos()}catch(e){toast(e.message)}});
  box.querySelectorAll('[data-avdel]').forEach(b=>b.onclick=async()=>{try{await fn('admin',{action:'delete_aviso',id:+b.dataset.avdel});admAvisos(box);loadAvisos()}catch(e){toast(e.message)}});
}

/* ===== Avisos para todos los usuarios (banner en Inicio) ===== */
async function loadAvisos(){
  const{data}=await sbc.from('cg_avisos').select('id,titulo,texto,tipo,creado').order('creado',{ascending:false}).limit(5);
  const seen=st.meta.avisosVistos||[];const list=(data||[]).filter(a=>!seen.includes(a.id));
  $('#avisos').innerHTML=list.map(a=>{const[i,l]=AV_TIPO[a.tipo]||AV_TIPO.info;
    return `<div class="aviso t-${a.tipo}"><span class="aic">${i}</span><div><b>${esc(a.titulo)}</b> <span class="atag">${l}</span>${a.texto?`<p>${esc(a.texto)}</p>`:''}</div><button class="x" data-avclose="${a.id}" aria-label="Cerrar aviso">✕</button></div>`}).join('');
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-avclose]');if(!b)return;
  st.meta.avisosVistos=[...(st.meta.avisosVistos||[]),+b.dataset.avclose].slice(-50);saveMeta();b.closest('.aviso').remove()});
