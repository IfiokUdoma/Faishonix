import {createClient} from '@supabase/supabase-js';
import {styleSuggestions} from '../style.mjs';

const bucket='vendor-photos';
const researchVersion='0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985';
const measurements=['chest','waist','hips','shoulder','arm','inseam','neck','leftArm','rightArm','leftInseam','rightInseam','left','right'];
const imagePattern=/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const jobOwners=new Map();
let quota={day:'',count:0};

function json(data,status=200){
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

function supabase(token){
  const {NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}=process.env;
  if(!url||!key)throw new Error('Supabase URL or publishable key is missing');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:token?{headers:{Authorization:'Bearer '+token}}:{}});
}

function cookie(request,name){
  return request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);
}

function sessionCookies(response,session,secure){
  const flags='; Path=/; HttpOnly; SameSite=Lax'+(secure?'; Secure':'');
  response.headers.append('Set-Cookie',`faish_access=${session?.access_token||''}${flags}; Max-Age=${session?.expires_in||0}`);
  response.headers.append('Set-Cookie',`faish_refresh=${session?.refresh_token||''}${flags}; Max-Age=${session?2592000:0}`);
  return response;
}

async function authenticated(request,client){
  let token=cookie(request,'faish_access');
  let refreshed;
  let user=token?(await client.auth.getUser(token)).data.user:null;
  const refresh_token=cookie(request,'faish_refresh');
  if(!user&&refresh_token){
    const {data}=await client.auth.refreshSession({refresh_token});
    refreshed=data.session;
    user=data.user;
    token=refreshed?.access_token;
  }
  return {user,db:user?supabase(token):client,refreshed,token};
}

async function readBody(request,maxBytes){
  if(!request.body)return null;
  const reader=request.body.getReader();
  const chunks=[];
  let bytes=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>maxBytes){await reader.cancel();return null;}
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readJson(request,maxBytes){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return null;
  const body=await readBody(request,maxBytes);
  try{return body?JSON.parse(body):null;}catch{return null;}
}

async function authAction(request,client,secure){
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const data=await readJson(request,2048);
  if(data?.action==='signout'){
    const session=await authenticated(request,client);
    if(session.user){
      const {error}=await client.auth.admin.signOut(session.token,'local');
      if(error)console.warn('Supabase sign-out:',error.code);
    }
    return sessionCookies(json({ok:true}),null,secure);
  }
  const email=typeof data?.email==='string'?data.email.trim():'';
  const password=data?.password;
  if(!['signup','signin'].includes(data?.action)||!email||email.length>254||
    typeof password!=='string'||password.length<(data.action==='signup'?8:1)||password.length>128){
    return json({error:'Enter your email and a password. New accounts require at least 8 characters.'},400);
  }
  const credentials={email,password};
  const result=data.action==='signup'?await client.auth.signUp(credentials):await client.auth.signInWithPassword(credentials);
  if(result.error){
    return json({error:data.action==='signin'?'Sign-in failed. Check your password and confirm your email.':'Could not create an account. Try signing in or wait and retry.'},400);
  }
  return sessionCookies(json({signedIn:Boolean(result.data.session)}),result.data.session,secure);
}

async function scans(request,db){
  if(request.method==='GET'){
    const {data,error}=await db.from('scan_history').select('id,item,measurements,timestamp:created_at').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    return json({scans:data});
  }
  if(request.method==='DELETE'){
    const {error}=await db.from('scan_history').delete().not('id','is',null);
    if(error)throw error;
    return json({ok:true});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const input=await readJson(request,4096);
  const size=input?.measurements?.size;
  if(typeof input?.item!=='string'||!/^[a-z][a-z_-]{1,24}$/.test(input.item)||
    !['string','number'].includes(typeof size)||!/^(?:[A-Z]{1,5}|[2-6]XL|[0-9]{2})$/.test(String(size))){
    return json({error:'Invalid scan result.'},400);
  }
  const clean={size};
  for(const field of measurements){
    const value=input.measurements[field];
    if(Number.isFinite(value)&&value>0&&value<=300)clean[field]=value;
  }
  const {error}=await db.from('scan_history').insert({item:input.item,measurements:clean});
  if(error)throw error;
  return json({ok:true},201);
}

function httpsUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;
  }catch{return null;}
}

