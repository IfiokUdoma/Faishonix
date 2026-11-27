function cameraAvailable(){
  return window.isSecureContext&&Boolean(navigator.mediaDevices?.getUserMedia);
}

function cameraError(error){
  if(error.name==='NotAllowedError')return 'Camera blocked. Allow camera access in your browser, then reopen the scanner.';
  if(error.name==='NotFoundError')return 'No camera is available. Connect one or use the manual estimate.';
  if(error.name==='NotReadableError')return 'The camera is busy. Close other camera apps and retry.';
  return 'The camera opened without a usable video feed. Reopen it or use the manual estimate.';
}

async function startVideo(video){
  let timeout;
  try{
    await Promise.race([video.play(),new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(new Error('Camera did not start')),8000);
    })]);
    if(!video.videoWidth||video.readyState<2)throw new Error('No video frame');
  }finally{clearTimeout(timeout);}
}

const captureDialog = document.createElement('dialog');
captureDialog.id = 'capture-dialog';
captureDialog.setAttribute('aria-labelledby','capture-title');
captureDialog.innerHTML = '<header class="capture-header"><h2 id="capture-title"></h2><button type="button" id="capture-close">Close camera</button></header><div id="capture-host"></div><div class="capture-controls" id="capture-controls"></div>';
document.body.append(captureDialog);
const captureHost = document.getElementById('capture-host');
const captureControls = document.getElementById('capture-controls');
let captureSlot;
let captureArea;
let captureSequence=0;
let previousCapture;
captureDialog.addEventListener('cancel',event=>{event.preventDefault();closeCapture();});
document.getElementById('capture-close').onclick=()=>closeCapture();

function openCapture(area,title,retry){
  captureSlot=document.createComment('Camera slot');
  area.before(captureSlot);
  captureArea=area;
  captureHost.append(area);
  area.onclick=null;
  area.dataset.captureRetry='true';
  area.captureRetry=retry;
  document.getElementById('capture-title').textContent=title;
  captureControls.replaceChildren();
  captureControls.style.display='none';
  document.body.style.overflow='hidden';
  captureDialog.dataset.session=String(++captureSequence);
  captureDialog.showModal();
  return captureDialog.dataset.session;
}

function closeCapture(preview){
  if(!captureDialog.open)return;
  stopCamera();
  if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}
  if(footStream){footStream.getTracks().forEach(track=>track.stop());footStream=null;}
  window.speechSynthesis?.cancel();
  captureDialog.dataset.session='';
  captureDialog.close();
  document.body.style.overflow='';
  const retry=captureArea.captureRetry;
  captureArea.classList.remove('active-cam');
  if(preview){
    captureArea.replaceChildren(preview);
  }else if(previousCapture?.area===captureArea){
    captureArea.replaceChildren(...previousCapture.content);
    captureArea.className=previousCapture.className;
    captureArea.onclick=previousCapture.onclick;
  }else{
    const button=document.createElement('button');
    button.className='btn-dark';
    button.textContent='Open camera';
    button.onclick=retry;
    captureArea.replaceChildren(button);
  }
  previousCapture=null;
  captureSlot.replaceWith(captureArea);
  captureControls.replaceChildren();
}

function updateShoeButton(){
  const button=document.getElementById('shoe-btn');
  button.disabled=shoeResultLocked||!footCaptures.left||(shoeAsym&&!footCaptures.right);
}

const footEstimator=import('/foot-measure.mjs').catch(()=>null);

