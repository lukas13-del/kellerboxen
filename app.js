/* Kellerboxen: Boxen ordnen und finden.
   Alle Inhalte werden im Browser mit AES-GCM verschlüsselt, bevor sie die Datenbank erreichen.
   Der Schlüssel entsteht aus dem Haushalts-Schlüssel (PBKDF2-SHA256, 1 000 000 Runden, dann HKDF) und verlässt das Gerät nie. */
"use strict";
if(window.top!==window.self){document.documentElement.innerHTML="";throw new Error("Kellerboxen darf nicht eingebettet werden.")}

/* ---------- Grundlagen ---------- */
const CFG=window.KB_CONFIG||{};
const APP_URL=(CFG.appUrl||(location.origin+location.pathname)).replace(/#.*$/,"");
const SHEET={w:63.5,h:38.1,cols:3,rows:7,left:6.94,top:15.16,px:66.33,py:38.1},PER=21;
const LEVEL=["Raum","Regal / Schrank","Fach"],NEU=["Neuer Raum","Neues Regal","Neues Fach"],ADD=["+ Raum","+ Regal / Schrank","+ Fach"];
const PH=["z. B. Keller","z. B. Regal links, Schrank","z. B. Tablar 2, Oben"];
const KEY_ID="schluessel",KEY_V=2,ITER=1000000,CODE_ABC="23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const svg=d=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON={pin:svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  cam:svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  lock:svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')};
const S={phase:"start",user:null,keyInfo:null,rows:new Map,orte:new Map,boxen:new Map,boxIds:new Map,artikel:new Map,meta:{},metaId:null,loaded:false,status:"connecting",
  view:"suchen",lastView:"suchen",boxNr:null,q:"",edit:false,pickOpen:false,pickAdd:null,itemEdit:null,armed:null,flashId:null,focusId:null,
  lbl:{von:null,bis:null,start:null},photoTarget:null,chan:null,lastLoad:0,bad:0,gateMsg:"",gateEmail:"",busy:false,setupCode:null,setupOwn:false,addDraft:""};

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const padNr=n=>n<100?String(n).padStart(2,"0"):String(n);
function sortedOrte(){return [...S.orte].sort((a,b)=>(a[1].sort??0)-(b[1].sort??0)||norm(a[1].name).localeCompare(norm(b[1].name),"de",{numeric:true}))}
function childrenOf(pid){return sortedOrte().filter(([,o])=>(o.parentId||"")===(pid||""))}
function ortPath(id){const p=[];let cur=id,g=0;while(cur&&S.orte.has(cur)&&g++<6){p.unshift([cur,S.orte.get(cur)]);cur=S.orte.get(cur).parentId||""}return p}
function ortName(id){return ortPath(id).map(([,o])=>o.name).join(" › ")}
function descIds(id){const r=[id];for(const [c] of childrenOf(id))r.push(...descIds(c));return r}
function whereText(b){return ortName(b?.ortId)||"Noch kein Standort"}
function sortedBoxes(){return [...S.boxen].sort((a,b)=>parseInt(a[0],10)-parseInt(b[0],10))}
function boxesUnder(oid){const ids=new Set(descIds(oid));return sortedBoxes().filter(([,b])=>ids.has(b.ortId))}
function itemsOf(nr){return [...S.artikel].filter(([,a])=>a.boxNr===nr).sort((x,y)=>norm(x[1].name).localeCompare(norm(y[1].name),"de"))}
function itemCount(){const m=new Map;for(const a of S.artikel.values())m.set(a.boxNr,(m.get(a.boxNr)||0)+1);return m}
function lastActivity(){const m=new Map;for(const [nr,b] of S.boxen)m.set(nr,String(b.geaendert||b.erstellt||""));for(const a of S.artikel.values()){const t=String(a.erstellt||"");if(t>(m.get(a.boxNr)||""))m.set(a.boxNr,t)}return m}
function nextFree(){let n=1;while(S.boxen.has(padNr(n)))n++;return padNr(n)}
function parseNr(q){const m=/^\s*(?:box|nr\.?)?\s*0*(\d{1,3})\s*$/i.exec(q||"");if(!m)return null;const n=parseInt(m[1],10);return n>=1&&n<=999?padNr(n):null}
function hl(text,toks){const s=String(text??""),ts=(toks||[]).filter(Boolean);if(!ts.length)return esc(s);
  let n="";const map=[];for(let i=0;i<s.length;i++){for(const ch of norm(s[i])){n+=ch;map.push(i)}}
  const on=new Uint8Array(s.length);for(const t of ts){let p=0;while((p=n.indexOf(t,p))>=0){for(let k=p;k<p+t.length&&k<map.length;k++)on[map[k]]=1;p+=Math.max(1,t.length)}}
  let h="",o=false;for(let i=0;i<s.length;i++){if(!!on[i]!==o){h+=o?"</mark>":"<mark>";o=!o}h+=esc(s[i])}return h+(o?"</mark>":"")}
function parseLine(t){t=String(t||"").trim().replace(/^[-–•*·]\s*/,"").replace(/^\d+[.)]\s+/,"").trim();
  let menge=1,m=t.match(/^(\d+)\s*(x|×|stk\.?|stück)?\s+(.+)$/i);if(m){menge=parseInt(m[1],10);t=m[3]}
  else if((m=t.match(/^(.+?)\s*(?:[x×]\s*(\d+)|\((\d+)\))$/i))){menge=parseInt(m[2]||m[3],10);t=m[1]}
  return {name:t.trim().slice(0,120),menge:Math.min(9999,Math.max(1,menge||1))}}
const lineOf=o=>(o.menge>1?o.menge+"x ":"")+o.name;

/* ---------- Verschlüsselung ---------- */
const TE=new TextEncoder(),TD=new TextDecoder();
const b64=buf=>{const b=new Uint8Array(buf);let s="";for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s)};
const unb64=s=>{const bin=atob(s);const b=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return b};
const hex=buf=>Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,"0")).join("");
const K={aes:null,hmac:null};
function genCode(){const r=crypto.getRandomValues(new Uint8Array(20));let s="";for(let i=0;i<20;i++){s+=CODE_ABC[r[i]&31];if(i%4===3&&i<19)s+="-"}return s}
function canonCode(p){const c=String(p||"").toUpperCase().replace(/[^0-9A-Z]/g,"");return c.length===20?c.match(/.{4}/g).join("-"):null}
function passFor(p,kind){if(kind==="code"){return canonCode(p)}return String(p||"").normalize("NFC")}
function clampIter(it){it=Number(it)|0;if(it<200000||it>5000000)throw new Error("Ungültige Schlüsselinfo.");return it}
async function deriveKeys(pass,saltB64,iter){
  const base=await crypto.subtle.importKey("raw",TE.encode(pass),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:unb64(saltB64),iterations:clampIter(iter)},base,256);
  const hk=await crypto.subtle.importKey("raw",bits,"HKDF",false,["deriveKey"]);new Uint8Array(bits).fill(0);
  const aes=await crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(0),info:TE.encode("kellerboxen aes v2")},hk,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  const hmac=await crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(0),info:TE.encode("kellerboxen hmac v2")},hk,{name:"HMAC",hash:"SHA-256",length:256},false,["sign"]);
  return {aes,hmac}}
async function sealBytes(bytes,aad,key=K.aes){const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:TE.encode(aad)},key,bytes));
  const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return out}
async function openBytes(buf,aad,key=K.aes){const b=new Uint8Array(buf);if(b.length<29)throw new Error("kurz");
  return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:b.slice(0,12),additionalData:TE.encode(aad)},key,b.slice(12)))}
function padTo(bytes,block,fill=0x20){const n=Math.ceil((bytes.length+1)/block)*block;const out=new Uint8Array(n).fill(fill);out.set(bytes);return out}
async function seal(obj,id){return "v1."+b64(await sealBytes(padTo(TE.encode(JSON.stringify(obj)),256),"row:"+id))}
async function unseal(blob,id,key=K.aes){if(typeof blob!=="string"||!blob.startsWith("v1."))throw new Error("format");return JSON.parse(TD.decode(await openBytes(unb64(blob.slice(3)),"row:"+id,key)))}
async function tagId(label){return "r"+hex(await crypto.subtle.sign("HMAC",K.hmac,TE.encode(label))).slice(0,32)}
const randId=()=>"r"+hex(crypto.getRandomValues(new Uint8Array(16)));
async function checkWith(info,key){try{return TD.decode(await openBytes(unb64(info.check),"check:"+KEY_ID,key))==="kellerboxen-ok"}catch(e){return false}}
const checkKey=()=>checkWith(S.keyInfo,K.aes);
async function tryPass(p,info){const pass=passFor(p,info.kind);if(!pass)return null;const keys=await deriveKeys(pass,info.salt,info.iter);return (await checkWith(info,keys.aes))?keys:null}

/* Schlüssel auf diesem Gerät (nicht auslesbar, nur verwendbar) */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("kellerboxen",1);r.onupgradeneeded=()=>r.result.createObjectStore("k");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbDo(mode,fn){try{const d=await idb();return await new Promise((res,rej)=>{const tx=d.transaction("k",mode);const rq=fn(tx.objectStore("k"));tx.oncomplete=()=>res(rq?.result);tx.onerror=()=>rej(tx.error)})}catch(e){return null}}
const idbGet=k=>idbDo("readonly",s=>s.get(k)),idbSet=(k,v)=>idbDo("readwrite",s=>s.put(v,k)),idbDel=k=>idbDo("readwrite",s=>s.delete(k));
/* Öffentliche Schlüsselinfo (Salz, Runden, Prüfwert) lokal merken: schützt davor, den Schlüssel als Login-Passwort zu senden */
const lsSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},lsGet=k=>{try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}};

