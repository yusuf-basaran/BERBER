# V2 — Dükkan galerisi

Panelde Galeri sekmesi, dükkan detayında fotoğraf ızgarası ve tam ekran görüntüleyici eklendi. Yeni migration `supabase/v2_03_galeri.sql`, önceki iki V2 migration sonrasında canlı Supabase projesine uygulandı. V1 SQL dosyalarının içeriği korunur; yeniden çalıştırılmaz.

## Kullanım ve veri akışı

- Dükkan başına 12 kayıt vardır. Seçim ve sürükle bırak desteklenir. Her kaynak dosya JPEG/PNG/WebP, en fazla 5 MB olmalıdır; dosya imzası da kontrol edilir. Tarayıcı canvas ile uzun kenarı en fazla 1600 piksele indirip WebP kalite 0,82 ile sıkıştırır. Tarayıcının kodlayıcı yedeği PNG/JPEG döndürürse boyut ve tür yeniden kontrol edilir.
- Açıklama en fazla 200 karakterdir. Boş açıklamada dükkan adı ve fotoğraf sırasından dolu alt metin üretilir. Kullanıcı metinleri DOM metni olarak eklenir.
- Öne al/Arkaya al işlemi tüm hazır fotoğrafları tek transaction içinde sıralar. Başka sekmede galeri değişmişse eksik veya yabancı kimlik dizisi reddedilir.
- Kapak yap, mevcut `barbers.photo_url` alanını günceller. Ana liste, favoriler ve detay aynı alanı kullandığı için kapak hepsinde görünür. V1 bağımsız fotoğraf yükleme/kaldırma özelliği çalışmaya devam eder. Galeriden kapak seçmek önceki kapak bağlantısını değiştirir; eski V1 dosyasını silmez. Galeri kapağı silinirse kapak boşalır ve mevcut baş harf yedeği görünür.
- Detayda resimler lazy yüklenir. Görüntüleyicide önceki/sonraki düğmeleri, sağ/sol oklar, Home/End, Escape, yatay dokunma kaydırması ve kapatınca odak dönüşü vardır. Mobilde tam ekran, 360 px genişlikten itibaren kullanılabilir.

## Dosya güvenliği ve yarım kalan işlemler

`barber_photos` tablosunda gerekli alanlara ek olarak `ready` ve `deleted_at` işlem durumları vardır. Önce veritabanında yer ayrılır, sonra dosya yüklenir, son olarak kayıt hazır işaretlenir. Yarım kalan kayıt yalnızca sahibine görünür ve panelden temizlenebilir. Sayı kontrolü dükkan satırını kilitler; aynı anda yükleme yapan sekmeler 12 sınırını aşamaz. Dosya yükleme süresince veritabanı kilidi tutulmaz.

Ayrı, herkese açık `barber-gallery` bucket'ı JPEG/PNG/WebP ve 5 MB ile sınırlıdır. Yol `barber_id/rastgele-kimlik.uzantı` biçimindedir. Storage politikaları `storage.foldername(name)`, dükkan sahipliği, metadata kaydı ve `public.mfa_ok()` kontrol eder. Dosya üzerine yazma izni verilmez. Hazır işaretleme, Storage kaydının varlığını veritabanında doğrular.

Silme önce kaydı yayından kaldırır ve seçili kapağı temizler, ardından Storage API ile dosyayı, son olarak veritabanı kaydını siler. Storage hatasında kayıt panelde kalır; temizleme yeniden denenebilir. Dosya hâlâ dururken metadata silinemez. Tabloda yalnızca hazır, silinmemiş kayıtlar herkese açıktır; sahip kendi yarım kalan kayıtlarını MFA kontrolüyle görür. Yeni tablo Realtime yayınına eklenmedi. Galeri dükkan fotoğrafları içindir; özel belge yükleme alanı değildir.

## V1'den etkilenen yerler

`panel-page.js` sekmeleri, `barber-page.js` detay bölümü, ortak CSS ve Türkçe sözlük genişletildi. Yeni modüller `gallery.js`, `panel-gallery.js`, `gallery-view.js` ve yeni migration eklendi. `barbers.photo_url` güncellemesine galeri kapağının kendi dükkanına ait ve hazır olmasını doğrulayan trigger eklendi. Eski `barber-photos` bucket'ı, kayıtlı fotoğraflar, Auth/TOTP, kurtarma, hizmet süreleri, randevu çakışmaları, iptal politikası, favoriler ve takvim akışları korunur.

