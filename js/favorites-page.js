import {mountLayout} from './layout.js';
import {protectPage,auth} from './auth.js';
import {getFavorites} from './favorites.js';
import {createFavoriteControls} from './favorite-button.js';
import {barberCard} from './barber-card.js';
import {pageUrl} from './config.js';
import {t} from './i18n.js';
import {element,showState,showErrorState} from './ui.js';
mountLayout();const protection=protectPage(),grid=document.querySelector('[data-favorites]'),pager=document.querySelector('[data-pager]');
let page=1,sequence=0,disposed=false;const favorites=createFavoriteControls({onChange:()=>void load()});
function button(key,run){const node=element('button',{text:t(key),className:'button button--secondary',attrs:{type:'button'}});node.addEventListener('click',run);return node;}
async function load(){const token=++sequence;showState(grid,{kind:'loading',key:'common.loading'});pager.replaceChildren();try{
  const result=await getFavorites(page);if(disposed||token!==sequence)return;if(!result.rows.length&&page>1){page--;return void load();}
  grid.setAttribute('aria-busy','false');if(!result.rows.length){showState(grid,{key:'favorite.empty'});grid.append(element('a',{text:t('nav.home'),className:'text-button',attrs:{href:pageUrl('home')}}));}
  else{grid.replaceChildren(...result.rows.map(barber=>barberCard(barber,{favorites,booking:true})));void favorites.sync();}
  if(result.total>12||page>1){const previous=button('common.previous',()=>{page--;void load();}),next=button('common.next',()=>{page++;void load();});previous.disabled=page<=1;next.disabled=page*12>=result.total;pager.append(previous,element('span',{text:t('common.page',{page})}),next);}
}catch(error){if(!disposed&&token===sequence)showErrorState(grid,error,()=>void load());}}
void protection.ready.then(context=>{if(context)void load();});
const stop=auth.watch(({context})=>{if(context?.status==='ready')void load();},{onPending:()=>{sequence++;grid.replaceChildren();pager.replaceChildren();}});
window.addEventListener('pagehide',()=>{disposed=true;sequence++;stop();favorites.dispose();protection.dispose();},{once:true});
