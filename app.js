(()=>{'use strict';
const state={layers:[],selectedId:null,nextId:1,canvasW:6000,canvasH:1800,bg:'#0a0a0b',viewZoom:0.15,viewX:40,viewY:40,tool:'move',brushSize:40,opencvReady:false,isDragging:false,dragStart:null,cropStart:null,cropRect:null};
const $=(id)=>document.getElementById(id);
const wrap=$('canvas-wrap'),canvasBG=$('canvas-bg-grid'),canvasMain=$('canvas-main'),canvasOverlay=$('canvas-overlay');
const ctxBG=canvasBG.getContext('2d'),ctxMain=canvasMain.getContext('2d'),ctxOverlay=canvasOverlay.getContext('2d');
const layerList=$('layer-list'),dropzone=$('dropzone'),fileInput=$('file-input'),toast=$('toast'),opencvStatus=$('opencv-status'),canvasInfo=$('canvas-info');

function makeLayer(img,name){return{id:state.nextId++,name:name||`Layer ${state.nextId}`,img,visible:true,x:0,y:0,scale:1,rotation:0,skewX:0,skewY:0,feather:60,opacity:1,mask:null};}
function toast_show(msg,kind=''){toast.textContent=msg;toast.className='toast show'+(kind?' '+kind:'');setTimeout(()=>{toast.className='toast';},2400);}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function selectedLayer(){return state.layers.find(l=>l.id===state.selectedId)||null;}
function setSelected(id){state.selectedId=id;renderLayerList();refreshControls();render();}

function loadImageFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=(e)=>{const img=new Image();img.onload=()=>resolve({img,name:file.name});img.onerror=reject;img.src=e.target.result;};r.onerror=reject;r.readAsDataURL(file);});}

async function addFiles(files){
  const list=Array.from(files).filter(f=>f.type.startsWith('image/'));
  if(list.length===0){toast_show('No image files found.','err');return;}
  for(const f of list){
    try{
      const {img,name}=await loadImageFile(f);
      const layer=makeLayer(img,name);
      const last=state.layers[state.layers.length-1];
      if(last){layer.x=last.x+last.img.width*last.scale*0.7;layer.y=last.y;}else{layer.x=40;layer.y=40;}
      state.layers.push(layer);
    }catch(err){toast_show(`Failed to load ${f.name}`,'err');}
  }
  if(state.layers.length&&!state.selectedId){setSelected(state.layers[0].id);}
  renderLayerList();fitView();render();
  toast_show(`Added ${list.length} photo${list.length>1?'s':''}`,'ok');
}

dropzone.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',(e)=>addFiles(e.target.files));
['dragenter','dragover'].forEach(ev=>{dropzone.addEventListener(ev,(e)=>{e.preventDefault();dropzone.classList.add('dragover');});});
['dragleave','drop'].forEach(ev=>{dropzone.addEventListener(ev,(e)=>{e.preventDefault();dropzone.classList.remove('dragover');});});
dropzone.addEventListener('drop',(e)=>{e.preventDefault();if(e.dataTransfer.files.length)addFiles(e.dataTransfer.files);});
window.addEventListener('dragover',(e)=>e.preventDefault());
window.addEventListener('drop',(e)=>{if(e.target===dropzone||dropzone.contains(e.target))return;e.preventDefault();if(e.dataTransfer&&e.dataTransfer.files.length)addFiles(e.dataTransfer.files);});

function renderLayerList(){
  layerList.innerHTML='';
  [...state.layers].reverse().forEach((layer)=>{
    const li=document.createElement('li');
    li.className='layer-item'+(layer.id===state.selectedId?' selected':'');
    li.dataset.id=layer.id;li.draggable=true;
    li.innerHTML=`<span class="layer-handle" title="Drag to reorder">≡</span><canvas class="layer-thumb"></canvas><span class="layer-name" title="${layer.name.replace(/"/g,'&quot;')}">${layer.name}</span><button class="layer-vis ${layer.visible?'':'hidden'}" title="Toggle visibility">${layer.visible?'◉':'○'}</button>`;
    const thumb=li.querySelector('.layer-thumb');
    thumb.width=32;thumb.height=32;
    const tctx=thumb.getContext('2d');
    const r=Math.min(32/layer.img.width,32/layer.img.height);
    const tw=layer.img.width*r,th=layer.img.height*r;
    tctx.fillStyle='#1c1c20';tctx.fillRect(0,0,32,32);
    tctx.drawImage(layer.img,(32-tw)/2,(32-th)/2,tw,th);
    li.addEventListener('click',(e)=>{if(e.target.classList.contains('layer-vis'))return;setSelected(layer.id);});
    li.querySelector('.layer-vis').addEventListener('click',(e)=>{e.stopPropagation();layer.visible=!layer.visible;renderLayerList();render();});
    li.addEventListener('dragstart',(e)=>{e.dataTransfer.setData('text/plain',String(layer.id));li.classList.add('dragging');});
    li.addEventListener('dragend',()=>li.classList.remove('dragging'));
    li.addEventListener('dragover',(e)=>e.preventDefault());
    li.addEventListener('drop',(e)=>{e.preventDefault();const dId=parseInt(e.dataTransfer.getData('text/plain'),10);if(dId===layer.id)return;reorderLayer(dId,layer.id);});
    layerList.appendChild(li);
  });
}
function reorderLayer(dId,tId){const fi=state.layers.findIndex(l=>l.id===dId),ti=state.layers.findIndex(l=>l.id===tId);if(fi<0||ti<0)return;const[m]=state.layers.splice(fi,1);state.layers.splice(ti,0,m);renderLayerList();render();}

