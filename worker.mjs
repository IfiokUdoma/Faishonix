import {styleSuggestions} from './style.mjs';

const researchVersion='c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4';
const cookiePattern=/(?:^|;\s*)faishonix_session=([a-f0-9-]{36})(?:;|$)/;
const imagePattern=/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const fields=['chest','waist','hips','shoulder','arm','inseam','neck','leftArm','rightArm','leftInseam','rightInseam','left','right'];

function json(value,status=200,headers={}){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}

async function sameSecret(actual,expected){
  const encode=new TextEncoder();
  const [left,right]=await Promise.all([actual,expected].map(value=>crypto.subtle.digest('SHA-256',encode.encode(value))));
  const a=new Uint8Array(left);
  const b=new Uint8Array(right);
  let different=0;
  for(let i=0;i<a.length;i++)different|=a[i]^b[i];
  return different===0;
}

async function readJson(request,maxBytes){
  const type=request.headers.get('Content-Type')||'';
  if(!type.toLowerCase().startsWith('application/json')||!request.body)return null;
  const reader=request.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0;
  let text='';
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>maxBytes){await reader.cancel();return null;}
    text+=decoder.decode(value,{stream:true});
  }
  try{return JSON.parse(text+decoder.decode());}catch{return null;}
}

async function replicate(env,id,input){
  const response=await fetch('https://api.replicate.com/v1/predictions'+(id?'/'+id:''),{
    method:id?'GET':'POST',
    headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,'Content-Type':'application/json','Cancel-After':'2m'},
    body:input?JSON.stringify({version:env.TRY_ON_MODEL_VERSION||researchVersion,input}):undefined,
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Replicate returned '+response.status);
  const prediction=await response.json();
  if(!/^[a-z0-9]{12,64}$/.test(prediction.id))throw new Error('Invalid prediction ID');
  const output=Array.isArray(prediction.output)?prediction.output[0]:prediction.output;
  return {id:prediction.id,status:prediction.status,output:typeof output==='string'&&/^https:\/\/(?:[a-z0-9-]+\.)*replicate\.delivery\//.test(output)?output:null};
}

async function history(request,env,owner,isNew,secure){
  if(!env.DB)return json({error:'Scan history database is unavailable.'},503);
  if(request.method==='GET'){
    const {results}=await env.DB.prepare('SELECT id,item,measurements,timestamp FROM pilot_scans WHERE owner=? ORDER BY timestamp DESC LIMIT 100').bind(owner).all();
    const headers=isNew?{'Set-Cookie':`faishonix_session=${owner}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure?'; Secure':''}`}:{};
    return json({scans:results.map(row=>({...row,measurements:JSON.parse(row.measurements)}))},200,headers);
  }
  if(isNew)return json({error:'Enable cookies and reload to use scan history.'},401);
  if(request.method==='DELETE'){
    await env.DB.prepare('DELETE FROM pilot_scans WHERE owner=?').bind(owner).run();
    return json({ok:true});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const data=await readJson(request,4096);
  const size=data?.measurements?.size;
  if(!data||typeof data.item!=='string'||!/^[a-z][a-z_-]{1,24}$/.test(data.item)||!['string','number'].includes(typeof size)||!/^(?:[A-Z]{1,5}|[2-6]XL|[0-9]{2})$/.test(String(size))){
    return json({error:'Invalid scan result.'},400);
  }
  const measurements={size};
  for(const field of fields){
    const value=data.measurements[field];
    if(Number.isFinite(value)&&value>0&&value<=300)measurements[field]=value;
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO pilot_scans (id,owner,item,measurements,timestamp) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),owner,data.item,JSON.stringify(measurements),new Date().toISOString()),
    env.DB.prepare('DELETE FROM pilot_scans WHERE owner=? AND id NOT IN (SELECT id FROM pilot_scans WHERE owner=? ORDER BY timestamp DESC, rowid DESC LIMIT 100)').bind(owner,owner)
  ]);
  return json({ok:true},201);
}

