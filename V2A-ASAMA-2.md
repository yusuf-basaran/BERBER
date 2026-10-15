# Berber onayı — veritabanı ve erişim sınırları

16 Ekim 2026. A1 + A3 altyapısı tamamlandı. `supabase/v2a_01_berber_onayi.sql` canlı Supabase projesine uygulandı. Önceki V1 ve V2 SQL dosyaları değiştirilmedi. Yönetici karar ekranı, ilk yönetici ekleme SQL'i ve karar bildirimleri sonraki A4 aşamasındadır; henüz yönetici hesabı eklenmedi.

## Durum geçişi ve kayıtlar

`barbers` tablosuna `verification_status`, `rejection_reason`, `admin_note`, `checklist`, `submitted_at`, `decided_at`, `decided_by`, `application_count`, `instagram_url` eklendi. Durum pending/approved/rejected/suspended ile, başvuru sayısı 1–3 ile sınırlıdır. Kontrol listesi yalnızca dört belirlenmiş boolean anahtar kabul eder. Açıklama ve Instagram bağlantısı da veritabanında doğrulanır.

İlk migration mevcut dükkanlara approved değerini verir, ardından yeni kayıt varsayılanını pending yapar. Tekrar çalıştırmak sonradan gelen başvuruları onaylamaz veya kararları sıfırlamaz. INSERT trigger, ayrıcalıklı ekleme dahil gönderilen karar alanlarını sıfırlar; yeni dükkan her durumda pending başlar. `owner_id` mevcut UNIQUE kısıtı korunur. Ön kontrolde ve migration içinde mükerrer sahip denetimi vardır; kayıt silme yapılmaz.

İstemciye karar alanlarında INSERT/UPDATE verilmez. UPDATE trigger ikinci bir koruma sağlar. Yönetici hesabına da doğrudan tablo UPDATE politikası eklenmedi. Yetkili sunucu fonksiyonları ve SQL işletmecisinin veritabanı rolü güvenilen sınırdır; sonraki karar fonksiyonu üyelik/MFA/durum kontrolünden sonra karar, audit ve bildirimi birlikte yazacak. Profil kimliği ve rolünü değiştiren UPDATE ayrıca trigger ile engellenir; admin rolü `profiles.role` listesine eklenmez.

## Yönetici yetkisi ve işlem günlüğü

`admin_users` üyeliği yalnızca ayrıcalıklı SQL ile eklenebilir. İstemci üyelik ekleyemez/değiştiremez/silemez. `public.is_admin()` ancak üyelik, doğrulanmış güncel faktör, `aal2` ve mevcut `public.mfa_ok()` birlikte sağlanırsa true döner. Kayıt metadata'sı yetki kaynağı değildir. Faktörü olmayan hesapta eski bir aal2 iddiası da yeterli değildir.

`admin_audit_log` için istemci INSERT/UPDATE/DELETE izinleri yoktur. Okuma yalnızca doğrulanmış yöneticiye açıktır. UPDATE ve DELETE trigger ile SQL üzerinden de reddedilir. Aktör ve hedef UUID'leri hesap/dükkan silinmesiyle audit geçmişinin kaybolmaması için korunur. Her iki yeni tabloda RLS açık, anon yetkileri kapalıdır; Realtime yayınına eklenmediler.

## Açık ve özel veriler

`barbers` genel SELECT izni açık sütun listesine daraltıldı. Yönetici notu ve checklist hiçbir anonim/oturumlu doğrudan sorguya verilmez. Ret gerekçesi de açık dükkan sorgusunda bulunmaz; `get_barber_application` RPC'si yalnızca sahibine ve MFA kontrolünden sonra başvuru durumu/gerekçe/tarih/sayı döndürür, yönetici notunu döndürmez. Yöneticiye özel okumalar A4'te ayrı RPC ile yapılacak.

Anonim ziyaretçi ve diğer kullanıcılar yalnızca approved + aktif dükkanı görür. Sahibi kendi dükkanını MFA ile her durumda hazırlayabilir; doğrulanmış admin kamuya açık sütunlar üzerinden başvuruları görebilir. Hizmet, çalışma saati, kapalı gün ve yorum okumaları da bu dükkan görünürlüğüne bağlıdır. Gelecekte slug alanı üzerinden aynı tablodan yapılan sorgular da aynı RLS'ye tabi olur; slug sayfası henüz eklenmedi.