const controls={x:$('ctrl-x'),y:$('ctrl-y'),scale:$('ctrl-scale'),rot:$('ctrl-rot'),skewx:$('ctrl-skewx'),skewy:$('ctrl-skewy'),feather:$('ctrl-feather'),opacity:$('ctrl-opacity')};
const vals={x:$('val-x'),y:$('val-y'),scale:$('val-scale'),rot:$('val-rot'),skewx:$('val-skewx'),skewy:$('val-skewy'),feather:$('val-feather'),opacity:$('val-opacity')};

function refreshControls(){
  const l=selectedLayer();const en=!!l;
  Object.values(controls).forEach(c=>c.disabled=!en);
  $('btn-reset').disabled=!en;$('btn-delete').disabled=!en;
  $('btn-autoalign').disabled=!en||!state.opencvReady||state.layers.indexOf(l)===0;
  $('btn-autoalign-all').disabled=state.layers.length<2||!state.opencvReady;
  $('btn-autolevel').disabled=!en||!state.opencvReady;
  if(!l)return;
  controls.x.value=l.x;vals.x.textContent=Math.round(l.x);
  controls.y.value=l.y;vals.y.textContent=Math.round(l.y);
  controls.scale.value=l.scale;vals.scale.textContent=l.scale.toFixed(3);
  controls.rot.value=l.rotation;vals.rot.textContent=l.rotation.toFixed(1)+'°';
  controls.skewx.value=l.skewX;vals.skewx.textContent=l.skewX.toFixed(3);
  controls.skewy.value=l.skewY;vals.skewy.textContent=l.skewY.toFixed(3);
  controls.feather.value=l.feather;vals.feather.textContent=l.feather;
  controls.opacity.value=l.opacity;vals.opacity.textContent=l.opacity.toFixed(2);
}

Object.entries(controls).forEach(([key,el])=>{
  el.addEventListener('input',()=>{
    const l=selectedLayer();if(!l)return;
    const v=parseFloat(el.value);
    if(key==='x')l.x=v;else if(key==='y')l.y=v;else if(key==='scale')l.scale=v;else if(key==='rot')l.rotation=v;else if(key==='skewx')l.skewX=v;else if(key==='skewy')l.skewY=v;else if(key==='feather')l.feather=v;else if(key==='opacity')l.opacity=v;
    vals[key].textContent=key==='scale'?v.toFixed(3):key==='rot'?v.toFixed(1)+'°':key==='skewx'||key==='skewy'?v.toFixed(3):key==='opacity'?v.toFixed(2):Math.round(v);
    render();
  });
});

$('btn-reset').addEventListener('click',()=>{const l=selectedLayer();if(!l)return;l.x=40;l.y=40;l.scale=1;l.rotation=0;l.skewX=0;l.skewY=0;l.feather=60;l.opacity=1;refreshControls();render();});
$('btn-delete').addEventListener('click',()=>{const l=selectedLayer();if(!l)return;if(!confirm(`Delete "${l.name}"?`))return;state.layers=state.layers.filter(x=>x.id!==l.id);state.selectedId=state.layers.length?state.layers[0].id:null;renderLayerList();refreshControls();render();});

document.querySelectorAll('.tool').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('.tool').forEach(b=>b.classList.remove('active'));btn.classList.add('active');state.tool=btn.dataset.tool;wrap.classList.remove('tool-move','tool-mask','tool-erase','tool-crop');wrap.classList.add('tool-'+state.tool);state.cropRect=null;drawOverlay();});});
wrap.classList.add('tool-move');
$('ctrl-brush').addEventListener('input',(e)=>{state.brushSize=parseInt(e.target.value,10);$('val-brush').textContent=state.brushSize;});

