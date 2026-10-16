# Ana ekrana ekleme ve çevrimdışı kabuk

17 Ekim 2026. F24'ün PWA bölümü eklendi. Push aboneliği, VAPID ve bildirim/hatırlatma gönderimi bu pakette yoktur; F24 bu nedenle kısmi durumdadır. Veritabanı veya canlı SQL değiştirilmedi.

## Davranış

manifest.webmanifest uygulama adını, başlangıç adresini, bağımsız pencere görünümünü ve 192/512 px maskable PNG ikonları tanımlar. Kullanıcının mevcut makaslı monogramı korunur; uygulama ikonunda güvenli alan içinde kullanılır. Tema/zemin renkleri scripts/pwa-uret.js tarafından css/style.css :root değerlerinden alınır. HTML'e yeni sabit renk eklenmez; tarayıcı üst çubuğu rengi pwa.js içinde aynı CSS değişkeninden okunur.

Kurulum önerisi yalnızca beforeinstallprompt sağlayan uygun tarayıcıda görünür. Kullanıcı Ana ekrana ekle düğmesine basınca tarayıcının kendi onayı açılır. Reddedilirse veya Daha sonra seçilirse öneri yedi gün ertelenir; bu tarih dışında kişisel veri saklanmaz. Bağımsız uygulama penceresinde öneri gösterilmez. Safari/iOS gibi bu olayı sunmayan tarayıcılarda yapay bir yerel kurulum düğmesi gösterilmez; cihazın kendi Paylaş/Ana Ekrana Ekle menüsü kullanılabilir. Kurulum desteği tarayıcıya bağlıdır. [MDN kurulum olayı](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event).

sw.js yalnızca yedi açık dosyayı önbelleğe alır: cevrimdisi sayfası, iki CSS dosyası, i18n sözlüğü, çevrimdışı ekran betiği ve iki küçük PWA ikonu. Ana sayfa, dükkan sayfası, hesap/güvenlik/panel HTML'i, Supabase/Storage/Auth, API, kimlikli istek ve POST yanıtı bu önbelleğe girmez. Aynı origin'deki diğer dosyalar ve tüm Supabase istekleri network/no-store kullanır. Diğer dış kaynaklar worker önbelleğine hiç alınmaz.

Navigasyonda ağ yoksa asıl sayfa yerine durum kodu 503 ve no-store ile sade İnternet bağlantısı yok ekranı gelir. Bu ekran hesap veya randevu bilgisi içermez. Tekrar Dene, mevcut adresi ağdan yeniden açar. Randevu talebi çevrimdışı kuyruğa alınmaz; internet bağlantısı gerekir. Sadece bu kabuk önceki başarılı ziyaretten sonra kullanılabilir; siteyi ilk kez çevrimdışı açmak desteklenmez.

Yeni worker kurulunca açık sekmeler varken bekler. Güncelle bildirimi form kaybını açıklar; işlem onaylanınca bekleyen worker etkinleşir ve o sekme bir kez yenilenir. İlk kurulum veya başka sekmedeki güncelleme açık formu kendiliğinden yenilemez. Aktivasyonda yalnızca eski berber-shell-* önbellekleri temizlenir. Diğer önbelleklere dokunulmaz. Yazdırma ekranında PWA bildirimleri gizlenir. [MDN yaşam döngüsü](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Üretim ve etkilenen yerler

node scripts/pwa-uret.js manifest, çevrimdışı HTML ve sw.js üretir; statik dosyaların içeriğinden sürüm hash'i hesaplar. Aynı girdiler aynı çıktıyı verir. Yeni HTML sayfalarına manifest ve bağımsız pwa.js betiği eklenir. SEO üreticisi bu etiketleri kendi şablonunda da taşır. Günlük/mevcut GitHub workflow önce PWA, sonra SEO üretimini çalıştırır; yalnızca değişiklik varsa commit eder. Üretilmiş sw.js/manifest/HTML değişimleri kendi başına yeni workflow başlatmaz.

sw.js Vercel'de no-cache/must-revalidate ve CDN no-store başlıklarıyla sunulur. Root worker kapsamı açıkça / olarak ayarlanır. CSP worker-src ve manifest-src yalnızca self'tir; önceki politikalar korunur. PWA kaydı Auth/SDK yüklenmesine bağlı değildir. Mevcut fotoğraf/galeri/veri sorguları çevrimiçiyken çalışmaya devam eder; iş verisi için offline kopya oluşturulmaz.

## Doğrulama ve elle senaryolar

Altı gerçek Chrome senaryosu yerel HTTP sunucusu ve gerçek Service Worker ile geçti: manifest/CDP/ikon boyutları/üretim CSP, yedi dosyalık izin listesi, API/POST/kimlikli isteğin saklanmaması, özel sayfa yerine çevrimdışı ekran ve ağ geri gelince yenileme, yedi günlük kurulum ertelemesi, yeni worker'ın beklemesi/formun korunması/onayla tek yenileme/eski cache temizliği ve deterministik üretim. OS kurulum onayı testte taklit edildi; cihaz ana ekranına gerçek uygulama kurulmadı. Özel sayfa ve API içeriği yalnızca test verisidir. 360 px ekran görüntüsü incelendi.

Mevcut müşteri 28, panel 24, SEO Node altı ve SEO Chrome dört senaryosu yeniden geçti. SDK taklidi kullanan eski testlerde worker izole edildi; worker davranışı ayrı gerçek sunucu testinde doğrulandı. Tüm kaynak JavaScript sözdizimleri kontrol edildi. Canlı kullanıcı verisinde değişiklik yapılmadı.

Elle: uygun Chrome/Edge mobil tarayıcıda ana ekrana ekle, kapatıp uygulama ikonundan aç. Reddedip sayfayı yenileyince önerinin kaybolduğunu kontrol et. Bir kez çevrimiçi ziyaret et, uçak modunda panel veya dükkan adresine git; özel içerik yerine internet yok ekranını doğrula. Network/Cache Storage içinde yalnızca yedi kabuk dosyasını incele. Yeni sürüm yayınlanınca formda metin yaz; Güncelle → Vazgeç ve sonra Güncelle → onay akışını kontrol et. Yazdır/QR sayfasında kurulum bildiriminin basılmadığını doğrula.

## Advisors ve geri dönüş

Supabase Advisors tekrar okundu; önceki bulgular değişmedi: dört bilinçli kapalı RLS tablosu, bir anonim/dört oturumlu definer, kapalı sızmış parola koruması, 24 kullanılmamış indeks bilgisi ve bir mevcut çoklu randevu UPDATE politikası uyarısı. [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anon definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [oturumlu definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politikalar](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

Geri dönüşte eski HTML'e dönmek tek başına kurulu worker'ı kaldırmaz. Gerekirse root sw.js dosyası yeni sürüm olarak ağdan geçiş yapan, yalnızca berber-shell-* cache'lerini temizleyip kendini unregister eden bir worker ile değiştirilmelidir. Auth localStorage veya IndexedDB silinmez. Aktif sürümde hiçbir hesap/randevu yanıtı cache'e yazılmaz; veri şeması geri dönüşü gerekmez.
