import {getBarberBySlug} from './barbers.js';
import {qrControl,shopLink} from './sharing.js';
import {applyTranslations,t} from './i18n.js';
import {element as el,showErrorState,showState} from './ui.js';
applyTranslations();const root=document.querySelector('[data-print]');const slug=new URL(location.href).searchParams.get('slug');
async function load(){showState(root,{kind:'loading',key:'common.loading'});try{const shop=await getBarberBySlug(slug);if(!shop){root.replaceChildren(el('h1',{text:t('barber.notFound')}));return;}root.replaceChildren(el('h1',{text:shop.shop_name}),el('p',{text:t('share.scan')}));const qr=el('div',{className:'print-qr'});root.append(qr);await qrControl(qr,slug);root.append(el('p',{text:shopLink(slug)}));const button=el('button',{text:t('share.print'),className:'button print-action',attrs:{type:'button'}});button.addEventListener('click',()=>window.print());root.append(button);}catch(error){showErrorState(root,error,()=>void load());}}
void load();
