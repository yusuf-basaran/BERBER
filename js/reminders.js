import {t} from './i18n.js';
import {element as el} from './ui.js';
const parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Nicosia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
const key=p=>`${p.year}-${p.month}-${p.day}`;
export function whatsappReminderUrl(row,shop,{now=Date.now()}={}){
 if(row?.status!=='confirmed'||!Number.isFinite(Date.parse(row.start_at))||Date.parse(row.start_at)<=now||!/^\+90(?:5\d{9}|392\d{7})$/.test(row.customer_phone||''))return null;
 const current=parts(now),day=parts(row.start_at),tomorrow=new Date(Date.UTC(Number(current.year),Number(current.month)-1,Number(current.day)+1)).toISOString().slice(0,10);
 const date=key(day)===key(current)?t('reminder.today'):key(day)===tomorrow?t('reminder.tomorrow'):new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Nicosia',day:'numeric',month:'long',year:'numeric'}).format(new Date(row.start_at));
 const time=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Nicosia',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(row.start_at));
 const url=new URL('https://wa.me/'+row.customer_phone.slice(1));url.searchParams.set('text',t('reminder.whatsappMessage',{name:row.customer_name||'',date,time,shop:shop.shop_name}));return url.href;
}
export function whatsappReminderLink(row,shop){const href=whatsappReminderUrl(row,shop);return href?el('a',{text:t('reminder.whatsapp'),className:'button button--secondary',attrs:{href,target:'_blank',rel:'noopener noreferrer'}}):null;}
