import {applyTranslations,t} from './i18n.js';
applyTranslations();
const status=document.querySelector('[data-offline-status]');
document.querySelector('[data-offline-retry]')?.addEventListener('click',()=>window.location.reload());
window.addEventListener('online',()=>{if(status)status.textContent=t('pwa.connectionBack');});
