# V2 — Favoriler ve takvim

Bu aşama favori berberler, geçmiş randevudan tekrar rezervasyon, iCalendar indirmesi ve Google Takvim bağlantısı ekler.

## Veritabanı ve izinler

Mevcut projede `supabase/v2_02_favoriler.sql`, önceki `v2_01_randevu_yonetimi.sql` sonrasında uygulanır. Canlı projeye uygulanmıştır. Migration tekrar çalıştırılabilir; V1 SQL dosyaları ve randevular değiştirilmez.

`favorites` tablosu `(user_id, barber_id)` birincil anahtarı ve oluşturma tarihi içerir. RLS açıktır. SELECT, INSERT ve DELETE yalnızca kaydın sahibi ve mevcut `public.mfa_ok()` kontrolüyle çalışır. UPDATE ve anonim erişim verilmez. TOTP açmamış hesaplar normal şekilde kullanır. Aynı dükkanın iki kez eklenmesi idempotent olarak ele alınır; başka kişinin kaydı silinemez.

## Kullanım

- Liste kartı ve dükkan detayındaki kalp favoriyi değiştirir. Kart bağlantısı ve kalp ayrı etkileşimlerdir; düğme başka bir bağlantının içine yerleştirilmez. Seçili durum görünüm ve `aria-pressed` ile bildirilir.
- Girişsiz tıklama, güvenli dönüş adresiyle girişe gider. Seçilen dükkan kimliği en fazla 30 dakika boyunca sekme oturumunda saklanır; giriş/MFA sonrasında aynı dükkan görünür olduğunda favori ekleme tamamlanır. Özel liste yerel depoda saklanmaz.
- Menüde Favorilerim bağlantısı ve `favoriler.html` vardır. Liste on ikişer sayfalanır; boş, yükleniyor ve hata durumları bulunur. Favoriden kaldırınca liste yenilenir. Pasif dükkanlar kaybolmaz; uygunluk mesajıyla gösterilir.
- Geçmişte tamamlanan, iptal edilen, reddedilen veya Gelmedi işaretlenen randevulardaki Tekrar Randevu Al bağlantısı aynı dükkan ve hizmeti seçer. Eski saat tekrar kullanılmaz; güncel uygunluk sorgulanır. Hizmet artık aktif değilse kullanıcı yeni hizmet seçer.
- Onaylı müşteri randevuları ve güncel onay bildirimleri Takvime Ekle (.ics) ve Google Takvim'e Ekle seçenekleri içerir. İşlem anında randevu yeniden okunur; iptal edilmiş bir kaydın eski düğmesi çıktı üretemez.

## Takvim biçimi

`js/ics.js` kütüphane kullanmaz. VCALENDAR/VEVENT, VERSION:2.0, sade PRODID, sabit UID, DTSTAMP, UTC DTSTART/DTEND, hizmet ve dükkan başlığı, adres/semt/şehir, fiyat, dükkan telefonu ve bir saat önce DISPLAY alarmı üretir.

Metindeki ters eğik çizgi, virgül, noktalı virgül ve satır sonları kaçırılır. Fiziksel satırlar Türkçe harfleri ve emojiyi bölmeden en fazla 75 UTF-8 octet olacak şekilde katlanır. Satır sonları CRLF'dir. Referans: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545).

Google bağlantısı UTC zaman aralığını ve `Europe/Nicosia` görüntüleme bölgesini kullanır; kullanıcı etkinliği kendi takviminde kaydeder. `.ics` dosyasının alarmı takvim uygulamasına bağlıdır; Google bağlantısında hatırlatma ayarı takvimde kontrol edilmelidir. İçe aktarılan etkinlik tek seferlik kopyadır; sitedeki sonraki iptal veya saat değişikliği dış takvimi otomatik güncellemez. Bu özellik e-posta veya uygulama içi hatırlatma sisteminin yerine geçmez.

## V1'den etkilenen yerler

Liste kartı ortak `barber-card.js` bileşenine taşındı; mevcut arama ve filtre davranışı korunur. Dükkan detayı, menü, güvenli dönüş adresleri, müşteri randevuları, bildirim kartları, Türkçe sözlük ve ortak CSS genişletildi. Randevu sorgusuna takvim konumu için dükkan adresi eklendi. Auth/TOTP, kurtarma servisi, randevu çakışmaları, hizmet süresine göre saatler, manuel kayıt ve iptal politikası değişmedi.

## Doğrulama

- Gerçek PostgreSQL motorunda 24 V1, 12 önceki V2 ve 6 favori SQL senaryosu geçti. Yeni migration iki kez uygulanıp mevcut favorileri koruduğu kontrol edildi. Başkasının adına ekleme, silme, anonim erişim ve eksik MFA reddedildi.
- 6 takvim testi UTC, kış/yaz saati, UID, alarm, metin enjeksiyonu, UTF-8 katlama, Google parametreleri ve geçersiz durumları kontrol etti.
- 12 yeni Chrome senaryosu favori ekleme/kaldırma, girişten dönüş, boş/hata durumu, gerçek indirme, Google açılışı, eski düğmeyle iptal edilmiş randevu, tekrar rezervasyon, bildirimden indirme ve çıkış gizliliğini kontrol etti.
- Mevcut müşteri, bildirim ve responsive senaryoları geçti. Yeni sayfa 360 ve 1440 px'de görsel olarak kontrol edildi. Testler kontrollü Supabase istemcisiyle çalışır; canlı projeye sahte hesap/favori/randevu eklenmedi. Yazı tipi ağı testte kapalıdır; ekran görüntüleri yerel font yedekleriyle üretilir.

## Advisors

Migration sonrasında yeni güvenlik uyarısı yok. Önceden bulunan kurtarma tablolarındaki politikasız RLS bilgileri, mevcut boş saat/MFA fonksiyon izinleri ve [kapalı sızmış parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) uyarısı devam eder.

Performans raporunda yeni `favorites_barber_idx` ve `favorites_user_created_idx` indeksleri henüz [kullanılmamış indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) bilgisiyle görünüyor; trafik oluşmadan kaldırılmadılar. Mevcut randevu UPDATE politikalarına ait [birden çok izin verici politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) bilgisi de devam eder.

## Elle test edilecek senaryolar

1. Ana sayfada kalbe basın; dükkan sayfası açılmadan favori değişmeli. Favorilerim'e gidip kaldırın.
2. Çıkış yapıp kalbe basın; giriş/MFA sonrasında önceki sayfaya dönün ve eklemenin tamamlandığını kontrol edin.
3. Başka bir hesapla giriş yapın; önceki hesabın favorileri görünmemeli. TOTP açık hesapta ikinci faktör gerekliliğini deneyin.
4. Onaylı randevudan `.ics` indirin. Kullandığınız takvimde saat, adres, hizmet ve bir saatlik alarmı kontrol edin. Google bağlantısıyla da etkinliği açıp kaydedin.
5. Aynı randevuyu iptal edin. Eski açık sekmedeki takvim düğmesine basınca yeni dosya oluşmamalı; listeyi yenileyince düğme kaybolmalı.
6. Onay bildiriminden takvim dosyası indirin. Artık onaylı olmayan bir randevunun bildiriminde takvim işlemi görünmemeli.
7. Geçmiş randevuda Tekrar Randevu Al'a basın; hizmet seçili, saat seçimi boş ve uygunluk güncel olmalı.
8. Telefonda kalp hedefini, menüyü, favori kartını ve takvim düğmelerini klavye/dokunma ile deneyin.

Sonraki aşama galeridir; bu aşamada eklenmemiştir.
