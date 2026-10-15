import {calendarActions} from './calendar-actions.js';
import { mountLayout } from './layout.js';
import { protectPage,auth } from './auth.js';
import { getAppointmentReviews,submitReview,reviewCard } from './reviews.js';
import { getAppointments,changeAppointment,statuses } from './appointments.js';
import { pageUrl } from './config.js';
import { t } from './i18n.js';
import { element,formatDateTime,formatMoney,showState,showErrorState,confirmAction,toast,errorMessage,openModal,withFormTask,clearFormErrors,showFormErrors } from './ui.js';
mountLayout();const protection=protectPage({role:'customer'});
const list=document.querySelector('[data-appointments]');const filter=document.getElementById('appointment-status');const pager=document.querySelector('[data-pager]');
let page=1;let sequence=0;let disposed=false;let reviewModal=null;let reviewEpoch=0;
filter.replaceChildren(element('option',{text:t('common.all'),attrs:{value:''}}),...statuses.map(status=>element('option',{text:t(`status.${status}`),attrs:{value:status}})));
function button(key,action){const node=element('button',{text:t(key),className:'button button--secondary',attrs:{type:'button'}});node.addEventListener('click',()=>void action(node));return node;}
async function change(appointment,status,control) {
  const question=status==='cancelled'?t('appointments.cancelConfirm'):status==='confirmed'?t('appointments.acceptConfirm',{time:formatDateTime(appointment.proposed_start_at)}):t('appointments.rejectConfirm');
  control.disabled=true;
  try{if(!await confirmAction(question))return;await changeAppointment(appointment.id,status);toast(t('appointments.updated'),{type:'success'});await load();}
  catch(error){toast(errorMessage(error),{type:'error'});if(error.code==='P2001')await load();}finally{control.disabled=false;}
}
function card(appointment,review,reviewError) {
  const shop=appointment.barber;const contents=[
    element('div',{className:'appointment-heading'},[element('h2',{text:shop?.shop_name||t('appointments.noBarber')}),element('span',{text:t(`status.${appointment.status}`),className:`status-badge status-badge--${appointment.status}`})]),
    element('p',{text:shop?t('barber.location',{city:shop.city,district:shop.district}):'',className:'intro'}),
    element('div',{className:'appointment-facts'},[element('strong',{text:appointment.service_name_at_booking}),element('time',{text:formatDateTime(appointment.start_at),attrs:{datetime:appointment.start_at}}),element('span',{text:`${formatMoney(appointment.price_at_booking,appointment.currency_at_booking)} · ${t('common.minutes',{count:appointment.duration_at_booking})}`})])
  ];
  if(appointment.status==='counter_proposed')contents.push(element('p',{text:t('appointments.proposedTime',{time:formatDateTime(appointment.proposed_start_at)}),className:'notice'}));
  if(appointment.customer_note)contents.push(element('p',{text:`${t('appointments.customerNote')}: ${appointment.customer_note}`,className:'appointment-note'}));
  if(appointment.barber_note)contents.push(element('p',{text:`${t('appointments.barberNote')}: ${appointment.barber_note}`,className:'appointment-note'}));
  const actions=element('div',{className:'appointment-actions'});
  if(appointment.status==='counter_proposed'){
    if(Date.parse(appointment.proposed_start_at)>Date.now())actions.append(button('appointments.accept',control=>change(appointment,'confirmed',control)));
    actions.append(button('appointments.rejectProposal',control=>change(appointment,'rejected',control)));
  }
  const start=appointment.status==='counter_proposed'?appointment.proposed_start_at:appointment.start_at;
  if(['pending','confirmed','counter_proposed'].includes(appointment.status)&&Date.parse(start)>Date.now()){
    const hours=Number(shop?.cancel_hours_before??2),allowed=hours===0||Date.parse(start)-Date.now()>=hours*3600000;
    if(allowed)actions.append(button('appointments.cancel',control=>change(appointment,'cancelled',control)));
    else {contents.push(element('p',{text:t('manual.cancelClosed'),className:'notice'}));
      if(/^\+90\d{10}$/.test(shop?.phone||''))actions.append(element('a',{text:t('barber.call'),className:'button button--secondary',attrs:{href:'tel:'+shop.phone}}));
      if(/^\+905\d{9}$/.test(shop?.whatsapp||''))actions.append(element('a',{text:t('barber.whatsapp'),className:'button button--secondary',attrs:{href:'https://wa.me/'+shop.whatsapp.slice(1),target:'_blank'}}));
    }
  }
  if(shop)actions.append(element('a',{text:t('barber.detail'),className:'text-button',attrs:{href:pageUrl('barber',{id:shop.id})}}));
  if(appointment.status==='confirmed')actions.append(calendarActions(appointment));
  if(shop&&['completed','cancelled','rejected','no_show'].includes(appointment.status))actions.append(element('a',{text:t('favorite.rebook'),className:'button button--secondary',attrs:{href:pageUrl('barber',{id:shop.id,service:appointment.service_id})}}));
  if(appointment.status==='completed'){
    if(review)contents.push(reviewCard(review,{mine:true}));
    else if(reviewError){const warning=element('div',{className:'review-check-error'});showErrorState(warning,reviewError,()=>void load());contents.push(warning);}
    else actions.append(button('review.write',()=>openReview(appointment)));
  }
  contents.push(actions);return element('article',{className:'appointment-card',attrs:{'data-appointment-id':appointment.id}},contents);
}
function openReview(appointment){if(reviewModal||disposed)return;const token=++reviewEpoch;const form=element('form',{className:'review-form',attrs:{novalidate:true}});const rating=element('fieldset',{className:'review-rating',attrs:{'data-field':''}},[element('legend',{text:t('review.rating')})]);
  for(let count=1;count<=5;count++){const id=`review-rating-${count}`;const input=element('input',{attrs:{type:'radio',name:'rating',value:count,id,required:true}});const label=element('label',{className:'review-star-choice',attrs:{for:id}},[input,element('span',{text:'★',attrs:{'aria-hidden':'true'}}),element('span',{text:t('review.stars',{count}),className:'sr-only'})]);rating.append(label);input.addEventListener('change',()=>{for(const control of rating.querySelectorAll('.review-star-choice'))control.classList.toggle('is-selected',Number(control.querySelector('input').value)<=count);});}
  const textarea=element('textarea',{attrs:{id:'review-comment',name:'comment',maxlength:1500,rows:4,placeholder:t('review.placeholder'),'aria-describedby':'review-comment-count'}});const counter=element('p',{text:t('review.commentCount',{count:0}),className:'field-hint',attrs:{id:'review-comment-count'}});textarea.addEventListener('input',()=>{counter.textContent=t('review.commentCount',{count:textarea.value.length});});const comment=element('div',{className:'field',attrs:{'data-field':''}},[element('label',{text:t('review.commentOptional'),attrs:{for:'review-comment'}}),textarea,counter]);const status=element('p',{className:'notice',attrs:{role:'alert',hidden:true}});const send=element('button',{text:t('review.send'),className:'button',attrs:{type:'submit'}});form.append(element('p',{text:appointment.service_name_at_booking,className:'intro'}),rating,comment,element('p',{text:t('review.publicHint'),className:'field-hint'}),status,send);
  reviewModal=openModal({title:t('review.title'),content:form,onClose:()=>{reviewModal=null;reviewEpoch++;textarea.value='';form.reset();}});
  form.addEventListener('submit',event=>{event.preventDefault();void withFormTask(form,async()=>{clearFormErrors(form);status.hidden=true;try{await submitReview(appointment.id,{rating:new FormData(form).get('rating'),comment:textarea.value});if(disposed||token!==reviewEpoch)return;reviewModal.close();toast(t('review.sent'),{type:'success'});await load();}catch(error){if(disposed||token!==reviewEpoch)return;if(error.code==='23505'){reviewModal.close();toast(errorMessage(error),{type:'error'});await load();return;}if(error.fields)showFormErrors(form,error.fields);status.textContent=errorMessage(error);status.hidden=false;}});});
}
function pagination(total) {
  pager.replaceChildren();if(total<=12&&page===1)return;
  const previous=button('common.previous',async()=>{page--;await load();});previous.disabled=page<=1;
  const next=button('common.next',async()=>{page++;await load();});next.disabled=page*12>=total;
  pager.append(previous,element('span',{text:t('common.page',{page})}),next);
}
async function load() {
  const current=++sequence;showState(list,{kind:'loading',key:'common.loading'});pager.replaceChildren();
  try{const value=await getAppointments({status:filter.value,page});if(disposed||current!==sequence)return;let reviews=[],reviewError=null;try{reviews=await getAppointmentReviews(value.rows.filter(row=>row.status==='completed').map(row=>row.id));}catch(error){reviewError=error;}if(disposed||current!==sequence)return;
    const byAppointment=new Map(reviews.map(review=>[review.appointment_id,review]));list.setAttribute('aria-busy','false');if(value.rows.length)list.replaceChildren(...value.rows.map(row=>card(row,byAppointment.get(row.id),reviewError)));
    else{showState(list,{key:filter.value?'appointments.noStatus':'appointments.empty'});list.append(element('a',{text:t('nav.home'),className:'text-button',attrs:{href:pageUrl('home')}}));}
    pagination(value.total);
  }catch(error){if(!disposed&&current===sequence)showErrorState(list,error,()=>void load());}
}
filter.addEventListener('change',()=>{page=1;void load();});document.querySelector('[data-refresh-appointments]').addEventListener('click',()=>void load());
void protection.ready.then(context=>{if(context)void load();});
const unwatch=auth.watch(({context})=>{if(context?.status==='ready'&&context.profile.role==='customer')void load();},{onPending:()=>{sequence++;reviewModal?.close();list.replaceChildren();pager.replaceChildren();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!disposed)void load();});
window.addEventListener('pagehide',()=>{disposed=true;sequence++;reviewModal?.close();unwatch();protection.dispose();},{once:true});
