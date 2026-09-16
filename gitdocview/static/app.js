(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const O_DEL='',C_DEL='',O_INS='',C_INS='';
const SENT=/[-]/g;
const SENT_MAP={'':'<del class="wd">','':'</del>','':'<ins class="wi">','':'</ins>'};

/* ================= data adapter (server or embedded file) ================= */
const EMBED=(()=>{const el=document.getElementById('embed');if(!el)return null;return {b64:el.textContent.trim(),ready:null};})();
async function decodeEmbed(){
  if(EMBED.ready)return EMBED.ready;
  const bin=Uint8Array.from(atob(EMBED.b64),c=>c.charCodeAt(0));
  const ds=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  EMBED.ready=JSON.parse(await new Response(ds).text());return EMBED.ready;
}
async function getJSON(url,opts){const r=await fetch(url,opts);const j=await r.json().catch(()=>({error:r.statusText}));if(!r.ok)throw new Error(j.error||r.statusText);return j;}
const blobCache=new Map();
const api={
  async state(){
    if(EMBED){const e=await decodeEmbed();const o=localStorage.getItem('gdv-config-embed');return {config:o?JSON.parse(o):e.config,config_path:'（内嵌：修改仅保存在本浏览器）',config_mtime:0,defaults:{repo:e.data.repo,docs:e.data.docs},embedded:true};}
    return getJSON('/api/state');
  },
  async versions(repo,docs,mode){
    if(EMBED)return (await decodeEmbed()).data;
    return getJSON(`/api/versions?repo=${encodeURIComponent(repo)}&docs=${encodeURIComponent(docs||'')}&mode=${mode}`);
  },
  async blob(sha){
    if(EMBED)return (await decodeEmbed()).blobs[sha]||'';
    const key=S.repo+'|'+sha;
    if(!blobCache.has(key)){const r=await fetch(`/api/blob?repo=${encodeURIComponent(S.repo)}&docs=${encodeURIComponent(S.docs||'')}&sha=${sha}`);if(!r.ok)throw new Error((await r.json()).error);blobCache.set(key,await r.text());}
    return blobCache.get(key);
  },
  async config(){if(EMBED)return {config:CFG,mtime:0};return getJSON('/api/config');},
  async saveConfig(cfg){if(EMBED){localStorage.setItem('gdv-config-embed',JSON.stringify(cfg));return {mtime:0};}return getJSON('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});},
  fs(path){return getJSON('/api/fs?path='+encodeURIComponent(path));},
};

/* ================= state ================= */
let D=null,VI={},CFG=null,CFG_MTIME=0,CFG_PATH='';
const S={view:'doc',doc:'',ver:null,base:'prev',lang:'base',mode:'read',only:false,repo:'',docs:'',src:'tags'};
function restore(defaults){
  try{Object.assign(S,JSON.parse(localStorage.getItem('gdv-state')||'{}'));}catch(e){}
  const h=new URLSearchParams(location.hash.replace(/^#/,''));
  for(const k of ['view','doc','ver','base','lang','mode','repo','docs','src'])if(h.has(k))S[k]=h.get(k);
  if(h.has('only'))S.only=h.get('only')==='1';
  if(defaults&&defaults.repo){S.repo=defaults.repo;S.docs=defaults.docs||'';}
  if(EMBED){S.repo=defaults.repo;S.docs=defaults.docs;}
  if(!S.repo&&CFG.recent&&CFG.recent[0]){S.repo=CFG.recent[0].repo;S.docs=CFG.recent[0].docs===CFG.recent[0].repo?'':CFG.recent[0].docs;}
  if(!['read','diff','source'].includes(S.mode))S.mode='read';
  if(!['doc','overview'].includes(S.view))S.view='doc';
  if(!['tags','commits'].includes(S.src))S.src='tags';
}
function normalize(){
  if(!D)return;
  if(!S.ver||VI[S.ver]==null)S.ver=D.versions[D.versions.length-1].id;
  if(!D.docs_list.some(d=>d.id===S.doc))S.doc=(D.docs_list[0]||{}).id||'';
  if(S.base!=='prev'&&VI[S.base]==null)S.base='prev';
  if(S.lang!=='base'&&!D.langs.includes(S.lang))S.lang='base';
}
function persist(){
  try{localStorage.setItem('gdv-state',JSON.stringify(S));}catch(e){}
  const h=new URLSearchParams();for(const k of ['repo','docs','src','view','doc','ver','base','lang','mode'])if(S[k])h.set(k,S[k]);h.set('only',S.only?'1':'0');
  history.replaceState(null,'','#'+h.toString());
}
function set(patch){Object.assign(S,patch);render();}

const ver=t=>D.versions[VI[t]];
const prevId=t=>{const i=VI[t];return i>0?D.versions[i-1].id:null;};
const nextId=t=>{const i=VI[t];return i<D.versions.length-1?D.versions[i+1].id:null;};
const hasDoc=(t,doc)=>!!(ver(t)&&ver(t).files[doc]);
const hasLang=(t,doc,lang)=>{const f=ver(t)&&ver(t).files[doc];return !!(f&&f[lang]!=null);};
const shaOf=(t,doc,lang)=>{const f=ver(t)&&ver(t).files[doc];if(!f)return null;return lang!=='base'&&f[lang]!=null?f[lang]:f.base;};
const langLabel=l=>l==='base'?(CFG.scan.base_lang_label||'原文'):((CFG.scan.lang_labels||{})[l]||l);
function baseId(){if(S.base==='prev')return prevId(S.ver);return VI[S.base]!=null&&S.base!==S.ver?S.base:prevId(S.ver);}
function nearestLang(t,doc,lang){for(let i=VI[t]-1;i>=0;i--){const v=D.versions[i];if(v.files[doc]&&v.files[doc][lang]!=null)return v.id;}return null;}
function changedDocs(t){const v=ver(t),p=prevId(t)&&ver(prevId(t));const out=[];for(const d of D.docs_list){const f=v.files[d.id];if(!f)continue;const pf=p&&p.files[d.id];if(!pf)out.push({id:d.id,neu:true});else if((pf.base||'')!==(f.base||''))out.push({id:d.id,neu:false});}return out;}
const docShort=id=>{const d=D.docs_list.find(x=>x.id===id);return d?d.short:id;};

/* ================= profile → CSS ================= */
const isDark=()=>document.documentElement.dataset.theme==='dark'||(document.documentElement.dataset.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);
function activeProfile(){return CFG.profiles[CFG.active_profile]||Object.values(CFG.profiles)[0];}
function applyProfile(p){
  p=p||activeProfile();const r=document.documentElement.style,dark=isDark();
  r.setProperty('--doc-font',p.body.font);r.setProperty('--ui-font',p.ui_font);r.setProperty('--mono-font',p.mono_font);
  r.setProperty('--doc-size',p.body.size+'px');r.setProperty('--doc-lh',String(p.body.line_height));r.setProperty('--content-w',p.content_width+'px');
  for(const h of ['h1','h2','h3','h4']){const c=p.headings[h]||{};r.setProperty(`--${h}-size`,(c.size||16)+'px');r.setProperty(`--${h}-weight`,String(c.weight||600));
    const col=dark?(c.color_dark||c.color):(c.color||'');if(col)r.setProperty(`--${h}-color`,col);else r.removeProperty(`--${h}-color`);}
  r.setProperty('--accent',dark?(p.accent.dark||p.accent.light):p.accent.light);
  r.setProperty('--ins-line',p.diff.ins);r.setProperty('--del-line',p.diff.del);r.setProperty('--mod-line',p.diff.mod);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyProfile(drawerOpen()?WORK.profiles[WORK.active_profile]:null));

/* ================= boot ================= */
async function boot(){
  let st;
  try{st=await api.state();}catch(e){$('#page').innerHTML=`<div class="banner err">无法连接本地服务：${esc(e.message)}</div>`;return;}
  CFG=st.config;CFG_MTIME=st.config_mtime;CFG_PATH=st.config_path;
  applyProfile();
  restore(st.defaults);
  bind();
  if(EMBED){$('#toolbar').classList.add('hidden');$('#tbToggle').classList.add('hidden');}
  else{toolbarCollapsed(CFG.toolbar_collapsed);pollConfig();}
  fillToolbar();
  if(S.repo)await openRepo();else{renderEmpty();renderControls();}
}
function renderEmpty(){
  $('#page').innerHTML=`<div class="empty-state"><h2>选择一个 Git 仓库</h2><p>在上方工具栏填写仓库路径（或点「…」浏览），然后「打开」。<br>文档目录默认与仓库相同；若 Markdown 放在子目录（如 <span class="mono">docs/</span>），取消勾选后单独选择。</p></div>`;
  $('#right').innerHTML='';$('#docList').innerHTML='';$('#verSel').innerHTML='';$('#verDate').textContent='';$('#foot').textContent='';$('#brandSub').textContent='';
}
async function openRepo(){
  $('#page').innerHTML='<div class="loading">正在读取 git 历史…</div>';
  try{
    D=await api.versions(S.repo,S.docs,S.src);
  }catch(e){D=null;$('#page').innerHTML=`<div class="banner err">${esc(e.message)}</div>`;renderControls();toolbarCollapsed(false);return;}
  VI={};D.versions.forEach((v,i)=>VI[v.id]=i);
  if(!D.versions.length){D=null;$('#page').innerHTML='<div class="banner">这个来源下没有任何版本（没有标签？试试「提交记录」）。</div>';renderControls();return;}
  S.repo=D.repo;if(D.docs===D.repo)S.docs='';else S.docs=D.docs;
  normalize();
  if(!EMBED){try{const c=await api.config();CFG=c.config;CFG_MTIME=c.mtime;}catch(e){}}
  fillToolbar();render();
}

/* ================= toolbar ================= */
function toolbarCollapsed(c){$('#toolbar').classList.toggle('hidden',!!c);$('#tbToggle').setAttribute('aria-expanded',String(!c));}
function fillToolbar(){
  $('#repoInput').value=S.repo||'';
  const same=!S.docs||S.docs===S.repo;$('#sameChk').checked=same;$('#docsInput').disabled=same;$('#docsBrowse').disabled=same;$('#docsInput').value=same?'':S.docs;
  $('#srcSel').value=S.src;
  const rec=(CFG.recent||[]);$('#recentSel').innerHTML='<option value="">—</option>'+rec.map((r,i)=>`<option value="${i}">${esc(r.repo.replace(/^\/Users\/[^/]+/,'~'))}${r.docs!==r.repo?' → '+esc(r.docs.slice(r.repo.length+1)):''}</option>`).join('');
  const langs=['base'].concat(D?D.langs:Object.keys(CFG.scan.lang_suffixes||{}));
  $('#langSeg').innerHTML=langs.map(l=>`<button data-lang="${l}" aria-pressed="${String(S.lang===l)}">${esc(langLabel(l))}</button>`).join('');
}
function bindToolbar(){
  $('#tbToggle').addEventListener('click',()=>{const c=!$('#toolbar').classList.contains('hidden');toolbarCollapsed(c);CFG.toolbar_collapsed=c;api.saveConfig(CFG).then(r=>{CFG_MTIME=r.mtime;}).catch(()=>{});});
  $('#sameChk').addEventListener('change',e=>{const same=e.target.checked;$('#docsInput').disabled=same;$('#docsBrowse').disabled=same;if(same)$('#docsInput').value='';});
  $('#openBtn').addEventListener('click',()=>{S.repo=$('#repoInput').value.trim();S.docs=$('#sameChk').checked?'':$('#docsInput').value.trim();S.src=$('#srcSel').value;S.ver=null;blobCache.clear();openRepo();});
  $('#repoInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#openBtn').click();});
  $('#docsInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#openBtn').click();});
  $('#recentSel').addEventListener('change',e=>{const r=(CFG.recent||[])[+e.target.value];if(!r)return;$('#repoInput').value=r.repo;const same=r.docs===r.repo;$('#sameChk').checked=same;$('#docsInput').disabled=same;$('#docsBrowse').disabled=same;$('#docsInput').value=same?'':r.docs;$('#openBtn').click();});
  $('#repoBrowse').addEventListener('click',()=>pick('选择 Git 仓库',$('#repoInput').value||'~',p=>{$('#repoInput').value=p;}));
  $('#docsBrowse').addEventListener('click',()=>pick('选择文档目录',$('#docsInput').value||$('#repoInput').value||'~',p=>{$('#docsInput').value=p;}));
}
/* directory picker */
let pickCb=null;
function pick(title,start,cb){pickCb=cb;$('#pickTitle').textContent=title;$('#picker').classList.remove('hidden');pickGo(start);}
async function pickGo(path){
  let r;try{r=await api.fs(path);}catch(e){$('#pickDirs').innerHTML=`<div class="banner err">${esc(e.message)}</div>`;return;}
  $('#pickPath').textContent=r.path;$('#pickPath').dataset.path=r.path;
  const parts=r.path.split('/').filter(Boolean);let acc='';
  $('#pickCrumbs').innerHTML=`<button data-p="/">/</button>`+parts.map(p=>{acc+='/'+p;return `<span>›</span><button data-p="${esc(acc)}">${esc(p)}</button>`;}).join('');
  $('#pickCrumbs').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>pickGo(b.dataset.p)));
  $('#pickDirs').innerHTML=(r.parent?`<button data-p="${esc(r.parent)}">..</button>`:'')+r.dirs.map(d=>`<button data-p="${esc(r.path.replace(/\/$/,'')+'/'+d.name)}"><span>${esc(d.name)}</span>${d.md_count?`<span class="b">${d.md_count} md</span>`:'<span></span>'}${d.is_git?'<span class="b git">git</span>':'<span></span>'}</button>`).join('')||'<div class="empty">没有子文件夹</div>';
  $('#pickDirs').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>pickGo(b.dataset.p)));
}
function bindPicker(){
  $('#pickClose').addEventListener('click',()=>$('#picker').classList.add('hidden'));
  $('#picker').addEventListener('click',e=>{if(e.target===$('#picker'))$('#picker').classList.add('hidden');});
  $('#pickOk').addEventListener('click',()=>{$('#picker').classList.add('hidden');if(pickCb)pickCb($('#pickPath').dataset.path);});
}

