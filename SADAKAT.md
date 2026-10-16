# Sadakat kartı

17 Ekim 2026. F23, supabase/v3_09_sadakat.sql ile eklendi. Önceki SQL dosyaları ve randevular değiştirilmedi. Dükkanlarda program varsayılan olarak kapalıdır.

## Kullanım

Onaylı ve aktif berber panelde Sadakat sekmesinden programı açar; bir ödül için 1–50 damga ve 2–120 karakterlik ödül açıklaması belirler. Geçmişteki tamamlanmış kayıtlı müşteri randevuları dahil her tamamlanmış ziyaret bir damga kazandırır. Kayıtlı müşteri için manuel randevu da dahildir; misafir, bekleyen, onaylı fakat tamamlanmamış, reddedilmiş, iptal ve gelmedi kayıtları damga kazandırmaz.

Müşteri Randevularım içinde dükkan bazında kullanılabilir damga, ödül eşiği/açıklaması, ilerleme ve hazır ödül sayısını görür. Liste 12 dükkanla sayfalıdır. Berber aynı bilgiyi mevcut özel müşteri kartının içinde görür. Ödülü kullandı işlemi, o müşteriye ait tamamlanmış randevunun açılır kartından yapılır; berber önce kullanım onayını verir. İptal edilebilen gelecek randevularda damga tüketilmez. Ödülün ne olduğu berberin açıklaması ve hizmet sunumu ile belirlenir; otomatik fiyat indirimi veya ödeme eklenmez.

loyalty_progress görünümü bakiyeyi tamamlanmış randevu sayısı eksi loyalty_redemptions.stamps_used toplamından hesaplar. Yazılabilir damga sayacı yoktur. Bir randevuda en fazla bir ödül kullanılır. Dükkan satırı FOR UPDATE ile kilitlenerek aynı bakiyeden eşzamanlı kullanım sıralanır. Aynı randevu isteğinin tekrarı mevcut kullanım kimliğini döndürür ve ikinci kez düşmez; başka randevuda bakiye yetersizse işlem reddedilir.

Kullanım kaydı o günkü eşik ve ödül açıklamasını saklar. Sonradan eşik değişmesi önceki damga tüketimini yeniden hesaplamaz. Program kapatılınca yeni kullanım durur; geçmiş ve bakiye korunur. Yeniden açılabilir. Ödül açıklaması güncellense de geçmiş kullanımın açıklaması korunur.

## Güvenlik ve etkilenen yerler

Yeni tabloda RLS açıktır; yalnızca ilgili müşteri veya onaylı aktif dükkan sahibi, mfa_ok ile okur. Anon okuma, doğrudan istemci ekleme/güncelleme/silme kapalıdır. Kullanım yalnızca auth/MFA/sahiplik/dükkan/ziyaret/bakiye kontrolleri yapan private fonksiyon üzerinden gerçekleşir. Public RPC'ler invoker, sayım görünümü security_invoker=true olarak tanımlıdır. Sahiplik kilit alındıktan sonra yeniden doğrulanır. Yeni tablo Realtime dışında kalır. Sunucu anahtarı tarayıcıya eklenmedi.

Müşteri kartının özel notları veya tercih notları bu sorgulara dahil değildir. Kullanılan ödül kaydı müşteri ve dükkan ilişkisine aittir. Panel yeni Sadakat sekmesi, mevcut müşteri kartı ve Randevularım genişletildi; önceki kampanya, slot, randevu ve istatistik akışları korunur. Kullanılabilir ödül gerçek ücrette kendiliğinden değişiklik yaratmaz; F22 kampanya fiyatı ayrı sunucu kuralı olarak kalır.

## Doğrulama ve elle senaryolar

Gerçek PostgreSQL motoru PGlite üzerinde toplam 129 senaryo geçti. Yeni altı senaryo ayar doğrulaması/sahip/MFA, geçmişten sayım, misafir ve diğer durumların dışlanması, RLS/anon/başka berber, yalnızca tamamlanmış ziyarette kullanım, tekrar isteğin tek tüketimi, yetersiz bakiye, eşik değişiminde eski tüketim, programı durdurma ve tekrar migration ile veri korunmasını doğruladı. Yerel motor tek bağlantılıdır; eşzamanlı oturum stresi uygulanmadı. Sıralama dükkan satır kilidi ve appointment_id UNIQUE kısıtıyla sağlanır.

Beş Chrome senaryosu 360 px ayar kaydı, berber kartı, güvenli metin gösterimi, kimlik dışında sahte damga göndermeyen kullanım, müşteri kartı, duraklatma ve misafirde gereksiz sorgu olmamasını kontrol etti. Mevcut müşteri 28, panel 24 ve kampanya altı tarayıcı senaryosu tekrar geçti. Canlı kullanıcıya test ziyareti, damga veya ödül eklenmedi.

Elle: programı açıp eşiği iki belirle; kayıtlı müşterinin iki tamamlanmış randevusuyla kartı incele. İptal/no-show ve misafirin sayılmadığını kontrol et. Tamamlanmış randevunun müşteri kartından ödülü işaretle; yenileyip tekrar denediğinde bir kez düştüğünü doğrula. İki tarayıcı oturumundan kalan tek ödülü farklı tamamlanmış randevularda aynı anda kullan; yalnızca birinin yeni tüketim oluşturduğunu kontrol et. Eşiği değiştir, eski kullanımın düşürdüğü miktarı incele. Programı kapatıp müşterinin duraklatma bilgisini gördüğünü doğrula.

## Advisors ve geri dönüş

Migration sonrası yeni güvenlik bulgusu yoktur. Önceki dört bilinçli kapalı RLS tablosu, bir anonim/dört oturumlu definer ve kapalı sızmış parola koruması bulguları sürer. [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anon definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [oturumlu definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Kontrol anında 24 kullanılmamış indeks bilgisi ve mevcut bir çoklu randevu UPDATE politikası uyarısı vardır. [İndeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politikalar](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

Geri dönüş için program kapatılabilir ve frontend önceki sürüme alınabilir. Kazanılmış ziyaretler, kullanılan ödüller veya geçmiş fiyatlar silinmez. Veritabanı düzeltmeleri yeni migration ile yapılır.
