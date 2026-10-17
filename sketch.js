// =====================================================================
//  PROJECT 1 — "Several Circles" (after Wassily Kandinsky, 1926)
//  Level: beginner
//  Pinch + hold  → a circle grows at your fingertip (pitch falls as it grows)
//  Release       → the circle is placed and rings like a bell
// =====================================================================


// ---------------------------------------------------------------------
//  PART A — HAND TRACKING (identical in all three projects)
// ---------------------------------------------------------------------
const MP_VERSION = "0.10.21";
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let video;                // the webcam (p5 capture)
let handLandmarker = null; // the MediaPipe model
let hands = [];           // every frame: an array of hands, each = 21 points {x, y, z} in canvas pixels
                          // plus hand.side = "Left" or "Right"
let lastVideoTime = -1;
let started = false;
let showCamera = false;

// Landmark numbers we use (full map: see README)
const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_BASE = 9;

async function loadHandLandmarker() {
  setStatus("Loading hand model…");
  const vision = await import(`${MP_URL}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2,
  });
  try {
    handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (e) {
    // Some laptops have no WebGL GPU access — fall back to CPU
    handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

// Call once per frame: asks MediaPipe for new landmarks and converts them
// from 0..1 numbers into mirrored canvas pixels.
let cameraOk = null;
function updateHands() {
  if (!handLandmarker || !video) return;

  // Tell the visitor if the camera isn't giving us pictures (permission denied, or in use by another app)
  const ok = video.elt.readyState >= 2;
  if (ok !== cameraOk) {
    cameraOk = ok;
    setStatus(ok ? "Show your hand to the camera ✋"
                 : "Waiting for the camera… click Allow, or the camera icon in the address bar, then reload");
  }
  if (!ok) return;
  if (video.elt.currentTime === lastVideoTime) return; // no new camera frame yet
  lastVideoTime = video.elt.currentTime;

  const result = handLandmarker.detectForVideo(video.elt, performance.now());
  hands = result.landmarks.map((hand, i) => {
    const pts = hand.map((p) => ({ x: (1 - p.x) * width, y: p.y * height, z: p.z }));
    pts.side = result.handedness[i][0].categoryName;
    return pts;
  });
}

function drawCamera() {
  push();
  translate(width, 0);
  scale(-1, 1); // mirror, so it feels like a mirror
  tint(255, 70);
  image(video, 0, 0, width, height);
  pop();
}

function setStatus(msg) {
  select("#status").html(msg);
}


// ---------------------------------------------------------------------
//  PART B — GEOMETRIC COMPOSITION (方案 B)
// PART A is unchanged. Three landmark rules in PART B select circles, triangles and freehand curves.
// These are geometric heuristics, not MediaPipe GestureRecognizer category results.
const PALETTE = ['#e63946','#f4a261','#e9c46a','#2a9d8f','#8ab6d6','#f1faee','#6d3b8c','#1d3557'];
const SCALE = [48,50,52,55,57,60,62,64,67,69,72,74,76,79,81];
let shapes=[], growing=null, wasPinching=false, brush='circle', inputMode='mouse';
let gestureCandidate='None', gestureSince=0, gestureFired=false, curveExitSince=null;
let hum, bell, bellEnv, busy=false, pointer=null, blockedUntilRelease=false;
const names={circle:'圆形',triangle:'三角形',curve:'曲线'};
let gift=null,giftWait=6,giftParticles=[],giftToast='',giftToastTime=0,giftsEnabled=true;
function setup(){
  const canvas=createCanvas(windowWidth,windowHeight);
  noStroke();
  document.querySelector('#start').onclick=()=>startExperience('hand');
  document.querySelector('#mouse-start').onclick=()=>startExperience('mouse');
  document.querySelectorAll('[data-brush]').forEach(b=>b.onclick=()=>chooseBrush(b.dataset.brush));
  document.querySelector('#clear').onclick=clearArt;
  document.querySelector('#undo').onclick=()=>shapes.pop();
  document.querySelector('#save').onclick=saveArt;
  document.querySelector('#gifts').onclick=()=>{giftsEnabled=!giftsEnabled;gift=null;giftWait=6;document.querySelector('#gifts').textContent='礼包：'+(giftsEnabled?'开':'关');};
  document.querySelector('#camera').onclick=()=>showCamera=!showCamera;
  document.querySelector('#mouse-mode').onclick=()=>{
    inputMode='mouse';cancelStroke();setStatus('鼠标模式：按住拖动绘制，松开固定。');
  };
  canvas.elt.addEventListener('pointerdown',e=>{
    if(!started || inputMode!=='mouse')return;
    canvas.elt.setPointerCapture(e.pointerId);
    pointer={x:e.clientX,y:e.clientY,down:true};
  });
  canvas.elt.addEventListener('pointermove',e=>{if(!pointer)pointer={x:e.clientX,y:e.clientY,down:false};else{pointer.x=e.clientX;pointer.y=e.clientY;}});
  canvas.elt.addEventListener('pointerup',()=>{if(pointer)pointer.down=false;});
  canvas.elt.addEventListener('pointercancel',()=>{pointer=null;cancelStroke();});
  window.addEventListener('blur',()=>{pointer=null;cancelStroke();});
}
async function startExperience(mode){
  if(busy||started)return;
  busy=true;
  try{
    await userStartAudio();
    hum=new p5.Oscillator('triangle');hum.amp(0);hum.start();
    bell=new p5.Oscillator('sine');bell.amp(0);bell.start();
    bellEnv=new p5.Envelope();bellEnv.setADSR(0.005,0.4,0,0.1);bellEnv.setRange(0.35,0);
    inputMode=mode;started=true;
    document.querySelector('#intro').hidden=true;
    document.querySelector('#tools').hidden=false;
    if(mode==='hand'){
      video=createCapture(VIDEO);video.size(640,480);video.hide();
      video.elt.setAttribute('playsinline','');
      await loadHandLandmarker();
      setStatus('请允许摄像头，然后伸出手；也可点击「鼠标试画」。');
    }else setStatus('鼠标模式：按住拖动绘制，松开固定。');
  }catch(e){
    console.error(e);
    if(started){inputMode='mouse';setStatus('摄像头或模型未能启动，已切换鼠标试画。检查权限与网络后刷新重试。');}
    else document.querySelector('#boot').textContent='启动失败，请刷新重试。'+e.message;
  }finally{busy=false;}
}
function chooseBrush(type){
  brush=type;
  document.querySelectorAll('[data-brush]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.brush===type)));
  document.querySelector('#brush-label').textContent=names[type];
}
function cancelStroke(){growing=null;wasPinching=false;blockedUntilRelease=true;resetGesture();if(hum)hum.amp(0,0.1);}
function clearArt(){shapes=[];cancelStroke();}
function saveArt(){
  // Export only the artwork; camera and fingertip cursor are omitted.
  drawAtmosphere();shapes.forEach(drawShape);saveCanvas('kandinsky-geometry','png');
}
// Rotation-independent finger tests in camera proportions; index 9 is the middle MCP.
function classifyGesture(points){
  const h=points.map(p=>({x:p.x/width*640,y:p.y/height*480}));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const straight=(a,b,c)=>{
    const u={x:a.x-b.x,y:a.y-b.y},v={x:c.x-b.x,y:c.y-b.y};
    return (u.x*v.x+u.y*v.y)/Math.max(1e-6,Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y));
  };
  const extended=[],folded=[];
  for(const base of [5,9,13,17]){
    const m=h[base],pip=h[base+1],tip=h[base+3];
    const reach=distance(tip,h[0])/Math.max(1,distance(pip,h[0]));
    const angle=straight(m,pip,tip);
    extended.push(angle < -0.72 && reach>1.13);
    folded.push(reach<1.04 || angle> -0.15);
  }
  if(folded.every(Boolean))return 'Closed_Fist';
  if(extended[0]&&extended[1]&&folded[2]&&folded[3])return 'Victory';
  if(extended[0]&&folded[1]&&folded[2]&&folded[3])return 'Pointing_Up';
  return 'None';
}
function resetGesture(){gestureCandidate='None';gestureSince=0;gestureFired=false;curveExitSince=null;}
function strokeSize(s){return s.type==='curve'?constrain(s.length/3,10,260):s.r;}
function finishStroke(){
  if(!growing)return;
  if(growing.type!=='curve'||growing.points.length>1){shapes.push(growing);ringBell(strokeSize(growing));}
  growing=null;wasPinching=false;hum.amp(0,0.15);
}
function beginStroke(type,x,y){
  growing={type,x,y,ax:x,ay:y,r:10,angle:0,colors:shuffle(PALETTE).slice(0,3),points:[{x,y}],length:0};
}
function extendStroke(x,y){
  if(!growing)return;
  growing.x=lerp(growing.x,x,0.35);growing.y=lerp(growing.y,y,0.35);
  if(growing.type==='curve'){
    const prev=growing.points[growing.points.length-1];
    const d=dist(prev.x,prev.y,growing.x,growing.y);
    if(d>=2){growing.points.push({x:growing.x,y:growing.y});growing.length+=d;}
    if(growing.points.length>=2000){finishStroke();blockedUntilRelease=true;return;}
  }else{
    growing.r=min(growing.r+150*min(deltaTime,50)/1000,260);
    if(growing.type==='triangle')growing.angle=constrain((x-growing.ax)/250,-PI,PI);
  }
  hum.freq(map(strokeSize(growing),10,260,660,110));hum.amp(0.12,0.1);
}
function processHand(h,now){
  const t=h[4],i=h[8],size=Math.max(1,dist(h[0].x,h[0].y,h[9].x,h[9].y));
  const ratio=dist(t.x,t.y,i.x,i.y)/size;
  const pinch=ratio<(wasPinching?0.38:0.3);
  const raw=classifyGesture(h);
  document.querySelector('#gesture-label').textContent=({Closed_Fist:'握拳',Victory:'剪刀手',Pointing_Up:'食指向上',None:'—'})[raw];
  const cursor={x:(t.x+i.x)/2,y:(t.y+i.y)/2,down:pinch};
  // Finish an existing stroke before allowing selection gestures.
  if(growing){
    if(growing.type==='curve'){
      cursor.x=i.x;cursor.y=i.y;cursor.down=true;
      if(raw==='Pointing_Up'){
        curveExitSince=null;extendStroke(i.x,i.y);
      }else{
        if(curveExitSince===null)curveExitSince=now;
        if(now-curveExitSince>=140){finishStroke();blockedUntilRelease=true;resetGesture();}
      }
    }else{
      if(pinch)extendStroke(cursor.x,cursor.y);
      else{finishStroke();resetGesture();}
    }
    return cursor;
  }
  if(raw!==gestureCandidate){gestureCandidate=raw;gestureSince=now;gestureFired=false;}
  // A fist can put the thumb close to the index: never count a selection pose as a pinch.
  if(raw==='Closed_Fist'||raw==='Victory'){
    blockedUntilRelease=true;wasPinching=false;
    if(!gestureFired&&now-gestureSince>=450){
      chooseBrush(raw==='Closed_Fist'?'circle':'triangle');gestureFired=true;
      setStatus('已选择'+names[brush]+'：先张开手，再捏合绘制，松开固定。');
    }
    return cursor;
  }
  if(raw==='Pointing_Up'&&!pinch){
    blockedUntilRelease=false;
    cursor.x=i.x;cursor.y=i.y;
    if(!gestureFired&&now-gestureSince>=350){
      chooseBrush('curve');beginStroke('curve',i.x,i.y);gestureFired=true;
      setStatus('曲线绘制中：移动食指留下轨迹，收起食指结束。');
    }
    return cursor;
  }
  if(!pinch)blockedUntilRelease=false;
  if(pinch&&!blockedUntilRelease&&brush!=='curve'){
    beginStroke(brush,cursor.x,cursor.y);wasPinching=true;resetGesture();
  }
  return cursor;
}
function draw(){
  drawAtmosphere();
  if(!started){drawSample();return;}
  if(inputMode==='hand'){
    try{updateHands();}catch(e){inputMode='mouse';cancelStroke();setStatus('识别中断，已切换鼠标试画。刷新页面可重新启动摄像头。');}
  }
  if(showCamera&&video&&video.elt.readyState>=2)drawCamera();
  let cursor=null;
  if(inputMode==='hand'){
    // No fresh camera frame for 0.6s means tracking has stopped, even if old landmarks remain.
    const vt=video?video.elt.currentTime:-1;
    if(vt!==lastObservedCameraTime){lastObservedCameraTime=vt;lastCameraFrameAt=millis();}
    if(hands.length&&video&&video.elt.readyState>=2&&millis()-lastCameraFrameAt<600){
      cursor=processHand(hands[0],millis());
    }else{
      if(growing&&growing.type==='curve')finishStroke();
      cancelStroke();document.querySelector('#gesture-label').textContent='未检测到手';
    }
  }else if(pointer){
    cursor=pointer;
    if(!pointer.down)blockedUntilRelease=false;
    if(pointer.down&&!blockedUntilRelease){
      if(!growing)beginStroke(brush,pointer.x,pointer.y);
      extendStroke(pointer.x,pointer.y);
    }else if(growing)finishStroke();
  }
  shapes.forEach(drawShape);if(growing)drawShape(growing);
  if(cursor&&!(growing&&growing.type==='curve')){noFill();stroke('#f1ead8');strokeWeight(1.5);circle(cursor.x,cursor.y,cursor.down?16:34);noStroke();}
  updateGifts(cursor,Math.min(deltaTime,50)/1000);
  document.querySelector('#count').textContent=shapes.length;
}
let lastObservedCameraTime=-1,lastCameraFrameAt=0;
function ink(hex,alpha){const c=color(hex);c.setAlpha(alpha);return c;}
// Cached background: quiet indigo, diffused blue/violet light and sparse stars.
let atmosphere=null;
function drawAtmosphere(){
  if(!atmosphere||atmosphere.width!==width||atmosphere.height!==height){
    atmosphere=document.createElement('canvas');atmosphere.width=width;atmosphere.height=height;
    const c=atmosphere.getContext('2d'),d=Math.max(width,height);
    const base=c.createLinearGradient(0,0,width,height);
    base.addColorStop(0,'#080e20');base.addColorStop(.52,'#111d35');base.addColorStop(1,'#0c1023');
    c.fillStyle=base;c.fillRect(0,0,width,height);
    function haze(x,y,r,rgb,opacity){
      const g=c.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,`rgba(${rgb},${opacity})`);g.addColorStop(.45,`rgba(${rgb},${opacity*.4})`);g.addColorStop(1,`rgba(${rgb},0)`);
      c.fillStyle=g;c.fillRect(0,0,width,height);
    }
    haze(width*.68,height*.44,d*.52,'70,116,153',.20);
    haze(width*.92,height*.73,d*.43,'99,67,139',.16);
    haze(width*.18,height*.9,d*.42,'41,100,112',.10);
    let seed=9173;
    const rnd=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
    const count=Math.min(95,Math.floor(width*height/14000));
    for(let k=0;k<count;k++){
      const x=rnd()*width,y=rnd()*height,r=.3+rnd()*.65;
      c.fillStyle=`rgba(205,222,244,${.12+rnd()*.26})`;
      c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();
    }
    const edge=c.createRadialGradient(width*.52,height*.50,d*.1,width*.52,height*.50,d*.70);
    edge.addColorStop(0,'rgba(3,7,19,0)');edge.addColorStop(1,'rgba(3,7,19,.52)');
    c.fillStyle=edge;c.fillRect(0,0,width,height);
  }
  drawingContext.drawImage(atmosphere,0,0,width,height);
}
// Each path is rendered tail -> head; the taper follows distance, not drawing speed.
// Native Canvas strokes keep the exported PNG identical to the visible comet.
// Continuous tapered ribbons replace separate line segments: no visible joins.
function smoothCometPoints(points){
  const stride=Math.max(1,Math.ceil(points.length/220));let p=[];
  for(let i=0;i<points.length;i+=stride)p.push(points[i]);
  if(p[p.length-1]!==points[points.length-1])p.push(points[points.length-1]);
  // Two Chaikin passes round corners while preserving both endpoints.
  for(let pass=0;pass<2;pass++){
    const q=[p[0]];
    for(let i=0;i<p.length-1;i++){
      const a=p[i],b=p[i+1];
      q.push({x:.75*a.x+.25*b.x,y:.75*a.y+.25*b.y},{x:.25*a.x+.75*b.x,y:.25*a.y+.75*b.y});
    }
    q.push(p[p.length-1]);p=q;
  }
  return p;
}
function cometRibbons(s){
  if(s._ribbons&&s._ribbonCount===s.points.length)return s._ribbons;
  const p=smoothCometPoints(s.points),lengths=[0];
  for(let i=1;i<p.length;i++)lengths.push(lengths[i-1]+Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y));
  const total=lengths[lengths.length-1]||1,paths=[];
  for(const scale of [3.6,1,.28]){
    const left=[],right=[];
    for(let i=0;i<p.length;i++){
      const before=p[Math.max(0,i-1)],after=p[Math.min(p.length-1,i+1)];
      const dx=after.x-before.x,dy=after.y-before.y,d=Math.hypot(dx,dy)||1;
      const half=(.12+2.25*Math.pow(lengths[i]/total,1.35))*scale;
      left.push({x:p[i].x-dy/d*half,y:p[i].y+dx/d*half});
      right.push({x:p[i].x+dy/d*half,y:p[i].y-dx/d*half});
    }
    const path=new Path2D();path.moveTo(left[0].x,left[0].y);
    left.slice(1).forEach(q=>path.lineTo(q.x,q.y));right.reverse().forEach(q=>path.lineTo(q.x,q.y));path.closePath();paths.push(path);
  }
  s._ribbonCount=s.points.length;s._ribbons=paths;return paths;
}
function drawComet(s){
  if(!s.points.length)return;
  const hue=s.colors[1],c=drawingContext,first=s.points[0],head=s.points[s.points.length-1];
  const paths=cometRibbons(s);c.save();
  for(let i=0;i<paths.length;i++){
    const g=c.createLinearGradient(first.x,first.y,head.x+.01,head.y+.01),tint=i===2?'#f6faff':hue;
    const opacity=[.12,.85,.90][i];
    g.addColorStop(0,rgba(tint,.015));g.addColorStop(.45,rgba(tint,opacity*.35));g.addColorStop(1,rgba(tint,opacity));
    c.fillStyle=g;c.fill(paths[i]);
  }
  const radius=s===growing?22:16;
  const glow=c.createRadialGradient(head.x,head.y,0,head.x,head.y,radius);
  glow.addColorStop(0,rgba(hue,.75));glow.addColorStop(.25,rgba(hue,.24));glow.addColorStop(1,rgba(hue,0));
  c.fillStyle=glow;c.beginPath();c.arc(head.x,head.y,radius,0,Math.PI*2);c.fill();
  c.fillStyle='#f4fbff';c.beginPath();c.arc(head.x,head.y,s===growing?2.6:2,0,Math.PI*2);c.fill();c.restore();
}
function rgba(hex,alpha){
  const h=hex.replace('#','');return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`;
}
function drawShape(s){
  if(s.type==='curve'){drawComet(s);return;}
  const c=drawingContext,r=s.r,hue=s.colors[0],warm=s.colors[2]||'#edd2aa';
  c.save();c.translate(s.x,s.y);c.rotate(s.angle||0);
  const path=(scale=1)=>{
    c.beginPath();
    if(s.type==='triangle'){c.moveTo(0,-r*scale);c.lineTo(-r*.866*scale,r*.5*scale);c.lineTo(r*.866*scale,r*.5*scale);c.closePath();}
    else c.arc(0,0,r*scale,0,Math.PI*2);
  };
  // Atmospheric glow outside the contour, translucent colour within it.
  const halo=c.createRadialGradient(0,0,r*.25,0,0,r*1.4);
  halo.addColorStop(0,rgba(hue,.03));halo.addColorStop(.65,rgba(hue,.09));halo.addColorStop(1,rgba(hue,0));
  c.fillStyle=halo;c.beginPath();c.arc(0,0,r*1.4,0,Math.PI*2);c.fill();
  const body=c.createLinearGradient(-r,-r,r,r);
  body.addColorStop(0,rgba(hue,.66));body.addColorStop(.55,rgba(s.colors[1],.74));body.addColorStop(1,rgba(warm,.58));
  path();c.fillStyle=body;c.fill();
  // Layered contours create soft light without costly full-canvas blur.
  for(const [w,a] of [[9,.025],[5,.055],[1.6,.76]]){
    path();c.lineJoin='round';c.lineWidth=w;c.strokeStyle=rgba(hue,a);c.stroke();
  }
  c.lineWidth=.8;c.strokeStyle=rgba(warm,.44);
  if(s.type==='triangle'){path(.53);c.stroke();}
  else{
    c.beginPath();c.arc(r*.18,-r*.12,r*.45,0,Math.PI*2);c.fillStyle=rgba(warm,.60);c.fill();c.stroke();
    c.beginPath();c.arc(0,0,r,-2.25,-.50);c.lineWidth=2;c.strokeStyle=rgba('#f2faff',.8);c.stroke();
  }
  const n=Math.min(12,Math.max(3,Math.floor(r/16)));
  for(let k=0;k<n;k++){
    let x,y;
    if(s.type==='triangle'){
      const vertices=[[0,-r],[-r*.866,r*.5],[r*.866,r*.5]],edge=k%3,t=((k*.618)%1);
      const a=vertices[edge],b=vertices[(edge+1)%3];x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t;
    }else{const angle=k*2.399;x=Math.cos(angle)*r;y=Math.sin(angle)*r;}
    c.fillStyle=rgba(hue,.60);c.beginPath();c.arc(x,y,.7+(k%3)*.35,0,Math.PI*2);c.fill();
  }
  c.restore();
}
function collectGift(){
  if(!gift)return;
  const heartColors=['#ff6b91','#ff9db5','#ffd0dc','#f598bc','#ffe4ed'];
  for(let i=0;i<28;i++){
    const a=Math.PI*2*i/28,v=35+Math.random()*75;
    giftParticles.push({x:gift.x,y:gift.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-20,life:1.8+Math.random()*.6,age:0,hue:heartColors[i%heartColors.length],size:5+Math.random()*6,rotation:(Math.random()-.5)*.7});
  }
  giftToast='送你一份小小的心意 ♥';giftToastTime=3;
  if(bell)ringBell(45);
  gift=null;giftWait=18+Math.random()*12;
}
function drawHeart(c,x,y,size,rotation,hue,alpha){
  c.save();c.translate(x,y);c.rotate(rotation);c.scale(size,size);c.globalAlpha=Math.max(0,alpha);c.fillStyle=hue;
  c.beginPath();c.moveTo(0,.85);c.bezierCurveTo(-.35,.5,-1,.05,-1,-.42);c.bezierCurveTo(-1,-1,-.25,-1.15,0,-.55);
  c.bezierCurveTo(.25,-1.15,1,-1,1,-.42);c.bezierCurveTo(1,.05,.35,.5,0,.85);c.closePath();c.fill();c.restore();
}
function updateGifts(cursor,dt){
  const c=drawingContext;
  if(giftsEnabled&&!gift){
    giftWait-=dt;
    if(giftWait<=0)gift={x:width*(.2+Math.random()*.6),baseX:width*(.2+Math.random()*.6),y:-30,age:0,hover:0};
  }
  if(gift){
    gift.age+=dt;
    gift.x=Math.max(30,Math.min(width-30,gift.baseX+Math.sin(gift.age*.9)*22));
    const near=cursor&&Math.hypot(cursor.x-gift.x,cursor.y-gift.y)<48;
    gift.hover=near?gift.hover+dt:0;
    if(!near)gift.y+=Math.max(24,height/18)*dt;
    drawGift(gift);
    if(gift.hover>=.45)collectGift();
    else if(gift.y>height+45){gift=null;giftWait=18+Math.random()*12;}
  }
  c.save();
  giftParticles=giftParticles.filter(p=>p.age<p.life);
  for(const p of giftParticles){
    p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.exp(-dt*.45);p.vy-=8*dt;
    drawHeart(c,p.x,p.y,p.size*(.7+.3*Math.min(1,p.age*6)),p.rotation,p.hue,1-p.age/p.life);
  }
  if(giftToastTime>0){
    giftToastTime-=dt;c.globalAlpha=Math.min(1,Math.max(0,giftToastTime));
    c.font='13px "Microsoft YaHei", sans-serif';c.textAlign='center';c.fillStyle='#e9e0c9';
    c.fillText(giftToast,width/2,height-70,Math.max(100,width-36));
  }
  c.restore();
}
function drawGift(g){
  const c=drawingContext;c.save();c.translate(g.x,g.y);
  const glow=c.createRadialGradient(0,0,0,0,0,42);glow.addColorStop(0,'rgba(244,214,153,.22)');glow.addColorStop(1,'rgba(244,214,153,0)');
  c.fillStyle=glow;c.beginPath();c.arc(0,0,42,0,Math.PI*2);c.fill();
  c.rotate(Math.sin(g.age*1.5)*.10);c.lineJoin='round';c.lineWidth=1.4;c.strokeStyle='#efd8a9';c.fillStyle='#27334b';
  c.fillRect(-12,-8,24,22);c.strokeRect(-12,-8,24,22);c.fillRect(-15,-12,30,7);c.strokeRect(-15,-12,30,7);
  c.beginPath();c.moveTo(0,-12);c.lineTo(0,14);c.stroke();
  c.beginPath();c.moveTo(0,-12);c.bezierCurveTo(-20,-30,-18,-9,0,-12);c.bezierCurveTo(20,-30,18,-9,0,-12);c.stroke();
  c.rotate(-Math.sin(g.age*1.5)*.10);
  if(g.hover>0){c.strokeStyle='#fff1d1';c.lineWidth=2;c.beginPath();c.arc(0,0,30,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,g.hover/.45));c.stroke();}
  c.font='11px "Microsoft YaHei", sans-serif';c.textAlign='center';c.fillStyle='#d9c9a9';c.fillText('靠近领取',0,40);c.restore();
}
function drawSample(){
  const d=min(width,height);
  drawShape({type:'circle',x:width*.73,y:height*.48,r:d*.21,colors:['#8ab6d6','#1d3557','#e9c46a']});
  drawShape({type:'triangle',x:width*.8,y:height*.7,r:d*.17,angle:.25,colors:['#e63946','#e63946','#f1faee']});
  drawShape({type:'curve',points:[{x:width*.55,y:height*.3},{x:width*.65,y:height*.25},{x:width*.82,y:height*.7},{x:width*.94,y:height*.6}],colors:['#fff','#f1faee','#e9c46a']});
}
function ringBell(r){const i=floor(map(r,10,260,SCALE.length-1,0,true));bell.freq(midiToFreq(SCALE[i]));bellEnv.play(bell);}
function keyPressed(){
  if(!started)return;
  if(key==='1')chooseBrush('circle');if(key==='2')chooseBrush('triangle');if(key==='3')chooseBrush('curve');
  if(key.toLowerCase()==='c')clearArt();if(key.toLowerCase()==='s')saveArt();
  if(key.toLowerCase()==='v')showCamera=!showCamera;if(key.toLowerCase()==='z')shapes.pop();
}
function windowResized(){resizeCanvas(windowWidth,windowHeight);}