async function startFootScan(side){
  closeCapture();
  const area=document.getElementById('shoe-'+side+'-area');
  previousCapture={area,content:[...area.childNodes],className:area.className,onclick:area.onclick};
  const session=openCapture(area,side==='right'?'Right foot measurement':'Foot measurement',()=>startFootScan(side));
  area.replaceChildren();
  const controls=captureControls;
  controls.style.display='flex';
  controls.innerHTML='<p aria-live="polite">Place your foot on white A4 paper on a dark floor. Hold the camera straight above the paper. A dark sock helps the app see the outline.</p><button type="button" id="foot-photo" disabled>Take photo</button><label>Measured length (cm) <input id="foot-manual" type="number" min="20" max="35" step="0.1" inputmode="decimal"></label><button type="button" id="foot-save">Use length</button>';
  const status=controls.querySelector('p');
  const photo=document.getElementById('foot-photo');
  const manual=document.getElementById('foot-manual');
  function accept(length,method,width){
    if(!Number.isFinite(length)||length<20||length>35){status.textContent='Enter a foot length from 20 to 35 cm.';return;}
    footCaptures[side]=Math.round(length*10)/10;
    footWidths[side]=Number.isFinite(width)?width:null;
    const preview=document.createElement('button');
    preview.className='btn-dark';
    preview.textContent=`${footCaptures[side]} cm · Remeasure`;
    preview.onclick=()=>startFootScan(side);
    closeCapture(preview);
    document.getElementById('shoe-'+side+'-status').textContent=method;
    shoeResultLocked=false;
    document.getElementById('shoe-results-panel').classList.remove('show');
    document.getElementById('shoe-placeholder').style.display='';
    updateShoeButton();
    if(!shoeAsym||footCaptures.left&&footCaptures.right)runShoeScan();
  }
  document.getElementById('foot-save').onclick=()=>accept(manual.valueAsNumber,'Measured length');
  const video=document.createElement('video');
  video.autoplay=true;
  video.playsInline=true;
  video.muted=true;
  video.style.cssText='width:100%;height:100%;object-fit:contain';
  const guide=document.createElement('div');
  guide.className='foot-photo-guide';
  guide.setAttribute('aria-hidden','true');
  area.append(video,guide);
  photo.onclick=async()=>{
    if(video.readyState<2||!video.videoWidth){status.textContent='Camera is warming up. Try again.';return;}
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    const context=canvas.getContext('2d');
    context.drawImage(video,0,0);
    footStream?.getTracks().forEach(track=>track.stop());
    footStream=null;
    const review=document.createElement('div');
    review.id='foot-review';
    review.append(canvas);
    area.replaceChildren(review);
    photo.disabled=false;
    photo.textContent='Retake photo';
    photo.onclick=()=>startFootScan(side);
    const instructions=['Mark one end of the 29.7 cm paper edge.','Mark the other end of the same long edge.','Mark the back of your heel.','Mark the tip of your longest toe.'];
    const points=[];
    status.textContent='Checking the paper and foot outline…';
    const estimator=await footEstimator;
    if(captureDialog.dataset.session!==session)return;
    const sample=document.createElement('canvas');
    const factor=Math.min(1,320/Math.max(canvas.width,canvas.height));
    sample.width=Math.round(canvas.width*factor);
    sample.height=Math.round(canvas.height*factor);
    const sampleContext=sample.getContext('2d',{willReadFrequently:true});
    sampleContext.drawImage(canvas,0,0,sample.width,sample.height);
    const automatic=estimator?.estimateFootOnA4(sampleContext.getImageData(0,0,sample.width,sample.height));
    if(automatic){
      manual.value=automatic.length.toFixed(1);
      status.textContent='Detected '+automatic.length+' cm long × '+automatic.width+' cm wide. Review the length and tap Use length, or mark the paper and foot to recalibrate.';
      document.getElementById('foot-save').onclick=()=>accept(manual.valueAsNumber,'Detected from A4 photo',manual.valueAsNumber===automatic.length?automatic.width:null);
    }else{
      status.textContent='Could not isolate an outline. '+instructions[0];
    }
    canvas.onclick=event=>{
      const bounds=canvas.getBoundingClientRect();
      const x=(event.clientX-bounds.left)*canvas.width/bounds.width;
      const y=(event.clientY-bounds.top)*canvas.height/bounds.height;
      points.push([x,y]);
      context.fillStyle='#ffb800';
      context.beginPath();context.arc(x,y,7,0,2*Math.PI);context.fill();
      if(points.length<4){status.textContent=instructions[points.length];return;}
      canvas.onclick=null;
      const length=(a,b)=>Math.hypot(points[a][0]-points[b][0],points[a][1]-points[b][1]);
      const estimate=length(2,3)*29.7/length(0,1);
      if(!Number.isFinite(estimate)||estimate<20||estimate>35){status.textContent='The scale or landmarks are out of range. Retake or enter measured length.';return;}
      manual.value=estimate.toFixed(1);
      status.textContent='Review the estimate. For best results, keep the page and foot flat and the camera directly overhead.';
      document.getElementById('foot-save').onclick=()=>accept(manual.valueAsNumber,'A4 photo estimate');
    };
  };
  if(!cameraAvailable()){status.textContent='Camera requires HTTPS and browser camera access. You can enter a ruler measurement below.';return;}
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
    if(captureDialog.dataset.session!==session){stream.getTracks().forEach(track=>track.stop());return;}
    footStream=stream;
    video.srcObject=stream;
    await startVideo(video);
    if(captureDialog.dataset.session===session)photo.disabled=false;
  } catch(error) {
    if(captureDialog.dataset.session===session){
      footStream?.getTracks().forEach(track=>track.stop());
      footStream=null;
      status.textContent=cameraError(error)+' You can enter a ruler measurement below.';
    }
  }
}

