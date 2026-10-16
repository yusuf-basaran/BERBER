import { supabase } from './supabase.js';
import { pageUrl, safeReturnUrl } from './config.js';
import { t } from './i18n.js';
import { normalizePhone, isEmail, errorMessage, toast } from './ui.js';

export class FormError extends Error {
  constructor(fields) {
    super(t('error.validation'));
    this.name = 'FormError';
    this.fields = fields;
    this.userMessage = t('error.validation');
  }
}
function fail(key) { const error = new Error(t(key)); error.userMessage = t(key); return error; }
export function validateRegistration(values) {
  const fields = {};
  const fullName = String(values.fullName ?? '').trim().replace(/\s+/g, ' ');
  const email = String(values.email ?? '').trim().toLowerCase();
  const password = String(values.password ?? '');
  if (fullName.length < 2 || fullName.length > 100) fields.fullName = t('error.name');
  if (!isEmail(email)) fields.email = t('error.email');
  if (password.length < 10 || password.length > 128 || !/\p{L}/u.test(password) || !/\d/.test(password)) fields.password = t('error.password');
  if (password !== values.passwordAgain) fields.passwordAgain = t('error.passwordMismatch');
  if (!['customer', 'barber'].includes(values.role)) fields.role = t('error.role');
  if (values.termsAccepted !== true) fields.termsAccepted = t('error.consent');
  if (values.privacyAccepted !== true) fields.privacyAccepted = t('error.consent');
  let phone;
  try { phone = normalizePhone(values.phone); } catch { fields.phone = t('error.phone'); }
  if (Object.keys(fields).length) throw new FormError(fields);
  return { fullName, email, password, phone, role: values.role };
}
function validateLogin(email, password) {
  const fields = {};
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (!isEmail(cleanEmail)) fields.email = t('error.email');
  if (typeof password !== 'string' || password.length === 0) fields.password = t('common.required');
  if (Object.keys(fields).length) throw new FormError(fields);
  return cleanEmail;
}
function cleanEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!isEmail(value)) throw new FormError({ email: t('error.email') });
  return value;
}
function checkResult(result) { if (result.error) throw result.error; return result.data; }

