import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: config.sessionStorageKey
  },
  db: { schema: 'public' }
});