/* ---------- Datenbank ---------- */
const sb=window.__FAKE_SB||(CFG.supabaseUrl&&CFG.supabaseKey&&window.supabase?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}):null);
let toastT;
function toast(msg){let t=$(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.appendChild(t)}t.textContent=msg;clearTimeout(toastT);toastT=setTimeout(()=>t.remove(),3400)}
const isNet=e=>/fetch|network|load failed|NetworkError|Failed to fetch|AuthRetryableFetchError/i.test(String(e?.message||e||"")+" "+String(e?.name||""));
function errText(e){const m=String(e?.message||e||"");if(isNet(e))return "Keine Verbindung. Internet prüfen und nochmals versuchen.";if(/JWT|session|token/i.test(m))return "Anmeldung abgelaufen. Bitte neu anmelden.";if(/row-level|permission|policy|geschützt/i.test(m))return "Keine Berechtigung für diese Daten.";return "Das hat nicht geklappt. Bitte nochmals versuchen."}
const WQ={},PEND=new Map,SENT=new Set,CONF=new Map,TOUCH=new Map;let SEQ=0,RTQ=Promise.resolve();
function queue(k,run){return WQ[k]=(WQ[k]||Promise.resolve()).then(run,run)}
function rebuild(){S.orte=new Map;S.boxen=new Map;S.boxIds=new Map;S.artikel=new Map;S.meta={};S.metaId=null;
  for(const [id,o] of S.rows){if(!o||typeof o!=="object")continue;
    if(o.t==="ort")S.orte.set(id,o);else if(o.t==="box"&&o.nr){S.boxen.set(o.nr,{...o,_id:id});S.boxIds.set(o.nr,id)}else if(o.t==="artikel")S.artikel.set(id,o);else if(o.t==="meta"){S.meta=o;S.metaId=id}}}
function localSet(id,val){val===undefined?S.rows.delete(id):S.rows.set(id,val);TOUCH.set(id,{seq:++SEQ,val});rebuild();scheduleRender()}
const pendInc=id=>PEND.set(id,(PEND.get(id)||0)+1),pendDec=id=>{const n=(PEND.get(id)||1)-1;n?PEND.set(id,n):PEND.delete(id)};
function putRow(id,obj){localSet(id,obj);pendInc(id);
  return queue(id,async()=>{let blob=null;try{blob=await seal(obj,id);SENT.add(blob);const {error}=await sb.from("daten").upsert({id,blob});if(error)throw error;CONF.set(id,obj);return true}
    catch(e){if(blob)SENT.delete(blob);if(S.rows.get(id)===obj)localSet(id,CONF.get(id));toast(errText(e));return false}
    finally{pendDec(id)}})}
function delRow(id){if(!S.rows.has(id)&&!CONF.has(id))return Promise.resolve(true);localSet(id,undefined);pendInc(id);
  return queue(id,async()=>{try{const {error}=await sb.from("daten").delete().eq("id",id);if(error)throw error;CONF.delete(id);return true}
    catch(e){if(!S.rows.has(id)&&CONF.has(id))localSet(id,CONF.get(id));toast(errText(e));return false}
    finally{pendDec(id)}})}
async function boxIdFor(nr){return S.boxIds.get(nr)||await tagId("box:"+nr)}
async function saveBox(nr,patch){const id=await boxIdFor(nr);const cur=S.boxen.get(nr);const now=new Date().toISOString();
  const o={t:"box",nr,name:"",ortId:"",foto:null,erstellt:now,...(cur||{}),...patch,geaendert:now};delete o._id;return putRow(id,o)}
async function addItems(nr,list){list=list.filter(o=>o.name);if(!list.length)return [];
  if(!S.boxen.has(nr)&&!(await saveBox(nr,{})))return list;
  const ids=list.map(()=>randId());S.flashId=ids[0];
  const res=await Promise.all(list.map((o,i)=>putRow(ids[i],{t:"artikel",boxNr:nr,name:o.name,menge:o.menge??1,erstellt:new Date(Date.now()+i).toISOString()})));
  const failed=list.filter((o,i)=>!res[i]);if(!failed.length&&list.length>1)toast(`${list.length} Gegenstände hinzugefügt`);return failed}
function setItem(id,patch){const a=S.artikel.get(id);if(a)return putRow(id,{...a,...patch});return Promise.resolve(false)}
async function deleteBox(nr){const b=S.boxen.get(nr);if(!b)return;S.armed=null;
  const r=await Promise.all(itemsOf(nr).map(([id])=>delRow(id)));if(!r.every(Boolean))return;
  if(!(await delRow(b._id)))return;if(b.foto)removeFoto(b.foto);toast(`Box ${nr} gelöscht, die Nummer ist wieder frei.`);go("suchen")}
async function newOrt(parentId,name){const id=randId();const lvl=parentId?Math.min(2,ortPath(parentId).length):0;
  const ok=await putRow(id,{t:"ort",name:String(name||NEU[lvl]).slice(0,80),parentId:parentId||"",sort:childrenOf(parentId).length});return ok?id:null}

async function fetchAll(){const rows=[];for(let from=0;;from+=1000){const {data,error}=await sb.from("daten").select("id,blob").neq("id",KEY_ID).order("id").range(from,from+999);if(error)throw error;rows.push(...data);if(data.length<1000)break}
  const map=new Map;let bad=0;await Promise.all(rows.map(async r=>{try{map.set(r.id,await unseal(r.blob,r.id))}catch(e){bad++}}));return {map,bad}}
async function loadAll(quiet){if(!quiet){S.phase="app";S.status="connecting";render()}
  try{subscribe();await Promise.all(Object.values(WQ));const since=SEQ;const {map,bad}=await fetchAll();
    CONF.clear();for(const [id,o] of map)CONF.set(id,o);
    for(const [id,t] of TOUCH){if(t.seq>since){t.val===undefined?map.delete(id):map.set(id,t.val)}else TOUCH.delete(id)}
    S.rows=map;S.bad=bad;rebuild();S.loaded=true;S.status="ok";S.lastLoad=Date.now();render()}
  catch(e){S.status="bad";S.gateMsg=errText(e);render()}}
async function handleRT(p){
  if(p.eventType==="DELETE"){const id=p.old?.id;if(!id||id===KEY_ID)return;CONF.delete(id);if(PEND.get(id))return;if(S.rows.has(id))localSet(id,undefined);return}
  const r=p.new;if(!r||r.id===KEY_ID)return;if(SENT.delete(r.blob))return;
  const o=await unseal(r.blob,r.id);CONF.set(r.id,o);if(PEND.get(r.id))return;localSet(r.id,o)}
function subscribe(){if(S.chan||!sb.channel)return;
  S.chan=sb.channel("daten-live").on("postgres_changes",{event:"*",schema:"public",table:"daten"},p=>{RTQ=RTQ.then(()=>handleRT(p)).catch(()=>{})}).subscribe()}

/* ---------- Fotos (verschlüsselt, auf 64 KiB aufgefüllt, im privaten Speicher) ---------- */
const fotoCache=new Map();
async function uploadFoto(blob){const path=randId()+".bin";const raw=new Uint8Array(await blob.arrayBuffer());
  const framed=new Uint8Array(Math.ceil((raw.length+4)/65536)*65536);new DataView(framed.buffer).setUint32(0,raw.length);framed.set(raw,4);
  const sealed=await sealBytes(framed,"foto:"+path);
  const {error}=await sb.storage.from("fotos").upload(path,new Blob([sealed],{type:"application/octet-stream"}),{contentType:"application/octet-stream",upsert:false});if(error)throw error;
  fotoCache.set(path,Promise.resolve(URL.createObjectURL(blob)));return path}
function fotoUrl(path){if(!fotoCache.has(path))fotoCache.set(path,(async()=>{const {data,error}=await sb.storage.from("fotos").download(path);if(error)throw error;
    const pt=await openBytes(await data.arrayBuffer(),"foto:"+path);const len=new DataView(pt.buffer,pt.byteOffset).getUint32(0);
    return URL.createObjectURL(new Blob([pt.subarray(4,4+len)],{type:"image/jpeg"}))})().catch(e=>{fotoCache.delete(path);throw e}));return fotoCache.get(path)}
function removeFoto(path){sb.storage.from("fotos").remove([path]).catch(()=>{});fotoCache.delete(path)}
function hydrateFotos(){document.querySelectorAll("img[data-foto]").forEach(im=>{const p=im.dataset.foto;fotoUrl(p).then(u=>{if(im.dataset.foto===p)im.src=u}).catch(()=>{im.alt="Foto nicht ladbar"})})}

/* ---------- Suche ---------- */
function search(q){const toks=norm(q).split(/\s+/).filter(Boolean);if(!toks.length)return null;const items=[],boxes=[];
  for(const [id,a] of S.artikel){const b=S.boxen.get(a.boxNr);const own=norm(a.name),ctx=norm([b?.name,ortName(b?.ortId)].join(" "));
    if(toks.every(t=>own.includes(t)||ctx.includes(t))&&toks.some(t=>own.includes(t)))items.push({id,a,b,s:own.startsWith(toks[0])?0:1})}
  for(const [nr,b] of S.boxen){const hay=norm([b.name,ortName(b.ortId)].join(" "));if(toks.every(t=>hay.includes(t)))boxes.push([nr,b])}
  items.sort((x,y)=>x.s-y.s||norm(x.a.name).localeCompare(norm(y.a.name)));boxes.sort((x,y)=>parseInt(x[0],10)-parseInt(y[0],10));return {toks,items,boxes}}

/* ---------- Darstellung ---------- */
let rq;function scheduleRender(){if(rq)return;rq=setTimeout(()=>{rq=null;render()},16)}
function saveField(t){if(!t||S.phase!=="app"||!t.matches)return;
  if(t.id==="bx-name"){const v=t.value.trim().slice(0,80);const b=S.boxen.get(S.boxNr);if(v!==(b?.name||"")&&(b||v))saveBox(S.boxNr,{name:v})}
  else if(t.classList.contains("ie-name")){const v=t.value.trim().slice(0,120);const a=S.artikel.get(t.dataset.id);if(a&&v&&v!==a.name)setItem(t.dataset.id,{name:v})}
  else if(t.classList.contains("en-in")){const v=t.value.trim().slice(0,80);const o=S.orte.get(t.dataset.ort);if(o&&v&&v!==o.name)putRow(t.dataset.ort,{...o,name:v})}}
