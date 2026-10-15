export const config = Object.freeze({
  supabaseUrl: 'https://tyxtpfykgitqfhqjkayn.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eHRwZnlrZ2l0cWZocWprYXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTQxODIsImV4cCI6MjEwNzU5MDE4Mn0.-NG0Vb7Cq-P9sIAaw8noBOw44RMvoi7TpdIf50yw4sc',
  timeZone: 'Europe/Nicosia',
  locale: 'tr-TR',
  storageBucket: 'barber-photos',
  maxPhotoBytes: 5 * 1024 * 1024,
  photoTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  appUrl: new URL('../', import.meta.url).href,
  sessionStorageKey: 'berber-auth-tyxtpfykgitqfhqjkayn'
});

const pages = Object.freeze({
  home: 'index.html', barber: 'berber.html', login: 'giris.html', register: 'kayit.html',
  appointments: 'randevularim.html', panel: 'panel.html', security: 'guvenlik.html',
  terms: 'kosullar.html', privacy: 'kisisel-veri.html'
});

export function pageUrl(page, params = {}) {
  if (!Object.hasOwn(pages, page)) throw new TypeError('Geçersiz sayfa.');
  const url = new URL(pages[page], config.appUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.href;
}

export function safeReturnUrl(value, fallback = 'home') {
  const defaultUrl = pageUrl(fallback);
  if (typeof value !== 'string' || !value || /[\\\u0000-\u001f]/.test(value)) return defaultUrl;
  try {
    const base = new URL(config.appUrl);
    const url = new URL(value, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return defaultUrl;
    const path = url.pathname.slice(base.pathname.length);
    const allowed = ['index.html', 'berber.html', 'randevularim.html', 'panel.html', 'guvenlik.html', '', 'berber', 'randevularim', 'panel', 'guvenlik'];
    if (!allowed.includes(path)) return defaultUrl;
    url.hash = '';
    for (const key of ['access_token', 'refresh_token', 'code', 'error', 'error_description']) url.searchParams.delete(key);
    return url.href;
  } catch { return defaultUrl; }
}