async function tryOn(request,env,owner,id){
  if(!env.REPLICATE_API_TOKEN||!env.BETA_PASSWORD||(!env.TRY_ON_MODEL_VERSION&&env.ENABLE_NONCOMMERCIAL_TRY_ON!=='true'))return json({error:'Virtual try-on is unavailable in this environment.'},503);
  if(!env.DB||!owner)return json({error:'Reload the page with cookies enabled before trying on a garment.'},401);
  if(id&&request.method==='GET'){
    const job=await env.DB.prepare('SELECT 1 FROM try_on_jobs WHERE id=? AND owner=? AND created_at>?').bind(id,owner,Date.now()-3600000).first();
    if(!job)return json({error:'Try-on job not found.'},404);
    return json(await replicate(env,id));
  }
  if(id||request.method!=='POST')return json({error:'Method not allowed.'},405);
  const input=await readJson(request,6_500_000);
  if(![input?.person,input?.garment].every(value=>typeof value==='string'&&value.length<=3_200_000&&imagePattern.test(value))||
     !['upper_body','lower_body','dresses'].includes(input.category)){
    return json({error:'Use JPEG, PNG or WebP photos up to about 2.3 MB each and select a garment category.'},400);
  }
  const bucket=new Date().toISOString().slice(0,10);
  const limit=Math.max(1,Math.min(100,Number(env.TRY_ON_DAILY_LIMIT)||20));
  const quota=await env.DB.prepare('INSERT INTO try_on_quota VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET uses=uses+1 WHERE uses<? RETURNING uses').bind(bucket,limit).first();
  if(!quota)return json({error:'The pilot try-on limit has been reached for today.'},429);
  const prediction=await replicate(env,null,{human_img:input.person,garm_img:input.garment,
    garment_des:'Product garment photo',category:input.category,crop:true});
  await env.DB.batch([
    env.DB.prepare('INSERT INTO try_on_jobs VALUES (?,?,?)').bind(prediction.id,owner,Date.now()),
    env.DB.prepare('DELETE FROM try_on_jobs WHERE created_at<?').bind(Date.now()-3600000),
    env.DB.prepare('DELETE FROM try_on_quota WHERE bucket<?').bind(bucket)
  ]);
  return json(prediction,202);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/store-sdk.js'&&request.method==='GET'){
      const asset=await env.ASSETS.fetch(request);
      const headers=new Headers(asset.headers);
      headers.set('Access-Control-Allow-Origin','*');
      return new Response(asset.body,{status:asset.status,headers});
    }
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(!local&&!env.BETA_PASSWORD)return new Response('Pilot access is not configured.',{status:503});
    if(env.BETA_PASSWORD){
      let password='';
      try{
        const raw=request.headers.get('Authorization')||'';
        const credentials=atob(raw.startsWith('Basic ')?raw.slice(6):'');
        if(credentials.startsWith('pilot:'))password=credentials.slice(6);
      }catch{}
      if(!await sameSecret(password,env.BETA_PASSWORD)){
        return new Response('Pilot sign-in required.',{status:401,headers:{'WWW-Authenticate':'Basic realm="Faishonix Pilot", charset="UTF-8"','Cache-Control':'no-store'}});
      }
    }
    if(!url.pathname.startsWith('/api/')){
      if(url.pathname==='/faishonix')return Response.redirect(new URL('/',url),302);
      return env.ASSETS.fetch(request);
    }
    if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin&&
      !(request.headers.get('Origin')===null&&request.headers.get('Sec-Fetch-Site')==='same-origin')){
      return json({error:'Requests must come from Faishonix.'},403);
    }
    const session=request.headers.get('Cookie')?.match(cookiePattern)?.[1];
    try{
      if(url.pathname==='/api/style'&&request.method==='POST'){
        const input=await readJson(request,2048);
        const items=styleSuggestions(input?.query,input?.gender);
        return items.length?json({items}):json({error:'Try a recognised occasion or garment, such as wedding, office, Ankara or blazer.'},422);
      }
      if(url.pathname==='/api/scans')return await history(request,env,session||crypto.randomUUID(),!session,!local);
      const prediction=url.pathname.match(/^\/api\/try-on(?:\/([a-z0-9]{12,64}))?$/);
      if(prediction)return await tryOn(request,env,session,prediction[1]);
      return json({error:'Endpoint not found.'},404);
    }catch(error){
      console.error('Faishonix service error',error.message);
      return json({error:'Service temporarily unavailable. Please try again.'},503);
    }
  }
};