function render(){
  const gate=S.phase!=="app";document.body.classList.toggle("gate",gate);
  const st=$("#status");st.textContent=gate?"Privat · verschlüsselt":S.status==="ok"?"Verschlüsselt · verbunden":S.status==="bad"?"Keine Verbindung":"Verbinde …";
  st.className="eyebrow status "+(S.status==="ok"&&!gate?"ok":S.status==="bad"?"bad":"");
  $("#helpbtn").hidden=gate&&!["denied","unlock","error"].includes(S.phase);
  const m=$("#main");const ae=document.activeElement;
  if(gate){m.innerHTML=viewGate();if(S.focusId){const el=document.getElementById(S.focusId);S.focusId=null;el?.focus()}return}
  if(ae&&ae.matches?.("#bx-name,.ie-name,.en-in"))saveField(ae);
  const navV=S.view==="box"?S.lastView:S.view;
  document.querySelectorAll("#nav [data-v]").forEach(b=>b.setAttribute("aria-current",String(b.dataset.v===navV&&!S.q.trim())));
  $("#qclear").hidden=!S.q;
  const aid=ae?.id,sel=[ae?.selectionStart,ae?.selectionEnd];
  m.innerHTML=S.q.trim()&&S.view!=="box"?viewSearch():({suchen:viewHome,box:viewBox,uebersicht:viewUebersicht,etiketten:viewEtiketten}[S.view]||viewHome)();
  if(S.focusId){const el=document.getElementById(S.focusId);S.focusId=null;if(el){el.focus();try{el.select()}catch(e){}}}
  else if(aid&&aid!=="q"){const el=document.getElementById(aid);if(el&&el!==ae&&m.contains(el)){if(el.tagName==="INPUT"&&el.type!=="checkbox")el.value=ae.value;el.focus();try{el.setSelectionRange(sel[0],sel[1])}catch(e){}}}
  hydrateFotos();
  if(S.view==="etiketten"&&!S.q.trim())drawPreview();
  if(S.flashId){const el=document.querySelector(`[data-item="${S.flashId}"]`);if(el){el.classList.add("flash");el.scrollIntoView({block:"center",behavior:"smooth"})}S.flashId=null}
}
const VH=`<input type="text" class="vh" autocomplete="username" value="Kellerboxen Haushalts-Schlüssel" readonly tabindex="-1" aria-hidden="true">`;
function viewGate(){const msg=`<p class="err"${S.gateMsg?' role="alert"':""}>${esc(S.gateMsg)}</p>`;
  if(S.phase==="config")return `<section class="gatecard"><h2 class="h">Noch nicht eingerichtet</h2><p class="muted">Die App ist noch nicht mit der Datenbank verbunden. Die Adresse und den öffentlichen Schlüssel in <code>config.js</code> eintragen.</p></section>`;
  if(S.phase==="start")return `<p class="muted" style="margin-top:22px"><span class="spin"></span> Lädt …</p>`;
  if(S.phase==="login")return `<section class="gatecard"><span class="eyebrow">Anmelden</span><h2 class="h">Willkommen</h2>
    <form id="loginform" novalidate><div class="fld"><label for="lg-mail">E-Mail</label><input id="lg-mail" type="email" autocomplete="username" inputmode="email" value="${esc(S.gateEmail)}" required></div>
    <div class="fld"><label for="lg-pw">Passwort</label><input id="lg-pw" type="password" autocomplete="current-password" required></div>${msg}
    <button class="btn big">Anmelden</button></form>
    <p class="muted small">Nur freigeschaltete Konten können sich anmelden. Hier das Login-Passwort eingeben, nicht den Haushalts-Schlüssel.</p></section>`;
  if(S.phase==="denied")return `<section class="gatecard"><h2 class="h">Nicht freigeschaltet</h2><p class="muted">Das Konto ${esc(S.user?.email||"")} hat keinen Zugang zu diesen Boxen. Ein Verwalter kann die Adresse freischalten.</p><div><button class="btn ghost" data-act="logout">Abmelden</button></div></section>`;
  if(S.phase==="setup"){const code=S.setupCode||(S.setupCode=genCode());
    return `<section class="gatecard"><span class="eyebrow">Einmalig</span><h2 class="h">Haushalts-Schlüssel</h2>
    <p class="muted">Damit werden alle Boxen, Räume, Inhalte und Fotos verschlüsselt, bevor sie gespeichert werden. Niemand ohne diesen Schlüssel kann sie lesen, auch nicht der Datenbank-Anbieter. Alle Mitglieder brauchen denselben Schlüssel.</p>
    ${S.setupOwn?`<form id="setupform" novalidate>${VH}<div class="fld"><label for="su-1">Eigener Schlüssel (mindestens 20 Zeichen)</label><input id="su-1" type="password" autocomplete="new-password" minlength="20" required></div>
      <div class="fld"><label for="su-2">Nochmals</label><input id="su-2" type="password" autocomplete="new-password" required></div>${msg}
      <button class="btn big">Schlüssel festlegen</button><button type="button" class="linkbtn" data-act="own-off">Doch den erzeugten Code nehmen</button></form>`
    :`<div class="codebox" id="su-code" aria-label="Erzeugter Schlüssel">${esc(code)}</div>
      <div class="row"><button type="button" class="btn ghost sm" data-act="copy-code">Kopieren</button><button type="button" class="btn ghost sm" data-act="new-code">Neuen Code erzeugen</button></div>
      <div class="warn small"><b>Jetzt sichern:</b> Den Code als eigenen Eintrag im Passwort-Manager speichern (nicht beim Login-Passwort) und den anderen Mitgliedern geben. Ohne ihn lassen sich die Daten nicht wiederherstellen.</div>
      <form id="setupform" novalidate>${VH}<div class="fld"><label for="su-2">Zur Kontrolle den Code eingeben oder einfügen</label><input id="su-2" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" required></div>${msg}
      <button class="btn big">Schlüssel festlegen</button></form>
      <button type="button" class="linkbtn" data-act="own-on">Lieber einen eigenen, langen Schlüssel wählen</button>`}</section>`}
  if(S.phase==="unlock")return `<section class="gatecard"><span class="eyebrow">Entsperren</span><h2 class="h">Haushalts-Schlüssel</h2>
    <p class="muted">Einmal pro Gerät eingeben. Danach merkt sich dieses Gerät den Schlüssel in nicht auslesbarer Form, der Code selbst wird nicht gespeichert.</p>
    <form id="unlockform" novalidate>${VH}<div class="fld"><label for="ul-pw">Haushalts-Schlüssel</label><input id="ul-pw" type="password" autocomplete="current-password" autocapitalize="${S.keyInfo?.kind==="code"?"characters":"off"}" spellcheck="false" required></div>${msg}
    <button class="btn big">Entsperren</button></form>
    <div><button class="linkbtn" data-act="logout">Abmelden</button></div></section>`;
  return `<section class="gatecard"><h2 class="h">Das hat nicht geklappt</h2>${msg}<div class="row"><button class="btn" data-act="reload">Nochmals versuchen</button>${S.user?`<button class="btn ghost" data-act="logout">Abmelden</button>`:""}</div></section>`}
function loadingOr(fn){if(!S.loaded)return S.status==="bad"?`<div class="empty"><b>Keine Verbindung</b><span class="muted">${esc(S.gateMsg||"Internet prüfen.")}</span><div><button class="btn sm" data-act="reload">Nochmals laden</button></div></div>`:`<p class="muted" style="margin-top:22px"><span class="spin"></span> Boxen werden geladen …</p>`;
  return (S.bad?`<div class="warn small" style="margin-bottom:10px">${S.bad} Einträge liessen sich nicht entschlüsseln.</div>`:"")+fn()}
function boxRow(nr,b,count){return `<button class="li" data-open="${esc(nr)}"><span class="bno">${esc(nr)}</span><span class="t"><b>${b.name?esc(b.name):'<span class="muted">Ohne Bezeichnung</span>'}</b><small>${esc(whereText(b))} · ${count} ${count===1?"Gegenstand":"Gegenstände"}</small></span><span class="chev">›</span></button>`}
function freeRow(nr){return `<button class="li" data-open="${esc(nr)}"><span class="bno free">${esc(nr)}</span><span class="t"><b>Box ${esc(nr)} ist noch frei</b><small>Antippen, um sie einzurichten</small></span><span class="chev">›</span></button>`}

function viewHome(){return loadingOr(()=>{
  const nf=nextFree();
  if(!S.boxen.size)return `<section class="card" style="margin-top:6px"><span class="eyebrow">So geht's</span><h2 class="h">Ordnung in drei Schritten</h2>
    <ol class="steps"><li><div><b>Etiketten drucken</b><span>Im Reiter «Etiketten» die Nummern wählen, das PDF drucken und die Etiketten auf die Boxen kleben.</span></div></li>
    <li><div><b>Box öffnen</b><span>Die Nummer oben ins Suchfeld tippen oder mit «Scannen» die Kamera aufs Etikett halten.</span></div></li>
    <li><div><b>Standort und Inhalt</b><span>Antippen, wo die Box steht, dann eintippen, was drin ist. Gespeichert wird sofort und verschlüsselt.</span></div></li></ol>
    <div class="row"><button class="btn" data-open="${nf}">Box ${nf} einrichten</button><button class="btn ghost" data-v="etiketten">Etiketten drucken</button></div></section>`;
  const cnt=itemCount(),last=lastActivity();const recent=sortedBoxes().sort((x,y)=>(last.get(y[0])||"").localeCompare(last.get(x[0])||"")).slice(0,6);
  return `<div class="stats"><span><b>${S.boxen.size}</b>${S.boxen.size===1?"Box":"Boxen"}</span><span><b>${S.artikel.size}</b>Gegenstände</span></div>
  <p class="muted small">Nummer oben eintippen oder Etikett scannen. Nächste freie Nummer: <button class="linkbtn" style="padding:0" data-open="${nf}">${nf}</button></p>
  <div class="sec">Zuletzt bearbeitet</div><div class="list">${recent.map(([nr,b])=>boxRow(nr,b,cnt.get(nr)||0)).join("")}</div>
  <button class="linkbtn" data-v="uebersicht" style="margin-top:8px">Alle Boxen nach Standort ›</button>`})}

