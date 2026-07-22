const PRESETS={
  "ベント芝":{vari:.055,gli:.095,exg:.135,pct:18,limits:[16,28,44,64]},
  "コウライ芝":{vari:.010,gli:.045,exg:.070,pct:14,limits:[24,38,55,72]},
  "ティフトン・バミューダ":{vari:-.005,gli:.035,exg:.055,pct:12,limits:[22,36,54,70]}
};
const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const video=$("camera"), overlay=$("overlay"), work=$("analysisCanvas"), octx=overlay.getContext("2d"), wctx=work.getContext("2d",{willReadFrequently:true});
let stream=null,running=false,paused=false,timer=null,lastResult=null;

function percentile(values,p){if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p/100)]}
function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0}
function sd(a){const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)))}
function rgbToHsv(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=60*(((g-b)/d)%6);else if(mx===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4)}if(h<0)h+=360;return[h/2,mx?d/mx*255:0,mx]}
function resizeOverlay(){const r=video.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);overlay.width=Math.round(r.width*dpr);overlay.height=Math.round(r.height*dpr);octx.setTransform(dpr,0,0,dpr,0,0)}
function setMessage(t){$("message").textContent=t}

async function startCamera(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=stream;await video.play();resizeOverlay();running=true;paused=false;
    $("startBtn").textContent="カメラ停止";$("pauseBtn").disabled=false;$("saveBtn").disabled=false;setMessage("約0.5秒ごとに解析しています。");schedule();
  }catch(e){setMessage("カメラを開始できません。ブラウザのカメラ許可を確認してください。");}
}
function stopCamera(){running=false;paused=false;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;octx.clearRect(0,0,overlay.width,overlay.height);$("startBtn").textContent="カメラ開始";$("pauseBtn").textContent="一時停止";$("pauseBtn").disabled=true;$("saveBtn").disabled=true;setMessage("カメラを停止しました。");}
function schedule(){clearTimeout(timer);if(running&&!paused)timer=setTimeout(analyzeFrame,500)}

