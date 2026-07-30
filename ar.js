const PRESETS={
  "ベント芝":{vari:.055,gli:.095,exg:.135,pct:18,limits:[16,28,44,64]},
  "コウライ芝":{vari:.010,gli:.045,exg:.070,pct:14,limits:[24,38,55,72]},
  "ティフトン・バミューダ":{vari:-.005,gli:.035,exg:.055,pct:12,limits:[22,36,54,70]}
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
    $("startBtn").textContent="カメラ停止";$("pauseBtn").disabled=false;$("saveBtn").disabled=false;
    setMessage("約0.5秒ごとに解析中。赤・オレンジの場所を現地確認してください。");schedule();
  }catch(e){setMessage("カメラを開始できません。Chromeのカメラ許可とHTTPS接続を確認してください。");}
}
function stopCamera(){
  running=false;paused=false;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
  octx.clearRect(0,0,overlay.width,overlay.height);temporalClasses=null;lastResult=null;
  $("startBtn").textContent="カメラ開始";$("pauseBtn").textContent="一時停止";$("pauseBtn").disabled=true;$("saveBtn").disabled=true;
  setMessage("カメラを停止しました。");
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
    // 強い反応は消しすぎず、孤立点だけを周囲へなじませる
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
    if(now>prev)out[i]=now;                       // 危険側は即時表示
    else if(now===prev)out[i]=now;
    else out[i]=(Math.random()<.32)?now:prev;     // 改善側はゆっくり戻す
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
    if(vv.length<700){setMessage("芝として評価できる範囲が少ないです。芝面へ向けてください。");schedule();return}

    const bounds={v:[percentile(vv,5),percentile(vv,95)],g:[percentile(gg,5),percentile(gg,95)],e:[percentile(ee,5),percentile(ee,95)]};
    const scores=[],votes=new Uint8Array(n),score=new Float32Array(n);
    for(let i=0;i<n;i++)if(valid[i]){
      const nv=clamp((vari[i]-bounds.v[0])/((bounds.v[1]-bounds.v[0])||1),0,1),ng=clamp((gli[i]-bounds.g[0])/((bounds.g[1]-bounds.g[0])||1),0,1),ne=clamp((exg[i]-bounds.e[0])/((bounds.e[1]-bounds.e[0])||1),0,1);
      score[i]=.30*nv+.35*ng+.35*ne;votes[i]=(vari[i]<pre.vari)+(gli[i]<pre.gli)+(exg[i]<pre.exg);scores.push(score[i]);
    }

    const th=percentile(scores,pre.pct),rawClasses=new Uint8Array(n);let lowCount=0;
    for(let i=0;i<n;i++)if(valid[i]){
      const low=species==="ベント芝"?(votes[i]>=2&&score[i]<=th):(score[i]<=th&&(votes[i]>=1||score[i]<th*.85));
      let cls=0;
      if(low){cls=2;lowCount++;if(score[i]<th*.62||votes[i]>=3)cls=3}
      else if(score[i]<Math.min(.52,th*1.55))cls=1;
      rawClasses[i]=cls;
    }

    const classes=temporalSmooth(spatialSmooth(rawClasses,valid,targetW,targetH),valid);
    const variMean=mean(vv),gliMean=mean(gg),uniform=clamp(100*(1-mean([sd(vv),sd(gg),sd(ee)])/.20),0,100),lowRate=lowCount/vv.length*100,brownRate=brownCount/vv.length*100;
    let dryIndex;
    if(species==="ベント芝")dryIndex=.34*lowRate+.20*(100-uniform)+.34*clamp((.055-variMean)*820,0,100)+.18*clamp((.085-gliMean)*700,0,100)+.10*brownRate;
    else if(species==="コウライ芝")dryIndex=.22*lowRate+.30*(100-uniform)+.28*clamp((.025-variMean)*620,0,100)+.12*brownRate;
    else dryIndex=.20*lowRate+.24*(100-uniform)+.25*clamp((.045-variMean)*560,0,100)+.16*brownRate;
    dryIndex=clamp(dryIndex,0,100);const L=pre.limits;const grade=dryIndex<L[0]?"A":dryIndex<L[1]?"B":dryIndex<L[2]?"C":"D";
    const diseaseMismatch=(brownRate>5&&dryIndex<38&&variMean<pre.vari&&gliMean>pre.gli*.75)||(lowRate>18&&uniform>72&&dryIndex<45&&Math.abs(variMean-pre.vari)<.035);
    // 将来のSHIBA指数用入力。現時点では表示・診断結果へ一切使用しない。
    const shibaInputs=buildShibaInputs({vari:variMean,gli:gliMean,dryScore:dryIndex,lowActivity:lowRate,grade});
    const displayClasses=prepareDisplayClasses(classes,valid,targetW,targetH);
    lastResult={image,classes,displayClasses,valid,w:targetW,h:targetH,grade,variMean,gliMean,dryIndex,lowRate,diseaseMismatch,shibaInputs};render(lastResult);
    $("grade").textContent=grade;$("vari").textContent=variMean.toFixed(3);$("gli").textContent=gliMean.toFixed(3);$("dry").textContent=Math.round(dryIndex);$("low").textContent=lowRate.toFixed(1)+"%";
    $("diseaseHint").classList.toggle("hidden",!diseaseMismatch);
    setMessage(grade==="A"?"概ね良好です":grade==="B"?"要観察箇所があります":grade==="C"?"ドライ予兆・低活性反応があります":"反応が強い場所を現地確認してください");
  }catch(e){setMessage("解析エラー："+e.message)}
  schedule();
}

