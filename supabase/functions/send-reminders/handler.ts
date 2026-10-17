export type Store={rpc(name:string):PromiseLike<{data:any;error:any}>};
async function sameSecret(a:string,b:string){const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const x=await digest(a),y=await digest(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
export function createHandler(store:Store){
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  const supplied=request.headers.get('x-reminder-secret');if(!supplied||supplied.length>256)return new Response(null,{status:403});
  try{const config=await store.rpc('reminder_dispatch_config');if(config.error)throw Error();
   if(!config.data?.secret||!await sameSecret(supplied,config.data.secret))return new Response(null,{status:403});
   if(request.headers.get('x-reminder-check')==='1')return Response.json({ready:true},{headers:{'Cache-Control':'no-store'}});
   const result=await store.rpc('produce_reminders');if(result.error)throw Error();
   return Response.json({notifications:Number(result.data?.notifications)||0},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Hatırlatmalar hazırlanamadı.'},{status:500,headers:{'Cache-Control':'no-store'}});}
 };
}
