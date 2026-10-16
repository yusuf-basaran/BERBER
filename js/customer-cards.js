import {ownerLoyalty} from './loyalty.js';
import {supabase} from './supabase.js';
import {auth} from './auth.js';
import {element as el,formatDateTime,showState,showErrorState,withFormTask,errorMessage,toast} from './ui.js';
import {t} from './i18n.js';
const result=r=>{if(r.error)throw r.error;return r.data;};
export async function customers(search='',page=1){return result(await supabase.rpc('musterilerim',{p_arama:search,p_sayfa:page}));}
const identity=row=>({p_customer_id:row.customer_id||null,p_guest_phone:null});
async function card(row){return result(await supabase.rpc(row.customer_id?'musteri_karti':'guest_customer_card',row.customer_id?identity(row):{p_appointment_id:row.guest_reference||row.id}));}
async function save(row,note,tags){return result(await supabase.rpc(row.customer_id?'musteri_not_kaydet':'guest_customer_note',row.customer_id?{...identity(row),p_note:note,p_tags:tags}:{p_appointment_id:row.guest_reference||row.id,p_note:note,p_tags:tags}));}
export function customerCardControl(row){
  const details=el('details',{className:'customer-card-panel'}),summary=el('summary',{text:t('cards.open')}),content=el('div');details.append(summary,content);let sequence=0,loaded=false;
  const clear=()=>{sequence++;loaded=false;details.open=false;content.replaceChildren();};
  const stop=auth.watch(()=>{}, {onPending:clear});window.addEventListener('pagehide',()=>{clear();stop();},{once:true});
  async function load(){const token=++sequence;showState(content,{kind:'loading',key:'common.loading'});try{const data=await card(row);if(!details.isConnected||token!==sequence)return;loaded=true;
    content.replaceChildren(el('h3',{text:data.full_name}));if(data.phone)content.append(el('a',{text:data.phone,attrs:{href:'tel:'+data.phone}}));
    const stats=el('dl',{className:'customer-stats'});for(const key of ['total','completed','customer_cancelled','no_show'])stats.append(el('dt',{text:t('cards.'+key)}),el('dd',{text:String(data[key])}));content.append(stats);const loyalty=el('section');content.append(loyalty);void ownerLoyalty(loyalty,row,()=>details.isConnected&&token===sequence);
    if(data.global_no_show!==null)content.append(el('p',{text:t('manual.noShowCount',{count:data.global_no_show})}));
    for(const key of ['first_visit','last_visit','favorite_service'])if(data[key])content.append(el('p',{text:t('cards.'+key)+': '+(key==='favorite_service'?data[key]:formatDateTime(data[key]))}));
    content.append(el('h4',{text:t('cards.customerNote')}),el('p',{text:data.preference_note||t('cards.noNote')}));
    const form=el('form',{className:'private-note-form'}),note=el('textarea',{attrs:{id:'note-'+(row.customer_id||row.guest_reference||row.id),maxlength:1000,rows:4}}),tags=el('input',{attrs:{id:'tags-'+(row.customer_id||row.guest_reference||row.id),maxlength:104,type:'text'}});note.value=data.note;tags.value=data.tags.join(', ');
    form.append(el('h4',{text:t('cards.privateNote')}),el('p',{text:t('cards.privateHint'),className:'field-hint'}),el('label',{text:t('cards.privateNote'),attrs:{for:note.id}}),note,el('label',{text:t('cards.tags'),attrs:{for:tags.id}}),tags,el('button',{text:t('common.save'),className:'button',attrs:{type:'submit'}}));content.append(form);
    form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{try{const values=tags.value.split(',').map(v=>v.trim()).filter(Boolean);if(values.length>5||values.some(v=>v.length>20)||note.value.length>1000)throw Error(t('cards.validation'));await save(row,note.value,values);if(token===sequence)toast(t('common.saved'),{type:'success'});}catch(error){if(token===sequence)toast(errorMessage(error),{type:'error'});}});});
  }catch(error){if(token===sequence&&details.isConnected)showErrorState(content,error,()=>void load());}}
  details.addEventListener('toggle',()=>{if(details.open&&!loaded)void load();});return details;
}
