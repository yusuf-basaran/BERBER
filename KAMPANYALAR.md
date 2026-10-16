# Kampanyalar ve randevu fiyatı

17 Ekim 2026. F22, supabase/v3_08_kampanyalar.sql ile eklendi. Önceden uygulanmış SQL dosyaları değiştirilmedi. Kampanya oluşturulmadıkça mevcut fiyatlar aynen kullanılır.

## Davranış

Onaylı ve aktif dükkan sahibi panelde Kampanyalar sekmesinden en fazla 20 kampanya yönetir. Ad, yüzde veya sabit tutar, isteğe bağlı hizmet, günler, tarih aralığı, saat aralığı ve etkinlik seçilir. Yüzde en fazla 100; sabit tutar seçilen TRY/GBP/EUR para birimine bağlıdır. Randevu başlangıcı Europe/Nicosia yerel saatine çevrilir; tarih sınırları dahildir, bitiş saati hariçtir. 24:00 gün sonudur. Geceyi aşan kampanyalar iki ayrı aralık olarak tanımlanır. Tarih aralığı en fazla 366 gündür.

Veritabanı randevu eklenirken hizmetin asıl fiyatını alır ve en yüksek tutarlı tek indirimi uygular. Yüzde sonucu iki ondalığa yuvarlanır; sabit indirim fiyatı aşarsa ücret sıfır olur. Online, kayıtlı müşteri için manuel ve misafir randevusu aynı trigger'dan geçer. İstemci fiyat/indirim gönderemez. Eşit indirimlerde önce oluşturulan kampanya seçilir.

base_price_at_booking, discount_at_booking ve promotion_title_at_booking kayıt anının kopyasıdır; sonradan kampanya veya hizmet düzenlenmesi/silinmesi, saat önerisinin kabulü ve durum değişimi fiyatı yeniden hesaplamaz. Eski randevularda base_price_at_booking NULL, indirim sıfır kalır; geçmiş kayıtlara sahte kampanya atanmaz. Kampanya ile randevu arasında silmede geçmişi değiştirecek FK yoktur.

Liste kartı ve hizmet listesi şu anki kampanya fiyatını eski/yeni fiyat, metin rozeti ve açıklamayla gösterir. Saat seçimi ayrıca sunucudan fiyat önizlemesi alır. Önizleme ile kayıt arasında kampanya değişebilir; oluşturma yanıtındaki kesin fiyat ve kampanya kaydı gösterilir. Önizleme alınamazsa açıklama gösterilir; randevu hesaplaması yine sunucudadır. Liste filtreleri ve sıralama normal hizmet fiyatına göre çalışmaya devam eder; kampanya kartı ilgili hizmeti ayrıca belirtir.

## Güvenlik ve etkiler

promotions tablosunda RLS açıktır. Anon rolüne tablo erişimi verilmez. Sahip okuma/yazma/silme onay, aktiflik ve mfa_ok şartlıdır. Başka dükkana hizmet bağlama ve sahip değiştirme engellenir. Tablo Realtime dışında kalır.

Public fiyat fonksiyonları invoker'dır; private yardımcıları yalnızca açık fiyat alanlarını onaylı/aktif dükkanlardan döndürür. Ayrıntı en fazla 500 indirimli hizmet, kart isteği en fazla 12 dükkanla sınırlıdır. private şemasına anon USAGE yalnızca isim çözümü için verildi; canlı katalogda anon'un çalıştırabildiği private fonksiyonlar yalnızca bu iki public fiyat yardımcısıdır. Tablolara veya diğer private fonksiyonlara izin verilmedi. Definer trigger'lar ve iç hesaplama doğrudan çağrıya kapalıdır. Müşteri ve özel not alanları fiyat sorgularında bulunmaz.

Panel, manuel randevu, dükkan detay/rezervasyon, liste kartları ve Randevularım genişletildi. Takvim/istatistik mevcut price_at_booking alanını kullandığı için indirimli tamamlanmış geliri otomatik dikkate alır. Tasarım root renklerini kullanır; mobil hizmet fiyatı ayrı satırda okunur. Tüm metinler i18n sözlüğündedir.

## Doğrulama

PGlite gerçek PostgreSQL üzerinde toplam 123 senaryo geçti; yeni dokuz senaryo sahip/MFA/RLS, doğrulama, zaman/gün ve para birimi kapsamı, en iyi tek indirim, sahte fiyat reddi, manuel ücret, sıfır alt sınırı, değişmez fiyat, kapalı dükkan, kart ve tekrar migration kontrollerini içerir. Altı Chrome senaryosu 360 px panel CRUD, güvenli metin, istemci doğrulaması, liste kartı, hizmet/saat ve manuel önizlemeyi doğruladı. Mevcut müşteri 28, panel 24, SEO tarayıcı dört senaryo yeniden geçti. Canlı kullanıcılar için test kampanyası veya randevu oluşturulmadı.

Elle: panelden haftanın tek gününe/saatine yüzde kampanya oluştur; ilgili saati seç. İkinci sabit kampanyayı ekle ve tek en büyük indirimi doğrula. GBP hizmette TRY tutarın uygulanmadığını kontrol et. Online ve manuel randevuyu oluşturup kesin fiyatı incele. Kampanyayı silip eski randevunun fiyatını ve saat önerisi sonrası aynı fiyatı kontrol et. İki farklı berberle birbirinin kampanyalarını düzenlemeyi dene.

## Advisors ve geri dönüş

Canlı migration sonrası yeni güvenlik bulgusu yok: dört bilinçli kapalı tablo için [RLS bilgisi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), mevcut bir [anon definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), dört [oturumlu definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) ve kapalı [sızmış parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) uyarısı sürer. İki yeni indeksle kullanılmamış indeks bilgisi 20'den 22'ye çıktı; tablo henüz boş olduğu için korunur. [İndeks değerlendirmesi](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Mevcut çoklu randevu UPDATE politikası bulgusu değişmedi: [politika performansı](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

Geri dönüş için kampanyalar sahipleri tarafından pasifleştirilebilir ve frontend önceki sürüme alınabilir. Randevu fiyat kopyaları silinmez; canlı SQL geri düzenlenmez. Ödeme veya tahsilat özelliği eklenmedi.
