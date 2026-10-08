/* ===== Adjuntos: el usuario le pasa documentos e imágenes al equipo ===== */
// Imágenes y PDF se guardan en Supabase Storage (carpeta privada de cada usuario) y Claude los lee directo.
// Word, Excel, CSV y texto se convierten a texto acá mismo y se guardan con el trabajo.
const ATT_MAX_FILE=10*1024*1024,ATT_MAX_TOTAL=9*1024*1024,ATT_MAX_N=8,ATT_TEXT_CAP=120000;
const ATT_ACCEPT='.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,image/png,image/jpeg,image/webp,image/gif';
let attPending=[],chatPending=[];
const attKind=f=>{const n=f.name.toLowerCase();if(f.type.startsWith('image/'))return'image';if(n.endsWith('.pdf'))return'pdf';if(n.endsWith('.docx'))return'docx';if(/\.(xlsx|xls)$/.test(n))return'xlsx';if(/\.(csv|txt|md|json)$/.test(n))return'text';return null};
const attIcon=k=>({image:'🖼️',pdf:'📕',docx:'📝',xlsx:'📊',text:'📄'})[k]||'📎';
const fmtSize=b=>b>1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
function b64FromBuf(buf){const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
// Fotos grandes se achican (Claude no necesita más de ~1600px y así cuesta menos).
async function shrinkImage(file){
  if(file.type==='image/gif')return{blob:file,type:file.type};
  const bmp=await createImageBitmap(file).catch(()=>null);if(!bmp)return{blob:file,type:file.type};
  const sc=Math.min(1,1600/Math.max(bmp.width,bmp.height));if(sc===1&&file.size<1.5e6)return{blob:file,type:file.type};
  const c=document.createElement('canvas');c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  const blob=await new Promise(ok=>c.toBlob(ok,'image/jpeg',0.86));return{blob,type:'image/jpeg'};
}
async function fileToText(f,kind){
  if(kind==='docx'){await loadLib('mammoth');const r=await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()});return r.value}
  if(kind==='xlsx'){await loadLib('xlsx');const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});return wb.SheetNames.map(n=>`## Hoja: ${n}\n`+XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n')}
  return f.text();
}
function addFiles(list,target){
  for(const f of list){
    const kind=attKind(f);
    if(!kind){toast(`"${f.name}" no se puede leer. Usá PDF, Word, Excel, CSV, texto o imágenes.`);continue}
    if(f.size>ATT_MAX_FILE){toast(`"${f.name}" pesa más de 10 MB.`);continue}
    if(target.length>=ATT_MAX_N){toast(`Máximo ${ATT_MAX_N} archivos por vez.`);break}
    target.push({file:f,kind});
  }
}
function attChips(list,where){
  return list.map((a,i)=>`<span class="attchip" title="${esc(a.file.name)}">${attIcon(a.kind)} <span>${esc(a.file.name)}</span><small class="muted">${fmtSize(a.file.size)}</small><button type="button" data-attrm="${where}:${i}" aria-label="Quitar ${esc(a.file.name)}">✕</button></span>`).join('');
}
function renderAttBar(){
  const bar=$('#attBar');if(!bar)return;
  bar.innerHTML=`<div class="attbar"><label class="btn sm ghost" for="attInput" title="PDF, Word, Excel, CSV, texto o imágenes">📎 Adjuntar archivos</label><input type="file" id="attInput" multiple accept="${ATT_ACCEPT}" hidden>${attChips(attPending,'job')}
    ${attPending.length?'':'<small class="muted">Opcional: pasale al equipo documentos o fotos ("hacé lo que dice este PDF").</small>'}</div>`;
  $('#attInput').onchange=e=>{addFiles([...e.target.files],attPending);e.target.value='';renderAttBar()};
}
function renderChatAtt(){
  const el=$('#chatAtt');if(!el)return;
  el.innerHTML=`<label class="btn" for="chatAttIn" title="Adjuntar archivos" aria-label="Adjuntar archivos">📎${chatPending.length?' '+chatPending.length:''}</label><input type="file" id="chatAttIn" multiple accept="${ATT_ACCEPT}" hidden>`;
  $('#chatAttIn').onchange=e=>{addFiles([...e.target.files],chatPending);e.target.value='';renderChatAtt();if(chatPending.length)toast(`📎 ${chatPending.map(a=>a.file.name).join(', ')} — se manda con tu próximo mensaje`)};
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-attrm]');if(!b)return;const[w,i]=b.dataset.attrm.split(':');(w==='job'?attPending:chatPending).splice(+i,1);w==='job'?renderAttBar():renderChatAtt()});
// Arrastrar y soltar archivos sobre el cuadro del pedido.
document.addEventListener('dragover',e=>{if(e.target.closest?.('.composer')){e.preventDefault()}});
document.addEventListener('drop',e=>{const c=e.target.closest?.('.composer');if(!c||!e.dataTransfer?.files?.length)return;e.preventDefault();addFiles([...e.dataTransfer.files],attPending);renderAttBar()});

