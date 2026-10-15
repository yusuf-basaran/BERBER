import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async request=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  try{
    const body=await request.json();
    const config=await client.rpc('application_cleanup_secret');
    if(config.error||!config.data||typeof body.secret!=='string')return new Response(null,{status:403});
    const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
    const a=await digest(body.secret),b=await digest(config.data);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
    if(diff)return new Response(null,{status:403});
    const due=await client.rpc('claim_expired_documents');if(due.error)throw due.error;
    let removed=0;
    for(const row of due.data||[]){const result=await client.storage.from('basvuru-belgeleri').remove([row.path]);if(result.error)continue;
      const deleted=await client.from('application_documents').delete().eq('id',row.id).not('deleted_at','is',null);if(!deleted.error)removed++;
    }
    return Response.json({removed,pending:(due.data||[]).length-removed});
  }catch{return Response.json({error:'Temizlik tamamlanamadı.'},{status:500});}
});
