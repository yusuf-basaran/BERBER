import { auth, FormError, protectPage } from './auth.js';
import { mountLayout } from './layout.js';
import { mfa } from './mfa.js';
import { t } from './i18n.js';
import { element, errorMessage, clearFormErrors, showFormErrors, withFormTask, formatDateTime, confirmAction, openModal, copyText } from './ui.js';

mountLayout();
const protection = protectPage();
const notice = document.querySelector('[data-security-status]');
const setup = document.querySelector('[data-setup]');
const codesPanel = document.querySelector('[data-codes]');
let codes = []; let secret = ''; let busy = false; let disposed = false;
function message(value = '', error = false) { notice.textContent = value; notice.hidden = !value; notice.classList.toggle('notice--error',error); notice.setAttribute('role',error?'alert':'status'); }
function clearSetup() { secret = ''; setup.hidden = true; document.querySelector('[data-secret]').textContent = ''; document.querySelector('[data-qr]').removeAttribute('src'); document.getElementById('verify-setup-form').reset(); }
function displayCodes(value) {
  codes = [...value]; codesPanel.hidden = false;
  document.querySelector('[data-code-list]').replaceChildren(...codes.map(code=>element('li',{},[element('code',{text:code})])));
  codesPanel.scrollIntoView({block:'start'});
}
function clearCodes() { codes = []; document.querySelector('[data-code-list]').replaceChildren(); codesPanel.hidden = true; }
async function refresh() {
  const context = await auth.getContext();
  if (context.status !== 'ready') return;
  document.querySelector('[data-last-login]').textContent = t('security.lastLogin',{time:context.user.lastSignInAt?formatDateTime(context.user.lastSignInAt):'—'});
  const factors = (await mfa.factors()).filter(factor=>factor.status==='verified');
  document.querySelector('[data-mfa-badge]').textContent = t(factors.length?'security.enabled':'security.disabled');
  const list = document.querySelector('[data-factors]');
  list.replaceChildren(...factors.map(factor=>{
    const button = element('button',{text:t('security.removeFactor'),className:'text-button',attrs:{type:'button'}});
    button.addEventListener('click',()=>{if(!busy)removeDialog(factor);});
    return element('li',{},[element('span',{text:factor.friendly_name||t('security.title')}),button]);
  }));
  if (!factors.length) list.append(element('li',{text:t('security.noFactors'),className:'intro'}));
  const form = document.getElementById('regenerate-form'); form.hidden = !factors.length;
  form.elements.factorId.replaceChildren(...factors.map(factor=>element('option',{text:factor.friendly_name||t('security.title'),attrs:{value:factor.id}})));
  document.querySelector('[data-code-count]').textContent = factors.length?t('security.remaining',{count:await mfa.recoveryStatus()}):'';
}
function submit(form, task) {
  form.addEventListener('submit',event=>{
    event.preventDefault(); if(busy)return; busy=true;
    void withFormTask(form,async()=>{
      clearFormErrors(form); message();
      try { await task(Object.fromEntries(new FormData(form))); }
      catch(error){if(error instanceof FormError)showFormErrors(form,error.fields);message(errorMessage(error),true);}
      finally {busy=false;}
    });
  });
}
function removeDialog(factor) {
  const form = element('form',{attrs:{novalidate:true}});
  const id = 'remove-factor-code';
  const field = element('div',{className:'field',attrs:{'data-field':''}},[
    element('label',{text:t('security.verifyCurrent'),attrs:{for:id}}),
    element('input',{attrs:{id,name:'code',type:'text',inputmode:'numeric',autocomplete:'one-time-code',maxlength:6,required:true}})
  ]);
  form.append(element('p',{text:t('security.removeConfirm')}),field,element('button',{text:t('security.removeFactor'),className:'button',attrs:{type:'submit'}}));
  const modal = openModal({title:factor.friendly_name||t('security.title'),content:form});
  submit(form,async values=>{await mfa.removeFactor(factor.id,values.code);modal.close();await refresh();message(t('security.factorRemoved'));});
}
submit(document.getElementById('enroll-form'),async values=>{
  if(codes.length && !await confirmAction(t('security.clearCodesConfirm')))return;
  clearCodes(); const factor=await mfa.enroll(values.friendlyName);
  secret=factor.secret; document.querySelector('[data-secret]').textContent=secret;
  document.querySelector('[data-qr]').src=factor.qrCode;
  setup.hidden=false; setup.scrollIntoView({block:'start'}); document.getElementById('setup-code').focus();
});
submit(document.getElementById('verify-setup-form'),async values=>{
  await mfa.verifyEnrollment(values.code);clearSetup();message(t('security.factorAdded'));
  try {displayCodes(await mfa.generateRecoveryCodes());} finally {await refresh();}
});
submit(document.getElementById('regenerate-form'),async values=>{
  if(!await confirmAction(t('security.regenerateConfirm')))return;
  displayCodes(await mfa.generateRecoveryCodes(values.factorId,values.code));
  document.getElementById('regenerate-form').elements.code.value='';await refresh();
});
document.querySelector('[data-cancel-setup]').addEventListener('click',async()=>{
  if(busy)return;busy=true;
  try{await mfa.cancelEnrollment();clearSetup();}catch(error){message(errorMessage(error),true);}finally{busy=false;}
});
document.querySelector('[data-copy-secret]').addEventListener('click',()=>{if(secret)void copyText(secret);});
document.querySelector('[data-copy-codes]').addEventListener('click',()=>{if(codes.length)void copyText(codes.join('\n'));});
document.querySelector('[data-download-codes]').addEventListener('click',()=>{
  if(!codes.length)return;
  const blob=new Blob([`${t('security.codesFile')}\n${t('security.codesNotice')}\n\n${codes.join('\n')}\n`],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='berber-kurtarma-kodlari.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.querySelector('[data-clear-codes]').addEventListener('click',async()=>{if(await confirmAction(t('security.clearCodesConfirm')))clearCodes();});
void protection.ready.then(async context=>{
  if(!context||disposed)return;
  try{await mfa.cleanupUnverified();await refresh();}catch(error){message(errorMessage(error),true);}
});
window.addEventListener('pagehide',()=>{disposed=true;clearSetup();clearCodes();protection.dispose();void mfa.cancelEnrollment().catch(()=>{});},{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
