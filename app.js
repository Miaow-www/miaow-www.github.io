const $ = (id) => document.getElementById(id);
const detail = $('detail');
const panel = $('panel');
let groups = [];
let account = {};
let promptOpen;
let galleryReady = false;
let renderVersion = 0;
let paintedRoute;
let paintedQuery;
let detailTrigger;
const motionAllowed=matchMedia('(prefers-reduced-motion: no-preference)');
const isAdmin = () => ['owner','admin'].includes(account.role);
const route = () => location.hash.slice(1).split('/');

function element(tag,text='',className='') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label,run,style='small') {
  const node = element('button',label,style);
  node.type = 'button';
  node.addEventListener('click',run);
  return node;
}
const pagesOrigin='https://miaow-www.github.io';
const backend='https://miaow.bonny-scarf-6078.chatgpt.site';
const onPages=location.origin===pagesOrigin;
const sessionKey='mist-gallery-device';
let pagesToken=null;
if (onPages) {
  try { pagesToken=localStorage.getItem(sessionKey); } catch {}
}
function requestOptions(options={}) {
  if (!onPages) return options;
  return {...options,credentials:'omit',headers:pagesToken?{Authorization:'Bearer '+pagesToken}:{}};
}
async function api(path,method='GET',body) {
  const response=await fetch((onPages?backend:'')+'/api/'+path,requestOptions({method,body,cache:'no-store'}));
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
  return data;
}
const photoUrls=new Map();
const pendingPhotos=new WeakMap();
if (onPages) {
  new MutationObserver(()=>{
    for (const [img,url] of photoUrls) {
      if (!img.isConnected) {
        URL.revokeObjectURL(url);
        photoUrls.delete(img);
      }
    }
  }).observe(document.body,{childList:true,subtree:true});
}
async function setPhoto(img,path,link) {
  if (!onPages) {
    img.src=path;
    if (link) link.href=path;
    return;
  }
  const marker={};
  pendingPhotos.set(img,marker);
  const previous=photoUrls.get(img);
  if (previous) {
    URL.revokeObjectURL(previous);
    photoUrls.delete(img);
    img.removeAttribute('src');
  }
  try {
    const response=await fetch(backend+path,requestOptions());
    if (!response.ok || pendingPhotos.get(img)!==marker || !img.isConnected) return;
    const blob=await response.blob();
    if (pendingPhotos.get(img)!==marker || !img.isConnected) return;
    const object=URL.createObjectURL(blob);
    photoUrls.set(img,object);
    img.src=object;
    if (link) link.href=object;
  } catch {}
}
async function prepareImage(file) {
  if (!file?.size || file.size>8*1024*1024) throw new Error('请上传 8 MB 以内的图片。');
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(1,2048/Math.max(source.width,source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(source.width*scale);
    canvas.height = Math.round(source.height*scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.91));
    if (!blob || blob.type!=='image/webp') throw new Error('当前浏览器无法处理这张图片。');
    return blob;
  } finally { source.close(); }
}
async function submitForm(form,status,run) {
  const submit = form.querySelector('button[type="submit"], button:not([type])');
  submit.disabled=true;
  status.textContent='正在保存…';
  try { await run(new FormData(form)); }
  catch (error) { status.textContent=error.message || '保存失败，请重试。'; }
  finally { submit.disabled=false; }
}
function fadeIn(node, duration=165) {
  if (!motionAllowed.matches) return;
  node.getAnimations().forEach(animation=>animation.cancel());
  node.animate([{opacity:.55},{opacity:1}],{duration,easing:'ease-out'});
}
function card(title,note,image,href) {
  const link=element('a','','card');
  link.href=href;
  const art=element('span','','card-art');
  if (image) {
    const img=new Image();
    void setPhoto(img,image);
    img.alt='';
    art.append(img);
  } else art.append(element('span','还没有例图','card-empty'));
  const info=element('span','','card-info');
  info.append(element('span',title,'card-title'));
  if (note) info.append(element('span',note,'card-note'));
  const arrow=element('span','↗','card-arrow');
  arrow.setAttribute('aria-hidden','true');
  info.append(arrow);
  link.append(art,info);
  return link;
}
function findPrompt(id) {
  for (const group of groups) {
    const entry=group.entries.find(item=>item.id===id);
    if (entry) return {group,entry};
  }
  return {};
}
function showCards(items,inside,refresh) {
  if (!items.length) return [element('p','还没有秀图。')];
  return items.map(item=>{
    const tile=element('article','','show-card');
    const img=new Image();
    void setPhoto(img,item.image);
    img.alt='秀图 · '+item.nickname;
    const label=element('div');
    label.append(element('span',item.nickname));
    if (item.mine) label.append(button('删除',async event=>{
      if (!window.confirm('删除这张秀图？')) return;
      const control=event.currentTarget;
      control.disabled=true;
      try { await api('showcases/'+item.id,'DELETE'); await refresh(); }
      catch (error) { window.alert(error.message); control.disabled=false; }
    },'small danger'));
    tile.append(img,label);
    if (!inside) {
      const {group,entry}=findPrompt(item.prompt_id);
      if (entry) {
        const link=element('a',entry.title,'show-source');
        link.href='#'+group.id+'/'+entry.id;
        tile.append(link);
      }
    }
    return tile;
  });
}
async function showDetailPictures(entry) {
  const box=$('showcases');
  box.replaceChildren(element('p','正在载入秀图…'));
  try {
    const {items}=await api('showcases/'+entry.id);
    if (promptOpen?.id!==entry.id) return;
    $('show-count').textContent=items.length ? '· '+items.length+' 张' : '';
    box.replaceChildren(...showCards(items,true,()=>showDetailPictures(entry)));
  } catch(error) {
    if (promptOpen?.id===entry.id) box.replaceChildren(element('p',error.message));
  }
}
function hideDetail() {
  promptOpen = undefined;
  if (!detail.open) return;
  detail.close();
  const trigger=detailTrigger && [...$('cards').querySelectorAll('a')].find(link=>link.getAttribute('href')===detailTrigger);
  trigger?.focus({preventScroll:true});
  detailTrigger=undefined;
}
function openDetail(group,entry) {
  if (promptOpen?.id===entry.id && detail.open) return;
  promptOpen=entry;
  $('detail-title').textContent=entry.title;
  $('detail-group').textContent=group.title;
  void setPhoto($('detail-image'),entry.image);
  $('detail-image').alt=entry.title;
  $('detail-sample').hidden=!entry.demo;
  $('positive').textContent=entry.positive;
  $('negative').textContent=entry.negative;
  $('negative-block').hidden=!entry.negative;
  $('edit-entry').hidden=!isAdmin();
  $('show-form').hidden=true;
  $('show-button').setAttribute('aria-expanded','false');
  $('show-form').reset();
  $('detail-status').textContent='';
  $('show-count').textContent='';
  if (!detail.open) {
    detailTrigger='#'+group.id+'/'+entry.id;
    detail.scrollTop=0;
    detail.showModal();
  }
  void showDetailPictures(entry);
}
async function render() {
  const version=++renderVersion;
  const [folder,entryId]=route();
  const group=groups.find(item=>item.id===folder);
  const entry=group?.entries.find(item=>item.id===entryId);
  const wall=folder==='show';
  const wish=folder==='wish';
  const shelf=wall?'show':wish?'wish':'prompts';
  const query=$('search').value.trim().toLowerCase();
  $('back').hidden=!group;
  $('gallery-tabs').querySelectorAll('a').forEach(link=>{
    if (link.dataset.shelf===shelf) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  $('window-title').textContent=wall?'秀图':wish?'许愿':'提示词';
  $('search').closest('.browse-tools').hidden=wall||wish;
  $('wish-board').hidden=!wish;
  $('cards').classList.toggle('wall',wall);
  $('cards').classList.toggle('wishes',wish);
  $('cards').classList.toggle('cover-grid',!wall&&!wish&&!group&&!query&&groups.length>=3);
  const returning=detail.open && !entry;
  if (!entry) hideDetail();
  if (!galleryReady) return;
  const changed=paintedRoute!==folder;
  const sameGrid=!changed && paintedQuery===query;
  paintedRoute=folder;
  paintedQuery=query;
  if (entry && sameGrid && $('cards').childElementCount) {
    openDetail(group,entry);
    return;
  }
  if (returning && sameGrid) return;
  $('notice').textContent='';
  if (wish) {
    $('section-title').textContent='许愿';
    $('count').textContent=isAdmin()?'收到的愿望':'我的愿望';
    $('cards').replaceChildren();
    $('notice').textContent='正在载入愿望…';
    try {
      const {items}=await api('wishes');
      if (version!==renderVersion) return;
      $('notice').textContent='';
      const tiles=items.map(wishCard);
      $('cards').replaceChildren(...tiles);
      if (!tiles.length) $('cards').append(element('p','还没有愿望。','wish-empty'));
      if (changed && tiles.length) fadeIn($('cards'));
    } catch(error) { if (version===renderVersion) $('notice').textContent=error.message; }
    return;
  }
  if (wall) {
    $('section-title').textContent='秀图墙';
    $('count').textContent='';
    $('cards').replaceChildren();
    $('notice').textContent='正在载入秀图…';
    try {
      const {items}=await api('showcases');
      if (version!==renderVersion) return;
      $('notice').textContent='';
      $('count').textContent=items.length+' 张秀图';
      const tiles=showCards(items,false,render);
      $('cards').replaceChildren(...tiles);
      if (changed && tiles.length) fadeIn($('cards'));
    } catch(error) { if (version===renderVersion) $('notice').textContent=error.message; }
    return;
  }
  const matches = (item)=>[item.title,item.positive,item.negative].some(value=>value?.toLowerCase().includes(query));
  const cards = group
    ? group.entries.filter(matches).map(item=>card(item.title,'',item.image,'#'+group.id+'/'+item.id))
    : groups.filter(item=>matches(item)||item.entries.some(matches)).map(item=>card(item.title,item.entries.length+' 张例图',item.entries[0]?.image,'#'+item.id));
  $('section-title').textContent=group?.title||'提示词分组';
  $('count').textContent=cards.length+(group?' 张例图':' 个分组');
  $('cards').replaceChildren(...cards);
  if (changed && cards.length) fadeIn($('cards'));
  if (!cards.length) $('notice').textContent=query?'没有找到匹配内容。':group?'这个分组还没有例图。':'还没有分组。';
  if (entry) openDetail(group,entry);
}
function wishCard(item) {
  const tile=element('article','','wish-card');
  const time=element('time',new Date(item.created_at).toLocaleDateString('zh-CN'));
  time.dateTime=new Date(item.created_at).toISOString();
  tile.append(time,element('p',item.message));
  if (item.image) {
    const image=new Image();
    image.alt='愿望参考图';
    image.loading='lazy';
    const link=element('a');
    void setPhoto(image,item.image,link);
    link.target='_blank';
    link.rel='noopener';
    link.append(image);
    tile.append(link);
  }
  return tile;
}
const wishForm=$('wish-form');
const wishImage=wishForm.elements.image;
const wishFileLabel=$('wish-file-label');
wishImage.addEventListener('change',()=>{
  wishFileLabel.textContent=wishImage.files[0]?.name || '＋ 参考图（选填）';
});
async function flyWish() {
  if (!motionAllowed.matches || $('wish-board').hidden) return;
  const flight=wishForm.querySelector('.wish-flight');
  const plane=flight.querySelector('.wish-plane');
  const paper=wishForm.querySelector('.wish-note-paper');
  const bounds=wishForm.getBoundingClientRect();
  flight.hidden=false;
  const fold=paper.animate([
    {transform:'perspective(620px) rotateX(0) scale(1)',opacity:1},
    {transform:'perspective(620px) rotateX(24deg) scale(.65,.7)',opacity:1,offset:.39},
    {transform:'perspective(620px) rotateX(48deg) rotate(-8deg) scale(.23,.28)',opacity:0},
  ],{duration:370,easing:'cubic-bezier(.45,.05,.6,1)',fill:'forwards'});
  const takeoff=plane.animate([
    {opacity:0,transform:'translate(-50%,-50%) scale(.54) rotate(-10deg)'},
    {opacity:1,transform:'translate(-50%,-52%) scale(.9) rotate(-5deg)',offset:.18},
    {opacity:1,transform:'translate(calc(-50% + '+Math.min(bounds.width*.3,130)+'px),-123%) scale(.82) rotate(2deg)',offset:.48},
    {opacity:0,transform:'translate(calc(-50% + '+Math.min(bounds.width*.48,205)+'px),-220%) scale(.31) rotate(9deg)'},
  ],{delay:265,duration:625,easing:'cubic-bezier(.28,.52,.25,1)',fill:'both'});
  try { await takeoff.finished; }
  finally {
    flight.hidden=true;
    fold.cancel();
    takeoff.cancel();
  }
}
wishForm.addEventListener('submit',event=>{
  event.preventDefault();
  if (wishForm.querySelector('button[type="submit"]').disabled) return;
  const status=$('wish-status');
  void submitForm(wishForm,status,async body=>{
    const file=body.get('image');
    if (file?.size) body.set('image',await prepareImage(file),'reference.webp');
    else body.delete('image');
    await api('wishes','POST',body);
    await flyWish().catch(()=>{});
    wishForm.reset();
    wishFileLabel.textContent='＋ 参考图（选填）';
    status.textContent='愿望已送出。';
    if (route()[0]==='wish') await render();
  });
});
async function reloadCatalog() {
  groups=(await api('catalog')).groups;
  galleryReady=true;
  promptOpen=undefined;
  paintedRoute=undefined;
  await render();
}
async function refreshAccount() {
  account=await api('session');
  $('invite-gate').hidden=account.signedIn;
  $('gallery').hidden=!account.signedIn;
  $('gate-form').hidden=account.signedIn;
  $('gate-status').textContent='';
  $('legacy-entry').hidden=!onPages || account.signedIn;
  $('account').hidden=!isAdmin();
  $('transfer-pages').hidden=!account.signedIn || onPages;
  $('manage').hidden=!isAdmin();
  $('edit-entry').hidden=!isAdmin();
  if (account.signedIn) await reloadCatalog();
}
$('gate-form').addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.currentTarget;
  void submitForm(form,$('gate-status'),async body=>{
    const code=String(body.get('code')||'').trim();
    body.set('code',code);
    if (onPages) {
      try {
        localStorage.setItem(sessionKey,pagesToken||'');
      } catch { throw new Error('请允许浏览器保存站点数据后再绑定。'); }
    }
    const access=await api(onPages && /^MX-/i.test(code)?'transfer':'enter','POST',body);
    if (onPages && access.token) {
      pagesToken=access.token;
      localStorage.setItem(sessionKey,pagesToken);
    }
    form.reset();
    await refreshAccount();
    if (!account.signedIn) $('gate-status').textContent='这个浏览器未保留站点数据，无法保持绑定。';
  });
});
function closeDetail() { history.replaceState(null,'','#'+route()[0]); void render(); }
$('close').addEventListener('click',closeDetail);
detail.addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('panel-close').addEventListener('click',()=>panel.close());
function openPanel(title,...content) {
  const replacing=panel.open;
  panel.classList.remove('library-panel','invites-panel');
  $('panel-title').textContent=title;
  $('panel-body').replaceChildren(...content);
  $('panel-status').textContent='';
  panel.scrollTop=0;
  if (!panel.open) panel.showModal();
  if (replacing && motionAllowed.matches) {
    $('panel-body').getAnimations().forEach(animation=>animation.cancel());
    $('panel-body').animate([{opacity:.35,transform:'translateY(5px)'},{opacity:1,transform:'none'}],
      {duration:225,easing:'cubic-bezier(.2,.75,.28,1)'});
  }
}
$('show-button').addEventListener('click',()=>{
  const form=$('show-form');
  form.hidden=!form.hidden;
  $('show-button').setAttribute('aria-expanded',String(!form.hidden));
  if (!form.hidden) {
    if (motionAllowed.matches) form.animate([{opacity:.2,transform:'translateY(-5px)'},{opacity:1,transform:'none'}],{duration:215,easing:'ease-out'});
    form.elements.nickname.focus({preventScroll:true});
  }
});
$('show-form').addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const entry=promptOpen;
  void submitForm(form,$('detail-status'),async body=>{
    body.set('prompt',entry.id);
    body.set('image',await prepareImage(body.get('image')),'showcase.webp');
    await api('showcases','POST',body);
    form.reset();
    form.hidden=true;
    $('show-button').setAttribute('aria-expanded','false');
    $('detail-status').textContent='秀图已发布。';
    await showDetailPictures(entry);
  });
});
for (const field of ['positive','negative']) {
  $('copy-'+field).addEventListener('click',async event=>{
    const control=event.currentTarget;
    const label=field==='positive'?'复制正面提示词':'复制负面提示词';
    const value=$(field).textContent;
    const previous=document.activeElement;
    const temporary=document.createElement('textarea');
    temporary.value=value;
    temporary.className='clipboard-buffer';
    temporary.readOnly=true;
    detail.append(temporary);
    temporary.select();
    let copied=false;
    try { copied=document.execCommand('copy'); } catch {}
    temporary.remove();
    previous?.focus({preventScroll:true});
    if (!copied) {
      try { await navigator.clipboard.writeText(value); }
      catch {
        const selection=window.getSelection();
        const range=document.createRange();
        range.selectNodeContents($(field));
        selection.removeAllRanges();
        selection.addRange(range);
        $('detail-status').textContent='已选中提示词，可手动复制。';
        return;
      }
    }
    control.textContent='已复制';
    setTimeout(()=>{control.textContent=label;},1200);
  });
}
function inputField(kind,label,name,value='',required=false,max=80) {
  const wrapper=element('label',label);
  const input=element(kind);
  input.name=name;
  input.required=required;
  if (kind==='input'&&name==='image') {
    input.type='file';
    input.accept='image/png,image/jpeg,image/webp';
  } else {
    input.maxLength=max;
    input.value=value;
  }
  wrapper.append(input);
  return wrapper;
}
function formWith(label,fields,onSubmit) {
  const form=element('form');
  const submit=element('button',label,'primary');
  submit.type='submit';
  form.append(...fields,submit);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    void submitForm(form,$('panel-status'),onSubmit);
  });
  return form;
}
function folderEdit(group) {
  const form=formWith('保存分组',[inputField('input','分组名称','title',group?.title,true,50)],async data=>{
    await api(group?'folders/'+group.id:'folders',group?'PATCH':'POST',data);
    await reloadCatalog();
    manage();
  });
  openPanel(group?'重命名分组':'新建分组',form,button('返回管理',manage));
}
function confirmRemoval(group, entry) {
  const folder=entry===undefined;
  const name=folder?group.title:entry.title;
  const form=formWith(folder?'删除分组':'删除提示词',[],async ()=>{
    const body=new FormData();
    if (folder) body.set('count',String(group.entries.length));
    try {
      await api(folder?'folders/'+group.id:'prompts/'+entry.id,'DELETE',body);
    } catch(error) {
      if (folder) {
        await reloadCatalog();
        manage();
      }
      throw error;
    }
    if (folder && route()[0]===group.id) history.replaceState(null,'',location.pathname+location.search);
    await reloadCatalog();
    manage();
    $('panel-status').textContent='已删除「'+name+'」。';
  });
  form.querySelector('button').classList.add('remove-action');
  const description=folder
    ? group.entries.length
      ? '「'+name+'」和里面的 '+group.entries.length+' 条提示词、例图及关联秀图都会一起删除。此操作无法撤销。'
      : '空分组「'+name+'」会被删除。此操作无法撤销。'
    : '「'+name+'」的提示词、例图及关联秀图都会删除。此操作无法撤销。';
  const actions=element('div','','confirm-actions');
  actions.append(button('取消',manage),form);
  openPanel(folder?'删除分组？':'删除提示词？',element('p',description,'remove-description'),actions);
  actions.querySelector('button').focus();
}
function entryEdit(entry) {
  if (!groups.length) { folderEdit(); return; }
  const picker=element('label','所属分组');
  const select=element('select');
  select.name='folder';
  select.append(...groups.map(group=>new Option(group.title,group.id)));
  select.value=entry?.folder_id || groups.find(group=>group.id===route()[0])?.id || groups[0].id;
  picker.append(select);
  const form=formWith('保存提示词',[
    picker,inputField('input','标题','title',entry?.title,true),
    inputField('input',entry?'替换例图（选填）':'上传例图','image','',!entry),
    inputField('textarea','正面提示词','positive',entry?.positive,true,12000),
    inputField('textarea','负面提示词','negative',entry?.negative,false,12000),
  ],async data=>{
    if (data.get('image')?.size) data.set('image',await prepareImage(data.get('image')),'example.webp');
    else data.delete('image');
    const saved=await api(entry?'prompts/'+entry.id:'prompts',entry?'PATCH':'POST',data);
    panel.close();
    await reloadCatalog();
    history.replaceState(null,'','#'+data.get('folder')+'/'+saved.id);
    await render();
  });
  openPanel(entry?'编辑提示词':'上传提示词',form,button('返回管理',manage));
}
function actionMenu(label, ...actions) {
  const menu=element('details','','library-menu');
  const trigger=element('summary','⋯');
  trigger.setAttribute('aria-label',label);
  const options=element('div','','library-menu-options');
  options.append(...actions);
  menu.append(trigger,options);
  menu.addEventListener('toggle',()=>{
    if (!menu.open) return;
    $('panel-body').querySelectorAll('.library-menu[open]').forEach(other=>{
      if (other!==menu) other.open=false;
    });
  });
  return menu;
}
function libraryTile(group, entry) {
  const tile=element('article','','library-entry');
  const edit=button('',()=>entryEdit(entry),'library-entry-open');
  const photo=new Image();
  void setPhoto(photo,entry.image);
  photo.alt='';
  photo.loading='lazy';
  edit.append(photo,element('span',entry.title));
  tile.append(edit,actionMenu(entry.title+'操作',
    button('编辑提示词',()=>entryEdit(entry),'library-option'),
    button('删除提示词',()=>confirmRemoval(group,entry),'library-option danger')));
  return tile;
}
function manage() {
  if (!isAdmin()) return;
  const nav=element('div','','library-toolbar');
  const count=groups.reduce((total,group)=>total+group.entries.length,0);
  const stats=element('p',groups.length+' 个分组 · '+count+' 条提示词','library-count');
  const actions=element('div','','library-actions');
  actions.append(button('＋ 新建分组',()=>folderEdit()),button('＋ 上传提示词',()=>entryEdit(),'primary'));
  nav.append(stats,actions);
  const list=element('div','','library-folders');
  if (!groups.length) list.append(element('p','还没有分组。','library-empty'));
  for (const group of groups) {
    const section=element('section','','library-folder');
    const header=element('div','','library-folder-head');
    const cover=element('span','','library-folder-cover');
    if (group.entries[0]) {
      const img=new Image();
      void setPhoto(img,group.entries[0].image);
      img.alt='';
      img.loading='lazy';
      cover.append(img);
    } else {
      cover.classList.add('is-empty');
      cover.setAttribute('aria-hidden','true');
    }
    const title=element('div','','library-folder-title');
    title.append(element('h3',group.title),element('p',group.entries.length+' 张例图'));
    header.append(cover,title,actionMenu(group.title+'分组操作',
      button('重命名分组',()=>folderEdit(group),'library-option'),
      button('删除分组',()=>confirmRemoval(group),'library-option danger')));
    section.append(header);
    if (group.entries.length) {
      const grid=element('div','','library-entries');
      grid.append(...group.entries.map(entry=>libraryTile(group,entry)));
      section.append(grid);
    }
    list.append(section);
  }
  openPanel('管理图鉴',nav,list);
  panel.classList.add('library-panel');
  panel.scrollTop=0;
}
async function accountPanel() {
  if (!isAdmin()) return;
  const list=element('div','','invite-list');
  const result=element('div','','invite-result');
  const status=$('panel-status');
  const invite=button('＋ 生成邀请码',async()=>{
    if (result.querySelector('input') && !window.confirm('生成新码前，确认已保存上一条邀请码。')) return;
    invite.disabled=true;
    try {
      const {code}=await api('invites','POST');
      const field=element('input');
      field.value=code;
      field.readOnly=true;
      field.setAttribute('aria-label','新邀请码');
      const copy=button('复制',async()=>{
        try { await navigator.clipboard.writeText(code); copy.textContent='已复制'; }
        catch { field.select(); status.textContent='已选中邀请码，可以手动复制。'; }
      });
      result.replaceChildren(element('p','请保存完整邀请码，列表只显示尾号。'),field,copy);
      await loadList();
    } catch(error) { status.textContent=error.message; }
    finally { invite.disabled=false; }
  },'primary');
  async function loadList() {
    const {items}=await api('invites');
    list.replaceChildren();
    for (const item of items) {
      const row=element('div','','invite-row');
      const heading=element('div','','invite-row-head');
      const label=element('p','…'+item.label,'invite-token');
      heading.append(label,element('span',item.used_at?'已使用':'未使用',item.used_at?'invite-pill is-used':'invite-pill'));
      row.append(heading);
      if (!item.used_at) heading.append(button('删除',async event=>{
        if (!window.confirm('删除尾号 '+item.label+' 的邀请码？')) return;
        const control=event.currentTarget;
        control.disabled=true;
        try {
          await api('invites/'+item.id,'DELETE');
          if (result.querySelector('input')?.value.endsWith(item.label)) result.replaceChildren();
          await loadList();
          status.textContent='未使用的邀请码已删除。';
        } catch(error) {
          await loadList().catch(()=>{});
          status.textContent=error.message;
        } finally { control.disabled=false; }
      },'small danger'));
      if (item.used_at) {
        const form=formWith('保存备注',[inputField('input','备注','note',item.note,false,200)],async body=>{
          await api('invites/'+item.id,'PATCH',body);
          status.textContent='备注已保存。';
        });
        row.append(form);
      }
      list.append(row);
    }
  }
  const actions=element('div','','invite-toolbar');
  const share=element('a','分享网址','small');
  share.href=pagesOrigin+'/';
  share.addEventListener('click',async event=>{
    if (!navigator.clipboard?.writeText) return;
    event.preventDefault();
    try { await navigator.clipboard.writeText(share.href); status.textContent='已复制网址。'; }
    catch { status.textContent=share.href; }
  });
  actions.append(invite,share);
  openPanel('邀请码管理',actions,result,list);
  panel.classList.add('invites-panel');
  try { await loadList(); }
  catch(error) { status.textContent=error.message; }
}
$('edit-entry').addEventListener('click',()=>{if (isAdmin()&&promptOpen) entryEdit(promptOpen);});
$('account').addEventListener('click',accountPanel);
$('manage').addEventListener('click',manage);
$('transfer-pages').addEventListener('click',async event=>{
  const control=event.currentTarget;
  control.disabled=true;
  try {
    const {code}=await api('transfer','POST');
    const field=element('input');
    field.value=code;
    field.readOnly=true;
    field.setAttribute('aria-label','迁移码');
    const link=element('a','打开 GitHub 版','primary');
    link.href=pagesOrigin+'/'+location.hash;
    link.target='_blank';
    link.rel='noopener';
    openPanel('迁移到短网址',element('p','复制这条迁移码，到 GitHub 版的邀请码框粘贴。5 分钟内有效。'),field,link);
    field.select();
  } catch(error) { openPanel('迁移到短网址',element('p',error.message)); }
  finally { control.disabled=false; }
});
$('search').addEventListener('input',()=>void render());
addEventListener('hashchange',()=>{ $('search').value=''; void render(); });
void refreshAccount().catch(error=>{
  const status=account.signedIn?$('notice'):$('gate-status');
  status.textContent=error.message || '暂时无法连接，请刷新重试。';
});