function resizeCanvases(){const cw=state.canvasW,ch=state.canvasH;[canvasBG,canvasMain,canvasOverlay].forEach(c=>{c.width=cw;c.height=ch;});applyViewTransform();drawBGGrid();}
function applyViewTransform(){const t=`translate(${state.viewX}px, ${state.viewY}px) scale(${state.viewZoom})`;canvasBG.style.transform=t;canvasMain.style.transform=t;canvasOverlay.style.transform=t;$('zoom-label').textContent=Math.round(state.viewZoom*100)+'%';}
function drawBGGrid(){ctxBG.fillStyle=state.bg;ctxBG.fillRect(0,0,canvasBG.width,canvasBG.height);}
function fitView(){const r=wrap.getBoundingClientRect();const sx=(r.width-80)/state.canvasW,sy=(r.height-80)/state.canvasH;state.viewZoom=Math.min(sx,sy);state.viewX=(r.width-state.canvasW*state.viewZoom)/2;state.viewY=(r.height-state.canvasH*state.viewZoom)/2;applyViewTransform();}
$('btn-fitview').addEventListener('click',fitView);
$('btn-zoom-fit').addEventListener('click',fitView);
$('btn-zoom-100').addEventListener('click',()=>{state.viewZoom=1;applyViewTransform();});
$('btn-zoom-in').addEventListener('click',()=>{state.viewZoom*=1.25;applyViewTransform();});
$('btn-zoom-out').addEventListener('click',()=>{state.viewZoom/=1.25;applyViewTransform();});

wrap.addEventListener('wheel',(e)=>{e.preventDefault();const r=wrap.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;const cx=(mx-state.viewX)/state.viewZoom,cy=(my-state.viewY)/state.viewZoom;const f=e.deltaY<0?1.15:1/1.15;state.viewZoom=clamp(state.viewZoom*f,0.02,8);state.viewX=mx-cx*state.viewZoom;state.viewY=my-cy*state.viewZoom;applyViewTransform();},{passive:false});

let isPanning=false,panStart=null;
wrap.addEventListener('mousedown',(e)=>{if(e.button===1||e.shiftKey){e.preventDefault();isPanning=true;panStart={x:e.clientX-state.viewX,y:e.clientY-state.viewY};}});
window.addEventListener('mousemove',(e)=>{if(isPanning){state.viewX=e.clientX-panStart.x;state.viewY=e.clientY-panStart.y;applyViewTransform();}});
window.addEventListener('mouseup',()=>{isPanning=false;});

$('canvas-w').addEventListener('change',(e)=>{state.canvasW=clamp(parseInt(e.target.value,10)||6000,500,20000);e.target.value=state.canvasW;resizeCanvases();render();});
$('canvas-h').addEventListener('change',(e)=>{state.canvasH=clamp(parseInt(e.target.value,10)||1800,500,10000);e.target.value=state.canvasH;resizeCanvases();render();});
$('canvas-bg').addEventListener('input',(e)=>{state.bg=e.target.value;drawBGGrid();});

const tempCanvas=document.createElement('canvas'),tempCtx=tempCanvas.getContext('2d');

function buildLayerCanvas(layer){
  const w=layer.img.width,h=layer.img.height;
  tempCanvas.width=w;tempCanvas.height=h;
  tempCtx.clearRect(0,0,w,h);tempCtx.drawImage(layer.img,0,0);
  if(layer.feather>0){
    const f=Math.min(layer.feather,Math.floor(Math.min(w,h)/2-1));
    const cm=document.createElement('canvas');cm.width=w;cm.height=h;
    const cmx=cm.getContext('2d');cmx.fillStyle='white';cmx.fillRect(0,0,w,h);
    cmx.globalCompositeOperation='destination-out';
    let g=cmx.createLinearGradient(0,0,0,f);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');cmx.fillStyle=g;cmx.fillRect(0,0,w,f);
    g=cmx.createLinearGradient(0,h-f,0,h);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,1)');cmx.fillStyle=g;cmx.fillRect(0,h-f,w,f);
    g=cmx.createLinearGradient(0,0,f,0);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');cmx.fillStyle=g;cmx.fillRect(0,0,f,h);
    g=cmx.createLinearGradient(w-f,0,w,0);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,1)');cmx.fillStyle=g;cmx.fillRect(w-f,0,f,h);
    cmx.globalCompositeOperation='source-over';
    tempCtx.globalCompositeOperation='destination-in';tempCtx.drawImage(cm,0,0);tempCtx.globalCompositeOperation='source-over';
  }
  if(layer.mask){tempCtx.globalCompositeOperation='destination-in';tempCtx.drawImage(layer.mask,0,0);tempCtx.globalCompositeOperation='source-over';}
  return tempCanvas;
}

