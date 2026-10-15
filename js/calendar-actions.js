import {getCalendarAppointment} from './appointments.js';
import {downloadIcs,googleCalendarUrl} from './ics.js';
import {t} from './i18n.js';
import {element,toast,errorMessage} from './ui.js';
export function calendarActions(appointment){
  const id=appointment.id;
  const box=element('div',{className:'calendar-actions'});
  const download=element('button',{text:t('calendar.download'),className:'button button--secondary',attrs:{type:'button'}});
  const google=element('a',{text:t('calendar.google'),className:'button button--secondary',attrs:{href:googleCalendarUrl(appointment),target:'_blank',rel:'noopener noreferrer'}});
  download.addEventListener('click',()=>{if(download.disabled)return;download.disabled=true;void(async()=>{try{downloadIcs(await getCalendarAppointment(id));}catch(error){toast(errorMessage(error),{type:'error'});}finally{download.disabled=false;}})();});
  google.addEventListener('click',event=>{event.preventDefault();if(google.getAttribute('aria-busy')==='true')return;
    const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;google.setAttribute('aria-busy','true');
    void(async()=>{try{const url=googleCalendarUrl(await getCalendarAppointment(id));if(popup)popup.location.replace(url);else window.location.assign(url);}catch(error){popup?.close();toast(errorMessage(error),{type:'error'});}finally{google.removeAttribute('aria-busy');}})();
  });box.append(download,google);return box;
}
