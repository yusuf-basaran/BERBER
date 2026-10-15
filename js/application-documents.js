import {supabase} from './supabase.js';
import {auth} from './auth.js';
import {validatePhoto} from './panel.js';
import {element as el,withFormTask,errorMessage,toast} from './ui.js';
import {t} from './i18n.js';
const result=r=>{if(r.error)throw r.error;return r.data;};
const bucket=()=>supabase.storage.from('basvuru-belgeleri');
export async function documentRow(id){return result(await supabase.from('application_documents').select('id,barber_id,path,deleted_at').eq('barber_id',id).maybeSingle());}
async function remove(row){result(await supabase.from('application_documents').update({deleted_at:new Date().toISOString()}).eq('id',row.id));result(await bucket().remove([row.path]));result(await supabase.from('application_documents').delete().eq('id',row.id));}
export async function signedDocument(id){const row=await documentRow(id);if(!row||row.deleted_at)return null;return result(await bucket().createSignedUrl(row.path,60)).signedUrl;}
export async function documentPanel(container,id,current=()=>true,admin=false){
  const row=await documentRow(id);if(!current())return;
  const section=el('section',{className:'application-document'},[el('h3',{text:t('document.title')}),el('p',{text:t('document.hint'),className:'field-hint'})]);container.append(section);
  if(row&&!row.deleted_at){const view=el('button',{text:t('document.view'),className:'button button--secondary',attrs:{type:'button'}});view.addEventListener('click',()=>{void withFormTask(section,async()=>{try{const url=await signedDocument(id);if(!current()||!url)return;let img=section.querySelector('img');if(!img){img=el('img',{className:'document-preview',attrs:{alt:t('document.title'),referrerpolicy:'no-referrer'}});section.append(img);}img.src=url;}catch(error){toast(errorMessage(error),{type:'error'});}});});section.append(view);}
  if(admin)return;
  if(row){const button=el('button',{text:t(row.deleted_at?'document.retryDelete':'common.delete'),className:'button button--secondary',attrs:{type:'button'}});button.addEventListener('click',()=>{void withFormTask(section,async()=>{try{await remove(row);if(current()){section.remove();await documentPanel(container,id,current);}}catch(error){toast(errorMessage(error),{type:'error'});}});});section.append(button);return;}
  const form=el('form'),input=el('input',{attrs:{type:'file',id:'application-document-file',accept:'image/jpeg,image/png,image/webp',required:true}});form.append(el('label',{text:t('document.select'),attrs:{for:input.id}}),input,el('button',{text:t('common.save'),className:'button',attrs:{type:'submit'}}));section.append(form);
  form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{let reserved;try{const file=await validatePhoto(input.files[0]);const context=await auth.getContext();if(context.status!=='ready')throw Error(t('auth.loginRequired'));const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=`${context.user.id}/${crypto.randomUUID()}.${extension}`;
    reserved=result(await supabase.from('application_documents').insert({barber_id:id,owner_id:context.user.id,path}).select('id,path').single());result(await bucket().upload(path,file,{contentType:file.type,upsert:false}));if(current()){section.remove();await documentPanel(container,id,current);}
  }catch(error){if(reserved)try{await remove(reserved);}catch{}toast(errorMessage(error),{type:'error'});}});});
}
