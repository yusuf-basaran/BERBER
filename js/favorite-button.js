import {auth,destination} from './auth.js';
import {favoriteIds,setFavorite} from './favorites.js';
import {isUuid} from './slots.js';
import {t} from './i18n.js';
import {element,toast,errorMessage} from './ui.js';
const intentKey='berber-favorite-intent';
export function createFavoriteControls({demo=false,onChange=()=>{}}={}){
  const controls=new Set();let epoch=0,disposed=false,intentTried=false;
  function paint(item){item.node.textContent=item.selected?'♥':'♡';item.node.setAttribute('aria-pressed',String(item.selected));item.node.setAttribute('aria-label',t(item.selected?'favorite.remove':'favorite.add',{name:item.name}));}
  function pending(){epoch++;for(const item of controls){item.selected=false;paint(item);}}
  async function sync(){
    const token=++epoch;for(const item of controls)if(!item.node.isConnected)controls.delete(item);
    if(disposed||demo||!controls.size)return;
    try{const context=await auth.getContext();if(token!==epoch||disposed)return;if(context.status!=='ready'){for(const item of controls){item.selected=false;paint(item);}return;}
      const ids=await favoriteIds([...new Set([...controls].map(item=>item.id))]);if(token!==epoch||disposed)return;
      for(const item of controls){item.selected=ids.has(item.id);paint(item);}
      let intent;try{intent=JSON.parse(sessionStorage.getItem(intentKey)||'null');}catch{}
      if(!intentTried&&intent&&isUuid(intent.barberId)&&Number.isFinite(intent.createdAt)){
        if(Date.now()-intent.createdAt>1800000||intent.createdAt>Date.now()){sessionStorage.removeItem(intentKey);return;}
        if([...controls].some(item=>item.id===intent.barberId)){intentTried=true;await setFavorite(intent.barberId,true);sessionStorage.removeItem(intentKey);if(token!==epoch||disposed)return;for(const item of controls)if(item.id===intent.barberId){item.selected=true;paint(item);}toast(t('favorite.saved'),{type:'success'});onChange();}
      }
    }catch(error){if(!disposed&&token===epoch){for(const item of controls)item.node.title=t('favorite.retry');}}
  }
  function button(barber){
    const node=element('button',{className:'favorite-button',attrs:{type:'button',disabled:demo}}),item={node,id:barber.id,name:barber.shop_name,selected:false};controls.add(item);paint(item);
    node.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(node.disabled)return;node.disabled=true;void(async()=>{
      try{const context=await auth.getContext();if(context.status!=='ready'){try{sessionStorage.setItem(intentKey,JSON.stringify({barberId:item.id,createdAt:Date.now()}));}catch{}window.location.assign(destination(context,window.location.href));return;}
        const selected=!item.selected,token=epoch;await setFavorite(item.id,selected);if(disposed||token!==epoch)return;
        for(const other of controls)if(other.id===item.id){other.selected=selected;paint(other);}toast(t(selected?'favorite.saved':'favorite.removed'),{type:'success'});onChange();
      }catch(error){if(!disposed)toast(errorMessage(error),{type:'error'});}finally{node.disabled=demo;}
    })();});return node;
  }
  const stop=demo?()=>{}:auth.watch(()=>void sync(),{onPending:pending});
  return {button,sync,dispose(){disposed=true;epoch++;controls.clear();stop();}};
}
