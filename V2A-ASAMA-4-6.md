# Başvuru, profil ve müşteri kartı

16 Ekim 2026. Genişletme başlangıç denetimi GENISLETME-DENETIMI.md dosyasındadır. Kullanıcının son talebi üzerine aşamalar arasında bekleme kaldırıldı.

## Tamamlananlar

Berber kaydında mevcut şehir/semt listesinden dükkan başvurusu oluşturulur. Kayıt yalnızca taslak yaratır; doğrulanmış e-posta ile panelden V1 bucket fotoğrafı yüklendikten ve bilgiler tamamlandıktan sonra incelemeye gönderilir. Fotoğraf aynı tarayıcıdaki IndexedDB'de en fazla yedi gün tutulur; başka cihazda panelden yeniden seçilir. Ret sebebi yalnızca sahip/yöneticiye açıktır. En fazla üç başvuru veritabanında uygulanır. Askı ve ret için günde bir uygulama içi destek mesajı gönderilebilir. Aynı normalize telefonda pending/approved kayıtlar kısmi UNIQUE indeksle engellenir; canlı kontrolde çakışma bulunmadı.

Opsiyonel belge özel basvuru-belgeleri bucket'ına yüklenir. Sahibi ve aal2 yönetici okuyabilir; görüntüleme bağlantısı 60 saniyelik. Karardan 30 gün sonra saatlik görev dosyayı Storage API ile ve ardından metadata kaydını siler. Hatalı silmeler yeniden denenir; Storage tablolarından doğrudan dosya silinmez. Edge Function JWT doğrulaması açık, ikinci görev sırrı Vault'ta saklıdır. Yeni tablolar Realtime yayınına eklenmedi.

profil.html ad, normalize telefon ve 300 karakter hizmet tercihini düzenler. Randevu öncesi profil kontrolü istemci ve trigger ile yapılır. musteriler.html ve talep içindeki açılır kart yalnızca onaylı/aktif dükkan sahibine açıktır. Özel not 1000 karakter, en fazla beş adet 20 karakter etiketle sınırlıdır. Müşterinin kendi notu ayrı gösterilir. Telefon, o dükkanda confirmed/completed ilişki olmadan kart ve panelde dönmez. Liste telefon döndürmez; misafir kartı için randevu kimliği kullanılır. Özel notlar bildirimlere veya Realtime'a girmez, müşteri silindiğinde FK ile silinir. Eski iptallerde kaynağı bilinmeyen işlemler müşteri iptali olarak tahmin edilmez.

## Etkilenen mevcut yerler

Kayıt/giriş ortak modülü, auth signup metadata'sı, berber profil formu, panel talep sorgusu, bildirim bağlantıları ve gizlilik sayfası genişletildi. Eski V1 SQL dosyaları ve önceki migration'lar değiştirilmedi. Çakışma, hizmet süresine göre slotlar, MFA/kurtarma ve mevcut galeri korundu.

## SQL sırası

Önce mevcut V1/V2/V2A dosyaları, ardından v2a_03_basvuru.sql, v2a_04_basvuru_belgeleri.sql. cleanup-application-documents Edge Function deploy edilir, sonra v2a_05_belge_temizligi.sql, v2a_06_musteri_profili.sql, v2a_07_musteri_karti.sql, v2_04_guven_tamamlama.sql uygulanır. Bu yeni dosyalar canlı projeye uygulandı; cron etkin ve bucket private olarak kontrol edildi.

## Testler ve elle test senaryoları

Gerçek PostgreSQL motoru PGlite üzerinde önceki senaryolarla birlikte 96 SQL senaryosu geçti. Auth/Storage şemaları test fikstürüdür. Yeni beş tarayıcı senaryosu 360/1440 pikselde geçti; mevcut panel 24, admin 9, bildirim 18 ve hesap ekranı regresyonları ayrıca çalıştırıldı. Canlı müşteriler üzerinde sahte randevu veya not oluşturulmadı.

Elle: yeni berber kaydı → e-posta onayı → fotoğraf/belge → gönder; admin TOTP ile incele/ret → gerekçeyi gör/düzelt/yeniden gönder; üçüncü rette dördüncü denemeyi reddet; askıda destek mesajını admin bildiriminden aç. Müşteri profilini düzenle, randevu iste. Bekleyen kartta telefon olmadığını, onay sonrası göründüğünü ve özel notun müşteri hesabında bulunmadığını kontrol et. Mobilde kart açıkken onay/ret işlemlerini kullan. Belgeyi silip başka kullanıcıyla imzalı URL oluşturmayı dene.

## Advisors

Yeni açık erişim uyarısı oluşmadı. Önceden bulunan dört oturumlu definer ve bir anonim slot definer uyarısı korunuyor; kimlik/MFA/onay kontrolleri testlidir. [Definer izinleri](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Üç kurtarma/ayar tablosu istemci politikası olmadan bilinçli kapalıdır: [RLS bilgisi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Sızmış parola koruması kapalı uyarısı hesap ayarıdır: [parola koruması](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). On beş kullanılmamış indeks bilgisi düşük trafik/yeni tablolar nedeniyle korunur: [indeks değerlendirmesi](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Mevcut randevu UPDATE politikalarının performans uyarısı sürüyor: [politikalar](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Geri dönüş

Önceki GitHub sürümüne frontend geri alınabilir; yeni sütun/tablo verileri silinmez. Belge temizliği gerekirse cron.job içindeki berber-document-cleanup görevi pasifleştirilir. Eski migration'lar yeniden çalıştırılmaz; fonksiyon değişiklikleri yeni düzeltme migration'ıyla yapılır. Yönetici parolası, kişisel yönetici SQL'i ve hiçbir sunucu anahtarı bu pakette bulunmaz.