const DISPLAY_MODE_NAMES={original:"元画像",outline:"輪郭表示",surface:"面表示",heatmap:"ヒートマップ"};
let displayMode="heatmap",modeToastTimer=null;

function buildShibaInputs({vari,gli,dryScore,lowActivity,grade}){
  // 将来のSHIBA指数実装用。返却値は現在の診断ロジックでは未使用。
  return Object.freeze({vari,gli,dryScore,lowActivity,grade});
}

function blockAggregateClasses(source,valid,w,h,blockSize=3){
  const out=new Uint8Array(source.length);
  for(let by=0;by<h;by+=blockSize)for(let bx=0;bx<w;bx+=blockSize){
    const counts=[0,0,0,0];let validCount=0;
    for(let y=by;y<Math.min(h,by+blockSize);y++)for(let x=bx;x<Math.min(w,bx+blockSize);x++){
      const i=y*w+x;if(valid[i]){counts[source[i]]++;validCount++}
    }
    if(!validCount)continue;
    let cls=0;
    // 赤は強反応が複数あるブロックだけ。橙・黄は面として続く反応を優先する。
    if(counts[3]>=Math.max(2,Math.ceil(validCount*.28)))cls=3;
    else if(counts[2]+counts[3]>=Math.max(2,Math.ceil(validCount*.34)))cls=2;
    else if(counts[1]+counts[2]+counts[3]>=Math.max(2,Math.ceil(validCount*.42)))cls=1;
    for(let y=by;y<Math.min(h,by+blockSize);y++)for(let x=bx;x<Math.min(w,bx+blockSize);x++){
      const i=y*w+x;if(valid[i])out[i]=cls;
    }
  }
  return out;
}

function smoothDisplayClasses(source,valid,w,h){
  const out=new Uint8Array(source.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!valid[i])continue;
    const counts=[0,0,0,0];let total=0;
    for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){
      const j=yy*w+xx;if(valid[j]){counts[source[j]]++;total++}
    }
    if(counts[3]>=4)out[i]=3;
    else if(counts[2]+counts[3]>=Math.max(4,Math.ceil(total*.48)))out[i]=2;
    else if(counts[1]+counts[2]+counts[3]>=Math.max(4,Math.ceil(total*.55)))out[i]=1;
    else out[i]=0;
  }
  return out;
}

function removeSmallDisplayRegions(source,valid,w,h){
  const out=new Uint8Array(source),visited=new Uint8Array(source.length),queue=new Int32Array(source.length);
  const minimum=[0,18,12,9];
  for(let start=0;start<source.length;start++){
    const cls=source[start];if(!valid[start]||cls===0||visited[start])continue;
    let head=0,tail=0;queue[tail++]=start;visited[start]=1;
    while(head<tail){
      const i=queue[head++],x=i%w,y=Math.floor(i/w);
      const neighbors=[x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1];
      for(const j of neighbors)if(j>=0&&!visited[j]&&valid[j]&&source[j]===cls){visited[j]=1;queue[tail++]=j}
    }
    if(tail<minimum[cls]){
      const fallback=cls===3?2:0;
      for(let k=0;k<tail;k++)out[queue[k]]=fallback;
    }
  }
  return out;
}

function prepareDisplayClasses(source,valid,w,h){
  // 診断クラスは変更せず、描画専用コピーだけを低負荷でまとめる。
  const blocked=blockAggregateClasses(source,valid,w,h,3);
  const smoothed=smoothDisplayClasses(blocked,valid,w,h);
  return removeSmallDisplayRegions(smoothed,valid,w,h);
}

function alphaForClass(cls,base,mode){
  const scales=mode==="surface"?[.14,.40,.76,1]:[.10,.38,.74,1];
  return clamp(base*scales[cls],0,.58);
}

function makeColorSurface(r,mode){
  const surface=document.createElement("canvas");surface.width=r.w;surface.height=r.h;
  const c=surface.getContext("2d"),im=c.createImageData(r.w,r.h);
  const colors=[[33,164,83],[255,227,74],[255,138,28],[225,38,38]],base=clamp(Number($("opacity").value)/100,.40,.60);
  const classes=r.displayClasses||r.classes;
  for(let i=0,j=0;i<classes.length;i++,j+=4){
    if(!r.valid[i])continue;
    const cls=classes[i],col=colors[cls],a=alphaForClass(cls,base,mode);
    im.data[j]=col[0];im.data[j+1]=col[1];im.data[j+2]=col[2];im.data[j+3]=Math.round(clamp(a,0,1)*255);
  }
  c.putImageData(im,0,0);
  return surface;
}

