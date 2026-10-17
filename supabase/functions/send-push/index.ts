import {createClient} from '@supabase/supabase-js';
import {createHandler,type PushCrypto} from './handler.ts';
// Şifreleme kütüphanesinin anahtar izleme seçeneği kapalı kalır.
Deno.env.delete('ECE_KEYLOG');
const {default:webpush}=await import('web-push');
const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createHandler(client,webpush as PushCrypto));