export function createAuthManager(client) {
  let epoch = 0;
  let pending = null;
  let subscription = null;
  let timer = null;
  const listeners = new Set();
  const invalidate = () => { epoch++; pending = null; };
  const snapshot = (status, user = null, profile = null, assurance = null) => Object.freeze({
    status,
    user: user ? Object.freeze({ id: user.id, email: user.email, emailConfirmedAt: user.email_confirmed_at, lastSignInAt: user.last_sign_in_at }) : null,
    profile: profile ? Object.freeze({ ...profile }) : null,
    assurance: assurance ? Object.freeze({ currentLevel: assurance.currentLevel, nextLevel: assurance.nextLevel }) : null
  });
  async function loadContext() {
    const sessionData = checkResult(await client.auth.getSession());
    if (!sessionData.session) return snapshot('signed_out');
    const { user } = checkResult(await client.auth.getUser());
    if (!user || user.is_anonymous) return snapshot('signed_out');
    if (!user.email_confirmed_at) return snapshot('email_unconfirmed', user);
    const assurance = checkResult(await client.auth.mfa.getAuthenticatorAssuranceLevel());
    if (!['aal1', 'aal2'].includes(assurance?.currentLevel) || !['aal1', 'aal2'].includes(assurance?.nextLevel)) throw fail('auth.sessionExpired');
    if (assurance.currentLevel !== 'aal2' && assurance.nextLevel === 'aal2') return snapshot('mfa_required', user, null, assurance);
    const { data: profile, error } = await client.from('profiles')
      .select('id,role,full_name,phone,created_at').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!profile || !['customer', 'barber'].includes(profile.role) || profile.id !== user.id) throw fail('error.profileMissing');
    return snapshot('ready', user, profile, assurance);
  }
  function getContext() {
    if (pending) return pending;
    const requestEpoch = epoch;
    const request = loadContext().then(context => requestEpoch === epoch ? context : getContext());
    pending = request;
    const release = () => { if (pending === request) pending = null; };
    request.then(release, release);
    return request;
  }
  function watch(callback, { onPending } = {}) {
    const listener = { callback, onPending };
    listeners.add(listener);
    if (!subscription) {
      subscription = client.auth.onAuthStateChange((event) => {
        invalidate();
        for (const listener of listeners) listener.onPending?.(event);
        // Supabase çağrıları oturum olayının kilidi bırakıldıktan sonra yapılır.
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const requestEpoch = epoch;
          try {
            const context = await getContext();
            if (epoch !== requestEpoch) return;
            for (const listener of listeners) listener.callback({ event, context, error: null });
          } catch (error) {
            if (epoch !== requestEpoch) return;
            for (const listener of listeners) listener.callback({ event, context: null, error });
          }
        }, 0);
      }).data.subscription;
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        subscription?.unsubscribe(); subscription = null;
        clearTimeout(timer); timer = null;
      }
    };
  }
  async function signUp(values) {
    const input = validateRegistration(values);
    const data = checkResult(await client.auth.signUp({
      email: input.email, password: input.password,
      options: {
        captchaToken:values.captchaToken,
        emailRedirectTo: pageUrl('login', { verified: '1' }),
        data: { role: input.role, full_name: input.fullName, phone: input.phone, terms_accepted: true, privacy_accepted: true, ...(input.role==='barber'&&values.shopApplication?{shop_application:values.shopApplication}:{}) }
      }
    }));
    invalidate();
    if (data.session) {
      checkResult(await client.auth.signOut({ scope: 'local' }));
      throw fail('error.emailConfirmationSetting');
    }
    return { confirmationRequired: true };
  }
  async function signIn(email, password, captchaToken) {
    const value = validateLogin(email, password);
    checkResult(await client.auth.signInWithPassword({ email: value, password, options:{captchaToken} }));
    invalidate();
    return getContext();
  }
  async function signOut() {
    checkResult(await client.auth.signOut({ scope: 'local' }));
    invalidate();
    return snapshot('signed_out');
  }
  async function resendConfirmation(email,captchaToken) {
    checkResult(await client.auth.resend({ type: 'signup', email: cleanEmail(email), options: { captchaToken,emailRedirectTo: pageUrl('login', { verified: '1' }) } }));
    return { sent: true };
  }
  async function sendEmailCode(email,captchaToken) {
    checkResult(await client.auth.signInWithOtp({ email: cleanEmail(email), options: { captchaToken,shouldCreateUser: false, emailRedirectTo: pageUrl('login') } }));
    return { sent: true };
  }
  async function verifyEmailCode(email, token) {
    const address = cleanEmail(email);
    if (!/^\d{6}$/.test(String(token ?? ''))) throw new FormError({ code: t('error.code') });
    checkResult(await client.auth.verifyOtp({ email: address, token: String(token), type: 'email' }));
    invalidate();
    return getContext();
  }
  async function verifySecondFactor(factorId, code) {
    if (!/^\d{6}$/.test(String(code ?? ''))) throw new FormError({ code: t('error.code') });
    const context = await getContext();
    if (!context.user || !context.user.emailConfirmedAt) throw fail('auth.loginRequired');
    const { totp } = checkResult(await client.auth.mfa.listFactors());
    if (!totp.some(factor => factor.id === factorId && factor.status === 'verified')) throw fail('error.forbidden');
    const challenge = checkResult(await client.auth.mfa.challenge({ factorId }));
    checkResult(await client.auth.mfa.verify({ factorId, challengeId: challenge.id, code: String(code) }));
    invalidate();
    const next = await getContext();
    if (next.status !== 'ready' || next.assurance.currentLevel !== 'aal2') throw fail('error.mfaRequired');
    return next;
  }
  async function getSignInFactors() {
    const context = await getContext();
    if (!context.user || !context.user.emailConfirmedAt) throw fail('auth.loginRequired');
    const { totp } = checkResult(await client.auth.mfa.listFactors());
    return totp.filter(factor => factor.status === 'verified').map(({ id, friendly_name }) => ({ id, name: friendly_name || t('security.title') }));
  }
  return Object.freeze({ getContext, watch, invalidate, signUp, signIn, signOut, resendConfirmation, sendEmailCode, verifyEmailCode, verifySecondFactor, getSignInFactors });
}

