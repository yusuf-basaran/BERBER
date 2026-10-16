import { config, pageUrl } from './config.js';
import { t } from './i18n.js';

export function normalizePhone(value, { mobileOnly = false } = {}) {
  const input = String(value ?? '').trim();
  if (!/^\+?[0-9 ()-]+$/.test(input)) throw new Error(t('error.phone'));
  let digits = input.replace(/[^0-9]/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = `90${digits.slice(1)}`;
  if (!/^90(5\d{9}|392\d{7})$/.test(digits) || (mobileOnly && !/^905\d{9}$/.test(digits))) {
    throw new Error(t('error.phone'));
  }
  return `+${digits}`;
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function safeHref(value, { image = false } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return '';
  try {
    const url = new URL(value, config.appUrl);
    const base = new URL(config.appUrl);
    if (url.username || url.password) return '';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === base.origin)) return url.href;
    if (!image && url.protocol === 'tel:' && /^tel:\+90(5\d{9}|392\d{7})$/.test(url.href)) return url.href;
    return '';
  } catch { return ''; }
}

export function element(tag, { text, className, attrs = {} } = {}, children = []) {
  if (!/^[a-z][a-z0-9-]*$/.test(tag) || ['script', 'iframe', 'object', 'embed', 'style'].includes(tag)) throw new TypeError('Geçersiz öğe.');
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (/^on/i.test(name) || ['srcdoc', 'style', 'innerHTML'].includes(name)) throw new TypeError('Geçersiz özellik.');
    if (['href', 'src', 'action', 'formaction'].includes(name)) {
      const url = safeHref(String(value), { image: name === 'src' });
      if (!url) throw new TypeError('Geçersiz bağlantı.');
      node.setAttribute(name, url);
    } else node.setAttribute(name, value === true ? '' : String(value));
  }
  if (node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
  for (const child of children) if (child !== null && child !== undefined) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

export function clear(node) { node.replaceChildren(); }
export function text(node, value) { node.textContent = String(value ?? ''); }

function instant(value) {
  if (typeof value === 'string' && !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) throw new RangeError('Saat dilimi gerekli.');
  const date = value instanceof Date ? value : new Date(value);
  if (value === null || value === undefined || !Number.isFinite(date.getTime())) throw new RangeError('Geçersiz tarih.');
  return date;
}
export function formatDateTime(value, options = {}) {
  return new Intl.DateTimeFormat(config.locale, {
    dateStyle: 'medium', timeStyle: 'short', ...options, timeZone: config.timeZone
  }).format(instant(value));
}
export function formatTime(value) {
  return new Intl.DateTimeFormat(config.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: config.timeZone }).format(instant(value));
}
export function localDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: config.timeZone }).formatToParts(instant(value));
  const get = name => parts.find(part => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function formatMoney(value, currency = 'TRY') {
  const amount = Number(value);
  if (value === null || value === '' || !Number.isFinite(amount) || amount < 0 || !['TRY', 'GBP', 'EUR'].includes(currency)) throw new RangeError('Geçersiz fiyat.');
  const number = new Intl.NumberFormat(config.locale, { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
  const symbol = { TRY: '₺', GBP: '£', EUR: '€' }[currency];
  return `${number} ${symbol}${currency === 'GBP' ? ' (GBP)' : ''}`;
}

const errorKeys = {
  invalid_credentials: 'error.credentials', email_not_confirmed: 'auth.confirmationRequired',
  over_request_rate_limit: 'error.rateLimit', over_email_send_rate_limit: 'error.rateLimit',
  over_sms_send_rate_limit: 'error.rateLimit', weak_password: 'error.weakPassword',
  otp_expired: 'auth.callbackError', otp_disabled: 'error.forbidden',
  mfa_verification_failed: 'error.mfaCode', mfa_challenge_expired: 'error.mfaCode',
  insufficient_aal: 'error.mfaRequired', session_not_found: 'auth.sessionExpired',
  refresh_token_not_found: 'auth.sessionExpired', refresh_token_already_used: 'auth.sessionExpired',
  '23P01': 'error.conflict', '42501': 'error.forbidden', '23505': 'error.validation',
  '23514': 'error.validation', '23503': 'error.validation', '22023': 'error.validation',
  PGRST205: 'error.schema', PGRST202: 'error.schema', '42P01': 'error.schema'
};
export function errorMessage(error, fallback = 'error.generic') {
  if(error?.code==='P2001')return t('manual.cancelClosed');
  if(error?.code==='P2002')return t('manual.unavailable');
  if(error?.code==='P2004')return t('approval.unavailable');
  if(error?.code==='P2009')return t('limits.operation');
  if(error?.code==='P2010')return t('limits.banned');
  if(error?.code==='P2011')return t('limits.requests');
  if(error?.code==='P2012')return t('waitlist.limit');
  if(error?.code==='P2006')return t('application.sendError');
  if(error?.code==='P2007')return t('profile.complete');
  if(error?.code==='P2008')return t('application.supportLimit');
  if(error?.code==='P2005')return t('admin.changed');
  if (error?.userMessage) return error.userMessage;
  if (error?.status === 429) return t('error.rateLimit');
  if (errorKeys[error?.code]) return t(errorKeys[error.code]);
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError') return t('error.network');
  return t(fallback);
}

let toastRegion;
export function toast(message, { type = 'info', duration = 6000 } = {}) {
  if (!toastRegion?.isConnected) {
    toastRegion = element('div', { className: 'toast-region', attrs: { 'aria-label': t('nav.notifications') } });
    document.body.append(toastRegion);
  }
  const notice = element('div', { className: `toast toast--${['info','success','error'].includes(type) ? type : 'info'}`, attrs: { role: type === 'error' ? 'alert' : 'status', 'aria-atomic': 'true' } });
  notice.append(element('span', { text: message }));
  const close = element('button', { text: '×', attrs: { type: 'button', 'aria-label': t('common.close') } });
  const remove = () => { clearTimeout(timer); notice.remove(); };
  close.addEventListener('click', remove);
  notice.append(close);
  toastRegion.append(notice);
  let timer = duration > 0 ? setTimeout(remove, duration) : null;
  return remove;
}

export function showState(container, { key = 'common.empty', kind = 'empty', retry } = {}) {
  const node = element('div', { className: `state state--${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, [element('p', { text: t(key) })]);
  if (retry) {
    const button = element('button', { text: t('common.retry'), attrs: { type: 'button' } });
    button.addEventListener('click', retry);
    node.append(button);
  }
  container.replaceChildren(node);
  container.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
}

const busyForms = new WeakSet();
export async function withFormTask(form, task, { busyKey = 'common.saving' } = {}) {
  if (busyForms.has(form)) return;
  busyForms.add(form);
  const buttons = [...form.querySelectorAll('button:not([type]), button[type="submit"], input[type="submit"]')];
  const states = buttons.map(button => ({ button, disabled: button.disabled, nodes: [...button.childNodes], value: button.value }));
  form.setAttribute('aria-busy', 'true');
  for (const button of buttons) {
    button.disabled = true;
    if (button.tagName === 'INPUT') button.value = t(busyKey); else button.textContent = t(busyKey);
  }
  try { return await task(); }
  finally {
    for (const { button, disabled, nodes, value } of states) {
      button.disabled = disabled;
      if (button.tagName === 'INPUT') button.value = value; else button.replaceChildren(...nodes);
    }
    form.setAttribute('aria-busy', 'false');
    busyForms.delete(form);
  }
}

let errorId = 0;
export function clearFormErrors(form) {
  for (const node of form.querySelectorAll('[data-field-error]')) {
    const id = node.id;
    for (const control of form.querySelectorAll('[aria-describedby]')) {
      const ids = control.getAttribute('aria-describedby').split(/\s+/).filter(value => value !== id);
      if (ids.length) control.setAttribute('aria-describedby', ids.join(' ')); else control.removeAttribute('aria-describedby');
    }
    node.remove();
  }
  for (const control of form.querySelectorAll('[aria-invalid="true"]')) control.removeAttribute('aria-invalid');
}
export function showFormErrors(form, errors) {
  clearFormErrors(form);
  let first;
  for (const [name, message] of Object.entries(errors)) {
    const field = form.elements.namedItem(name);
    const control = field?.nodeType === 1 ? field : field?.[0];
    if (!control) continue;
    const id = `field-error-${++errorId}`;
    const node = element('p', { text: message, className: 'field-error', attrs: { id, 'data-field-error': '', role: 'alert' } });
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', `${control.getAttribute('aria-describedby') || ''} ${id}`.trim());
    (control.closest('[data-field]') || control.parentElement).append(node);
    first ||= control;
  }
  first?.focus();
}

export function openModal({ title, content, onClose } = {}) {
  const previous = document.activeElement;
  const id = `modal-title-${++errorId}`;
  const dialog = element('dialog', { className: 'modal', attrs: { 'aria-labelledby': id } });
  const closeButton = element('button', { text: '×', className: 'modal-close', attrs: { type: 'button', 'aria-label': t('common.close') } });
  dialog.append(element('h2', { text: title, attrs: { id } }), closeButton);
  if (content) dialog.append(content.nodeType ? content : element('p', { text: content }));
  document.body.append(dialog);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dialog.close(); dialog.remove();
    if (previous?.isConnected) previous.focus();
    onClose?.();
  };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!closed) close(); });
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
  });
  dialog.showModal();
  return { dialog, close };
}
export function confirmAction(message, { title = t('common.confirm'), confirmKey = 'common.confirm' } = {}) {
  return new Promise(resolve => {
    let accepted = false;
    const content = element('div', {}, [element('p', { text: message })]);
    const actions = element('div', { className: 'modal-actions' });
    const cancel = element('button', { text: t('common.cancel'), attrs: { type: 'button', autofocus: true } });
    const confirm = element('button', { text: t(confirmKey), className: 'button', attrs: { type: 'button' } });
    actions.append(cancel, confirm); content.append(actions);
    const modal = openModal({ title, content, onClose: () => resolve(accepted) });
    cancel.addEventListener('click', modal.close);
    confirm.addEventListener('click', () => { accepted = true; modal.close(); });
  });
}

export async function copyText(value) {
  try { await navigator.clipboard.writeText(String(value)); toast(t('common.copied'), { type: 'success' }); return true; }
  catch { toast(t('error.copy'), { type: 'error' }); return false; }
}

let navigationSequence=0;
export function renderNavigation(container, context = null) {
  const links = [['home', 'nav.home']];
  if (context?.status === 'ready') {
    links.push(context.profile.role === 'barber' ? ['panel','nav.panel'] : ['appointments','nav.appointments']);
    if(context.profile.role==='customer')links.push(['profile','profile.title']);
    links.push(['favorites','nav.favorites'], ['security','nav.security']);
  } else if (context?.status === 'mfa_required') {
    links.push(['login','auth.verifyTitle']);
  } else {
    links.push(['login','nav.login'], ['register','nav.register']);
  }
  const id=`site-nav-${++navigationSequence}`;
  const nav = element('nav', { className: 'site-nav', attrs: { id,'aria-label': t('site.name') } });
  for (const [page,key] of links) nav.append(element('a', { text: t(key), attrs: { href: pageUrl(page), 'data-i18n': key } }));
  if (context?.user) {
    const logout = element('button', { text: t('nav.logout'), attrs: { type: 'button', 'data-logout': '', 'data-i18n': 'nav.logout' } });
    nav.append(logout);
  }
  const tools=element('div',{className:'nav-tools'});const anchor=element('div',{attrs:{'data-notification-anchor':''}});
  const toggle=element('button',{text:t('nav.menuLabel'),className:'nav-toggle',attrs:{type:'button','aria-expanded':'false','aria-controls':id,'aria-label':t('nav.menu')}});
  const close=()=>{nav.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label',t('nav.menu'));};
  toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';nav.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',t(open?'nav.menuClose':'nav.menu'));});
  nav.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();toggle.focus();}});
  toggle.addEventListener('keydown',event=>{if(event.key==='Escape'){close();}});
  tools.append(anchor,toggle);container.replaceChildren(nav,tools);
}

export function renderFooter(container) {
  const links = element('div', { className: 'footer-links' }, [
    element('a', { text: t('nav.terms'), attrs: { href: pageUrl('terms'), 'data-i18n': 'nav.terms' } }),
    element('a', { text: t('nav.privacy'), attrs: { href: pageUrl('privacy'), 'data-i18n': 'nav.privacy' } })
  ]);
  container.replaceChildren(links, element('p', { text: t('site.copyright', { year: localDate().slice(0, 4) }) }));
}

export function showErrorState(container,error,retry) {
  const content=element('div',{className:'state state--error',attrs:{role:'alert'}},[element('p',{text:errorMessage(error)})]);
  if(retry){const button=element('button',{text:t('common.retry'),className:'button button--secondary',attrs:{type:'button'}});button.addEventListener('click',retry);content.append(button);}
  container.replaceChildren(content);container.setAttribute('aria-busy','false');
}
export function shopPhoto(barber,{large=false}={}) {
  const frame=element('div',{className:`shop-photo${large?' shop-photo--large':''}`});
  const fallback=()=>{frame.replaceChildren(element('span',{text:String(barber.shop_name||'').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toLocaleUpperCase('tr-TR'),className:'shop-monogram',attrs:{'aria-hidden':'true'}}));frame.setAttribute('role','img');frame.setAttribute('aria-label',t('common.noPhoto'));};
  const src=safeHref(!large&&barber.photo_thumbnail_url?barber.photo_thumbnail_url:barber.photo_url,{image:true});
  if(src){const image=element('img',{attrs:{src,alt:barber.shop_name,loading:large?'eager':'lazy',decoding:'async'}});image.addEventListener('error',fallback,{once:true});frame.append(image);}else fallback();return frame;
}
