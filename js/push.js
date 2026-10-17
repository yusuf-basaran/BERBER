import {supabase} from './supabase.js';
import {auth} from './auth.js';
import {t} from './i18n.js';
import {element as el,errorMessage,toast} from './ui.js';
const result=r=>{if(r.error)throw r.error;return r.data;};
const capability=registration=>new Promise(resolve=>{if(!registration?.active)return resolve(false);const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(false);},1500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.supported===true);};registration.active.postMessage({type:'PUSH_CAPABILITY'},[channel.port2]);});
const keyBytes=value=>{const base=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),c=>c.charCodeAt(0));};
async function contextFor(id){const c=await auth.getContext();if(c.status!=='ready'||(id&&c.user.id!==id))throw Error(t('auth.loginRequired'));return c;}
export async function disableDevicePush(){
 if(!('serviceWorker'in navigator))return;
 const registration=await navigator.serviceWorker.getRegistration('/'),subscription=await registration?.pushManager?.getSubscription();if(!subscription)return;
 const context=await auth.getContext();
 const remove=async()=>{if(context.status!=='ready')return;result(await supabase.from('push_subscriptions').delete().eq('user_id',context.user.id).eq('endpoint',subscription.endpoint));};
 const results=await Promise.allSettled([remove(),subscription.unsubscribe(),registration.getNotifications({tag:'berber-inbox'}).then(rows=>rows.forEach(n=>n.close()))]);
 const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
}
export function mountPushSettings(container,context){
 const box=el('section',{className:'push-settings'});container.append(box);let epoch=0,disposed=false,busy=false;
 const current=token=>!disposed&&box.isConnected&&token===epoch;
 async function load(){const token=++epoch;box.replaceChildren(el('h3',{text:t('push.title')}),el('p',{text:t('push.privacy'),className:'field-hint'}));
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ios&&!navigator.standalone&&!window.matchMedia('(display-mode: standalone)').matches){box.append(el('p',{text:t('push.ios'),className:'notice'}));return;}
  if(!window.isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){box.append(el('p',{text:t('push.unsupported'),className:'field-hint'}));return;}
  try{const registration=await navigator.serviceWorker.getRegistration('/');if(!current(token))return;
   if(!await capability(registration)){if(current(token))box.append(el('p',{text:t('push.updateRequired'),className:'notice'}));return;}
   const existing=await registration.pushManager.getSubscription(),state=result(await supabase.rpc('get_push_state',{p_endpoint:existing?.endpoint||''}));if(!current(token))return;
   if(!state?.public_key){box.append(el('p',{text:t('push.preparing'),className:'field-hint'}));return;}
   if(Notification.permission==='denied'){box.append(el('p',{text:t('push.denied'),className:'notice'}));if(!state.enabled)return;}
   box.append(el('p',{text:t(state.enabled?'push.enabled':'push.disabled'),attrs:{role:'status'}}));
   const button=el('button',{text:t(state.enabled?'push.disable':'push.enable'),className:'button button--secondary',attrs:{type:'button'}});box.append(button);
   button.addEventListener('click',async()=>{if(busy)return;busy=true;button.disabled=true;let created=null;
    try{if(state.enabled){await disableDevicePush();}
     else{const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted'){if(current(token))toast(t('push.denied'),{type:'error'});return;}
      await contextFor(context.user.id);if(existing)await existing.unsubscribe();const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(state.public_key)});created=subscription;
      await contextFor(context.user.id);const value=subscription.toJSON();result(await supabase.rpc('register_push',{p_endpoint:value.endpoint,p_keys:value.keys}));created=null;
     }if(current(token))await load();
    }catch(error){if(created)try{await created.unsubscribe();}catch{}if(current(token))toast(errorMessage(error),{type:'error'});}
    finally{busy=false;button.disabled=false;}
   });
  }catch(error){if(current(token)){box.append(el('p',{text:errorMessage(error),className:'notice notice--error'}));const retry=el('button',{text:t('common.retry'),className:'button button--secondary',attrs:{type:'button'}});retry.addEventListener('click',()=>void load());box.append(retry);}}
 }
 void load();return ()=>{disposed=true;epoch++;box.replaceChildren();};
}
