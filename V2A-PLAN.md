# Berber onayı, müşteri profili ve özel müşteri kartı

Bu belge yeni paketin planıdır. A1 + A3 altyapısı [ikinci aşamada](V2A-ASAMA-2.md), A4 yönetim paneli ve karar fonksiyonu [üçüncü aşamada](V2A-ASAMA-3.md) tamamlandı. A2 + A3 başvuru arayüzü, müşteri profili ve özel müşteri kartı V2A-ASAMA-4-6.md kapsamında tamamlandı. Genişletilmiş F1–F26 kapsamı GENISLETME-DENETIMI.md ile izlenir. Mevcut kaynaklar çalışma alanında bulunduğundan tekrar dosya gönderilmesi gerekmez.

## Mevcut yapıdan bulgular

`profiles.role` yalnızca `customer` veya `barber` olabilir. Profil kayıt sırasında `private.create_profile()` ile oluşturulur; oturumlu kullanıcıya yalnızca `full_name` ve `phone` güncelleme izni verilir. Rol değişikliği mevcut SQL testinde reddediliyor; canlı izin kontrolü de aynı iki alanı doğruladı. Yönetici için bu rol listesi genişletilmeyecek.

`barbers.owner_id` zaten UNIQUE. Canlı ön kontrolde mükerrer sahip sayısı sıfır. `barbers_read`, `services_read`, `hours_read`, `closed_dates_read` ve `reviews_read` plan başlangıcında herkese açıktı; ikinci aşamada dükkan onayına bağlandı. `public.search_barbers` invoker; `public.get_available_slots` definer olduğu için yalnızca tablo RLS değişikliği yeterli olmayacak. Slot fonksiyonu ve `private.guard_appointment` ayrıca onay durumunu denetlemeli. `private.panel_owner` sahiplik, berber rolü ve mevcut `public.mfa_ok()` kontrolünü kullanıyor.

Manuel/misafir randevusu, `blocked_customers`, no-show sayısı, `favorites`, takvim çıktısı ve galeri artık mevcut. Galeri ayrı `barber-gallery` bucket'ında; onaysız dükkanın metadata INSERT ve Storage INSERT izinleri de yeni kurala bağlanmalı. Kayıt/giriş ortak `account-page.js` üzerinden çalışıyor. Mevcut kayıt formunda dükkan başvurusu alanları yok; dükkan profili panelden hazırlanıyor.

## Uygulama sırası

1. **A1 + A3 — veritabanı sınırları:** `v2a_01_berber_onayi.sql` ile doğrulama alanları, `admin_users`, `admin_audit_log`, zorunlu aal2 ile `public.is_admin()`, değiştirilemez audit kayıtları ve durum koruma trigger'ları. Yeni dükkan zorunlu pending; mevcut dükkanlar yalnızca ilk geçişte approved yapılır. Migration tekrarında yeni pending başvurular kendiliğinden onaylanmaz. Liste/detay, ilişkili tablolar, slot fonksiyonu, online/manüel randevu ve galeri işlemleri onaya bağlanır. Hazırlık için profil/hizmet/saat düzenlemesi açık kalır. Yeni tablolarda RLS, anon yetkilerinin geri alınması ve Realtime dışında kalma doğrulanır.
2. **A4 — yönetim:** `admin.html`, sayfalı başvuru sorguları, kontrol listesi, yönetici notu ve tek karar işlemi `public.basvuru_karar`. Durum geçişi, gerekçe, audit ve berber bildirimi aynı transaction içinde yazılır. `barbers` için doğrudan admin UPDATE politikası açılmaz. İlk yönetici e-posta ile SQL üzerinden eklenir; TOTP kurulmadan yönetim işlevleri çalışmaz. Yeni başvuruda adminlere bildirim ve bekleyen sayısı gelir.
3. **A2 + A3 arayüzü — başvuru:** Berber kaydında dükkan bilgileri, V1 fotoğrafı, opsiyonel Instagram; pending/rejected/suspended bantları ve üç başvuru hakkı. E-posta doğrulaması tamamlanmadan Storage erişimi açılamayacağı için doğrulama sonrası güvenli başvuru tamamlama akışı kurulacak. Opsiyonel belge eklenirse yalnızca sahibi/adminin eriştiği private bucket ve karar sonrası 30 günlük otomatik silme birlikte uygulanacak; galeri bu amaçla kullanılmayacak.
4. **B — müşteri profili:** `profil.html`, `profiles.preference_note`, 300 karakter sınırı, mevcut telefon normalizasyonu, baş harf avatarı, hizmet tercihi uyarısı ve şeffaflık metni. Randevu öncesi ad/telefon kontrolü hem arayüzde hem `private.guard_appointment` içinde uygulanır. Müşterinin kendi tercihi ile berberin özel notu ayrı veri alanlarıdır.
5. **C — müşteri kartı:** `barber_customer_notes`, kayıtlı müşteri veya normalize misafir telefonu için birbirini dışlayan alanlar ve kısmi UNIQUE indeksler. `musteri_karti`, `musterilerim`, not kaydetme işlemleri çağıranın onaylı/aktif dükkanını oturumdan bulur; başka dükkan kimliğiyle veri istenemez. Dükkanla randevu ilişkisi ve MFA zorunludur. Telefon yalnızca confirmed/completed ilişkisi varsa döner. `musteriler.html` ve talep kartının yanında açık kalabilen müşteri kartı eklenir; müşteri tarafında özel notlara ait menü, ekran veya API çağrısı bulunmaz.
6. **D — kabul ve yayın:** İstenen on güvenlik senaryosu iki berber, müşteri ve aal1/aal2 admin oturumlarıyla çalıştırılır. Anon liste/detay/slug/slot uçları, not gizliliği, rol yükseltme, audit değişmezliği, müşteri silinmesi ve telefon sınırı ayrıca denenir. Her migration sonrası Advisors, çalıştırma sırası, Vercel doğrulaması ve veriyi koruyan geri dönüş adımları raporlanır.

