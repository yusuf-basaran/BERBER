import {mountLayout} from './layout.js';
import {protectPage,auth} from './auth.js';
import {customers,customerCardControl} from './customer-cards.js';
import {element as el,showState,showErrorState,formatDateTime} from './ui.js';
import {t} from './i18n.js';
mountLayout();const protection=protectPage({role:'barber'}),root=document.querySelector('[data-customers]');let disposed=false,sequence=0,page=1;
const form=el('form',{className:'appointments-toolbar'}),input=el('input',{attrs:{type:'search',id:'customer-search',name:'search',maxlength:100}}),list=el('div'),pager=el('nav',{className:'pager',attrs:{'aria-label':t('cards.title')}});
form.append(el('label',{text:t('cards.search'),attrs:{for:input.id}}),input,el('button',{text:t('cards.search'),className:'button',attrs:{type:'submit'}}));
async function load(){const token=++sequence;showState(list,{kind:'loading',key:'common.loading'});pager.replaceChildren();try{const data=await customers(input.value,page);if(disposed||token!==sequence)return;list.replaceChildren();if(!data.rows.length)showState(list);for(const row of data.rows){const article=el('article',{className:'appointment-card'},[el('h2',{text:row.full_name}),el('p',{text:t('cards.visits',{count:row.visits})})]);if(row.last_visit)article.append(el('p',{text:formatDateTime(row.last_visit)}));if(row.tags.length)article.append(el('p',{text:row.tags.join(' · ')}));if(row.has_note)article.append(el('span',{className:'status-badge',text:t('cards.hasNote')}));article.append(customerCardControl(row));list.append(article);}
  if(data.total>30||page>1)for(const [key,step,disabled] of [['common.previous',-1,page<=1],['common.next',1,page*30>=data.total]]){const button=el('button',{text:t(key),className:'button button--secondary',attrs:{type:'button',disabled}});button.addEventListener('click',()=>{page+=step;void load();});pager.append(button);}
}catch(error){if(!disposed&&token===sequence)showErrorState(list,error,()=>void load());}}
form.addEventListener('submit',event=>{event.preventDefault();page=1;void load();});
void protection.ready.then(context=>{if(context){root.replaceChildren(form,list,pager);void load();}});
const stop=auth.watch(()=>{}, {onPending:()=>{sequence++;list.replaceChildren();pager.replaceChildren();}});
window.addEventListener('pagehide',()=>{disposed=true;sequence++;stop();protection.dispose();},{once:true});
