import {supabase} from './supabase.js';
import {auth} from './auth.js';
import {validatePhoto} from './panel.js';
import {config} from './config.js';
import {isUuid} from './slots.js';
import {t} from './i18n.js';
const bucketName='barber-gallery',fields='id,barber_id,path,caption,sort_order,created_at,ready,deleted_at,thumbnail_path,thumbnail_ready';
const result=value=>{if(value.error)throw value.error;return value.data;};
const fail=key=>{const error=new Error(t(key));error.userMessage=t(key);return error;};
const valid=id=>{if(!isUuid(id))throw fail('error.validation');};
async function owner(shopId){valid(shopId);const context=await auth.getContext();if(context.status!=='ready'||context.profile.role!=='barber')throw fail('error.barberOnly');const shop=result(await supabase.from('barbers').select('id,owner_id').eq('id',shopId).eq('owner_id',context.user.id).maybeSingle());if(!shop)throw fail('error.recordChanged');return context;}
export function photoUrl(photo,{thumbnail=false}={}){return supabase.storage.from(bucketName).getPublicUrl(thumbnail&&photo.thumbnail_ready?photo.thumbnail_path:photo.path).data.publicUrl;}
export function photoAlt(photo,shop,index){return photo.caption.trim()||t('gallery.alt',{shop:shop.shop_name,count:index+1});}
export async function getGallery(shopId,{manage=false}={}){valid(shopId);if(manage)await owner(shopId);let request=supabase.from('barber_photos').select(fields).eq('barber_id',shopId);if(!manage)request=request.eq('ready',true).is('deleted_at',null);return result(await request.order('sort_order').order('created_at').order('id').limit(12))||[];}
export async function compressPhoto(file,maxSize=1600){
  await validatePhoto(file);const url=URL.createObjectURL(file);let image;
  try{image=await new Promise((resolve,reject)=>{const node=new Image();node.onload=()=>resolve(node);node.onerror=()=>reject(fail('error.photo'));node.src=url;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>80000000)throw fail('error.photo');
    const ratio=Math.min(1,maxSize/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));const context=canvas.getContext('2d');if(!context)throw fail('error.photo');context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.82));canvas.width=1;canvas.height=1;
    if(!blob||!config.photoTypes.includes(blob.type)||blob.size>config.maxPhotoBytes)throw fail('error.photo');return blob;
  }finally{URL.revokeObjectURL(url);}
}
export async function uploadGalleryPhoto(shopId,file){
  await owner(shopId);const blob=await compressPhoto(file),extension={'image/webp':'webp','image/png':'png','image/jpeg':'jpg'}[blob.type],path=`${shopId}/${crypto.randomUUID()}.${extension}`;
  const thumbnail=await compressPhoto(file,480);
  const row=result(await supabase.from('barber_photos').insert({barber_id:shopId,path,sort_order:10000}).select(fields).single());const bucket=supabase.storage.from(bucketName);
  try{result(await bucket.upload(path,blob,{upsert:false,contentType:blob.type,cacheControl:'3600'}));result(await bucket.upload(row.thumbnail_path,thumbnail,{upsert:false,contentType:thumbnail.type,cacheControl:'3600'}));return result(await supabase.from('barber_photos').update({ready:true,thumbnail_ready:true}).eq('id',row.id).eq('barber_id',shopId).select(fields).single());}
  catch(error){try{await deleteGalleryPhoto(shopId,row);}catch{throw fail('gallery.uploadCleanup');}if(error.code==='P2003')throw fail('gallery.limit');throw error;}
}
export async function deleteGalleryPhoto(shopId,row){
  await owner(shopId);valid(row.id);if(row.barber_id!==shopId)throw fail('error.validation');
  if(!row.deleted_at)result(await supabase.from('barber_photos').update({deleted_at:new Date().toISOString()}).eq('barber_id',shopId).eq('id',row.id).select('id').single());
  result(await supabase.storage.from(bucketName).remove([row.path,row.thumbnail_path||row.path.replace(/\.[^.]+$/,'-thumb.webp')]));
  result(await supabase.from('barber_photos').delete().eq('barber_id',shopId).eq('id',row.id).select('id').single());
}
export async function saveCaption(shopId,id,caption){await owner(shopId);valid(id);caption=String(caption).trim();if(caption.length>200)throw fail('error.validation');result(await supabase.from('barber_photos').update({caption}).eq('barber_id',shopId).eq('id',id).select('id').single());}
export async function reorderGallery(shopId,ids){await owner(shopId);if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length)throw fail('error.validation');ids.forEach(valid);result(await supabase.rpc('reorder_gallery',{p_barber_id:shopId,p_ids:ids}));}
export async function setGalleryCover(shopId,row){const context=await owner(shopId);if(!row.ready||row.deleted_at||row.barber_id!==shopId)throw fail('error.validation');const url=photoUrl(row);result(await supabase.from('barbers').update({photo_url:url}).eq('id',shopId).eq('owner_id',context.user.id).select('id').single());return url;}
