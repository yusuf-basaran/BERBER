# SEO ve dükkan bağlantısı önizlemesi

17 Ekim 2026. Şema veya eski SQL dosyası değişmedi. Yeni Node.js 24 fonksiyonu yalnızca public anon anahtarla, açıkça approved/is_active filtresiyle dükkan ve çalışma saatlerini okur. Müşteri, randevu, özel not veya yönetici tablosuna erişmez.

## Kapsam

scripts/seo-uret.js, mevcut public bağlantı ayarını ve i18n Türkçe sözlüğünü kullanarak altı şehir/32 semt için 38 statik sayfa, robots.txt, sitemap.xml ve üretilen dosya listesini oluşturur. Bu üretimde bir onaylı dükkan ve toplam 40 sitemap URL'si vardır. Şehir adresleri /girne-berber ve /lefkosa-berber biçimindedir; semt adresi /lefkosa-dereboyu-berber biçimindedir. İlk 24 dükkan statik gösterilir; tüm sonuçlar bağlantısı canlı sayfalı listeye şehir/semt filtresiyle geçer. Başlık, açıklama, bölge bağlantıları, kartlar ve hukuki bağlantılar JavaScript olmadan okunur. JavaScript açıksa sonradan pasifleştirilen dükkanlar tekrar sorgulanıp karttan kaldırılır.

Sitemap'e yalnızca aktif/onaylı dükkan kısa bağlantıları eklenir. Özel hesap/yönetim sayfalarının mevcut noindex etiketleri korunur ve robots listesinde yer alır. Vercel buildCommand boş kalır; HTML dosyaları repoya kaydedilir. .github/workflows/seo-guncelle.yml her gün 04:35 UTC'de, elle çalıştırıldığında ve main üzerindeki üretim betiği/sözlük/workflow değişikliklerinde dosyaları üretir; yalnızca değişiklik varsa commit eder. Üretilmiş HTML değişikliği yeni çalışmayı tetiklemez. Checkout sürümü SHA ile sabittir. Gizli anahtar gerekmez; workflow contents:write izniyle kendi repo dosyalarını günceller.

/b/:slug artık api/berber-onizleme.js fonksiyonuna gider. Fonksiyon berber.html kabuğuna dükkan adı, açıklama, kapak veya BERBER logo yedeği, canonical, Open Graph ve HairSalon JSON-LD ekler. Aynı şema doğrudan kimlikli detay sayfasında da istemciden oluşturulur; demo sayfasına eklenmez. Telefon/adres yalnızca herkese açık dükkan bilgileridir. Saatler mola varsa iki aralığa bölünür. Puan verisi yalnızca en az bir gerçek yorum varsa eklenir. Kullanıcı metni HTML ve JSON-LD için ayrı kaçıştan geçer; gelen Host başlığı canonical adresi belirleyemez.

Onaysız, eksik veya geçersiz kısa ad gerçek 404/noindex döndürür. Supabase bağlantı hatasında normal detay kabuğu önbelleksiz/noindex açılır. Başarılı cevap Vercel CDN'de 300 saniye, yeniden doğrulama sırasında en fazla 60 saniye ek süre tutulabilir; tarayıcı yeniden doğrulama yapar. HEAD ve ETag desteklenir. Statik sayfalar günlük anlık görüntüdür; JavaScript kapalı erişimde bir durum değişikliği bir sonraki üretime kadar görünebilir. Dükkanın canlı detay ve rezervasyon yetkisi ayrıca mevcut onay denetimine tabidir. Acil kaldırmada yeniden SEO üretimi ve gerekiyorsa CDN temizliği yapılmalıdır.

## Etkilenen mevcut yerler

vercel.json kısa bağlantı rewrite'ı ve fonksiyon dosya dahil etme ayarı, berber-page.js detay metaverisi, barbers.js public koordinat/durum seçimi, index-page.js URL'den bölge seçimi, i18n ve küçük semt bağlantısı stilleri genişletildi. Root package/lockfile yalnızca Node 24 sürümünü sabitler; ek npm bağımlılığı veya Vercel build adımı yoktur. js ve api dizinlerinin module kapsamı açıkça belirtilir. /lib ve /scripts doğrudan web erişimi 404'e yönlendirilir.

## Doğrulama ve elle senaryolar

Altı Node senaryosu Türkçe kısa ad, HTML/JSON-LD kaçışı, onaylı/aktif kapsamı, deterministik tekrar üretim, veri hatasında önceki dosyanın korunması, OG/şema, canonical Host güvenliği, gerçek 404, ETag/HEAD ve hata geri dönüşünü doğruladı. Dört gerçek Chrome senaryosu JavaScript kapalı şehir/semt ve OG/şema, normal detay/randevu formu, tek JSON-LD kopyası, mevcut CSP altında ihlal olmaması ve canlı listeye bölge aktarımını doğruladı. Mevcut müşteri ve paylaşım/otomatik onay/yönetim/bekleme tarayıcı senaryoları yeniden geçti. Canlı kullanıcı adına test kaydı yapılmadı.

Elle: /girne-berber ve semt sayfasını JavaScript kapalı aç; tüm sonuçlar bağlantısını izle. Gerçek dükkan /b/kisa-ad bağlantısının kaynak HTML'inde og:title/image ve HairSalon verisini incele. Olmayan kısa adı açıp HTTP 404'ü doğrula. Yönetici bir dükkanı askıya alınca canlı detay/rezervasyonu, CDN süresi ve sonraki statik üretimden sonra sitemap/kart kapsamını kontrol et. Günlük workflow'u Actions sekmesinden elle çalıştır, veri değişmediyse gereksiz commit oluşmadığını doğrula.

## Advisors ve geri dönüş

Üretim doğrulaması: 8dedabc commit'inin push çalışması GitHub Actions üzerinde başarıyla tamamlandı; üretim ve değişiklik kontrolü adımları geçti. [Çalışma kaydı](https://github.com/yusuf-basaran/BERBER/actions/runs/38973553524). Veri değişmediği için ek üretim commit'i oluşmadı.

Advisors tekrar kontrol edildi; yeni bulgu yok. Önceki dört bilinçli kapalı RLS tablosu, bir anonim/dört oturumlu definer, kapalı sızmış parola koruması, yirmi kullanılmamış indeks ve çoklu randevu UPDATE politikası bulgusu sürer. [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer izinleri](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politikalar](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

Geri dönüşte /b/:slug eski /berber.html rewrite'ına alınabilir; fonksiyon ve günlük workflow devre dışı bırakılır. Veritabanı etkilenmez. Domain satın alma/bağlama yapılmadı; canonical/sitemap üretim adresi https://berber-1.vercel.app olarak korunur. Domain geçişinde SITE_ORIGIN, ana sayfa canonical, Auth URL'leri ve izinli origin ayarları birlikte güncellenmelidir. [Vercel Node fonksiyonları](https://vercel.com/docs/functions/runtimes/node-js), [LocalBusiness şeması](https://developers.google.com/search/docs/appearance/structured-data/local-business).
