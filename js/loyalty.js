import {supabase} from './supabase.js';
import {t} from './i18n.js';
import {element as el,showState,showErrorState,withFormTask,toast,errorMessage,confirmAction} from './ui.js';
const result=r=>{if(r.error)throw r.error;return r.data;};
export function loyaltyCard(data){
 const available=Number(data.available_stamps||0),required=Number(data.required||10),card=el('article',{className:'loyalty-card'});
 card.append(el('h3',{text:data.shop_name||t('loyalty.title')}),el('p',{text:data.reward||t('loyalty.paused')}),el('p',{text:t('loyalty.balance',{count:available,required})}),el('progress',{attrs:{max:required,value:Math.min(available,required),'aria-label':t('loyalty.balance',{count:available,required})}}));
 if(!data.enabled)card.append(el('p',{text:t('loyalty.paused'),className:'field-hint'}));else if(available>=required)card.append(el('p',{text:t('loyalty.ready',{count:Math.floor(available/required)}),className:'notice'}));
 return card;
}
export async function loyaltyList(container,current=()=>true,page=1){
 showState(container,{kind:'loading',key:'common.loading'});
 try{const data=result(await supabase.rpc('get_customer_loyalty',{p_page:page}));if(!current())return;container.replaceChildren(el('h2',{text:t('loyalty.title')}),el('p',{text:t('loyalty.hint'),className:'field-hint'}));
 if(!data?.rows?.length){container.append(el('p',{text:t('loyalty.empty'),className:'field-hint'}));return;}
 container.append(...data.rows.map(loyaltyCard));
 if(data.total>12||page>1){const pager=el('nav',{className:'pager',attrs:{'aria-label':t('loyalty.title')}});for(const [key,step,disabled] of [['common.previous',-1,page<=1],['common.next',1,page*12>=data.total]]){const b=el('button',{text:t(key),className:'button button--secondary',attrs:{type:'button',disabled}});b.addEventListener('click',()=>void loyaltyList(container,current,page+step));pager.append(b);}container.append(pager);}
 }catch(error){if(current())showErrorState(container,error,()=>void loyaltyList(container,current,page));}
}
export async function ownerLoyalty(container,row,current){
 if(!row.customer_id){container.replaceChildren(el('p',{text:t('loyalty.guest'),className:'field-hint'}));return;}
 showState(container,{kind:'loading',key:'common.loading'});
 try{const data=result(await supabase.rpc('get_loyalty_card',{p_customer_id:row.customer_id}));if(!current())return;if(!data){container.replaceChildren();return;}
 container.replaceChildren(loyaltyCard(data));
 if(row.status==='completed'&&data.enabled&&Number(data.available_stamps)>=Number(data.required)){
  const used=data.redeemed_appointments?.includes(row.id),form=el('form'),button=el('button',{text:t(used?'loyalty.used':'loyalty.redeem'),className:'button button--secondary',attrs:{type:'submit',disabled:used}});form.append(button);container.append(form);
  form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{try{if(!await confirmAction(t('loyalty.confirm',{reward:data.reward,required:data.required})))return;await supabase.rpc('redeem_loyalty',{p_appointment_id:row.id}).then(result);if(current()){toast(t('loyalty.used'),{type:'success'});await ownerLoyalty(container,row,current);}}catch(error){if(current())toast(errorMessage(error),{type:'error'});}});});
 }else if(data.redeemed_appointments?.includes(row.id))container.append(el('p',{text:t('loyalty.used'),className:'status-badge'}));
 }catch(error){if(current())showErrorState(container,error,()=>void ownerLoyalty(container,row,current));}
}
