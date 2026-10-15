import { auth, FormError, destination, consumeAuthCallback } from './auth.js';
import { pageUrl } from './config.js';
import { mfa } from './mfa.js';
import { applyTranslations, t } from './i18n.js';
import { element, withFormTask, clearFormErrors, showFormErrors, errorMessage, renderFooter } from './ui.js';

applyTranslations();
renderFooter(document.querySelector('[data-footer]'));
const root = document.querySelector('[data-account]');
const status = document.querySelector('[data-account-status]');
const next = new URL(window.location.href).searchParams.get('next');
let disposed = false;
let operation = 0;
let unsubscribe;
function message(text = '', error = false) {
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('notice--error', error);
  status.setAttribute('role', error ? 'alert' : 'status');
}
function showError(form, error) {
  if (error instanceof FormError) showFormErrors(form, error.fields);
  message(errorMessage(error), true);
}
function formValues(form) {
  return Object.fromEntries(new FormData(form));
}
function submit(form, task, busyKey = 'common.saving') {
  form.addEventListener('submit', event => {
    event.preventDefault();
    void withFormTask(form, async () => {
      clearFormErrors(form); message();
      const token = ++operation;
      try { await task(formValues(form), token); }
      catch (error) { if (!disposed && token === operation) showError(form, error); }
    }, { busyKey });
  });
}
for (const toggle of document.querySelectorAll('[data-password-toggle]')) {
  const input = document.getElementById(toggle.dataset.passwordToggle);
  toggle.addEventListener('click', () => {
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    toggle.textContent = t(showing ? 'common.hide' : 'common.show');
    toggle.setAttribute('aria-label', t(showing ? 'common.passwordHide' : 'common.passwordShow'));
    toggle.setAttribute('aria-pressed', String(showing));
  });
}

const resend = document.getElementById('resend-form');
if (resend) submit(resend, async values => {
  await auth.resendConfirmation(values.email);
  message(t('auth.resendSent'));
});

function revealResend(email = '') {
  const details = document.querySelector('[data-resend]');
  if (details) { details.open = true; resend.elements.email.value = email; }
}

if (root.dataset.account === 'register') {
  const form = document.getElementById('register-form');
  submit(form, async values => {
    await auth.signUp({ ...values, termsAccepted: form.elements.termsAccepted.checked, privacyAccepted: form.elements.privacyAccepted.checked });
    form.elements.password.value = ''; form.elements.passwordAgain.value = '';
    form.hidden = true;
    document.querySelector('[data-registration-success]').hidden = false;
    message(t('auth.checkEmail'));
    revealResend(values.email);
    status.focus();
  });
} else {
  const passwordForm = document.getElementById('password-form');
  const emailForm = document.getElementById('email-form');
  const codeForm = document.getElementById('email-code-form');
  const mfaForm = document.getElementById('mfa-form');
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const normal = document.querySelector('[data-login-methods]');
  const mfaPanel = document.querySelector('[data-mfa-panel]');
  let checking = false;
  submit(document.getElementById('recovery-form'), async values => {
    checking = true;
    try {
      await mfa.recover(values.recoveryCode);
      message(t('security.recoveryDone'));
      window.location.replace(pageUrl('login',{ recovered:'1', next:pageUrl('security') }));
    } finally { checking = false; }
  }, 'auth.working');
  function tab(index, focus = true) {
    for (const [position, button] of tabs.entries()) {
      const selected = position === index;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
    }
    message();
    if (focus) tabs[index].focus();
  }
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => tab(index));
    button.addEventListener('keydown', event => {
      const indices = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (Object.hasOwn(indices, event.key)) { event.preventDefault(); tab(indices[event.key]); }
    });
  });
  async function handleContext(context) {
    if (disposed || !context) return;
    if (context.status === 'ready') {
      message(t('auth.redirecting'));
      window.location.replace(destination(context, next));
    } else if (context.status === 'mfa_required') {
      normal.hidden = true; mfaPanel.hidden = false;
      document.querySelector('[data-resend]').hidden = true;
      const select = mfaForm.elements.factorId;
      const factors = await auth.getSignInFactors();
      select.replaceChildren(...factors.map(factor => element('option', { text: factor.name, attrs: { value: factor.id } })));
      if (!factors.length) { message(t('auth.factorUnavailable'), true); mfaForm.hidden = true; }
      else { mfaForm.hidden = false; message(); mfaForm.elements.code.focus(); }
    } else if (context.status === 'email_unconfirmed') {
      await auth.signOut();
      normal.hidden = false; mfaPanel.hidden = true;
      message(t('auth.confirmationRequired'), true); revealResend(context.user.email);
    } else {
      normal.hidden = false; mfaPanel.hidden = true;
      document.querySelector('[data-resend]').hidden = false;
    }
  }
  submit(passwordForm, async values => {
    checking = true;
    try {
      const context = await auth.signIn(values.email, values.password);
      passwordForm.elements.password.value = '';
      await handleContext(context);
    } catch (error) {
      if (error.code === 'email_not_confirmed') revealResend(values.email);
      throw error;
    } finally { checking = false; }
  }, 'auth.working');
  submit(emailForm, async values => {
    await auth.sendEmailCode(values.email);
    codeForm.elements.email.value = values.email.trim().toLowerCase();
    emailForm.hidden = true; codeForm.hidden = false;
    message(t('auth.otpSent')); codeForm.elements.code.focus();
  });
  submit(codeForm, async values => {
    checking = true;
    try { await handleContext(await auth.verifyEmailCode(values.email, values.code)); codeForm.elements.code.value = ''; }
    finally { checking = false; }
  }, 'auth.working');
  document.querySelector('[data-change-email]').addEventListener('click', () => {
    operation++; emailForm.hidden = false; codeForm.hidden = true;
    codeForm.reset(); message(); emailForm.elements.email.focus();
  });
  submit(mfaForm, async values => {
    checking = true;
    try { await handleContext(await auth.verifySecondFactor(values.factorId, values.code)); mfaForm.elements.code.value = ''; }
    finally { checking = false; }
  }, 'auth.working');
  document.querySelector('[data-back-login]').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await auth.signOut(); mfaForm.reset(); await handleContext({ status: 'signed_out' }); message(); }
    catch (error) { message(errorMessage(error), true); }
    finally { button.disabled = false; }
  });
  async function initialize() {
    normal.inert = true;
    try {
      const result = await consumeAuthCallback();
      if (result.error) message(errorMessage(result.error), true);
      else await handleContext(result.context);
      if (new URL(window.location.href).searchParams.get('recovered') === '1') message(t('security.recoveryDone'));
    } catch (error) { message(errorMessage(error), true); }
    finally { normal.inert = false; }
    if (!disposed) unsubscribe = auth.watch(({ context, error }) => {
      if (checking || disposed) return;
      if (error) { message(errorMessage(error), true); return; }
      void handleContext(context).catch(cause => message(errorMessage(cause), true));
    });
  }
  void initialize();
}
window.addEventListener('pagehide', () => { disposed = true; operation++; unsubscribe?.(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