async function api(path,body,method){
  const options={method:method||(body===undefined?'GET':'POST')};
  if(body instanceof FormData)options.body=body;
  else if(body!==undefined){
    options.headers={'Content-Type':'application/json'};
    options.body=JSON.stringify(body);
  }
  const response=await fetch(path,options);
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||'Service unavailable. Please try again.');
  return result;
}

async function suggest(query,gender){
  return (await api('/api/style',{query,gender})).items;
}

async function searchWardrobe(excludeProductId){
  const section=document.getElementById('wardrobe');
  const query=document.getElementById('wardrobe-query').value;
  const gender=document.getElementById('wardrobe-gender').value;
  const status=document.getElementById('catalogue-status');
  const list=document.getElementById('catalogue-results');
  const request=String(Number(section.dataset.search||0)+1);
  section.dataset.search=request;
  status.textContent='Searching the catalogue…';
  list.replaceChildren();
  document.getElementById('wardrobe-results').style.display='none';
  document.getElementById('wardrobe-placeholder').style.display='none';
  try{
    const {items,products:matches}=await api('/api/wardrobe',{query,gender});
    const products=matches.filter(product=>product.id!==excludeProductId);
    if(section.dataset.search!==request)return;
    status.textContent=products.length?'Shop vendor listings':items.length?'Style ideas below. No matching vendor listings yet.':'No vendor listings match yet. Try a garment, fabric or occasion.';
    list.replaceChildren(...products.map(product=>productCard(product)));
    if(items.length)renderWardrobeResults(items);
  }catch(error){
    if(section.dataset.search===request)status.textContent=error.message;
  }
}

const scannerCatalogue=document.getElementById('scanner-catalogue-results');
const scannerCatalogueStatus=document.getElementById('scanner-catalogue-status');
let scannerSearch=0;
async function loadScannerCatalogue(category){
  const request=++scannerSearch;
  scannerCatalogue.replaceChildren();
  scannerCatalogueStatus.textContent='Looking for vendor listings…';
  try{
    const {products}=await api('/api/wardrobe',{category});
    if(request!==scannerSearch)return;
    scannerCatalogueStatus.textContent=products.length?'':'No vendor listings in this category yet. You can still find your size below.';
    scannerCatalogue.replaceChildren(...products.slice(0,4).map(product=>productCard(product)));
  }catch(error){
    if(request===scannerSearch)scannerCatalogueStatus.textContent='Catalogue unavailable. You can still find your size below.';
  }
}