/* ================= settings drawer (profiles) ================= */
let WORK=null,DIRTY=false;
const drawerOpen=()=>!$('#drawer').classList.contains('hidden');
function openDrawer(){WORK=JSON.parse(JSON.stringify(CFG));DIRTY=false;$('#dirty').classList.add('hidden');$('#cfgPath').textContent=CFG_PATH;$('#drawer').classList.remove('hidden');buildForm();$('#jsonArea').value=JSON.stringify(WORK,null,2);}
function closeDrawer(){if(DIRTY&&!confirm('有未保存的修改，放弃？'))return;$('#drawer').classList.add('hidden');applyProfile();}
function markDirty(){DIRTY=true;$('#dirty').classList.remove('hidden');applyProfile(WORK.profiles[WORK.active_profile]);$('#jsonArea').value=JSON.stringify(WORK,null,2);}
function buildForm(){
  const p=WORK.profiles[WORK.active_profile];
  const fontRow=(k,label,get,setv)=>`<div class="frow"><label>${label}</label><input type="text" data-k="${k}" value="${esc(get())}"></div>`;
  const numRow=(k,label,val,min,max,step)=>`<div class="frow"><label>${label}</label><div class="pair"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></div></div>`;
  const colorRow=(k,label,val)=>`<div class="frow"><label>${label}</label><div class="pair"><input type="color" data-k="${k}" value="${val}"><span class="mono">${val}</span></div></div>`;
  const hrow=lv=>{const c=p.headings[lv];return `<div class="hrow"><span class="lv">${lv.toUpperCase()}</span><input type="number" data-k="headings.${lv}.size" step="0.5" min="10" max="64" value="${c.size}"><input type="number" data-k="headings.${lv}.weight" step="100" min="300" max="900" value="${c.weight}"><div class="colors">
    <span class="clr" title="浅色主题"><input type="color" data-k="headings.${lv}.color" value="${c.color||'#1b2430'}" ${c.color?'':'style="opacity:.35"'}></span>
    <span class="clr" title="深色主题"><input type="color" data-k="headings.${lv}.color_dark" value="${c.color_dark||'#e3e9ef'}" ${c.color_dark?'':'style="opacity:.35"'}></span>
    <button data-clear="headings.${lv}" title="恢复跟随主题">跟随主题</button></div></div>`;};
  $('#drawerForm').innerHTML=`
    <div class="prow"><select id="profSel">${Object.keys(WORK.profiles).map(k=>`<option value="${esc(k)}"${k===WORK.active_profile?' selected':''}>${esc(WORK.profiles[k].name||k)}</option>`).join('')}</select>
      <button class="ib" id="profNew" title="新建（复制当前）">复制</button><button class="ib" id="profRename" title="重命名">改名</button><button class="ib" id="profDel" title="删除" ${Object.keys(WORK.profiles).length<2?'disabled':''}>删除</button></div>
    <fieldset><legend>标题</legend><div class="hhead"><span></span><span>字号 px</span><span>字重</span><span>颜色 浅色 / 深色</span></div>${['h1','h2','h3','h4'].map(hrow).join('')}</fieldset>
    <fieldset><legend>正文</legend>${numRow('body.size','字号 px',p.body.size,12,24,0.5)}${numRow('body.line_height','行高',p.body.line_height,1.2,2.4,0.02)}${numRow('content_width','内容宽度 px',p.content_width,600,1400,10)}</fieldset>
    <fieldset><legend>字体</legend>${fontRow('body.font','正文',()=>p.body.font)}${fontRow('ui_font','界面 / 标题',()=>p.ui_font)}${fontRow('mono_font','等宽',()=>p.mono_font)}</fieldset>
    <fieldset><legend>颜色</legend>${colorRow('accent.light','主色（浅色）',p.accent.light)}${colorRow('accent.dark','主色（深色）',p.accent.dark)}${colorRow('diff.ins','新增',p.diff.ins)}${colorRow('diff.del','删除',p.diff.del)}${colorRow('diff.mod','修改',p.diff.mod)}</fieldset>`;
  const setPath=(k,v)=>{const parts=k.split('.');let o=p;for(let i=0;i<parts.length-1;i++)o=o[parts[i]];o[parts[parts.length-1]]=v;};
  $('#drawerForm').querySelectorAll('input[data-k]').forEach(inp=>inp.addEventListener('input',()=>{
    let v=inp.value;if(inp.type==='number'||inp.type==='range')v=parseFloat(v);
    setPath(inp.dataset.k,v);
    if(inp.type==='range'||inp.type==='number'){$('#drawerForm').querySelectorAll(`input[data-k="${inp.dataset.k}"]`).forEach(o=>{if(o!==inp)o.value=inp.value;});}
    if(inp.type==='color'){inp.style.opacity='';const s=inp.parentElement.querySelector('.mono');if(s)s.textContent=v;}
    markDirty();}));
  $('#drawerForm').querySelectorAll('button[data-clear]').forEach(b=>b.addEventListener('click',()=>{const h=b.dataset.clear.split('.')[1];p.headings[h].color='';p.headings[h].color_dark='';markDirty();buildForm();}));
  $('#profSel').addEventListener('change',e=>{WORK.active_profile=e.target.value;markDirty();buildForm();});
  $('#profNew').addEventListener('click',()=>{const name=prompt('新配置名称',(p.name||WORK.active_profile)+' 副本');if(!name)return;let key=name.replace(/\s+/g,'-').toLowerCase()||'profile';while(WORK.profiles[key])key+='-2';WORK.profiles[key]=JSON.parse(JSON.stringify(p));WORK.profiles[key].name=name;WORK.active_profile=key;markDirty();buildForm();});
  $('#profRename').addEventListener('click',()=>{const name=prompt('重命名为',p.name||WORK.active_profile);if(!name)return;p.name=name;markDirty();buildForm();});
  $('#profDel').addEventListener('click',()=>{if(!confirm(`删除配置「${p.name||WORK.active_profile}」？`))return;delete WORK.profiles[WORK.active_profile];WORK.active_profile=Object.keys(WORK.profiles)[0];markDirty();buildForm();});
}
function bindDrawer(){
  $('#settingsBtn').addEventListener('click',()=>drawerOpen()?closeDrawer():openDrawer());
  $('#drawerClose').addEventListener('click',closeDrawer);
  $('#drawerTabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;$('#drawerTabs').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('#drawerForm').classList.toggle('hidden',b.dataset.tab!=='form');$('#drawerJson').classList.toggle('hidden',b.dataset.tab!=='json');});
  $('#jsonApply').addEventListener('click',()=>{try{const c=JSON.parse($('#jsonArea').value);if(!c.profiles||!Object.keys(c.profiles).length)throw new Error('缺少 profiles');if(!c.profiles[c.active_profile])c.active_profile=Object.keys(c.profiles)[0];WORK=c;$('#jsonErr').textContent='';markDirty();buildForm();}catch(e){$('#jsonErr').textContent='JSON 无效：'+e.message;}});
  $('#cfgSave').addEventListener('click',async()=>{try{const r=await api.saveConfig(WORK);CFG=JSON.parse(JSON.stringify(WORK));CFG_MTIME=r.mtime;DIRTY=false;$('#dirty').classList.add('hidden');applyProfile();fillToolbar();}catch(e){alert('保存失败：'+e.message);}});
  $('#cfgReload').addEventListener('click',async()=>{const c=await api.config();CFG=c.config;CFG_MTIME=c.mtime;openDrawer();});
}
function pollConfig(){
  setInterval(async()=>{try{const c=await api.config();if(c.mtime!==CFG_MTIME){CFG_MTIME=c.mtime;if(!DIRTY){CFG=c.config;applyProfile();fillToolbar();if(drawerOpen())openDrawer();}}}catch(e){}},3000);
}

/* ================= controls ================= */
function bind(){
  bindToolbar();bindPicker();bindDrawer();
  $('#verSel').addEventListener('change',e=>set({ver:e.target.value,view:'doc'}));
  $('#verPrev').addEventListener('click',()=>{const p=prevId(S.ver);if(p)set({ver:p,view:'doc'});});
  $('#verNext').addEventListener('click',()=>{const n=nextId(S.ver);if(n)set({ver:n,view:'doc'});});
  $('#baseSel').addEventListener('change',e=>set({base:e.target.value}));
  $('#modes').addEventListener('click',e=>{const b=e.target.closest('button');if(b)set({mode:b.dataset.mode,view:'doc'});});
  $('#langSeg').addEventListener('click',e=>{const b=e.target.closest('button');if(b)set({lang:b.dataset.lang});});
  $('#docList').addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!b.disabled)set({doc:b.dataset.doc,view:'doc'});});
  $('#ovLink').addEventListener('click',()=>set({view:S.view==='overview'?'doc':'overview'}));
  document.addEventListener('keydown',e=>{
    if(e.target.matches('select,input,textarea')||e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.key==='Escape'){if(!$('#picker').classList.contains('hidden'))$('#picker').classList.add('hidden');else if(drawerOpen())closeDrawer();return;}
    if(!D)return;
    if(e.key==='1')set({mode:'read',view:'doc'});else if(e.key==='2')set({mode:'diff',view:'doc'});else if(e.key==='3')set({mode:'source',view:'doc'});
    else if(e.key==='ArrowLeft'){const p=prevId(S.ver);if(p)set({ver:p});}
    else if(e.key==='ArrowRight'){const n=nextId(S.ver);if(n)set({ver:n});}
    else if(e.key==='n'||e.key==='j')jumpChange(1);else if(e.key==='p'||e.key==='k')jumpChange(-1);
    else if(e.key==='t'&&!EMBED)$('#tbToggle').click();else if(e.key===',')$('#settingsBtn').click();
  });
}
function renderControls(){
  document.querySelectorAll('#langSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lang===S.lang)));
  $('#ovLink').setAttribute('aria-current',String(S.view==='overview'));
  document.querySelectorAll('#modes button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===S.mode&&S.view==='doc')));
  if(!D){$('#baseRow').classList.add('hidden');return;}
  const v=ver(S.ver);
  $('#brandSub').textContent=D.repo.replace(/^\/Users\/[^/]+/,'~')+(D.docs!==D.repo?'  ·  '+D.docs.slice(D.repo.length+1):'');
  $('#verSel').innerHTML=D.versions.slice().reverse().map(x=>`<option value="${esc(x.id)}"${x.id===S.ver?' selected':''}>${esc(x.label)}</option>`).join('');
  $('#verPrev').disabled=!prevId(S.ver);$('#verNext').disabled=!nextId(S.ver);
  $('#verDate').textContent=`${v.date} · ${v.kind==='worktree'?'未提交的工作区文件':'相比上一版本改动 '+changedDocs(S.ver).length+' 份文档'}`;
  const br=$('#baseRow');
  if(S.mode==='read'||S.view!=='doc')br.classList.add('hidden');else{
    br.classList.remove('hidden');const p=prevId(S.ver);
    $('#baseSel').innerHTML=[`<option value="prev"${S.base==='prev'?' selected':''}>上一版本${p?' ('+esc(ver(p).label.slice(0,24))+')':''}</option>`]
      .concat(D.versions.slice().reverse().filter(x=>x.id!==S.ver).map(x=>`<option value="${esc(x.id)}"${S.base===x.id?' selected':''}>${esc(x.label)}</option>`)).join('');
  }
  const b=S.mode!=='read'?baseId():prevId(S.ver);
  $('#docList').innerHTML=D.docs_list.map(d=>{
    const has=hasDoc(S.ver,d.id);let dot='';
    if(has&&b){const f=ver(S.ver).files[d.id],bf=ver(b).files[d.id];if(!bf)dot='<span class="dot new" title="本版本新增"></span>';else if((bf.base||'')!==(f.base||''))dot='<span class="dot" title="相比基准有改动"></span>';}
    const lg=has?D.langs.filter(l=>hasLang(S.ver,d.id,l)).map(l=>`<span class="lg" title="有${esc(langLabel(l))}版本">${esc(langLabel(l)[0])}</span>`).join(''):'';
    return `<button data-doc="${esc(d.id)}" ${has?'':'disabled title="此版本尚无该文档"'} aria-current="${String(S.view==='doc'&&d.id===S.doc)}"><span class="num">${esc(d.num)}</span><span class="name" title="${esc(d.id)}">${esc(d.short)}</span><span style="display:flex;gap:6px;align-items:center">${lg}${dot}</span></button>`;
  }).join('');
  $('#foot').innerHTML=`${D.versions.length} 个版本 · ${esc(D.versions[0].label.slice(0,20))} → ${esc(D.versions[D.versions.length-1].label.slice(0,20))}<br>${esc(D.branch)}@${esc(D.head)}<br>快捷键：← → 切版本 · 1/2/3 切视图 · n/p 跳改动 · t 工具栏 · , 设置`;
}

/* ================= render ================= */
let renderSeq=0;
async function render(){
  persist();renderControls();
  if(!D)return;
  const seq=++renderSeq,page=$('#page'),right=$('#right');
  $('#main').scrollTop=0;
  try{
    if(S.view==='overview'){renderOverview(page,right);return;}
    if(!hasDoc(S.ver,S.doc)){page.innerHTML=`<div class="banner">文档 <b>${esc(S.doc)}</b> 在 ${esc(ver(S.ver).label)} 中不存在。</div>`;right.innerHTML='';return;}
    if(S.mode==='read')await renderRead(page,right,seq);
    else if(S.mode==='diff')await renderDiff(page,right,seq);
    else await renderSource(page,right,seq);
  }catch(e){if(seq===renderSeq){page.innerHTML=`<div class="banner err">渲染失败：${esc(e.message)}</div>`;console.error(e);}}
}
function metaLine(){
  const has=S.lang==='base'||hasLang(S.ver,S.doc,S.lang);
  return `<div class="docmeta"><span class="tag">${esc(ver(S.ver).label)}</span><span>${ver(S.ver).date}</span><span>${esc(langLabel(S.lang))}${has?'':'（本版本无此语言，显示原文）'}</span></div>`;
}
function changelogBox(t){const v=ver(t);if(!v.changelog)return '';return `<details class="cl"><summary>本版本 CHANGELOG <span class="mono">${esc(v.label)}</span></summary><div class="body">${marked.parse(v.changelog)}</div></details>`;}
function langBanner(){
  if(S.lang!=='base'&&!hasLang(S.ver,S.doc,S.lang)){const nz=nearestLang(S.ver,S.doc,S.lang);return `<div class="banner">${esc(ver(S.ver).label)} 没有此文档的${esc(langLabel(S.lang))}版本，以下显示原文。${nz?`最近的${esc(langLabel(S.lang))}版本是 <a href="#" data-goto-ver="${esc(nz)}">${esc(ver(nz).label)}</a>。`:''}</div>`;}
  return '';
}
function afterInsert(root){
  root.querySelectorAll('table').forEach(t=>{if(t.parentElement.classList.contains('tw'))return;const w=document.createElement('div');w.className='tw';t.replaceWith(w);w.appendChild(t);});
  const used={};
  root.querySelectorAll('h1,h2,h3,h4').forEach(h=>{
    let id=h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,80)||'s';
    if(used[id]){used[id]++;id+='-'+used[id];}else used[id]=1;
    h.id=id;
    if(h.tagName!=='H1'){const a=document.createElement('a');a.className='anchor';a.href='#'+id;a.textContent='#';a.addEventListener('click',e=>{e.preventDefault();h.scrollIntoView();});h.appendChild(a);}
  });
  root.querySelectorAll('a[data-goto-ver]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();set({ver:a.dataset.gotoVer});}));
  root.querySelectorAll('a[data-goto-base]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();set({base:a.dataset.gotoBase});}));
  root.querySelectorAll('a[href]').forEach(a=>{const h=a.getAttribute('href');if(/^https?:/.test(h)){a.target='_blank';a.rel='noopener';}});
}

/* ---------- read ---------- */
async function renderRead(page,right,seq){
  const md=await api.blob(shaOf(S.ver,S.doc,S.lang));if(seq!==renderSeq)return;
  page.innerHTML=metaLine()+langBanner()+changelogBox(S.ver)+`<article class="doc">${marked.parse(md)}</article>`;
  afterInsert(page);buildToc(page.querySelector('article'),right);
}
function buildToc(article,right){
  const hs=[...article.querySelectorAll('h2,h3')];
  if(!hs.length){right.innerHTML='<div class="empty">本文档没有小节。</div>';return;}
  right.innerHTML=`<h4>目录 <span class="mono">${hs.filter(h=>h.tagName==='H2').length} 节</span></h4><div class="toc">${hs.map(h=>`<a href="#${h.id}" class="${h.tagName==='H3'?'l3':''}" data-id="${h.id}">${esc(h.textContent.replace(/#$/,''))}</a>`).join('')}</div>`;
  right.querySelectorAll('.toc a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const h=document.getElementById(a.dataset.id);if(h)h.scrollIntoView();}));
  spy(hs,right);
}
let spyObs=null;
function spy(hs,right){
  if(spyObs)spyObs.disconnect();
  const links={};right.querySelectorAll('.toc a').forEach(a=>links[a.dataset.id]=a);
  const main=$('#main');let current=null;
  spyObs=new IntersectionObserver(()=>{
    const top=main.getBoundingClientRect().top+80;let best=null;
    for(const h of hs){if(h.getBoundingClientRect().top<=top)best=h;else break;}
    best=best||hs[0];
    if(best!==current){current=best;Object.values(links).forEach(a=>a.classList.remove('on'));const a=links[best.id];if(a){a.classList.add('on');a.scrollIntoView({block:'nearest'});}}
  },{root:main,rootMargin:'-80px 0px -60% 0px',threshold:[0,1]});
  hs.forEach(h=>spyObs.observe(h));
}

/* ---------- overview ---------- */
function renderOverview(page,right){
  const rows=D.versions.slice().reverse().map(v=>{
    const chg=changedDocs(v.id);
    const head=v.changelog?(v.changelog.match(/\*\*(.+?)\*\*/)||[])[1]:null;
    const chips=chg.length?chg.map(c=>`<button class="${c.neu?'new':''}" data-doc="${esc(c.id)}" data-ver="${esc(v.id)}" title="${c.neu?'本版本新增':'查看与上一版本的对比'}">${esc(docShort(c.id))}</button>`).join(''):'<span class="none">文档无变化</span>';
    return `<div class="vrow" id="v-${esc(v.id)}"><div class="tag"><button data-ver="${esc(v.id)}">${esc(v.label)}</button>${v.id===S.ver?'<span class="cur">当前选中</span>':''}</div><div class="date">${v.date}</div><div><div class="head">${head?marked.parseInline(head):(v.kind==='commit'?esc(v.label.replace(/^\S+\s/,'')):'<span style="color:var(--muted)">（无 CHANGELOG 条目）</span>')}</div><div class="chips">${chips}</div>${v.changelog?`<details><summary>完整 CHANGELOG 条目</summary><div class="body">${marked.parse(v.changelog)}</div></details>`:''}</div></div>`;
  }).join('');
  const f=D.versions[0],l=D.versions[D.versions.length-1];
  page.innerHTML=`<div class="ov"><h1>版本总览</h1><p class="lede">${D.versions.length} 个版本，从 <span class="mono">${esc(f.label.slice(0,30))}</span>（${f.date}）到 <span class="mono">${esc(l.label.slice(0,30))}</span>（${l.date}）。点击版本号阅读该版本；点击文档芯片查看它相比上一版本的逐段对比。</p><div class="vt">${rows}</div></div>`;
  page.querySelectorAll('.chips button').forEach(b=>b.addEventListener('click',()=>set({view:'doc',doc:b.dataset.doc,ver:b.dataset.ver,base:'prev',mode:'diff'})));
  page.querySelectorAll('.tag button').forEach(b=>b.addEventListener('click',()=>set({view:'doc',ver:b.dataset.ver,mode:'read'})));
  right.innerHTML=`<h4>跳转</h4><div class="toc">${D.versions.slice().reverse().map(v=>`<a href="#" class="mono" data-id="v-${esc(v.id)}">${esc(v.label.slice(0,22))} <span style="color:var(--muted)">${changedDocs(v.id).length?'· '+changedDocs(v.id).length+' 份':''}</span></a>`).join('')}</div>`;
  right.querySelectorAll('.toc a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const el=document.getElementById(a.dataset.id);if(el)el.scrollIntoView();}));
}

/* ================= diff engine ================= */
function diffSeq(a,b,ai=0,bi=0){
  let s=0;const n=a.length,m=b.length;
  while(s<n&&s<m&&a[s]===b[s])s++;
  let e=0;while(e<n-s&&e<m-s&&a[n-1-e]===b[m-1-e])e++;
  const out=[];for(let k=0;k<s;k++)out.push({t:'=',i:ai+k,j:bi+k});
  const A=a.slice(s,n-e),B=b.slice(s,m-e);
  if(A.length&&B.length)out.push(...diffCore(A,B,ai+s,bi+s));
  else{for(let k=0;k<A.length;k++)out.push({t:'-',i:ai+s+k});for(let k=0;k<B.length;k++)out.push({t:'+',j:bi+s+k});}
  for(let k=0;k<e;k++)out.push({t:'=',i:ai+n-e+k,j:bi+m-e+k});
  return out;
}
function diffCore(a,b,ai,bi){
  if(a.length*b.length<=3e6)return lcsDP(a,b,ai,bi);
  const ca=new Map(),cb=new Map();
  a.forEach((x,i)=>ca.set(x,ca.has(x)?-1:i));b.forEach((x,j)=>cb.set(x,cb.has(x)?-1:j));
  const cand=[];for(const [x,i] of ca)if(i>=0&&cb.get(x)>=0)cand.push([i,cb.get(x)]);
  cand.sort((p,q)=>p[0]-q[0]);
  const tails=[],prev=new Array(cand.length),tailIdx=[];
  for(let k=0;k<cand.length;k++){const j=cand[k][1];let lo=0,hi=tails.length;while(lo<hi){const mid=(lo+hi)>>1;if(tails[mid]<j)lo=mid+1;else hi=mid;}tails[lo]=j;tailIdx[lo]=k;prev[k]=lo>0?tailIdx[lo-1]:-1;}
  const anchors=[];let k=tails.length?tailIdx[tails.length-1]:-1;while(k>=0){anchors.push(cand[k]);k=prev[k];}anchors.reverse();
  if(!anchors.length){
    if(a.length*b.length<=2e7){const h=a.length>>1,hb=Math.round(b.length*h/a.length);return diffSeq(a.slice(0,h),b.slice(0,hb),ai,bi).concat(diffSeq(a.slice(h),b.slice(hb),ai+h,bi+hb));}
    const out=[];a.forEach((_,i)=>out.push({t:'-',i:ai+i}));b.forEach((_,j)=>out.push({t:'+',j:bi+j}));return out;
  }
  const out=[];let pa=0,pb=0;
  for(const [i,j] of anchors){out.push(...diffSeq(a.slice(pa,i),b.slice(pb,j),ai+pa,bi+pb));out.push({t:'=',i:ai+i,j:bi+j});pa=i+1;pb=j+1;}
  out.push(...diffSeq(a.slice(pa),b.slice(pb),ai+pa,bi+pb));
  return out;
}
function lcsDP(a,b,ai,bi){
  const n=a.length,m=b.length,W=m+1;const T=new Uint16Array((n+1)*W);
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)T[i*W+j]=a[i]===b[j]?T[(i+1)*W+j+1]+1:Math.max(T[(i+1)*W+j],T[i*W+j+1]);
  const out=[];let i=0,j=0;
  while(i<n&&j<m){if(a[i]===b[j]){out.push({t:'=',i:ai+i,j:bi+j});i++;j++;}else if(T[(i+1)*W+j]>=T[i*W+j+1]){out.push({t:'-',i:ai+i});i++;}else{out.push({t:'+',j:bi+j});j++;}}
  while(i<n){out.push({t:'-',i:ai+i});i++;}while(j<m){out.push({t:'+',j:bi+j});j++;}
  return out;
}
function runs(ops){
  const out=[];let cur=null;
  for(const o of ops){
    if(o.t==='='){if(!cur||cur.type!=='eq'){cur={type:'eq',items:[]};out.push(cur);}cur.items.push(o);}
    else{if(!cur||cur.type!=='chg'){cur={type:'chg',del:[],ins:[]};out.push(cur);}(o.t==='-'?cur.del:cur.ins).push(o);}
  }
  return out;
}
function splitBlocks(md){
  const lines=md.replace(/\r\n?/g,'\n').split('\n');const blocks=[];let cur=[],fence=null;
  const flush=()=>{if(cur.length){blocks.push(cur.join('\n'));cur=[];}};
  for(const line of lines){
    if(fence){cur.push(line);if(line.trim().startsWith(fence)){flush();fence=null;}continue;}
    const m=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(m){flush();fence=m[1];cur.push(line);continue;}
    if(line.trim()===''){flush();continue;}
    if(/^#{1,6}\s/.test(line)){flush();blocks.push(line);continue;}
    cur.push(line);
  }
  flush();return blocks;
}
const isHeading=b=>/^#{1,6}\s/.test(b);
const isFence=b=>/^\s{0,3}(`{3,}|~{3,})/.test(b);
const isTableRow=l=>/^\s*\|/.test(l);
const isTableSep=l=>/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const isFenceLine=l=>/^\s{0,3}(`{3,}|~{3,})/.test(l);
const PREFIX=/^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+)?(?:\[[ xX]\]\s+)?)/;
const TOK=/\p{Script=Han}|[\p{L}\p{N}_][\p{L}\p{N}_.\-]*|\s+|./gsu;
const tokens=s=>s.match(TOK)||[];
const splitCells=l=>l.split(/(?<!\\)\|/);
function wrapLine(line,O,C){
  if(isFenceLine(line))return line;
  if(isTableRow(line)){if(isTableSep(line))return line;return splitCells(line).map(c=>c.trim()===''?c:c.replace(/^(\s*)(.*?)(\s*)$/s,(_,a,b,z)=>a+O+b+C+z)).join('|');}
  const m=line.match(PREFIX);const rest=line.slice(m[0].length);
  if(rest.trim()==='')return line;
  return m[0]+O+rest+C;
}
function wrapMarkup(ops,ta,tb){
  let out='';for(const r of runs(ops)){
    if(r.type==='eq')out+=r.items.map(o=>ta[o.i]).join('');
    else{if(r.del.length)out+=O_DEL+r.del.map(o=>ta[o.i]).join('')+C_DEL;if(r.ins.length)out+=O_INS+r.ins.map(o=>tb[o.j]).join('')+C_INS;}
  }return out;
}
function inlineText(a,b){
  const ta=tokens(a),tb=tokens(b);const ops=diffSeq(ta,tb);
  const sig=t=>t.trim()!=='';
  const eq=ops.filter(o=>o.t==='='&&sig(ta[o.i])).length,tot=Math.max(ta.filter(sig).length,tb.filter(sig).length)||1;
  if(eq/tot<0.4)return null;
  return wrapMarkup(ops,ta,tb);
}
function inlineLine(a,b){
  if(isFenceLine(a)||isFenceLine(b))return null;
  if(isTableRow(a)&&isTableRow(b)){
    if(isTableSep(a)||isTableSep(b))return isTableSep(a)&&isTableSep(b)?b:null;
    const ca=splitCells(a),cb=splitCells(b);if(ca.length!==cb.length)return null;
    return cb.map((c,k)=>{if(c===ca[k])return c;const A=ca[k].trim(),B=c.trim();const lead=c.match(/^\s*/)[0],trail=c.match(/\s*$/)[0];
      if(!A)return lead+O_INS+B+C_INS+trail;if(!B)return lead+O_DEL+A+C_DEL+trail;
      const r=inlineText(A,B);return lead+(r!=null?r:O_DEL+A+C_DEL+' '+O_INS+B+C_INS)+trail;}).join('|');
  }
  if(isTableRow(a)!==isTableRow(b))return null;
  const ma=a.match(PREFIX)[0],mb=b.match(PREFIX)[0];
  if(ma!==mb)return null;
  const r=inlineText(a.slice(ma.length),b.slice(mb.length));
  return r==null?null:mb+r;
}
function mergeBlock(oldB,newB){
  const la=oldB.split('\n'),lb=newB.split('\n');const out=[];
  for(const r of runs(diffSeq(la,lb))){
    if(r.type==='eq'){r.items.forEach(o=>out.push(lb[o.j]));continue;}
    const n=Math.min(r.del.length,r.ins.length);
    for(let k=0;k<n;k++){const A=la[r.del[k].i],B=lb[r.ins[k].j];const m=inlineLine(A,B);if(m!=null)out.push(m);else{out.push(wrapLine(A,O_DEL,C_DEL));out.push(wrapLine(B,O_INS,C_INS));}}
    for(let k=n;k<r.del.length;k++)out.push(wrapLine(la[r.del[k].i],O_DEL,C_DEL));
    for(let k=n;k<r.ins.length;k++)out.push(wrapLine(lb[r.ins[k].j],O_INS,C_INS));
  }
  return out.join('\n');
}
const wrapBlock=(b,O,C)=>b.split('\n').map(l=>wrapLine(l,O,C)).join('\n');
function renderMd(md){return marked.parse(md).replace(SENT,c=>SENT_MAP[c]);}
function blockDiff(oldMd,newMd){
  const A=splitBlocks(oldMd),B=splitBlocks(newMd);
  const norm=s=>s.replace(/\s+$/gm,'');
  const ops=diffSeq(A.map(norm),B.map(norm));
  const model=[];
  for(const r of runs(ops)){
    if(r.type==='eq'){r.items.forEach(o=>model.push({type:'eq',md:B[o.j],heading:isHeading(B[o.j])}));continue;}
    const dels=r.del.map(o=>A[o.i]),ins=r.ins.map(o=>B[o.j]);
    const pairOf=new Map(),insToDel=new Map();let from=0;
    const bag=b=>{const m=new Map();let n=0;for(const t of tokens(b)){if(!t.trim())continue;n++;m.set(t,(m.get(t)||0)+1);}return {m,n};};
    const bagsB=ins.map(bag);
    const sim=(x,y)=>{if(!x.n||!y.n)return 0;let c=0;for(const [t,k] of x.m){const q=y.m.get(t);if(q)c+=Math.min(k,q);}return 2*c/(x.n+y.n);};
    dels.forEach((d,di)=>{let best=-1,bs=0;const bd=bag(d);
      for(let ni=from;ni<Math.min(ins.length,from+60);ni++){const n=ins[ni];if(isFence(d)!==isFence(n)||isHeading(d)!==isHeading(n))continue;const e=sim(bd,bagsB[ni]);if(e>bs){bs=e;best=ni;}}
      if(best>=0&&bs>=0.45){pairOf.set(di,best);insToDel.set(best,di);from=best+1;}});
    const posOf=new Array(dels.length);
    for(let di=dels.length-1,nextPos=ins.length;di>=0;di--){if(pairOf.has(di))nextPos=pairOf.get(di);else posOf[di]=nextPos;}
    for(let ni=0;ni<=ins.length;ni++){
      dels.forEach((d,di)=>{if(!pairOf.has(di)&&posOf[di]===ni)model.push({type:'del',md:d,heading:isHeading(d)});});
      if(ni<ins.length){const di=insToDel.get(ni);
        if(di!=null)model.push({type:'mod',md:mergeBlock(dels[di],ins[ni]),heading:isHeading(ins[ni])});
        else model.push({type:'ins',md:ins[ni],heading:isHeading(ins[ni])});}
    }
  }
  return model;
}

/* ---------- diff view ---------- */
let changeEls=[];
function pickLang(from,to){
  let lang=S.lang,note='';
  if(lang!=='base'&&!(hasLang(from,S.doc,lang)&&hasLang(to,S.doc,lang))){
    const L=langLabel(lang);const lack=[from,to].filter(t=>!hasLang(t,S.doc,lang)).map(t=>ver(t).label).join('、');
    const nz=nearestLang(S.ver,S.doc,lang);
    note=`<div class="banner">${esc(lack)} 没有此文档的${esc(L)}版本，以原文对比。${nz&&nz!==baseId()?`可改为与最近有${esc(L)}版本的 <a href="#" data-goto-base="${esc(nz)}">${esc(ver(nz).label)}</a> 比较。`:''}</div>`;
    lang='base';
  }
  return {lang,note};
}
async function renderDiff(page,right,seq){
  const base=baseId();
  if(!base){page.innerHTML=metaLine()+`<div class="banner info">${esc(ver(S.ver).label)} 是最早的版本，没有可比较的基准。</div>`;right.innerHTML='';return;}
  const forward=VI[base]<VI[S.ver];const from=forward?base:S.ver,to=forward?S.ver:base;
  const {lang,note}=pickLang(from,to);
  const [oldMd,newMd]=await Promise.all([shaOf(from,S.doc,lang)?api.blob(shaOf(from,S.doc,lang)):'',shaOf(to,S.doc,lang)?api.blob(shaOf(to,S.doc,lang)):'']);
  if(seq!==renderSeq)return;
  const t0=performance.now();
  const model=blockDiff(oldMd,newMd);
  const cnt={ins:0,del:0,mod:0};model.forEach(b=>{if(cnt[b.type]!=null)cnt[b.type]++;});
  const lineOps=diffSeq(oldMd.split('\n'),newMd.split('\n'));
  const lc={i:lineOps.filter(o=>o.t==='+').length,d:lineOps.filter(o=>o.t==='-').length};
  const stats=`<span class="stats"><span class="i">+${lc.i} 行</span><span class="d">−${lc.d} 行</span><span class="m">~${cnt.mod} 段</span></span>`;
  const meta=`<div class="docmeta"><span class="tag">${esc(ver(from).label)}</span><span>→</span><span class="tag">${esc(ver(to).label)}</span><span>${ver(to).date}</span><span>${esc(langLabel(lang))}</span>${stats}</div>`;
  const label={ins:'新增',del:'删除',mod:'修改'};
  let html='',fold=[];const nav=[];let curHead=null;
  const flushFold=()=>{if(!fold.length)return;if(fold.length<=2){html+=fold.join('');}else{html+=`<div class="fold"><button>展开 ${fold.length} 段未改动内容</button><div class="fold-body hidden">${fold.join('')}</div></div>`;}fold=[];};
  model.forEach((b,idx)=>{
    if(b.heading){const t=b.md.replace(/[^]*/g,'').replace(SENT,'').split('\n').map(l=>l.replace(/^#+\s*/,'').replace(/[`*]/g,'').trim()).filter(Boolean);curHead={text:t[t.length-1]||'',level:(b.md.match(/^#+/)||['##'])[0].length,idx};}
    if(b.type==='eq'){const h=`<section class="blk blk-eq" data-n="${idx}">${renderMd(b.md)}</section>`;if(S.only&&!b.heading)fold.push(h);else{flushFold();html+=h;}return;}
    flushFold();
    html+=`<section class="blk blk-${b.type}" data-n="${idx}" data-label="${label[b.type]}">${renderMd(b.type==='mod'?b.md:wrapBlock(b.md,b.type==='ins'?O_INS:O_DEL,b.type==='ins'?C_INS:C_DEL))}</section>`;
    const key=curHead?curHead.idx:-1;let e=nav.find(x=>x.key===key);
    if(!e){e={key,head:curHead?curHead.text:'（文首）',level:curHead?curHead.level:2,first:idx,ins:0,del:0,mod:0};nav.push(e);}
    e[b.type]++;
  });
  flushFold();
  const dt=Math.round(performance.now()-t0);
  page.innerHTML=meta+note+changelogBox(to)+(model.every(b=>b.type==='eq')?`<div class="banner info">两个版本的此文档内容完全一致。</div>`:'')+`<article class="doc diff">${html}</article>`;
  afterInsert(page);
  page.querySelectorAll('.fold>button').forEach(b=>b.addEventListener('click',()=>{b.nextElementSibling.classList.remove('hidden');b.remove();}));
  changeEls=[...page.querySelectorAll('.blk-ins,.blk-del,.blk-mod')];
  right.innerHTML=`<h4>改动导航 <span class="mono">${changeEls.length} 处 · ${dt}ms</span></h4>
    <div class="railtools"><label><input type="checkbox" id="onlyChk" ${S.only?'checked':''}> 折叠未改动段落</label><span class="sp"></span><button class="ib" id="chgPrev" title="上一处 (p)">↑</button><button class="ib" id="chgNext" title="下一处 (n)">↓</button></div>
    ${nav.length?`<div class="chg">${nav.map(e=>`<button data-first="${e.first}"><span class="h ${e.level>=3?'l3':''}" title="${esc(e.head)}">${esc(e.head)}</span><span class="c">${e.ins?`<span class="i">+${e.ins}</span> `:''}${e.del?`<span class="d">−${e.del}</span> `:''}${e.mod?`<span class="m">~${e.mod}</span>`:''}</span></button>`).join('')}</div>`:'<div class="empty">没有改动。</div>'}`;
  $('#onlyChk').addEventListener('change',e=>set({only:e.target.checked}));
  $('#chgPrev').addEventListener('click',()=>jumpChange(-1));$('#chgNext').addEventListener('click',()=>jumpChange(1));
  right.querySelectorAll('.chg button').forEach(b=>b.addEventListener('click',()=>{const el=page.querySelector(`.blk[data-n="${b.dataset.first}"]`);if(el)reveal(el);}));
}
function reveal(el){
  const fb=el.closest('.fold-body');if(fb){fb.classList.remove('hidden');const btn=fb.previousElementSibling;if(btn)btn.remove();}
  el.scrollIntoView({block:'center'});el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
}
function jumpChange(dir){
  if(S.view!=='doc'||S.mode!=='diff'||!changeEls.length)return;
  const main=$('#main'),top=main.getBoundingClientRect().top+main.clientHeight/2;
  let idx=-1;changeEls.forEach((el,i)=>{if(el.getBoundingClientRect().top<top-4)idx=i;});
  let next=dir>0?idx+1:idx;if(dir<0&&changeEls[idx]&&Math.abs(changeEls[idx].getBoundingClientRect().top-(top-changeEls[idx].offsetHeight/2))<6)next=idx-1;
  next=Math.max(0,Math.min(changeEls.length-1,next));
  reveal(changeEls[next]);
}

/* ---------- source view ---------- */
async function renderSource(page,right,seq){
  const base=baseId();
  if(!base){page.innerHTML=metaLine()+`<div class="banner info">${esc(ver(S.ver).label)} 是最早的版本，没有可比较的基准。</div>`;right.innerHTML='';return;}
  const forward=VI[base]<VI[S.ver];const from=forward?base:S.ver,to=forward?S.ver:base;
  const {lang,note}=pickLang(from,to);
  const [oa,ob]=await Promise.all([shaOf(from,S.doc,lang)?api.blob(shaOf(from,S.doc,lang)):'',shaOf(to,S.doc,lang)?api.blob(shaOf(to,S.doc,lang)):'']);
  if(seq!==renderSeq)return;
  const la=oa.split('\n'),lb=ob.split('\n');
  const ops=diffSeq(la,lb);const CTX=3;
  const keep=new Array(ops.length).fill(false);
  ops.forEach((o,k)=>{if(o.t!=='='){for(let d=-CTX;d<=CTX;d++)if(ops[k+d])keep[k+d]=true;}});
  let rows='',gap=[],hunks=0,lastWasChange=false;
  const flushGap=()=>{if(!gap.length)return;rows+=`<tr class="gap"><td colspan="4">⋯ ${gap.length} 行未改动，点击展开</td></tr><tbody class="hidden">${gap.join('')}</tbody>`;gap=[];};
  ops.forEach((o,k)=>{
    const cls=o.t==='='?'':o.t==='+'?'i':'d';
    const tr=`<tr class="${cls}"><td class="n">${o.i!=null?o.i+1:''}</td><td class="n">${o.j!=null?o.j+1:''}</td><td class="s">${o.t==='='?'':o.t}</td><td>${esc(o.t==='+'?lb[o.j]:la[o.i])||' '}</td></tr>`;
    if(!keep[k]){gap.push(tr);lastWasChange=false;return;}
    flushGap();if(o.t!=='='&&!lastWasChange)hunks++;lastWasChange=o.t!=='=';rows+=tr;
  });
  flushGap();
  const ni=ops.filter(o=>o.t==='+').length,nd=ops.filter(o=>o.t==='-').length;
  page.innerHTML=`<div class="docmeta"><span class="tag">${esc(ver(from).label)}</span><span>→</span><span class="tag">${esc(ver(to).label)}</span><span>${esc(langLabel(lang))}</span><span class="stats"><span class="i">+${ni}</span><span class="d">−${nd}</span></span></div>${note}${changelogBox(to)}${ni+nd===0?'<div class="banner info">两个版本的此文档源码完全一致。</div>':''}<div class="src"><table>${rows}</table></div>`;
  afterInsert(page);
  page.querySelectorAll('tr.gap').forEach(tr=>tr.addEventListener('click',()=>{const tb=tr.nextElementSibling;if(tb)tb.classList.remove('hidden');tr.remove();}));
  right.innerHTML=`<h4>源码对比 <span class="mono">${hunks} 处</span></h4><div class="empty">逐行对比 Markdown 源码，上下各保留 3 行上下文。<span class="mono" style="color:var(--ins-ink)">+${ni}</span> / <span class="mono" style="color:var(--del-ink)">−${nd}</span> 行。</div>`;
}

marked.setOptions({gfm:true,breaks:false});
window.__gdv={diffSeq,splitBlocks,blockDiff,mergeBlock,renderMd,tokens,S:()=>S,D:()=>D};
boot().catch(e=>{$('#page').innerHTML=`<div class="banner err">启动失败：${esc(e.message)}</div>`;console.error(e);});
})();
