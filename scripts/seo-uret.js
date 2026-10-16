const {readFile,writeFile,unlink,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const seo=require('../lib/seo.cjs');
const root=path.resolve(__dirname,'..');
const e=seo.escapeHtml;let tr;
const text=(key,params={})=>Object.entries(params).reduce((value,[name,replacement])=>value.replaceAll('{'+name+'}',String(replacement)),tr?.[key]||key);
function page(title,description,canonical,body){const heading=title.replace(/ \| BERBER$/,'');return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>'+e(title)+'</title><meta name="description" content="'+e(description)+'"><link rel="canonical" href="'+e(canonical)+'"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/responsive.css"><link rel="icon" type="image/png" href="/assets/berber-icon.png"><script type="module" src="/js/seo-page.js"></script></head><body><a class="skip-link" href="#main">'+e(text('nav.skip'))+'</a><header class="site-header"><a class="wordmark" href="/" aria-label="'+e(text('brand.home'))+'"><img class="brand-logo" src="/assets/berber-logo.png" width="2172" height="724" alt="BERBER"></a><div data-nav></div></header><main id="main" class="browse-layout"><section class="browse-hero"><p class="eyebrow">'+e(text('seo.kicker'))+'</p><h1>'+e(heading)+'</h1><p class="intro">'+e(description)+'</p></section>'+body+'</main><footer class="site-footer" data-footer><div class="footer-links"><a href="/kosullar">'+e(text('nav.terms'))+'</a><a href="/kisisel-veri">'+e(text('nav.privacy'))+'</a></div></footer></body></html>\n';}
function shopCard(shop,config){return '<article class="barber-card" data-seo-shop="'+e(shop.id)+'"><a class="barber-card-link" href="/b/'+e(shop.slug)+'"><img class="shop-photo" src="'+e(seo.coverImage(shop,config))+'" alt="'+e(shop.shop_name)+'" loading="lazy" width="640" height="360"><div class="barber-card-body"><h2>'+e(shop.shop_name)+'</h2><p>'+e(shop.city)+' · '+e(shop.district)+'</p><p>'+e(shop.address)+'</p><span class="text-button">'+e(text('seo.viewServices'))+'</span></div></a></article>';}
async function generate({fetcher=fetch,outputRoot=root}={}){
 const destination=path.resolve(outputRoot);await mkdir(destination,{recursive:true});
 tr=(await import('../js/i18n.js')).dictionaries.tr;
 const config=await seo.publicConfig(root);const [shopsRaw,locations]=await Promise.all([seo.allRows(config,'barbers',{select:seo.publicShopFields,verification_status:'eq.approved',is_active:'eq.true',order:'id'},{fetcher}),seo.allRows(config,'locations',{select:'city,district',order:'city,district'},{fetcher})]);
 const shops=shopsRaw.filter(seo.approved),files=new Map(),urls=new Set([config.origin+'/']),cities=[...new Set(locations.map(r=>r.city))].sort((a,b)=>a.localeCompare(b,'tr'));
 const link=(city,district)=>'/'+seo.slugify(city)+(district?'-'+seo.slugify(district):'')+'-berber';
 for(const city of cities){for(const district of[null,...[...new Set(locations.filter(r=>r.city===city).map(r=>r.district))].sort((a,b)=>a.localeCompare(b,'tr'))]){
  const route=link(city,district),filename=route.slice(1)+'.html';if(!/^[a-z0-9-]+-berber\.html$/.test(filename)||files.has(filename))throw Error('SEO dosya adı çakışıyor.');
  const selected=shops.filter(s=>s.city===city&&(!district||s.district===district)),label=(district?district+' · ':'')+city,title=text('seo.cityTitle',{location:label}),desc=text('seo.cityDescription',{location:label});
  const links=district?'<a class="text-button" href="'+link(city)+'">'+e(text('seo.backCity',{city}))+'</a>':'<nav class="seo-districts" aria-label="'+e(text('seo.districts'))+'">'+locations.filter(r=>r.city===city).map(r=>'<a href="'+link(city,r.district)+'">'+e(r.district)+'</a>').join('')+'</nav>';
  const live='/index.html?'+new URLSearchParams({city,...(district?{district}:{})});
  const body=links+'<p data-seo-count role="status">'+e(text('seo.shopCount',{count:selected.length}))+'</p>'+(selected.length>24?'<p>'+e(text('seo.firstResults',{count:24}))+'</p>':'')+'<div class="barber-grid">'+(selected.length?selected.slice(0,24).map(s=>shopCard(s,config)).join(''):'<p class="notice">'+e(text('seo.empty'))+' <a href="/">'+e(text('seo.otherRegions'))+'</a>.</p>')+'</div><a class="button button--secondary" href="'+e(live)+'">'+e(text('seo.showAll'))+'</a>';
  files.set(filename,page(title,desc,config.origin+route,body));urls.add(config.origin+route);
 }}
 for(const shop of shops)urls.add(config.origin+'/b/'+shop.slug);
 const paths=[...files.keys()].sort(),manifest={version:1,origin:config.origin,paths,data_sha256:createHash('sha256').update(JSON.stringify({shops,locations})).digest('hex')};
 let previous;try{previous=JSON.parse(await readFile(path.join(destination,'.seo-dosyalar.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const [name,content]of files)await writeFile(path.join(destination,name),content);
 for(const name of previous?.paths||[]){if(!/^[a-z0-9-]+-berber\.html$/.test(name))throw Error('Eski dosya listesi geçersiz.');const target=path.resolve(destination,name);if(!target.startsWith(destination+path.sep))throw Error('Dosya kök dışında.');if(!files.has(name))await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 await writeFile(path.join(destination,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+[...urls].sort().map(url=>'<url><loc>'+e(url)+'</loc></url>').join('\n')+'\n</urlset>\n');
 const protectedPaths=['admin','panel','musteriler','profil','randevularim','guvenlik','favoriler','giris','kayit','yazdir'];
 await writeFile(path.join(destination,'robots.txt'),'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /supabase/\nDisallow: /scripts/\nDisallow: /lib/\n'+protectedPaths.flatMap(p=>['Disallow: /'+p+'$','Disallow: /'+p+'.html$']).join('\n')+'\nSitemap: '+config.origin+'/sitemap.xml\n');
 await writeFile(path.join(destination,'.seo-dosyalar.json'),JSON.stringify(manifest,null,2)+'\n');return {pages:files.size,shops:shops.length,urls:urls.size};
}
module.exports={generate,page,shopCard};
if(require.main===module)generate().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
