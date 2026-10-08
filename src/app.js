/* ===== Arranque · versión independiente (Supabase + función "ia") ===== */
const STANDALONE=true;window.CG_STANDALONE=true;
if(typeof supabase==='undefined'){$('#aMsg').textContent='No se pudo cargar una parte de la app (vendor/supabase.min.js). Revisá que la carpeta "vendor" esté junto a index.html.';throw new Error('Falta la librería de Supabase')}
const sbc=supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
let session=null,perfil=null,booted=false;

async function authHeader(){const{data}=await sbc.auth.getSession();if(!data.session)throw{code:'session_expired'};return'Bearer '+data.session.access_token}
async function fn(name,body){
  const r=await fetch(`${SB_URL}/functions/v1/${name}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:await authHeader(),apikey:SB_KEY},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({ok:false,error:'Respuesta inválida del servidor'}));
  if(!j.ok)throw new Error(j.error||'Error del servidor');return j;
}
function parseJsonLoose(t){
  try{return JSON.parse(t)}catch(_){}
  const m=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(m){try{return JSON.parse(m[1])}catch(_){}}
  const a=[t.indexOf('{'),t.indexOf('[')].filter(i=>i>=0);const b=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']'));
  if(a.length&&Math.min(...a)<b){try{return JSON.parse(t.slice(Math.min(...a),b+1))}catch(_){}}
  throw{code:'invalid_json',text:t};
}
function makeSample(){
  async function call(input,opts={},json=false){
    let res;
    try{res=await fetch(`${SB_URL}/functions/v1/ia`,{method:'POST',signal:opts.signal,
      headers:{'Content-Type':'application/json',Authorization:await authHeader(),apikey:SB_KEY},
      body:JSON.stringify({input,tier:opts.modelTier||'default',json})})}
    catch(e){throw{code:e?.name==='AbortError'?'cancelled':'upstream_error',message:String(e?.message||e)}}
    if(res.status===401)throw{code:'session_expired'};
    if(!(res.headers.get('content-type')||'').includes('event-stream')){const j=await res.json().catch(()=>({}));throw{code:j.error||'upstream_error',message:j.message,srv:true}}
    const reader=res.body.getReader(),dec=new TextDecoder();let buf='',text='',truncated=false;
    try{
      for(;;){const{value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
        while((i=buf.indexOf('\n\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);if(!line.startsWith('data: '))continue;
          let ev;try{ev=JSON.parse(line.slice(6))}catch(_){continue}
          if(ev.t){text+=ev.t;try{opts.onText?.({text,delta:ev.t})}catch(_){}}
          else if(ev.error)throw{code:ev.error,message:ev.message,text,srv:true};
          else if(ev.done){truncated=!!ev.truncated;refreshUsage()}}}
    }catch(e){if(e?.name==='AbortError')throw{code:'cancelled',text};throw e}
    if(!text.trim())throw{code:'empty_completion'};
    return{text,truncated,modelTierApplied:opts.modelTier||'default'};
  }
  const f=(input,opts)=>call(input,opts,false);
  f.json=async(input,opts)=>parseJsonLoose((await call(input,opts,true)).text);
  return f;
}
/* Datos de cada usuario en la tabla cg_datos (protegida por RLS) */
Object.assign(store,{
  async set(kind,id,data){const{error}=await sbc.from('cg_datos').upsert({user_id:session.user.id,tipo:kind,id,data,actualizado:new Date().toISOString()});if(error)throw error},
  async del(kind,id){const{error}=await sbc.from('cg_datos').delete().match({user_id:session.user.id,tipo:kind,id});if(error)throw error},
  async all(kind){const{data,error}=await sbc.from('cg_datos').select('id,data').eq('tipo',kind);if(error)throw error;return Object.fromEntries((data||[]).map(r=>[r.id,r.data]))},
  watch(kind,cb){this.all(kind).then(cb).catch(()=>toast('No pude cargar tus trabajos. Recargá la página.'))}
});
dlFn={async save({filename,data}){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'text/html;charset=utf-8'}));a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000);return{status:'saved'}}};

/* ===== Consumo ===== */
let usageT;
async function refreshUsage(){clearTimeout(usageT);usageT=setTimeout(async()=>{
  const{data}=await sbc.rpc('cg_mi_consumo');const u=data?.[0];if(!u)return;
  perfil={...perfil,usado:Number(u.usado_usd),limite:Number(u.limite_usd),rol:u.rol,plan:u.plan};renderAccountPill();applyPlanUI();if(!$('#acct').hidden)renderAccount()},400)}

/* ===== Planes: Gratis (Rápido y Normal) y Pro (también Experto) ===== */
const canExpert=()=>perfil?.rol==='admin'||perfil?.plan==='pro';
function applyPlanUI(){
  const b=document.querySelector('#tierSeg [data-tier="complex"]');if(!b||!perfil)return;
  b.textContent=canExpert()?'Experto':'🔒 Experto';b.title=canExpert()?'Opus 5: el más potente':'Disponible en el plan Pro';
  document.querySelector('#tierSeg [data-tier="quick"]').title='Haiku 4.5: el más rápido y barato';
  document.querySelector('#tierSeg [data-tier="default"]').title='Sonnet 5: muy bueno para casi todo';
  if(!canExpert()&&st.meta.tier==='complex'){st.meta.tier='default';segOn('#tierSeg','tier','default');saveMeta()}
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#tierSeg [data-tier="complex"]')||canExpert())return;
  e.stopImmediatePropagation();e.preventDefault();
  toast('🔒 El motor Experto es del plan Pro. Mirá cómo pasarte en 👤 Mi cuenta.');
},true);
function renderAccountPill(){
  if(!perfil)return;const p=$('#acctBtn');
  p.innerHTML=perfil.rol==='admin'?`👤 ${esc(perfil.nombre||'Mi cuenta')}`:`👤 ${esc(perfil.nombre||'Mi cuenta')} · <span class="mono">US$ ${perfil.usado.toFixed(2)}/${perfil.limite.toFixed(2)}</span>`;
  $('#adminBtn').hidden=perfil.rol!=='admin';$('#admTabBtn').hidden=perfil.rol!=='admin';
}
function renderAccount(){
  const pct=perfil.rol==='admin'?0:Math.min(100,perfil.usado/Math.max(perfil.limite,.01)*100);
  const pro=perfil.plan==='pro';
  $('#acctBody').innerHTML=`<div class="connrow"><b>${esc(perfil.nombre)}</b><span class="muted">${esc(session.user.email)} · ${perfil.rol==='admin'?'Administrador':perfil.rol==='cliente'?'Cliente':'Invitado'}</span></div>
    <div class="connrow"><b>Tu plan: ${perfil.rol==='admin'?'Administrador (todo incluido)':pro?'⭐ Pro':'Gratis'}</b>
      <table class="tbl plantbl"><thead><tr><th>Motor</th><th>Modelo</th><th>Gratis</th><th>Pro</th></tr></thead><tbody>
        <tr><td>⚡ Rápido</td><td>Haiku 4.5</td><td>✓</td><td>✓</td></tr>
        <tr><td>⚖️ Normal</td><td>Sonnet 5</td><td>✓</td><td>✓</td></tr>
        <tr><td>🧠 Experto</td><td>Opus 5</td><td>—</td><td>✓</td></tr></tbody></table>
      ${perfil.rol!=='admin'&&!pro?'<span class="muted">¿Querés el motor Experto? Pedile al administrador que te pase a <b>Pro</b>.</span>':''}</div>
    <div class="connrow"><b>Uso de IA este mes</b>${perfil.rol==='admin'?`<span>US$ ${perfil.usado.toFixed(2)} <span class="muted">(sin límite)</span></span>`:
      `<div class="fbar" style="margin:0"><i style="width:${pct}%;background:${pct>85?'var(--bad)':'var(--accent)'}"></i></div><span>US$ ${perfil.usado.toFixed(2)} de US$ ${perfil.limite.toFixed(2)} · se reinicia el 1 de cada mes</span>`}</div>
    <div class="crow" style="justify-content:space-between"><a href="terminos.html" target="_blank" rel="noopener" class="muted" style="font-size:13px">Términos y privacidad</a><button class="btn danger" id="logoutBtn">Cerrar sesión</button></div>`;
  $('#logoutBtn').onclick=async()=>{await sbc.auth.signOut();location.reload()};
}

/* ===== Administración ===== */
async function openAdmin(){$('#admin').hidden=false;await renderAdmin()}
async function renderAdmin(){
  const box=$('#adminBody');box.innerHTML='<p class="muted"><span class="spin"></span>Cargando…</p>';
  try{
    const[s,inv,us]=await Promise.all([fn('admin',{action:'status'}),fn('admin',{action:'list_invites'}),fn('admin',{action:'list_users'})]);
    const total=us.rows.reduce((t,u)=>t+Number(u.usado_mes||0),0);
    box.innerHTML=`
    <div class="connrow"><b>🔑 Clave de la API de Claude</b>${s.apiKey?'<span class="state ok">✓ Configurada</span>':'<span class="state">Falta configurar</span> <span class="muted">Sin esto el equipo no puede trabajar.</span>'}
      <ol class="ghsteps"><li>Entrá a <b>console.anthropic.com</b> y creá tu cuenta.</li><li>En <b>Billing</b> cargá saldo (con US$ 10 alcanza para empezar).</li><li>En <b>API Keys</b> tocá <b>Create Key</b>, copiá la clave (empieza con <code>sk-ant-</code>) y pegala acá.</li></ol>
      <div class="addstep"><input class="in" type="password" id="apiKeyIn" placeholder="sk-ant-…" autocomplete="off"><button class="btn sm primary" id="apiKeySave">Guardar</button></div>
      <small class="muted">Se guarda cifrada en tu Supabase (Vault). Nunca llega al navegador de nadie.</small></div>
    <div class="connrow"><div class="fh"><b>👥 Usuarios</b><span class="muted">Gasto total del mes: <b>US$ ${total.toFixed(2)}</b></span></div>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Plan</th><th>Usado</th><th>Límite US$</th><th>Activo</th></tr></thead><tbody>
      ${us.rows.map(u=>`<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${esc(u.rol)}</td>
        <td>${u.rol==='admin'?'—':`<select class="in plan" data-uid="${u.id}" aria-label="Plan de ${esc(u.nombre)}"><option value="gratis" ${u.plan!=='pro'?'selected':''}>Gratis</option><option value="pro" ${u.plan==='pro'?'selected':''}>⭐ Pro</option></select>`}</td><td class="mono">${Number(u.usado_mes).toFixed(2)} <small class="muted">(${u.pedidos_mes})</small></td>
        <td>${u.rol==='admin'?'—':`<input class="in mono lim" type="number" min="0" max="1000" step="0.5" value="${Number(u.limite_usd)}" data-uid="${u.id}" aria-label="Límite de ${esc(u.nombre)}">`}</td>
        <td>${u.rol==='admin'?'✓':`<input type="checkbox" class="act" data-uid="${u.id}" ${u.activo?'checked':''} aria-label="Activo">`}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="connrow"><b>🎟️ Invitaciones</b><span class="muted">Creá un código y mandáselo a tu amigo. Lo usa una sola vez al crear su cuenta.</span>
      <div class="addstep"><select class="in" id="invRol"><option value="amigo">Amigo</option><option value="cliente">Cliente</option></select>
        <input class="in" type="number" id="invLim" min="0" max="1000" step="0.5" value="2" style="max-width:110px" aria-label="Límite mensual en US$">
        <input class="in" id="invNota" placeholder="Para quién es (ej: Juan)"><button class="btn sm primary" id="invNew">Crear código</button></div>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Código</th><th>Para</th><th>Rol</th><th>Límite</th><th>Estado</th><th></th></tr></thead><tbody>
      ${inv.rows.map(i=>`<tr><td class="mono">${esc(i.codigo)}</td><td>${esc(i.nota||'')}</td><td>${esc(i.rol)}</td><td class="mono">${Number(i.limite_usd).toFixed(2)}</td>
        <td>${i.usada_en?`<span class="state ok">Usada por ${esc(i.usada_por_nombre||'alguien')}</span>`:'<span class="state">Disponible</span>'}</td>
        <td>${i.usada_en?'':`<button class="btn sm ghost" data-copy="${esc(i.codigo)}">Copiar</button><button class="btn sm ghost danger" data-delinv="${esc(i.codigo)}">Borrar</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    $('#apiKeySave').onclick=async()=>{const k=$('#apiKeyIn').value.trim();if(!k){toast('Pegá la clave');return}
      try{await fn('admin',{action:'set_api_key',key:k});$('#apiKeyIn').value='';toast('Clave guardada. ¡El equipo ya puede trabajar!');setAi('ok');$('#aiPill').onclick=null;$('#aiPill').style.cursor='';renderAdmin()}catch(e){toast(e.message)}};
    $('#invNew').onclick=async()=>{try{const r=await fn('admin',{action:'create_invite',rol:$('#invRol').value,limite_usd:+$('#invLim').value,nota:$('#invNota').value});toast(`Código creado: ${r.codigo}`);renderAdmin()}catch(e){toast(e.message)}};
    box.querySelectorAll('[data-delinv]').forEach(b=>b.onclick=async()=>{try{await fn('admin',{action:'delete_invite',codigo:b.dataset.delinv});renderAdmin()}catch(e){toast(e.message)}});
    box.querySelectorAll('.lim').forEach(i=>i.onchange=async()=>{try{await fn('admin',{action:'update_user',id:i.dataset.uid,limite_usd:+i.value});toast('Límite actualizado')}catch(e){toast(e.message)}});
    box.querySelectorAll('.plan').forEach(i=>i.onchange=async()=>{try{await fn('admin',{action:'update_user',id:i.dataset.uid,plan:i.value});toast(i.value==='pro'?'⭐ Pasado a Pro: ya puede usar el motor Experto':'Pasado a Gratis')}catch(e){toast(e.message)}});
    box.querySelectorAll('.act').forEach(i=>i.onchange=async()=>{try{await fn('admin',{action:'update_user',id:i.dataset.uid,activo:i.checked});toast(i.checked?'Usuario activado':'Usuario desactivado')}catch(e){toast(e.message);i.checked=!i.checked}});
  }catch(e){box.innerHTML=`<p class="muted">${esc(e.message)}</p>`}
}

/* ===== Entrar / crear cuenta ===== */
let authMode='in';
function setAuthMode(m){authMode=m;segOn('#authSeg','am',m);document.querySelectorAll('#authForm [data-up]').forEach(x=>x.hidden=m!=='up');
  $('#aBtn').textContent=m==='up'?'Crear cuenta':'Entrar';$('#aPass').autocomplete=m==='up'?'new-password':'current-password';$('#aMsg').textContent=''}
$('#authSeg').onclick=e=>{const b=e.target.closest('[data-am]');if(b)setAuthMode(b.dataset.am)};
$('#authForm').onsubmit=async e=>{
  e.preventDefault();const email=$('#aEmail').value.trim(),pass=$('#aPass').value,btn=$('#aBtn'),msg=$('#aMsg');
  btn.disabled=true;msg.textContent='';
  try{
    if(authMode==='up'){
      const code=$('#aCode').value.trim().toUpperCase(),nombre=$('#aName').value.trim();
      if(!code){msg.textContent='Necesitás un código de invitación.';return}
      if(!$('#aTerms').checked){msg.textContent='Para crear la cuenta tenés que aceptar los términos.';return}
      if(pass.length<8){msg.textContent='La contraseña tiene que tener al menos 8 caracteres.';return}
      const{data,error}=await sbc.auth.signUp({email,password:pass,options:{data:{nombre,invitacion:code}}});
      if(error){msg.textContent=/database error|invitaci/i.test(error.message)?'El código de invitación no es válido o ya se usó.':/rate limit/i.test(error.message)?'Hay demasiados registros seguidos. Probá en unos minutos.':/registered|already/i.test(error.message)?'Ese correo ya tiene cuenta. Tocá "Entrar".':error.message;return}
      if(data.user&&Array.isArray(data.user.identities)&&!data.user.identities.length){msg.textContent='Ese correo ya tiene una cuenta. Tocá "Entrar" y usá tu contraseña.';setAuthMode('in');$('#aMsg').textContent='Ese correo ya tiene una cuenta. Entrá con tu contraseña.';return}
      if(!data.session){const r=await sbc.auth.signInWithPassword({email,password:pass});if(r.error){msg.textContent='Cuenta creada. Revisá tu correo para confirmarla y después entrá.';setAuthMode('in');return}}
    }else{
      const{error}=await sbc.auth.signInWithPassword({email,password:pass});
      if(error){msg.textContent=/confirm/i.test(error.message)?'Todavía no confirmaste tu correo. Revisá tu bandeja de entrada.':'Correo o contraseña incorrectos.';return}
    }
  }finally{btn.disabled=false}
};

async function startApp(){
  if(booted)return;booted=true;
  $('#aMsg').style.color='var(--muted)';$('#aMsg').textContent='Abriendo tu oficina…';
  const{data,error}=await sbc.from('cg_perfiles').select('nombre,rol,plan,limite_usd,activo').eq('id',session.user.id).maybeSingle();
  $('#aMsg').style.color='';$('#aMsg').textContent='';
  if(error)throw error;
  if(!data){booted=false;$('#aMsg').textContent='Tu cuenta no tiene perfil (¿te registraste sin código?). Pedile ayuda al administrador.';return}
  if(!data.activo){$('#aMsg').textContent='Tu cuenta está desactivada. Hablá con el administrador.';await sbc.auth.signOut();booted=false;return}
  perfil={nombre:data.nombre,rol:data.rol,plan:data.plan,limite:Number(data.limite_usd),usado:0};
  $('#auth').hidden=true;$('#appRoot').hidden=false;
  sampleFn=makeSample();setAi('ok');S.mode='db';
  if(perfil.rol==='admin')fn('admin',{action:'status'}).then(s=>{if(!s.apiKey){setAi('off');$('#aiTxt').textContent='Falta la clave de la API';$('#aiPill').title='Cargala en 👑 Administración';$('#aiPill').style.cursor='pointer';$('#aiPill').onclick=openAdmin}}).catch(()=>{});
  $('#saveMode').textContent='Guardado en tu cuenta · solo vos ves tus trabajos';
  clock();renderHome();renderProjects();buildScene();placeScene('inicio');renderContacts();renderAccountPill();refreshUsage();
  try{const m=await store.all('meta');if(m.profile)Object.assign(st.meta,m.profile)}catch(e){}
  if(st.meta.name==='Cuartel General'&&perfil.nombre)st.meta.name=`Oficina de ${perfil.nombre}`;
  renderBell();
  (st.meta.hired||[]).forEach(h=>{if(AGENTS.some(a=>a.id===h.id))return;const a=hiredToAgent(h);AGENTS.push(a);addActor(a)});refreshAll();renderRolesGrid();renderRoles();renderTeamStatus();renderContacts();
  $('#officeName').value=st.meta.name;$('#notes').value=st.meta.notes||'';segOn('#tierSeg','tier',st.meta.tier);applyPlanUI();
  try{st.chats=await store.all('chats')}catch(e){}
  store.watch('projects',m=>{st.projects=m;renderProjects();renderHome();renderBoard();renderRoles()});
  loadAvisos().catch(()=>{});
}
$('#acctBtn').onclick=()=>{$('#acct').hidden=false;renderAccount()};
$('#adminBtn').onclick=openAdmin;
// Importante: no llamar a Supabase dentro del aviso de sesión (se traba); se difiere con setTimeout.
function safeStart(){startApp().catch(e=>{console.error(e);booted=false;$('#auth').hidden=false;$('#appRoot').hidden=true;$('#aMsg').textContent='No pude abrir tu oficina: '+(e?.message||e)+'. Recargá la página (F5).'})}
sbc.auth.onAuthStateChange((ev,s)=>{session=s;if(s)setTimeout(safeStart,0);else if(booted)setTimeout(()=>location.reload(),0)});
sbc.auth.getSession().then(({data})=>{session=data.session;if(session)safeStart();else{$('#auth').hidden=false;setAuthMode('in')}});