`search_barbers` ve özellikle RLS'yi aşan `get_available_slots` içinde ayrıca approved + aktif kontrolü vardır. Yeni online/manüel randevular hem politika hem dükkan satırını kilitleyen INSERT trigger ile korunur. `check_window` da onay kontrolü yapar; askıya alınmış dükkandaki eski saat önerisini kabul etmek yeni bir rezervasyona dönüşemez. Mevcut süre, çakışma, iptal ve no-show kuralları korunur.

Müşteri arama, panel randevu/istatistik, engellenen müşteri, no-show ve saat önerisi fonksiyonları onaylı/aktif sahip ve MFA ister. Galeri metadata INSERT, dosya INSERT ve hazır işaretleme de onay ister; onaylıyken ayrılmış bir dosya askı sonrası tamamlanamaz. Eski galeri kayıtlarının sahibi yarım kalmış dosyalarını temizleyebilir.

V1 `barber-photos` bucket'ı başvuru hazırlığı için kullanılabilir; yeni galeri yüklemesi onaya bağlıdır. Bucket'lar önceki tasarımdaki gibi public kalır: bilinen doğrudan görsel URL'leri özel belge erişim kontrolü sağlamaz. Açık dosya listeleme politikaları dükkan görünürlüğüne bağlandı. Opsiyonel başvuru belgeleri ileride ayrı private bucket'ta uygulanacak.

## Panel uyumluluğu

Yeni kısıtlar uygulanınca onaysız veya pasif dükkan için kapalı müşteri sorgularını çalıştırmak yerine panel profil hazırlığına açılır. Profil, hizmet, saat ve kapalı gün sekmeleri kalır; randevu/manüel/galeri/müşteri işlemleri gösterilmez. Temel durum açıklaması ve anlaşılır işlem hatası eklendi. Approved + aktif dükkanın mevcut dokuz sekmesi korunur.

Tam başvuru formu, ret gerekçeli yeniden gönderme, destek yönlendirmesi ve üç başvuru hakkının arayüzü A2 + A3 arayüz aşamasında tamamlanacak. Bu aşamada tekrar başvuru veya admin kararı için eksik bir düğme/RPC eklenmedi.

## V1'den etkilenen yerler

- Barbers ve ilişkili tablo okuma politikaları; randevu ekleme/berber güncelleme ve engelleme politikaları.
- Arama, boş saat, çalışma penceresi ve müşteri verisi döndüren panel fonksiyonları.
- Galeri yükleme/hazırlama ve fotoğraf dosyası listeleme politikaları.
- `panel.js` açık sorgu listesine durum sütunu, `panel-page.js` hazırlık yönlendirmesi, `ui.js` işlem hata çevirisi ve `i18n.js` durum metinleri.

V1 SQL içerikleri başlangıç kopyasıyla karşılaştırıldı ve aynı. Auth/TOTP/kurtarma, kullanıcı verisi, eski dükkan ve randevular silinmedi. Canlıda migration öncesi/sonrası 1 dükkan ve 1 randevu korundu; mevcut dükkan approved. Canlı projeye sahte hesap, yönetici veya test başvurusu eklenmedi.

## Test sonuçları

Gerçek PostgreSQL/PGlite üzerinde 52 önceki senaryo ve 19 yeni onay senaryosu, toplam 71 SQL senaryosu geçti. Yeni testler migration tekrarını, onayın tek seferlik taşınmasını, sahte karar alanlarını, hatalı alan izni verilse bile trigger korumasını, hazırlık işlemlerini, anonim kapıları, özel sütunları, sahip RPC'sini, randevu/galeri kısıtını, rol yükseltmeyi, admin MFA'sını, audit değişmezliğini ve mevcut yorumların gizlenirken korunmasını denetler.

Chrome'da 4 yeni hazırlık paneli, 24 mevcut panel, 9 galeri ve 12 favori/takvim senaryosu geçti; toplam 49 tarayıcı senaryosu. 360 ve 1440 px hazırlık paneli görsel olarak kontrol edildi. Tarayıcı testleri kontrollü SDK kullanır; SQL izinleri ayrı gerçek PostgreSQL testlerinde sınanır. Modüllerin sözdizimi kontrolü geçti.

