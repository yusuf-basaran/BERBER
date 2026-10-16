import {supabase} from './supabase.js';
import {auth} from './auth.js';
import {isUuid} from './slots.js';
import {t} from './i18n.js';
async function user(){const context=await auth.getContext();if(context.status!=='ready'){const error=new Error(t('auth.loginRequired'));error.userMessage=t('auth.loginRequired');throw error;}return context.user.id;}
function result(response){if(response.error)throw response.error;return response;}
export async function favoriteIds(ids){
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!isUuid(id)))throw new RangeError(t('error.validation'));
  if(!ids.length)return new Set();const id=await user();
  const {data}=result(await supabase.from('favorites').select('barber_id').eq('user_id',id).in('barber_id',[...new Set(ids)]));
  return new Set((data||[]).map(row=>row.barber_id));
}
export async function setFavorite(barberId,selected){
  if(!isUuid(barberId)||typeof selected!=='boolean')throw new RangeError(t('error.validation'));const id=await user();
  if(selected){const response=await supabase.from('favorites').insert({user_id:id,barber_id:barberId});if(response.error?.code!=='23505')result(response);}
  else result(await supabase.from('favorites').delete().eq('user_id',id).eq('barber_id',barberId));
}
export async function getFavorites(page=1){
  if(!Number.isInteger(page)||page<1||page>1000)throw new RangeError(t('error.validation'));const id=await user();
  const {data,count}=result(await supabase.from('favorites').select('barber_id,created_at,barber:barbers(id,shop_name,city,district,photo_url,photo_thumbnail_url,avg_rating,review_count,is_active)',{count:'exact'})
    .eq('user_id',id).order('created_at',{ascending:false}).order('barber_id').range((page-1)*12,page*12-1));
  return {rows:(data||[]).filter(row=>row.barber).map(row=>row.barber),total:count||0};
}
