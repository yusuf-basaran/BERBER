import { createHandler } from './handler.ts';

// Ayarlar yalnızca Edge belleğinde tutulur; RPC sunucu rolüne açıktır.
export function createRuntime(settings, makeClient, now = Date.now) {
  let cached = null;
  let expires = 0;
  let pending = null;
  const configured = settings.pepper && settings.origins?.length;
  const fallback = createHandler(settings, makeClient);
  async function load() {
    if (configured) return fallback;
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const admin = makeClient(settings.url, settings.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data, error } = await admin.rpc('get_recovery_config');
      if (error || typeof data?.pepper !== 'string' || data.pepper.length < 32 ||
          !Array.isArray(data.origins) || !data.origins.length ||
          !data.origins.every(origin => {
            try { const url = new URL(origin); return url.protocol === 'https:' && url.origin === origin; }
            catch { return false; }
          })) throw new Error('Recovery configuration unavailable');
      cached = createHandler({ ...settings, pepper: settings.pepper || data.pepper,
        origins: settings.origins?.length ? settings.origins : data.origins }, makeClient);
      expires = now() + 60000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  }
  return async request => {
    try { return await (await load())(request); }
    catch {
      return new Response(JSON.stringify({ code: 'not_configured' }), {
        status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  };
}