function productCard(product,onToggle){
  const card=document.createElement('article');
  card.className='catalogue-card';
  const photo=document.createElement('img');
  photo.src=product.photo_url;
  photo.alt=product.name;
  photo.loading='lazy';
  const contents=document.createElement('div');
  const title=document.createElement('h3');
  title.textContent=product.name;
  const brand=document.createElement('p');
  brand.textContent=product.brand;
  brand.className='catalogue-brand';
  const desc=document.createElement('p');
  desc.textContent=product.description;
  const sizes=document.createElement('p');
  sizes.textContent='Sizes: '+product.sizes;
  const price=document.createElement('strong');
  price.textContent=new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(product.price_kobo/100);
  contents.append(brand,title,desc,sizes);
  if(product.size_chart){
    const chart=document.createElement('details');
    const summary=document.createElement('summary');
    summary.textContent='Size chart';
    const guide=document.createElement('p');
    guide.textContent=product.size_chart;
    chart.append(summary,guide);
    contents.append(chart);
  }
  contents.append(price);
  if(!onToggle&&product.category){
    const pair=document.createElement('button');
    pair.type='button';
    pair.className='mood-tag';
    pair.textContent='Find matching pieces';
    pair.onclick=()=>{
      const queries={suit:'suit shirt loafer watch belt wallet',jacket:'blazer trouser loafer watch',dress:'dress shoe bag accessory',trouser:'shirt blazer sneaker'};
      const query=queries[product.category]||'polo jeans sneakers hoodie wallet';
      document.getElementById('wardrobe-query').value=query;
      displayPage('/wardrobe',true);
      searchWardrobe(product.id);
    };
    contents.append(pair);
    const fit=document.createElement('button');
    fit.type='button';
    fit.className='mood-tag';
    fit.textContent='Continue to fit checkout';
    fit.onclick=()=>openCustomFit(product);
    contents.append(fit);
  }
  if(onToggle&&!product.category){
    const label=document.createElement('label');
    label.textContent='Set garment type for custom fit';
    const select=document.createElement('select');
    loadCategories(select);
    select.onchange=async()=>{
      if(!select.value)return;
      select.disabled=true;
      try{await api('/api/vendor',{id:product.id,category:select.value},'PATCH');await loadVendor();}
      catch(error){vendorStatus.textContent=error.message;}
      finally{select.disabled=false;}
    };
    label.append(select);
    contents.append(label);
  }
  if(!onToggle&&tryOnEnabled&&accountEmail){
    const tryButton=document.createElement('button');
    tryButton.className='mood-tag';
    tryButton.type='button';
    tryButton.textContent='Use in virtual try-on';
    tryButton.onclick=async()=>{
      tryButton.disabled=true;
      try{
        const response=await fetch(product.photo_url);
        if(!response.ok)throw new Error('Photo unavailable');
        const photo=await response.blob();
        if(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>2_097_152)throw new Error('Invalid photo');
        loadGarmentPhoto(photo);
        displayPage('/try-on',true);
      }catch{showToast('Could not load the vendor photo for try-on.');}
      finally{tryButton.disabled=false;}
    };
    contents.append(tryButton);
  }
  if(onToggle){
    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='mood-tag';
    toggle.textContent=product.published?'Unpublish':'Publish';
    toggle.onclick=()=>onToggle(toggle,product);
    contents.append(toggle);
  }
  card.append(photo,contents);
  return card;
}

function renderStyleCards(container,items){
  container.innerHTML=items.map(item=>`<div class="outfit-card"><div class="outfit-name">${item.name}</div><div class="outfit-desc">${item.desc}</div><span class="outfit-tag">${item.match}</span></div>`).join('');
}

async function getOutfitSuggestions(){
  try {
    const gender=document.getElementById('gender').value;
    renderStyleCards(document.getElementById('outfit-grid'),await suggest('casual, work, wedding',gender));
    document.getElementById('outfit-section').style.display='block';
  }catch(error){showToast(error.message);}
}

async function getTryOnPairings(){
  try {
    const occasion=document.getElementById('occasion-input').value;
    const gender=document.getElementById('gender').value;
    renderStyleCards(document.getElementById('occasion-results'),await suggest(occasion,gender));
  }catch(error){showToast(error.message);}
}

const historySection=document.getElementById('scan-history');
const historyConsent=document.getElementById('history-consent');
const historyStatus=document.getElementById('history-status');
const historyList=historySection.querySelector('ul');
const historyDelete=document.getElementById('history-delete');
const accountForm=document.getElementById('account-form');
const accountStatus=document.getElementById('account-status');
const confirmedEmail=new URLSearchParams(location.search).get('confirmed')==='1';
if(confirmedEmail)history.replaceState(null,'','/account'+location.search);
const signOut=document.getElementById('signout');
const vendorForm=document.getElementById('vendor-form');
const vendorRegistration=document.getElementById('vendor-registration');
const fitStatus=document.getElementById('fit-status');
const fitList=document.getElementById('fit-request-list');
const customFit=document.getElementById('custom-fit');
const fitForm=document.getElementById('custom-fit-form');
const fitFormStatus=document.getElementById('custom-fit-status');
const fitPhotoConsent=document.getElementById('fit-photo-consent');
const sequencePreview=document.getElementById('fit-preview');
let previewGeneration=0;
let previewedPhoto;

let fitProduct=null;
const fitLabels={...FL,garment_length:'Desired garment length'};

