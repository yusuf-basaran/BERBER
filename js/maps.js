import {config,pageUrl} from './config.js';
import {supabase} from './supabase.js';
import {searchParams} from './barbers.js';
import {t} from './i18n.js';
import {element as el,showState,showErrorState,formatMoney} from './ui.js';
let libraryPromise;
export const hasCoordinates=row=>row.lat!==null&&row.lat!==undefined&&row.lng!==null&&row.lng!==undefined&&Number.isFinite(Number(row.lat))&&Number.isFinite(Number(row.lng));
export function distanceKm(a,b){const rad=n=>n*Math.PI/180,lat1=rad(a.lat),lat2=rad(b.lat),dlat=lat2-lat1,dlng=rad(b.lng-a.lng),value=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlng/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,value))));}
export async function mapCandidates(values){const r=await supabase.rpc('search_map_barbers',{p_filters:searchParams(values)});if(r.error)throw r.error;return r.data;}
async function library(){return libraryPromise||=(async()=>{let script,css;try{
 await Promise.all([new Promise((resolve,reject)=>{css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='anonymous';css.onload=resolve;css.onerror=reject;document.head.append(css);}),new Promise((resolve,reject)=>{script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';script.crossOrigin='anonymous';script.onload=resolve;script.onerror=reject;document.head.append(script);})]);if(!window.L)throw Error(t('map.loadError'));return window.L;
 }catch{libraryPromise=null;script?.remove();css?.remove();throw Error(t('map.loadError'));}})();}
function baseMap(L,host,center=[35.2,33.3],zoom=9){const map=L.map(host,{scrollWheelZoom:false,zoomControl:true}).setView(center,zoom);L.tileLayer(config.mapTiles,{maxZoom:18,keepBuffer:1,updateWhenIdle:true,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);return map;}
export async function shopMap(container,rows,current=()=>true){showState(container,{kind:'loading',key:'common.loading'});const mapped=rows.filter(hasCoordinates);if(!mapped.length){showState(container,{key:'map.noCoordinates'});return ()=>{};}let map;
 try{const L=await library();if(!current()||!container.isConnected)return ()=>{};const host=el('div',{className:'shop-map',attrs:{'aria-label':t('map.title')}});container.replaceChildren(host,el('p',{text:t('map.listAlternative'),className:'field-hint'}));map=baseMap(L,host);const color=getComputedStyle(document.documentElement).getPropertyValue('--bakir').trim(),bounds=[];
  for(const row of mapped){const point=[Number(row.lat),Number(row.lng)],content=el('div',{className:'map-popup'},[el('strong',{text:row.shop_name}),el('p',{text:row.city+' · '+row.district}),el('p',{text:formatMoney(row.starting_price,row.currency)}),el('a',{text:t('favorite.book'),attrs:{href:pageUrl('barber',{id:row.id})}})]);bounds.push(point);L.circleMarker(point,{radius:9,color,fillColor:color,fillOpacity:0.8,weight:2}).addTo(map).bindPopup(content);}
  if(bounds.length===1)map.setView(bounds[0],14);else map.fitBounds(bounds,{padding:[24,24],maxZoom:14});
  return ()=>map.remove();
 }catch(error){map?.remove();throw error;}
}
export function coordinatePicker(form,shop,current=()=>true){
 const details=el('details',{className:'coordinate-picker'}),host=el('div'),inputs=el('div',{className:'filter-grid'}),controls={};let map,marker,loading=false;
 details.append(el('summary',{text:t('map.pin')}),el('p',{text:t('map.pinHint'),className:'field-hint'}),inputs,host);form.append(details);
 for(const [name,key,min,max] of [['lat','map.latitude',-90,90],['lng','map.longitude',-180,180]]){const input=el('input',{attrs:{type:'number',name,id:'shop-'+name,min,max,step:'0.000001'}});input.value=shop[name]??'';controls[name]=input;inputs.append(el('div',{className:'field'},[el('label',{text:t(key),attrs:{for:input.id}}),input]));input.addEventListener('input',()=>{const point=read();if(map&&point){marker?.setLatLng(point);map.panTo(point);}});}
 function read(){if(!controls.lat.value||!controls.lng.value)return null;const lat=Number(controls.lat.value),lng=Number(controls.lng.value);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?[lat,lng]:null;}
 const clear=el('button',{text:t('map.clearPin'),className:'button button--secondary',attrs:{type:'button'}});clear.addEventListener('click',()=>{controls.lat.value='';controls.lng.value='';marker?.remove();marker=null;});details.append(clear);
 async function load(){if(!details.open||map||loading)return;loading=true;showState(host,{kind:'loading',key:'common.loading'});try{const L=await library();if(!current()||!details.isConnected)return;const area=el('div',{className:'shop-map',attrs:{'aria-label':t('map.pin')}});host.replaceChildren(area);const selected=read();map=baseMap(L,area,selected||[35.2,33.3],selected?14:9);const color=getComputedStyle(document.documentElement).getPropertyValue('--bakir').trim();const set=point=>{if(marker)marker.setLatLng(point);else marker=L.circleMarker(point,{radius:9,color,fillColor:color,fillOpacity:0.8}).addTo(map);};if(selected)set(selected);
 map.on('click',event=>{const {lat,lng}=event.latlng;controls.lat.value=lat.toFixed(6);controls.lng.value=lng.toFixed(6);set([lat,lng]);});
 const observer=new MutationObserver(()=>{if(!details.isConnected){map.remove();map=null;observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
 }catch(error){if(current())showErrorState(host,error,()=>void load());}finally{loading=false;}}
 details.addEventListener('toggle',()=>{if(details.open)void load();else if(map)setTimeout(()=>map?.invalidateSize(),0);});
}
