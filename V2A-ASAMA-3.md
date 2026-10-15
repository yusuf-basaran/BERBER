# Yönetim paneli ve başvuru kararları

16 Ekim 2026. A4 tamamlandı. `supabase/v2a_02_admin_paneli.sql` canlı projeye uygulandı. `admin.html` filtre, arama, yirmişer sayfalama, bekleyen sayısı, başvuru ayrıntıları, fotoğraf, başvuran iletişimi, harita/Instagram bağlantıları, dört maddeli kontrol listesi ve özel yönetici notu içerir.

## Erişim ve kararlar

Yönetim sayfası `is_admin()` sonucunu kontrol eder. Girişsiz kullanıcı güvenli dönüş adresiyle girişe gider; yetkisi olmayan veya ikinci faktörü tamamlamayan kullanıcı başvuru verisi yüklenmeden bulunamadı görünümü görür. Menüde Yönetim bağlantısı yalnızca doğrulanmış yöneticiye eklenir. Oturum değişirken liste, ayrıntı ve açık karar penceresi temizlenir. Görünür sayfa yetki ve bekleyen sayısını 30 saniyede bir yeniler; her RPC yetkiyi sunucuda ayrıca kontrol eder.

`admin_applications` ve `admin_application` RPC'leri yalnızca yöneticiye başvuran e-postası/telefonu ve özel yönetici alanlarını döndürür. Sayfa başına en fazla 20 kayıt, aramada 120 karakter, sayfa numarasında 1–1000 sınırı vardır. İstemci barbers tablosundaki özel sütunları doğrudan okuyamaz veya karar alanlarını güncelleyemez.

`admin_review_save` kontrol listesi ve en fazla 2000 karakterlik notu saklar. `application_revision` ile eski sekmenin başka yöneticinin kaydını ezmesi engellenir; değişiklik audit'e yazılır. Özel notun metni bildirim veya audit detayına kopyalanmaz. Güncel notu almak için Yenile ayrıntıyı da yeniler. Kaydedilmemiş not/kontrol listesi varken karar verilmeden önce kaydetme istenir.

`public.basvuru_karar(p_barber_id,p_karar,p_sebep)` tek karar fonksiyonudur. Sunucuda yönetici üyeliği, güncel MFA ve satır kilidi kullanır. Geçerli geçişler:

| İşlem | Önce | Sonra |
|---|---|---|
| approve | pending | approved |
| reject | pending | rejected |
| suspend | approved | suspended |
| reapprove | rejected veya suspended | approved |

Ret/askı için en fazla 1000 karakterlik dolu gerekçe zorunludur. Onay, ret gerekçesini temizler. Karar zamanı/veren kişi, audit ve berbere bildirim aynı transaction içinde yazılır. Bildirim başarısızsa karar ve audit de geri alınır. Tekrarlanan/eski durumdaki karar reddedilir; eski pending ekranından başka yöneticinin yeni kararının üzerine farklı bir onay yazılamaz. Onay dükkanın is_active tercihini değiştirmez; pasif dükkan sahibi ayrıca aktif etmelidir.

## Bildirimler

Yeni pending başvuruda admin üyelerine uygulama içi bildirim yazılır. Bu bildirimler aal1 veya faktörsüz yöneticiye SELECT politikasıyla gösterilmez. Karar bildirimi yalnızca dükkan sahibine gider; özel yönetici notu içermez. Bildirimde Yönetim veya Berber Paneli bağlantısı vardır. İlişki için notifications.barber_id eklendi; eski randevu bildirimleri korunur. Yeni tablo yayını açılmadı; mevcut notifications Realtime akışı kullanılır. E-posta bildirimi eklenmedi.

Opsiyonel başvuru belgesi yükleme alanı henüz yoktur. Private bucket, kısa süreli belge görüntüleme ve saklama süresi A2 aşamasında birlikte uygulanacak. Bu aşamada belge varmış gibi dosya veya imzalı adres üretilmez.

## İlk yönetici hesabı

Kullanıcının talebiyle gerçek e-posta ve telefonuyla Auth hesabı oluşturuldu, SQL üzerinden admin_users üyeliği eklendi. Hesap profili normal customer rolündedir; yönetici yetkisi bu rol alanından alınmaz. E-posta onayı tamamlandı. Güçlü rastgele parola ile canlı giriş HTTP 200 döndürdü; test oturumu yalnızca kendi oturumu için kapatıldı. Diğer oturumlara dokunulmadı.

Hesapta henüz doğrulanmış TOTP faktörü yoktur. Canlı aal1 oturumunda is_admin false ve başvuru listesi HTTP 403 döndürerek kapalı kaldı. Kullanıcı Hesap Güvenliği ekranından kendi telefonuyla TOTP kurup doğrulamalıdır. Başlangıç parolası ve kişiye özel SQL bu kaynak paketi/GitHub dışında ayrı teslim edilir; burada kimlik veya parola bulunmaz.

`supabase/admin_ekle.sql`, SQL işletmecisi için geçici `pg_temp.admin_ekle(p_email text)` yardımcısını oluşturur. Verilen e-postayla auth.users'tan tam bir hesap bulur, profilini kontrol eder ve üyeliği tekrarlanabilir biçimde ekler. Normal kullanıcı ve service_role için çalıştırma izni yoktur; internet üzerinden üyelik ekleme API'si açılmaz. Kişiye özel hazır SQL aynı dosyaya yardımcı tanımı ve mevcut hesabın çağrısını birlikte içerir; bu hesap için üyelik zaten uygulanmıştır.

