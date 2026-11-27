const captureDialog = document.createElement('dialog');
captureDialog.id = 'capture-dialog';
captureDialog.setAttribute('aria-labelledby','capture-title');
captureDialog.innerHTML = '<header class="capture-header"><h2 id="capture-title"></h2><button type="button" id="capture-close">Close camera</button></header><div id="capture-host"></div><div class="capture-controls" id="capture-controls" hidden></div>';
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
    footStream.getTracks().forEach(track=>track.stop());
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
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
    if(captureDialog.dataset.session!==session){stream.getTracks().forEach(track=>track.stop());return;}
    footStream=stream;
    video.srcObject=stream;
    await video.play();
    photo.disabled=false;
  } catch {
    if(captureDialog.dataset.session===session)status.textContent='Camera unavailable. Enter a foot length measured with a ruler.';
  }
}

async function api(path,body,method){
  const response=await fetch(path,body===undefined?{method:method||'GET'}:{
    method:method||'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||'Service unavailable. Please try again.');
  return result;
}

async function suggest(query,gender){
  return (await api('/api/style',{query,gender})).items;
}

async function searchWardrobe(){
  try{
    const query=document.getElementById('wardrobe-query').value;
    const gender=document.getElementById('wardrobe-gender').value;
    renderWardrobeResults(await suggest(query,gender));
  }catch(error){
    document.getElementById('wardrobe-results').style.display='none';
    document.getElementById('wardrobe-placeholder').style.display='';
    showToast(error.message);
  }
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

const historySection=document.createElement('section');
historySection.id='scan-history';
historySection.className='section';
historySection.innerHTML='<h2 class="section-title">Your previous scans</h2><label><input type="checkbox" id="history-consent"> Save future scans to my history</label><p role="status" id="history-status"></p><ul></ul><button class="btn-dark" type="button" id="history-delete">Clear saved scans</button>';
document.getElementById('shoe-scan').after(historySection);
const historyConsent=document.getElementById('history-consent');
const historyStatus=document.getElementById('history-status');
historyConsent.checked=localStorage.getItem('faishonix-history-consent')==='true';
historyConsent.onchange=()=>localStorage.setItem('faishonix-history-consent',String(historyConsent.checked));

async function loadHistory(){
  const list=historySection.querySelector('ul');
  try{
    const {scans}=await api('/api/scans');
    list.replaceChildren(...scans.map(scan=>{
      const row=document.createElement('li');
      const date=new Date(scan.timestamp).toLocaleString();
      row.textContent=`${date} · ${ITEMS[scan.item]?.label||'Shoes'} · ${scan.item==='shoes'?'EU ':''}${scan.measurements.size}`;
      return row;
    }));
    historyStatus.textContent=scans.length?'':'No saved scans yet.';
  }catch(error){historyStatus.textContent=error.message;}
}

async function saveToD1({item,measurements}){
  if(!historyConsent.checked)return;
  try{await api('/api/scans',{item,measurements});await loadHistory();}
  catch(error){historyStatus.textContent='Scan was not saved. '+error.message;}
}
document.getElementById('history-delete').onclick=async()=>{
  if(!window.confirm('Clear all scans saved to this browser’s history account?'))return;
  try{await api('/api/scans',undefined,'DELETE');await loadHistory();}
  catch(error){historyStatus.textContent=error.message;}
};
loadHistory();

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
