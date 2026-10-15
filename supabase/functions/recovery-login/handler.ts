type Client = any;
type Settings = { url: string; anonKey: string; serviceKey: string; pepper: string; origins: string[] };
type MakeClient = (url: string, key: string, options?: Record<string, unknown>) => Client;
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function normalizeCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[ -]/g,'') : '';
}
export function generateCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    codes.add(Array.from(bytes, byte => alphabet[byte & 31]).join(''));
  }
  return [...codes];
}
export async function hashCode(userId: string, code: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}:${userId}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}
function result<T = any>(value: {data: T; error: unknown}): T { if (value.error) throw value.error; return value.data; }
export function createHandler(settings: Settings, makeClient: MakeClient) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    const allowed = origin !== null && settings.origins.includes(origin);
    const headers: Record<string,string> = { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Origin' };
    if (allowed) Object.assign(headers, { 'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' });
    const reply = (status: number, code: string, extra: Record<string,unknown> = {}) => new Response(JSON.stringify({code,...extra}), {status,headers});
    if (origin !== null && !allowed) return reply(403,'forbidden_origin');
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (req.method !== 'POST') return reply(405,'method_not_allowed');
    if (!settings.url || !settings.anonKey || !settings.serviceKey || settings.pepper.length < 32 || !settings.origins.length) return reply(503,'not_configured');
    const token = req.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
    if (!token) return reply(401,'unauthorized');
    if (!req.headers.get('Content-Type')?.startsWith('application/json')) return reply(415,'invalid_body');
    let input: Record<string,unknown>;
    try {
      const body = await req.text();
      if (body.length > 4096) return reply(413,'invalid_body');
      input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400,'invalid_body');
    } catch { return reply(400,'invalid_body'); }
    let user: any;
    let claims: any;
    try {
      const client = makeClient(settings.url,settings.anonKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
      user = result(await client.auth.getUser(token)).user;
      claims = result(await client.auth.getClaims(token)).claims;
      if (!user?.id || user.is_anonymous || !user.email_confirmed_at || claims.sub !== user.id || !claims.session_id) return reply(401,'unauthorized');
    } catch { return reply(401,'unauthorized'); }
    const admin = makeClient(settings.url,settings.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const call = async (name: string, args: Record<string,unknown>) => result(await admin.rpc(name,args));
    const userId = user.id;
    const action = input.action;
    if (!['status','generate','revoke','recover'].includes(String(action))) return reply(400,'invalid_action');
    try {
      if (!await call('recovery_session_ok',{p_user_id:userId,p_session_id:claims.session_id,p_allow_pending:action === 'recover'})) return reply(401,'unauthorized');
    } catch { return reply(503,'retry_later'); }
    if (action === 'status' || action === 'generate' || action === 'revoke') {
      if (claims.aal !== 'aal2') return reply(403,'mfa_required');
      const fresh = Array.isArray(claims.amr) && claims.amr.some((entry: any) => entry.method === 'totp' && Number(entry.timestamp) >= Math.floor(Date.now()/1000)-120 && Number(entry.timestamp) <= Math.floor(Date.now()/1000)+10);
      if (action !== 'status' && !fresh) return reply(403,'reauth_required');
      try {
        if (action === 'status') return reply(200,'ok',{remaining:await call('recovery_status',{p_user_id:userId})});
        if (action === 'revoke') { await call('revoke_recovery_codes',{p_user_id:userId}); return reply(200,'ok'); }
        const codes = generateCodes();
        const hashes = await Promise.all(codes.map(code=>hashCode(userId,code,settings.pepper)));
        await call('replace_recovery_codes',{p_user_id:userId,p_hashes:hashes});
        return reply(200,'ok',{codes});
      } catch { return reply(503,'retry_later'); }
    }
    const code = normalizeCode(input.code);
    // Hatalı biçim de deneme sayacına girer.
    const hash = await hashCode(userId,/^[2-9A-HJ-NP-Z]{10}$/.test(code) ? code : '!invalid',settings.pepper);
    let ticket: string | undefined;
    try {
      const claim = await call('claim_recovery',{p_user_id:userId,p_hash:hash});
      if (claim.status === 'locked') return reply(429,'recovery_locked');
      if (claim.status === 'busy') return reply(409,'recovery_busy');
      if (claim.status !== 'claimed') return reply(400,'recovery_invalid');
      ticket = claim.ticket;
      const factors = result(await admin.auth.admin.mfa.listFactors({userId})).factors;
      for (const factor of factors) {
        if (!await call('renew_recovery',{p_user_id:userId,p_ticket:ticket})) return reply(409,'recovery_busy');
        const removal = await admin.auth.admin.mfa.deleteFactor({userId,id:factor.id});
        if (removal.error && removal.error.code !== 'mfa_factor_not_found') throw removal.error;
      }
      if (!await call('renew_recovery',{p_user_id:userId,p_ticket:ticket})) return reply(409,'recovery_busy');
      result(await admin.auth.admin.signOut(token,'global'));
      if (!await call('finish_recovery',{p_user_id:userId,p_ticket:ticket})) throw new Error('Kurtarma tamamlanamadı.');
      return reply(200,'ok',{recovered:true});
    } catch {
      if (ticket) { try { await call('release_recovery',{p_user_id:userId,p_ticket:ticket}); } catch {} }
      return reply(503,'recovery_retry');
    }
  };
}