function viewSearch(){return loadingOr(()=>{const nr=parseNr(S.q);const cnt=itemCount();let h="";
  if(nr){const b=S.boxen.get(nr);h+=`<div class="sec">Box</div><div class="list">${b?boxRow(nr,b,cnt.get(nr)||0):freeRow(nr)}</div>`}
  const r=nr?null:search(S.q);
  if(r?.items.length)h+=`<div class="sec">${r.items.length} ${r.items.length===1?"Gegenstand":"Gegenstände"}</div><div class="list">${r.items.slice(0,150).map(({id,a,b})=>`<button class="li" data-open="${esc(a.boxNr)}" data-flash="${esc(id)}"><span class="bno">${esc(a.boxNr)}</span><span class="t"><b>${hl(a.name,r.toks)}</b><small>${b?.name?esc(b.name)+" · ":""}${esc(whereText(b))}</small></span><span class="qty">${esc(a.menge??1)}×</span></button>`).join("")}</div>`;
  if(r?.boxes.length)h+=`<div class="sec">Boxen</div><div class="list">${r.boxes.map(([n,b])=>boxRow(n,b,cnt.get(n)||0)).join("")}</div>`;
  if(!nr&&!r?.items.length&&!r?.boxes.length)h+=`<div class="empty"><b>Nichts gefunden für «${esc(S.q)}»</b><span class="muted">Einen kürzeren Begriff versuchen, z. B. «kabel». Eine Zahl öffnet die Box mit dieser Nummer.</span></div>`;
  return h})}

function pickerHtml(ortId){const path=ortPath(ortId).map(x=>x[0]);let h="";
  for(let l=0;l<3;l++){const pid=l?path[l-1]:"";if(l&&!pid)break;const opts=childrenOf(pid);
    h+=`<div class="pk"><span class="pk-l">${LEVEL[l]}${l?" · freiwillig":""}</span><div class="chips">${opts.map(([id,o])=>`<button type="button" class="chip" data-pk="${l}" data-id="${esc(id)}" aria-pressed="${path[l]===id}">${esc(o.name)}</button>`).join("")}${S.pickAdd===l?`<span class="pk-new"><input id="pk-new" placeholder="${esc(PH[l])}" enterkeyhint="done" autocomplete="off" maxlength="80" aria-label="${NEU[l]}"><button type="button" class="btn sm" data-pk-ok="${l}">OK</button></span>`:`<button type="button" class="chip add" data-pk-add="${l}">${ADD[l]}</button>`}</div></div>`}
  return h}
function viewBox(){return loadingOr(()=>{
  const nr=S.boxNr,b=S.boxen.get(nr),items=itemsOf(nr),path=b?ortPath(b.ortId):[];
  const showPick=S.pickOpen||!path.length;
  const itemsHtml=items.map(([id,a])=>S.itemEdit===id?`<div class="it edit" data-item="${esc(id)}"><input id="ie-${esc(id)}" class="ie-name" data-id="${esc(id)}" value="${esc(a.name)}" maxlength="120" enterkeyhint="done" aria-label="Bezeichnung">
      <div class="row between"><div class="stepper"><button type="button" class="btn ghost" data-qty="-1" data-id="${esc(id)}" aria-label="Eins weniger">−</button><span class="v">${esc(a.menge??1)}</span><button type="button" class="btn ghost" data-qty="1" data-id="${esc(id)}" aria-label="Eins mehr">+</button></div>
      <div class="row"><button type="button" class="btn danger sm${S.armed==="i-"+id?" armed":""}" data-del-item="${esc(id)}">${S.armed==="i-"+id?"Wirklich entfernen?":"Entfernen"}</button><button type="button" class="btn sm" data-item-done>Fertig</button></div></div></div>`
    :`<button class="it" data-item="${esc(id)}" data-item-edit="${esc(id)}"><span class="n">${esc(a.name)}</span><span class="qty">${esc(a.menge??1)}×</span></button>`).join("");
  return `<button class="back" data-nav="back">‹ Zurück</button>
  <section class="bcard">
    <div class="bc-head"><div class="bc-no" aria-label="Box ${esc(nr)}">${esc(nr)}</div>
      <div class="bc-main"><input id="bx-name" class="bc-name" value="${esc(b?.name||"")}" placeholder="Bezeichnung, z. B. Weihnachtsdeko" autocomplete="off" maxlength="80" enterkeyhint="done" aria-label="Bezeichnung der Box">
        ${b?"":`<span class="muted small">Neue Box. Wähle unten den Standort und erfasse den Inhalt. Alles wird sofort gespeichert.</span>`}</div>
      ${b?.foto?`<button class="bc-photo" data-zoom="${esc(b.foto)}" aria-label="Foto gross anzeigen"><img data-foto="${esc(b.foto)}" alt="Foto der Box"></button>`:""}</div>
    ${path.length&&!S.pickOpen?`<div class="bc-where">${ICON.pin}<span class="w">${path.map(([,o],i)=>i?esc(o.name):`<b>${esc(o.name)}</b>`).join('<span class="sep">›</span>')}</span><button class="linkbtn" style="padding:0" data-act="pick">Ändern</button></div>`:""}
    ${showPick?`<div class="pickwrap"><span class="eyebrow">Wo steht die Box?</span>${pickerHtml(b?.ortId)}${path.length?`<div><button class="btn sm" data-act="pick-done">Fertig</button></div>`:""}</div>`:""}
  </section>
  <div class="sec row between" style="margin-bottom:0"><span>Inhalt${items.length?` · ${items.length}`:""}</span><label class="btn ghost sm" for="photoIn" data-photo-nr="${esc(nr)}" role="button" tabindex="0">${ICON.cam}${b?.foto?"Neues Foto":"Foto"}</label></div>
  <form class="quick" id="addform"><input id="add" value="${esc(S.addDraft)}" placeholder="Gegenstand eintippen, z. B. 2x Skihelm" autocomplete="off" enterkeyhint="done" maxlength="2000" aria-label="Gegenstand hinzufügen"><button class="btn" aria-label="Hinzufügen">+</button></form>
  ${items.length?`<div class="items">${itemsHtml}</div>`:`<p class="muted small">Noch nichts erfasst. Tipp: Eine Liste mit mehreren Zeilen ins Feld einfügen, dann kommen alle auf einmal.</p>`}
  ${b?`<div class="danger-zone"><button class="btn danger sm${S.armed==="box"?" armed":""}" data-act="del-box">${S.armed==="box"?`Wirklich Box ${esc(nr)} mit Inhalt löschen?`:"Box löschen"}</button></div>`:""}`})}

function viewUebersicht(){return loadingOr(()=>{
  let h=`<div class="pagehead"><div><span class="eyebrow">Übersicht</span><h2 class="h">Wo steht was</h2></div><button class="btn ghost sm" data-act="toggle-edit">${S.edit?"Fertig":"Orte bearbeiten"}</button></div>`;
  if(S.edit)return h+editTree();
  const rooms=childrenOf("");
  if(!rooms.length)return h+`<div class="empty"><b>Noch keine Räume</b><span class="muted">Mit «Orte bearbeiten» legst du Räume, Regale und Fächer an. Oder unter «?» eine Sicherung importieren.</span></div>`;
  const chip=([nr,b])=>`<button class="bchip" data-open="${esc(nr)}"><b>${esc(nr)}</b><span>${esc(b.name||"")}</span></button>`;
  const at=oid=>sortedBoxes().filter(([,b])=>b.ortId===oid);
  h+=rooms.map(([rid,r])=>{const all=boxesUnder(rid);
    const shelves=childrenOf(rid).map(([gid,g])=>{if(!boxesUnder(gid).length)return "";
      const rows=childrenOf(gid).map(([tid,t])=>{const bx=boxesUnder(tid);return bx.length?`<div class="fach"><span class="fach-l">${esc(t.name)}</span><div class="bchips">${bx.map(chip).join("")}</div></div>`:""}).join("");
      const lo=at(gid);return `<div class="shelf"><div class="shelf-h">${esc(g.name)}</div>${rows}${lo.length?`<div class="fach"><span class="fach-l">ohne Fach</span><div class="bchips">${lo.map(chip).join("")}</div></div>`:""}</div>`}).join("");
    const lo=at(rid);
    return `<section class="room"><div class="room-h"><h3>${esc(r.name)}</h3><span class="num muted small">${all.length} ${all.length===1?"Box":"Boxen"}</span></div>${all.length?shelves+(lo.length?`<div class="fach"><span class="fach-l">direkt im Raum</span><div class="bchips">${lo.map(chip).join("")}</div></div>`:""):`<span class="muted small">Noch keine Box.</span>`}</section>`}).join("");
  const none=sortedBoxes().filter(([,b])=>!ortPath(b.ortId).length);
  if(none.length)h+=`<section class="room"><div class="room-h"><h3>Ohne Standort</h3><span class="num muted small">${none.length}</span></div><div class="bchips">${none.map(chip).join("")}</div></section>`;
  return h})}
function editTree(){const node=(id,o,l)=>`<div class="en l${l}"><input class="en-in" id="on-${esc(id)}" data-ort="${esc(id)}" value="${esc(o.name)}" maxlength="80" enterkeyhint="done" aria-label="${LEVEL[l]} umbenennen"><button type="button" class="xbtn${S.armed==="o-"+id?" armed":""}" data-del-ort="${esc(id)}" aria-label="${esc(o.name)} löschen">${S.armed==="o-"+id?"Löschen?":"×"}</button></div>`;
  let h=`<p class="muted small" style="margin-top:0">Namen antippen und ändern. Mit × löschen; Boxen dort landen dann unter «Ohne Standort».</p><div class="etree">`;
  for(const [rid,r] of childrenOf("")){h+=`<div class="eroom">${node(rid,r,0)}`;
    for(const [gid,g] of childrenOf(rid)){h+=node(gid,g,1);for(const [tid,t] of childrenOf(gid))h+=node(tid,t,2);h+=`<button class="btn ghost sm addl2" data-add-ort="${esc(gid)}">${ADD[2]}</button>`}
    h+=`<button class="btn ghost sm addl1" data-add-ort="${esc(rid)}">${ADD[1]}</button></div>`}
  return h+`</div><button class="btn" data-add-ort="">${ADD[0]}</button>`}