function analyzeFrame(){
  if(!running||paused||video.readyState<2){schedule();return}
  try{
    const targetW=240,targetH=180;work.width=targetW;work.height=targetH;wctx.drawImage(video,0,0,targetW,targetH);
    const image=wctx.getImageData(0,0,targetW,targetH),d=image.data,n=targetW*targetH;
    const species=$("species").value,pre=PRESETS[species],light=$("lightMode").value;
    const vari=new Float32Array(n),gli=new Float32Array(n),exg=new Float32Array(n),val=new Float32Array(n),sat=new Float32Array(n),valid=new Uint8Array(n),brown=new Uint8Array(n);
    const vv=[],gg=[],ee=[];let brownCount=0;
    for(let i=0,j=0;i<n;i++,j+=4){
      let r=d[j],g=d[j+1],b=d[j+2];
      if(light==="shade"){r=clamp(r*1.10,0,255);g=clamp(g*1.10,0,255);b=clamp(b*1.08,0,255)}
      if(light==="sun"){r=clamp((r-128)*.88+128,0,255);g=clamp((g-128)*.88+128,0,255);b=clamp((b-128)*.88+128,0,255)}
      const total=r+g+b||1,[h,s,v]=rgbToHsv(r,g,b);sat[i]=s;val[i]=v;
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
    const th=percentile(scores,pre.pct),classes=new Uint8Array(n);let lowCount=0,watchCount=0,severeCount=0;
    for(let i=0;i<n;i++)if(valid[i]){
      let low=species==="ベント芝"?(votes[i]>=2&&score[i]<=th):(score[i]<=th&&(votes[i]>=1||score[i]<th*.85));
      let cls=0;if(low){cls=2;lowCount++;if(score[i]<th*.62||votes[i]>=3){cls=3;severeCount++}}else if(score[i]<Math.min(.52,th*1.55)){cls=1;watchCount++}classes[i]=cls;
    }
    const variMean=mean(vv),gliMean=mean(gg),uniform=clamp(100*(1-mean([sd(vv),sd(gg),sd(ee)])/.20),0,100),lowRate=lowCount/vv.length*100,brownRate=brownCount/vv.length*100;
    let dryIndex;if(species==="ベント芝")dryIndex=.34*lowRate+.20*(100-uniform)+.34*clamp((.055-variMean)*820,0,100)+.18*clamp((.085-gliMean)*700,0,100)+.10*brownRate;
    else if(species==="コウライ芝")dryIndex=.22*lowRate+.30*(100-uniform)+.28*clamp((.025-variMean)*620,0,100)+.12*brownRate;
    else dryIndex=.20*lowRate+.24*(100-uniform)+.25*clamp((.045-variMean)*560,0,100)+.16*brownRate;
    dryIndex=clamp(dryIndex,0,100);const L=pre.limits;let grade=dryIndex<L[0]?"A":dryIndex<L[1]?"B":dryIndex<L[2]?"C":"D";
    const diseaseMismatch=(brownRate>5&&dryIndex<38&&variMean<pre.vari&&gliMean>pre.gli*.75)||(lowRate>18&&uniform>72&&dryIndex<45&&Math.abs(variMean-pre.vari)<.035);
    lastResult={image,classes,w:targetW,h:targetH,grade,variMean,gliMean,dryIndex,lowRate,diseaseMismatch};render(lastResult);
    $("grade").textContent=grade;$("vari").textContent=variMean.toFixed(3);$("gli").textContent=gliMean.toFixed(3);$("dry").textContent=Math.round(dryIndex);$("low").textContent=lowRate.toFixed(1)+"%";
    $("diseaseHint").classList.toggle("hidden",!diseaseMismatch);setMessage(grade==="A"?"概ね良好":grade==="B"?"要観察箇所があります":grade==="C"?"ドライ予兆・低活性反応":"反応が強い場所を現地確認してください");
  }catch(e){setMessage("解析エラー："+e.message)}
  schedule();
}

function render(r){
  resizeOverlay();const box=overlay.getBoundingClientRect(),cw=box.width,ch=box.height;const scale=Math.max(cw/r.w,ch/r.h),dw=r.w*scale,dh=r.h*scale,ox=(cw-dw)/2,oy=(ch-dh)/2,alpha=Number($("opacity").value)/100;
  const map=document.createElement("canvas");map.width=r.w;map.height=r.h;const c=map.getContext("2d"),im=c.createImageData(r.w,r.h);
  const colors=[[33,164,83],[255,227,74],[255,138,28],[225,38,38]];
  for(let i=0,j=0;i<r.classes.length;i++,j+=4){const col=colors[r.classes[i]];im.data[j]=col[0];im.data[j+1]=col[1];im.data[j+2]=col[2];im.data[j+3]=Math.round(alpha*255)}c.putImageData(im,0,0);
  octx.clearRect(0,0,cw,ch);octx.imageSmoothingEnabled=true;octx.drawImage(map,ox,oy,dw,dh);
}
function saveScreen(){if(!lastResult)return;const c=document.createElement("canvas"),w=video.videoWidth||1280,h=video.videoHeight||720;c.width=w;c.height=h;const x=c.getContext("2d");x.drawImage(video,0,0,w,h);const map=document.createElement("canvas");map.width=lastResult.w;map.height=lastResult.h;const m=map.getContext("2d"),im=m.createImageData(map.width,map.height),colors=[[33,164,83],[255,227,74],[255,138,28],[225,38,38]],a=Math.round(Number($("opacity").value)/100*255);for(let i=0,j=0;i<lastResult.classes.length;i++,j+=4){const col=colors[lastResult.classes[i]];im.data[j]=col[0];im.data[j+1]=col[1];im.data[j+2]=col[2];im.data[j+3]=a}m.putImageData(im,0,0);x.drawImage(map,0,0,w,h);x.fillStyle="rgba(0,0,0,.65)";x.fillRect(0,0,w,64);x.fillStyle="white";x.font="bold 28px sans-serif";x.fillText(`Turf Vision Live  判定 ${lastResult.grade}  ドライ ${Math.round(lastResult.dryIndex)}/100`,18,41);const link=document.createElement("a");link.download=`Turf_Vision_Live_${new Date().toISOString().replace(/[:.]/g,"-")}.png`;link.href=c.toDataURL("image/png");link.click()}

$("startBtn").onclick=()=>stream?stopCamera():startCamera();
$("pauseBtn").onclick=()=>{paused=!paused;$("pauseBtn").textContent=paused?"再開":"一時停止";setMessage(paused?"解析を一時停止しました。":"解析を再開しました。");if(!paused)schedule()};
$("saveBtn").onclick=saveScreen;$("opacity").oninput=e=>{$("opacityValue").textContent=e.target.value+"%";if(lastResult)render(lastResult)};
window.addEventListener("resize",()=>lastResult?render(lastResult):resizeOverlay());window.addEventListener("pagehide",stopCamera);
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
