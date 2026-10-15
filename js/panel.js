import { supabase } from './supabase.js';
import { auth,FormError } from './auth.js';
import { config } from './config.js';
import { categories } from './barbers.js';
import { isUuid,calendarDate,bookingDates } from './slots.js';
import { normalizePhone,localDate } from './ui.js';
import { t } from './i18n.js';
const shopFields='id,owner_id,shop_name,city,district,address,map_url,phone,whatsapp,bio,photo_url,avg_rating,review_count,is_active,created_at,cancel_hours_before,verification_status,instagram_url';
const serviceFields='id,barber_id,name,category,price,currency,duration_min,is_active';
const fail=key=>{const error=new Error(t(key));error.userMessage=t(key);return error;};
function result(response){if(response.error)throw response.error;return response.data;}
async function owner(){const context=await auth.getContext();if(context.status!=='ready')throw fail(context.status==='mfa_required'?'error.mfaRequired':'auth.loginRequired');if(context.profile.role!=='barber')throw fail('error.barberOnly');return context;}
export async function getOwnedShop(){const context=await owner();return result(await supabase.from('barbers').select(shopFields).eq('owner_id',context.user.id).maybeSingle());}
async function shop(){const value=await getOwnedShop();if(!value)throw fail('panel.createFirst');return value;}
export function validateShop(values){
  const fields={};const input={shop_name:String(values.shopName||'').trim(),city:String(values.city||''),district:String(values.district||''),address:String(values.address||'').trim(),bio:String(values.bio||'').trim(),map_url:String(values.mapUrl||'').trim()||null,is_active:values.isActive===true};
  if(input.shop_name.length<2||input.shop_name.length>120)fields.shopName=t('error.shopName');if(!input.city)fields.city=t('common.required');if(!input.district)fields.district=t('common.required');
  if(input.address.length<5||input.address.length>500)fields.address=t('error.address');if(input.bio.length>2000)fields.bio=t('error.bio');
  if(input.map_url){try{const url=new URL(input.map_url);const valid=url.protocol==='https:'&&!url.username&&!url.password&&((url.hostname==='maps.app.goo.gl'&&url.pathname.startsWith('/'))||(url.hostname==='goo.gl'&&url.pathname.startsWith('/maps/'))||(['google.com','www.google.com','maps.google.com','google.com.tr','www.google.com.tr','maps.google.com.tr'].includes(url.hostname)&&url.pathname.startsWith('/maps')));if(!valid||input.map_url.length>2000)fields.mapUrl=t('error.mapUrl');}catch{fields.mapUrl=t('error.mapUrl');}}
  try{input.phone=normalizePhone(values.phone);}catch{fields.phone=t('error.phone');}try{input.whatsapp=values.whatsapp?normalizePhone(values.whatsapp,{mobileOnly:true}):null;}catch{fields.whatsapp=t('error.phone');}
  if(Object.keys(fields).length)throw new FormError(fields);return input;
}
export async function saveShop(values){const context=await owner();const current=await getOwnedShop();const input=validateShop(values);
  if(values.cancelHours!==undefined){const hours=Number(values.cancelHours);if(String(values.cancelHours).trim()===''||!Number.isInteger(hours)||hours<0||hours>8760)throw new FormError({cancelHours:t('manual.cancelHoursError')});input.cancel_hours_before=hours;}
  const instagram=String(values.instagramUrl||'').trim();if(instagram&&!/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/.test(instagram))throw new FormError({instagramUrl:t('application.instagramError')});input.instagram_url=instagram||null;
  let request=current?supabase.from('barbers').update(input).eq('id',current.id).eq('owner_id',context.user.id):supabase.from('barbers').insert({...input,owner_id:context.user.id});
  const saved=result(await request.select(shopFields).maybeSingle());if(!saved)throw fail('error.recordChanged');return saved;
}
export function validateService(values){
  const fields={};const input={name:String(values.name||'').trim(),category:String(values.category||''),price:Number(values.price),currency:values.currency||'TRY',duration_min:Number(values.duration),is_active:values.isActive===true};
  if(input.name.length<2||input.name.length>100)fields.name=t('error.serviceName');if(!categories.some(([value])=>value===input.category))fields.category=t('error.validation');
  if(String(values.price).trim()===''||values.price===null||values.price===undefined||!Number.isFinite(input.price)||input.price<0||input.price>99999999.99||Math.abs(input.price*100-Math.round(input.price*100))>0.00001)fields.price=t('error.price');
  if(!['TRY','GBP','EUR'].includes(input.currency))fields.currency=t('error.validation');if(!Number.isInteger(input.duration_min)||input.duration_min<5||input.duration_min>480||input.duration_min%5!==0)fields.duration=t('error.duration');
  if(Object.keys(fields).length)throw new FormError(fields);return input;
}
export async function getServices(){const current=await shop();return result(await supabase.from('services').select(serviceFields).eq('barber_id',current.id).order('name'))||[];}
export async function saveService(values,id=null){const current=await shop();const input=validateService(values);if(id&&!isUuid(id))throw fail('error.validation');
  const request=id?supabase.from('services').update(input).eq('id',id).eq('barber_id',current.id):supabase.from('services').insert({...input,barber_id:current.id});const value=result(await request.select(serviceFields).maybeSingle());if(!value)throw fail('error.recordChanged');return value;
}
export async function deleteService(id){if(!isUuid(id))throw fail('error.validation');const current=await shop();const response=await supabase.from('services').delete().eq('id',id).eq('barber_id',current.id).select('id').maybeSingle();
  if(response.error?.code==='23503'){const value=result(await supabase.from('services').update({is_active:false}).eq('id',id).eq('barber_id',current.id).select('id').maybeSingle());if(!value)throw fail('error.recordChanged');return {archived:true};}
  const value=result(response);if(!value)throw fail('error.recordChanged');return {archived:false};
}
const clock=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
export function validateHours(rows){
  if(!Array.isArray(rows)||rows.length!==7||new Set(rows.map(row=>row.weekday)).size!==7)throw fail('error.hours');
  return rows.map(row=>{
    if(!Number.isInteger(row.weekday)||row.weekday<0||row.weekday>6||typeof row.is_closed!=='boolean')throw fail('error.hours');
    if(row.is_closed)return {weekday:row.weekday,is_closed:true,open_time:null,close_time:null,break_start:null,break_end:null};
    const start=row.open_time?.slice(0,5),end=row.close_time?.slice(0,5),pauseStart=row.break_start?.slice(0,5)||null,pauseEnd=row.break_end?.slice(0,5)||null;
    if(!clock(row.open_time)||!clock(row.close_time)||start>=end||(Boolean(pauseStart)!==Boolean(pauseEnd))||(pauseStart&&(!clock(row.break_start)||!clock(row.break_end)||pauseStart>=pauseEnd||pauseStart<start||pauseEnd>end)))throw fail('error.hours');
    return {weekday:row.weekday,is_closed:false,open_time:start,close_time:end,break_start:pauseStart,break_end:pauseEnd};
  });
}
export async function getHours(){const current=await shop();return result(await supabase.from('working_hours').select('weekday,open_time,close_time,break_start,break_end,is_closed').eq('barber_id',current.id))||[];}
export async function saveHours(rows){const current=await shop();result(await supabase.rpc('save_working_hours',{p_barber_id:current.id,p_hours:validateHours(rows)}));}
export async function getClosedDates(){const current=await shop();return result(await supabase.from('closed_dates').select('id,date,reason').eq('barber_id',current.id).gte('date',localDate()).order('date').limit(120))||[];}
export async function addClosedDate(date,reason=''){calendarDate(date);if(date<localDate()||typeof reason!=='string'||reason.length>300)throw fail('error.closedDate');const current=await shop();return result(await supabase.from('closed_dates').insert({barber_id:current.id,date,reason:reason.trim()}).select('id,date,reason').single());}
export async function removeClosedDate(id){if(!isUuid(id))throw fail('error.validation');const current=await shop();const value=result(await supabase.from('closed_dates').delete().eq('id',id).eq('barber_id',current.id).select('id').maybeSingle());if(!value)throw fail('error.recordChanged');}
export async function getDashboard(){const current=await shop();return result(await supabase.rpc('get_barber_dashboard',{p_barber_id:current.id}));}
export async function getRequests({view='today',status='',page=1}={}){const current=await shop();return result(await supabase.rpc('get_barber_appointments',{p_barber_id:current.id,p_view:view,p_status:status,p_page:page}));}
export async function manageRequest(id,status,{note='',proposedStart}={}){if(!isUuid(id)||!['confirmed','rejected','counter_proposed','cancelled','completed','no_show'].includes(status)||typeof note!=='string'||note.length>1000)throw fail('error.validation');
  if(status==='cancelled'&&!note.trim())throw new FormError({note:t('manual.cancelReason')});
  if(status==='rejected'&&!note.trim())throw new FormError({note:t('panel.rejectHint')});if(status==='counter_proposed'&&(!proposedStart||!/(Z|[+-]\\d{2}:\\d{2})$/.test(proposedStart)||Date.parse(proposedStart)<=Date.now()||!Number.isFinite(Date.parse(proposedStart))))throw new FormError({startAt:t('error.slotRequired')});
  const current=await shop();const input={status,...(note?{barber_note:note.trim()}:{}),...(status==='counter_proposed'?{proposed_start_at:proposedStart}:{})};
  const value=result(await supabase.from('appointments').update(input).eq('id',id).eq('barber_id',current.id).select('id,status,start_at,end_at,proposed_start_at').maybeSingle());if(!value)throw fail('error.staleAppointment');return value;
}
export async function getProposalSlots(id,date){if(!isUuid(id))throw fail('error.validation');calendarDate(date);const limits=bookingDates();if(date<limits.min||date>limits.max)throw fail('error.validation');await owner();return result(await supabase.rpc('get_proposal_slots',{p_appointment_id:id,p_date:date}))||[];}
export async function validatePhoto(file){if(!file||!config.photoTypes.includes(file.type)||file.size<=0||file.size>config.maxPhotoBytes)throw new FormError({photo:t('error.photo')});
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());const matches=file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:file.type==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!matches)throw new FormError({photo:t('error.photo')});return file;
}
function storedPath(url,userId){try{const value=new URL(url);const base=new URL(config.supabaseUrl);const prefix=`/storage/v1/object/public/${config.storageBucket}/`;if(value.origin!==base.origin||!value.pathname.startsWith(prefix))return null;const path=decodeURIComponent(value.pathname.slice(prefix.length));return path.startsWith(`${userId}/`)&&!path.includes('..')?path:null;}catch{return null;}}
export async function uploadPhoto(file){const context=await owner();const current=await shop();await validatePhoto(file);const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];const path=`${context.user.id}/${crypto.randomUUID()}.${extension}`;const bucket=supabase.storage.from(config.storageBucket);
  result(await bucket.upload(path,file,{upsert:false,contentType:file.type,cacheControl:'3600'}));const url=bucket.getPublicUrl(path).data.publicUrl;
  try{const saved=result(await supabase.from('barbers').update({photo_url:url}).eq('id',current.id).eq('owner_id',context.user.id).select('id,photo_url').maybeSingle());if(!saved)throw fail('error.recordChanged');}
  catch(error){try{await bucket.remove([path]);}catch{}throw error;}
  const previous=storedPath(current.photo_url,context.user.id);if(previous)await bucket.remove([previous]);return url;
}
export async function removePhoto(){const context=await owner();const current=await shop();const value=result(await supabase.from('barbers').update({photo_url:null}).eq('id',current.id).eq('owner_id',context.user.id).select('id').maybeSingle());if(!value)throw fail('error.recordChanged');const path=storedPath(current.photo_url,context.user.id);if(path)result(await supabase.storage.from(config.storageBucket).remove([path]));}
