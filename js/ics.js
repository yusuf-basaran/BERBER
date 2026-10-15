import {t} from './i18n.js';
import {formatMoney} from './ui.js';
const encoder=new TextEncoder();
export function escapeText(value){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
export function foldLine(value){
  const lines=[];let line='',size=0;
  for(const char of value){const length=encoder.encode(char).length;if(size+length>75){lines.push(line);line=' ';size=1;}line+=char;size+=length;}
  lines.push(line);return lines.join('\r\n');
}
export function utcDate(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new RangeError(t('error.validation'));return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function details(appointment){
  if(appointment?.status!=='confirmed'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointment?.id||'')||!appointment.barber||!Number.isFinite(Date.parse(appointment.start_at))||!Number.isFinite(Date.parse(appointment.end_at))||Date.parse(appointment.end_at)<=Date.parse(appointment.start_at))throw new RangeError(t('calendar.unavailable'));
  const shop=appointment.barber;
  return {summary:`${shop.shop_name} · ${appointment.service_name_at_booking}`,
    location:[shop.address,shop.district,shop.city].filter(Boolean).join(', '),
    description:[t('calendar.service',{name:appointment.service_name_at_booking}),t('calendar.price',{price:formatMoney(appointment.price_at_booking,appointment.currency_at_booking)}),t('calendar.phone',{phone:shop.phone||''})].join('\n')};
}
export function createIcs(appointment,{now=new Date()}={}){
  const data=details(appointment);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//BERBER//Randevu//TR','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    `UID:${appointment.id}@berber`,`DTSTAMP:${utcDate(now)}`,`DTSTART:${utcDate(appointment.start_at)}`,`DTEND:${utcDate(appointment.end_at)}`,
    `SUMMARY:${escapeText(data.summary)}`,`LOCATION:${escapeText(data.location)}`,`DESCRIPTION:${escapeText(data.description)}`,
    'STATUS:CONFIRMED','TRANSP:OPAQUE','BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY',`DESCRIPTION:${escapeText(t('calendar.reminder'))}`,
    'END:VALARM','END:VEVENT','END:VCALENDAR'];
  return lines.map(foldLine).join('\r\n')+'\r\n';
}
export function googleCalendarUrl(appointment){
  const data=details(appointment),url=new URL('https://calendar.google.com/calendar/render');
  for(const [key,value] of Object.entries({action:'TEMPLATE',text:data.summary,dates:`${utcDate(appointment.start_at)}/${utcDate(appointment.end_at)}`,details:data.description,location:data.location,ctz:'Europe/Nicosia'}))url.searchParams.set(key,value);
  return url.href;
}
export function downloadIcs(appointment){
  const url=URL.createObjectURL(new Blob([createIcs(appointment)],{type:'text/calendar;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download=`berber-randevu-${appointment.id}.ics`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