/* ---------- Etiketten ---------- */
function lblDefaults(){const m=S.meta||{};const start=Math.min(PER,Math.max(1,S.lbl.start??(m.freiAb||1)));const von=Math.max(1,S.lbl.von??((m.bisNr||0)+1));const bis=Math.max(von,S.lbl.bis??(von+(PER-start)));return {start,von,bis}}
function lblItems(){const {start,von,bis}=lblDefaults();const items=[];for(let n=von;n<=Math.min(bis,von+209,999);n++)items.push({nr:padNr(n)});return {items,start,slots:[...Array(start-1).fill(null),...items]}}
function viewEtiketten(){return loadingOr(()=>{
  const {start,von,bis}=lblDefaults(),{items,slots}=lblItems(),pages=Math.max(1,Math.ceil(slots.length/PER));
  const onFirst=new Map();slots.slice(0,PER).forEach((it,i)=>{if(it)onFirst.set(i+1,it.nr)});
  const map=`<div class="sheetmap" role="group" aria-label="Etikettenbogen">${Array.from({length:PER},(_,i)=>{const pos=i+1,st=pos<start?"used":onFirst.has(pos)?"print":"free";return `<button type="button" class="slot ${st}" data-start="${pos}" aria-label="Druck bei Etikett ${pos} beginnen">${st==="print"?esc(onFirst.get(pos)):""}</button>`}).join("")}</div>`;
  return `<div class="pagehead"><div><span class="eyebrow">Etiketten</span><h2 class="h">Nummern drucken</h2></div></div>
  <p class="muted small" style="margin-top:0">Für HERMA-Etiketten 63,5 × 38,1 mm, 21 Stück pro A4-Bogen. Jedes Etikett trägt einen QR-Code, die Nummer und einen Strich zum Beschriften. Der QR-Code enthält nur die Adresse der App und die Boxnummer, keinen Inhalt.</p>
  <div class="two"><div class="f"><label for="lbl-von">Von Nr.</label><input id="lbl-von" type="number" min="1" max="999" inputmode="numeric" value="${von}"></div><div class="f"><label for="lbl-bis">Bis Nr.</label><input id="lbl-bis" type="number" min="1" max="999" inputmode="numeric" value="${bis}"></div></div>
  ${S.meta?.bisNr?`<p class="muted small">Bisher gedruckt bis Nr. ${esc(padNr(S.meta.bisNr))}.</p>`:""}
  <div class="sec">Erstes freies Etikett auf dem Bogen</div>
  <div class="row" style="align-items:flex-start;gap:16px">${map}<div style="flex:1 1 170px;min-width:0" class="small"><p class="muted" style="margin-top:0">Tippe auf das erste freie Etikett. Schraffiert ist schon gebraucht, grün wird gedruckt.</p><p><b>${items.length} ${items.length===1?"Etikett":"Etiketten"}</b> auf ${pages} Bogen.</p></div></div>
  <div class="sec">Vorschau Bogen 1</div><div class="lbl-prev"><canvas id="prev" width="1240" height="1754"></canvas></div>
  <div class="row" style="margin-top:16px"><button class="btn big" data-act="save-pdf" ${items.length?"":"disabled"}>A4-PDF erstellen</button></div>
  <p class="muted small">Beim Drucken «Tatsächliche Grösse» bzw. 100 % wählen. Zuerst auf Normalpapier testen und gegen den Bogen halten.</p>`})}
function boxUrl(nr){return APP_URL+"#box-"+nr}
const LBL_FONT='"Century Gothic","Zen Kaku Gothic New",sans-serif',CAP=0.72;
function drawLabel(ctx,it,x,y,w,h){
  const k=h/38.1,pad=3.6*k,q=27*k;
  const qr=qrcode(0,"M");qr.addData(boxUrl(it.nr));qr.make();const n=qr.getModuleCount(),quiet=2,cell=q/(n+2*quiet);
  const qx=x+pad*0.75,qy=y+(h-q)/2,dt=qy+quiet*cell,db=qy+q-quiet*cell;
  ctx.save();ctx.fillStyle="#000";
  for(let r=0;r<n;r++){const y0=Math.round(qy+(r+quiet)*cell),y1=Math.round(qy+(r+quiet+1)*cell);
    for(let c=0;c<n;c++)if(qr.isDark(r,c)){const x0=Math.round(qx+(c+quiet)*cell),x1=Math.round(qx+(c+quiet+1)*cell);ctx.fillRect(x0,y0,x1-x0,y1-y0)}}
  const tx=qx+q+1.2*k,tw=x+w-pad-tx;
  let fs=Math.min(21*k,((db-dt)-9*k)/CAP);ctx.font=`700 ${fs}px ${LBL_FONT}`;
  while(ctx.measureText(it.nr).width>tw&&fs>8*k){fs-=0.5;ctx.font=`700 ${fs}px ${LBL_FONT}`}
  ctx.textBaseline="alphabetic";ctx.fillStyle="#121212";ctx.fillText(it.nr,tx,dt+CAP*fs);
  ctx.strokeStyle="#595959";ctx.lineWidth=0.3*k;ctx.beginPath();ctx.moveTo(tx,db);ctx.lineTo(tx+tw,db);ctx.stroke();
  ctx.restore()}
function sheetCanvas(slots,page,scale=1){const mm=300/25.4*scale;const c=document.createElement("canvas");c.width=Math.round(210*mm);c.height=Math.round(297*mm);drawSheetTo(c,slots,page,mm,false);return c}
function drawSheetTo(c,slots,page,mm,preview){const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
  for(let i=0;i<PER;i++){const idx=page*PER+i,it=slots[idx];const col=i%SHEET.cols,row=Math.floor(i/SHEET.cols);const x=(SHEET.left+col*SHEET.px)*mm,y=(SHEET.top+row*SHEET.py)*mm,w=SHEET.w*mm,h=SHEET.h*mm;
    if(preview){ctx.save();if(idx<slots.length&&!it){ctx.fillStyle="#ECEAE4";ctx.fillRect(x,y,w,h)}ctx.strokeStyle="#D6D2C8";ctx.lineWidth=Math.max(1,mm*0.2);ctx.setLineDash(it?[]:[mm*1.2,mm*1.2]);ctx.strokeRect(x,y,w,h);ctx.restore()}
    if(it)drawLabel(ctx,it,x,y,w,h)}}
async function lblFonts(){try{await Promise.all([document.fonts.load(`700 40px "Century Gothic"`),document.fonts.load(`700 40px "Zen Kaku Gothic New"`)])}catch(e){}}
async function drawPreview(){const c=$("#prev");if(!c||typeof qrcode==="undefined")return;await lblFonts();if(!document.body.contains(c))return;drawSheetTo(c,lblItems().slots,0,c.width/210,true)}
function lblName({items}){const a=items[0]?.nr,z=items[items.length-1]?.nr;return `Kellerboxen Etiketten ${a===z?a:a+"-"+z} (HERMA 63x38).pdf`}
async function recordPrint(){const {items,start}=lblItems();const used=start-1+items.length;const m=S.meta||{};
  const id=S.metaId||await tagId("meta:etiketten");
  await putRow(id,{t:"meta",bisNr:Math.max(m.bisNr||0,...items.map(i=>parseInt(i.nr,10)||0)),freiAb:used%PER===0?1:(used%PER)+1,zeit:new Date().toISOString()});
  S.lbl={von:null,bis:null,start:null};render();toast(`Gemerkt: nächstes Mal ab Nr. ${padNr((S.meta.bisNr||0)+1)}, Start bei Etikett ${S.meta.freiAb}.`)}
async function savePdf(){if(!window.jspdf){toast("PDF-Modul nicht geladen. Seite neu laden.");return}
  const L=lblItems();if(!L.items.length)return;toast("PDF wird erstellt …");await lblFonts();
  let blob;try{const pages=Math.ceil(L.slots.length/PER);const doc=new window.jspdf.jsPDF({unit:"mm",format:"a4",orientation:"portrait",compress:true});
    for(let p=0;p<pages;p++){if(p)doc.addPage();doc.addImage(sheetCanvas(L.slots,p).toDataURL("image/png"),"PNG",0,0,210,297,undefined,"FAST")}
    doc.setProperties({title:"Kellerboxen Etiketten"});blob=doc.output("blob")}catch(e){toast("PDF konnte nicht erstellt werden.");return}
  const url=URL.createObjectURL(blob),name=lblName(L);let done=false;
  openSheet(`<span class="eyebrow">Etiketten</span><h3>PDF ist bereit</h3><span class="muted small">${esc(name)}</span>
  <div class="row"><a class="btn big" id="pdf-open" href="${url}" target="_blank" rel="noopener">PDF öffnen und drucken</a><a class="btn ghost" id="pdf-save" href="${url}" download="${esc(name)}">Speichern</a></div>
  <p class="muted small" style="margin:0">Beim Drucken «Tatsächliche Grösse» bzw. 100 % wählen.</p>
  <div class="foot"><button type="button" class="btn ghost" data-close>Schliessen</button></div>`,sh=>{
    const mark=()=>{if(!done){done=true;recordPrint()}};sh.querySelector("#pdf-open").addEventListener("click",mark);sh.querySelector("#pdf-save").addEventListener("click",mark)},
    ()=>setTimeout(()=>URL.revokeObjectURL(url),60000))}

/* ---------- Bilder, Fotos, Scannen ---------- */
async function decodeImage(file){if(window.createImageBitmap){try{return await createImageBitmap(file,{imageOrientation:"from-image"})}catch(e){try{return await createImageBitmap(file)}catch(e2){}}}
  return await new Promise((res,rej)=>{const u=URL.createObjectURL(file);const im=new Image();im.onload=()=>res(im);im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("decode"))};im.src=u})}