Canlı REST kontrolünde açık dükkan sorgusu HTTP 200; `admin_users`, `admin_audit_log`, `admin_note` ve anonim `is_admin` çağrıları HTTP 401/42501 döndü. Yeni tabloların Realtime dışında kaldığı ve varsayılanın pending olduğu doğrulandı.

Yeni istekteki D listesinin müşteri notu izolasyonu, müşteri kartı telefon sınırı, müşteri silinince notların silinmesi ve `basvuru_karar` çağrı testleri ilgili fonksiyonlar eklendikten sonra yapılacak. Bunların bu aşamada geçtiği iddia edilmez.

## Supabase Advisors

Yeni güvenlik bulgusu: `public.is_admin()` oturumlu kullanıcının çağırabildiği bir [SECURITY DEFINER fonksiyonu](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). İstenen API biçimi için korunur; sabit boş search_path, PUBLIC/anon EXECUTE iptali, üyelik + güncel faktör + aal2 + MFA kontrolü ve yalnızca boolean çıktı vardır. İstemciye karar alanı yazma izni sağlamaz.

Önceden bulunan üç [politikasız RLS bilgisi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), `get_available_slots` için [anonim definer izni](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), mevcut boş saat/MFA fonksiyonları için oturumlu definer bilgileri ve [kapalı sızmış parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) sürer.

Yeni `barbers_verification_submitted_idx` ve `admin_audit_created_idx`, trafik oluşmadığından [kullanılmamış indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) bilgisindedir; başvuru ve audit sayfalaması için korunur. Mevcut randevu UPDATE [birden çok izin verici politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) uyarısı devam eder. Başka yeni güvenlik uyarısı yoktur.

## Elle test senaryoları

1. Mevcut berber hesabıyla giriş yapın: onaylı durum ve normal panel sekmeleri korunmalı; randevu onayı, galeri ve takvim akışını deneyin.
2. Yeni berber hesabıyla dükkan oluşturun: profil hazırlığına açılmalı; ana listede veya doğrudan dükkan adresinde görünmemeli.
3. Yeni dükkanda hizmet, haftalık saat, kapalı gün ve V1 dükkan fotoğrafı hazırlayın. Başka hesap/anonim sekmede bu hazırlık verileri görünmemeli.
4. İstemciden verification_status/admin_note/checklist/rejection_reason veya profiles.role değiştirme ve admin_users'a ekleme denemeleri reddedilmeli.
5. Onaysız dükkanda online/manüel rezervasyon ve galeri yükleme API'leri reddedilmeli; yalnızca arayüz gizlemesine güvenilmemeli.
6. TOTP açık sahip hesabında ikinci faktör tamamlanmadan özel panel ve başvuru RPC'si erişilmemeli.
7. A4'te yönetici eklendikten sonra aynı hesapta aal1 false, doğrulanmış aal2 true is_admin sonucu alınmalı. Karar/ret/askı ve bildirimler A4 test listesiyle denenmeli.

## Çalıştırma ve geri dönüş

Mevcut projede önce V2 migration'ları `v2_01_randevu_yonetimi.sql`, `v2_02_favoriler.sql`, `v2_03_galeri.sql`; ardından yalnızca yeni `v2a_01_berber_onayi.sql` uygulanır. İlk dört dosya zaten canlıda uygulanmıştır; V1 dosyalarını yeniden çalıştırmayın. Yeni migration da bu teslimatta canlıya uygulanmıştır.

Frontend GitHub main üzerinden Vercel'e yayınlanır. Eski frontend'e dönüş gerekirse veritabanı tablolarını veya onay verisini silmeyin; yeni güvenlik politikaları yerinde kalır. Önceki frontend, pending durumunu açıklamayabilir ve kapalı işlemlerde hata gösterebilir. RLS'yi kapatmak ya da tüm yeni başvuruları approved yapmak geri dönüş yöntemi değildir. Sonraki aşama admin paneli ve ilk yönetici SQL'idir.
