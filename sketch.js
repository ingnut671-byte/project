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
//  PART B — THE ARTWORK
// ---------------------------------------------------------------------

// Colors sampled from Kandinsky's "Several Circles"
const PALETTE = ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#8ab6d6", "#f1faee", "#6d3b8c", "#1d3557"];

// A pentatonic scale (C major pentatonic, MIDI notes) — any notes sound good together
const SCALE = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

let circles = [];      // placed circles: {x, y, r, colors: [halo, body, core]}
let growing = null;    // the circle currently growing, or null
let wasPinching = false;

// Sound
let hum;               // continuous tone while a circle is growing
let bell, bellEnv;     // short "ding" when a circle is placed

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
  select("#start").mouseClicked(startExperience);
}

function startExperience() {
  userStartAudio(); // browsers block sound until the user clicks

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  hum = new p5.Oscillator("triangle");
  hum.amp(0);
  hum.start();

  bell = new p5.Oscillator("sine");
  bell.amp(0);
  bell.start();
  bellEnv = new p5.Envelope();
  bellEnv.setADSR(0.005, 0.4, 0.0, 0.1); // fast attack, long decay = bell
  bellEnv.setRange(0.5, 0);

  select("#intro").hide();
  started = true;
  loadHandLandmarker();
}

function draw() {
  background(12, 18, 38); // deep night-blue, like the painting
  if (!started) return;

  updateHands();
  if (showCamera) drawCamera();

  // 1. Draw every circle that has been placed
  for (const c of circles) drawKandinskyCircle(c);

  // 2. Read the first hand
  if (hands.length === 0) {
    hum.amp(0, 0.2);
    growing = null;
    wasPinching = false;
    return;
  }
  const hand = hands[0];
  const tip = hand[INDEX_TIP];
  const thumb = hand[THUMB_TIP];

  // Pinch = thumb tip close to index tip.
  // We divide by the hand size so it works near or far from the camera.
  const handSize = dist(hand[WRIST].x, hand[WRIST].y, hand[MIDDLE_BASE].x, hand[MIDDLE_BASE].y);
  const pinchAmount = dist(tip.x, tip.y, thumb.x, thumb.y) / handSize;
  const isPinching = pinchAmount < 0.3;

  // Point between thumb and index = where the circle lives
  const px = (tip.x + thumb.x) / 2;
  const py = (tip.y + thumb.y) / 2;

  // 3. Pinch just started → begin a new circle
  if (isPinching && !wasPinching) {
    growing = { x: px, y: py, r: 10, colors: shuffle(PALETTE).slice(0, 3) };
  }

  // 4. Still pinching → grow it and follow the hand
  if (isPinching && growing) {
    growing.r = min(growing.r + 2.5, 260);
    growing.x = lerp(growing.x, px, 0.3);
    growing.y = lerp(growing.y, py, 0.3);
    drawKandinskyCircle(growing);

    // Bigger circle = lower pitch (like a big drum vs a small bell)
    hum.freq(map(growing.r, 10, 260, 660, 110));
    hum.amp(0.12, 0.1);
  }

  // 5. Pinch released → place the circle and ring the bell
  if (!isPinching && wasPinching && growing) {
    circles.push(growing);
    ringBell(growing.r);
    growing = null;
    hum.amp(0, 0.15);
  }
  wasPinching = isPinching;

  // 6. Cursor: a thin ring at the fingertip
  noFill();
  stroke(241, 234, 216, 180);
  strokeWeight(2);
  circle(px, py, isPinching ? 16 : 34);
  noStroke();
}

// One "Kandinsky circle" = soft halo + body + offset core
function drawKandinskyCircle(c) {
  const halo = color(c.colors[0]);
  halo.setAlpha(70);
  fill(halo);
  circle(c.x, c.y, c.r * 2.4);

  const body = color(c.colors[1]);
  body.setAlpha(215);
  fill(body);
  circle(c.x, c.y, c.r * 2);

  const core = color(c.colors[2]);
  core.setAlpha(230);
  fill(core);
  circle(c.x + c.r * 0.18, c.y - c.r * 0.12, c.r * 0.9);
}

function ringBell(r) {
  // Big circle → low note, small circle → high note
  const i = floor(map(r, 10, 260, SCALE.length - 1, 0, true));
  bell.freq(midiToFreq(SCALE[i]));
  bellEnv.play(bell);
}

function keyPressed() {
  if (key === "c" || key === "C") circles = [];
  if (key === "s" || key === "S") saveCanvas("my-kandinsky", "png");
  if (key === "v" || key === "V") showCamera = !showCamera;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
