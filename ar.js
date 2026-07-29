const PRESETS={
  "????":{vari:.055,gli:.095,exg:.135,pct:18,limits:[16,28,44,64]},
  "?????":{vari:.010,gli:.045,exg:.070,pct:14,limits:[24,38,55,72]},
  "???????????":{vari:-.005,gli:.035,exg:.055,pct:12,limits:[22,36,54,70]}
};
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const video=$("camera"),overlay=$("overlay"),work=$("analysisCanvas");
const octx=overlay.getContext("2d"),wctx=work.getContext("2d",{willReadFrequently:true});
let stream=null,running=false,paused=false,timer=null,lastResult=null,temporalClasses=null;

function percentile(values,p){if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p/100)]}
function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0}
function sd(a){const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)))}
function rgbToHsv(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=60*(((g-b)/d)%6);else if(mx===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4)}if(h<0)h+=360;return[h/2,mx?d/mx*255:0,mx]}
function resizeOverlay(){const r=video.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);overlay.width=Math.round(r.width*dpr);overlay.height=Math.round(r.height*dpr);octx.setTransform(dpr,0,0,dpr,0,0)}
function setMessage(t){$("message").textContent=t}

async function startCamera(){
  try{
    if(stream)stopCamera();
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=stream;await video.play();resizeOverlay();running=true;paused=false;temporalClasses=null;
    $("startBtn").textContent="?????";$("pauseBtn").disabled=false;$("saveBtn").disabled=false;
    setMessage("?0.5?????????????????????????????");schedule();
  }catch(e){setMessage("????????????Chrome???????HTTPS????????????");}
}
function stopCamera(){
  running=false;paused=false;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
  octx.clearRect(0,0,overlay.width,overlay.height);temporalClasses=null;lastResult=null;
  $("startBtn").textContent="?????";$("pauseBtn").textContent="????";$("pauseBtn").disabled=true;$("saveBtn").disabled=true;
  setMessage("???????????");
}
function schedule(){clearTimeout(timer);if(running&&!paused)timer=setTimeout(analyzeFrame,500)}

function spatialSmooth(source,valid,w,h){
  const out=new Uint8Array(source.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!valid[i])continue;
    const counts=[0,0,0,0];let total=0;
    for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){
      const j=yy*w+xx;if(valid[j]){counts[source[j]]++;total++;}
    }
    let best=source[i],bestCount=counts[best];
    for(let c=0;c<4;c++)if(counts[c]>bestCount){best=c;bestCount=counts[c]}
    // ?????????????????????????
    out[i]=(source[i]===3&&counts[3]>=2)?3:(bestCount>=Math.ceil(total*.45)?best:source[i]);
  }
  return out;
}

function temporalSmooth(current,valid){
  if(!temporalClasses||temporalClasses.length!==current.length){temporalClasses=new Uint8Array(current);return new Uint8Array(current)}
  const out=new Uint8Array(current.length);
  for(let i=0;i<current.length;i++){
    if(!valid[i]){out[i]=0;continue}
    const prev=temporalClasses[i],now=current[i];
    if(now>prev)out[i]=now;                       // ????????
    else if(now===prev)out[i]=now;
    else out[i]=(Math.random()<.32)?now:prev;     // ??????????
  }
  temporalClasses=out;return new Uint8Array(out);
}

