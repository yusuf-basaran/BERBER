const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function generate({outputRoot=root}={}){
 const target=path.resolve(outputRoot),tr=(await import('../js/i18n.js')).dictionaries.tr,text=k=>escape(tr[k]||k);
 const css=await fs.readFile(path.join(root,'css/style.css'),'utf8'),color=name=>{const value=css.match(new RegExp('--'+name+':\\s*(#[a-fA-F0-9]{6})[;\\s]'))?.[1];if(!value)throw Error('Tema rengi bulunamadı: '+name);return value;};
 const manifest={id:'/',name:'BERBER',short_name:'BERBER',description:tr['pwa.description'],lang:'tr',start_url:'/?source=pwa',scope:'/',display:'standalone',background_color:color('zemin'),theme_color:color('zemin'),icons:[192,512].map(size=>({src:`/assets/pwa-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'}))};
 await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'manifest.webmanifest'),JSON.stringify(manifest,null,2)+'\n');
 const offline='<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark"><title>'+text('pwa.offlineTitle')+' | BERBER</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/pwa-192.png"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/responsive.css"><script type="module" src="/js/offline-page.js"></script></head><body><main id="main" class="offline-page"><img src="/assets/pwa-192.png" width="96" height="96" alt="BERBER"><h1 data-i18n="pwa.offlineTitle">'+text('pwa.offlineTitle')+'</h1><p data-i18n="pwa.offlineHint">'+text('pwa.offlineHint')+'</p><p data-offline-status role="status"></p><button type="button" class="button" data-offline-retry data-i18n="common.retry">'+text('common.retry')+'</button><a class="text-button" href="/" data-i18n="nav.home">'+text('nav.home')+'</a></main></body></html>\n';
 await fs.writeFile(path.join(target,'cevrimdisi.html'),offline);
 const markup='<link rel="manifest" href="/manifest.webmanifest"><script type="module" src="/js/pwa.js"></script>';
 for(const file of await fs.readdir(target)){if(!file.endsWith('.html')||file==='cevrimdisi.html')continue;const p=path.join(target,file);let html=await fs.readFile(p,'utf8');if(!html.includes('src="/js/pwa.js"'))html=html.replace('</head>',markup+'</head>');html=html.replace(/(<link rel="apple-touch-icon" href=")[^"]+(")/g,'$1/assets/pwa-192.png$2');await fs.writeFile(p,html);}
 const assets=['css/style.css','css/responsive.css','js/i18n.js','js/offline-page.js','assets/pwa-192.png','assets/pwa-512.png'];
 const template=await fs.readFile(path.join(root,'lib/pwa-worker.template.js'),'utf8'),hash=createHash('sha256').update(offline).update(template);
 for(const asset of assets)hash.update(await fs.readFile(path.join(root,asset)));
 const version=hash.digest('hex').slice(0,16);await fs.writeFile(path.join(target,'sw.js'),template.replace('__CACHE_VERSION__',version).replace('__PUSH_BODY__',JSON.stringify(tr['push.body'])));
 return {version,staticAssets:assets.length+1};
}
if(require.main===module)generate().then(r=>console.log(JSON.stringify(r))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={generate};