async function buildAttachments(list,pid,upload){
  const meta=[],ai=[];let total=0;
  for(const a of list){
    const f=a.file;
    if(a.kind==='image'||a.kind==='pdf'){
      const {blob,type}=a.kind==='image'?await shrinkImage(f):{blob:f,type:'application/pdf'};
      total+=blob.size;if(total>ATT_MAX_TOTAL)throw new Error('Los archivos juntos pesan demasiado (máximo 9 MB). Quitá alguno.');
      const buf=await blob.arrayBuffer(),data=b64FromBuf(buf);
      ai.push(a.kind==='image'?{type:'image',name:f.name,media_type:type,data}:{type:'pdf',name:f.name,data});
      if(upload){const path=`${session.user.id}/${pid}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g,'_').slice(-80)}`;
        const{error}=await sbc.storage.from('adjuntos').upload(path,blob,{contentType:type,upsert:false});
        if(error)throw new Error(`No pude subir "${f.name}": ${error.message}`);
        meta.push({name:f.name,kind:a.kind,path,type,size:blob.size});attCache.set(path,data)}
      else meta.push({name:f.name,kind:a.kind});
    }else{
      let text=String(await fileToText(f,a.kind)||'').trim();
      if(!text)throw new Error(`"${f.name}" está vacío o no se pudo leer.`);
      if(text.length>ATT_TEXT_CAP)text=text.slice(0,ATT_TEXT_CAP)+'\n…(recortado)';
      ai.push({type:'text',name:f.name,text});meta.push({name:f.name,kind:a.kind,text});
    }
  }
  return{meta,ai};
}
const attCache=new Map();
window.CG_prepareAttachments=async pid=>attPending.length?buildAttachments(attPending,pid,true):null;
window.CG_clearPending=()=>{attPending=[];renderAttBar()};
window.CG_takeChatAttachments=async()=>{if(!chatPending.length)return null;const list=chatPending;const r=await buildAttachments(list,null,false);chatPending=[];renderChatAtt();return{...r,names:list.map(a=>a.file.name)}};
window.CG_getAttachments=async p=>{
  if(!p?.adjuntos?.length)return undefined;
  const out=[];
  for(const a of p.adjuntos){
    if(a.text){out.push({type:'text',name:a.name,text:a.text});continue}
    if(!a.path)continue;
    let data=attCache.get(a.path);
    if(!data){const{data:blob,error}=await sbc.storage.from('adjuntos').download(a.path);if(error)throw new Error(`No encontré "${a.name}"`);data=b64FromBuf(await blob.arrayBuffer());attCache.set(a.path,data)}
    out.push(a.kind==='image'?{type:'image',name:a.name,media_type:a.type||'image/jpeg',data}:{type:'pdf',name:a.name,data});
  }
  return out;
};
