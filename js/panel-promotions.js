import {getPromotions,savePromotion,removePromotion} from './promotions.js';
import {getServices} from './panel.js';
import {t} from './i18n.js';
import {element as el,localDate,showState,showErrorState,withFormTask,clearFormErrors,showFormErrors,toast,errorMessage,confirmAction,formatMoney} from './ui.js';
let sequence=0;
function field(form,name,key,{type='text',options,...attrs}={}){const id=`promotion-${++sequence}`,node=el(options?'select':'input',{attrs:{name,id,...(!options?{type}:{}),...attrs}});if(options)node.append(...options.map(([v,text])=>el('option',{text,attrs:{value:v}})));form.append(el('div',{className:'field',attrs:{'data-field':''}},[el('label',{text:t(key),attrs:{for:id}}),node]));return node;}
const button=(key,run)=>{const b=el('button',{text:t(key),className:'button button--secondary',attrs:{type:'button'}});b.addEventListener('click',()=>void run(b));return b;};
export async function promotionsPanel(container,current,shop){
 showState(container,{kind:'loading',key:'common.loading'});const [rows,services]=await Promise.all([getPromotions(shop.id),getServices()]);if(!current())return;
 container.replaceChildren(el('h2',{text:t('panel.promotions')}),el('p',{text:t('promotion.hint'),className:'notice'}));
 const form=el('form',{className:'panel-form'});let editing=null;
 field(form,'title','promotion.title',{required:true,minlength:2,maxlength:80});
 const type=field(form,'discountType','promotion.type',{options:[['percent',t('promotion.percent')],['amount',t('promotion.amount')]]});
 const discount=field(form,'discount','promotion.discount',{type:'number',required:true,min:0.01,max:100,step:0.01});
 const currency=field(form,'currency','panel.currency',{options:['TRY','GBP','EUR'].map(c=>[c,c])});
 const updateType=()=>{currency.closest('.field').hidden=type.value==='percent';currency.disabled=type.value==='percent';discount.max=type.value==='percent'?'100':'99999999.99';};type.addEventListener('change',updateType);updateType();
 field(form,'serviceId','promotion.service',{options:[['',t('promotion.allServices')],...services.filter(s=>s.is_active).map(s=>[s.id,s.name])]});
 const days=el('fieldset',{className:'promotion-days',attrs:{'data-field':''}},[el('legend',{text:t('promotion.days')})]);
 for(const d of [1,2,3,4,5,6,0]){const id=`promotion-day-${++sequence}`,input=el('input',{attrs:{type:'checkbox',name:'weekdays',id,value:d,checked:true}});days.append(el('label',{className:'checkbox-field',attrs:{for:id}},[input,el('span',{text:t(`day.${d}`)})]));}form.append(days);
 field(form,'validFrom','promotion.from',{type:'date',required:true}).value=localDate();field(form,'validUntil','promotion.until',{type:'date',required:true}).value=localDate();
 field(form,'timeFrom','promotion.timeFrom',{type:'time',required:true}).value='00:00';
 field(form,'timeTo','promotion.timeTo',{options:[['24:00',t('promotion.endOfDay')],...Array.from({length:288},(_,i)=>{const v=String(Math.floor(i/12)).padStart(2,'0')+':'+String(i%12*5).padStart(2,'0');return [v,v];})]});
 const active=field(form,'isActive','promotion.active',{type:'checkbox',checked:true});
 const submit=el('button',{text:t('common.save'),className:'button',attrs:{type:'submit'}});
 form.append(submit,button('common.cancel',()=>{editing=null;form.reset();type.value='percent';updateType();form.elements.validFrom.value=localDate();form.elements.validUntil.value=localDate();}));container.append(form);
 form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{clearFormErrors(form);try{const v=Object.fromEntries(new FormData(form));v.weekdays=[...form.querySelectorAll('[name=weekdays]:checked')].map(n=>Number(n.value));v.isActive=active.checked;await savePromotion(shop.id,v,editing);if(current()){toast(t('common.saved'),{type:'success'});await promotionsPanel(container,current,shop);}}catch(error){if(error.fields)showFormErrors(form,error.fields);toast(errorMessage(error),{type:'error'});}});});
 const list=el('div',{className:'panel-list'});container.append(list);if(!rows.length)showState(list,{key:'promotion.empty'});
 for(const row of rows){const card=el('article',{className:'appointment-card'},[el('h3',{text:row.title}),el('p',{text:row.discount_percent!==null?`%${row.discount_percent}`:formatMoney(row.discount_amount,row.currency)}),el('p',{text:`${row.valid_from} – ${row.valid_until} · ${row.time_from.slice(0,5)} – ${row.time_to.slice(0,5)}`}),el('p',{text:row.weekdays.map(d=>t(`day.${d}`)).join(' · ')}),el('p',{text:row.service_id?(services.find(s=>s.id===row.service_id)?.name||t('panel.archived')):t('promotion.allServices')}),el('span',{text:t(row.is_active?'promotion.active':'promotion.inactive'),className:'status-badge'})]);
 card.append(button('common.edit',()=>{editing=row.id;for(const [name,value] of Object.entries({title:row.title,discountType:row.discount_percent!==null?'percent':'amount',discount:row.discount_percent??row.discount_amount,currency:row.currency||'TRY',serviceId:row.service_id||'',validFrom:row.valid_from,validUntil:row.valid_until,timeFrom:row.time_from.slice(0,5),timeTo:row.time_to.slice(0,5)}))form.elements[name].value=value;active.checked=row.is_active;for(const n of form.querySelectorAll('[name=weekdays]'))n.checked=row.weekdays.includes(Number(n.value));updateType();clearFormErrors(form);form.elements.title.focus();}),button('common.delete',async b=>{b.disabled=true;try{if(!await confirmAction(t('promotion.deleteConfirm')))return;await removePromotion(shop.id,row.id);if(current())await promotionsPanel(container,current,shop);}catch(error){toast(errorMessage(error),{type:'error'});}finally{b.disabled=false;}}));list.append(card);
 }
}
