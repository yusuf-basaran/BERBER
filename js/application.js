import {supabase} from './supabase.js';
import {validateShop,validatePhoto,uploadPhoto} from './panel.js';
import {FormError} from './auth.js';
import {getLocations} from './barbers.js';
import {element as el} from './ui.js';
import {t} from './i18n.js';
const result=r=>{if(r.error)throw r.error;return r.data;};
export async function application(id){return result(await supabase.rpc('get_barber_application',{p_barber_id:id}));}
export async function submitApplication(id,revision){return result(await supabase.rpc('submit_barber_application',{p_barber_id:id,p_revision:revision}));}
async function cache(mode,email,value){
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('berber-basvuru',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',mode==='get'?'readonly':'readwrite'),store=tx.objectStore('files');let request;
    const key=email.trim().toLowerCase();if(mode==='put')request=store.put(value,key);else if(mode==='delete')request=store.delete(key);else request=store.get(key);
    let answer;request.onsuccess=()=>{answer=request.result;};tx.oncomplete=()=>resolve(answer);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export async function restoreApplicationPhoto(email){
  let entry;try{entry=await cache('get',email);}catch{return false;}
  if(!entry)return false;
  if(Date.now()-entry.time>7*86400000){await cache('delete',email);return false;}
  await uploadPhoto(entry.photo);await cache('delete',email);return true;
}
export function registrationApplication(form){
  const group=el('fieldset',{attrs:{hidden:true,disabled:true}},[el('legend',{text:t('application.title')}),el('p',{text:t('application.registration'),className:'notice'})]);
  const add=(name,key,type='text',max=2000)=>{const id='application-'+name,input=el(type==='textarea'?'textarea':type==='select'?'select':'input',{attrs:{id,name,...(['textarea','select'].includes(type)?{}:{type}),maxlength:max,required:!['instagramUrl'].includes(name)}});group.append(el('div',{className:'field',attrs:{'data-field':''}},[el('label',{text:t(key),attrs:{for:id}}),input]));return input;};
  add('shopName','panel.shopName','text',120);const city=add('city','field.city','select'),district=add('district','field.district','select');
  add('address','field.address','textarea',500);add('shopPhone','application.phone','tel',24);add('mapUrl','panel.mapUrl','url');add('instagramUrl','application.instagram','url',100);add('bio','panel.bio','textarea');
  const photo=add('photo','panel.photo','file');photo.accept='image/jpeg,image/png,image/webp';group.append(el('p',{text:t('application.photoAfterConfirmation'),className:'field-hint'}));
  form.querySelector('.consent').before(group);let locations=[];
  const option=(value,text)=>el('option',{text,attrs:{value}}),districts=()=>district.replaceChildren(option('',t('common.select')),...locations.filter(r=>r.city===city.value).map(r=>option(r.district,r.district)));
  city.append(option('',t('common.select')));districts();city.addEventListener('change',districts);
  const ready=getLocations().then(rows=>{locations=rows;city.append(...[...new Set(rows.map(r=>r.city))].map(v=>option(v,v)));});
  ready.catch(()=>{group.append(el('p',{text:t('application.locationError'),className:'notice notice--error',attrs:{role:'alert'}}));});
  const toggle=()=>{group.hidden=form.elements.role.value!=='barber';group.disabled=group.hidden;};form.addEventListener('change',event=>{if(event.target.name==='role')toggle();});toggle();
  return async values=>{
    if(values.role!=='barber')return null;await ready;
    const data=validateShop({...values,phone:values.shopPhone,isActive:true});delete data.is_active;
    if(!data.map_url||!data.bio)throw new FormError({mapUrl:!data.map_url?t('common.required'):undefined,bio:!data.bio?t('common.required'):undefined});
    const instagram=String(values.instagramUrl||'').trim();if(instagram&&!/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/.test(instagram))throw new FormError({instagramUrl:t('application.instagramError')});
    data.instagram_url=instagram||null;await validatePhoto(photo.files[0]);
    try{await cache('put',values.email,{photo:photo.files[0],time:Date.now()});}catch{throw new FormError({photo:t('application.cacheError')});}
    return data;
  };
}