## V1'den etkilenen yerler

- Yeni admin sayfası, admin.js ve admin-page.js; ortak CSS/sözlük ve güvenli dönüş adresleri.
- Navigasyona yalnızca yönetici doğrulaması sonrası Yönetim bağlantısı.
- Bildirim sorgusuna barber_id, yeni bildirim türleri ve ilgili sayfa bağlantıları.
- Barbers tablosuna özel revizyon alanı; yeni RPC'ler, başvuru bildirimi trigger'ı ve admin bildirimi okuma sınırı.

V1 SQL dosyalarının içerikleri başlangıç kopyasıyla karşılaştırıldı ve korundu. Canlı dükkan ve randevu sayısı yine 1/1; mevcut kayıtlar silinmedi. İstenen yönetici hesabı gerçek kurulum verisidir. Test başvuruları ve karar denemeleri yalnızca yerel test veritabanı/tarayıcı ortamında çalıştırıldı.

## Doğrulama

Toplam 81 SQL senaryosu geçti: önceki 71 ve 10 yeni yönetim testi. Anon/müşteri/berber/aal1 admin erişimi, liste sınırları, özel alanlar, revizyon çakışması, karar geçişleri, gerekçe, audit/bildirim atomikliği, yeni başvuru bildiriminin MFA sınırı, üyelik iptalinde aynı oturumun reddi ve migration tekrarında veri korunması kontrol edildi.

9 yeni Chrome yönetim senaryosu; ayrıca 24 mevcut panel, 18 bildirim, 12 favori/takvim senaryosu geçti: toplam 63 tarayıcı senaryosu. Yönetim listesi ve ayrıntıları 360/1440 px'de incelendi. Ham HTML metin olarak gösterilir; odağın görünürlüğü, sayfalama, boş/hata/yeniden deneme ve çıkışta açık karar penceresinin temizlenmesi kontrol edildi. Bütün modüller sözdizimi kontrolünden geçti. Gerçek yönetici hesabıyla tam yetkili canlı panel kullanımı kullanıcının TOTP kurulumu sonrasında denenmelidir.

## Supabase Advisors

Yeni güvenlik uyarısı, istenen `public.basvuru_karar` için [oturumlu SECURITY DEFINER erişimi](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Sabit boş search_path, PUBLIC/anon EXECUTE iptali, doğrulanmış admin/MFA kontrolü, üyelik ve dükkan satırı kilidi ile sınırlıdır. Doğrudan tablo UPDATE politikası açılmadı. Önceki is_admin, boş saat/MFA fonksiyon izinleri, üç [politikasız RLS bilgisi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) ve [kapalı sızmış parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) sürer.

Yeni `notifications_barber_idx` henüz [kullanılmamış indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) bilgisindedir. Önceki indeks bilgileri ve randevu UPDATE [birden çok izin verici politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) uyarısı devam eder. Yeni tablo/RLS veya başka yeni güvenlik bulgusu yoktur.

## Elle test senaryoları

1. Teslim edilen hesapla giriş yapıp Hesap Güvenliği'nden TOTP kurun; QR kodu kendi doğrulayıcı uygulamanızla okutun, 6 haneli kodla onaylayın ve kurtarma kodlarını saklayın. Ardından Yönetim bağlantısını açın.
2. TOTP tamamlanmamış oturumda yönetim verisi açılmamalı. Sıradan müşteri ve berber hesabından /admin bulunamadı görünmeli; RPC'ler de reddedilmeli.
3. Başvuruyu durum filtresi, ad/e-posta araması ve sayfalama ile bulun. Fotoğraf, adres, başvuran iletişimi ve bağlantıları kontrol edin.
4. Kontrol listesi ve özel yönetici notunu kaydedin. Başka sekmede değiştirip eski sekmeden kaydetmeyi deneyin; çakışma uyarısı gelmeli ve Yenile son kaydı getirmeli.
5. Pending başvuruyu onaylayın veya gerekçeyle reddedin. Onaylı dükkanda gerekçeyle askıya alma, reddedilmiş/askıdaki dükkanda tekrar onay akışlarını deneyin.
6. Berber hesabında karar bildirimi ve doğru panel bağlantısını görün; özel yönetici notu görünmemeli. Onaylı/aktif dükkan listede ve uygun saatlerde açılmalı; askıdaki dükkan gizlenmeli.
7. Yeni başvurunun admin bildirimine ve bekleyen sayısına geldiğini kontrol edin. Bildirimin e-posta göndermediğini doğrulayın.
8. Açık başvuru ve karar penceresi varken çıkış yapın; özel veriler ve pencere kapanmalı. Telefon ekranında kontrol listesi, not, gerekçe ve karar hedefleri kullanılabilir olmalı.

## Yayın sırası ve geri dönüş

Önce önceki V2 migration'ları, sonra `v2a_01_berber_onayi.sql`, sonra `v2a_02_admin_paneli.sql` uygulanır. Canlı projede bunlar uygulanmıştır; V1 SQL dosyaları yeniden çalıştırılmaz. Yönetici SQL yardımcısı bir migration değildir; yetkili SQL oturumunda kullanılır.

GitHub main Vercel'e otomatik yayınlanır. Geri dönüşte önceki frontend commit'i yayınlanabilir; kararları, audit kayıtlarını veya admin üyeliğini silmeyin. Yeni veritabanı erişim kuralları yerinde kalır. Sonraki aşama berber başvuru formu, ret gerekçeli yeniden gönderme ve durum bantlarının tamamlanmasıdır.