function loadCategories(select){
  select.replaceChildren(new Option('Choose garment type',''),...Object.entries(ITEMS).map(([key,item])=>new Option(item.label,key)));
}
loadCategories(vendorForm.elements.category);

function openCustomFit(product){
  displayPage('/body-scan',true);
  fitProduct=product;
  previewGeneration++;
  previewedPhoto=null;
  sequencePreview.hidden=true;
  sequencePreview.replaceChildren();
  fitForm.elements.photoConsent.checked=false;
  fitPhotoConsent.hidden=!hostedTryOnAvailable;
  selectItem(product.category);
  document.getElementById('custom-fit-title').textContent=product.name+' · '+product.brand;
  const fields=new Set(ITEMS[product.category].fields);
  if(product.category==='dress')fields.add('shoulder');
  if(product.category==='suit')fields.add('hips');
  if(!['trouser','shorts'].includes(product.category))fields.add('garment_length');
  const inputs=[...fields].map(field=>{
    const label=document.createElement('label');
    label.textContent=fitLabels[field]+' (cm)';
    const input=document.createElement('input');
    Object.assign(input,{name:field,type:'number',min:'1',max:'300',step:'0.1',required:true});
    label.append(input);
    return label;
  });
  document.getElementById('custom-fit-fields').replaceChildren(...inputs);
  fitForm.elements.consent.checked=false;
  fitFormStatus.textContent='';
  customFit.hidden=false;
  customFit.scrollIntoView({behavior:'smooth'});
}

function prefillCustomFit(category,result,fromPose){
  if(fitProduct?.category!==category||!fromPose)return;
  for(const input of document.querySelectorAll('#custom-fit-fields input')){
    const value=result[input.name];
    if(input.value===''&&Number.isFinite(value)&&result.sources?.[input.name]!=='Lookup estimate')input.value=String(Math.round(value*10)/10);
  }
  fitFormStatus.textContent='Scan estimates are ready for review. Check them with a tape and fill in the remaining fields.';
  customFit.scrollIntoView({behavior:'smooth'});
  continueFitWithPreview(category);
}

async function createHostedPreview(person,productId){
  if(person.length>2_700_000){
    const image=new Image();
    image.src=person;
    await image.decode();
    const scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(image.naturalWidth*scale);
    canvas.height=Math.round(image.naturalHeight*scale);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    person=canvas.toDataURL('image/jpeg',0.76);
  }
  let job=await api('/api/try-on',{person,productId,consent:true});
  for(let attempt=0;attempt<45&&['starting','processing'].includes(job.status);attempt++){
    await sleep(1250);
    job=await api('/api/try-on/'+encodeURIComponent(job.id));
  }
  if(job.status!=='succeeded'||!job.output)throw new Error('The visual preview could not be generated.');
  return job.output;
}

function appendVisual(container,source,caption){
  const figure=document.createElement('figure');
  const image=document.createElement('img');
  image.src=source;
  image.alt=caption;
  const label=document.createElement('figcaption');
  label.textContent=caption;
  figure.append(image,label);
  container.append(figure);
}

async function continueFitWithPreview(category){
  const product=fitProduct;
  const photo=captures.front;
  if(!product||product.category!==category||!photo||!hostedTryOnAvailable||
    !fitForm.elements.photoConsent.checked||previewedPhoto===photo)return;
  previewedPhoto=photo;
  const generation=++previewGeneration;
  const title=document.createElement('h3');
  title.textContent='Your virtual fitting';
  const status=document.createElement('p');
  status.setAttribute('role','status');
  status.textContent='Generating a preview of '+product.name+' using your front scan…';
  const visuals=document.createElement('div');
  visuals.className='fit-visuals';
  sequencePreview.replaceChildren(title,status,visuals);
  sequencePreview.hidden=false;
  sequencePreview.scrollIntoView({behavior:'smooth'});
  try{
    const first=await createHostedPreview(photo,product.id);
    if(generation!==previewGeneration)return;
    appendVisual(visuals,first,'You in '+product.name);
    const opposite=['trouser','skirt','shorts'].includes(category)?'shirt-short':'trouser';
    const {products}=await api('/api/wardrobe',{category:opposite});
    if(generation!==previewGeneration)return;
    const pairing=products.find(item=>item.id!==product.id);
    if(!pairing){status.textContent='Preview ready. No matching garment is listed yet.';return;}
    appendVisual(visuals,pairing.photo_url,pairing.name+' · '+pairing.brand);
    const shop=document.createElement('button');
    shop.type='button';
    shop.className='mood-tag';
    shop.textContent='Fit checkout for '+pairing.name;
    shop.onclick=()=>openCustomFit(pairing);
    visuals.lastElementChild.append(shop);
    if(['dress','suit','traditional'].includes(category)){
      status.textContent='Garment preview and a catalogue pairing are ready.';
      return;
    }
    status.textContent='Generating the outfit preview…';
    const paired=await createHostedPreview(first,pairing.id);
    if(generation!==previewGeneration)return;
    appendVisual(visuals,paired,product.name+' with '+pairing.name);
    status.textContent='Previews ready. Review your measurements before sending the order request.';
  }catch(error){
    if(generation===previewGeneration){status.textContent=error.message;previewedPhoto=null;}
  }
}

