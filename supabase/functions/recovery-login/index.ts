import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createRuntime } from './runtime.ts';

Deno.serve(createRuntime({
  url: Deno.env.get('SUPABASE_URL') || '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  pepper: Deno.env.get('RECOVERY_PEPPER') || '',
  origins: (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value=>value.trim()).filter(Boolean)
},createClient));
