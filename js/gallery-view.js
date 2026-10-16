import {getGallery,photoUrl,photoAlt} from './gallery.js';
import {element as el,openModal,showState,showErrorState} from './ui.js';
import {t} from './i18n.js';
export function mountGallery(container,shop,{demo=false}={}){
  let disposed=false,modal=null,rows=[];
  const body=el('div',{className:'gallery-grid'});container.append(el('h2',{text:t('panel.gallery')}),body);
  function view(index){
    modal?.close();let active=index,start=null;
    const image=el('img',{attrs:{decoding:'async'}}),caption=el('p',{attrs:{'aria-live':'polite'}}),count=el('p',{className:'intro',attrs:{'aria-live':'polite'}}),figure=el('figure',{className:'gallery-stage'},[image,el('figcaption',{},[caption,count])]);
    const move=delta=>{active=(active+delta+rows.length)%rows.length;draw();};
    const previous=el('button',{text:t('common.previous'),className:'button button--secondary',attrs:{type:'button'}}),next=el('button',{text:t('gallery.next'),className:'button button--secondary',attrs:{type:'button'}});
    previous.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));previous.disabled=next.disabled=rows.length<2;
    const toolbar=el('div',{className:'gallery-view-actions'},[previous,next]);
    const draw=()=>{image.src=photoUrl(rows[active]);image.alt=photoAlt(rows[active],shop,active);caption.textContent=rows[active].caption;count.textContent=t('gallery.position',{count:active+1,total:rows.length});};
    draw();modal=openModal({title:shop.shop_name,content:el('div',{},[figure,toolbar]),onClose:()=>{modal=null;}});modal.dialog.classList.add('gallery-viewer');
    modal.dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}else if(event.key==='Home'||event.key==='End'){event.preventDefault();active=event.key==='Home'?0:rows.length-1;draw();}});
    figure.addEventListener('touchstart',event=>{start=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
    figure.addEventListener('touchend',event=>{if(!start||!event.changedTouches.length)return;const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;start=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);},{passive:true});
    figure.addEventListener('touchcancel',()=>{start=null;},{passive:true});
  }
  async function load(){showState(body,{kind:'loading',key:'common.loading'});try{const data=demo?[]:await getGallery(shop.id);if(disposed)return;rows=data;body.replaceChildren();body.setAttribute('aria-busy','false');if(!rows.length){showState(body,{key:'gallery.empty'});return;}rows.forEach((row,index)=>{const button=el('button',{className:'gallery-thumb',attrs:{type:'button','aria-label':t('gallery.open',{caption:photoAlt(row,shop,index)})}},[el('img',{attrs:{src:photoUrl(row,{thumbnail:true}),alt:photoAlt(row,shop,index),loading:'lazy',decoding:'async',width:640,height:480}})]);button.addEventListener('click',()=>view(index));body.append(button);});}catch(error){if(!disposed)showErrorState(body,error,()=>void load());}}
  void load();return ()=>{disposed=true;modal?.close();};
}
