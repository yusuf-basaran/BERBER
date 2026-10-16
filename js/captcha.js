import {config} from './config.js';
import {element as el} from './ui.js';
import {t,getLanguage} from './i18n.js';
const widgets=new WeakMap();let script;
const fail=()=>{const error=new Error(t('captcha.failed'));error.userMessage=error.message;return error;};
function load(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  return script||=(new Promise((resolve,reject)=>{const node=document.createElement('script');node.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';node.async=true;node.defer=true;node.onload=()=>resolve(window.turnstile);node.onerror=()=>{script=null;node.remove();reject(fail());};document.head.append(node);}));
}
export async function captchaToken(form){
  if(!config.turnstileSiteKey)return undefined;
  const api=await load();if(!api)throw fail();let state=widgets.get(form);
  if(!state){const host=el('div',{className:'captcha-widget'});form.append(host);state={id:null,token:null};widgets.set(form,state);
    state.id=api.render(host,{sitekey:config.turnstileSiteKey,theme:'dark',language:getLanguage(),size:'flexible',callback:token=>{state.token=token;state.resolve?.(token);state.resolve=null;},'expired-callback':()=>{state.token=null;},'error-callback':()=>{state.token=null;state.reject?.(fail());state.resolve=null;state.reject=null;}});
  }
  if(state.token)return state.token;
  return new Promise((resolve,reject)=>{let timer=setTimeout(()=>{state.resolve=null;state.reject=null;reject(fail());},120000);state.resolve=value=>{clearTimeout(timer);state.reject=null;resolve(value);};state.reject=error=>{clearTimeout(timer);reject(error);};});
}
export function resetCaptcha(form){const state=widgets.get(form);if(state){state.token=null;window.turnstile?.reset(state.id);}}