function applyLayerTransform(ctx,layer){
  const cx=(layer.img.width*layer.scale)/2,cy=(layer.img.height*layer.scale)/2;
  ctx.translate(layer.x+cx,layer.y+cy);
  ctx.rotate(layer.rotation*Math.PI/180);
  ctx.transform(1,layer.skewY,layer.skewX,1,0,0);
  ctx.scale(layer.scale,layer.scale);
  ctx.translate(-layer.img.width/2,-layer.img.height/2);
}

function render(){
  ctxMain.clearRect(0,0,canvasMain.width,canvasMain.height);
  for(const layer of state.layers){
    if(!layer.visible)continue;
    const lc=buildLayerCanvas(layer);
    const snap=document.createElement('canvas');snap.width=lc.width;snap.height=lc.height;snap.getContext('2d').drawImage(lc,0,0);
    ctxMain.save();ctxMain.globalAlpha=layer.opacity;applyLayerTransform(ctxMain,layer);ctxMain.drawImage(snap,0,0);ctxMain.restore();
  }
  drawOverlay();updateCanvasInfo();
}

function updateCanvasInfo(){
  const v=state.layers.filter(l=>l.visible).length;
  if(state.layers.length===0){canvasInfo.textContent='No layers yet — drop some photos to start.';}
  else{const l=selectedLayer();const s=l?` · sel: ${l.name}`:'';canvasInfo.textContent=`${state.canvasW}×${state.canvasH} · ${v}/${state.layers.length} layers visible${s}`;}
}

function drawOverlay(){
  ctxOverlay.clearRect(0,0,canvasOverlay.width,canvasOverlay.height);
  const l=selectedLayer();
  if(l){ctxOverlay.save();applyLayerTransform(ctxOverlay,l);ctxOverlay.strokeStyle='#e7eb46';ctxOverlay.lineWidth=3/state.viewZoom;ctxOverlay.setLineDash([12/state.viewZoom,6/state.viewZoom]);ctxOverlay.strokeRect(0,0,l.img.width,l.img.height);ctxOverlay.restore();}
  if(state.cropRect){const{x1,y1,x2,y2}=state.cropRect;ctxOverlay.save();ctxOverlay.strokeStyle='#ffd84d';ctxOverlay.lineWidth=3/state.viewZoom;ctxOverlay.setLineDash([10/state.viewZoom,5/state.viewZoom]);ctxOverlay.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctxOverlay.fillStyle='rgba(255,216,77,0.1)';ctxOverlay.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctxOverlay.restore();}
}

function clientToCanvas(e){const r=wrap.getBoundingClientRect();return{x:(e.clientX-r.left-state.viewX)/state.viewZoom,y:(e.clientY-r.top-state.viewY)/state.viewZoom};}

function canvasToLayer(pt,layer){
  const cx=(layer.img.width*layer.scale)/2,cy=(layer.img.height*layer.scale)/2;
  let lx=pt.x-layer.x-cx,ly=pt.y-layer.y-cy;
  const rad=-layer.rotation*Math.PI/180;
  const cR=Math.cos(rad),sR=Math.sin(rad);
  let rx=lx*cR-ly*sR,ry=lx*sR+ly*cR;
  const det=1-layer.skewX*layer.skewY;
  let sx=(rx-layer.skewX*ry)/det,sy=(ry-layer.skewY*rx)/det;
  return{x:sx/layer.scale+layer.img.width/2,y:sy/layer.scale+layer.img.height/2};
}

canvasMain.addEventListener('mousedown',(e)=>{
  if(e.button!==0||e.shiftKey)return;
  const pt=clientToCanvas(e);
  if(state.tool==='move'){
    for(let i=state.layers.length-1;i>=0;i--){
      const l=state.layers[i];if(!l.visible)continue;
      const lp=canvasToLayer(pt,l);
      if(lp.x>=0&&lp.x<l.img.width&&lp.y>=0&&lp.y<l.img.height){
        setSelected(l.id);state.isDragging=true;state.dragStart={mouse:pt,lx:l.x,ly:l.y};wrap.classList.add('dragging');return;
      }
    }
    setSelected(null);
  }else if(state.tool==='mask'||state.tool==='erase'){
    const l=selectedLayer();if(!l){toast_show('Select a layer first');return;}
    ensureMask(l);state.isDragging=true;paintMask(l,pt,state.tool==='erase');
  }else if(state.tool==='crop'){
    state.isDragging=true;state.cropStart=pt;state.cropRect={x1:pt.x,y1:pt.y,x2:pt.x,y2:pt.y};drawOverlay();
  }
});

window.addEventListener('mousemove',(e)=>{
  if(!state.isDragging)return;
  const pt=clientToCanvas(e);
  if(state.tool==='move'){const l=selectedLayer();if(!l||!state.dragStart)return;l.x=state.dragStart.lx+(pt.x-state.dragStart.mouse.x);l.y=state.dragStart.ly+(pt.y-state.dragStart.mouse.y);refreshControls();render();}
  else if(state.tool==='mask'||state.tool==='erase'){const l=selectedLayer();if(!l)return;paintMask(l,pt,state.tool==='erase');}
  else if(state.tool==='crop'){if(!state.cropRect)return;state.cropRect.x2=pt.x;state.cropRect.y2=pt.y;drawOverlay();}
});

