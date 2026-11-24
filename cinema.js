(() => {
'use strict';
const byId = id => document.getElementById(id);
const collectionInfo = {
  kv:{title:'Kurtlar Vadisi',kind:'Dizi',subtitle:'Efsane geri dönüyor',key:'EFSANE DİZİ'},
  pusu:{title:'Kurtlar Vadisi Pusu',kind:'Dizi',subtitle:'Hikâye devam ediyor',key:'AKSİYON'},
  uvb:{title:'Üvey Baba',kind:'Dizi',subtitle:'Türk televizyon klasiği',key:'KLASİK DİZİ'},
  cin:{title:'Cin Filmleri',kind:'Film',subtitle:'Korku gecesi',key:'KORKU'},
  ks:{title:'Kemal Sunal',kind:'Film',subtitle:'Unutulmayan komediler',key:'KOMEDİ'},
  yes:{title:'Yeşilçam',kind:'Film',subtitle:'Türk sinemasının klasikleri',key:'YEŞİLÇAM'},
  ts:{title:'Türk Sineması',kind:'Film',subtitle:'Yerli sinema seçkisi',key:'YERLİ FİLM'},
  dub:{title:'Türkçe Dublaj',kind:'Film',subtitle:'Dünya sineması',key:'DUBLAJ'}
};
const seriesIds=['kv','pusu','uvb'];
const filmIds=['cin','ks','yes','ts','dub'];
const data={};
const watchState={id:null,number:null,entry:null};
let selectedCollection=null,shown=0,currentFiltered=[],lastFocus=null;
let tvState='unknown',tvChecking=false,toastTimer=null,openLayerName='';
const HOST_TV_FALLBACK='https://learned-phpbb-rental-contests.trycloudflare.com/tv-guest';
let currentTvUrl=HOST_TV_FALLBACK;
const recentKey='ibo-cinema-history-v2';

function text(tag,content,cls){
 const e=document.createElement(tag);if(cls)e.className=cls;
 e.textContent=String(content??'');return e;
}
function thumb(item){
 const id=item?.id;
 return typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)
 ? 'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'
 : '';
}
function niceTitle(section,item){
 if(item.t)return item.t;
 return collectionInfo[section].title+' · '+item.n+'. Bölüm';
}
function miniLabel(section,item){
 const kind=collectionInfo[section].kind;
 return kind==='Dizi'?'Bölüm '+item.n:'Film '+item.n;
}
function quality(item){
 if(item.q>=2160)return '4K etiketli kaynak';
 if(item.q>=1080)return 'HD kaynak';
 if(item.q>=720)return '720p kaynak';
 return '';
}
function minutes(s){
 const n=Math.round(Number(s)/60);
 return n>0?n+' dk':'';
}
function safeHistory(){
 try{const x=JSON.parse(localStorage.getItem(recentKey)||'[]');return Array.isArray(x)?x:[]}catch{return []}
}
function saveHistory(category,item){
 try{
  const key=category+'-'+item.n;
  const result=[{key,category,n:item.n,at:Date.now()},...safeHistory().filter(x=>x.key!==key)].slice(0,20);
  localStorage.setItem(recentKey,JSON.stringify(result));
 }catch{}
}
function toast(msg){
 const e=byId('toast');e.textContent=msg;e.classList.add('on');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('on'),3500);
}
function layerOpen(id){
 if(openLayerName&&openLayerName!==id)layerClose(openLayerName,false);
 lastFocus=document.activeElement;
 openLayerName=id;
 const el=byId(id);el.classList.add('open');el.setAttribute('aria-hidden','false');
 document.body.classList.add('modal-active');
 const first=el.querySelector('.dialog-close,.watch-header__button--close');
 first?.focus({preventScroll:true});
}
function layerClose(id,restore=true){
 const el=byId(id);el.classList.remove('open');el.setAttribute('aria-hidden','true');
 if(id==='videoLayer'){const frame=byId('videoFrame');frame.src='about:blank';watchState.id=null;watchState.entry=null;watchState.number=null}
 if(id==='liveLayer'){byId('liveFrame').src='about:blank'}
 if(openLayerName===id)openLayerName='';
 if(!openLayerName)document.body.classList.remove('modal-active');
 if(restore)lastFocus?.focus?.({preventScroll:true});
}
function imageMarkup(item,cls){
 const box=text('span','',cls);
 if(thumb(item)){
  const im=document.createElement('img');im.alt='';im.loading='lazy';im.decoding='async';im.src=thumb(item);
  im.onerror=()=>{im.onerror=null;box.style.background='linear-gradient(125deg,#293a51,#432033)';im.remove()};
  box.appendChild(im);
 }
 return box;
}
function entryCard(section,item,cls='media-card'){
 const info=collectionInfo[section];
 const b=document.createElement('button');b.type='button';b.className=cls;
 b.setAttribute('aria-label',niceTitle(section,item)+' izlemek için aç');
 const visual=imageMarkup(item,'media-card__image');
 const play=text('span','','media-card__play');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
 const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m8 5 11 7-11 7z');svg.append(path);play.appendChild(svg);
 visual.appendChild(play);
 const q=quality(item);
 if(q)visual.appendChild(text('span',q,'media-card__badge'));
 const details=text('span','','media-card__info');
 details.append(text('strong',niceTitle(section,item)));
 const secondary=[miniLabel(section,item),minutes(item.d)].filter(Boolean).join(' · ');
 details.append(text('small',secondary));
 b.append(visual,details);
 if(item.y||(!item.id&&!item.v)){
  b.disabled=true;
  b.title='Kaynak henüz eklenmedi';
 }else{
  b.addEventListener('click',()=>playEntry(section,item));
 }
 return b;
}
function collectionTile(id){
 const info=collectionInfo[id],items=data[id]||[];
 const b=document.createElement('button');b.type='button';b.className='collection-tile';
 b.dataset.category=id;
 const poster=items.find(x=>x?.id)||items[0];
 if(thumb(poster))b.style.setProperty('--poster','url("'+thumb(poster)+'")');
 const top=text('span','','collection-tile__top');
 top.append(text('span',info.key,'collection-tile__pill'));
 top.append(text('span',items.length+(info.kind==='Dizi'?' bölüm':' film'),'collection-tile__count'));
 const bottom=text('span','','collection-tile__bottom');
 bottom.append(text('strong',info.title,'collection-tile__title'),text('small',info.subtitle+'  →','collection-tile__subtitle'));
 b.append(top,bottom);
 b.onclick=()=>openCollection(id);
 return b;
}
function renderRails(){
 const series=byId('seriesCollections'),films=byId('filmCollections');
 series.replaceChildren(...seriesIds.map(collectionTile));
 films.replaceChildren(...filmIds.map(collectionTile));
 for(const [id,target] of [['kv','kvRail'],['pusu','pusuRail'],['cin','cinRail'],['ks','ksRail']]){
  const items=(data[id]||[]).filter(x=>!x.y&&x.id).slice(0,12);
  byId(target).replaceChildren(...items.map(it=>entryCard(id,it)));
 }
 byId('heroMeta').textContent=(data.kv?.length||0)+' bölüm · Kurtlar Vadisi arşivi';
}
function openCollection(id){
 if(!collectionInfo[id])return;
 selectedCollection=id;shown=0;lastFocus=document.activeElement;
 byId('catalogDialogTitle').textContent=collectionInfo[id].title;
 byId('catalogFilter').value='';byId('catalogSort').value='asc';
 layerOpen('catalogLayer');filterCollection(true);
}
function filterCollection(reset=false){
 if(!selectedCollection)return;
 const category=selectedCollection,needle=byId('catalogFilter').value.toLocaleLowerCase('tr').trim();
 const reverse=byId('catalogSort').value==='desc';
 currentFiltered=(data[category]||[]).filter(x=>{
  if(!needle)return true;
  return niceTitle(category,x).toLocaleLowerCase('tr').includes(needle)||
   String(x.n).includes(needle);
 });
 if(reverse)currentFiltered=currentFiltered.slice().reverse();
 byId('catalogDialogCount').textContent=currentFiltered.length+' '+(collectionInfo[category].kind==='Dizi'?'bölüm':'film');
 if(reset)shown=0;
 appendCatalog(true);
}
function appendCatalog(reset=false){
 if(reset){byId('catalogGrid').replaceChildren();shown=0}
 const target=byId('catalogGrid');
 const take=currentFiltered.slice(shown,shown+32);
 const frag=document.createDocumentFragment();
 for(const item of take)frag.append(entryCard(selectedCollection,item));
 target.append(frag);
 shown+=take.length;
 byId('loadMore').hidden=shown>=currentFiltered.length;
 if(!currentFiltered.length)target.replaceChildren(text('p','Aradığın içerik bulunamadı.','empty-message'));
}
function chooseNeighbor(direction){
 if(!watchState.id||!watchState.entry)return;
 const entries=data[watchState.id]||[],oldIndex=entries.findIndex(x=>x.n===watchState.number);
 let i=oldIndex+direction;
 while(i>=0&&i<entries.length&&(entries[i].y||(!entries[i].id&&!entries[i].v)))i+=direction;
 if(i<0||i>=entries.length)return;
 playEntry(watchState.id,entries[i]);
}
function updateNeighbors(){
 const category=watchState.id,item=watchState.entry;
 const prev=byId('previousEpisode'),next=byId('nextEpisode');
 const isSeries=category&&collectionInfo[category]?.kind==='Dizi';
 prev.hidden=next.hidden=!isSeries;
 if(!isSeries)return;
 const arr=data[category]||[],index=arr.findIndex(x=>x.n===item.n);
 const playable=x=>x&&!x.y&&(x.id||x.v);
 prev.disabled=!arr.slice(0,index).some(playable);
 next.disabled=!arr.slice(index+1).some(playable);
}
function playEntry(section,item){
 if(item.y){toast('Bu içerik henüz oynatılabilir değil.');return}
 if(item.x){
  // Bu kaynaklar orijinal arşivde yalnızca YouTube üzerinde açılacak şekilde işaretli.
  if(item.id){window.open('https://www.youtube.com/watch?v='+item.id,'_blank','noopener,noreferrer');saveHistory(section,item)}
  return;
 }
 if(!item.id&&!item.v){toast('İçerik kaynağı bulunamadı.');return}
 if(byId('catalogLayer').classList.contains('open'))layerClose('catalogLayer',false);
 watchState.id=section;watchState.number=item.n;watchState.entry=item;
 const name=niceTitle(section,item);
 byId('videoTitle').textContent=name;
 byId('videoDescription').textContent=collectionInfo[section].title+' · '+miniLabel(section,item)+' · Görüntü kalitesi kaynağa ve bağlantıya göre değişir.';
 const frame=byId('videoFrame');
 if(item.v&&/^https:\/\//.test(item.v)){
  // Doğrudan video URL'leri bu arşivde kullanılmıyor; yanlış medya kaynağı oluşturma.
  toast('Bu video biçimi desteklenmiyor.');return;
 }
 frame.src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(item.id)+'?autoplay=1&playsinline=1&rel=0&modestbranding=1';
 saveHistory(section,item);
 updateNeighbors();
 layerOpen('videoLayer');
}
function renderSearch(){
 const results=byId('searchResults'),query=byId('globalSearch').value.toLocaleLowerCase('tr').trim();
 if(!query){results.replaceChildren(text('p','Bir film, dizi veya bölüm adı yaz.','empty-message'));return}
 const found=[];
 for(const [category,items] of Object.entries(data)){
  if(!collectionInfo[category])continue;
  const categoryHit=collectionInfo[category].title.toLocaleLowerCase('tr').includes(query);
  for(const item of items){
   if(!categoryHit&&!niceTitle(category,item).toLocaleLowerCase('tr').includes(query))continue;
   found.push([category,item]);
   if(found.length>=48)break;
  }
  if(found.length>=48)break;
 }
 if(!found.length){results.replaceChildren(text('p','Bu aramayla eşleşen içerik bulunamadı.','empty-message'));return}
 const frag=document.createDocumentFragment();
 for(const [category,item] of found){
  const b=document.createElement('button');b.type='button';b.className='search-result';
  const img=imageMarkup(item,'search-result__image');
  b.append(img);
  const desc=text('span','');
  desc.append(text('strong',niceTitle(category,item)),text('small',collectionInfo[category].title+' · '+miniLabel(category,item)));
  b.append(desc);
  b.onclick=()=>{closeSearch();playEntry(category,item)};
  frag.append(b);
 }
 results.replaceChildren(frag);
}
function openSearch(){
 const drawer=byId('searchDrawer');drawer.hidden=false;
 byId('globalSearch').focus({preventScroll:true});renderSearch();
}
function closeSearch(){byId('searchDrawer').hidden=true;byId('globalSearch').value=''}
async function openLive(){
 const frame=byId('liveFrame');
 frame.src=currentTvUrl;
 layerOpen('liveLayer');
 try{
  const r=await fetch('/api/tv-status',{cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw Error('STATUS_UNAVAILABLE');
  const info=await r.json();
  if(info.viewerUrl&&byId('liveLayer').classList.contains('open')&&frame.src!==info.viewerUrl){currentTvUrl=info.viewerUrl;frame.src=currentTvUrl}
 }catch{}
}
function closeLive(){layerClose('liveLayer')}
function attachEvents(){
 byId('heroWatch').onclick=()=>{if(data.kv?.length)playEntry('kv',data.kv[0]);else toast('Arşiv yüklenemedi.')};
 byId('heroEpisodes').onclick=()=>openCollection('kv');
 byId('quickTv').onclick=openLive;
 byId('quickSeries').onclick=()=>byId('diziler').scrollIntoView({behavior:'smooth'});
 byId('quickMovies').onclick=()=>byId('filmler').scrollIntoView({behavior:'smooth'});
 for(const b of document.querySelectorAll('[data-open-collection]')){
  b.addEventListener('click',()=>openCollection(b.dataset.openCollection));
 }
 byId('headerLive').onclick=openLive;
 byId('mobileLive').onclick=openLive;
 byId('openLive').onclick=openLive;
 byId('catalogClose').onclick=()=>layerClose('catalogLayer');
 byId('videoClose').onclick=()=>layerClose('videoLayer');
 byId('closeLive').onclick=closeLive;
 byId('catalogFilter').addEventListener('input',()=>filterCollection(true));
 byId('catalogSort').addEventListener('change',()=>filterCollection(true));
 byId('loadMore').onclick=()=>appendCatalog(false);
 byId('previousEpisode').onclick=()=>chooseNeighbor(-1);
 byId('nextEpisode').onclick=()=>chooseNeighbor(1);
 byId('showEpisodes').onclick=()=>{
  const id=watchState.id;
  if(id){layerClose('videoLayer',false);openCollection(id)}
 };
 byId('reloadLive').onclick=()=>{const f=byId('liveFrame');f.src=f.src};
 byId('searchToggle').onclick=()=>byId('searchDrawer').hidden?openSearch():closeSearch();
 byId('searchClose').onclick=closeSearch;
 byId('globalSearch').addEventListener('input',renderSearch);
 document.querySelectorAll('[data-close="catalog"]').forEach(el=>el.onclick=()=>layerClose('catalogLayer'));
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
   if(openLayerName){e.preventDefault();layerClose(openLayerName);return}
   if(!byId('searchDrawer').hidden)closeSearch();
  }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch()}
  if(e.key==='Tab'&&openLayerName){
   const layer=byId(openLayerName);
   const focusable=[...layer.querySelectorAll('button:not(:disabled):not([hidden]),input:not(:disabled):not([hidden]),select:not(:disabled):not([hidden])')].filter(x=>x.offsetParent!==null);
   if(!focusable.length)return;
   const first=focusable[0],last=focusable.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
   if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
 });
}
async function tvHealth(){
 if(tvChecking||document.hidden)return;
 tvChecking=true;
 try{
  const ac=new AbortController(),timeout=setTimeout(()=>ac.abort(),6500);
  let r;
  try{r=await fetch('/api/tv-status',{cache:'no-store',signal:ac.signal})}finally{clearTimeout(timeout)}
  if(!r.ok)throw Error('NOT_READY');
  const data=await r.json();
  tvState=data.bridge==='online'?(data.configured?'online':'setup'):'offline';
  if(data.viewerUrl&&data.viewerUrl!==currentTvUrl){
   currentTvUrl=data.viewerUrl;
   if(byId('liveLayer').classList.contains('open')){byId('liveFrame').src=currentTvUrl;toast('Canlı TV bağlantısı yeniden kuruldu.');}
  }
 }catch{tvState='offline'}
 finally{tvChecking=false}
 const dot=byId('liveDot'),label=byId('liveLabel');
 dot.className='state-dot'+(tvState==='online'?' online':tvState==='offline'?' offline':'');
 label.textContent=tvState==='online'?'İzleme alanı hazır':tvState==='setup'?'Kurulum gerekiyor':'Bağlantı kontrol ediliyor';
}
async function init(){
 attachEvents();
 try{
  const r=await fetch('/catalog.json',{cache:'no-store'});
  if(!r.ok)throw Error('CATALOG_HTTP_'+r.status);
  const j=await r.json();
  if(j.version!==1||!j.sections||!Array.isArray(j.sections.kv))throw Error('INVALID_CATALOG');
  for(const id of Object.keys(collectionInfo)){
   data[id]=Array.isArray(j.sections[id])?j.sections[id].filter(x=>Number.isSafeInteger(x.n)&&x.n>0):[];
  }
  renderRails();
 }catch(err){
  console.error('İBO film arşivi yüklenemedi:',err.message);
  for(const key of ['kvRail','pusuRail','cinRail','ksRail'])byId(key).replaceChildren(text('p','Film arşivi geçici olarak yüklenemiyor.','empty-message'));
  toast('Film arşivi bağlantısı kontrol ediliyor.');
 }
 tvHealth();setInterval(tvHealth,19000);
 window.addEventListener('online',tvHealth);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tvHealth()});
}
init();
})();