function productCards(db,rows){
  return rows.flatMap(row=>{
    const {photo_path,...product}=row;
    const purchase_url=httpsUrl(product.purchase_url);
    if(!purchase_url)return [];
    return [{...product,purchase_url,photo_url:db.storage.from(bucket).getPublicUrl(photo_path).data.publicUrl}];
  });
}

const productFields='id,brand,name,description,tags,sizes,size_chart,price_kobo,purchase_url,photo_path,published';

async function wardrobe(request,db){
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const input=await readJson(request,2048);
  const query=typeof input?.query==='string'?input.query.trim():'';
  if(!query||query.length>180)return json({error:'Enter a garment, brand or occasion.'},400);
  const terms=query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0,12)||[];
  const items=styleSuggestions(query,input.gender);
  if(!terms.length)return json({error:'Enter a garment, brand or occasion.'},422);
  const {data,error}=await db.from('vendor_products').select(productFields).eq('published',true)
    .textSearch('search_terms',terms.join(' OR '),{type:'websearch',config:'english'})
    .order('created_at',{ascending:false}).limit(24);
  if(error)throw error;
  return json({items,products:productCards(db,data)});
}

async function vendorProducts(request,db,user){
  const {data:vendor,error:vendorError}=await db.from('vendor_accounts').select('brand').eq('user_id',user.id).maybeSingle();
  if(vendorError)throw vendorError;
  if(!vendor)return json({error:'This account has not been approved as a vendor.'},403);
  if(request.method==='GET'){
    const {data,error}=await db.from('vendor_products').select(productFields).eq('vendor_id',user.id).order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    return json({brand:vendor.brand,products:productCards(db,data)});
  }
  if(request.method==='PATCH'){
    const input=await readJson(request,2048);
    if(!uuid.test(input?.id||'')||typeof input?.published!=='boolean')return json({error:'Invalid listing update.'},400);
    const {data,error}=await db.from('vendor_products').update({published:input.published}).eq('id',input.id)
      .eq('vendor_id',user.id).select('id').maybeSingle();
    if(error)throw error;
    return data?json({ok:true}):json({error:'Listing not found.'},404);
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const type=request.headers.get('Content-Type')||'';
  if(!type.startsWith('multipart/form-data;'))return json({error:'Submit listing fields and one product photo.'},400);
  const bytes=await readBody(request,2_150_000);
  if(!bytes)return json({error:'Use a product photo up to 2 MB.'},413);
  const form=await new Response(bytes,{headers:{'Content-Type':type}}).formData().catch(()=>null);
  if(!form)return json({error:'Invalid listing form.'},400);
  const read=name=>typeof form.get(name)==='string'?form.get(name).trim():'';
  const name=read('name'),description=read('description'),tags=read('tags'),sizes=read('sizes'),size_chart=read('size_chart');
  const price=read('price'),price_kobo=Math.round(Number(price)*100);
  const purchase_url=httpsUrl(read('purchase_url'));
  const image=form.get('photo');
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  const ext=types[image?.type];
  if(!name||name.length>100||!description||description.length>500||tags.length>180||!sizes||sizes.length>120||size_chart.length>500||
    !/^\d{1,8}(\.\d{1,2})?$/.test(price)||price_kobo<1||price_kobo>1e9||!purchase_url||purchase_url.length>500||
    !(image instanceof File)||!ext||image.size<12||image.size>2_097_152){
    return json({error:'Check the required listing fields, HTTPS purchase link and JPEG, PNG or WebP photo.'},400);
  }
  const magic=Buffer.from(await image.slice(0,12).arrayBuffer());
  const valid=ext==='jpg'?magic.subarray(0,3).equals(Buffer.from([255,216,255])):
    ext==='png'?magic.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    magic.toString('ascii',0,4)==='RIFF'&&magic.toString('ascii',8,12)==='WEBP';
  if(!valid)return json({error:'The uploaded file does not match its image format.'},400);
  const photo_path=user.id+'/'+crypto.randomUUID()+'.'+ext;
  const storage=db.storage.from(bucket);
  const {error:uploadError}=await storage.upload(photo_path,image,{contentType:image.type});
  if(uploadError)throw uploadError;
  const {error}=await db.from('vendor_products').insert({brand:vendor.brand,name,description,tags,sizes,size_chart,price_kobo,purchase_url,photo_path});
  if(error){
    await storage.remove([photo_path]);
    throw error;
  }
  return json({ok:true},201);
}

async function tryOn(request,url,local,user){
  const token=process.env.REPLICATE_API_TOKEN;
  if(!local||!token||process.env.TRY_ON_MODEL_VERSION!==researchVersion){
    return json({error:'Virtual try-on is available only in the configured local research build.'},503);
  }
  const owner=user.id;
  const now=Date.now();
  for(const [id,job] of jobOwners)if(now-job.created>3600000)jobOwners.delete(id);
  const id=url.pathname.split('/')[3];
  let body;
  if(id&&request.method==='GET'){
    if(jobOwners.get(id)?.owner!==owner)return json({error:'Try-on job not found.'},404);
  }else if(!id&&request.method==='POST'){
    const input=await readJson(request,6_500_000);
    if(![input?.person,input?.garment].every(value=>typeof value==='string'&&value.length<=3_200_000&&imagePattern.test(value))||
      !['upper_body','lower_body','dresses'].includes(input.category)){
      return json({error:'Use supported photos up to about 2.3 MB each and select a garment category.'},400);
    }
    const day=new Date(now).toISOString().slice(0,10);
    if(quota.day!==day)quota={day,count:0};
    const limit=Math.min(100,Math.max(1,Number(process.env.TRY_ON_DAILY_LIMIT)||20));
    if(quota.count>=limit)return json({error:'Today’s local try-on limit has been reached.'},429);
    quota.count++;
    body=JSON.stringify({version:researchVersion,input:{human_img:input.person,garm_img:input.garment,category:input.category,garment_des:'Product garment photo',crop:true}});
  }else return json({error:'Method not allowed.'},405);
  const response=await fetch('https://api.replicate.com/v1/predictions'+(id?'/'+id:''),{
    method:id?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Cancel-After':'2m'},
    body,signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Replicate returned HTTP '+response.status);
  const prediction=await response.json();
  if(!/^[a-z0-9]{12,64}$/.test(prediction.id))throw new Error('Invalid prediction ID');
  if(!id)jobOwners.set(prediction.id,{owner,created:now});
  const output=Array.isArray(prediction.output)?prediction.output[0]:prediction.output;
  return json({id:prediction.id,status:prediction.status,output:typeof output==='string'&&/^https:\/\/(?:[a-z0-9-]+\.)*replicate\.delivery\//.test(output)?output:null},id?200:202);
}

export async function handle(request){
  const url=new URL(request.url);
  const local=!process.env.VERCEL&&process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const secure=!local;
  const route=url.pathname==='/api/router'?'/api/'+(url.searchParams.get('route')||''):url.pathname;
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin){
    return json({error:'Requests must come from Faishonix.'},403);
  }
  try{
    if(route==='/api/style'&&request.method==='POST'){
      const input=await readJson(request,2048);
      const items=styleSuggestions(input?.query,input?.gender);
      return items.length?json({items}):json({error:'Try a recognised occasion or garment, such as wedding, office, Ankara or blazer.'},422);
    }
    const client=supabase();
    if(route==='/api/auth')return await authAction(request,client,secure);
    if(route==='/api/wardrobe')return await wardrobe(request,client);
    const auth=await authenticated(request,client);
    let response;
    if(route==='/api/session'&&request.method==='GET'){
      response=json({email:auth.user?.email||null,tryOnEnabled:Boolean(local&&process.env.REPLICATE_API_TOKEN&&process.env.TRY_ON_MODEL_VERSION===researchVersion)});
    }else if(!auth.user){
      response=json({error:'Sign in to continue.'},401);
    }else if(route==='/api/scans'){
      response=await scans(request,auth.db);
    }else if(route==='/api/vendor'){
      response=await vendorProducts(request,auth.db,auth.user);
    }else if(/^\/api\/try-on(?:\/[a-z0-9]{12,64})?$/.test(route)){
      response=await tryOn(request,new URL(route,url),local,auth.user);
    }else response=json({error:'Endpoint not found.'},404);
    return auth.refreshed?sessionCookies(response,auth.refreshed,secure):response;
  }catch(error){
    console.error('Faishonix API',route,error.code||error.message);
    return json({error:'Service temporarily unavailable. Try again shortly.'},503);
  }
}
