import {pageUrl} from './config.js';
import {t} from './i18n.js';
import {element,shopPhoto,formatMoney} from './ui.js';
export function barberCard(barber,{demo=false,favorites,booking=false}={}){
  const rating=Number(barber.avg_rating).toLocaleString('tr-TR',{minimumFractionDigits:1,maximumFractionDigits:1});
  const card=element('article',{className:'barber-card',attrs:{'data-barber-id':barber.id}});
  const link=element('a',{className:'barber-card-link',attrs:{href:pageUrl('barber',{id:barber.id,...(demo?{demo:'1'}:{})})}},[
    shopPhoto(barber),element('div',{className:'barber-card-body'},[
      element('h2',{text:barber.shop_name}),element('p',{text:t('barber.location',{city:barber.city,district:barber.district}),className:'card-location'}),
      element('p',{text:Number(barber.review_count)>0?`${t('barber.ratingLabel',{rating})} · ${t('barber.reviewsCount',{count:barber.review_count})}`:t('barber.noReviews'),className:'card-rating'}),
      element('div',{className:'card-bottom'},[element('strong',{text:booking?t(barber.is_active?'favorite.book':'barber.unavailable'):t('barber.fromPrice',{price:formatMoney(barber.starting_price,barber.currency)})}),element('span',{text:'→',attrs:{'aria-hidden':'true'}})])
    ])]);
  card.append(link);if(favorites)card.append(favorites.button(barber));return card;
}
