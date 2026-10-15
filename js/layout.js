import { auth, bindLogout } from './auth.js';
import { applyTranslations } from './i18n.js';
import { renderNavigation, renderFooter } from './ui.js';
import { createNotificationCenter } from './notification-center.js';
export function mountLayout() {
  applyTranslations();const nav=document.querySelector('[data-nav], [data-security-nav]');const footer=document.querySelector('[data-footer]');
  if(footer)renderFooter(footer);if(nav)renderNavigation(nav);
  const center=nav?createNotificationCenter(nav):null;const unbind=bindLogout();let stopped=false;let sequence=0;
  const update=context=>{if(!stopped&&nav){renderNavigation(nav,context);center.update(context);}};
  const initial=sequence;void auth.getContext().then(context=>{if(initial===sequence)update(context);}).catch(()=>{});
  const unwatch=auth.watch(({context})=>{update(context);},{onPending:()=>{sequence++;center?.clear();if(nav)renderNavigation(nav);}});
  const dispose=()=>{stopped=true;sequence++;center?.dispose();unbind();unwatch();};window.addEventListener('pagehide',dispose,{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});return dispose;
}
