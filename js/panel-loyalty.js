import {supabase} from './supabase.js';
import {t} from './i18n.js';
import {element as el,showState,withFormTask,toast,errorMessage} from './ui.js';
let sequence=0;
export async function loyaltyPanel(container,current,shop){
 showState(container,{kind:'loading',key:'common.loading'});const response=await supabase.from('barbers').select('loyalty_enabled,loyalty_stamps_required,loyalty_reward').eq('id',shop.id).single();if(response.error)throw response.error;if(!current())return;const data=response.data;
 const form=el('form',{className:'panel-form'});container.replaceChildren(el('h2',{text:t('loyalty.title')}),el('p',{text:t('loyalty.ownerHint'),className:'notice'}),form);
 const field=(name,key,type,attrs)=>{const id=`loyalty-field-${++sequence}`,input=el('input',{attrs:{name,id,type,...attrs}});form.append(el('div',{className:type==='checkbox'?'field checkbox-field':'field'},[el('label',{text:t(key),attrs:{for:id}}),input]));return input;};
 const enabled=field('enabled','loyalty.enable','checkbox',{});enabled.checked=data.loyalty_enabled;
 const required=field('required','loyalty.required','number',{min:1,max:50,step:1,required:true});required.value=data.loyalty_stamps_required;
 const reward=field('reward','loyalty.reward','text',{maxlength:120});reward.value=data.loyalty_reward;reward.required=enabled.checked;enabled.addEventListener('change',()=>{reward.required=enabled.checked;});
 form.append(el('button',{text:t('common.save'),className:'button',attrs:{type:'submit'}}));form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{try{const threshold=Number(required.value),text=reward.value.trim();if(!Number.isInteger(threshold)||threshold<1||threshold>50||text.length>120||(enabled.checked&&text.length<2))throw Error(t('loyalty.invalid'));
 const r=await supabase.from('barbers').update({loyalty_enabled:enabled.checked,loyalty_stamps_required:threshold,loyalty_reward:text}).eq('id',shop.id).select('id').maybeSingle();if(r.error)throw r.error;if(!r.data)throw Error(t('error.recordChanged'));if(current())toast(t('common.saved'),{type:'success'});
 }catch(error){if(current())toast(errorMessage(error),{type:'error'});}});});
}
