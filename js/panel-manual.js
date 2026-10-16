import {getServices} from './panel.js';
import {findCustomer,createManual,getBlocked,setBlocked} from './manual.js';
import {getSlots,bookingDates,slotLabel} from './slots.js';
import {t} from './i18n.js';
import {element as el,showState,showErrorState,withFormTask,clearFormErrors,showFormErrors,toast,errorMessage,confirmAction} from './ui.js';
let sequence=0;
function field(form,name,key,{type='text',options,...attrs}={}){
  const id=`manual-${++sequence}`;
  const input=el(options?'select':'input',{attrs:{name,id,...(!options?{type}:{}),...attrs}});
  if(options)input.append(...options.map(([value,text])=>el('option',{text,attrs:{value}})));
  form.append(el('div',{className:'field',attrs:{'data-field':''}},[el('label',{text:t(key),attrs:{for:id}}),input]));return input;
}
function button(key,run){const node=el('button',{text:t(key),className:'button button--secondary',attrs:{type:'button'}});node.addEventListener('click',()=>void run(node));return node;}
export async function manualForm(container,current,shop,onSaved){
  showState(container,{kind:'loading',key:'common.loading'});const services=(await getServices()).filter(row=>row.is_active);if(!current())return;
  container.replaceChildren(el('h2',{text:t('panel.manual')}),el('p',{text:t('manual.hint'),className:'notice'}));
  if(!services.length){showState(container,{key:'barber.noServices'});return;}
  const form=el('form',{className:'panel-form'});let customerId=null,lookupRun=0,slotRun=0,slots=[];
  const name=field(form,'name','field.fullName',{maxlength:100,required:true});
  const phone=field(form,'phone','field.phone',{type:'tel',required:true});
  const matches=el('div',{className:'manual-matches',attrs:{'aria-live':'polite'}});
  const clearCustomer=()=>{customerId=null;name.readOnly=false;matches.replaceChildren();lookupRun++;};
  phone.addEventListener('input',clearCustomer);
  const search=button('manual.find',async control=>{control.disabled=true;const attempt=++lookupRun;try{
    const rows=await findCustomer(shop.id,phone.value);if(!current()||attempt!==lookupRun)return;
    matches.replaceChildren(el('p',{text:t(rows.length?'manual.chooseCustomer':'manual.notFound')}));
    for(const row of rows)matches.append(button('manual.select',()=>{customerId=row.id;name.value=row.full_name;name.readOnly=true;phone.value=row.phone;matches.replaceChildren(el('p',{text:t('manual.selected',{name:row.full_name})}),button('manual.guest',clearCustomer));}));
    if(rows.length)for(let i=0;i<rows.length;i++)matches.querySelectorAll('button')[i].textContent=`${rows[i].full_name} · ${rows[i].phone}`;
  }catch(error){toast(errorMessage(error),{type:'error'});}finally{control.disabled=false;}});
  form.append(search,matches);
  const service=field(form,'serviceId','panel.serviceName',{required:true,options:[['',t('common.select')],...services.map(row=>[row.id,row.name])]});
  const dates=bookingDates(),date=field(form,'date','field.date',{type:'date',required:true,min:dates.min,max:dates.max});date.value=dates.min;
  const slotBox=el('fieldset',{className:'slot-options'});showState(slotBox,{key:'booking.selectPrompt'});form.append(slotBox);let selected='';
  const load=async()=>{selected='';slots=[];const attempt=++slotRun;slotBox.replaceChildren();if(!service.value){showState(slotBox,{key:'booking.selectPrompt'});return;}
    showState(slotBox,{kind:'loading',key:'common.loading'});
    try{const rows=await getSlots(shop.id,service.value,date.value);if(!current()||attempt!==slotRun)return;slots=rows;slotBox.replaceChildren(el('legend',{text:t('field.time')}));slotBox.setAttribute('aria-busy','false');
      if(!rows.length)slotBox.append(el('p',{text:t('booking.noSlots')}));
      for(const row of rows){const id=`manual-slot-${++sequence}`,input=el('input',{attrs:{type:'radio',name:'startAt',id,value:row.start_at,required:true}});input.addEventListener('change',()=>{selected=row.start_at;});slotBox.append(el('label',{className:'slot-choice',attrs:{for:id}},[input,el('span',{text:slotLabel(row.start_at,rows)})]));}
    }catch(error){if(current()&&attempt===slotRun)showErrorState(slotBox,error,load);}
  };
  service.addEventListener('change',()=>void load());date.addEventListener('change',()=>void load());
  field(form,'note','field.note',{maxlength:1000});form.append(el('button',{text:t('panel.manual'),className:'button',attrs:{type:'submit'}}));container.append(form);
  form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{clearFormErrors(form);try{
    if(!slots.some(row=>row.start_at===selected))selected='';
    await createManual(shop.id,{name:name.value,phone:phone.value,customerId,serviceId:service.value,startAt:selected,note:form.elements.note.value});
    if(current()){toast(t('manual.created'),{type:'success'});onSaved();}
  }catch(error){if(error.fields)showFormErrors(form,error.fields);toast(errorMessage(error),{type:'error'});if(error.code==='23P01')await load();}});});
}
export async function blockedList(container,current,shop){
  showState(container,{kind:'loading',key:'common.loading'});const rows=await getBlocked(shop.id);if(!current())return;
  container.replaceChildren(el('h2',{text:t('panel.blocked')}));if(!rows.length)showState(container);
  for(const row of rows){const card=el('article',{className:'appointment-card'},[el('h3',{text:row.full_name}),el('p',{text:row.phone})]);card.append(button('manual.unblock',async control=>{control.disabled=true;try{if(!await confirmAction(t('manual.unblockConfirm')))return;await setBlocked(shop.id,row.customer_id,false);if(current())await blockedList(container,current,shop);}catch(error){toast(errorMessage(error),{type:'error'});}finally{control.disabled=false;}}));container.append(card);}
}