async function loadFitRequests(generation=accountGeneration){
  try{
    const {requests}=await api('/api/fit-requests');
    if(generation!==accountGeneration)return;
    fitStatus.textContent=requests.length?'':'No fit requests yet.';
    fitList.replaceChildren(...requests.map(request=>{
      const card=document.createElement('article');
      card.className='scan-panel fit-request-card';
      const title=document.createElement('h3');
      title.textContent=(request.vendor_products?.name||'Garment')+' · '+request.status.replaceAll('_',' ');
      const desc=document.createElement('p');
      desc.textContent=request.incoming?'Customer: '+request.customer_email:'Vendor: '+(request.vendor_products?.brand||'Listing unavailable');
      const measure=document.createElement('p');
      measure.textContent=Object.entries(request.measurements).map(([key,value])=>(fitLabels[key]||key)+': '+value+' cm').join(' · ');
      card.append(title,desc,measure);
      if(request.tracking_reference){
        const tracking=document.createElement('p');
        tracking.textContent='Tracking: '+request.tracking_reference;
        card.append(tracking);
      }
      const next={requested:['accepted','declined'],accepted:['in_production'],in_production:['shipped'],shipped:['delivered']};
      if(request.incoming&&next[request.status]){
        for(const status of next[request.status]){
          const captions={accepted:'Accept request',declined:'Decline request',in_production:'Start making garment',shipped:'Mark shipped',delivered:'Mark delivered'};
          const button=document.createElement('button');
          button.className='mood-tag';
          button.textContent=captions[status];
          button.onclick=async()=>{
            button.disabled=true;
            const trackingReference=status==='shipped'?window.prompt('Enter a shipping or delivery reference.'):undefined;
            if(status==='shipped'&&!trackingReference?.trim()){button.disabled=false;return;}
            try{await api('/api/fit-requests',{id:request.id,status,trackingReference},'PATCH');await loadFitRequests(generation);}
            catch(error){if(generation===accountGeneration)fitStatus.textContent=error.message;}
            finally{button.disabled=false;}
          };
          card.append(button);
        }
      }
      return card;
    }));
  }catch(error){if(generation===accountGeneration)fitStatus.textContent=error.message;}
}

fitForm.onsubmit=async event=>{
  event.preventDefault();
  if(!accountEmail){
    fitFormStatus.textContent='Sign in, then return here to send your fit request.';
    displayPage('/account',true);
    return;
  }
  const generation=accountGeneration;
  const productId=fitProduct.id;
  const button=event.submitter;
  const dimensions=Object.fromEntries([...document.querySelectorAll('#custom-fit-fields input')].map(input=>[input.name,input.valueAsNumber]));
  button.disabled=true;
  try{
    await api('/api/fit-requests',{productId,measurements:dimensions,consent:fitForm.elements.consent.checked});
    if(generation!==accountGeneration)return;
    if(fitProduct?.id===productId){
      fitFormStatus.textContent='Request sent. Your vendor can accept or decline it. You can follow its status under Orders. Payment is unavailable in this pilot.';
      fitForm.elements.consent.checked=false;
    }
    await loadFitRequests(generation);
  }catch(error){if(generation===accountGeneration)fitFormStatus.textContent=error.message;}
  finally{button.disabled=false;}
};

