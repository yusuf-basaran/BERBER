import { supabase } from './supabase.js';
import { auth,FormError } from './auth.js';
import { isUuid } from './slots.js';
import { t } from './i18n.js';
import { element,formatDateTime } from './ui.js';
const fields='id,appointment_id,barber_id,rating,comment,created_at';
const fail=key=>{const error=new Error(t(key));error.userMessage=t(key);return error;};
async function customer(){const context=await auth.getContext();if(context.status!=='ready')throw fail(context.status==='mfa_required'?'error.mfaRequired':'auth.loginRequired');if(context.profile.role!=='customer')throw fail('error.customerOnly');return context;}
export function validateReview({rating,comment=''}){const errors={};const valid=(typeof rating==='number'&&Number.isInteger(rating))||(typeof rating==='string'&&/^[1-5]$/.test(rating));const number=Number(rating);if(!valid||number<1||number>5)errors.rating=t('error.reviewRating');if(typeof comment!=='string'||comment.length>1500)errors.comment=t('error.reviewComment');if(Object.keys(errors).length)throw new FormError(errors);return {rating:number,comment:comment.trim()};}
export async function getAppointmentReviews(ids){if(!Array.isArray(ids)||ids.length>12||ids.some(id=>!isUuid(id)))throw fail('error.validation');if(!ids.length)return [];await customer();const {data,error}=await supabase.from('reviews').select(fields).in('appointment_id',[...new Set(ids)]);if(error)throw error;return data||[];}
export async function submitReview(appointmentId,values){if(!isUuid(appointmentId))throw fail('error.validation');const input=validateReview(values);const context=await customer();
  const booking=await supabase.from('appointments').select('id,status').eq('id',appointmentId).eq('customer_id',context.user.id).maybeSingle();if(booking.error)throw booking.error;if(!booking.data||booking.data.status!=='completed')throw fail('error.reviewEligibility');
  const {data,error}=await supabase.from('reviews').insert({appointment_id:appointmentId,...input}).select(fields).single();if(error){if(error.code==='23505'){const duplicate=fail('error.reviewDuplicate');duplicate.code=error.code;throw duplicate;}throw error;}return data;
}
export function ratingStars(rating){const number=Number(rating);const count=Number.isInteger(number)&&number>=1&&number<=5?number:0;return element('span',{text:'★'.repeat(count)+'☆'.repeat(5-count),className:'review-stars',attrs:{role:'img','aria-label':t('review.stars',{count})}});}
export function reviewCard(review,{mine=false}={}){const card=element('article',{className:'review-card',attrs:{'data-review-id':review.id}},[element('strong',{text:t(mine?'review.yours':'review.anonymous')}),ratingStars(review.rating)]);if(review.comment)card.append(element('p',{text:review.comment}));card.append(element('time',{text:formatDateTime(review.created_at,{timeStyle:undefined}),attrs:{datetime:review.created_at}}));return card;}
