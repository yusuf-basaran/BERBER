import {t} from './i18n.js';
import {element as el,confirmAction} from './ui.js';
const stop=new AbortController(),options={signal:stop.signal};
const installed=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const host=el('aside',{className:'pwa-notices',attrs:{'aria-live':'polite','aria-label':t('pwa.title')}});
document.querySelector('main')?.prepend(host);
let deferred=null,installBox=null,updateBox=null,registration=null,reloadRequested=false,reloaded=false,lastCheck=Date.now();
let dismissedUntil=0;try{dismissedUntil=Number(localStorage.getItem('berber-install-dismissed-until'))||0;}catch{}
const deferInstall=()=>{dismissedUntil=Date.now()+7*86400000;try{localStorage.setItem('berber-install-dismissed-until',String(dismissedUntil));}catch{}deferred=null;installBox?.remove();installBox=null;};
function installOffer(){
 if(!deferred||installed()||Date.now()<dismissedUntil||installBox)return;
 const button=el('button',{text:t('pwa.install'),className:'button button--secondary',attrs:{type:'button'}}),dismiss=el('button',{text:t('pwa.later'),className:'text-button',attrs:{type:'button'}});
 installBox=el('div',{className:'pwa-notice'},[el('p',{text:t('pwa.installHint')}),button,dismiss]);host.append(installBox);dismiss.addEventListener('click',deferInstall,options);
 button.addEventListener('click',async()=>{if(!deferred)return;const prompt=deferred;deferred=null;button.disabled=true;try{const result=await prompt.prompt(),choice=await(prompt.userChoice||result);if(choice?.outcome==='accepted'){installBox?.remove();installBox=null;}else deferInstall();}catch{deferInstall();}},options);
}
function updateOffer(){
 if(updateBox||stop.signal.aborted)return;
 const button=el('button',{text:t('pwa.update'),className:'button button--secondary',attrs:{type:'button'}}),later=el('button',{text:t('pwa.later'),className:'text-button',attrs:{type:'button'}});
 updateBox=el('div',{className:'pwa-notice'},[el('p',{text:t('pwa.updateReady')}),button,later]);host.append(updateBox);
 later.addEventListener('click',()=>{updateBox.remove();updateBox=null;},options);
 button.addEventListener('click',async()=>{button.disabled=true;try{if(!await confirmAction(t('pwa.updateConfirm'),{confirmKey:'pwa.update'}))return;reloadRequested=true;if(registration?.waiting)registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});else window.location.reload();}finally{button.disabled=false;}},options);
}
window.addEventListener('beforeinstallprompt',event=>{if(typeof event.prompt!=='function')return;event.preventDefault();deferred=event;installOffer();},options);
window.addEventListener('appinstalled',()=>{deferred=null;installBox?.remove();installBox=null;},options);
const theme=getComputedStyle(document.documentElement).getPropertyValue('--zemin').trim();
if(theme){let meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta);}meta.content=theme;}
if('serviceWorker'in navigator&&window.isSecureContext){
 let hadController=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloadRequested&&!reloaded){reloaded=true;window.location.reload();}else if(hadController)updateOffer();hadController=Boolean(navigator.serviceWorker.controller);},options);
 void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(value=>{
  if(stop.signal.aborted)return;registration=value;if(value.waiting&&navigator.serviceWorker.controller)updateOffer();
  const watch=worker=>worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)updateOffer();},options);
  watch(value.installing);value.addEventListener('updatefound',()=>watch(value.installing),options);
 }).catch(()=>{});
 const check=()=>{if(registration&&Date.now()-lastCheck>3600000){lastCheck=Date.now();void registration.update().catch(()=>{});}};
 window.addEventListener('online',check,options);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();},options);
}
window.addEventListener('pagehide',()=>stop.abort(),{once:true});
