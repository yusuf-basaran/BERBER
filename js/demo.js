const cities={
  'Lefkoşa':['Surlariçi','Gönyeli','Hamitköy','Yenikent','Küçük Kaymaklı','Kermiya','Dereboyu','Ortaköy'],
  'Girne':['Merkez','Alsancak','Lapta','Karaoğlanoğlu','Çatalköy','Ozanköy','Bellapais','Edremit'],
  'Gazimağusa':['Merkez','Karakol','Çanakkale','Tuzla','Yeni Boğaziçi','Mutluyaka'],
  'Güzelyurt':['Merkez','Serdarlı','Gaziveren'],'İskele':['Merkez','Long Beach','Boğaz','Yeni Erenköy'],'Lefke':['Merkez','Yeşilyurt','Gemikonağı']
};
export const demoLocations=Object.entries(cities).flatMap(([city,districts])=>districts.map(district=>({city,district})));
const shops=[
  ['Dereboyu Berber','Lefkoşa','Dereboyu','Mehmet Usta’nın dükkanında klasik kesim ve sakal bakımı.','Dereboyu, ana cadde üzeri',4.8,42,350],
  ['Girne Usta Makas','Girne','Merkez','Merkezde, günlük kesimden damat hazırlığına.','Girne merkez, çarşı yanı',4.9,67,400],
  ['Karakol Erkek Kuaförü','Gazimağusa','Karakol','Öğrencilerin ve mahalle sakinlerinin buluştuğu dükkan.','Karakol, okul karşısı',4.6,28,300],
  ['Gönyeli Klasik','Lefkoşa','Gönyeli','Ahmet Usta ile sade ve özenli bir kesim.','Gönyeli, belediye yakınında',4.7,36,325],
  ['Alsancak Berber Evi','Girne','Alsancak','Saç, sakal ve sıcak havlu bakımı.','Alsancak, ana yol üzeri',4.5,19,375],
  ['Güzelyurt Makas','Güzelyurt','Merkez','Merkezde yılların berber geleneği.','Güzelyurt merkez, çarşı içi',4.8,31,280],
  ['Boğaz Saç & Sakal','İskele','Boğaz','Boğaz’da sakin bir dükkan, kişiye uygun kesimler.','Boğaz, liman yolu',4.7,24,360],
  ['Gemikonağı Berber','Lefke','Gemikonağı','Üniversiteye yakın, pratik ve özenli hizmet.','Gemikonağı, üniversite yolu',4.6,22,275]
];
export const demoBarbers=shops.map(([shop_name,city,district,bio,address,avg_rating,review_count,price],i)=>{
  const id=`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
  return {id,shop_name,city,district,bio,address,avg_rating,review_count,phone:'+905331234567',whatsapp:null,map_url:null,photo_url:null,is_active:true,
    services:[{id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,barber_id:id,name:'Saç Kesimi',category:'Saç Kesimi',price,currency:'TRY',duration_min:30,is_active:true},
      {id:`20000000-0000-4000-9000-${String(i+1).padStart(12,'0')}`,barber_id:id,name:'Saç + Sakal',category:'Saç + Sakal',price:price+180,currency:'TRY',duration_min:45,is_active:true}],
    hours:Array.from({length:7},(_,weekday)=>({weekday,is_closed:weekday===0,open_time:'09:00:00',close_time:'18:00:00',break_start:'12:30:00',break_end:'13:30:00'})),reviews:[]};
});
demoBarbers[1].services.push({id:'20000000-0000-4000-7000-000000000002',barber_id:demoBarbers[1].id,name:'Saç Kesimi',category:'Saç Kesimi',price:20,currency:'GBP',duration_min:30,is_active:true});
demoBarbers[4].services.push({id:'20000000-0000-4000-7000-000000000005',barber_id:demoBarbers[4].id,name:'Saç Kesimi',category:'Saç Kesimi',price:18,currency:'EUR',duration_min:30,is_active:true});
const comments=['Randevu saatinde başladık. Kesim tam istediğim gibi oldu.','Sakal çizgisi ve sıcak havlu bakımı güzeldi.','Dükkan temiz, işini özenle yapıyorlar.','İlk kez geldim. Rahat bir ortam, tekrar uğrayacağım.','Saç kesimi kısa sürdü, sonuçtan memnun kaldım.','Ne istediğimi dinleyip ona göre bir kesim yaptılar.'];
demoBarbers.forEach((barber,index)=>{
  const fives=Math.round((barber.avg_rating-4)*barber.review_count);
  barber.reviews=Array.from({length:barber.review_count},(_,i)=>({
    id:`40000000-0000-4000-8000-${String(index*100+i+1).padStart(12,'0')}`,barber_id:barber.id,
    rating:i<fives?5:4,comment:comments[(index+i)%comments.length],created_at:new Date(Date.UTC(2026,9,14-i,10)).toISOString()
  }));
});
