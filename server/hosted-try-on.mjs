import {createHmac,timingSafeEqual} from 'node:crypto';

const api='https://api.fashn.ai/v1';
const photo=/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const outputPhoto=/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const model='tryon-v1.6';

export function hostedTryOnEnabled(user){
  const emails=(process.env.FASHN_PILOT_EMAILS||'').toLowerCase().split(',').map(email=>email.trim());
  return Boolean(process.env.FASHN_API_KEY&&user?.email_confirmed_at&&emails.includes(user.email?.toLowerCase()));
}

function signature(payload){
  return createHmac('sha256',process.env.FASHN_API_KEY).update('faishonix-try-on:'+payload).digest();
}

function jobToken(job,user){
  const payload=Buffer.from(JSON.stringify({job,user,expires:Date.now()+20*60_000})).toString('base64url');
  return payload+'.'+signature(payload).toString('base64url');
}

function readToken(token,user){
  try{
    const [payload,mac]=token.split('.');
    const received=Buffer.from(mac,'base64url');
    const expected=signature(payload);
    if(received.length!==expected.length||!timingSafeEqual(received,expected))return null;
    const data=JSON.parse(Buffer.from(payload,'base64url'));
    return data.user===user&&data.expires>Date.now()&&/^[A-Za-z0-9-]{8,160}$/.test(data.job)?data.job:null;
  }catch{return null;}
}

async function provider(path,body){
  const response=await fetch(api+path,{
    method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+process.env.FASHN_API_KEY,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Try-on provider returned '+response.status);
  return response.json();
}

export async function hostedTryOn(request,url,user,db,readJson,json){
  if(!hostedTryOnEnabled(user))return json({error:'Hosted try-on is not enabled for this account.'},503);
  const id=url.pathname.split('/')[3];
  if(request.method==='GET'&&id){
    const job=readToken(id,user.id);
    if(!job)return json({error:'Try-on preview expired or is unavailable.'},404);
    const result=await provider('/status/'+job);
    const output=result.output?.[0];
    if(result.status==='completed'){
      if(typeof output!=='string'||output.length>4_000_000||!outputPhoto.test(output)){
        return json({error:'The try-on preview could not be displayed.'},502);
      }
      return json({id,status:'succeeded',output});
    }
    const status=['starting','in_queue','processing'].includes(result.status)?'processing':'failed';
    return json({id,status});
  }
  if(request.method!=='POST'||id)return json({error:'Method not allowed.'},405);
  const input=await readJson(request,3_700_000);
  if(input?.consent!==true||typeof input.person!=='string'||!photo.test(input.person)||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.productId||'')){
    return json({error:'Choose a listing and consent before sharing your scan photo.'},400);
  }
  const {data:product,error}=await db.from('vendor_products').select('photo_path,category')
    .eq('id',input.productId).eq('published',true).maybeSingle();
  if(error)throw error;
  if(!product?.category)return json({error:'This garment is unavailable for try-on.'},404);
  let reserved=false;
  for(let slot=1;slot<=4;slot++){
    const {error:reserveError}=await db.from('try_on_daily_slots').insert({slot});
    if(!reserveError){reserved=true;break;}
    if(reserveError.code!=='23505')throw reserveError;
  }
  if(!reserved)return json({error:'This account has used its four pilot previews for today.'},429);
  const garment=db.storage.from('vendor-photos').getPublicUrl(product.photo_path).data.publicUrl;
  const category=['trouser','shorts','skirt'].includes(product.category)?'bottoms':
    product.category==='dress'?'one-pieces':product.category==='suit'?'auto':'tops';
  const result=await provider('/run',{
    model_name:model,
    inputs:{model_image:input.person,garment_image:garment,category,moderation_level:'conservative',
      mode:'balanced',num_samples:1,output_format:'jpeg',return_base64:true}
  });
  if(!/^[A-Za-z0-9-]{8,160}$/.test(result.id||'')||result.error)return json({error:'The try-on provider did not start the preview.'},502);
  return json({id:jobToken(result.id,user.id),status:'starting'},202);
}