function scaledCanvas(src,max){const w=src.videoWidth||src.width||src.naturalWidth,h=src.videoHeight||src.height||src.naturalHeight;const k=Math.min(1,max/Math.max(w,h));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));const x=c.getContext("2d",{willReadFrequently:true});x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(src,0,0,c.width,c.height);return c}
async function toJpeg(file,max=1600,q=0.85){const im=await decodeImage(file);const c=scaledCanvas(im,max);const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",q));if(!blob)throw new Error("encode");return blob}
async function handlePhoto(file,nr){if(!file||!nr)return;toast("Foto wird verschlüsselt und gespeichert …");
  let blob;try{blob=await toJpeg(file)}catch(e){toast("Dieses Foto lässt sich nicht öffnen.");return}
  let path;try{path=await uploadFoto(blob)}catch(e){toast(isNet(e)?"Keine Verbindung, Foto nicht gespeichert.":"Foto konnte nicht gespeichert werden.");return}
  const old=S.boxen.get(nr)?.foto;if(!(await saveBox(nr,{foto:path}))){removeFoto(path);return}if(old&&old!==path)removeFoto(old);toast("Foto gespeichert")}
let jsqrP;function loadJsQR(){if(window.jsQR)return Promise.resolve();return jsqrP||(jsqrP=new Promise((res,rej)=>{const s=document.createElement("script");s.src="vendor/jsQR.min.js";s.onload=res;s.onerror=()=>{jsqrP=null;rej(new Error("jsqr"))};document.head.appendChild(s)}))}
function labelNr(t){if(!t)return null;const m=/#box-0*(\d{1,3})\b/.exec(t)||/^\s*0*(\d{1,3})\s*$/.exec(t);if(!m)return null;const n=+m[1];return n>=1&&n<=999?padNr(n):null}
let qrDet;async function readQR(src){if(qrDet===undefined){qrDet=null;if("BarcodeDetector" in window){try{const f=await BarcodeDetector.getSupportedFormats();if(f.includes("qr_code"))qrDet=new BarcodeDetector({formats:["qr_code"]})}catch(e){}}}
  if(qrDet){try{const r=await qrDet.detect(src);if(r&&r[0])return r[0].rawValue}catch(e){}}
  await loadJsQR();for(const max of [900,1400,600]){const c=scaledCanvas(src,max);const d=c.getContext("2d").getImageData(0,0,c.width,c.height);const r=window.jsQR(d.data,c.width,c.height,{inversionAttempts:"attemptBoth"});if(r)return r.data}
  return null}
function found(txt){const nr=labelNr(txt);if(nr){openBox(nr);toast(S.boxen.has(nr)?`Box ${nr}`:`Box ${nr} ist neu`);return true}toast("Das ist kein Kellerboxen-Etikett.");return false}
async function scanFile(file){if(!file)return;toast("Etikett wird gelesen …");let txt=null;try{txt=await readQR(await decodeImage(file))}catch(e){}
  if(txt)found(txt);else toast("Kein QR-Code erkannt. Etikett gross ins Bild nehmen oder die Nummer oben eintippen.")}
async function openScanner(){
  if(!navigator.mediaDevices?.getUserMedia){$("#scanIn").click();return}
  let stream=null,stop=false,timer=null;
  const end=()=>{stop=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop())};
  openSheet(`<span class="eyebrow">Scannen</span><h3>Kamera aufs Etikett halten</h3><div class="scanbox"><video id="scv" playsinline muted autoplay></video><div class="scanframe"></div></div>
    <p class="muted small" id="scmsg" style="margin:0">Kamera wird gestartet …</p>
    <div class="foot"><label class="btn ghost" for="scanIn" data-close-after>Foto statt Kamera</label><button type="button" class="btn ghost" data-close>Schliessen</button></div>`,null,end);
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:960}},audio:false})}
  catch(e){const m=$("#scmsg");if(m)m.textContent="Kein Kamerazugriff. In den Einstellungen erlauben oder «Foto statt Kamera» nehmen.";return}
  if(stop){end();return}const v=$("#scv");if(!v){end();return}v.srcObject=stream;try{await v.play()}catch(e){}
  const m=$("#scmsg");if(m)m.textContent="QR-Code mittig ins Bild halten.";
  const tick=async()=>{if(stop)return;try{if(v.readyState>=2){const txt=await readQR(v);if(txt&&!stop&&labelNr(txt)){end();closeSheet();found(txt);return}}}catch(e){}timer=setTimeout(tick,250)};tick()}

