# V2 — Randevu yönetimi

Bu sürüm manuel randevu, iptal süresi, gelmeme takibi, müşteri engelleme ve ortak tasarım sistemini ekler.

## Veritabanı

Mevcut V1 projesinde yalnızca `supabase/v2_01_randevu_yonetimi.sql` uygulanır. Dosya transaction içinde çalışır ve tekrar uygulanabilir. `schema.sql`, `security.sql`, `customer.sql`, `panel.sql`, `runtime.sql` yeniden çalıştırılmaz ve değiştirilmemiştir. Migration mevcut Supabase projesine uygulanmıştır.

- `appointments`: nullable `customer_id`, `guest_name`, `guest_phone`, `source` ve `no_show` durumu. Mevcut kayıtların kaynağı `online` olur. Misafir yalnızca `manual` kaynağıyla ve ad/telefonla kaydedilir.
- Manuel kayıt yalnızca dükkan sahibi ve mevcut `mfa_ok()` kontrolüyle oluşturulur. Hizmetin fiyat/süre bilgisi sunucudan alınır; kayıt doğrudan onaylanır. Misafir için bildirim veya yorum oluşturulmaz. Kayıtlı müşteri seçildiğinde randevu müşterinin hesabında görünür ve onay bildirimi gider.
- Müşteri araması tam, normalize edilmiş telefonla yapılır. Yalnızca dükkan sahibi çağırabilir; ad, telefon ve seçim için kimlik döner. Hesap listesi veya e-posta açılmaz.
- `barbers.cancel_hours_before`: varsayılan 2; 0 gelecekteki randevularda saat sınırını kaldırır. Müşteri iptal sınırı trigger içinde kontrol edilir. Saat önerisinde önerilen başlangıç esas alınır. Berber aktif randevuyu sebep yazarak iptal edebilir.
- `no_show`: yalnızca saati gelmiş onaylı randevuda berber tarafından işaretlenir. Toplam gelmeme sayısı yalnızca kendi dükkanındaki bekleyen müşteri talebini değerlendiren berbere açılır; başka dükkan veya randevu ayrıntısı dönmez.
- `blocked_customers`: sahibi için SELECT/INSERT/DELETE politikaları vardır; güncelleme ve anonim erişim verilmez. Engellemek için müşterinin o dükkanda bir randevu kaydı bulunmalıdır. Engelleme mevcut randevuları iptal etmez; yeni online talepler genel hata mesajıyla reddedilir. Berber bilinçli olarak manuel randevu ekleyebilir.
- Misafir saat değişikliği için mevcut kayıt iptal edilip yeni randevu eklenir; hesabı olmayan müşteriye uygulama içi saat kabulü gönderilmez.

## Arayüz

Panelde Randevu Ekle ve Engellenen Müşteriler sekmeleri; randevu kartlarında kaynak, gelmeme sayısı ve engelleme işlemleri bulunur. İptal süresi dükkan profilinden değiştirilir. Müşteri ekranında süre dolunca telefon/WhatsApp iletişimi gösterilir. Gizlilik metni toplam sayının paylaşımını açıklar; veri anonimleştirilmiş gibi tanımlanmaz.

Ortak CSS tüm mevcut sayfalarda sıcak koyu renkleri, Fraunces/DM Sans ailelerini, 1.25 başlık ölçeğini, metinli durum rozetlerini, görünür odak halkasını ve azaltılmış hareket tercihini uygular. Renk değerleri `css/style.css` başındaki değişkenlerde tutulur. V1 bileşenleri aynı değişkenlere bağlanan adlarla uyumlu kalır. Açık yüzey değişkenleri ilerideki QR/yazdırma/e-posta aşaması için tanımlıdır; bu özellikler henüz eklenmemiştir.

## V1'den etkilenen yerler

Yeni migration mevcut randevu koruma, bildirim, yorum ve panel listeleme fonksiyonlarını günceller; INSERT politikasını yeni kaynaklara uyarlar. Çakışma kısıtı, çalışma saatleri, hizmet süresine göre uygun saatler, Auth/TOTP, kurtarma servisi ve eski veriler korunur. Ön yüzde panel, randevularım, dükkan detayı, gizlilik metni, Türkçe sözlük ve ortak stil değişir.

## Doğrulama ve sınırlar

Yerel PostgreSQL motorunda 24 V1 ve 12 V2 senaryosu geçti. V2 migration iki kez uygulanarak veri kaybı ve tekrar çalıştırma kontrol edildi. Ortak/panel modül testleri, 24 panel ve 28 müşteri tarayıcı senaryosu ile hesap güvenliği testleri geçti. Responsive kontroller 360, 390, 768, 1024 ve 1440 px; klavye, uzun metin, odak, azaltılmış hareket ve yüksek kontrast durumlarını kapsar.

Tarayıcı senaryoları kontrollü Supabase istemcisi kullanır; canlı projeye sahte kullanıcı veya randevu eklenmedi. Yazı tipi ağı testte kapatıldığı için ekran görüntüleri yerel font yedekleriyle üretildi. Gerçek cihaz/ekran okuyucu ve gerçek hesapla uçtan uca kullanım ayrıca kontrol edilmelidir.

## Advisors

Migration sonrasında yeni güvenlik uyarısı oluşmadı. Önceden bulunan kurtarma tablolarındaki politikasız RLS bilgileri ile boş saat/MFA fonksiyon izinleri devam ediyor. Sızmış parola korumasının kapalı olduğu Auth uyarısı da önceden vardı: [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Performans raporu [kullanılmamış indeksleri](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) ve randevularda müşteri/berber için ayrı UPDATE politikalarından kaynaklanan [birden çok izin verici politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) bilgisini gösteriyor. Yeni indeksler henüz az kullanılan canlı verilerde kullanılmamış görünebilir; bu nedenle kaldırılmadı.

## Elle test edilecek senaryolar

1. Berber hesabında hizmet ve çalışma saatleri hazırken misafir randevusu ekleyin. Kaynak Manuel, durum Onaylandı olmalı; aynı saatte ikinci kayıt reddedilmeli.
2. Tam telefonla kayıtlı müşteriyi arayıp seçin. Randevu müşteri hesabına ve bildirimlerine gelmeli; misafir bilgileri diğer müşterilere açılmamalı.
3. İptal sınırını 2 yapın. Müşterinin iki saatten az kalan randevuda iptal yerine iletişim bağlantıları gördüğünü doğrulayın. Sınırı 0 yapıp gelecekteki randevunun iptal edilebildiğini kontrol edin.
4. Berber iptalinde boş sebebi ve dolu sebebi deneyin. Kayıtlı müşteriye bildirim gelmeli.
5. Gelecekteki randevuda Gelmedi düğmesi bulunmamalı. Saati gelmiş onaylı randevuda işaretleyip müşteri rozetini kontrol edin.
6. Bekleyen yeni talepte yalnızca toplam gelmeme sayısını görün. Başka berberin aynı kayda erişemediğini kontrol edin.
7. Müşteriyi engelleyin; o müşteriyle aynı dükkana yeni online talep gönderin. Genel hata beklenir. Engellenenler sekmesinden engeli kaldırıp tekrar deneyin. Mevcut randevular korunmalı.
8. TOTP açık berberin ikinci faktör doğrulanmadan hassas işlemleri yapamadığını; TOTP kapalı hesabın normal çalıştığını kontrol edin.
9. Mobil menüyü, 8 panel sekmesini, tarih/saat seçimini ve yeni renkleri telefonunuzda kontrol edin.

Sonraki aşama favoriler ve takvime ekleme akışıdır; bu aşamada uygulanmamıştır.
