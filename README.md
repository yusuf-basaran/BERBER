# BERBER

Yönetim paneli, kararlar ve ilk yönetici kurulumu için [V2A üçüncü aşama raporuna](V2A-ASAMA-3.md) bakın. Yeni migration: `supabase/v2a_02_admin_paneli.sql`. Yönetici hesabında TOTP zorunludur.

Berber onayı altyapısı için [V2A ikinci aşama raporuna](V2A-ASAMA-2.md) bakın. Yeni migration: `supabase/v2a_01_berber_onayi.sql`. Admin karar ekranı sonraki aşamadadır.

Galeri için [V2 dördüncü aşama notlarına](V2-ASAMA-4.md) bakın. Yeni migration: `supabase/v2_03_galeri.sql`. Sonraki çalışma paketi: [berber onayı ve müşteri kartı planı](V2A-PLAN.md).

Favoriler, tekrar rezervasyon ve takvim çıktıları için [V2 üçüncü aşama notlarına](V2-ASAMA-3.md) bakın. Yeni migration: `supabase/v2_02_favoriler.sql`.

V2 randevu yönetimi ve tasarım güncellemesi için [aşama notlarına](V2-ASAMA-2.md) bakın. Mevcut projede yalnızca `supabase/v2_01_randevu_yonetimi.sql` uygulanır; V1 SQL dosyaları yeniden çalıştırılmaz.

KKTC için berber bulma, randevu, dükkan yönetimi, bildirim ve yorum uygulaması. HTML, CSS ve tarayıcıda çalışan ES modülleri kullanır. Derleme gerekmez. İş takvimi `Europe/Nicosia` saat dilimindedir.

## Bağlantı

`js/config.js` yeni Supabase projesine bağlıdır: `tyxtpfykgitqfhqjkayn`. Tarayıcıda yalnızca public `anon` anahtarı bulunur. Supabase panelindeki **Settings → API Keys** ve **Project URL** alanlarından alınır. `service_role` anahtarı tarayıcıya veya depoya eklenmez.

Bu projede `schema.sql`, `security.sql`, `customer.sql`, `panel.sql` ve `runtime.sql` uygulandı. Aynı projede yeniden çalıştırmayın. Yeni ve boş bir projede bu sırayla uygulayın. 32 semt, 6 şehir, fotoğraf bucket'ı, bildirimlerin Realtime yayını ve erişim politikaları dahildir.

## Vercel

1. Vercel'de **Add New → Project** ile `yusuf-basaran/BERBER` deposunu içe aktarın.
2. Framework **Other**, Root Directory depo kökü, Build Command kapalı/boş, Output Directory `.` olsun. Bu statik uygulama için ortam değişkeni gerekmez.
3. Deploy tamamlanınca verilen kalıcı production adresini kullanın. `vercel.json` temiz URL'leri ve güvenlik başlıklarını tanımlar.

## Supabase Auth ve yayın adresi

[Authentication ayarlarını açın](https://supabase.com/dashboard/project/tyxtpfykgitqfhqjkayn/auth/url-configuration).

- **Sign In / Providers → Email**: e-posta girişi ve kayıt açık, **Confirm email** açık olsun.
- **Multi-Factor Authentication**: TOTP açık olsun.
- **URL Configuration → Site URL**: kalıcı production adresini girin.
- **Redirect URLs**: production adresine `/giris`, `/giris.html`, `/guvenlik` ve `/guvenlik.html` ekleyin. Gereksiz wildcard kullanmayın.
- **Email Templates**: e-posta koduyla giriş kullanılacaksa giriş e-postasında `{{ .Token }}` bulunmalı. Gerçek kullanıcılar için kendi SMTP sağlayıcınızı yapılandırın; sağlayıcı limitlerini ve test alıcı kısıtlarını kontrol edin.

## Kurtarma kodları

`runtime.sql` bağımsız rastgele hash sırrını Supabase Vault içinde üretir. Bu sır yalnızca sunucu rolüne açık RPC üzerinden Edge Function'a geçer. Sır değerini SQL çıktısına veya depoya almayın. Edge Function Supabase'in yerleşik sunucu ortamını kullanır; normal kurulumda ayrıca özel anahtar paylaşılması gerekmez.

Production adresi kesinleşince SQL Editor'da aşağıdaki sorguyu çalıştırın. `https://SITE_ADRESI` yerine adresin yalnızca origin bölümünü yazın; yol veya sondaki `/` olmamalı. Yeni origin en geç 60 saniyede devreye girer.

```sql
update private.app_settings
set value = jsonb_build_array('https://SITE_ADRESI')
where key = 'recovery_origins';
```

İzinli origin boşken kurtarma işlemi 503 döner. Bu ayarı tamamlayın. Alternatif olarak Edge secrets içinde `RECOVERY_PEPPER` ve virgülle ayrılmış `ALLOWED_ORIGINS` verilebilir; bu değerleri değiştirmenin önceki kurtarma kodlarını etkileyebileceğini göz önünde bulundurun.

CLI ile yeniden yayınlama:

```powershell
supabase login
supabase link --project-ref tyxtpfykgitqfhqjkayn
supabase functions deploy recovery-login
```

`supabase/config.toml` JWT doğrulamasını açık tutar. İstek gövdesi kullanıcı kimliği belirleyemez; doğrulanmış oturum, MFA seviyesi ve güncel oturum kaydı sunucuda kontrol edilir.

## Alan adı

Vercel **Project → Settings → Domains** üzerinden sahip olduğunuz `.com` veya `.nc.tr` alan adını ekleyin. Kayıt kuruluşunda Vercel panelinin gösterdiği DNS kayıtlarını uygulayın. Domain doğrulanıp HTTPS hazır olduğunda Auth URL'lerini ve `recovery_origins` değerini yeni origin ile güncelleyin. Alan adı satın alma ve kayıt uygunluğu kayıt kuruluşunda yapılır.

## Kontrol

Listeyi anonim oturumda, kayıt/giriş ve e-posta onayını gerçek bir hesapla kontrol edin. Berber hesabında hizmet ve saat oluşturun; farklı müşteri hesabıyla randevu alıp panelden onaylayın. Bildirim, tamamlanmış randevu yorumu ve TOTP/kurtarma akışını ayrı hesaplarda doğrulayın. Aynı saatte çakışan rezervasyonu veritabanı reddeder.

Advisors'taki `recovery_codes`, `recovery_attempts` ve `app_settings` için politikasız RLS bulguları istemci erişiminin kapalı tutulmasından kaynaklanır. `get_available_slots` yalnızca boş saatleri, `mfa_ok` yalnızca oturumun uygunluğunu döndürür; bunların izinleri uygulamanın erişim modeli içindir. Bu uyarıları kapatmak için özel tablolara istemci politikası eklemeyin.