function analyzeFrame(){
  if(!running||paused||video.readyState<2){schedule();return}
  try{
    const targetW=240,targetH=180;work.width=targetW;work.height=targetH;wctx.drawImage(video,0,0,targetW,targetH);
    const image=wctx.getImageData(0,0,targetW,targetH),d=image.data,n=targetW*targetH;
    const species=$("species").value,pre=PRESETS[species],light=$("lightMode").value;
    const vari=new Float32Array(n),gli=new Float32Array(n),exg=new Float32Array(n),valid=new Uint8Array(n),brown=new Uint8Array(n);
    const vv=[],gg=[],ee=[];let brownCount=0;
    for(let i=0,j=0;i<n;i++,j+=4){
      let r=d[j],g=d[j+1],b=d[j+2];
      if(light==="shade"){r=clamp(r*1.10,0,255);g=clamp(g*1.10,0,255);b=clamp(b*1.08,0,255)}
      if(light==="sun"){r=clamp((r-128)*.88+128,0,255);g=clamp((g-128)*.88+128,0,255);b=clamp((b-128)*.88+128,0,255)}
      const total=r+g+b||1,[h,s,v]=rgbToHsv(r,g,b);
      vari[i]=clamp((g-r)/((g+r-b)||1e-6),-1,1);gli[i]=clamp((2*g-r-b)/((2*g+r+b)||1e-6),-1,1);exg[i]=clamp(2*g/total-r/total-b/total,-1,1);
      const ok=g>=r-22&&g>=b-24&&h>=12&&h<=112&&s>=6&&v>=22&&v<252;
      valid[i]=ok?1:0;brown[i]=(r>g*.92&&g>b*1.03&&r>b*1.12&&s>18&&v>35)?1:0;
      if(ok){vv.push(vari[i]);gg.push(gli[i]);ee.push(exg[i]);if(brown[i])brownCount++}
    }
    if(vv.length<700){setMessage("?????????????????????????????");schedule();return}

    const bounds={v:[percentile(vv,5),percentile(vv,95)],g:[percentile(gg,5),percentile(gg,95)],e:[percentile(ee,5),percentile(ee,95)]};
    const scores=[],votes=new Uint8Array(n),score=new Float32Array(n);
    for(let i=0;i<n;i++)if(valid[i]){
      const nv=clamp((vari[i]-bounds.v[0])/((bounds.v[1]-bounds.v[0])||1),0,1),ng=clamp((gli[i]-bounds.g[0])/((bounds.g[1]-bounds.g[0])||1),0,1),ne=clamp((exg[i]-bounds.e[0])/((bounds.e[1]-bounds.e[0])||1),0,1);
      score[i]=.30*nv+.35*ng+.35*ne;votes[i]=(vari[i]<pre.vari)+(gli[i]<pre.gli)+(exg[i]<pre.exg);scores.push(score[i]);
    }

    const th=percentile(scores,pre.pct),rawClasses=new Uint8Array(n);let lowCount=0;
    for(let i=0;i<n;i++)if(valid[i]){
      const low=species==="????"?(votes[i]>=2&&score[i]<=th):(score[i]<=th&&(votes[i]>=1||score[i]<th*.85));
      let cls=0;
      if(low){cls=2;lowCount++;if(score[i]<th*.62||votes[i]>=3)cls=3}
      else if(score[i]<Math.min(.52,th*1.55))cls=1;
      rawClasses[i]=cls;
    }

    const classes=temporalSmooth(spatialSmooth(rawClasses,valid,targetW,targetH),valid);
    const variMean=mean(vv),gliMean=mean(gg),uniform=clamp(100*(1-mean([sd(vv),sd(gg),sd(ee)])/.20),0,100),lowRate=lowCount/vv.length*100,brownRate=brownCount/vv.length*100;
    let dryIndex;
    if(species==="????")dryIndex=.34*lowRate+.20*(100-uniform)+.34*clamp((.055-variMean)*820,0,100)+.18*clamp((.085-gliMean)*700,0,100)+.10*brownRate;
    else if(species==="?????")dryIndex=.22*lowRate+.30*(100-uniform)+.28*clamp((.025-variMean)*620,0,100)+.12*brownRate;
    else dryIndex=.20*lowRate+.24*(100-uniform)+.25*clamp((.045-variMean)*560,0,100)+.16*brownRate;
    dryIndex=clamp(dryIndex,0,100);const L=pre.limits;const grade=dryIndex<L[0]?"A":dryIndex<L[1]?"B":dryIndex<L[2]?"C":"D";
    const diseaseMismatch=(brownRate>5&&dryIndex<38&&variMean<pre.vari&&gliMean>pre.gli*.75)||(lowRate>18&&uniform>72&&dryIndex<45&&Math.abs(variMean-pre.vari)<.035);
    lastResult={image,classes,valid,w:targetW,h:targetH,grade,variMean,gliMean,dryIndex,lowRate,diseaseMismatch};render(lastResult);
    $("grade").textContent=grade;$("vari").textContent=variMean.toFixed(3);$("gli").textContent=gliMean.toFixed(3);$("dry").textContent=Math.round(dryIndex);$("low").textContent=lowRate.toFixed(1)+"%";
    $("diseaseHint").classList.toggle("hidden",!diseaseMismatch);
    setMessage(grade==="A"?"??????":grade==="B"?"??????????":grade==="C"?"????????????????":"??????????????????");
  }catch(e){setMessage("??????"+e.message)}
  schedule();
}

