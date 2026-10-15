import {createFavoriteControls} from './favorite-button.js';
import { mountLayout } from './layout.js';
import { getBarber,getPublicReviews } from './barbers.js';
import { reviewCard } from './reviews.js';
import { auth,FormError,destination } from './auth.js';
import { getSlots,bookingDates,slotLabel,calendarDate } from './slots.js';
import { requestAppointment } from './appointments.js';
import { pageUrl } from './config.js';
import { t } from './i18n.js';
import { element,shopPhoto,formatMoney,formatTime,formatDateTime,showState,showErrorState,errorMessage,showFormErrors,clearFormErrors,withFormTask,toast,safeHref } from './ui.js';
mountLayout();
const params=new URL(location.href).searchParams;const demo=params.get('demo')==='1';const id=params.get('id');
const favorites=createFavoriteControls({demo});
const container=document.querySelector('[data-detail]');const form=document.getElementById('booking-form');
const slotBox=document.querySelector('[data-slots]');const summary=document.querySelector('[data-booking-summary]');
const notice=document.querySelector('[data-booking-notice]');const panel=document.querySelector('[data-booking-panel]');
const reviewBox=document.querySelector('[data-reviews]');let barber;let available=[];let service;let controller;let load=0;let reviewPage=1;
document.querySelector('[data-demo]').hidden=!demo;
function message(value='',error=false){notice.textContent=value;notice.hidden=!value;notice.setAttribute('role',error?'alert':'status');notice.classList.toggle('notice--error',error);}
function clearSelection(){available=[];form.elements.startAt.value='';summary.textContent='';slotBox.replaceChildren();}
function serviceSummary(start='') {
  if(!service)return;summary.replaceChildren(element('strong',{text:service.name}),element('p',{text:`${formatMoney(service.price,service.currency)} · ${t('common.minutes',{count:service.duration_min})}`}),...(start?[element('p',{text:t('booking.selected',{time:formatDateTime(start)})})]:[]));
}
async function slots() {
  controller?.abort();controller=new AbortController();const current=++load;clearSelection();message();
  service=barber?.services.find(value=>value.id===form.elements.serviceId.value);
  if(!service||!form.elements.date.value){showState(slotBox,{key:'booking.selectPrompt'});return;}
  serviceSummary();showState(slotBox,{kind:'loading',key:'common.loading'});
  try{
    const values=await getSlots(id,service.id,form.elements.date.value,{signal:controller.signal});if(current!==load)return;
    available=values;slotBox.setAttribute('aria-busy','false');
    if(!values.length){showState(slotBox,{key:'booking.noSlots'});return;}
    slotBox.replaceChildren(...values.map((slot,index)=>{
      const input=element('input',{attrs:{type:'radio',name:'slot',value:slot.start_at,id:`slot-${index}`}});
      input.addEventListener('change',()=>{form.elements.startAt.value=slot.start_at;serviceSummary(slot.start_at);});
      return element('label',{className:'slot-choice',attrs:{for:`slot-${index}`}},[input,element('span',{text:slotLabel(slot.start_at,values)})]);
    }));
  }catch(error){if(current===load&&!controller.signal.aborted)showErrorState(slotBox,error,()=>void slots());}
}
let reviewRun=0;let reviewDisposed=false;
async function reviews(target=1) {
  const current=++reviewRun;const more=document.querySelector('[data-more-reviews]');more.disabled=true;if(target===1)showState(reviewBox,{kind:'loading',key:'common.loading'});
  try{const value=await getPublicReviews(id,target,{demo});if(reviewDisposed||current!==reviewRun)return false;if(target===1)reviewBox.replaceChildren();else reviewBox.querySelector('[data-review-error]')?.remove();reviewPage=target;
    if(!value.total){showState(reviewBox,{key:'barber.noReviews'});more.hidden=true;return true;}
    reviewBox.append(...value.rows.map(review=>reviewCard(review)));
    more.hidden=reviewPage*10>=value.total;
    return true;
  }catch(error){if(reviewDisposed||current!==reviewRun)return false;const warning=target===1?reviewBox:reviewBox.querySelector('[data-review-error]')||element('div',{attrs:{'data-review-error':''}});if(target>1&&!warning.isConnected)reviewBox.append(warning);showErrorState(warning,error,()=>void reviews(target));return false;}finally{if(!reviewDisposed&&current===reviewRun)more.disabled=false;}
}
function detail(value) {
  const contacts=element('div',{className:'contact-actions'});if(!demo)contacts.append(favorites.button(value));
  if(!demo&&safeHref(`tel:${value.phone}`))contacts.append(element('a',{text:t('barber.call'),className:'button button--secondary',attrs:{href:`tel:${value.phone}`}}));
  if(!demo&&/^\+905\d{9}$/.test(value.whatsapp||''))contacts.append(element('a',{text:t('barber.whatsapp'),className:'button button--secondary',attrs:{href:`https://wa.me/${value.whatsapp.slice(1)}`,target:'_blank'}}));
  if(!demo&&value.map_url&&safeHref(value.map_url))contacts.append(element('a',{text:t('barber.directions'),className:'button button--secondary',attrs:{href:value.map_url,target:'_blank'}}));
  container.replaceChildren(element('div',{className:'detail-hero'},[shopPhoto(value,{large:true}),element('div',{className:'detail-info'},[
    element('p',{text:t('barber.location',{city:value.city,district:value.district}),className:'eyebrow'}),element('h1',{text:value.shop_name}),
    element('p',{text:value.review_count?`${t('barber.ratingLabel',{rating:Number(value.avg_rating).toLocaleString('tr-TR')})} · ${t('barber.reviewsCount',{count:value.review_count})}`:t('barber.noReviews')}),element('p',{text:value.address,className:'intro'}),contacts
  ])]),element('section',{className:'detail-section'},[element('h2',{text:t('barber.about')}),element('p',{text:value.bio}),element('p',{text:t(Number(value.cancel_hours_before??2)===0?'manual.cancelUnlimited':'manual.cancelPolicy',{hours:value.cancel_hours_before??2}),className:'notice'})]));
  const services=document.querySelector('[data-services]');services.replaceChildren(...value.services.map(item=>{
    const button=element('button',{text:t('barber.chooseService'),className:'text-button',attrs:{type:'button',disabled:demo||!value.is_active}});
    button.addEventListener('click',()=>{form.elements.serviceId.value=item.id;panel.scrollIntoView({block:'start'});void slots();});
    return element('article',{className:'service-row'},[element('div',{},[element('h3',{text:item.name}),element('p',{text:t('common.minutes',{count:item.duration_min}),className:'intro'})]),element('strong',{text:formatMoney(item.price,item.currency)}),button]);
  }));if(!value.services.length)showState(services,{key:'barber.noServices'});
  const hours=document.querySelector('[data-hours]');hours.replaceChildren(...[1,2,3,4,5,6,0].map(day=>{
    const row=value.hours.find(row=>Number(row.weekday)===day);const text=!row||row.is_closed?t('barber.closed'):`${row.open_time.slice(0,5)}–${row.close_time.slice(0,5)}${row.break_start?` · ${t('barber.break')} ${row.break_start.slice(0,5)}–${row.break_end.slice(0,5)}`:''}`;
    return element('div',{className:'hours-row'},[element('strong',{text:t(`day.${day}`)}),element('span',{text})]);
  }));
  form.elements.serviceId.replaceChildren(element('option',{text:t('common.select'),attrs:{value:''}}),...value.services.map(item=>element('option',{text:`${item.name} · ${formatMoney(item.price,item.currency)}`,attrs:{value:item.id}})));
}
form.elements.serviceId.addEventListener('change',()=>void slots());form.elements.date.addEventListener('change',()=>void slots());
document.querySelector('[data-refresh-slots]').addEventListener('click',()=>void slots());
document.querySelector('[data-more-reviews]').addEventListener('click',()=>void reviews(reviewPage+1));
form.addEventListener('submit',event=>{
  event.preventDefault();void withFormTask(form,async()=>{
    clearFormErrors(form);message();
    try{
      if(demo||!barber?.is_active)throw new Error(t('booking.serviceUnavailable'));
      const context=await auth.getContext();if(context.status!=='ready'){window.location.assign(destination(context,pageUrl('barber',{id,service:form.elements.serviceId.value,date:form.elements.date.value})));return;}
      const startAt=form.elements.startAt.value;if(!available.some(slot=>slot.start_at===startAt)||Date.parse(startAt)<=Date.now())throw new FormError({startAt:t('error.slotRequired')});
      const saved=await requestAppointment({barberId:id,serviceId:form.elements.serviceId.value,startAt,note:form.elements.note.value});
      form.hidden=true;slotBox.replaceChildren();summary.replaceChildren(element('h3',{text:t('booking.submittedTitle')}),element('p',{text:t('booking.sent')}),element('p',{text:`${formatDateTime(saved.start_at)} · ${formatMoney(saved.price_at_booking,saved.currency_at_booking)}`}),element('a',{text:t('booking.viewAppointments'),className:'button',attrs:{href:pageUrl('appointments')}}));
    }catch(error){if(error instanceof FormError){showFormErrors(form,error.fields);message(t(error.fields.startAt?'error.slotRequired':'error.validation'),true);}else message(errorMessage(error),true);if(error.code==='23P01')await slots().then(()=>message(t('error.conflict'),true));}
  });
});
async function initialize() {
  panel.hidden=true;document.querySelector('[data-detail-columns]').hidden=true;showState(container,{kind:'loading',key:'common.loading'});
  try{barber=await getBarber(id,{demo});if(!barber){container.replaceChildren(element('h1',{text:t('barber.notFound')}),element('a',{text:t('nav.home'),className:'text-button',attrs:{href:pageUrl('home')}}));return;}
    detail(barber);void favorites.sync();document.querySelector('[data-detail-columns]').hidden=false;const dates=bookingDates();form.elements.date.min=dates.min;form.elements.date.max=dates.max;form.elements.date.value=dates.min;
    const date=params.get('date');try{calendarDate(date);if(date>=dates.min&&date<=dates.max)form.elements.date.value=date;}catch{}
    const serviceId=params.get('service');if(barber.services.some(service=>service.id===serviceId))form.elements.serviceId.value=serviceId;
    panel.hidden=false;
    if(demo){form.hidden=true;message(t('demo.booking'));}
    else if(!barber.is_active||!barber.services.length){form.hidden=true;message(t('barber.unavailable'));}
    else{form.hidden=false;if(form.elements.serviceId.value)await slots();else showState(slotBox,{key:'booking.selectPrompt'});}
    await reviews();
  }catch(error){showErrorState(container,error,()=>void initialize());}
}
void initialize();window.addEventListener('pagehide',()=>{favorites.dispose();load++;reviewDisposed=true;reviewRun++;controller?.abort();},{once:true});
