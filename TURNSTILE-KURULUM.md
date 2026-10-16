# Turnstile kurulumu

Kayıt, şifreli giriş, e-posta kodu gönderme ve onay e-postasını yeniden gönderme çağrıları options.captchaToken alır. Her denemeden sonra widget sıfırlanır. MFA doğrulama ve recovery-login çağrılarında CAPTCHA kullanılmaz.

Canlı site anahtarı henüz sağlanmadığı için config.js içindeki turnstileSiteKey boş; koruma etkinmiş gibi gösterilmez. Cloudflare Turnstile alanına berber-1.vercel.app ekle, site anahtarını config.js'e yaz. Gizli anahtarı yalnızca Supabase Authentication → Attack Protection → CAPTCHA → Turnstile alanına kaydet. Supabase CAPTCHA'yı anahtarlarla birlikte etkinleştir; böylece token'sız Auth istekleri sunucuda reddedilir. Bu adım için Cloudflare hesabına erişim gerekiyor; test anahtarı canlıya konmaz.

Yerel geliştirmede Cloudflare resmi test site anahtarı 1x00000000000000000000AA ve test gizli anahtarı 1x0000000000000000000000000000000AA kullanılabilir. Canlı sağlayıcı anahtarlarıyla değiştirilmeden üretime alınmaz.

Kontrol: tokensız signup/password/OTP isteğini reddet; geçerli token ile başarılı giriş yap; aynı token ikinci kez kullanılamasın; yanlış şifre sonrası yeni doğrulama al; TOTP ve kurtarma kodu akışlarını ayrıca çalıştır.

Kaynaklar: https://supabase.com/docs/guides/auth/auth-captcha ve https://developers.cloudflare.com/turnstile/troubleshooting/testing/