const DISPLAY_MODE_NAMES={original:"???",outline:"????",surface:"???",heatmap:"??????"};
let displayMode="heatmap",modeToastTimer=null;

function alphaForClass(cls,base){
  return [Math.max(.40,base-.12),Math.max(.42,base-.08),Math.max(.46,base-.04),base][cls];
}

function makeColorSurface(r,alphaScale=1){
  const surface=document.createElement("canvas");surface.width=r.w;surface.height=r.h;
  const c=surface.getContext("2d"),im=c.createImageData(r.w,r.h);
  const colors=[[33,164,83],[255,227,74],[255,138,28],[225,38,38]],base=clamp(Number($("opacity").value)/100,.40,.60);
  for(let i=0,j=0;i<r.classes.length;i++,j+=4){
    if(!r.valid[i])continue;
    const cls=r.classes[i],col=colors[cls],a=alphaForClass(cls,base)*alphaScale;
    im.data[j]=col[0];im.data[j+1]=col[1];im.data[j+2]=col[2];im.data[j+3]=Math.round(clamp(a,0,1)*255);
  }
  c.putImageData(im,0,0);
  return surface;
}

function makeOutlineMap(r){
  const map=document.createElement("canvas");map.width=r.w;map.height=r.h;
  const c=map.getContext("2d"),edge=document.createElement("canvas");edge.width=r.w;edge.height=r.h;
  const ectx=edge.getContext("2d"),im=ectx.createImageData(r.w,r.h),colors=[[33,164,83],[255,227,74],[255,138,28],[225,38,38]];
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const i=y*r.w+x;if(!r.valid[i])continue;
    const cls=r.classes[i];
    const boundary=x===0||y===0||x===r.w-1||y===r.h-1||
      !r.valid[i-1]||!r.valid[i+1]||!r.valid[i-r.w]||!r.valid[i+r.w]||
      r.classes[i-1]!==cls||r.classes[i+1]!==cls||r.classes[i-r.w]!==cls||r.classes[i+r.w]!==cls;
    if(!boundary)continue;
    const j=i*4,col=colors[cls];im.data[j]=col[0];im.data[j+1]=col[1];im.data[j+2]=col[2];im.data[j+3]=255;
  }
  ectx.putImageData(im,0,0);
  c.shadowColor="rgba(0,0,0,.9)";c.shadowBlur=2;c.drawImage(edge,0,0);
  c.shadowColor="transparent";c.drawImage(edge,0,0);
  return map;
}

function makeMap(r){
  const blank=document.createElement("canvas");blank.width=r.w;blank.height=r.h;
  if(displayMode==="original")return blank;
  if(displayMode==="outline")return makeOutlineMap(r);
  const surface=makeColorSurface(r);
  if(displayMode==="surface")return surface;
  const c=blank.getContext("2d");c.filter="blur(2.2px)";c.drawImage(surface,0,0);c.filter="none";
  return blank;
}

function showModeToast(name){
  const toast=$("modeToast");clearTimeout(modeToastTimer);
  toast.textContent=`${name}???????`;toast.classList.remove("hidden");
  modeToastTimer=setTimeout(()=>toast.classList.add("hidden"),2000);
}

