# Randevu hatırlatmaları

18 Ekim 2026. Son başlanan çalışma tamamlandı: 24/2 saat uygulama içi hatırlatmalar, mevcut isteğe bağlı push kanalına bağlantı ve berber için WhatsApp hazır mesajı. F9'un e-posta bölümü bu yayına dahil değildir. Bağlı Resend anahtarı ve doğrulanmış gönderici bulunmuyor; e-posta kuyruğu, günlük e-posta kotası ve email_reminders tercihi ayrıca tamamlanmalıdır. Supabase Auth e-postaları uygulama hatırlatma sağlayıcısı yerine kullanılmaz.

## Davranış

Onaylı, gelecekteki, kayıtlı müşteriye ait randevular işlenir. Dükkan onaylı ve aktif, müşteri engellenmemiş olmalıdır. Misafir, bekleyen, ret, iptal, yeni saat önerisi, geçmiş randevu ve onaysız dükkan kapsam dışıdır. Başlangıca 24 saat veya daha az, iki saatten fazla kaldığında 24h hatırlatması; iki saat veya daha az kaldığında 2h hatırlatması üretilir. Yakın saatte yeni onaylanan randevuda eski 24h mesajı gönderilmez, yakın hatırlatma seçilir. Her kontrol en fazla 200 kaydı işler ve 2h grubunu önce alır.

Cron on dakikada bir çalışır; normal durumda bildirim bu aralık içinde hazırlanır. Kesinti ve yoğunluk gecikmeye yol açabilir. Metin dükkan, hizmet, gerçek tarih ve saati Europe/Nicosia ile gösterir. Not, telefon veya e-posta içermez. E-posta ayarlarından bağımsız uygulama içi bildirim üretilir. Push için kullanıcının bu cihazda bildirimleri açması gerekir; kilit ekranında yine yalnızca genel metin görünür. [Push ayrıntıları](PUSH.md).

appointments.reminder_24h_sent_at ve reminder_2h_sent_at uygulama içi bildirimin üretildiği anı tutar; OS teslim veya e-posta gönderim kanıtı değildir. UPDATE ... WHERE işaret IS NULL RETURNING ile işaret alınır ve bildirim aynı veritabanı işleminde eklenir. Yazma hatasında ikisi birlikte geri alınır. Satır kilidi/SKIP LOCKED ve işaretler tekrar çalıştırmada ikinci bildirim oluşmasını engeller. İptal veya yeni saat önerisi eski hatırlatmayı okundu yaparak push kuyruğunu da temizler. Yeni saat kabul edilip gerçek başlangıç değiştiğinde iki işaret sıfırlanır.

Berber panelinde gelecekteki onaylı randevu ve görünür geçerli telefon varsa WhatsApp’tan hatırlat bağlantısı görünür. Hazır mesaj bugünü, yarını veya tarihi Kıbrıs takvimine göre belirtir. Yaz saati geçişi takvim günü hesabını bozmaz. Düğme WhatsApp'ı hazır mesajla açar; mesaj otomatik gönderilmez. Müşteri notları mesaja girmez.

## Kurulum ve güvenlik

Mevcut projede sıra tamamlandı: v3_12_hatirlatmalar.sql → send-reminders Edge yayını → v3_13_hatirlatma_zamanlama.sql. Aynı migration dosyaları yeniden uygulanmaz veya düzenlenmez; sonraki değişiklik yeni migration olmalıdır. send-reminders JWT doğrulaması açıktır. Ayrıca x-reminder-secret başlığındaki Vault görev sırrı doğrulanır. Sır sunucuda rastgele üretilir; değer repo veya istemciye yazılmaz. Public anon JWT tek başına gönderim başlatamaz. Üretim/config RPC'leri yalnızca service_role tarafından çağrılır; public sarmalayıcılar invoker, dar kapsamlı yardımcılar private şemasındadır. [Supabase zamanlama](https://supabase.com/docs/guides/functions/schedule-functions).

Mevcut private.guard_appointment fonksiyonunun içeriği değiştirilmedi. INSERT ve UPDATE tetikleyicileri ayrıldı. Sadece gerçek service_role veritabanı rolü, aynı JWT rolü ve yalnızca hatırlatma işaretlerinin değiştiği UPDATE iş geçişi kontrolünden ayrılır. Durum, saat, müşteri veya başka bir alan değişiyorsa eski kontroller aynen çalışır. İstemci işaret sütunlarına yazamaz; ayrı tetikleyici de bunu denetler. Onay, ret, iptal, MFA, çakışma ve fiyat kuralları korunur.

## Kontroller

145 yerel PostgreSQL senaryosu geçti; bunların dokuzu yeni hatırlatma güvenlik/işlem/zamanlama senaryosudur. Bildirim hatasında atomik geri alma, tekrar çalıştırma, 2h önceliği, iptal, gerçek öneri/kabul akışında işaret sıfırlama, yetki sınırı ve doğru public JWT/Vault başlığı test edildi. Yerel motor tek bağlantılıdır; ayrı bağlantılarla eşzamanlı yük testi yapılmadı. Deno Edge dört, WhatsApp saat/URL üç, Chrome panel 25, müşteri 28, bildirim 18 ve gerçek PWA altı senaryosu geçti. 360 px panel görüntüsü incelendi. Mesajlar ve hesaplar kontrollü yerel test verileridir.

Canlıda Edge/Vault/pg_net sağlık kontrolü 200 ready:true döndü. Üretim görev kontrolü, uygun gerçek randevu olmadığı doğrulandıktan sonra boş sonuçla denetlendi. Gerçek müşteri adına test randevusu veya test bildirimi oluşturulmadı; WhatsApp mesajı gönderilmedi. Gerçek cihaz push teslimatı ayrıca kullanıcı iznine bağlıdır.

Advisors'ta yeni güvenlik WARN yok: beş bilinçli kapalı RLS INFO, önceki bir anonim/dört oturumlu definer ve kapalı sızmış parola koruması uyarısı sürüyor. Son performans taramasında 25 kullanılmamış indeks INFO ve önceki tek çoklu UPDATE politikası WARN var; indeks sayısı kullanıma göre değişebilir. [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer izinleri](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [indeksler](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politikalar](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Geri dönüş

Önce berber-appointment-reminders görevini pasif yap, sonra arayüzü önceki sürüme al. İşaretleri veya bildirim geçmişini silme; aynı randevuya tekrar bildirim oluşturulmamalıdır. Eski randevu tetikleyicisine dönmek gerekirse yeni migration içinde appointment_guard_update kaldırılıp appointment_guard mevcut private.guard_appointment fonksiyonunu INSERT OR UPDATE için çağıracak şekilde geri kurulur. Gönderim durdurulmuşken işaret alanları kalabilir. Kullanıcı oturumları, VAPID anahtarları ve önceki SQL dosyaları değiştirilmez.

Bu ürün zamanlayıcısı, sohbetin otomatik geliştirme takibinden ayrıdır. Kullanıcının talebi doğrultusunda sohbetin devam otomasyonu duraklatılmış olarak kalır.
