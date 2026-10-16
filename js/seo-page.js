import {mountLayout} from './layout.js';
import {supabase} from './supabase.js';
import {t} from './i18n.js';
mountLayout();
const cards=[...document.querySelectorAll('[data-seo-shop]')];
async function refresh(){try{if(!cards.length)return;const ids=cards.map(node=>node.dataset.seoShop);const result=await supabase.from('barbers').select('id').in('id',ids).eq('verification_status','approved').eq('is_active',true);if(result.error)return;const active=new Set(result.data.map(row=>row.id));for(const card of cards)if(!active.has(card.dataset.seoShop))card.remove();const count=document.querySelector('[data-seo-count]');if(count)count.textContent=t('search.results',{count:active.size});}catch{}}
void refresh();