vendorRegistration.onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter;
  button.disabled=true;
  try{await api('/api/vendor-registration',{brand:new FormData(vendorRegistration).get('brand')});await loadVendor();}
  catch(error){vendorStatus.textContent=error.message;}
  finally{button.disabled=false;}
};
const vendorStatus=document.getElementById('vendor-status');
const vendorList=document.getElementById('vendor-list');
let accountEmail=null;
let tryOnEnabled=false;
let hostedTryOnAvailable=false;
let accountGeneration=0;

const consentKey=()=> 'faishonix-scan-opt-in:'+accountEmail;
historyConsent.onchange=()=>localStorage.setItem(consentKey(),String(historyConsent.checked));

async function loadHistory(generation=accountGeneration){
  if(!accountEmail)return;
  try{
    const {scans}=await api('/api/scans');
    if(generation!==accountGeneration)return;
    historyList.replaceChildren(...scans.map(scan=>{
      const row=document.createElement('li');
      const date=new Date(scan.timestamp).toLocaleString();
      row.textContent=`${date} · ${ITEMS[scan.item]?.label||'Shoes'} · ${scan.item==='shoes'?'EU ':''}${scan.measurements.size}`;
      return row;
    }));
    historyStatus.textContent=scans.length?'':'No saved scans yet.';
    historyDelete.disabled=!scans.length;
  }catch(error){if(generation===accountGeneration)historyStatus.textContent=error.message;}
}

async function saveScan({item,measurements}){
  if(!accountEmail||!historyConsent.checked)return;
  const generation=accountGeneration;
  try{await api('/api/scans',{item,measurements});await loadHistory(generation);}
  catch(error){if(generation===accountGeneration)historyStatus.textContent='Scan was not saved. '+error.message;}
}

historyDelete.onclick=async()=>{
  if(!window.confirm('Clear all saved scans for your account?'))return;
  const generation=accountGeneration;
  try{await api('/api/scans',undefined,'DELETE');await loadHistory(generation);}
  catch(error){if(generation===accountGeneration)historyStatus.textContent=error.message;}
};

async function toggleListing(button,product){
  const generation=accountGeneration;
  button.disabled=true;
  try{
    await api('/api/vendor',{id:product.id,published:!product.published},'PATCH');
    await loadVendor(generation);
  }catch(error){
    if(generation===accountGeneration)vendorStatus.textContent=error.message;
  }finally{button.disabled=false;}
}

async function loadVendor(generation=accountGeneration){
  try{
    const {brand,products}=await api('/api/vendor');
    if(generation!==accountGeneration)return;
    vendorRegistration.hidden=Boolean(brand);
    vendorForm.hidden=!brand;
    if(!brand){vendorStatus.textContent='Create your vendor profile to start publishing.';return;}
    vendorStatus.textContent=products.length?brand:`${brand} · No listings yet.`;
    vendorForm.hidden=false;
    vendorList.replaceChildren(...products.map(product=>productCard(product,toggleListing)));
  }catch(error){if(generation===accountGeneration)vendorStatus.textContent=error.message;}
}

async function loadSession(){
  const generation=++accountGeneration;
  historyList.replaceChildren();
  vendorList.replaceChildren();
  vendorForm.reset();
  vendorForm.hidden=true;
  vendorRegistration.hidden=true;
  fitList.replaceChildren();
  fitStatus.textContent='Sign in to send or manage fit requests.';
  accountEmail=null;
  historyConsent.checked=false;
  historyConsent.disabled=true;
  historyDelete.disabled=true;
  historyStatus.textContent='Sign in to view or save scans.';
  vendorStatus.textContent='Sign in to open your vendor dashboard.';
  try{
    const session=await api('/api/session');
    if(generation!==accountGeneration)return;
    accountEmail=session.email;
    tryOnEnabled=session.tryOnEnabled;
    hostedTryOnAvailable=session.hostedTryOnEnabled===true;
    fitPhotoConsent.hidden=!hostedTryOnAvailable;
    checkTryOnReady();
    accountForm.hidden=Boolean(accountEmail);
    signOut.hidden=!accountEmail;
    accountStatus.textContent=accountEmail?'Signed in as '+accountEmail:confirmedEmail?'Sign in with the email and password you registered.':'';
    if(accountEmail){
      historyConsent.disabled=false;
      historyConsent.checked=localStorage.getItem(consentKey())==='true';
      await Promise.all([loadHistory(generation),loadVendor(generation),loadFitRequests(generation)]);
    }
  }catch(error){if(generation===accountGeneration)accountStatus.textContent=error.message;}
}

