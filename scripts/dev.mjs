import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handle} from '../server/app.mjs';

try{process.loadEnvFile('.env.local');}catch(error){if(error.code!=='ENOENT')throw error;}
const origin='http://127.0.0.1:3000';
const root=fileURLToPath(new URL('../public',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm'};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')){
      const request=new Request(url,{method:req.method,headers:req.headers,
        ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response=await handle(request);
      const headers=Object.fromEntries(response.headers);
      if(response.headers.has('Set-Cookie'))headers['set-cookie']=response.headers.getSetCookie();
      res.writeHead(response.status,headers);
      if(response.body)Readable.fromWeb(response.body).pipe(res);
      else res.end();
      return;
    }
    const path=resolve(root,'.'+(['/', '/faishonix'].includes(url.pathname)?'/index.html':decodeURIComponent(url.pathname)));
    if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
    const content=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:content);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500).end();}
}).listen(3000,'127.0.0.1',()=>console.log('Faishonix at '+origin));
