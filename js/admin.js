import {supabase} from './supabase.js';
import {auth} from './auth.js';
import {isUuid} from './slots.js';
import {t} from './i18n.js';
const result=value=>{if(value.error)throw value.error;return value.data;};
export async function isAdmin(){const context=await auth.getContext();if(context.status!=='ready')return false;return result(await supabase.rpc('is_admin'))===true;}
export async function applications(status='pending',search='',page=1){return result(await supabase.rpc('admin_applications',{p_status:status,p_search:String(search).trim(),p_page:page}));}
export async function application(id){if(!isUuid(id))throw new Error(t('error.validation'));return result(await supabase.rpc('admin_application',{p_barber_id:id}));}
export async function saveReview(row,checklist,note){return result(await supabase.rpc('admin_review_save',{p_barber_id:row.id,p_checklist:checklist,p_note:note.trim(),p_revision:row.application_revision}));}
export async function decide(row,decision,reason=''){return result(await supabase.rpc('basvuru_karar',{p_barber_id:row.id,p_karar:decision,p_sebep:reason.trim()}));}
