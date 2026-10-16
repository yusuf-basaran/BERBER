# Harita ve yakındaki berberler

17 Ekim 2026. Yeni v3_07_harita.sql canlı Supabase projesine uygulandı. Eski migration dosyaları değiştirilmedi. lat/lng birlikte boş veya geçerli koordinat çifti olmak zorundadır. Sahiplik ve mevcut MFA politikaları sürer. Yeni harita araması SECURITY INVOKER kullanır; aktif, onaylı, hizmet/fiyat/şehir/semt/puan filtrelerine uygun dükkanların yalnızca herkese açık özetini döndürür. En çok 500 eşleşme alınır; daha çok sonuçta şehir/semt ile daraltma uyarısı görünür.

## Etkilenen mevcut yerler

Ana sayfaya liste/harita geçişi ve yakınımdaki berberler düğmesi eklendi. Liste ve sayfalama korunur. Konum izni yalnızca düğmeye basınca istenir; reddedilirse hata uyarısı olmadan şehir/semt filtresi açılır. Haversine sıralaması yalnızca tarayıcı belleğinde yapılır. Kullanıcı koordinatı RPC, ağ isteği, URL, localStorage veya sessionStorage'a yazılmaz; sayfa kapanınca bellek temizlenir. Koordinatı olmayan dükkanlar mesafe sıralamasının sonunda kalır.

Berber profilindeki isteğe bağlı harita bölümü açılınca Leaflet yüklenir. Haritaya tıklama veya sayısal koordinat girişi desteklenir; temizleme iki alanı birlikte boşaltır. Eski Google Maps bağlantı alanı korunur. Harita işaretçisi güvenli DOM ile dükkan özeti açar; aynı dükkanlara normal listeden de erişilir. Leaflet 1.9.4 ve stylesheet SRI ile sabitlenir. CSP yalnızca gerekli CDN dosyalarına ve karo sunucusuna genişletildi; konum izni same-origin ile sınırlıdır.

Karo adresi js/config.js içindeki mapTiles alanındadır. Harita yalnızca açıldığında yüklenir; ön indirme veya çevrimdışı karo önbelleği yoktur. Tarayıcının HTTP önbelleği ve Referer davranışı korunur, OpenStreetMap atfı görünür kalır. Sağlayıcı değiştirilirse CSP host izni de güncellenmelidir. [Leaflet sürümü ve SRI](https://leafletjs.com/download.html), [OpenStreetMap kullanım politikası](https://operations.osmfoundation.org/policies/tiles/).

## Doğrulama

Önceki testlerle birlikte 114 PostgreSQL senaryosu geçti. Üç yeni SQL kontrolü koordinat çifti/sınırlar, sahip ve MFA, onay/aktif/filtre kapsamı, kişisel alanların dönmemesi, invoker yetkisi ve tekrar migration kontrolünü kapsar. Altı Chrome senaryosu gerçek Leaflet ve üretim CSP ile çalıştı: bilinen Haversine mesafeleri, tembel harita yükleme/atıf/özet, konumun ağ ve depolamaya girmemesi, izin reddi, panel işareti/kayıt/temizleme ve 360 piksel görünüm. Karo istekleri bu testte sabit küçük test görüntüsüyle karşılandı; toplu gerçek karo indirilmedi. Mevcut müşteri ve panel tarayıcı akışları tekrar geçti; tüm JS dosyaları sözdizimi kontrolünden geçti.

Elle: Panel → Dükkan Profili → harita bölümünü aç, doğru dükkan noktasını işaretle ve Kaydet. Ana sayfa haritasından özet kartı aç. Konum iznini kabul ederek mesafe sırasını, reddederek şehir/semt filtresini kontrol et. Bir koordinatı tek başına girip kaydın reddini ve harita bağlantısı alanının korunmasını dene. Dükkanı pasifleştirince veya yönetici askıya alınca harita sorgusunda görünmediğini kontrol et. Canlı dükkanlara test koordinatı uydurularak yazılmadı.

## Advisors ve geri dönüş

Yeni Advisor bulgusu oluşmadı. Önceki dört bilinçli kapalı RLS tablosu, bir anonim/dört oturumlu definer, kapalı sızmış parola koruması, yirmi kullanılmamış indeks ve bir çoklu UPDATE politikası bulgusu sürer. [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

Frontend önceki commit'e geri alınabilir; kayıtlı koordinatlar silinmez. Harita düğmesi kaldırılarak liste akışı kullanılabilir. Sonraki kapsam hatırlatma/e-posta, veri hakları ve SEO'dur. berber.com henüz bağlanmadı; çalışan üretim adresi korunur.
