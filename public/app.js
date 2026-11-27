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

async function startFootScan(side){
  closeCapture();
  const area=document.getElementById('shoe-'+side+'-area');
  previousCapture={area,content:[...area.childNodes],className:area.className,onclick:area.onclick};
  const session=openCapture(area,side==='right'?'Right foot measurement':'Foot measurement',()=>startFootScan(side));
  area.replaceChildren();
  const controls=captureControls;
  controls.style.display='flex';
  controls.innerHTML='<p aria-live="polite">Hold the camera directly overhead with the full foot and A4 sheet visible.</p><button type="button" id="foot-photo" disabled>Take photo</button><label>Measured length (cm) <input id="foot-manual" type="number" min="20" max="35" step="0.1" inputmode="decimal"></label><button type="button" id="foot-save">Use length</button>';
  const status=controls.querySelector('p');
  const photo=document.getElementById('foot-photo');
  const manual=document.getElementById('foot-manual');
  function accept(length,method){
    if(!Number.isFinite(length)||length<20||length>35){status.textContent='Enter a foot length from 20 to 35 cm.';return;}
    footCaptures[side]=Math.round(length*10)/10;
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
  }
  document.getElementById('foot-save').onclick=()=>accept(manual.valueAsNumber,'Measured length');
  const video=document.createElement('video');
  video.autoplay=true;
  video.playsInline=true;
  video.muted=true;
  video.style.cssText='width:100%;height:100%;object-fit:contain';
  area.append(video);
  photo.onclick=()=>{
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
    status.textContent=instructions[0];
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

async function searchWardrobe(){
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
    const {items,products}=await api('/api/wardrobe',{query,gender});
    if(section.dataset.search!==request)return;
    status.textContent=products.length?'Shop vendor listings':'No vendor listings match your search.';
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
  const link=document.createElement('a');
  link.className='btn-dark';
  link.href=product.purchase_url;
  link.target='_blank';
  link.rel='noopener noreferrer';
  link.textContent='Order from vendor';
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
  contents.append(price,link);
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
const signOut=document.getElementById('signout');
const vendorForm=document.getElementById('vendor-form');
const vendorStatus=document.getElementById('vendor-status');
const vendorList=document.getElementById('vendor-list');
let accountEmail=null;
let tryOnEnabled=false;
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
  accountEmail=null;
  historyConsent.checked=false;
  historyConsent.disabled=true;
  historyDelete.disabled=true;
  historyStatus.textContent='Sign in to view or save scans.';
  vendorStatus.textContent='Sign in with an approved vendor account.';
  try{
    const session=await api('/api/session');
    if(generation!==accountGeneration)return;
    accountEmail=session.email;
    tryOnEnabled=session.tryOnEnabled;
    checkTryOnReady();
    accountForm.hidden=Boolean(accountEmail);
    signOut.hidden=!accountEmail;
    accountStatus.textContent=accountEmail?'Signed in as '+accountEmail:'';
    if(accountEmail){
      historyConsent.disabled=false;
      historyConsent.checked=localStorage.getItem(consentKey())==='true';
      await Promise.all([loadHistory(generation),loadVendor(generation)]);
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
  try{await api('/api/auth',{action:'signout'});await loadSession();}
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

loadScannerCatalogue(selectedItem);
