import { supabase } from './supabase.js';
import { auth } from './auth.js';
import { isUuid } from './slots.js';
import { t } from './i18n.js';
const fields='id,type,title,body,appointment_id,is_read,created_at';
let subscriptionSequence=0;
const fail=key=>{const error=new Error(t(key));error.userMessage=t(key);return error;};
async function ready(){const context=await auth.getContext();if(context.status!=='ready')throw fail(context.status==='mfa_required'?'error.mfaRequired':'auth.loginRequired');return context;}
export async function getNotifications({page=1,unreadOnly=false,signal}={}){
  if(!Number.isInteger(page)||page<1||page>1000||typeof unreadOnly!=='boolean')throw fail('error.validation');
  const context=await ready();let query=supabase.from('notifications').select(fields,{count:'exact'}).eq('user_id',context.user.id);
  if(unreadOnly)query=query.eq('is_read',false);query=query.order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*20,page*20-1);if(signal)query=query.abortSignal(signal);
  const result=await query;if(result.error)throw result.error;return {rows:result.data||[],total:result.count||0};
}
export async function getUnreadCount({signal}={}){const context=await ready();let query=supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',context.user.id).eq('is_read',false);if(signal)query=query.abortSignal(signal);const result=await query;if(result.error)throw result.error;return result.count||0;}
export async function markRead(id){if(!isUuid(id))throw fail('error.validation');const context=await ready();const result=await supabase.from('notifications').update({is_read:true}).eq('id',id).eq('user_id',context.user.id).eq('is_read',false);if(result.error)throw result.error;}
export async function markAllRead(through){if(typeof through!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(through)||!Number.isFinite(Date.parse(through)))throw fail('error.validation');const context=await ready();const result=await supabase.from('notifications').update({is_read:true}).eq('user_id',context.user.id).eq('is_read',false).lte('created_at',through);if(result.error)throw result.error;}
export function subscribeNotifications(context,{onEvent=()=>{},onStatus=()=>{}}={}){
  if(context?.status!=='ready'||!context.user?.id)return ()=>{};
  let stopped=false;const id=context.user.id;const seen=new Set();
  const changed=payload=>{if(stopped||payload.new?.user_id!==id||!isUuid(payload.new.id))return;const fresh=payload.eventType==='INSERT'&&!seen.has(payload.new.id);if(payload.eventType==='INSERT'){seen.add(payload.new.id);if(seen.size>200)seen.delete(seen.values().next().value);}onEvent({fresh,row:payload.new,type:payload.eventType});};
  const channel=supabase.channel(`notifications-${id}-${++subscriptionSequence}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${id}`},changed).on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:`user_id=eq.${id}`},changed).subscribe(status=>{if(!stopped)onStatus(status);});
  return ()=>{if(stopped)return;stopped=true;void supabase.removeChannel(channel).catch(()=>{});};
}