window.addEventListener('mouseup',()=>{
  if(state.tool==='crop'&&state.isDragging&&state.cropRect){
    const{x1,y1,x2,y2}=state.cropRect;
    const x=Math.min(x1,x2),y=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
    if(w>20&&h>20){
      if(confirm(`Crop canvas to ${Math.round(w)}×${Math.round(h)}?`)){
        state.layers.forEach(l=>{l.x-=x;l.y-=y;});
        state.canvasW=Math.round(w);state.canvasH=Math.round(h);
        $('canvas-w').value=state.canvasW;$('canvas-h').value=state.canvasH;
        resizeCanvases();fitView();refreshControls();
      }
    }
    state.cropRect=null;
  }
  state.isDragging=false;state.dragStart=null;wrap.classList.remove('dragging');drawOverlay();
});

function ensureMask(layer){if(layer.mask)return;const m=document.createElement('canvas');m.width=layer.img.width;m.height=layer.img.height;const mx=m.getContext('2d');mx.fillStyle='white';mx.fillRect(0,0,m.width,m.height);layer.mask=m;}
function paintMask(layer,pt,erase){
  const lp=canvasToLayer(pt,layer);
  if(lp.x<-50||lp.y<-50||lp.x>layer.img.width+50||lp.y>layer.img.height+50)return;
  const mx=layer.mask.getContext('2d');
  mx.save();mx.globalCompositeOperation=erase?'destination-out':'source-over';
  const r=state.brushSize/layer.scale;
  const g=mx.createRadialGradient(lp.x,lp.y,0,lp.x,lp.y,r);
  g.addColorStop(0,'rgba(255,255,255,0.5)');g.addColorStop(1,'rgba(255,255,255,0)');
  mx.fillStyle=g;mx.beginPath();mx.arc(lp.x,lp.y,r,0,Math.PI*2);mx.fill();mx.restore();
  render();
}

function setOpenCVReady(){state.opencvReady=true;opencvStatus.textContent='OpenCV.js ready';opencvStatus.className='status ok';refreshControls();}
window.addEventListener('opencv-loaded',()=>{const c=setInterval(()=>{if(window.cv&&window.cv.Mat){clearInterval(c);setOpenCVReady();}},100);setTimeout(()=>clearInterval(c),30000);});
const cvPoll=setInterval(()=>{if(window.cv&&window.cv.Mat){clearInterval(cvPoll);if(!state.opencvReady)setOpenCVReady();}},200);
setTimeout(()=>clearInterval(cvPoll),30000);

function imageToMat(img,maxDim=1200){const r=Math.min(1,maxDim/Math.max(img.width,img.height));const w=Math.round(img.width*r),h=Math.round(img.height*r);const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);return{mat:cv.imread(c),scale:r};}

