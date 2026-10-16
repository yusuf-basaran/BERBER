# Paylaşım ve randevu yönetimi genişletmesi

17 Ekim 2026. v2_05, v2_06 ve v3_01–v3_05 yeni migration dosyaları canlı Supabase projesine sırayla uygulandı. Önceden uygulanmış SQL dosyaları değiştirilmedi veya tekrar çalıştırılmadı. Canlı cron geçmişinde belge temizleme çağrısının SQL tırnak hatasıyla durduğu görüldü; yeni v2_07_belge_gorevi.sql görevi düzeltti. Gerçek pg_net → Edge Function çağrısı HTTP 200, removed=0/pending=0 ile doğrulandı; süresi dolmuş dosya yoktu.

## Tamamlanan kapsam

Dükkan adından benzersiz kısa bağlantı atanır. Sahibi bağlantıyı değiştirebilir; eski bağlantının ve QR'ın geçersiz kalacağı belirtilir. /b/kisa-ad yalnızca aktif, onaylı dükkan açar. Paylaşım sekmesinde kopyalama, WhatsApp bağlantısı, PNG/SVG QR indirme ve A5 yazdırma bulunur. Galeri yeni yüklemelerde 1600 piksel ana görsel ve 480 piksel küçük görsel üretir. İki dosyanın yükleme ve silme durumları birlikte doğrulanır; eski görseller ana dosyayla çalışır.

Yönetici araçlarında sayı özeti, 20 satırlık kullanıcı arama/engelleme ve yorum şikayeti incelemesi vardır. Bu işlemler üyelik, doğrulanmış TOTP ve aal2 gerektirir; kararlar gerekçeyle denetim kaydına yazılır. Yönetici üyeleri buradan engellenemez. Berber yalnızca kendi dükkanının yorumuna yanıt verebilir; puanı, yorumu veya gizleme durumunu değiştiremez. Yönetici gizleyince puan ortalaması yeniden hesaplanır.

Veritabanı aynı kullanıcıyı kilitleyerek toplam üç bekleyen, aynı dükkanda bir bekleyen ve Kıbrıs gününe göre günlük on talep sınırını uygular. Profil ve yorum işlemleri ayrıca hız sınırına tabidir. Engelli hesapların randevu, yorum ve bekleme girişleri kapalıdır. Otomatik onay kapalı/güvenilir/tümü seçenekleriyle çalışır; güvenilir için aynı dükkanda en az iki tamamlanan ve sıfır gelmedi kaydı gerekir. Çakışma ve talep limitleri sürer. Müşteri sonuç ekranı otomatik onay durumunu açık gösterir.

Uygun saat yoksa ayrı bekleme formu açılır. Kullanıcı en fazla beş aktif talep tutabilir. İptalde uygun en eski üç bekleyene uygulama içi bildirim gider; saat ayrılmaz. Kullanıcı kendi kayıtlarını listeler ve silebilir. Geçmiş kayıtları saatlik cron kapatır. Bekleme e-postası F9 gönderim altyapısına bağlıdır ve bu sürümde tamamlanmış sayılmaz.

Turnstile istemci akışı, token yenileme/hata davranışı ve CSP hazırdır. Canlı site anahtarı ile Supabase Attack Protection sağlayıcı ayarı eksiktir. Boş anahtarla bot korumasının etkin olduğu iddia edilmez; kurulum TURNSTILE-KURULUM.md dosyasındadır.

## Etkilenen mevcut yerler

Panel sekmeleri ve profil ayarları, herkese açık dükkan sorguları, detay sayfası, galeri yükleme/silme, favori kartları, randevu sonuç ekranı, bildirim bağlantıları, hesap gönderimleri, kök göreli sayfa yolları ve vercel.json genişletildi. V1 MFA, randevu durum koruması, hizmet süresine göre boş saatler ve mevcut galeri akışı korunur. Yeni özel tablolar Realtime yayınına alınmadı.

## Doğrulama

107 PostgreSQL senaryosu geçti. Mevcut panel, galeri, başvuru, hesap, yönetici ve bildirim tarayıcı kontrolleri tekrar çalıştırıldı. Yeni altı tarayıcı senaryosu gerçek QR üretimi/PNG-SVG indirme, kısa bağlantı değiştirme, otomatik onay ayarı, yönetici engelleme/şikayet, iç içe olmayan bekleme formu ve 360 piksel taşmayı doğruladı. Turnstile için kontrollü sağlayıcıyla widget, token yenileme ve hata reddi ayrıca test edildi. Auth/Storage test şemaları yereldir; canlı kullanıcı adına test randevusu üretilmedi.

Elle: Paylaşım sekmesinden QR indirip okut; kısa adı değiştir ve yeni linki aç; onaysız dükkan bağlantısını dene. Galeri yükle, kapak yap, sil. Otomatik onayı üç modda dene; gelmedi kaydının güvenilir kuralını durdurduğunu kontrol et. Dolu günde beklemeye gir, iptalde bildirim bağlantısını aç. Yönetici TOTP ile kullanıcı engelle/geri aç ve şikayeti gerekçeyle incele. Müşteri hesabıyla yönetici ve başka dükkan verisine erişimin kapalı olduğunu kontrol et.

## Advisors

Yeni açık erişim veya eksik FK indeksi uyarısı yok. Dört özel/kurtarma tablosu istemci politikası olmadan bilinçli kapalıdır; bunlara istemci erişimi verilmez: [RLS bilgisi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Önceki bir anonim ve dört oturumlu definer uyarısı sürer; kimlik, sahiplik ve MFA kontrolleri korunmuştur: [definer izinleri](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Sızmış parola koruması hesap ayarında kapalıdır: [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Yirmi kullanılmamış indeks bilgisi yeni tablolar ve düşük trafik nedeniyle korunur: [indeks değerlendirmesi](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Önceki iki randevu UPDATE politikasının performans uyarısı sürer: [politika değerlendirmesi](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Geri dönüş ve sonraki işler

Önceki frontend commit'ine dönülebilir; yeni veriler silinmez. Gerekirse otomatik onay kapatılır ve berber-waitlist-expire cron görevi pasifleştirilir. Veritabanı düzeltmeleri yeni migration dosyasıyla yapılır. Sıradaki kapsam haftalık takvim/istatistik ve hatırlatma altyapısıdır. Veri hakları, harita, SEO, kampanya, sadakat, PWA/push, İngilizce ve çok çalışanlı geçiş ayrıca tamamlanmalıdır. berber.com için domain satın alma/bağlama yapılmadı; üretim adresi berber-1.vercel.app olarak korunur.
