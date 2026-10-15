import { supabase } from './supabase.js';
import { auth, FormError } from './auth.js';
import { isUuid } from './slots.js';
import { t } from './i18n.js';
export const statuses=Object.freeze(['pending','confirmed','rejected','counter_proposed','cancelled','completed','no_show']);
export const appointmentFields='id,barber_id,customer_id,service_id,start_at,end_at,status,customer_note,barber_note,proposed_start_at,proposed_end_at,price_at_booking,currency_at_booking,duration_at_booking,service_name_at_booking,created_at,source,barber:barbers(id,shop_name,city,district,address,phone,whatsapp,cancel_hours_before)';
const fail=key=>{const error=new Error(t(key));error.userMessage=t(key);return error;};
async function customer() {
  const context=await auth.getContext();
  if(context.status!=='ready')throw fail(context.status==='mfa_required'?'error.mfaRequired':'auth.loginRequired');
  if(context.profile.role!=='customer')throw fail('error.customerOnly');return context.user.id;
}
export async function requestAppointment({barberId,serviceId,startAt,note=''}) {
  const fields={};if(!isUuid(barberId)||!isUuid(serviceId))fields.serviceId=t('error.validation');
  if(!Number.isFinite(Date.parse(startAt))||Date.parse(startAt)<=Date.now()||! /T.*(Z|[+-]\d{2}:?\d{2})$/i.test(startAt||''))fields.startAt=t('error.slotRequired');
  if(typeof note!=='string'||note.length>1000)fields.note=t('error.noteLength');if(Object.keys(fields).length)throw new FormError(fields);
  const id=await customer();const profile=await supabase.from('profiles').select('full_name,phone').eq('id',id).single();if(profile.error)throw profile.error;if(!profile.data?.full_name?.trim()||!/^\+90(5[0-9]{9}|392[0-9]{7})$/.test(profile.data.phone||'')){const error=fail('profile.complete');error.code='P2007';throw error;}
  const {data,error}=await supabase.from('appointments').insert({barber_id:barberId,customer_id:id,service_id:serviceId,start_at:startAt,customer_note:note.trim()}).select(appointmentFields).single();
  if(error)throw error;return data;
}
export async function getAppointments({status='',page=1}={}) {
  if((status&&!statuses.includes(status))||!Number.isInteger(page)||page<1||page>1000)throw fail('error.validation');const id=await customer();
  let request=supabase.from('appointments').select(appointmentFields,{count:'exact'}).eq('customer_id',id).order('created_at',{ascending:false}).range((page-1)*12,page*12-1);
  if(status)request=request.eq('status',status);const {data,error,count}=await request;if(error)throw error;return {rows:data||[],total:count||0};
}
export async function changeAppointment(id,status) {
  if(!isUuid(id)||!['confirmed','rejected','cancelled'].includes(status))throw fail('error.validation');const customerId=await customer();
  const {data,error}=await supabase.from('appointments').update({status}).eq('id',id).eq('customer_id',customerId).select(appointmentFields).maybeSingle();
  if(error)throw error;if(!data)throw fail('error.staleAppointment');return data;
}
export async function getCalendarAppointment(id){
  if(!isUuid(id))throw fail('error.validation');const customerId=await customer();
  const {data,error}=await supabase.from('appointments').select(appointmentFields).eq('id',id).eq('customer_id',customerId).eq('status','confirmed').maybeSingle();
  if(error)throw error;if(!data)throw fail('calendar.unavailable');return data;
}