async function autoAlignPair(refLayer,movingLayer){
  if(!state.opencvReady){toast_show('OpenCV not ready','err');return false;}
  opencvStatus.textContent=`Aligning "${movingLayer.name}" → "${refLayer.name}"…`;
  opencvStatus.className='status';
  await new Promise(r=>setTimeout(r,30));
  let refMat,movMat,refGray,movGray,kpRef,kpMov,descRef,descMov,matches,orb,bf;
  let result=false;
  try{
    const rd=imageToMat(refLayer.img),md=imageToMat(movingLayer.img);
    refMat=rd.mat;movMat=md.mat;
    const refScale=rd.scale,movScale=md.scale;
    refGray=new cv.Mat();cv.cvtColor(refMat,refGray,cv.COLOR_RGBA2GRAY);
    movGray=new cv.Mat();cv.cvtColor(movMat,movGray,cv.COLOR_RGBA2GRAY);
    orb=new cv.ORB(2000);
    kpRef=new cv.KeyPointVector();kpMov=new cv.KeyPointVector();
    descRef=new cv.Mat();descMov=new cv.Mat();
    orb.detectAndCompute(refGray,new cv.Mat(),kpRef,descRef);
    orb.detectAndCompute(movGray,new cv.Mat(),kpMov,descMov);
    if(descRef.rows<10||descMov.rows<10){toast_show('Not enough features','err');return false;}
    bf=new cv.BFMatcher(cv.NORM_HAMMING,true);
    matches=new cv.DMatchVector();
    bf.match(descMov,descRef,matches);
    const arr=[];for(let i=0;i<matches.size();i++)arr.push(matches.get(i));
    arr.sort((a,b)=>a.distance-b.distance);
    const keep=arr.slice(0,Math.min(60,arr.length));
    if(keep.length<6){toast_show('Too few good matches','err');return false;}
    const srcPts=new cv.Mat(keep.length,1,cv.CV_32FC2);
    const dstPts=new cv.Mat(keep.length,1,cv.CV_32FC2);
    const sD=srcPts.data32F,dD=dstPts.data32F;
    for(let i=0;i<keep.length;i++){
      const m=keep[i];const kM=kpMov.get(m.queryIdx),kR=kpRef.get(m.trainIdx);
      sD[i*2]=kM.pt.x/movScale;sD[i*2+1]=kM.pt.y/movScale;
      dD[i*2]=kR.pt.x/refScale;dD[i*2+1]=kR.pt.y/refScale;
    }
    const mask=new cv.Mat();
    const M=cv.estimateAffinePartial2D(srcPts,dstPts,mask,cv.RANSAC,3.0,2000,0.99,10);
    srcPts.delete();dstPts.delete();mask.delete();
    if(M.empty()){toast_show('Could not estimate transform','err');return false;}
    const a=M.data64F[0],b=M.data64F[1],tx=M.data64F[2];
    const c=M.data64F[3],d=M.data64F[4],ty=M.data64F[5];
    M.delete();
    const scale=Math.sqrt(a*a+b*b);
    const rotDeg=Math.atan2(c,d)*180/Math.PI;
    if(scale<0.5||scale>2.0||Math.abs(rotDeg)>20){toast_show(`Rejected degenerate transform (scale ${scale.toFixed(2)}, rot ${rotDeg.toFixed(0)}°) — align manually`,'err');opencvStatus.textContent='Degenerate match rejected';opencvStatus.className='status err';return false;}
    const refRotRad=refLayer.rotation*Math.PI/180;
    const cRR=Math.cos(refRotRad),sRR=Math.sin(refRotRad);
    const newScale=refLayer.scale*scale;
    const newRot=refLayer.rotation+rotDeg;
    const rCx=(refLayer.img.width*refLayer.scale)/2,rCy=(refLayer.img.height*refLayer.scale)/2;
    const refOX=refLayer.x+rCx-(refLayer.img.width/2)*refLayer.scale*cRR+(refLayer.img.height/2)*refLayer.scale*sRR;
    const refOY=refLayer.y+rCy-(refLayer.img.width/2)*refLayer.scale*sRR-(refLayer.img.height/2)*refLayer.scale*cRR;
    const dOX=refOX+(tx*cRR-ty*sRR)*refLayer.scale;
    const dOY=refOY+(tx*sRR+ty*cRR)*refLayer.scale;
    const nRR=newRot*Math.PI/180;
    const cNR=Math.cos(nRR),sNR=Math.sin(nRR);
    const mCx=(movingLayer.img.width*newScale)/2,mCy=(movingLayer.img.height*newScale)/2;
    movingLayer.x=dOX-mCx+(movingLayer.img.width/2)*newScale*cNR-(movingLayer.img.height/2)*newScale*sNR;
    movingLayer.y=dOY-mCy+(movingLayer.img.width/2)*newScale*sNR+(movingLayer.img.height/2)*newScale*cNR;
    movingLayer.scale=newScale;movingLayer.rotation=newRot;movingLayer.skewX=0;movingLayer.skewY=0;
    opencvStatus.textContent=`Aligned with ${keep.length} matches`;
    opencvStatus.className='status ok';
    result=true;
  }catch(err){console.error(err);toast_show('Auto-align failed: '+err.message,'err');opencvStatus.textContent='Align failed';opencvStatus.className='status err';}
  finally{
    [refMat,movMat,refGray,movGray,descRef,descMov].forEach(m=>{try{m&&m.delete();}catch(e){}});
    [kpRef,kpMov,matches].forEach(v=>{try{v&&v.delete();}catch(e){}});
    try{orb&&orb.delete();}catch(e){}try{bf&&bf.delete();}catch(e){}
  }
  return result;
}