function makeOutlineMap(r){
  const map=document.createElement("canvas");map.width=r.w;map.height=r.h;
  const c=map.getContext("2d"),classes=r.displayClasses||r.classes;
  const colors={1:[255,227,74],2:[255,138,28],3:[225,38,38]},radii={1:0,2:1,3:2};
  c.shadowColor="rgba(0,0,0,.88)";c.shadowBlur=1.5;
  for(const cls of [1,2,3]){
    const edge=document.createElement("canvas");edge.width=r.w;edge.height=r.h;
    const ectx=edge.getContext("2d"),im=ectx.createImageData(r.w,r.h),col=colors[cls];
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
      const i=y*r.w+x;if(!r.valid[i]||classes[i]!==cls)continue;
      const boundary=x===0||y===0||x===r.w-1||y===r.h-1||
        !r.valid[i-1]||!r.valid[i+1]||!r.valid[i-r.w]||!r.valid[i+r.w]||
        classes[i-1]!==cls||classes[i+1]!==cls||classes[i-r.w]!==cls||classes[i+r.w]!==cls;
      if(!boundary)continue;
      const j=i*4;im.data[j]=col[0];im.data[j+1]=col[1];im.data[j+2]=col[2];im.data[j+3]=245;
    }
    ectx.putImageData(im,0,0);
    const radius=radii[cls];
    for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++)if(ox*ox+oy*oy<=radius*radius)c.drawImage(edge,ox,oy);
  }
  c.shadowColor="transparent";
  return map;
}

function makeMap(r){
  const blank=document.createElement("canvas");blank.width=r.w;blank.height=r.h;
  if(displayMode==="original")return blank;
  if(displayMode==="outline")return makeOutlineMap(r);
  const surface=makeColorSurface(r,displayMode);
  if(displayMode==="surface")return surface;
  const c=blank.getContext("2d");
  c.filter="blur(1.6px)";
  c.drawImage(surface,0,0);
  c.filter="none";
  return blank;
}

function showModeToast(name){
  const toast=$("modeToast");clearTimeout(modeToastTimer);
  toast.textContent=`表示：${name}`;toast.classList.remove("hidden");
  modeToastTimer=setTimeout(()=>toast.classList.add("hidden"),1500);
}

function setDisplayMode(mode,notify=true){
  if(!DISPLAY_MODE_NAMES[mode])return;
  displayMode=mode;
  document.querySelectorAll(".mode-switcher button").forEach(button=>{
    const selected=button.dataset.mode===mode;
    button.classList.toggle("active",selected);button.setAttribute("aria-pressed",String(selected));
  });
  $("currentMode").textContent=`表示：${DISPLAY_MODE_NAMES[mode]}`;
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
  x.fillText(`Turf Vision Live  判定 ${lastResult.grade}  ドライ ${Math.round(lastResult.dryIndex)}/100`,18,38);
  x.font=`${Math.max(18,Math.round(w*.017))}px sans-serif`;x.fillText(`低活性 ${lastResult.lowRate.toFixed(1)}%  VARI ${lastResult.variMean.toFixed(3)}  GLI ${lastResult.gliMean.toFixed(3)}`,18,70);
  const blob=await new Promise(resolve=>c.toBlob(resolve,"image/png"));if(!blob){setMessage("保存画像を作成できませんでした。");return}
  const name=`Turf_Vision_Live_${new Date().toISOString().replace(/[:.]/g,"-")}.png`,file=new File([blob],name,{type:"image/png"});
  try{
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:"Turf Vision Live 診断画像"});setMessage("共有先からフォトまたはファイルへ保存できます。");return}
  }catch(e){if(e.name==="AbortError")return}
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.download=name;link.href=url;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage("画像をダウンロードしました。");
}

$("startBtn").onclick=()=>stream?stopCamera():startCamera();
$("pauseBtn").onclick=()=>{paused=!paused;$("pauseBtn").textContent=paused?"再開":"一時停止";setMessage(paused?"解析を一時停止しました。近くで確認できます。":"解析を再開しました。");if(!paused)schedule()};
$("saveBtn").onclick=saveScreen;
$("opacity").oninput=e=>{$("opacityValue").textContent=e.target.value+"%";if(lastResult)render(lastResult)};
document.querySelectorAll(".mode-switcher button").forEach(button=>button.onclick=()=>setDisplayMode(button.dataset.mode));
setDisplayMode("heatmap",false);
$("species").onchange=()=>{temporalClasses=null};
$("lightMode").onchange=()=>{temporalClasses=null};
window.addEventListener("resize",()=>lastResult?render(lastResult):resizeOverlay());window.addEventListener("pagehide",stopCamera);
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
