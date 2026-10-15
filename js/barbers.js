import { supabase } from './supabase.js';
import { demoLocations, demoBarbers } from './demo.js';
import { t } from './i18n.js';
import { isUuid } from './slots.js';
const fields='id,shop_name,city,district,address,map_url,phone,whatsapp,bio,photo_url,avg_rating,review_count,is_active,cancel_hours_before';
const result=value=>{if(value.error)throw value.error;return value.data;};
export const categories=Object.freeze([
  ['Saç Kesimi','category.hair'],['Sakal','category.beard'],['Saç + Sakal','category.hairBeard'],['Cilt Bakımı','category.skin'],
  ['Damat Traşı','category.groom'],['Çocuk Traşı','category.child'],['Fön','category.blowDry'],['Boya','category.color']
]);
export function searchParams(values) {
  const query=String(values.query||'').trim();const rating=Number(values.rating||0);const min=Number(values.minPrice||0);
  const max=values.maxPrice===''||values.maxPrice===null||values.maxPrice===undefined?null:Number(values.maxPrice);
  const currency=values.currency||'TRY';const sort=values.sort||'rating';const page=Number(values.page||1);
  if(query.length>120||!Number.isFinite(rating)||rating<0||rating>5||!Number.isFinite(min)||min<0||
    (max!==null&&(!Number.isFinite(max)||max<min))||!['TRY','GBP','EUR'].includes(currency)||!['rating','price'].includes(sort)||!Number.isInteger(page)||page<1||page>1000){const error=new RangeError(t('error.searchFilters'));error.userMessage=t('error.searchFilters');throw error;}
  return {p_query:query,p_city:String(values.city||''),p_district:String(values.district||''),p_rating:rating,p_min_price:min,p_max_price:max,p_currency:currency,p_category:String(values.category||''),p_sort:sort,p_page:page};
}
export async function getLocations({demo=false}={}) {
  if(demo)return demoLocations;
  return result(await supabase.from('locations').select('city,district').order('city').order('district'));
}
export async function searchBarbers(values,{demo=false,signal}={}) {
  const params=searchParams(values);
  if(demo){
    const norm=value=>value.toLocaleLowerCase('tr-TR').replace(/ı/g,'i');
    const rows=demoBarbers.filter(b=>(!params.p_city||b.city===params.p_city)&&(!params.p_district||b.district===params.p_district)&&b.avg_rating>=params.p_rating&&norm(`${b.shop_name} ${b.city} ${b.district}`).includes(norm(params.p_query)))
      .flatMap(b=>{const services=b.services.filter(s=>s.currency===params.p_currency&&(!params.p_category||s.category===params.p_category)&&s.price>=params.p_min_price&&(params.p_max_price===null||s.price<=params.p_max_price));return services.length?[{...b,starting_price:Math.min(...services.map(s=>s.price)),currency:params.p_currency}]:[];});
    rows.sort((a,b)=>params.p_sort==='price'?a.starting_price-b.starting_price:b.avg_rating-a.avg_rating||b.review_count-a.review_count);
    return {rows:rows.slice((params.p_page-1)*12,params.p_page*12),total:rows.length};
  }
  let request=supabase.rpc('search_barbers',params);if(signal)request=request.abortSignal(signal);
  const rows=result(await request)||[];return {rows,total:Number(rows[0]?.total_count||0)};
}
export async function getBarber(id,{demo=false}={}) {
  if(!isUuid(id))return null;
  if(demo)return demoBarbers.find(b=>b.id===id)||null;
  const barber=result(await supabase.from('barbers').select(fields).eq('id',id).maybeSingle());
  if(!barber)return null;
  const values=await Promise.all([
    supabase.from('services').select('id,barber_id,name,category,price,currency,duration_min,is_active').eq('barber_id',id).eq('is_active',true).order('price'),
    supabase.from('working_hours').select('weekday,open_time,close_time,break_start,break_end,is_closed').eq('barber_id',id).order('weekday')
  ]);
  return {...barber,services:result(values[0])||[],hours:result(values[1])||[]};
}
export async function getPublicReviews(id,page=1,{demo=false}={}) {
  if(!isUuid(id)||!Number.isInteger(page)||page<1||page>1000)throw new RangeError(t('error.validation'));
  if(demo){const reviews=demoBarbers.find(barber=>barber.id===id)?.reviews||[];return {rows:reviews.slice((page-1)*10,page*10),total:reviews.length};}
  const value=await supabase.from('reviews').select('id,appointment_id,barber_id,rating,comment,created_at',{count:'exact'}).eq('barber_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*10,page*10-1);
  return {rows:result(value)||[],total:value.count||0};
}