$('btn-autoalign').addEventListener('click',async()=>{const l=selectedLayer();if(!l)return;const i=state.layers.indexOf(l);if(i===0){toast_show('First layer has nothing to align to');return;}await autoAlignPair(state.layers[i-1],l);refreshControls();render();});
$('btn-autoalign-all').addEventListener('click',async()=>{
  if(state.layers.length<2)return;
  let ok=0,fail=0;
  const failedNames=[];
  for(let i=1;i<state.layers.length;i++){
    const r=await autoAlignPair(state.layers[i-1],state.layers[i]);
    if(r)ok++;else{fail++;failedNames.push(state.layers[i].name);}
    render();
    await new Promise(r=>setTimeout(r,50));
  }
  refreshControls();render();
  if(fail===0){
    toast_show(`Aligned all ${ok} pair${ok>1?'s':''}`,'ok');
    opencvStatus.textContent=`Aligned ${ok}/${ok} pairs`;opencvStatus.className='status ok';
  }else if(ok===0){
    toast_show(`All ${fail} pair${fail>1?'s':''} rejected — align manually`,'err');
    opencvStatus.textContent=`0/${fail} pairs aligned — manual mode`;opencvStatus.className='status err';
  }else{
    toast_show(`Aligned ${ok}/${ok+fail} — ${fail} rejected, fix manually`,'err');
    opencvStatus.textContent=`${ok}/${ok+fail} pairs aligned — ${failedNames.length} need manual fix`;opencvStatus.className='status err';
  }
});

$('btn-autolevel').addEventListener('click',()=>{
  const l=selectedLayer();if(!l||!state.opencvReady)return;
  let mat,gray,edges,lines;
  try{
    const{mat:m}=imageToMat(l.img,800);mat=m;
    gray=new cv.Mat();cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);
    edges=new cv.Mat();cv.Canny(gray,edges,60,180);
    lines=new cv.Mat();cv.HoughLines(edges,lines,1,Math.PI/360,120);
    if(lines.rows===0){toast_show('No strong lines found','err');return;}
    const ang=[];
    for(let i=0;i<lines.rows;i++){const t=lines.data32F[i*2+1];const d=(t-Math.PI/2)*180/Math.PI;if(Math.abs(d)<25)ang.push(d);}
    if(ang.length===0){toast_show('No near-horizontal lines','err');return;}
    ang.sort((a,b)=>a-b);
    const med=ang[Math.floor(ang.length/2)];
    l.rotation+=-med;refreshControls();render();
    toast_show(`Auto-leveled (${ang.length} lines, ${med.toFixed(2)}°)`,'ok');
  }catch(err){console.error(err);toast_show('Auto-level failed','err');}
  finally{[mat,gray,edges,lines].forEach(m=>{try{m&&m.delete();}catch(e){}});}
});

$('btn-export').addEventListener('click',()=>{
  const out=document.createElement('canvas');out.width=state.canvasW;out.height=state.canvasH;
  const ox=out.getContext('2d');ox.fillStyle=state.bg;ox.fillRect(0,0,out.width,out.height);
  for(const layer of state.layers){
    if(!layer.visible)continue;
    const lc=buildLayerCanvas(layer);
    const snap=document.createElement('canvas');snap.width=lc.width;snap.height=lc.height;snap.getContext('2d').drawImage(lc,0,0);
    ox.save();ox.globalAlpha=layer.opacity;applyLayerTransform(ox,layer);ox.drawImage(snap,0,0);ox.restore();
  }
  out.toBlob((blob)=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`panostitch-${Date.now()}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast_show('Exported PNG','ok');},'image/png');
});

function layerToDataURL(layer){const c=document.createElement('canvas');c.width=layer.img.width;c.height=layer.img.height;c.getContext('2d').drawImage(layer.img,0,0);return c.toDataURL('image/png');}

$('btn-save').addEventListener('click',()=>{
  const data={version:1,canvasW:state.canvasW,canvasH:state.canvasH,bg:state.bg,
    layers:state.layers.map(l=>({name:l.name,x:l.x,y:l.y,scale:l.scale,rotation:l.rotation,skewX:l.skewX,skewY:l.skewY,feather:l.feather,opacity:l.opacity,visible:l.visible,imgDataURL:layerToDataURL(l),maskDataURL:l.mask?l.mask.toDataURL():null}))};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`panostitch-project-${Date.now()}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);toast_show('Project saved','ok');
});

$('btn-load').addEventListener('click',()=>$('file-load').click());
$('file-load').addEventListener('change',async(e)=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const text=await file.text();const data=JSON.parse(text);
    if(!data.layers)throw new Error('Bad project file');
    state.canvasW=data.canvasW||6000;state.canvasH=data.canvasH||1800;state.bg=data.bg||'#0a0a0b';
    $('canvas-w').value=state.canvasW;$('canvas-h').value=state.canvasH;$('canvas-bg').value=state.bg;
    state.layers=[];
    for(const ld of data.layers){
      const img=new Image();
      await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=ld.imgDataURL;});
      const layer=makeLayer(img,ld.name);
      Object.assign(layer,{x:ld.x,y:ld.y,scale:ld.scale,rotation:ld.rotation,skewX:ld.skewX||0,skewY:ld.skewY||0,feather:ld.feather,opacity:ld.opacity,visible:ld.visible!==false});
      if(ld.maskDataURL){const m=new Image();await new Promise((r,j)=>{m.onload=r;m.onerror=j;m.src=ld.maskDataURL;});const mc=document.createElement('canvas');mc.width=m.width;mc.height=m.height;mc.getContext('2d').drawImage(m,0,0);layer.mask=mc;}
      state.layers.push(layer);
    }
    state.selectedId=state.layers[0]?.id||null;
    resizeCanvases();renderLayerList();refreshControls();fitView();render();
    toast_show('Project loaded','ok');
  }catch(err){console.error(err);toast_show('Load failed: '+err.message,'err');}
});

