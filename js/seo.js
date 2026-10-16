import {config,pageUrl} from './config.js';
import {t} from './i18n.js';
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function meta(name,content,property=false){const attr=property?'property':'name';let node=document.head.querySelector(`meta[${attr}="${name}"]`);if(!node){node=document.createElement('meta');node.setAttribute(attr,name);document.head.append(node);}node.content=content;}
export function barberSeo(shop,{demo=false}={}){
 document.getElementById('barber-structured-data')?.remove();
 if(demo||!shop||!shop.is_active||shop.verification_status!=='approved'){meta('robots','noindex,follow');return;}
 document.head.querySelector('meta[name="robots"]')?.remove();const canonical=shop.slug?new URL('/b/'+shop.slug,config.appUrl).href:pageUrl('barber',{id:shop.id});
 const title=shop.shop_name+' | BERBER',description=`${shop.shop_name} · ${shop.district}, ${shop.city}. ${t('seo.description')}`;
 document.title=title;meta('description',description);let link=document.head.querySelector('link[rel="canonical"]');if(!link){link=document.createElement('link');link.rel='canonical';document.head.append(link);}link.href=canonical;
 let image=new URL('/assets/berber-logo.png',config.appUrl).href;try{const u=new URL(shop.photo_url);if(u.protocol==='https:'&&u.origin===new URL(config.supabaseUrl).origin&&!u.username&&!u.password&&u.pathname.startsWith('/storage/v1/object/public/'))image=u.href;}catch{}
 for(const [name,value]of[['og:type','website'],['og:site_name','BERBER'],['og:title',title],['og:description',description],['og:url',canonical],['og:image',image],['og:image:alt',shop.shop_name]])meta(name,value,true);meta('twitter:card','summary_large_image');
 const data={'@context':'https://schema.org','@type':'HairSalon','@id':canonical+'#dukkan',name:shop.shop_name,url:canonical,image,telephone:shop.phone,address:{'@type':'PostalAddress',streetAddress:shop.address,addressLocality:shop.city,addressRegion:'KKTC',addressCountry:'CY'}};
 if(Number(shop.review_count)>0&&Number(shop.avg_rating)>=1&&Number(shop.avg_rating)<=5)data.aggregateRating={'@type':'AggregateRating',ratingValue:Number(shop.avg_rating),reviewCount:Number(shop.review_count),bestRating:5,worstRating:1};
 const spec=[];for(const row of shop.hours||[]){if(row.is_closed||!days[row.weekday]||!row.open_time||!row.close_time)continue;for(const [opens,closes]of(row.break_start&&row.break_end?[[row.open_time,row.break_start],[row.break_end,row.close_time]]:[[row.open_time,row.close_time]]))if(opens<closes)spec.push({'@type':'OpeningHoursSpecification',dayOfWeek:'https://schema.org/'+days[row.weekday],opens:opens.slice(0,5),closes:closes.slice(0,5)});}if(spec.length)data.openingHoursSpecification=spec;
 if(shop.lat!==null&&shop.lat!==undefined&&shop.lng!==null&&shop.lng!==undefined&&Number.isFinite(Number(shop.lat))&&Number.isFinite(Number(shop.lng)))data.geo={'@type':'GeoCoordinates',latitude:Number(shop.lat),longitude:Number(shop.lng)};
 const script=document.createElement('script');script.type='application/ld+json';script.id='barber-structured-data';script.textContent=JSON.stringify(data).replace(/</g,'\\u003c');document.head.append(script);
}