## Doğrulama

- PostgreSQL/PGlite üzerinde 24 V1, 12 randevu yönetimi, 6 favori ve 10 yeni galeri senaryosu geçti. Migration tekrar uygulaması, sahiplik, eksik MFA, anonim okuma, dosya hazırlığı, 12 sınırı, açıklama sınırı, atomik sıralama ve silme tekrarları kontrol edildi.
- Chrome'da 9 yeni galeri senaryosu geçti: gerçek canvas küçültmesi ve WebP çıktısı, dosya seçimi, sürükle bırak, metin güvenliği, kapak, sıralama, hatalı dosya, silme hatası ve yeniden temizleme, yükleniyor/boş/hata durumları, mobil görünüm, klavye ve kaydırma.
- Mevcut 24 panel, 24 responsive ve 12 favori/takvim tarayıcı senaryosu geçti. Galeri 360 ve 1440 px'de görsel olarak incelendi. Test görselleri ve SDK yanıtları yerel test verisidir; canlı projeye sahte hesap, dosya veya randevu eklenmedi.
- Canlı anonim REST sorgusu HTTP 200 ve boş galeri listesi döndürdü. Bucket ayarları, sekiz yeni politika ve Realtime dışında kalması doğrulandı. Gerçek hesapla uçtan uca yükleme aşağıdaki elle test listesinde yer alır.

## Advisors

Yeni güvenlik uyarısı yok. Önceden bulunan üç [politikasız RLS bilgisi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), `get_available_slots` için [anonim definer izni](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), `get_available_slots` ve `mfa_ok` için [oturumlu definer izinleri](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) ve [kapalı sızmış parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) devam eder.

Performans raporunda yeni `barber_photos_order_idx` henüz [kullanılmamış indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) bilgisiyle görünür; yeni tablo boş olduğu için indeks korunur. Mevcut randevu UPDATE [birden çok izin verici politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) uyarısı sürer.

## Elle test edilecek senaryolar

1. Kendi berber hesabınızla Galeri'ye girin; telefondan ve masaüstünden JPEG/PNG/WebP yükleyin. Yatay/dikey ve şeffaf fotoğraf deneyin; görsel yönünü ve kalitesini kontrol edin.
2. Açıklama ekleyin; Öne al/Arkaya al ile sıralayın. Dükkan sayfasını yenileyip aynı sırayı ve metinleri doğrulayın.
3. Kapak seçin; ana liste ve Favorilerim'de aynı fotoğraf görünmeli. V1 Dükkan Profili'nden bağımsız kapak yüklemeyi de deneyin.
4. 12 fotoğrafı doldurun. İki sekmede aynı anda son boş yeri doldurmayı deneyin; toplam 12'yi aşmamalı.
5. Bağlantıyı yükleme/silme sırasında kesin. Yenileyince yarım kalan kayıt panelde temizlenebilmeli; dükkan ızgarasında görünmemeli.
6. Kapak olarak seçili galeri fotoğrafını silin; dosya ve kayıt gitmeli, kartta baş harf yedeği görünmeli.
7. Detay ızgarasını telefonda açın; kaydırma, Önceki/Sonraki, Escape, oklar ve kapatınca odak dönüşünü kontrol edin.
8. Farklı berber hesabından aynı galeriye yazma/silme başarısız olmalı. TOTP açık hesapta ikinci faktör tamamlanmadan yönetim kapalı kalmalı.

## Yayın ve geri dönüş

GitHub main üzerinden Vercel otomatik yayınlanır. Statik dosyaların yeni sürümü ve HTTP durumları yayından sonra kontrol edilir. Geri dönüş gerekirse önceki frontend commit'i yayınlanabilir; yeni tablo ve bucket verisini silmeyin. Galeri migration'ı V1 verisini dönüştürmez; önceki frontend galeri bölümünü göstermeden çalışır.

Sonraki yeni çalışma paketi [admin onayı ve müşteri kartı planında](V2A-PLAN.md) açıklanır.