$('btn-new').addEventListener('click',()=>{if(state.layers.length&&!confirm('Clear current project?'))return;state.layers=[];state.selectedId=null;state.nextId=1;renderLayerList();refreshControls();render();});

window.addEventListener('keydown',(e)=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  const l=selectedLayer();
  if(e.key==='Delete'||e.key==='Backspace'){if(l){$('btn-delete').click();e.preventDefault();}}
  else if(e.key==='m'||e.key==='M')document.querySelector('[data-tool="move"]').click();
  else if(e.key==='b'||e.key==='B')document.querySelector('[data-tool="mask"]').click();
  else if(e.key==='e'||e.key==='E')document.querySelector('[data-tool="erase"]').click();
  else if(e.key==='c'||e.key==='C')document.querySelector('[data-tool="crop"]').click();
  else if(e.key==='f'||e.key==='F')fitView();
  else if(e.key==='ArrowLeft'&&l){l.x-=e.shiftKey?20:1;refreshControls();render();}
  else if(e.key==='ArrowRight'&&l){l.x+=e.shiftKey?20:1;refreshControls();render();}
  else if(e.key==='ArrowUp'&&l){l.y-=e.shiftKey?20:1;refreshControls();render();}
  else if(e.key==='ArrowDown'&&l){l.y+=e.shiftKey?20:1;refreshControls();render();}
});

window.addEventListener('resize',applyViewTransform);

// --- Aspect ratio presets ---
function setActiveAspect(ar){document.querySelectorAll('.aspect').forEach(b=>{b.classList.toggle('active',b.dataset.ar===ar);});}
function applyAspect(ar){
  if(ar==='fit'){
    // Snap canvas tightly to current layer bounding box (with small padding)
    if(state.layers.length===0){toast_show('No layers to fit','err');return;}
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const l of state.layers){
      if(!l.visible)continue;
      const w=l.img.width*l.scale,h=l.img.height*l.scale;
      const cx=l.x+w/2,cy=l.y+h/2;
      const rad=l.rotation*Math.PI/180;
      const corners=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
      for(const[dx,dy]of corners){
        const px=cx+dx*Math.cos(rad)-dy*Math.sin(rad);
        const py=cy+dx*Math.sin(rad)+dy*Math.cos(rad);
        if(px<minX)minX=px;if(py<minY)minY=py;if(px>maxX)maxX=px;if(py>maxY)maxY=py;
      }
    }
    if(!isFinite(minX)){toast_show('No visible layers','err');return;}
    const pad=20;
    const ox=Math.floor(minX-pad),oy=Math.floor(minY-pad);
    state.layers.forEach(l=>{l.x-=ox;l.y-=oy;});
    state.canvasW=Math.ceil(maxX-minX+pad*2);
    state.canvasH=Math.ceil(maxY-minY+pad*2);
    $('canvas-w').value=state.canvasW;$('canvas-h').value=state.canvasH;
    resizeCanvases();fitView();refreshControls();render();
    setActiveAspect('fit');
    toast_show(`Fit canvas: ${state.canvasW}×${state.canvasH}`,'ok');
    return;
  }
  const[wPart,hPart]=ar.split(':').map(Number);
  if(!wPart||!hPart)return;
  const ratio=wPart/hPart;
  // Preserve total area (keeps roughly the same pixel budget)
  const area=state.canvasW*state.canvasH;
  let newW=Math.round(Math.sqrt(area*ratio));
  let newH=Math.round(newW/ratio);
  // Clamp to slider bounds
  newW=clamp(newW,500,20000);newH=clamp(newH,500,10000);
  // If clamp distorted ratio, re-derive the other axis
  if(Math.abs((newW/newH)-ratio)>0.01){newH=Math.round(newW/ratio);}
  state.canvasW=newW;state.canvasH=newH;
  $('canvas-w').value=newW;$('canvas-h').value=newH;
  resizeCanvases();fitView();render();
  setActiveAspect(ar);
  toast_show(`Canvas: ${ar} (${newW}×${newH})`,'ok');
}
document.querySelectorAll('.aspect').forEach(btn=>{btn.addEventListener('click',()=>applyAspect(btn.dataset.ar));});
// Initial highlight for current default ratio (6000×1800 = 10:3, doesn't match presets; leave none active)

resizeCanvases();fitView();render();
})();



