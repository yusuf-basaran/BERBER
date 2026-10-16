import { supabase } from './supabase.js';
import { auth, FormError } from './auth.js';
import { t } from './i18n.js';

function result(value) { if (value.error) throw value.error; return value.data; }
function failure(key) { const error = new Error(t(key)); error.userMessage = t(key); return error; }
const edgeKeys = { recovery_invalid:'security.recoveryInvalid',recovery_locked:'security.recoveryLocked',recovery_retry:'security.recoveryRetry',recovery_busy:'security.recoveryBusy',reauth_required:'security.reauthRequired',mfa_required:'error.mfaRequired',unauthorized:'auth.sessionExpired' };
export function createMfaManager(client, account) {
  let pendingId = null;
  let pendingUser = null;
  async function context() {
    const value = await account.getContext();
    if (value.status !== 'ready') throw failure(value.status === 'mfa_required' ? 'error.mfaRequired' : 'auth.loginRequired');
    return value;
  }
  async function factors() {
    await context();
    const data = result(await client.auth.mfa.listFactors());
    return (data.all || data.totp).filter(factor => factor.factor_type === 'totp' || !factor.factor_type);
  }
  async function cancelEnrollment() {
    if (!pendingId) return;
    const id = pendingId;
    const current = await account.getContext();
    if (current.user?.id !== pendingUser) { pendingId = null; pendingUser = null; return; }
    result(await client.auth.mfa.unenroll({factorId:id}));
    pendingId = null; pendingUser = null;
  }
  async function cleanupUnverified() {
    for (const factor of await factors()) if (factor.status !== 'verified') {
      result(await client.auth.mfa.unenroll({factorId:factor.id}));
      if (pendingId === factor.id) { pendingId = null; pendingUser = null; }
    }
  }
  async function enroll(name) {
    const clean = String(name || '').trim();
    if (clean.length < 2 || clean.length > 60) throw new FormError({friendlyName:t('security.setupNameError')});
    const current = await context();
    await cancelEnrollment();
    await cleanupUnverified();
    const value = result(await client.auth.mfa.enroll({factorType:'totp',friendlyName:clean}));
    pendingId = value.id; pendingUser = current.user.id;
    const qr = value.totp.qr_code;
    if (typeof qr !== 'string' || !qr.startsWith('data:image/svg+xml')) {
      await cancelEnrollment(); throw failure('error.generic');
    }
    return {id:value.id,qrCode:qr,secret:value.totp.secret,name:clean};
  }
  async function verifyEnrollment(code) {
    if (!/^\d{6}$/.test(String(code || ''))) throw new FormError({code:t('error.code')});
    const current = await context();
    if (!pendingId || current.user.id !== pendingUser) throw failure('error.forbidden');
    const challenge = result(await client.auth.mfa.challenge({factorId:pendingId}));
    result(await client.auth.mfa.verify({factorId:pendingId,challengeId:challenge.id,code:String(code)}));
    pendingId = null; pendingUser = null;
    account.invalidate();
    const updated = await context();
    if (updated.assurance.currentLevel !== 'aal2') throw failure('error.mfaRequired');
    return updated;
  }
  async function removeFactor(id, code) {
    await context();
    const verified = (await factors()).filter(factor=>factor.status==='verified');
    const factor = verified.find(factor=>factor.id===id);
    if (!factor) throw failure('error.forbidden');
    await account.verifySecondFactor(id,code);
    if (verified.length === 1) await invoke('revoke');
    result(await client.auth.mfa.unenroll({factorId:id}));
    result(await client.auth.refreshSession());
    account.invalidate();
    return context();
  }
  async function invoke(action, code) {
    const response = await client.functions.invoke('recovery-login',{body:{action,...(code === undefined ? {} : {code})}});
    let data = response.data;
    if (response.error) {
      try { data = await response.error.context.json(); } catch {}
      throw failure(edgeKeys[data?.code] || 'security.serverUnavailable');
    }
    if (data?.code !== 'ok') throw failure(edgeKeys[data?.code] || 'security.serverUnavailable');
    return data;
  }
  async function generateRecoveryCodes(factorId, code) {
    const current = await context();
    if (factorId) await account.verifySecondFactor(factorId,code);
    else if (current.assurance.currentLevel !== 'aal2') throw failure('error.mfaRequired');
    const data = await invoke('generate');
    if (!Array.isArray(data.codes) || data.codes.length !== 8 || data.codes.some(code=>! /^[2-9A-HJ-NP-Z]{10}$/.test(code))) throw failure('error.generic');
    return data.codes;
  }
  async function recoveryStatus() {
    const current = await context();
    if (current.assurance.currentLevel !== 'aal2') return null;
    return (await invoke('status')).remaining;
  }
  async function recover(code) {
    const response = await client.auth.getUser();
    if (response.error) throw failure('auth.loginRequired');
    const {user} = response.data;
    if (!user?.email_confirmed_at || user.is_anonymous) throw failure('auth.loginRequired');
    const clean = String(code || '').trim().toUpperCase().replace(/[ -]/g,'');
    if (!/^[2-9A-HJ-NP-Z]{10}$/.test(clean)) throw new FormError({recoveryCode:t('security.recoveryInvalid')});
    const data = await invoke('recover',clean);
    if (!data.recovered) throw failure('error.generic');
    // Sunucu tüm oturumları kapatır; tarayıcı kopyası da temizlenir.
    result(await client.auth.signOut({scope:'local'}));
    account.invalidate();
    return true;
  }
  return Object.freeze({factors,cleanupUnverified,enroll,cancelEnrollment,verifyEnrollment,removeFactor,generateRecoveryCodes,recoveryStatus,recover});
}
export const mfa = createMfaManager(supabase,auth);
