# Cihaz bildirimleri

18 Ekim 2026. F24 PWA ve isteğe bağlı Web Push tamamlandı. Bildirimler penceresindeki Cihaz bildirimleri alanından bu tarayıcı için açılır/kapatılır. İzin kendiliğinden sorulmaz. iPhone/iPad'de önce Paylaş → Ana Ekrana Ekle ile kurup uygulama ikonundan açmak gerekir. Eski worker etkinse Güncelle işlemi tamamlanmalı ve bildirim penceresi yeniden açılmalıdır.

## Veri ve güvenlik

v3_10_push.sql abonelikleri, kuyruğu ve dar kapsamlı RPC'leri ekler. push_subscriptions kayıtlarını yalnızca sahibi, doğrulanmış oturumla okuyabilir/silebilir. Kayıt RPC'si MFA, kullanıcı engeli, dakikada on deneme ve kişi başına beş cihaz sınırını denetler; başka hesaba ait endpoint devralınamaz. Anahtar biçimleri ve bilinen HTTPS push sağlayıcıları veritabanında ve Edge içinde doğrulanır. İstemcinin doğrudan INSERT/UPDATE yetkisi yoktur. Yeni tablolar Realtime yayınına alınmaz.

Yeni uygulama içi bildirim, o sırada abone olan cihazlar için yalnızca kimliklerden oluşan private.push_queue kaydı açar. Önceki bildirimler geriye dönük gönderilmez. Okundu işlemi kuyruğu siler. appointment_reminder türünde randevunun hâlâ onaylı, gelecekte ve aynı saatte olması gönderimden hemen önce tekrar denetlenir. 24/2 saat hatırlatma üreticisi sonraki yayında eklendi; güncel kapsam HATIRLATMALAR.md dosyasındadır. E-posta bölümü ayrıca tamamlanmalıdır.

Kilit ekranında sadece “Yeni bir bildirimin var. Görmek için BERBER hesabına giriş yap.” görünür. Şifreli push yükü yalnızca sürüm işaretidir; kişi, telefon, randevu ayrıntısı, müşteri notu veya URL içermez. Worker gelen yükü okumaz. Tıklama güvenli giriş sayfasını açar veya mevcut giriş sekmesini odaklar; açık form sekmesini yönlendirmez. Çıkışta bu cihaz aboneliği temizlenir; ağ hatası çıkışı engellemez. OS tarafından kabul edilmiş bir bildirim geri alınamayabileceğinden metin daima geneldir.

## Gönderim

send-push Edge Function JWT doğrulaması açık olarak çalışır. Ayrıca Vault'ta tutulan görev sırrı gerekir. Anahtar çifti ilk yetkili çağrıda sunucu belleğinde oluşturulur ve atomik servis RPC'siyle Vault'a kaydedilir. Özel anahtar istemciye, depoya, yanıta veya loga yazılmaz; kütüphanenin ECE_KEYLOG seçeneği yüklenmeden önce kapatılır. İstemci sadece açık VAPID anahtarını alır. Anahtarlar otomatik döndürülmez; değişim eski cihazlarda yeniden abonelik gerektirir.

v3_11_push_zamanlama.sql dakikalık berber-push-dispatch cron'unu kurar. Anahtar kurulumu tamamlanmış ve kuyruk boşsa Edge HTTP çağrısı yapılmaz. Görev sırrı Vault'tadır; SQL içinde yalnızca mevcut public anon JWT bulunur. Gönderim fonksiyonu servis yetkisiyle en fazla 25 işi SKIP LOCKED üzerinden üç dakika kiralar ve en fazla dört paralel HTTP isteği yapar. Her istek beş saniye toplam zaman aşımı ve yönlendirme yasağıyla sınırlandırılır. TTL en fazla beş dakikadır ve hatırlatmanın başlangıcını aşmaz. Ağ/sağlayıcı hatalarında sınırlı gecikmeli yeniden deneme, en fazla beş deneme ve bir saat kuyruk ömrü vardır. 404/410 cihaz kaydını ve bağlı işleri temizler. Lease token eski işçinin yeni işi onaylamasını önler. Çökme sonrası tekrar teslim olasılığı vardır; aynı topic/tag bildirimleri birleştirir. Teslimat ve OS gösterimi tarayıcı/sağlayıcı/ağ durumuna bağlıdır.

Sürümü sabitlenmiş web-push 3.6.7 yalnızca standart şifreli isteği hazırlar; gönderimi native fetch yapar. Supabase istemcisi 2.117.3 ve deno.lock depodadır. Ek bir ücretli push hesabı veya e-posta sağlayıcısı gerekmez. [Web Push kütüphanesi](https://github.com/web-push-libs/web-push), [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Supabase Vault ve zamanlama](https://supabase.com/docs/guides/functions/schedule-functions).

## Doğrulama

Yerel PostgreSQL güvenlik paketi 136 senaryo, gerçek Chrome push arayüzü/worker sekiz senaryo, Deno Edge beş senaryo geçti. Edge testi gerçek şifreleme kütüphanesi ve kontrollü HTTP yanıtları kullanır; gerçek cihaza push yollamaz. Chrome izin reddi, iOS açıklaması, eski worker, kayıt hatasında geri temizleme, oturum değişimi, kapatma sahiplik filtresi, geç gelen sorgu ve özel payload'ın yok sayılması denetlendi. Mevcut bildirim 18, müşteri 28, panel 24 ve gerçek PWA altı senaryosu yeniden geçti. 360 px görünüm incelendi.

Canlıda iki yeni migration uygulandı; send-push aktif ve JWT doğrulaması açık. Gerçek pg_net → Edge ilk kurulum çağrısı HTTP 200, sent:0/failed:0 döndü; üç Vault kaydının yalnızca varlığı doğrulandı. Özel anahtar okunmadı. Anon sırlara, oturumlu istemci işçi RPC'lerine erişemiyor. Test amacıyla gerçek kullanıcı adına bildirim, abonelik veya randevu oluşturulmadı. Gerçek cihaz OS izin/teslimat deneyi kullanıcının kendi tercihinden sonra yapılabilir.

Advisors: yeni güvenlik WARN yok. Beş RLS-politikasız INFO'nun biri bilinçli kapalı private.push_queue; önceki bir anonim/dört oturumlu definer ve kapalı sızmış parola koruması uyarısı aynı. Performansta 26 kullanılmamış indeks INFO (henüz boş abonelik ve kuyruk dahil), önceki tek çoklu UPDATE politikası WARN var. [Kapalı RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer izinleri](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [indeksler](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politikalar](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Geri dönüş

Önce berber-push-dispatch cron'unu durdur, sonra arayüzü önceki sürüme al. Vault anahtarlarını ve abonelikleri silme; tekrar açıldığında aynı anahtarlarla devam edilir. Eski migration dosyalarını değiştirme veya yeniden uygulama. Kuyruk/abonelik şeması kalabilir. PWA worker geri dönüşü PWA.md içindedir; hesap oturum deposu veya diğer uygulamaların önbelleği silinmez.
