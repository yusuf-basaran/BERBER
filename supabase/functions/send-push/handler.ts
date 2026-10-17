// Cihaz adresleri, anahtarlar ve bildirim içerikleri yanıta veya loga yazılmaz.
export type Store={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:any;error:any}>};
export type PushCrypto={generateVAPIDKeys():{publicKey:string;privateKey:string};generateRequestDetails(subscription:unknown,payload:string,options:unknown):{endpoint:string;headers:Record<string,string|number>;body:Uint8Array}};
export function allowedEndpoint(value:string):boolean{
 try{const u=new URL(value);return value.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&/^(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)+push\.apple\.com|(?:[a-z0-9-]+\.)+notify\.windows\.com)$/.test(u.hostname);}catch{return false;}
}
async function sameSecret(a:string,b:string){const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const x=await hash(a),y=await hash(b);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;}
export function createHandler(store:Store,push:PushCrypto,send:typeof fetch=fetch){
 const rpc=async(name:string,args?:Record<string,unknown>)=>{const r=await store.rpc(name,args);if(r.error)throw Error('Database operation failed');return r.data;};
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  if(Number(request.headers.get('content-length')||0)>4096)return new Response(null,{status:413});
  try{
   const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
   if(reader)while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>4096){await reader.cancel();return new Response(null,{status:413});}chunks.push(part.value);}
   const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}const raw=new TextDecoder().decode(bytes);let body;try{body=JSON.parse(raw);}catch{return new Response(null,{status:400});}
   if(typeof body?.secret!=='string'||body.secret.length>256)return new Response(null,{status:403});
   let config=await rpc('push_dispatch_config');if(!config?.secret||!await sameSecret(body.secret,config.secret))return new Response(null,{status:403});
   if(!config.publicKey||!config.privateKey){const pair=push.generateVAPIDKeys();await rpc('setup_push_vapid',{p_public:pair.publicKey,p_private:pair.privateKey});config=await rpc('push_dispatch_config');}
   if(!config.publicKey||!config.privateKey)return new Response(null,{status:503});
   const jobs=await rpc('claim_push',{p_limit:25});let sent=0,failed=0;
   for(let offset=0;offset<jobs.length;offset+=4){await Promise.all(jobs.slice(offset,offset+4).map(async(job:any)=>{
    let status=0,retry:number|null=null;
    try{if(!await rpc('push_job_valid',{p_id:job.id,p_token:job.token}))return;
     if(!allowedEndpoint(job.endpoint)){status=410;}
     else{const details=push.generateRequestDetails({endpoint:job.endpoint,keys:job.keys},JSON.stringify({v:1}),{vapidDetails:{subject:'https://berber-1.vercel.app',publicKey:config.publicKey,privateKey:config.privateKey},TTL:Math.max(1,Math.min(300,Number(job.ttl)||300)),urgency:'normal',contentEncoding:'aes128gcm',topic:'berber-inbox'});
      const headers=new Headers();for(const [name,value]of Object.entries(details.headers))if(name.toLowerCase()!=='content-length')headers.set(name,String(value));
      const response=await send(job.endpoint,{method:'POST',headers,body:new Uint8Array(details.body),redirect:'manual',signal:AbortSignal.timeout(5000)});status=response.status;
      const delay=Number(response.headers.get('retry-after'));if(Number.isFinite(delay)&&delay>0)retry=Math.max(30,Math.min(1800,Math.round(delay)));await response.body?.cancel();
     }
    }catch{status=0;}
    await rpc('finish_push',{p_id:job.id,p_token:job.token,p_status:status,p_retry_after:retry});if(status>=200&&status<300)sent++;else failed++;
   }));}
   return Response.json({sent,failed},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Bildirim gönderimi tamamlanamadı.'},{status:500,headers:{'Cache-Control':'no-store'}});}
 };
}