/* ---------- Sicherung (verschlüsselt) ---------- */
async function exportData(){const data={orte:[...S.orte].map(([id,o])=>({id,name:o.name,parentId:o.parentId||"",sort:o.sort??0})),
    boxen:sortedBoxes().map(([nr,b])=>({nr,name:b.name||"",ortId:b.ortId||""})),
    artikel:[...S.artikel.values()].map(a=>({boxNr:a.boxNr,name:a.name,menge:a.menge??1})),
    meta:{bisNr:S.meta.bisNr||0,freiAb:S.meta.freiAb||1}};
  const ki=S.keyInfo;const file={app:"kellerboxen",version:3,exportiert:new Date().toISOString(),v:ki.v,kind:ki.kind,salt:ki.salt,iter:ki.iter,check:ki.check,
    enc:"v1."+b64(await sealBytes(padTo(TE.encode(JSON.stringify(data)),256),"export:v3"))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(file)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=`kellerboxen-sicherung-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast("Verschlüsselte Sicherung gespeichert. Zum Öffnen braucht es den Haushalts-Schlüssel.")}
async function openExport(d){if(d.version===3){let key=K.aes;
    if(d.salt!==S.keyInfo.salt){const p=await askPass();if(!p)return null;let keys=null;try{keys=await tryPass(p,d)}catch(e){}if(!keys){toast("Der Schlüssel passt nicht zu dieser Sicherung.");return null}key=keys.aes}
    try{return {...JSON.parse(TD.decode(await openBytes(unb64(String(d.enc).slice(3)),"export:v3",key))),exportiert:d.exportiert}}catch(e){toast("Die Sicherung lässt sich nicht entschlüsseln.");return null}}
  if(d.version===2)return d;toast("Unbekanntes Format.");return null}
function askPass(){return new Promise(res=>{openSheet(`<span class="eyebrow">Sicherung</span><h3>Schlüssel dieser Sicherung</h3><form id="askform" novalidate>${VH}<div class="fld"><label for="ask-pw">Haushalts-Schlüssel</label><input id="ask-pw" type="password" autocomplete="current-password" spellcheck="false"></div>
  <div class="foot"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn">Öffnen</button></div></form>`,sh=>{sh.querySelector("#askform").addEventListener("submit",e=>{e.preventDefault();e.stopPropagation();const v=sh.querySelector("#ask-pw").value;res(v);closeSheet()},{capture:true})},()=>res(null))})}
async function importData(file){let d;try{d=JSON.parse(await file.text())}catch(e){toast("Diese Datei kann nicht gelesen werden.");return}
  if(!d||d.app!=="kellerboxen"){toast("Das ist keine Kellerboxen-Sicherung.");return}
  const data=await openExport(d);if(!data)return;
  const orte=Array.isArray(data.orte)?data.orte:[],boxen=Array.isArray(data.boxen)?data.boxen:[],artikel=Array.isArray(data.artikel)?data.artikel:[];
  openSheet(`<span class="eyebrow">Importieren</span><h3>Sicherung übernehmen?</h3><p class="muted">${orte.length} Orte, ${boxen.length} Boxen, ${artikel.length} Gegenstände. Die Daten werden zu den bestehenden hinzugefügt und dabei verschlüsselt. Ein zweiter Import derselben Datei legt nichts doppelt an.</p>
    <div class="foot"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn" id="imp-ok">Übernehmen</button></div>`,sh=>{
    sh.querySelector("#imp-ok").addEventListener("click",async()=>{closeSheet();toast("Wird übernommen …");
      const tag=String(data.exportiert||"");const idMap=new Map;for(const o of orte)idMap.set(String(o.id),await tagId("imp-ort:"+tag+":"+o.id));
      const byId=new Map(orte.map(o=>[String(o.id),o]));const depth=o=>{let d=0,c=o;while(c&&c.parentId&&byId.has(String(c.parentId))&&d<6){c=byId.get(String(c.parentId));d++}return d};
      for(let lv=0;lv<=6;lv++){const lvl=orte.filter(o=>depth(o)===lv);if(!lvl.length)continue;const jobsO=[];
        for(const o of lvl){const name=String(o.name||"").slice(0,80)||"Ohne Namen",pid=idMap.get(String(o.parentId||""))||"";
          const same=childrenOf(pid).find(([id,x])=>norm(x.name)===norm(name));if(same){idMap.set(String(o.id),same[0]);continue}
          jobsO.push(putRow(idMap.get(String(o.id)),{t:"ort",name,parentId:pid,sort:Number(o.sort)||0}))}
        const r=await Promise.all(jobsO);
        if(!r.every(Boolean)){toast("Import abgebrochen: nicht alle Orte gespeichert. Nochmals importieren.");return}}
      const jobs=[];
      for(const b of boxen){const nr=parseNr(String(b.nr));if(!nr)continue;const cur=S.boxen.get(nr);const mapped=idMap.get(String(b.ortId||""))||"";
        jobs.push(saveBox(nr,{name:cur?.name||String(b.name||"").slice(0,80),ortId:cur?.ortId&&S.orte.has(cur.ortId)?cur.ortId:mapped}))}
      const have=new Set([...S.artikel.values()].map(a=>a.boxNr+"|"+norm(a.name)));
      for(const [i,a] of artikel.entries()){const nr=parseNr(String(a.boxNr));if(!nr||!a.name||have.has(nr+"|"+norm(String(a.name).slice(0,120))))continue;const id=await tagId("imp-art:"+tag+":"+i);
        jobs.push(putRow(id,{t:"artikel",boxNr:nr,name:String(a.name).slice(0,120),menge:Math.max(0,parseInt(a.menge,10)||1),erstellt:new Date().toISOString()}))}
      if(data.meta&&(data.meta.bisNr||0)>(S.meta.bisNr||0))jobs.push((async()=>putRow(S.metaId||await tagId("meta:etiketten"),{t:"meta",bisNr:parseInt(data.meta.bisNr,10)||0,freiAb:parseInt(data.meta.freiAb,10)||1,zeit:new Date().toISOString()}))());
      const res=await Promise.all(jobs);toast(res.every(Boolean)?"Sicherung übernommen.":"Einiges konnte nicht gespeichert werden. Nochmals importieren.")})})}

/* ---------- Fenster ---------- */
let sheetClose=null;
function openSheet(html,onMount,onClose){closeSheet();const r=$("#sheetroot");r.innerHTML=`<div class="ov" id="ov"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  sheetClose=onClose||null;$("#ov").addEventListener("click",e=>{if(e.target.id==="ov")closeSheet()});onMount&&onMount(r.querySelector(".sheet"))}
function closeSheet(){const f=sheetClose;sheetClose=null;$("#sheetroot").innerHTML="";if(f)try{f()}catch(e){}}
function helpSheet(){const inApp=S.phase==="app";
  openSheet(`<span class="eyebrow">Hilfe</span><h3>So geht's</h3>
  <ol class="steps"><li><div><b>Etiketten drucken</b><span>Reiter «Etiketten», Nummern wählen, PDF drucken, auf die Boxen kleben.</span></div></li>
  <li><div><b>Box öffnen</b><span>Nummer oben eintippen, oder «Scannen» antippen und die Kamera aufs Etikett halten.</span></div></li>
  <li><div><b>Standort und Inhalt</b><span>Antippen, wo die Box steht, Bezeichnung und Inhalt eintippen. Gespeichert wird sofort.</span></div></li></ol>
  <div class="warn small"><b>Privat:</b> Boxnummern, Bezeichnungen, Räume, Inhalte und Fotos werden auf dem Gerät verschlüsselt, bevor sie gespeichert werden. Die Datenbank sieht nur, wie viele Einträge es gibt und wann sie geändert wurden.</div>
  <div><div class="st-row"><span>Angemeldet</span><span>${esc(S.user?.email||"–")}</span></div><div class="st-row"><span>Verbindung</span><span class="st ${S.status==="ok"?"ok":"bad"}">${S.status==="ok"?"verbunden":"getrennt"}</span></div></div>
  <div class="row">${inApp?`<button class="btn ghost sm" data-act="export">Sicherung herunterladen</button><label class="btn ghost sm" for="importIn" role="button" tabindex="0">Sicherung importieren</label><button class="btn ghost sm" data-act="pw">Login-Passwort ändern</button>`:""}
    ${S.user?`<button class="btn ghost sm" data-act="forget">Schlüssel auf diesem Gerät löschen</button><button class="btn ghost sm" data-act="logout">Abmelden</button>`:""}</div>
  <div class="foot"><button type="button" class="btn" data-close>Schliessen</button></div>`)}
function pwSheet(){openSheet(`<span class="eyebrow">Konto</span><h3>Login-Passwort ändern</h3><form id="pwform" novalidate><div class="fld"><label for="pw-1">Neues Passwort</label><input id="pw-1" type="password" autocomplete="new-password" minlength="12"></div><div class="fld"><label for="pw-2">Nochmals</label><input id="pw-2" type="password" autocomplete="new-password"></div><p class="err" id="pw-err"></p>
  <div class="foot"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn">Speichern</button></div></form>`)}
function zoom(path){const lb=$("#lightbox");lb.innerHTML=`<img alt="Foto der Box">`;lb.hidden=false;lb.onclick=()=>{lb.hidden=true;lb.innerHTML=""};fotoUrl(path).then(u=>{const im=lb.querySelector("img");if(im)im.src=u}).catch(()=>{})}

/* ---------- Anmelden, Einrichten, Entsperren ---------- */
function gateErr(msg){S.gateMsg=msg;const el=document.querySelector(".gatecard .err");if(el){el.textContent=msg;el.setAttribute("role","alert")}else render();setBusy(false)}
function setBusy(b,label){S.busy=b;const btn=document.querySelector(".gatecard form .btn.big");if(!btn)return;if(b){btn.dataset.label=btn.dataset.label||btn.textContent;btn.textContent=label||"Bitte warten …";btn.disabled=true}else{if(btn.dataset.label)btn.textContent=btn.dataset.label;btn.disabled=false}}
async function afterLogin(){S.phase="start";S.gateMsg="";render();
  try{const {data:ok,error}=await sb.rpc("ist_mitglied");if(error)throw error;if(!ok){S.phase="denied";render();return}
    const {data:krow,error:e2}=await sb.from("daten").select("blob").eq("id",KEY_ID).maybeSingle();if(e2)throw e2;
    const saved=await idbGet("keys:"+S.user.id);
    if(!krow){const {data:any,error:e3}=await sb.from("daten").select("id").neq("id",KEY_ID).limit(1);if(e3)throw e3;
      if(any&&any.length){/* Daten vorhanden, aber Schlüsselinfo fehlt: nie neu einrichten */
        if(saved?.info&&await checkWith(saved.info,saved.aes)){K.aes=saved.aes;K.hmac=saved.hmac;const {error:e4}=await sb.from("daten").insert({id:KEY_ID,blob:JSON.stringify(saved.info)});if(e4)throw e4;S.keyInfo=saved.info;lsSet("kb-keyinfo",saved.info);await loadAll();return}
        S.phase="error";S.gateMsg="Die Schlüsselinfo in der Datenbank fehlt. Auf einem Gerät öffnen, das schon entsperrt war, dann wird sie wiederhergestellt.";render();return}
      S.phase="setup";S.setupCode=null;S.setupOwn=false;S.focusId="su-2";render();return}
    S.keyInfo=JSON.parse(krow.blob);clampIter(S.keyInfo.iter);lsSet("kb-keyinfo",S.keyInfo);
    if(saved&&saved.salt===S.keyInfo.salt){K.aes=saved.aes;K.hmac=saved.hmac;if(await checkKey()){await loadAll();return}}
    K.aes=K.hmac=null;S.phase="unlock";S.focusId="ul-pw";render()}
  catch(e){S.phase="error";S.gateMsg=errText(e);render()}}
async function doLogin(email,pw){S.gateEmail=String(email||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.gateEmail)){gateErr("Bitte die E-Mail-Adresse eingeben.");return}if(!pw){gateErr("Passwort eingeben.");return}
  setBusy(true,"Meldet an …");
  const info=lsGet("kb-keyinfo");if(info){try{if(await tryPass(pw,info)){gateErr("Das ist der Haushalts-Schlüssel, nicht das Login-Passwort. Es wurde nichts gesendet.");$("#lg-pw").value="";return}}catch(e){}}
  const {data,error}=await sb.auth.signInWithPassword({email:S.gateEmail,password:pw});
  if(error){gateErr(isNet(error)?"Keine Verbindung.":"E-Mail oder Passwort stimmt nicht.");$("#lg-pw")?.select();return}
  S.busy=false;S.user=data.user;afterLogin()}
const BAD_WORDS=["keller","box","passwort","password","schlussel","123456","qwertz"];
async function doSetup(){let pass,kind;
  if(S.setupOwn){const p1=$("#su-1").value,p2=$("#su-2").value;const n=p1.normalize("NFC");
    if(n.length<20){gateErr("Mindestens 20 Zeichen.");return}if(p1!==p2){gateErr("Die beiden Eingaben sind nicht gleich.");return}
    if(BAD_WORDS.some(w=>norm(n).includes(w))||(S.user?.email&&norm(n).includes(norm(S.user.email.split("@")[0])))){gateErr("Bitte keine Namen, Orte oder Wörter wie «Keller» verwenden.");return}
    if(new Set(n).size<8){gateErr("Zu einfach. Mehr verschiedene Zeichen verwenden.");return}pass=n;kind="eigen"}
  else{const c=canonCode($("#su-2").value);if(!c||c!==S.setupCode){gateErr("Der eingegebene Code stimmt nicht mit dem angezeigten überein.");return}pass=c;kind="code"}
  setBusy(true,"Wird eingerichtet …");S.gateMsg="";
  try{const salt=b64(crypto.getRandomValues(new Uint8Array(16)));const keys=await deriveKeys(pass,salt,ITER);K.aes=keys.aes;K.hmac=keys.hmac;
    const check=b64(await sealBytes(TE.encode("kellerboxen-ok"),"check:"+KEY_ID));const info={v:KEY_V,kind,salt,iter:ITER,check};
    const {error}=await sb.from("daten").insert({id:KEY_ID,blob:JSON.stringify(info)});
    if(error){if(String(error.code)==="23505"){S.busy=false;K.aes=K.hmac=null;await afterLogin();S.gateMsg="Der Schlüssel wurde inzwischen auf einem anderen Gerät festgelegt. Bitte diesen eingeben.";render();return}throw error}
    S.keyInfo=info;lsSet("kb-keyinfo",info);await idbSet("keys:"+S.user.id,{aes:K.aes,hmac:K.hmac,salt,info});S.busy=false;S.setupCode=null;await loadAll()}
  catch(e){K.aes=K.hmac=null;gateErr(errText(e))}}
async function doUnlock(p){if(!p){gateErr("Schlüssel eingeben.");return}if(S.keyInfo.kind==="code"&&!canonCode(p)){gateErr("Der Code hat 20 Zeichen, z. B. ABCD-EFGH-JKLM-NPQR-STUV.");return}
  setBusy(true,"Prüft …");S.gateMsg="";
  try{const keys=await tryPass(p,S.keyInfo);if(!keys){gateErr("Der Schlüssel stimmt nicht.");$("#ul-pw")?.select();return}
    K.aes=keys.aes;K.hmac=keys.hmac;await idbSet("keys:"+S.user.id,{aes:K.aes,hmac:K.hmac,salt:S.keyInfo.salt,info:S.keyInfo});S.busy=false;await loadAll()}
  catch(e){K.aes=K.hmac=null;gateErr(errText(e))}}
async function logout(){closeSheet();try{S.chan&&sb.removeChannel(S.chan)}catch(e){}S.chan=null;if(S.user)await idbDel("keys:"+S.user.id);
  K.aes=K.hmac=null;S.rows=new Map;CONF.clear();TOUCH.clear();rebuild();S.loaded=false;S.user=null;fotoCache.clear();try{await sb.auth.signOut()}catch(e){}S.phase="login";S.gateMsg="";render()}

/* ---------- Navigation und Ereignisse ---------- */
function go(v){if(S.view!=="box")S.lastView=S.view;S.view=v;S.armed=null;window.scrollTo(0,0);render()}
function openBox(nr,flash){if(S.view!=="box")S.lastView=S.view;S.view="box";S.boxNr=nr;S.addDraft="";S.pickOpen=false;S.pickAdd=null;S.itemEdit=null;S.armed=null;if(flash)S.flashId=flash;S.q="";$("#q").value="";window.scrollTo(0,0);render()}
let armT;function arm(key){S.armed=key;clearTimeout(armT);armT=setTimeout(()=>{if(S.armed===key){S.armed=null;render()}},4000);render()}
function pickSet(l,id){const nr=S.boxNr,b=S.boxen.get(nr);const path=ortPath(b?.ortId).map(x=>x[0]);const ortId=path[l]===id?(l?path[l-1]:""):id;S.pickAdd=null;S.pickOpen=true;saveBox(nr,{ortId})}
async function pickCreate(){const l=S.pickAdd,nr=S.boxNr;const inp=$("#pk-new");const nm=inp?.value.trim();if(l==null)return;if(!nm){inp?.focus();return}
  const path=ortPath(S.boxen.get(nr)?.ortId).map(x=>x[0]);const parent=l?path[l-1]:"";S.pickAdd=null;S.pickOpen=true;const id=await newOrt(parent,nm);if(id)saveBox(nr,{ortId:id})}
async function copyCode(){const c=S.setupCode;try{await navigator.clipboard.writeText(c);toast("Code kopiert. Jetzt im Passwort-Manager speichern.")}catch(e){const el=$("#su-code");if(el){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)}toast("Code markiert, bitte kopieren.")}}
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-v],[data-nav],[data-open],[data-act],[data-pk],[data-pk-add],[data-pk-ok],[data-item-edit],[data-item-done],[data-qty],[data-del-item],[data-add-ort],[data-del-ort],[data-start],[data-zoom],[data-close],[data-photo-nr],[data-close-after]");
  if(!t)return;const d=t.dataset;
  if(d.closeAfter!==undefined){setTimeout(closeSheet,0);return}
  if(d.photoNr!==undefined){S.photoTarget=d.photoNr;return}
  if(d.close!==undefined){closeSheet();return}
  if(d.zoom){zoom(d.zoom);return}
  if(d.act==="help"){helpSheet();return}
  if(d.act==="logout"){logout();return}
  if(d.act==="reload"){S.gateMsg="";S.user?afterLogin():boot();return}
  if(d.act==="forget"){if(S.user)idbDel("keys:"+S.user.id).then(()=>{closeSheet();K.aes=K.hmac=null;S.rows=new Map;rebuild();S.loaded=false;S.phase="unlock";render();toast("Schlüssel auf diesem Gerät gelöscht.")});return}
  if(d.act==="copy-code"){copyCode();return}
  if(d.act==="new-code"){S.setupCode=genCode();S.gateMsg="";render();return}
  if(d.act==="own-on"){S.setupOwn=true;S.gateMsg="";S.focusId="su-1";render();return}
  if(d.act==="own-off"){S.setupOwn=false;S.gateMsg="";S.focusId="su-2";render();return}
  if(S.phase!=="app")return;
  if(d.v){S.q="";$("#q").value="";go(d.v);return}
  if(d.nav){go(S.lastView||"suchen");return}
  if(d.open){openBox(d.open,d.flash);return}
  if(d.pk!==undefined){pickSet(Number(d.pk),d.id);return}
  if(d.pkAdd!==undefined){S.pickAdd=Number(d.pkAdd);S.focusId="pk-new";render();return}
  if(d.pkOk!==undefined){pickCreate();return}
  if(d.itemEdit){S.itemEdit=d.itemEdit;S.armed=null;S.focusId="ie-"+d.itemEdit;render();return}
  if(d.itemDone!==undefined){S.itemEdit=null;render();return}
  if(d.qty){const a=S.artikel.get(d.id);if(a)setItem(d.id,{menge:Math.min(9999,Math.max(0,(Number(a.menge)||0)+Number(d.qty)))});return}
  if(d.delItem){if(S.armed==="i-"+d.delItem){S.armed=null;S.itemEdit=null;delRow(d.delItem).then(ok=>{if(ok)toast("Entfernt")})}else arm("i-"+d.delItem);return}
  if(d.addOrt!==undefined){newOrt(d.addOrt).then(id=>{if(id){S.focusId="on-"+id;render()}});return}
  if(d.delOrt){if(S.armed==="o-"+d.delOrt){S.armed=null;Promise.all(descIds(d.delOrt).reverse().map(id=>delRow(id))).then(r=>{if(r.every(Boolean))toast("Gelöscht")})}else arm("o-"+d.delOrt);return}
  if(d.start){S.lbl.start=Number(d.start);render();return}
  const a=d.act;
  if(a==="scan")openScanner();
  else if(a==="pick"){S.pickOpen=true;render()}
  else if(a==="pick-done"){S.pickOpen=false;S.pickAdd=null;render()}
  else if(a==="del-box"){if(S.armed==="box")deleteBox(S.boxNr);else arm("box")}
  else if(a==="toggle-edit"){S.edit=!S.edit;S.armed=null;render()}
  else if(a==="save-pdf")savePdf();
  else if(a==="export"){closeSheet();exportData()}
  else if(a==="pw")pwSheet()});
