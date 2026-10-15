import {getGallery,uploadGalleryPhoto,deleteGalleryPhoto,saveCaption,reorderGallery,setGalleryCover,photoUrl,photoAlt} from './gallery.js';
import {element as el,showState,showErrorState,errorMessage,confirmAction} from './ui.js';
import {t} from './i18n.js';
export async function galleryPanel(container,current,shop,onCover){
  let rows=[],busy=false;const status=el('p',{className:'notice',attrs:{role:'status','aria-live':'polite'}}),list=el('div',{className:'gallery-manager'});
  const input=el('input',{attrs:{type:'file',id:'gallery-files',multiple:true,accept:'image/jpeg,image/png,image/webp'}}),drop=el('div',{className:'gallery-drop'},[el('label',{text:t('gallery.choose'),attrs:{for:'gallery-files'}}),input,el('p',{text:t('gallery.hint'),className:'field-hint'})]);
  const count=el('p',{className:'intro'});container.replaceChildren(el('h2',{text:t('panel.gallery')}),count,drop,status,list);status.hidden=true;
  const controls=disabled=>{for(const node of container.querySelectorAll('button,input,textarea'))node.disabled=disabled||node.dataset.unavailable==='true';container.setAttribute('aria-busy',String(disabled));};
  const say=(text,error=false)=>{status.textContent=text;status.hidden=!text;status.setAttribute('role',error?'alert':'status');};
  async function load(){const data=await getGallery(shop.id,{manage:true});if(!current())return;rows=data;render();}
  async function task(run){if(busy||!current())return;busy=true;controls(true);say(t('common.loading'));try{const saved=await run();if(current())say(saved===false?'':t('common.saved'));}catch(error){if(current()){say(error.code==='P2003'?t('gallery.limit'):(error.fields?.photo||errorMessage(error)),true);}}finally{try{if(current())await load();}catch(error){if(current())showErrorState(list,error,()=>void refresh());}busy=false;if(current())controls(false);}}
  async function refresh(){showState(list,{kind:'loading',key:'common.loading'});try{await load();}catch(error){if(current())showErrorState(list,error,()=>void refresh());}}
  function action(key,run,{disabled=false,label}={}){const node=el('button',{text:t(key),className:'button button--secondary',attrs:{type:'button',disabled,'data-unavailable':String(disabled),...(label?{'aria-label':label}:{})}});node.addEventListener('click',()=>void task(run));return node;}
  function render(){
    list.replaceChildren();count.textContent=t('gallery.count',{count:rows.length});if(!rows.length){showState(list,{key:'gallery.empty'});return;}
    const active=rows.filter(row=>row.ready&&!row.deleted_at);
    for(const [index,row] of rows.entries()){
      const ready=row.ready&&!row.deleted_at,position=active.indexOf(row),alt=photoAlt(row,shop,index),card=el('article',{className:'gallery-edit-card'});
      if(ready)card.append(el('img',{attrs:{src:photoUrl(row),alt,loading:'lazy',decoding:'async',width:640,height:480}}));else card.append(el('p',{text:t('gallery.incomplete'),className:'notice'}));
      if(ready){const id=`gallery-caption-${row.id}`,caption=el('textarea',{attrs:{id,maxlength:200,rows:2}});caption.value=row.caption;const form=el('form',{className:'field'},[el('label',{text:t('gallery.caption'),attrs:{for:id}}),caption]);const save=el('button',{text:t('common.save'),className:'button button--secondary',attrs:{type:'submit'}});form.append(save);form.addEventListener('submit',event=>{event.preventDefault();void task(()=>saveCaption(shop.id,row.id,caption.value));});card.append(form);
        const cover=shop.photo_url===photoUrl(row),toolbar=el('div',{className:'gallery-actions'});
        for(const [delta,key] of [[-1,'gallery.up'],[1,'gallery.down']])toolbar.append(action(key,async()=>{const ids=active.map(p=>p.id),next=position+delta;[ids[position],ids[next]]=[ids[next],ids[position]];await reorderGallery(shop.id,ids);},{disabled:position+delta<0||position+delta>=active.length,label:t(key)+' · '+alt}));
        toolbar.append(action(cover?'gallery.cover':'gallery.setCover',async()=>{shop.photo_url=await setGalleryCover(shop.id,row);onCover(shop.photo_url);},{disabled:cover}));card.append(toolbar);
      }
      card.append(action(ready?'common.delete':'gallery.cleanup',async()=>{if(!await confirmAction(t('gallery.deleteConfirm')))return false;await deleteGalleryPhoto(shop.id,row);if(shop.photo_url===photoUrl(row)){shop.photo_url=null;onCover(null);}}));list.append(card);
    }
    controls(busy);
  }
  async function upload(files){if(busy||!current()||!files.length)return;if(files.length+rows.length>12){say(t('gallery.limit'));input.value='';return;}
    try{await task(async()=>{for(let index=0;index<files.length;index++){if(!current())break;say(t('gallery.uploading',{count:index+1,total:files.length}));await uploadGalleryPhoto(shop.id,files[index]);}});}finally{input.value='';}
  }
  input.addEventListener('change',()=>void upload([...input.files]));
  for(const name of ['dragenter','dragover'])drop.addEventListener(name,event=>{event.preventDefault();if(!busy)drop.classList.add('gallery-drop--active');});
  for(const name of ['dragleave','drop'])drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('gallery-drop--active');});
  drop.addEventListener('drop',event=>void upload([...event.dataTransfer.files]));await refresh();
}