accountForm.onsubmit=async event=>{
  event.preventDefault();
  const fields=new FormData(accountForm);
  const action=event.submitter?.value||'signin';
  const buttons=accountForm.querySelectorAll('button');
  buttons.forEach(button=>button.disabled=true);
  try{
    const {signedIn}=await api('/api/auth',{action,email:fields.get('email'),password:fields.get('password')});
    accountForm.reset();
    if(signedIn)await loadSession();
    else accountStatus.textContent='Check your email to confirm your account, then sign in.';
  }catch(error){accountStatus.textContent=error.message;}
  finally{buttons.forEach(button=>button.disabled=false);}
};

signOut.onclick=async()=>{
  signOut.disabled=true;
  try{await api('/api/auth',{action:'signout'});fitProduct=null;previewGeneration++;previewedPhoto=null;sequencePreview.hidden=true;sequencePreview.replaceChildren();customFit.hidden=true;fitForm.reset();document.getElementById('custom-fit-fields').replaceChildren();await loadSession();}
  catch(error){accountStatus.textContent=error.message;}
  finally{signOut.disabled=false;}
};

vendorForm.onsubmit=async event=>{
  event.preventDefault();
  const generation=accountGeneration;
  const button=vendorForm.querySelector('button');
  const data=new FormData(vendorForm);
  if(data.get('photo').size>2_097_152){vendorStatus.textContent='Choose a photo no larger than 2 MB.';return;}
  button.disabled=true;
  vendorStatus.textContent='Publishing listing…';
  try{
    await api('/api/vendor',data);
    if(generation!==accountGeneration)return;
    vendorForm.reset();
    await loadVendor(generation);
  }catch(error){if(generation===accountGeneration)vendorStatus.textContent=error.message;}
  finally{button.disabled=false;}
};

loadSession();

document.getElementById('shoe-gender').addEventListener('change',()=>{
  shoeResultLocked=false;
  document.getElementById('shoe-results-panel').classList.remove('show');
  document.getElementById('shoe-placeholder').style.display='';
  updateShoeButton();
});

document.addEventListener('keydown',event=>{
  if(event.target.matches('.cam-area[role="button"]')&&(event.key==='Enter'||event.key===' ')){
    event.preventDefault();
    event.target.click();
  }
});

const pagePaths=new Set([...document.querySelectorAll('[data-page]')].map(section=>section.dataset.page));
const legacyPages={'#scanner':'/body-scan','#shoe-scan':'/foot-scan','#vendor':'/vendor','#wardrobe':'/wardrobe','#tryon':'/try-on','#fit-requests':'/orders','#scan-history':'/account'};
let pagePath;
async function loadShop(){
  const list=document.getElementById('shop-results');
  const status=document.getElementById('shop-status');
  status.textContent='Loading garments…';
  try{
    const {products}=await api('/api/wardrobe',{browse:true});
    list.replaceChildren(...products.map(product=>productCard(product)));
    status.textContent=products.length?'':'No published garments yet.';
  }catch(error){status.textContent=error.message;}
}
function displayPage(path,push=false){
  if(!pagePaths.has(path))path='/';
  if(push&&location.pathname!==path)history.pushState(null,'',path);
  if(pagePath===path)return;
  closeCapture();
  pagePath=path;
  for(const section of document.querySelectorAll('[data-page]'))section.hidden=section.dataset.page!==path;
  for(const link of document.querySelectorAll('nav a')){
    if(link.getAttribute('href')===path)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0,0);
  if(path==='/shop')loadShop();
  if(path==='/body-scan'){
    vision??=initVisionSystem();
    loadScannerCatalogue(selectedItem);
  }
  if(path==='/orders'&&accountEmail)loadFitRequests();
}
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href]');
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!link)return;
  const path=link.getAttribute('href');
  if(!pagePaths.has(path))return;
  event.preventDefault();
  displayPage(path,true);
});
window.addEventListener('popstate',()=>displayPage(legacyPages[location.hash]||location.pathname));
displayPage(confirmedEmail?'/account':legacyPages[location.hash]||location.pathname);
