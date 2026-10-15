import { supabase } from './supabase.js';
import { config } from './config.js';
import { localDate, formatTime } from './ui.js';
import { t } from './i18n.js';

export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function calendarDate(value) {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(t('error.validation'));
  const date=new Date(`${value}T12:00:00Z`);
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value)throw new RangeError(t('error.validation'));
  return date;
}
export function addDays(value,days) {
  if(!Number.isInteger(days))throw new RangeError(t('error.validation'));
  const date=calendarDate(value);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
export function bookingDates(now=new Date()) { const min=localDate(now);return {min,max:addDays(min,90)}; }
export function slotLabel(start, all=[]) {
  const time=formatTime(start);
  if(all.filter(slot=>formatTime(slot.start_at)===time).length<2)return time;
  const zone=new Intl.DateTimeFormat(config.locale,{timeZone:config.timeZone,timeZoneName:'shortOffset',hour:'2-digit'}).formatToParts(new Date(start)).find(part=>part.type==='timeZoneName').value;
  return `${time} (${zone})`;
}
export async function getSlots(barberId,serviceId,date,{signal}={}) {
  const limits=bookingDates();calendarDate(date);
  if(!isUuid(barberId)||!isUuid(serviceId)||date<limits.min||date>limits.max)throw new RangeError(t('error.validation'));
  let query=supabase.rpc('get_available_slots',{p_barber_id:barberId,p_service_id:serviceId,p_date:date});
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;if(error)throw error;
  return (data||[]).filter(slot=>Number.isFinite(Date.parse(slot.start_at))&&Date.parse(slot.start_at)>Date.now()&&Date.parse(slot.end_at)>Date.parse(slot.start_at));
}