function setDisplayMode(mode,notify=true){
  if(!DISPLAY_MODE_NAMES[mode])return;
  displayMode=mode;
  document.querySelectorAll(".mode-switcher button").forEach(button=>{
    const selected=button.dataset.mode===mode;
    button.classList.toggle("active",selected);button.setAttribute("aria-pressed",String(selected));
  });
  $("currentMode").textContent=`???${DISPLAY_MODE_NAMES[mode]}`;
  if(notify)showModeToast(DISPLAY_MODE_NAMES[mode]);
  if(lastResult)render(lastResult);
}

function render(r){
  resizeOverlay();const box=overlay.getBoundingClientRect(),cw=box.width,ch=box.height,scale=Math.max(cw/r.w,ch/r.h),dw=r.w*scale,dh=r.h*scale,ox=(cw-dw)/2,oy=(ch-dh)/2;
  const map=makeMap(r);octx.clearRect(0,0,cw,ch);octx.imageSmoothingEnabled=true;octx.drawImage(map,ox,oy,dw,dh);
}

function drawVideoCover(ctx,w,h){
  const vw=video.videoWidth||1280,vh=video.videoHeight||720,scale=Math.max(w/vw,h/vh),sw=w/scale,sh=h/scale,sx=(vw-sw)/2,sy=(vh-sh)/2;
  ctx.drawImage(video,sx,sy,sw,sh,0,0,w,h);
}

async function saveScreen(){
  if(!lastResult)return;
  const c=document.createElement("canvas"),w=Math.max(720,video.videoWidth||1280),h=Math.max(1280,video.videoHeight||720);c.width=w;c.height=h;const x=c.getContext("2d");
  drawVideoCover(x,w,h);x.drawImage(makeMap(lastResult),0,0,lastResult.w,lastResult.h,0,0,w,h);
  x.fillStyle="rgba(0,0,0,.68)";x.fillRect(0,0,w,86);x.fillStyle="white";x.font=`bold ${Math.max(24,Math.round(w*.025))}px sans-serif`;
  x.fillText(`Turf Vision Live  ?? ${lastResult.grade}  ??? ${Math.round(lastResult.dryIndex)}/100`,18,38);
  x.font=`${Math.max(18,Math.round(w*.017))}px sans-serif`;x.fillText(`??? ${lastResult.lowRate.toFixed(1)}%  VARI ${lastResult.variMean.toFixed(3)}  GLI ${lastResult.gliMean.toFixed(3)}`,18,70);
  const blob=await new Promise(resolve=>c.toBlob(resolve,"image/png"));if(!blob){setMessage("????????????????");return}
  const name=`Turf_Vision_Live_${new Date().toISOString().replace(/[:.]/g,"-")}.png`,file=new File([blob],name,{type:"image/png"});
  try{
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:"Turf Vision Live ????"});setMessage("???????????????????????");return}
  }catch(e){if(e.name==="AbortError")return}
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.download=name;link.href=url;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage("??????????????");
}

$("startBtn").onclick=()=>stream?stopCamera():startCamera();
$("pauseBtn").onclick=()=>{paused=!paused;$("pauseBtn").textContent=paused?"??":"????";setMessage(paused?"??????????????????????":"??????????");if(!paused)schedule()};
$("saveBtn").onclick=saveScreen;
$("opacity").oninput=e=>{$("opacityValue").textContent=e.target.value+"%";if(lastResult)render(lastResult)};
document.querySelectorAll(".mode-switcher button").forEach(button=>button.onclick=()=>setDisplayMode(button.dataset.mode));
setDisplayMode("heatmap",false);
$("species").onchange=()=>{temporalClasses=null};
$("lightMode").onchange=()=>{temporalClasses=null};
window.addEventListener("resize",()=>lastResult?render(lastResult):resizeOverlay());window.addEventListener("pagehide",stopCamera);
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

