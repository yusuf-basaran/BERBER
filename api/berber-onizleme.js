import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import seo from '../lib/seo.cjs';
export async function GET(request){
 const root=process.cwd(),url=new URL(request.url),slugs=url.searchParams.getAll('slug'),slug=slugs.length?slugs[0]:url.pathname.match(/^\/b\/([a-z0-9-]{3,40})\/?$/)?.[1];
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{
  if(!seo.slugPattern.test(slug||'')||slugs.length>1)return new Response(await readFile(path.join(root,'404.html'),'utf8'),{status:404,headers:{...headers,'X-Robots-Tag':'noindex'}});
  const config=await seo.publicConfig(root),rows=await seo.publicRows(config,'barbers',{select:seo.publicShopFields,slug:'eq.'+slug,verification_status:'eq.approved',is_active:'eq.true'},{limit:1,timeout:3500});
  const shop=rows[0];if(!shop||!seo.approved(shop))return new Response(await readFile(path.join(root,'404.html'),'utf8'),{status:404,headers:{...headers,'X-Robots-Tag':'noindex'}});
  const hours=await seo.publicRows(config,'working_hours',{select:'weekday,open_time,close_time,break_start,break_end,is_closed',barber_id:'eq.'+shop.id,order:'weekday'},{limit:7,timeout:3500});
  const html=seo.injectMetadata(await readFile(path.join(root,'berber.html'),'utf8'),shop,hours,config);
  headers['Cache-Control']='public, max-age=0, must-revalidate';headers['Vercel-CDN-Cache-Control']='public, s-maxage=300, stale-while-revalidate=60';headers.ETag='"'+createHash('sha256').update(html).digest('hex')+'"';
  if(request.headers.get('if-none-match')===headers.ETag)return new Response(null,{status:304,headers});
  return new Response(html,{status:200,headers});
 }catch{
  console.error('Dükkan önizlemesi okunamadı.');
  return new Response(await readFile(path.join(root,'berber.html'),'utf8'),{status:200,headers:{...headers,'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
 }
}
export async function HEAD(request){const response=await GET(request);return new Response(null,{status:response.status,headers:response.headers});}
