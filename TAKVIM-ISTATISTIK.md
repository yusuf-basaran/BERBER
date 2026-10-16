# Takvim ve dönem istatistikleri

17 Ekim 2026. v3_06_takvim_istatistik.sql canlı projeye uygulandı. Eski SQL dosyaları değiştirilmedi.

## Kapsam ve etkilenen yerler

Onaylı, aktif berber paneline Takvim ve İstatistikler sekmeleri eklendi. Önceki sekme sırası ve klavye gezinmesi korundu. Takvim gün/hafta gösterir; hafta Pazartesi başlar. Randevuya tıklamak mevcut onay, ret, saat önerme, iptal, tamamlandı/gelmedi ve müşteri kartı işlemlerini açar. Hizmet seçildiğinde uygun saatler gün bazında, kullanıcı açtıkça yüklenir. Bir saate tıklamak mevcut manuel forma hizmet/tarih/saat taşır; kayıt öncesi boş saat yeniden sorgulanır. Haftada ilk 500 kayıt sınırı ve gün görünümüne daraltma uyarısı vardır.

İstatistikler bugün dahil 7/30/90 Kıbrıs yerel günü için toplam, tamamlanma/iptal/gelmedi adet ve oranları, ilk beş hizmet, yoğun gün/saat ve günlük grafik döndürür. Gelir yalnızca completed durumundaki kayıtlı fiyatlardan hesaplanır; TRY/GBP/EUR ayrı gösterilir ve tahsilat olarak sunulmaz. Grafik için tarih/sayı listesi klavye ve ekran okuyucuya açıktır. İstatistik RPC'si ad, telefon, e-posta veya not içermez. Takvim yetkisi aynı dükkan sahibine ve mevcut MFA denetimine bağlıdır; misafir telefon alanı ham satırdan çıkarılır, müşteri telefonunun önceki ilişki şartı korunur.

## Test

Önceki testlerle birlikte 111 PostgreSQL senaryosu geçti. Yeni dört SQL senaryosu anonim/müşteri/eksik MFA reddi, dükkan sınırı, telefon alanı, üç ayrı para birimi, iptalin gelirden hariç olması, notların istatistiğe girmemesi, tarih aralığı ve tekrar migration kontrolünü kapsar. Beş yeni Chrome senaryosu Pazartesi/yıl geçişi/yaz saati tarih hesabı, gün/hafta ve detay işlemleri, manuel form ön seçimi, üç dönem ve grafik veri listesi, 360/1440 piksel ve görünür odağı doğrular. Panelin 24 ve onay ekranının dört senaryosu tekrar geçti. Tüm JS dosyaları sözdizimi kontrolünden geçti. Canlı kullanıcı adına test randevusu oluşturulmadı.

Elle: Takvimde hafta değiştir, gün görünümüne geç, bir randevuyu açıp işlem yap. Hizmet seçip uygun saate tıkla; formdaki ön seçimi ve başka kullanıcı önce alırsa çakışma uyarısını kontrol et. Üç para biriminde tamamlanan kayıtları ayrı gelirlerde gör; iptal/gelmedi kaydının gelir eklemediğini doğrula. Dönemi değiştirip grafik veri listesini aç. Başka kullanıcı ve eksik TOTP ile RPC çağrısının reddini dene.

## Advisors ve geri dönüş

Yeni Advisor bulgusu oluşmadı. Önceki dört bilinçli kapalı RLS tablosu, bir anonim/dört oturumlu definer, kapalı sızmış parola koruması, yirmi kullanılmamış indeks ve bir çoklu UPDATE politikası bulgusu sürer. Gerekçeler ve [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [parola](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [politika](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) bağlantıları önceki raporla aynıdır.

Frontend önceki commit'e alınabilir. Yeni RPC'ler tablo verilerini değiştirmez; gerekirse execute izinleri yeni migration ile geri alınabilir. Sıradaki çalışma hatırlatma kuyruğu ve gönderim altyapısıdır.
