import {barberCard} from './barber-card.js';
import {createFavoriteControls} from './favorite-button.js';
import { mountLayout } from './layout.js';
import { categories,getLocations,searchBarbers } from './barbers.js';
import { pageUrl } from './config.js';
import { t } from './i18n.js';
import { element,shopPhoto,formatMoney,showState,showErrorState } from './ui.js';
mountLayout();

const demo=new URL(location.href).searchParams.get('demo')==='1';
const form=document.getElementById('search-form');const grid=document.querySelector('[data-barbers]');
if(window.matchMedia('(max-width:720px)').matches)document.querySelector('.filter-details').open=false;
const count=document.querySelector('[data-results-count]');const pager=document.querySelector('[data-pager]');
const banner=document.querySelector('[data-demo]');banner.hidden=!demo;
let locations=[];let page=1;let controller;let sequence=0;
function options(select,items,value='') {
  select.replaceChildren(element('option',{text:t('common.all'),attrs:{value:''}}),...items.map(item=>element('option',{text:typeof item==='string'?item:item.text,attrs:{value:typeof item==='string'?item:item.value}})));
  select.value=value;
}
options(form.elements.category,categories.map(([value,key])=>({value,text:t(key)})));
function districts(value='') {const city=form.elements.city.value;options(form.elements.district,[...new Set(locations.filter(row=>!city||row.city===city).map(row=>row.district))],value);}
form.elements.city.addEventListener('change',()=>districts());
const favorites=createFavoriteControls({demo});
const card=barber=>barberCard(barber,{demo,favorites});
function pagination(total) {
  pager.replaceChildren();if(total<=12&&page===1)return;
  const previous=element('button',{text:t('common.previous'),className:'button button--secondary',attrs:{type:'button',disabled:page<=1}});
  const next=element('button',{text:t('common.next'),className:'button button--secondary',attrs:{type:'button',disabled:page*12>=total}});
  previous.addEventListener('click',()=>{page--;void search();});next.addEventListener('click',()=>{page++;void search();});
  pager.append(previous,element('span',{text:t('common.page',{page})}),next);
}
async function search() {
  controller?.abort();controller=new AbortController();const current=++sequence;
  showState(grid,{kind:'loading',key:'common.loading'});count.textContent='';pager.replaceChildren();
  try {
    const values={...Object.fromEntries(new FormData(form)),page};const result=await searchBarbers(values,{demo,signal:controller.signal});
    if(current!==sequence)return;grid.setAttribute('aria-busy','false');count.textContent=t('search.results',{count:result.total});
    if(!result.rows.length)showState(grid,{key:'search.empty'});else grid.replaceChildren(...result.rows.map(card));pagination(result.total);void favorites.sync();
  }catch(error){if(current===sequence&&!controller.signal.aborted)showErrorState(grid,error,()=>void search());}
}
form.addEventListener('submit',event=>{event.preventDefault();page=1;void search();});
document.querySelector('[data-clear-filters]').addEventListener('click',()=>{form.reset();districts();page=1;void search();});
async function initialize() {
  showState(grid,{kind:'loading',key:'common.loading'});
  try{locations=await getLocations({demo});options(form.elements.city,[...new Set(locations.map(row=>row.city))]);districts();await search();}
  catch(error){showErrorState(grid,error,()=>void initialize());}
}
void initialize();window.addEventListener('pagehide',()=>{sequence++;controller?.abort();favorites.dispose();},{once:true});