## Gizlilik ve yetki ayrıntıları

RLS aynı satırın bazı sütunlarını gizleyemez. Bu nedenle `barbers` tablosuna eklenecek `admin_note` ve `checklist` için tablo düzeyindeki genel SELECT izni kaldırılıp açık sütun izinleri kullanılacak. Yöneticiye özel alanlar yalnızca yönetici RPC'sinden; sahibine özel ret gerekçesi ise sahiplik ve MFA kontrolü yapan panel sorgusundan dönecek. Bütün mevcut frontend SELECT listeleri ve embed sorguları buna göre kontrol edilecek.

Karar alanları istemciden INSERT/UPDATE ile değiştirilemeyecek. Fonksiyonların `search_path` değeri sabitlenecek; PUBLIC/anon çalıştırma izinleri açıkça geri alınacak. Özel müşteri notları bildirim, e-posta, Realtime ve dışa aktarma çıktısına eklenmeyecek. Müşteri silinince bağlı notlar FK ile silinecek; audit kayıtları değiştirilemeyecek.

Mevcut panel sorgusunun bekleyen taleplerde telefon döndürmesi yeni müşteri kartı sınırıyla birlikte gözden geçirilecek; özel kartın telefon gizliliği başka bir panel sorgusuyla aşılmayacak. Global no-show çıktısı yalnızca sayı olacak. Müşteri iptali istatistiği, kimin iptal ettiğini güvenilir biçimde kaydetmeyi gerektirir; eski kayıtlarda bu bilgi yoksa tahmin edilmeyecek, yeni işlemler için kaynak bilgisi eklenecek.

## V1'den etkilenecek yerler

`auth.js`, `account-page.js`, `barbers.js`, `appointments.js`, panel sorguları, navigasyon, bildirim türleri, galeri yazma politikaları, kayıt sayfası ve gizlilik metni genişletilecek. V1 SQL dosyaları değiştirilmeyecek; tüm değişiklikler yeni `v2a_*.sql` dosyalarında olacak. TOTP/kurtarma, rezervasyon çakışması ve hizmet süresine göre saat üretimi korunacak. Önceki plandaki özel link/QR ve hatırlatma çalışmaları bekleyen kapsamda kalır; yeni pakette onay denetimleri bunlarla uyumlu tasarlanacak.

## Elle test senaryoları

Her uygulama aşamasında ayrı liste verilecek. İlk migration için: eski dükkanın görünür kalması, yeni dükkanın pending başlaması, istemciyle kendini onaylama/rol yükseltmenin reddi, onaysız dükkanın anonim uçlardan ve yeni randevudan kapalı olması, sahibinin hazırlık yapabilmesi ve eksik ikinci faktörlü adminin yetkisiz kalması kontrol edilecek.

## Advisors

Onay altyapısı sonrasında Advisors yeniden alındı. is_admin fonksiyonunun oturumlu definer izni ve iki yeni kullanılmamış indeks bilgisi V2A-ASAMA-2.md içinde bağlantıları ve gerekçeleriyle listelenir. Her yeni migration sonrası rapor yeniden alınacak.
