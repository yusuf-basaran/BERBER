import {mountLayout} from './layout.js';
import {protectPage,auth,FormError} from './auth.js';
import {supabase} from './supabase.js';
import {element as el,normalizePhone,withFormTask,showFormErrors,clearFormErrors,showState,showErrorState,errorMessage,toast} from './ui.js';
import {t} from './i18n.js';
mountLayout();const protection=protectPage({role:'customer'}),root=document.querySelector('[data-profile]');let disposed=false,run=0;
async function load(){const token=++run;showState(root,{kind:'loading',key:'common.loading'});try{const context=await auth.getContext();if(context.status!=='ready'||context.profile.role!=='customer')return;
  const result=await supabase.from('profiles').select('full_name,phone,preference_note').eq('id',context.user.id).single();if(result.error)throw result.error;if(disposed||token!==run)return;
  const row=result.data,form=el('form',{className:'profile-form'});root.replaceChildren(el('div',{className:'initial-avatar',text:row.full_name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toLocaleUpperCase('tr-TR'),attrs:{'aria-hidden':'true'}}),el('p',{text:t('profile.visibility'),className:'notice'}));
  for(const [name,key,max,type] of [['full_name','field.fullName',100,'text'],['phone','field.phone',24,'tel'],['preference_note','profile.preference',300,'textarea']]){const input=el(type==='textarea'?'textarea':'input',{attrs:{id:'profile-'+name,name,maxlength:max,...(type==='textarea'?{rows:4}:{type,required:true}),autocomplete:name==='phone'?'tel':name==='full_name'?'name':'off'}});input.value=row[name];if(name==='preference_note')input.setAttribute('aria-describedby','preference-hint');form.append(el('div',{className:'field',attrs:{'data-field':''}},[el('label',{text:t(key),attrs:{for:input.id}}),input]));}
  form.append(el('p',{text:t('profile.warning'),className:'field-hint',attrs:{id:'preference-hint'}}),el('button',{text:t('common.save'),className:'button',attrs:{type:'submit'}}));root.append(form);
  form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{clearFormErrors(form);try{const fields={},full_name=form.elements.full_name.value.trim().replace(/\s+/g,' '),preference_note=form.elements.preference_note.value.trim();let phone;
    if(full_name.length<2||full_name.length>100)fields.full_name=t('error.name');if(preference_note.length>300)fields.preference_note=t('profile.noteLength');try{phone=normalizePhone(form.elements.phone.value);}catch{fields.phone=t('error.phone');}if(Object.keys(fields).length)throw new FormError(fields);
    const saved=await supabase.from('profiles').update({full_name,phone,preference_note}).eq('id',context.user.id).select('id').maybeSingle();if(saved.error)throw saved.error;if(!saved.data)throw Error(t('error.recordChanged'));toast(t('common.saved'),{type:'success'});
  }catch(error){if(error.fields)showFormErrors(form,error.fields);else toast(errorMessage(error),{type:'error'});}});});
}catch(error){if(!disposed&&token===run)showErrorState(root,error,()=>void load());}}
void protection.ready.then(context=>{if(context)void load();});
window.addEventListener('pagehide',()=>{disposed=true;run++;root.replaceChildren();protection.dispose();},{once:true});
