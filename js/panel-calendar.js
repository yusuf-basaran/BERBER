import {supabase} from './supabase.js';
import {getServices} from './panel.js';
import {getSlots,addDays,calendarDate,bookingDates} from './slots.js';
import {t} from './i18n.js';
import {config} from './config.js';
import {element as el,showState,showErrorState,localDate,formatTime,formatMoney,openModal} from './ui.js';
const result=r=>{if(r.error)throw r.error;return r.data;};
export function weekStart(day){const weekday=calendarDate(day).getUTCDay();return addDays(day,-((weekday+6)%7));}
const button=(key,run)=>{const b=el('button',{text:t(key),className:'button button--secondary',attrs:{type:'button'}});b.addEventListener('click',()=>void run());return b;};
export async function calendarPanel(container,current,shop,{card,manual}){
 const toolbar=el('div',{className:'appointments-toolbar'}),date=el('input',{attrs:{type:'date',id:'calendar-date',value:localDate(),required:true}}),view=el('select',{attrs:{id:'calendar-view'}}),service=el('select',{attrs:{id:'calendar-service'}}),grid=el('div',{className:'week-calendar'}),notice=el('p',{className:'field-hint',attrs:{role:'status'}});let sequence=0;
 view.append(...['week','day'].map(v=>el('option',{text:t('calendar.'+v),attrs:{value:v}})));
 service.append(el('option',{text:t('calendar.chooseService'),attrs:{value:''}}));
 for(const row of(await getServices()).filter(r=>r.is_active))service.append(el('option',{text:row.name,attrs:{value:row.id}}));if(!current())return;
 toolbar.append(el('label',{text:t('field.date'),attrs:{for:date.id}}),date,el('label',{text:t('calendar.view'),attrs:{for:view.id}}),view,el('label',{text:t('calendar.emptyFor'),attrs:{for:service.id}}),service,
  button('common.previous',()=>shift(-1)),button('calendar.today',()=>{date.value=localDate();return load();}),button('common.next',()=>shift(1)));
 container.replaceChildren(el('h2',{text:t('panel.calendar')}),toolbar,notice,grid);
 function shift(direction){date.value=addDays(date.value,direction*(view.value==='week'?7:1));return load();}
 async function load(){const token=++sequence;showState(grid,{kind:'loading',key:'common.loading'});notice.textContent='';try{
  calendarDate(date.value);const first=view.value==='week'?weekStart(date.value):date.value,days=view.value==='week'?7:1;
  const data=result(await supabase.rpc('get_barber_calendar',{p_date:first,p_days:days}));if(!current()||token!==sequence)return;
  grid.replaceChildren();grid.classList.toggle('week-calendar--day',days===1);if(data.total>data.rows.length)notice.textContent=t('calendar.limited');
  const limits=bookingDates();
  for(let i=0;i<days;i++){const day=addDays(first,i),section=el('section',{className:'calendar-day'}),list=el('div');section.append(el('h3',{text:new Intl.DateTimeFormat(config.locale,{weekday:'long',day:'numeric',month:'short',timeZone:config.timeZone}).format(calendarDate(day))}),list);grid.append(section);
   const appointments=data.rows.filter(row=>localDate(row.effective_start)===day);if(!appointments.length)list.append(el('p',{text:t('calendar.noAppointments'),className:'field-hint'}));
   for(const row of appointments){const entry=el('button',{className:'calendar-entry',attrs:{type:'button'}},[el('strong',{text:formatTime(row.effective_start)+' · '+row.customer_name}),el('span',{text:row.service_name_at_booking}),el('span',{text:t('status.'+row.status),className:'status-badge status-badge--'+row.status})]);entry.addEventListener('click',()=>{const detail=el('div');const modal=openModal({title:t('calendar.detail'),content:detail});detail.append(card(row,async()=>{modal.close();await load();}));});list.append(entry);}
   if(service.value&&day>=limits.min&&day<=limits.max){const free=el('details'),slotsBox=el('div',{className:'calendar-free'});free.append(el('summary',{text:t('calendar.freeSlots')}),slotsBox);section.append(free);let loaded=false;
    free.addEventListener('toggle',()=>{if(!free.open||loaded)return;loaded=true;showState(slotsBox,{kind:'loading',key:'common.loading'});void getSlots(shop.id,service.value,day).then(slots=>{if(!current()||token!==sequence)return;slotsBox.replaceChildren();if(!slots.length)showState(slotsBox,{key:'booking.noSlots'});for(const slot of slots){const b=el('button',{text:formatTime(slot.start_at),className:'button button--secondary',attrs:{type:'button','aria-label':t('calendar.addAt',{time:formatTime(slot.start_at)})}});b.addEventListener('click',()=>manual({date:day,serviceId:service.value,startAt:slot.start_at}));slotsBox.append(b);}}).catch(error=>{if(current()&&token===sequence)showErrorState(slotsBox,error,()=>{loaded=false;free.open=false;free.open=true;});});});
   }
  }
 }catch(error){if(current()&&token===sequence)showErrorState(grid,error,load);}}
 for(const input of[date,view,service])input.addEventListener('change',()=>void load());await load();
}
export async function statisticsPanel(container,current){
 const period=el('select',{attrs:{id:'statistics-period'}}),box=el('div');let sequence=0;
 for(const days of[7,30,90])period.append(el('option',{text:t('statistics.period',{days}),attrs:{value:days}}));period.value='30';container.replaceChildren(el('h2',{text:t('panel.statistics')}),el('label',{text:t('statistics.choosePeriod'),attrs:{for:period.id}}),period,el('p',{text:t('statistics.scope'),className:'field-hint'}),box);
 async function load(){const token=++sequence;showState(box,{kind:'loading',key:'common.loading'});try{const data=result(await supabase.rpc('get_barber_statistics',{p_days:Number(period.value)}));if(!current()||token!==sequence)return;
  box.replaceChildren(el('p',{text:data.from+' – '+data.to}));const stats=el('div',{className:'panel-stats statistics-summary'});stats.append(el('div',{className:'stat-card'},[el('span',{text:t('statistics.total')}),el('strong',{text:data.total})]));
  for(const name of['completed','cancelled','no_show'])stats.append(el('div',{className:'stat-card'},[el('span',{text:t('status.'+name)}),el('strong',{text:String(data[name])+' · '+(data.total?Math.round(data[name]/data.total*100):0)+'%'})]));box.append(stats);
  const revenue=el('section',{className:'statistics-section'},[el('h3',{text:t('statistics.revenue')}),el('p',{text:t('statistics.revenueHint'),className:'field-hint'})]);for(const currency of['TRY','GBP','EUR'])revenue.append(el('p',{text:formatMoney(data.revenue.find(row=>row.currency===currency)?.amount||0,currency)}));box.append(revenue);
  const services=el('section',{className:'statistics-section'},[el('h3',{text:t('statistics.services')})]);if(!data.services.length)services.append(el('p',{text:t('common.empty')}));for(const row of data.services)services.append(el('p',{text:row.service+' · '+row.count}));box.append(services);
  const peaks=el('section',{className:'statistics-section'},[el('h3',{text:t('statistics.busy')})]);for(const row of data.weekdays.slice(0,3))peaks.append(el('p',{text:t('weekday.'+(row.weekday%7))+' · '+row.count}));for(const row of data.hours)peaks.append(el('p',{text:String(row.hour).padStart(2,'0')+':00 · '+row.count}));if(!data.weekdays.length)peaks.append(el('p',{text:t('common.empty')}));box.append(peaks);
  const figure=el('figure',{className:'statistics-chart'}),caption=el('figcaption',{text:t('statistics.daily')}),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 720 180');svg.setAttribute('role','img');svg.setAttribute('aria-label',t('statistics.daily'));const max=Math.max(1,...data.daily.map(row=>row.count));
  data.daily.forEach((row,i)=>{const rect=document.createElementNS(svg.namespaceURI,'rect'),title=document.createElementNS(svg.namespaceURI,'title');title.textContent=row.date+' · '+row.count;rect.setAttribute('x',String(i*720/data.daily.length));rect.setAttribute('y',String(170-row.count/max*160));rect.setAttribute('width',String(Math.max(1,720/data.daily.length-2)));rect.setAttribute('height',String(row.count/max*160));rect.append(title);svg.append(rect);});figure.append(caption,svg);const table=el('details'),list=el('dl',{className:'customer-stats'});table.append(el('summary',{text:t('statistics.table')}),list);for(const row of data.daily)list.append(el('dt',{text:row.date}),el('dd',{text:String(row.count)}));figure.append(table);box.append(figure);
 }catch(error){if(current()&&token===sequence)showErrorState(box,error,load);}}
 period.addEventListener('change',()=>void load());await load();
}