document.addEventListener("submit",async e=>{const f=e.target;e.preventDefault();
  if(S.busy&&/^(loginform|setupform|unlockform)$/.test(f.id))return;
  if(f.id==="loginform")doLogin($("#lg-mail").value,$("#lg-pw").value);
  else if(f.id==="setupform")doSetup();
  else if(f.id==="unlockform")doUnlock($("#ul-pw").value);
  else if(f.id==="pwform"){const p1=$("#pw-1").value,p2=$("#pw-2").value,er=$("#pw-err");if(p1.length<12){er.textContent="Mindestens 12 Zeichen.";return}if(p1!==p2){er.textContent="Die beiden Eingaben sind nicht gleich.";return}
    if(S.keyInfo&&await tryPass(p1,S.keyInfo).catch(()=>null)){er.textContent="Das ist der Haushalts-Schlüssel. Bitte ein anderes Passwort wählen.";return}
    const {error}=await sb.auth.updateUser({password:p1});if(error){er.textContent="Hat nicht geklappt. Bitte nochmals versuchen.";return}closeSheet();toast("Login-Passwort geändert.")}
  else if(f.id==="addform"&&S.phase==="app"){const i=$("#add");const v=i.value;i.value="";S.addDraft="";const nr=S.boxNr;const failed=await addItems(nr,v.split(/\r?\n|;/).map(parseLine));
    if(failed.length)restoreDraft(nr,failed);else $("#add")?.focus()}});
function restoreDraft(nr,failed){if(S.boxNr!==nr||S.addDraft)return;S.addDraft=failed.map(lineOf).join("; ");const inp=$("#add");if(inp&&!inp.value)inp.value=S.addDraft}
document.addEventListener("focusout",e=>saveField(e.target));
document.addEventListener("change",e=>{const t=e.target;if(S.phase!=="app")return;
  if(t.id==="photoIn"){const f=t.files[0];t.value="";handlePhoto(f,S.photoTarget||S.boxNr)}
  else if(t.id==="scanIn"){const f=t.files[0];t.value="";scanFile(f)}
  else if(t.id==="importIn"){const f=t.files[0];t.value="";closeSheet();if(f)importData(f)}});
let lblT;
document.addEventListener("input",e=>{const t=e.target;if(t.id==="add"){S.addDraft=t.value;return}if(t.id==="lbl-von"||t.id==="lbl-bis"){const v=parseInt(t.value,10);if(t.id==="lbl-von"){S.lbl.von=v>0?v:null;S.lbl.bis=null}else S.lbl.bis=v>0?v:null;clearTimeout(lblT);lblT=setTimeout(render,450)}});
document.addEventListener("keydown",e=>{const t=e.target;
  if(e.key==="Escape"){if(!$("#lightbox").hidden){$("#lightbox").click();return}if($("#ov")){closeSheet();return}if(S.pickAdd!=null){S.pickAdd=null;render()}return}
  if(e.key===" "&&t.matches?.("label[for]")){e.preventDefault();document.getElementById(t.htmlFor)?.click();return}
  if(e.key!=="Enter")return;
  if(t.id==="pk-new"){e.preventDefault();pickCreate()}
  else if(t.id==="bx-name"||t.classList?.contains("en-in")){e.preventDefault();t.blur()}
  else if(t.classList?.contains("ie-name")){e.preventDefault();saveField(t);S.itemEdit=null;render()}
  else if(t.matches?.("label[for]")){e.preventDefault();document.getElementById(t.htmlFor)?.click()}});
document.addEventListener("paste",async e=>{if(e.target.id!=="add"||S.phase!=="app")return;const t=e.clipboardData?.getData("text")||"";if(/\n/.test(t.trim())){e.preventDefault();const nr=S.boxNr;const failed=await addItems(nr,t.split(/\r?\n|;/).map(parseLine));if(failed.length)restoreDraft(nr,failed)}});
$("#q").addEventListener("input",e=>{S.q=e.target.value;if(S.view==="box"&&S.q.trim())S.view=S.lastView||"suchen";render()});
$("#q").addEventListener("keydown",e=>{if(e.key!=="Enter")return;const nr=parseNr(S.q);if(nr){e.preventDefault();$("#q").blur();openBox(nr)}});
$("#qclear").addEventListener("click",()=>{S.q="";$("#q").value="";render();$("#q").focus()});
function readHash(){const h=String(location.hash||"").replace(/^#/,"");const m=/^box-0*(\d{1,3})$/.exec(h);
  if(m&&+m[1]>=1){S.view="box";S.boxNr=padNr(+m[1])}else if(["suchen","uebersicht","etiketten"].includes(h))S.view=h}
window.addEventListener("hashchange",()=>{readHash();if(S.phase==="app"){S.q="";$("#q").value=""}render()});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S.phase==="app"&&Date.now()-S.lastLoad>30000)loadAll(true)});

/* ---------- Start ---------- */
let authBound=false;
async function boot(){readHash();
  if(!window.crypto?.subtle||!window.indexedDB){S.phase="error";S.gateMsg="Dieser Browser kann nicht verschlüsseln. Bitte Safari oder Chrome in aktueller Version verwenden.";render();return}
  if(!sb){S.phase="config";render();return}
  if(!authBound){authBound=true;sb.auth.onAuthStateChange((ev,session)=>{if(ev==="SIGNED_OUT"&&S.phase!=="login"){S.phase="login";S.user=null;render()}else if(session?.user){S.user=session.user;if(ev==="TOKEN_REFRESHED"&&S.phase==="error")setTimeout(afterLogin,0)}})}
  try{const {data:{session},error}=await sb.auth.getSession();
    if(!session&&error&&isNet(error)){S.phase="error";S.gateMsg=errText(error);render();return}
    if(!session){S.phase="login";S.focusId="lg-mail";render();return}S.user=session.user;await afterLogin()}
  catch(e){S.phase="error";S.gateMsg=errText(e);render()}}
boot();
