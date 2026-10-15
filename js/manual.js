import { supabase } from './supabase.js';
import { auth, FormError } from './auth.js';
import { normalizePhone } from './ui.js';
import { isUuid } from './slots.js';
import { t } from './i18n.js';
async function owner(barberId){
  const context=await auth.getContext();
  if(context.status!=='ready'||context.profile.role!=='barber'||!isUuid(barberId))throw new Error(t('error.forbidden'));
  return context;
}
function result(response){if(response.error)throw response.error;return response.data;}
export async function findCustomer(barberId,phone){
  await owner(barberId);const clean=normalizePhone(phone);
  return result(await supabase.rpc('find_booking_customer',{p_barber_id:barberId,p_phone:clean}))||[];
}
export function validateManual(values){
  const fields={},name=String(values.name||'').trim(),note=String(values.note||'').trim();let phone;
  if(!isUuid(values.serviceId))fields.serviceId=t('common.required');
  if(values.customerId&&!isUuid(values.customerId))fields.customerId=t('error.validation');
  if(!values.customerId){
    if(name.length<2||name.length>100)fields.name=t('error.name');
    try{phone=normalizePhone(values.phone);}catch{fields.phone=t('error.phone');}
  }
  if(!Number.isFinite(Date.parse(values.startAt))||Date.parse(values.startAt)<=Date.now()||!/T.*(Z|[+-]\d{2}:?\d{2})$/.test(values.startAt||''))fields.startAt=t('error.slotRequired');
  if(note.length>1000)fields.note=t('error.noteLength');
  if(Object.keys(fields).length)throw new FormError(fields);
  return {service_id:values.serviceId,customer_id:values.customerId||null,guest_name:values.customerId?null:name,
    guest_phone:values.customerId?null:phone,start_at:values.startAt,barber_note:note,source:'manual'};
}
export async function createManual(barberId,values){
  await owner(barberId);const input=validateManual(values);
  return result(await supabase.from('appointments').insert({...input,barber_id:barberId}).select('id,status,start_at').single());
}
export async function getBlocked(barberId){await owner(barberId);return result(await supabase.rpc('list_blocked_customers',{p_barber_id:barberId}))||[];}
export async function setBlocked(barberId,customerId,blocked){
  await owner(barberId);if(!isUuid(customerId)||typeof blocked!=='boolean')throw new Error(t('error.validation'));
  if(blocked)result(await supabase.from('blocked_customers').insert({barber_id:barberId,customer_id:customerId}));
  else result(await supabase.from('blocked_customers').delete().eq('barber_id',barberId).eq('customer_id',customerId));
}
