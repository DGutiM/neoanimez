// Local preview only. Never serves backups, caches, SQL, or hidden files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.argv.find(x => /^--port=/.test(x))?.split('=')[1] || 4192);
const mock = process.argv.includes('--mock-auth');
const publicFiles = new Set(['index.html','service-worker.js','manifest.json','logo.png','icon.png','preview.png','robots.txt','sitemap.xml','anime-index.json','anime-lista.json','anime-upcoming.json','anime-schedule.json','anime-news.json','anime-relations.json','anime-timeline-index.json','anime-extras-index.json']);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
http.createServer((req,res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1) || 'index.html'; } catch { res.writeHead(400).end(); return; }
  if (mock && name === '__test/auth.js') {
    res.setHeader('Content-Type',types['.js']);
    res.setHeader('Cache-Control','no-store');
    res.end(fs.readFileSync(path.join(__dirname,'fixtures/auth-preview.js'))); return;
  }
  if (mock && name === 'service-worker.js') {
    res.setHeader('Content-Type',types['.js']);
    res.setHeader('Cache-Control','no-store');
    res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));"); return;
  }
  if (name.includes('..') || !(publicFiles.has(name) || /^(assets|anime-details|anime-timelines|anime-extras)\/[a-zA-Z0-9_.-]+\.(js|css|json)$/.test(name))) { res.writeHead(404).end(); return; }
  const file=path.join(root,name);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type',types[path.extname(name)] || 'text/plain');
  res.setHeader('Cache-Control','no-store');
  if (name==='index.html' && mock) {
    res.end(fs.readFileSync(file,'utf8').replace(/<script src="https:\/\/cdn.jsdelivr.net\/npm\/@supabase\/supabase-js@2"><\/script>/,'<script src="/__test/auth.js"></script>'));
  } else fs.createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${port}${mock?' (mock auth, no real accounts)':''}`));
