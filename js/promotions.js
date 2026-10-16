import {supabase} from './supabase.js';
import {isUuid} from './slots.js';
import {FormError} from './auth.js';
import {t} from './i18n.js';
import {element as el,formatMoney} from './ui.js';
const fields='id,barber_id,title,discount_percent,discount_amount,currency,service_id,weekdays,time_from,time_to,valid_from,valid_until,is_active';
const result=r=>{if(r.error)throw r.error;return r.data||[];};
export function validatePromotion(v){
 const errors={},amount=Number(v.discount),type=v.discountType;
 const date=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
 const clock=x=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x||'')||x==='24:00';
 if(typeof v.title!=='string'||v.title.trim().length<2||v.title.trim().length>80)errors.title=t('promotion.invalidTitle');
 if(!['percent','amount'].includes(type)||!Number.isFinite(amount)||amount<0.01||amount>(type==='percent'?100:99999999.99)||Math.abs(amount*100-Math.round(amount*100))>0.00001)errors.discount=t('promotion.invalidDiscount');
 if(type==='amount'&&!['TRY','GBP','EUR'].includes(v.currency))errors.currency=t('error.validation');
 if(v.serviceId&&!isUuid(v.serviceId))errors.serviceId=t('error.validation');
 if(!Array.isArray(v.weekdays)||!v.weekdays.length||v.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))errors.weekdays=t('promotion.invalidDays');
 if(!date(v.validFrom)||!date(v.validUntil)||v.validUntil<v.validFrom||(Date.parse(v.validUntil)-Date.parse(v.validFrom))/86400000>366)errors.validUntil=t('promotion.invalidDates');
 if(!clock(v.timeFrom)||!clock(v.timeTo)||v.timeFrom==='24:00'||v.timeTo<=v.timeFrom)errors.timeTo=t('promotion.invalidTimes');
 if(Object.keys(errors).length)throw new FormError(errors);
 return {title:v.title.trim(),discount_percent:type==='percent'?amount:null,discount_amount:type==='amount'?amount:null,currency:type==='amount'?v.currency:null,service_id:v.serviceId||null,weekdays:[...new Set(v.weekdays)],time_from:v.timeFrom,time_to:v.timeTo,valid_from:v.validFrom,valid_until:v.validUntil,is_active:Boolean(v.isActive)};
}
export async function getPromotions(barberId){return result(await supabase.from('promotions').select(fields).eq('barber_id',barberId).order('valid_until',{ascending:false}).limit(20));}
export async function savePromotion(barberId,values,id=null){const data=validatePromotion(values);const request=id?supabase.from('promotions').update(data).eq('id',id).eq('barber_id',barberId):supabase.from('promotions').insert({...data,barber_id:barberId});const saved=result(await request.select('id').maybeSingle());if(!saved?.id)throw new Error(t('error.recordChanged'));return saved;}
export async function removePromotion(barberId,id){const saved=result(await supabase.from('promotions').delete().eq('id',id).eq('barber_id',barberId).select('id').maybeSingle());if(!saved?.id)throw new Error(t('error.recordChanged'));}
export async function promotionPrices(barberId,startAt){return result(await supabase.rpc('get_promotion_prices',{p_barber_id:barberId,...(startAt?{p_start_at:startAt}:{})}));}
export async function promotionCards(rows,currency){if(!rows.length)return [];return result(await supabase.rpc('get_promotion_cards',{p_barber_ids:rows.map(r=>r.id),p_currency:currency}));}
export function promotionPrice(quote,{hint=false}={}){
 const node=el('div',{className:'promotion-price'});
 node.append(el('span',{text:t('promotion.badge'),className:'status-badge status-badge--completed'}),el('del',{text:formatMoney(quote.base_price,quote.currency),attrs:{'aria-label':t('promotion.oldPrice')}}),el('strong',{text:formatMoney(quote.price,quote.currency),attrs:{'aria-label':t('promotion.newPrice')}}));
 if(quote.promotion_title)node.append(el('span',{text:quote.promotion_title}));
 if(hint)node.append(el('small',{text:t('promotion.previewHint'),className:'field-hint'}));return node;
}
export function promotionSnapshot(row){return Number(row.discount_at_booking)>0?el('p',{text:t('promotion.applied',{title:row.promotion_title_at_booking,amount:formatMoney(row.discount_at_booking,row.currency_at_booking)}),className:'notice'}):null;}
