import {mapCandidates,shopMap,distanceKm,hasCoordinates} from './maps.js';
import {barberCard} from './barber-card.js';
import {createFavoriteControls} from './favorite-button.js';
import { mountLayout } from './layout.js';
import { categories,getLocations,searchBarbers } from './barbers.js';
import { pageUrl,config } from './config.js';
import { t } from './i18n.js';
import { element,shopPhoto,formatMoney,showState,showErrorState } from './ui.js';
mountLayout();

const demo=new URL(location.href).searchParams.get('demo')==='1';
const form=document.getElementById('search-form');const grid=document.querySelector('[data-barbers]');
if(window.matchMedia('(max-width:720px)').matches)document.querySelector('.filter-details').open=false;
const count=document.querySelector('[data-results-count]');const pager=document.querySelector('[data-pager]');
const banner=document.querySelector('[data-demo]');banner.hidden=!demo;
let locations=[];let page=1;let controller;let sequence=0;
let mapView=false,position=null,disposeMap=()=>{},mapSequence=0,candidateCache=null;
const mapBox=element('section',{className:'map-section'}),mapNotice=element('p',{className:'field-hint',attrs:{role:'status'}}),mapToolbar=element('div',{className:'map-toolbar'});
const listButton=element('button',{text:t('map.list'),className:'button button--secondary',attrs:{type:'button','aria-pressed':'true'}}),mapButton=element('button',{text:t('map.view'),className:'button button--secondary',attrs:{type:'button','aria-pressed':'false'}}),nearbyButton=element('button',{text:t('map.nearby'),className:'button button--secondary',attrs:{type:'button'}});
mapBox.hidden=true;mapButton.hidden=demo;nearbyButton.hidden=demo||!navigator.geolocation;mapToolbar.append(listButton,mapButton,nearbyButton);grid.before(mapToolbar,element('p',{text:t('map.privacy'),className:'field-hint'}),mapNotice,mapBox);
async function candidates(values){const query={...values,page:1},key=JSON.stringify(query);if(candidateCache?.key===key)return candidateCache.data;const data=await mapCandidates(query);candidateCache={key,data};return data;}
async function drawMap(){const token=++mapSequence;disposeMap();disposeMap=()=>{};if(!mapView)return;try{const data=await candidates(Object.fromEntries(new FormData(form)));if(token!==mapSequence||!mapView)return;if(data.limited)mapNotice.textContent=t('map.limited');const stop=await shopMap(mapBox,data.rows,()=>token===mapSequence&&mapView);if(token===mapSequence&&mapView)disposeMap=stop;else stop();}catch(error){if(token===mapSequence&&mapView)showErrorState(mapBox,error,drawMap);}}
function setMap(value){mapView=value;mapSequence++;disposeMap();disposeMap=()=>{};mapBox.hidden=!value;listButton.setAttribute('aria-pressed',String(!value));mapButton.setAttribute('aria-pressed',String(value));if(value)void drawMap();}
listButton.addEventListener('click',()=>setMap(false));mapButton.addEventListener('click',()=>setMap(true));
nearbyButton.addEventListener('click',()=>{if(position){position=null;nearbyButton.textContent=t('map.nearby');page=1;void search();return;}nearbyButton.disabled=true;navigator.geolocation.getCurrentPosition(value=>{position={lat:value.coords.latitude,lng:value.coords.longitude};nearbyButton.disabled=false;nearbyButton.textContent=t('map.clearNearby');page=1;void search();},()=>{position=null;nearbyButton.disabled=false;nearbyButton.textContent=t('map.nearby');document.querySelector('.filter-details').open=true;form.elements.city.focus();},{enableHighAccuracy:false,maximumAge:60000,timeout:8000});});
function options(select,items,value='') {
  select.replaceChildren(element('option',{text:t('common.all'),attrs:{value:''}}),...items.map(item=>element('option',{text:typeof item==='string'?item:item.text,attrs:{value:typeof item==='string'?item:item.value}})));
  select.value=value;
}
options(form.elements.category,categories.map(([value,key])=>({value,text:t(key)})));
function districts(value='') {const city=form.elements.city.value;options(form.elements.district,[...new Set(locations.filter(row=>!city||row.city===city).map(row=>row.district))],value);}
form.elements.city.addEventListener('change',()=>districts());
const favorites=createFavoriteControls({demo});
const card=barber=>{const node=barberCard(barber,{demo,favorites});if(Number.isFinite(barber.distance))node.append(element('p',{text:t('map.distance',{distance:new Intl.NumberFormat(config.locale,{maximumFractionDigits:1}).format(barber.distance)}),className:'map-distance'}));return node;};
function pagination(total) {
  pager.replaceChildren();if(total<=12&&page===1)return;
  const previous=element('button',{text:t('common.previous'),className:'button button--secondary',attrs:{type:'button',disabled:page<=1}});
  const next=element('button',{text:t('common.next'),className:'button button--secondary',attrs:{type:'button',disabled:page*12>=total}});
  previous.addEventListener('click',()=>{page--;void search();});next.addEventListener('click',()=>{page++;void search();});
  pager.append(previous,element('span',{text:t('common.page',{page})}),next);
}
async function search() {
  controller?.abort();controller=new AbortController();const current=++sequence;
  showState(grid,{kind:'loading',key:'common.loading'});count.textContent='';mapNotice.textContent='';pager.replaceChildren();
  try {
    const values={...Object.fromEntries(new FormData(form)),page};let result;
    if(position&&!demo){const data=await candidates(Object.fromEntries(new FormData(form))),origin=position;if(!origin||current!==sequence)return;const rows=data.rows.map(row=>({...row,distance:hasCoordinates(row)?distanceKm(origin,{lat:Number(row.lat),lng:Number(row.lng)}):null})).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)||String(a.id).localeCompare(String(b.id)));result={rows:rows.slice((page-1)*12,page*12),total:rows.length};if(data.limited)mapNotice.textContent=t('map.limited');}
    else result=await searchBarbers(values,{demo,signal:controller.signal});
    if(current!==sequence)return;grid.setAttribute('aria-busy','false');count.textContent=t('search.results',{count:result.total});
    if(!result.rows.length)showState(grid,{key:'search.empty'});else grid.replaceChildren(...result.rows.map(card));pagination(result.total);void favorites.sync();if(mapView)void drawMap();
  }catch(error){if(current===sequence&&!controller.signal.aborted)showErrorState(grid,error,()=>void search());}
}
form.addEventListener('submit',event=>{event.preventDefault();page=1;void search();});
document.querySelector('[data-clear-filters]').addEventListener('click',()=>{form.reset();districts();position=null;nearbyButton.textContent=t('map.nearby');page=1;void search();});
async function initialize() {
  showState(grid,{kind:'loading',key:'common.loading'});
  try{locations=await getLocations({demo});options(form.elements.city,[...new Set(locations.map(row=>row.city))]);districts();await search();}
  catch(error){showErrorState(grid,error,()=>void initialize());}
}
void initialize();window.addEventListener('pagehide',()=>{sequence++;mapSequence++;position=null;candidateCache=null;disposeMap();controller?.abort();favorites.dispose();},{once:true});