export const auth = createAuthManager(supabase);
export const { getContext, watch, signUp, signIn, signOut, resendConfirmation, sendEmailCode, verifyEmailCode, verifySecondFactor, getSignInFactors } = auth;

export function destination(context, next) {
  const returnUrl = safeReturnUrl(next, context?.profile?.role === 'barber' ? 'panel' : 'appointments');
  if (context?.status === 'mfa_required') return pageUrl('login', { step: 'mfa', next: returnUrl });
  if (context?.status !== 'ready') return pageUrl('login', { next: returnUrl });
  const url = new URL(returnUrl);
  const page = url.pathname.split('/').pop().replace(/\.html$/, '');
  if (page === 'panel' && context.profile.role !== 'barber') return pageUrl('appointments');
  if (page === 'randevularim' && context.profile.role !== 'customer') return pageUrl('panel');
  return returnUrl;
}

export async function requireAuth({ role, redirect = true } = {}) {
  if (role && !['customer', 'barber'].includes(role)) throw new TypeError('Geçersiz rol.');
  const context = await getContext();
  if (context.status !== 'ready') {
    if (redirect) window.location.replace(destination(context, window.location.href));
    return null;
  }
  if (role && context.profile.role !== role) {
    if (redirect) window.location.replace(pageUrl(context.profile.role === 'barber' ? 'panel' : 'appointments'));
    return null;
  }
  return context;
}

export async function consumeAuthCallback() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const callbackFailed = url.searchParams.has('error') || hash.has('error');
  const hadCode = url.searchParams.has('code');
  let context;
  let error = callbackFailed ? fail('auth.callbackError') : null;
  try { if (!error) context = await getContext(); }
  catch (cause) { error = cause; }
  finally {
    for (const key of ['code', 'error', 'error_code', 'error_description', 'access_token', 'refresh_token']) url.searchParams.delete(key);
    if (hash.has('access_token') || hash.has('refresh_token') || hash.has('error')) url.hash = '';
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  if (hadCode && context?.status === 'signed_out' && !error) error = fail('auth.callbackError');
  return { context: context || null, error };
}

export function bindLogout(root = document) {
  const handler = async event => {
    const button = event.target.closest?.('[data-logout]');
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    try { await signOut(); window.location.assign(pageUrl('home')); }
    catch (error) { toast(errorMessage(error), { type: 'error' }); button.disabled = false; }
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

export function protectPage(options = {}) {
  const content = document.querySelector('[data-protected]');
  if (content) content.hidden = true;
  let disposed = false;
  let run = 0;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  async function refresh() {
    const token = ++run;
    if (content) content.hidden = true;
    try {
      const context = await requireAuth(options);
      if (!disposed && token === run && context) {
        if (content) content.hidden = false;
        resolveReady(context);
        return context;
      }
      if (!disposed && token === run) resolveReady(null);
      return null;
    } catch (error) {
      if (!disposed && token === run) {
        toast(errorMessage(error), { type: 'error', duration: 0 });
        resolveReady(null);
      }
      return null;
    }
  }
  const stopWatching = watch(() => { if (!disposed) void refresh(); }, { onPending: () => {
    run++;
    if (content) content.hidden = true;
  } });
  const visible = () => { if (document.visibilityState === 'visible' && !disposed) void refresh(); };
  document.addEventListener('visibilitychange', visible);
  void refresh();
  return { ready, dispose() { disposed = true; run++; resolveReady(null); stopWatching(); document.removeEventListener('visibilitychange', visible); } };
}
