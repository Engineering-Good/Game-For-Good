// Chinatown Active Catcher - Game Logic
// Tracks hands (wrists) and legs (knees/ankles) using MediaPipe Pose.

// --- GAME STATE ---
let gameState = 'loading'; // loading, calibrating, ready, playing, gameover
let score = 0;
let highScore = 0;
let gamesPlayed = 0;
let timeLeft = 60;
let difficulty = 'easy'; // easy, medium, hard
let gameInterval = null;
let spawnInterval = null;
let lastSpawnTime = 0;

// --- CAMERA & COMPUTER VISION ---
let videoElement = null;
let canvasElement = null;
let canvasCtx = null;
let pose = null;
let camera = null;
let activeLimbPoints = []; // Holds current wrist & ankle coordinates
let jointsDetected = { hands: false, legs: false };
let calibrationProgress = 0; // 0 to 100%
let calibrationTimer = null;
let calibrationDuration = 2000; // Require 2 seconds of stable tracking to calibrate
let devMode = false; // Mouse-simulation mode fallback
let mirrorMode = true; // Handles horizontal mirroring toggles
let limbMode = 'hands'; // Active limb selection: both, hands, legs
let latestHandsDetected = false;
let latestLegsDetected = false;

// --- AUDIO CONFIG (Web Audio API) ---
let audioCtx = null;
let masterVolume = 0.5;

// --- GAME OBJECTS ---
let items = [];
let particles = [];
let floatingTexts = [];

// Item types
const ITEM_TYPES = {
  // Good items
  INGOT: { emoji: '🧧', points: 10, isGood: true, color: 'rgba(255, 214, 0, 0.2)', border: '#ffd600', glow: '#ffd600' },
  LANTERN: { emoji: '🏮', points: 10, isGood: true, color: 'rgba(255, 23, 68, 0.2)', border: '#ff1744', glow: '#ff1744' },
  PEACH: { emoji: '🍑', points: 10, isGood: true, color: 'rgba(255, 128, 171, 0.2)', border: '#ff80ab', glow: '#ff80ab' },
  // Bad items
  ROTTEN_FRUIT: { emoji: '🍊', points: -10, isGood: false, color: 'rgba(76, 175, 80, 0.2)', border: '#4caf50', glow: '#4caf50' },
  FIRECRACKER: { emoji: '🧨', points: -10, isGood: false, color: 'rgba(255, 87, 34, 0.2)', border: '#ff5722', glow: '#ff5722' }
};

// Physics speeds based on difficulty
const DIFFICULTY_SETTINGS = {
  easy: { minSpeed: 2, maxSpeed: 4, spawnDelay: 1500, ringSize: 70, emojiSize: 42 },
  medium: { minSpeed: 4, maxSpeed: 6.5, spawnDelay: 1100, ringSize: 65, emojiSize: 37 },
  hard: { minSpeed: 6, maxSpeed: 10, spawnDelay: 750, ringSize: 56, emojiSize: 32 }
};

// --- AUDIO SYNTHESIZER ---
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playSound(type) {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  const now = audioCtx.currentTime;
  
  if (type === 'chime') { // Catch Good Item
    // Double beep chime (major third)
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
    gainNode.gain.setValueAtTime(masterVolume * 0.4, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  } 
  else if (type === 'buzzer') { // Catch Bad Item
    // Low sliding buzz
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now); // C3
    osc.frequency.linearRampToValueAtTime(75, now + 0.25);
    gainNode.gain.setValueAtTime(masterVolume * 0.5, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.start(now);
    osc.stop(now + 0.28);
  } 
  else if (type === 'tick') { // Timer tick
    // Short high pitched blip
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5
    gainNode.gain.setValueAtTime(masterVolume * 0.15, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.05);
  } 
  else if (type === 'fanfare') { // Victory/Game Over
    // Simple 3-chord fanfare
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    notes.forEach((freq, index) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, now + index * 0.1);
      g.gain.setValueAtTime(masterVolume * 0.25, now + index * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.6 + index * 0.1);
      o.start(now + index * 0.1);
      o.stop(now + 0.6 + index * 0.1);
    });
  }
}

function adjustVolume(val) {
  masterVolume = parseFloat(val);
  const volIcon = document.getElementById('volIcon');
  if (masterVolume === 0) {
    volIcon.innerText = '🔇';
  } else if (masterVolume < 0.4) {
    volIcon.innerText = '🔈';
  } else {
    volIcon.innerText = '🔊';
  }
}

// --- INIT APP ---
window.addEventListener('DOMContentLoaded', () => {
  videoElement = document.getElementsByClassName('input_video')[0];
  canvasElement = document.getElementById('gameCanvas');
  canvasCtx = canvasElement.getContext('2d');

  // Load high scores
  highScore = localStorage.getItem('chinatown_catcher_highscore') || 0;
  gamesPlayed = localStorage.getItem('chinatown_catcher_games') || 0;
  document.getElementById('highScoreText').innerText = highScore;
  document.getElementById('gamesPlayedText').innerText = gamesPlayed;

  // Set default canvas size
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Initialize MediaPipe Pose Model
  setupPose();

  // Add touch/mouse fallback click listener for Dev Mode / calibration skip
  canvasElement.addEventListener('mousedown', handleCanvasClick);
  canvasElement.addEventListener('touchstart', handleCanvasTouch);

  // Auto fallback warning after 8 seconds if webcam/pose hasn't started
  setTimeout(() => {
    if (gameState === 'loading' && !trackingActive) {
      enableDevModeFallback();
    }
  }, 8000);
});

function resizeCanvas() {
  const container = canvasElement.parentElement;
  canvasElement.width = container.clientWidth;
  canvasElement.height = container.clientHeight;
}

// --- MEDIAPIPE POSE INTEGRATION ---
function setupPose() {
  try {
    pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      }
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    pose.onResults(onPoseResults);

    // Setup camera input
    camera = new Camera(videoElement, {
      onFrame: async () => {
        await pose.send({ image: videoElement });
      },
      width: 640,
      height: 480
    });

    camera.start()
      .then(() => {
        trackingActive = true;
        document.getElementById('trackerStatus').innerText = 'Online';
        document.getElementById('trackerStatus').style.color = 'var(--jade)';
        console.log('Webcam & MediaPipe initialized successfully.');
      })
      .catch((err) => {
        console.warn('Camera failed to start:', err);
        enableDevModeFallback();
      });

  } catch (e) {
    console.error('Error starting MediaPipe Pose:', e);
    enableDevModeFallback();
  }
}

function enableDevModeFallback() {
  devMode = true;
  trackingActive = true;
  gameState = 'calibrating';
  document.getElementById('trackerStatus').innerText = 'Mouse Mode';
  document.getElementById('trackerStatus').style.color = 'var(--gold)';
  
  // Update status boxes for user feedback
  document.getElementById('statusHandsVal').innerText = 'Active (Mouse Click)';
  document.getElementById('statusHandsVal').style.color = 'var(--jade)';
  document.getElementById('statusHands').classList.add('active');
  
  document.getElementById('statusLegsVal').innerText = 'Active (Mouse Click)';
  document.getElementById('statusLegsVal').style.color = 'var(--jade)';
  document.getElementById('statusLegs').classList.add('active');

  const btnStart = document.getElementById('btnStartGame');
  btnStart.removeAttribute('disabled');
  btnStart.innerHTML = 'Start Game (Mouse Play) 🖱️';
  btnStart.style.boxShadow = '0 0 15px var(--jade-glow)';
  btnStart.style.background = 'linear-gradient(135deg, var(--jade) 0%, #00c853 100%)';
}

// Helper to get mapped limb coordinates and labels based on mirror mode
function getLimbData(landmarks, index, type) {
  const landmark = landmarks[index];
  const visThreshold = 0.55;
  if (!landmark || landmark.visibility <= visThreshold) return null;

  let x = landmark.x;
  let label = '';

  if (mirrorMode) {
    // Case A: Custom mirroring. Video is drawn mirrored by us.
    // Coordinates need to be mirrored.
    x = (1 - landmark.x) * canvasElement.width;
    
    // Labels match standard anatomical mapping
    if (index === 19) label = 'L Hand'; // Left wrist in pre-mirrored image is user's physical Right hand
    else if (index === 20) label = 'R Hand'; // Right wrist in pre-mirrored image is user's physical Left hand
    else if (index === 25) label = 'L Knee';
    else if (index === 26) label = 'R Knee';
    else if (index === 27) label = 'L Ankle';
    else if (index === 28) label = 'R Ankle';
  } else {
    // Case B: Camera is pre-mirrored by OS/Browser (or user turned mirror off).
    // Video is drawn directly. Coordinates mapped directly.
    x = landmark.x * canvasElement.width;
    
    // Labels must be SWAPPED because MediaPipe detects anatomical sides on a flipped image!
    if (index === 19) label = 'R Hand';     
    else if (index === 20) label = 'L Hand';      
    else if (index === 25) label = 'R Knee';
    else if (index === 26) label = 'L Knee';
    else if (index === 27) label = 'R Ankle';
    else if (index === 28) label = 'L Ankle';
  }

  return {
    x: x,
    y: landmark.y * canvasElement.height,
    type: type,
    label: label
  };
}

// Process coordinates from MediaPipe
function onPoseResults(results) {
  if (gameState === 'loading') {
    gameState = 'calibrating';
  }

  // Clear previous limb tracking points
  activeLimbPoints = [];

  // Clear tracking status
  let handSeen = false;
  let legSeen = false;

  if (results.poseLandmarks) {
    // Process wrists (hands) if hands or both are enabled
    if (limbMode === 'hands' || limbMode === 'both') {
      const leftWristData = getLimbData(results.poseLandmarks, 19, 'hand');
      const rightWristData = getLimbData(results.poseLandmarks, 20, 'hand');
      
      if (leftWristData) {
        activeLimbPoints.push(leftWristData);
        handSeen = true;
      }
      if (rightWristData) {
        activeLimbPoints.push(rightWristData);
        handSeen = true;
      }
    }

    // Process knees and ankles (legs) if legs or both are enabled
    if (limbMode === 'legs' || limbMode === 'both') {
      const leftKneeData = getLimbData(results.poseLandmarks, 25, 'leg');
      const rightKneeData = getLimbData(results.poseLandmarks, 26, 'leg');
      const leftAnkleData = getLimbData(results.poseLandmarks, 27, 'leg');
      const rightAnkleData = getLimbData(results.poseLandmarks, 28, 'leg');

      if (leftKneeData) {
        activeLimbPoints.push(leftKneeData);
        legSeen = true;
      }
      if (rightKneeData) {
        activeLimbPoints.push(rightKneeData);
        legSeen = true;
      }
      if (leftAnkleData) {
        activeLimbPoints.push(leftAnkleData);
        legSeen = true;
      }
      if (rightAnkleData) {
        activeLimbPoints.push(rightAnkleData);
        legSeen = true;
      }
    }
  }

  // Cache the latest detected states globally
  latestHandsDetected = handSeen;
  latestLegsDetected = legSeen;

  // Handle Calibration Progression
  if (gameState === 'calibrating' && !devMode) {
    checkCalibration(handSeen, legSeen);
  }

  // Draw the frame
  drawGame(results);
}

function checkCalibration(handsActive, legsActive) {
  const handsEl = document.getElementById('statusHandsVal');
  const legsEl = document.getElementById('statusLegsVal');
  const handsCard = document.getElementById('statusHands');
  const legsCard = document.getElementById('statusLegs');

  let checkHands = handsActive;
  let checkLegs = legsActive;

  if (limbMode === 'hands') {
    legsEl.innerText = 'Disabled';
    legsEl.style.color = 'var(--text-muted)';
    legsCard.classList.remove('active');
    checkLegs = true;
  } else {
    if (legsActive) {
      legsEl.innerText = 'Detected ✓';
      legsEl.style.color = 'var(--jade)';
      legsCard.classList.add('active');
    } else {
      legsEl.innerText = 'Show Legs';
      legsEl.style.color = 'var(--ruby)';
      legsCard.classList.remove('active');
    }
  }


  if (limbMode === 'legs') {
    handsEl.innerText = 'Disabled';
    handsEl.style.color = 'var(--text-muted)';
    handsCard.classList.remove('active');
    checkHands = true;
  } else {
    if (handsActive) {
      handsEl.innerText = 'Detected ✓';
      handsEl.style.color = 'var(--jade)';
      handsCard.classList.add('active');
    } else {
      handsEl.innerText = 'Show Hands';
      handsEl.style.color = 'var(--ruby)';
      handsCard.classList.remove('active');
    }
  }

  const btnStart = document.getElementById('btnStartGame');

  if (checkHands && checkLegs) {
    if (!calibrationTimer) {
      calibrationTimer = setTimeout(() => {
        btnStart.removeAttribute('disabled');
        btnStart.innerHTML = 'START GAME • 开始游戏 🏮';
        btnStart.style.boxShadow = '0 0 20px var(--jade-glow)';
        btnStart.style.background = 'linear-gradient(135deg, var(--jade) 0%, #00c853 100%)';
      }, calibrationDuration);
    }
  } else {
    if (calibrationTimer) {
      clearTimeout(calibrationTimer);
      calibrationTimer = null;
    }
    btnStart.setAttribute('disabled', 'true');
    btnStart.innerHTML = 'Calibrating Camera... <span class="calibration-loading"></span>';
    btnStart.style.boxShadow = '';
    btnStart.style.background = '';
  }
}

// --- DEV MODE CLICK INTERACTION ---
function handleCanvasClick(e) {
  if (!devMode || gameState !== 'playing') return;
  simulateTouch(e.clientX, e.clientY);
}

function handleCanvasTouch(e) {
  if (!devMode || gameState !== 'playing') return;
  if (e.touches && e.touches[0]) {
    simulateTouch(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function simulateTouch(clientX, clientY) {
  const rect = canvasElement.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;

  // Add two tracking dots (simulating hands) around the click point
  activeLimbPoints = [
    { x: clickX, y: clickY, type: 'hand', label: 'Mouse Hand' }
  ];

  // Instantly trigger check collisions
  checkCollisions();
}

// --- GAME LOGIC ---
function setDifficulty(level) {
  difficulty = level;
  document.querySelectorAll('#btnDiffEasy, #btnDiffMedium, #btnDiffHard').forEach(btn => {
    btn.classList.remove('active');
  });
  
  if (level === 'easy') document.getElementById('btnDiffEasy').classList.add('active');
  else if (level === 'medium') document.getElementById('btnDiffMedium').classList.add('active');
  else if (level === 'hard') document.getElementById('btnDiffHard').classList.add('active');

  initAudio();
}

function startGame() {
  initAudio();
  playSound('chime');

  // Hide calibration screen
  document.getElementById('calibOverlay').classList.add('hidden');
  document.getElementById('gameHud').classList.remove('hidden');
  
  const gameArea = document.getElementById('gameArea');
  gameArea.classList.remove('calibrating');
  gameArea.classList.add('playing');

  // Reset stats
  score = 0;
  timeLeft = 60;
  items = [];
  particles = [];
  floatingTexts = [];
  
  document.getElementById('hudScore').innerText = score;
  document.getElementById('hudTime').innerText = timeLeft + 's';

  gameState = 'playing';

  // Game timer loop (1 second interval)
  if (gameInterval) clearInterval(gameInterval);
  gameInterval = setInterval(() => {
    timeLeft--;
    
    // Play tick in final 5 seconds
    if (timeLeft <= 5 && timeLeft > 0) {
      playSound('tick');
    }

    document.getElementById('hudTime').innerText = timeLeft + 's';

    if (timeLeft <= 0) {
      endGame();
    }
  }, 1000);

  // Main tick animation loop is handled by onPoseResults (camera update-driven)
  // But if camera is offline / devMode, we need an artificial render tick!
  if (devMode) {
    runDevModeLoop();
  }
}

function runDevModeLoop() {
  if (gameState !== 'playing') return;
  
  // Process simulated movements
  updateGameElements();
  checkCollisions();
  drawGame(null);
  
  requestAnimationFrame(runDevModeLoop);
}

// Spawning and updating logic
function updateGameElements() {
  const now = Date.now();
  const settings = DIFFICULTY_SETTINGS[difficulty];

  // Spawn new item
  if (now - lastSpawnTime > settings.spawnDelay) {
    spawnItem(settings);
    lastSpawnTime = now;
  }

  // Update positions of falling items
  for (let i = items.length - 1; i >= 0; i--) {
    items[i].y += items[i].speed;

    // Remove if offscreen
    if (items[i].y > canvasElement.height + 40) {
      items.splice(i, 1);
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }

  // Update floating text indicators
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const t = floatingTexts[i];
    t.y -= 1.2;
    t.age++;
    if (t.age > t.maxAge) {
      floatingTexts.splice(i, 1);
    }
  }
}

function spawnItem(settings) {
  const keys = Object.keys(ITEM_TYPES);
  const randomTypeKey = keys[Math.floor(Math.random() * keys.length)];
  const type = ITEM_TYPES[randomTypeKey];

  const size = settings.ringSize;
  const item = {
    x: Math.random() * (canvasElement.width - size * 2) + size,
    y: -size,
    radius: size / 2,
    speed: Math.random() * (settings.maxSpeed - settings.minSpeed) + settings.minSpeed,
    emoji: type.emoji,
    points: type.points,
    isGood: type.isGood,
    color: type.color,
    border: type.border,
    glow: type.glow
  };
  
  items.push(item);
}

// Collisions check
function checkCollisions() {
  if (gameState !== 'playing') return;

  for (let itemIdx = items.length - 1; itemIdx >= 0; itemIdx--) {
    const item = items[itemIdx];

    for (let limb of activeLimbPoints) {
      // Collision distance: limb point radius (25) + item radius
      const dx = limb.x - item.x;
      const dy = limb.y - item.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = item.radius + 28;

      if (distance < hitRadius) {
        // HIT!
        triggerCatch(item, itemIdx, limb);
        break; // Stop checking other limbs for this particular item
      }
    }
  }
}

function triggerCatch(item, idx, limb) {
  // Add points
  score += item.points;

  // Requirement 5: "end game total score cannot be <0" 
  // We clamp the score immediately at 0 so it never goes below 0.
  if (score < 0) {
    score = 0;
  }

  document.getElementById('hudScore').innerText = score;

  // Add floating hit indicator text
  floatingTexts.push({
    x: item.x,
    y: item.y,
    text: item.points > 0 ? `+${item.points}` : `${item.points}`,
    color: item.points > 0 ? '#00e676' : '#ff1744',
    age: 0,
    maxAge: 35
  });

  // Sound Synth Feedback
  if (item.isGood) {
    playSound('chime');
    createParticles(item.x, item.y, item.glow, 15);
  } else {
    playSound('buzzer');
    createParticles(item.x, item.y, item.glow, 8);
  }

  // Remove the caught item
  items.splice(idx, 1);
}

function createParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 2;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1, // slight upwards float
      radius: Math.random() * 5 + 3,
      color: color,
      alpha: 1,
      decay: Math.random() * 0.03 + 0.02
    });
  }
}

// --- RENDERING LOOP ---
function drawGame(results) {
  // 1. Draw camera video feed or dev mode dark canvas background
  canvasCtx.save();
  
  if (results && results.image) {
    if (mirrorMode) {
      // Draw mirrored webcam feed
      canvasCtx.translate(canvasElement.width, 0);
      canvasCtx.scale(-1, 1);
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
      canvasCtx.setTransform(1, 0, 0, 1, 0, 0); // Restore translation
    } else {
      // Draw standard webcam feed as-is
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    }
  } else {
    // DevMode static gradient arcade canvas background
    const gradient = canvasCtx.createRadialGradient(
      canvasElement.width / 2, canvasElement.height / 2, 50,
      canvasElement.width / 2, canvasElement.height / 2, canvasElement.width / 1.5
    );
    gradient.addColorStop(0, '#101726');
    gradient.addColorStop(1, '#05070d');
    canvasCtx.fillStyle = gradient;
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    // Decorative gridlines for DevMode arcade grid aesthetics
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    canvasCtx.lineWidth = 1;
    const gridSize = 60;
    for (let x = 0; x < canvasElement.width; x += gridSize) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x, canvasElement.height);
      canvasCtx.stroke();
    }
    for (let y = 0; y < canvasElement.height; y += gridSize) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, y);
      canvasCtx.lineTo(canvasElement.width, y);
      canvasCtx.stroke();
    }
  }

  // Draw arcade scanlines or subtle vignette tint
  canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

  // 2. Process physical items logic
  if (gameState === 'playing') {
    // If not in DevMode, update elements on camera tick
    if (!devMode) {
      updateGameElements();
      checkCollisions();
    }

    // Draw falling items
    items.forEach(item => {
      canvasCtx.save();
      // Glowing Drop Shadow
      canvasCtx.shadowBlur = 18;
      canvasCtx.shadowColor = item.glow;
      
      // Outer bubble glass circle
      canvasCtx.fillStyle = item.color;
      canvasCtx.beginPath();
      canvasCtx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
      canvasCtx.fill();
      
      // Glowing Border Ring
      canvasCtx.shadowBlur = 4;
      canvasCtx.strokeStyle = item.border;
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();
      
      // Clean emoji text render
      const setEmojiSize = DIFFICULTY_SETTINGS[difficulty].emojiSize;
      //console.log(settings.emojiSize)
      canvasCtx.shadowBlur = 0;
      canvasCtx.fillStyle = '#fff';
      canvasCtx.font = setEmojiSize + 'px sans-serif'; // easy 32, med 37 hard 42 
      canvasCtx.textAlign = 'center';
      canvasCtx.textBaseline = 'middle';
      canvasCtx.fillText(item.emoji, item.x, item.y);
      canvasCtx.restore();
    });
  }

  // 3. Draw player skeleton markers (MediaPipe overlay helper)
  if (results && results.poseLandmarks) {
    // Draw body skeleton lines
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    canvasCtx.lineWidth = 2;
    
    // Draw lines between major body joints if visible
    // Connect shoulders, hips, elbows, knees, wrists, ankles
    const drawLine = (p1Idx, p2Idx) => {
      const p1 = results.poseLandmarks[p1Idx];
      const p2 = results.poseLandmarks[p2Idx];
      if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
        canvasCtx.beginPath();
        const x1 = (mirrorMode ? (1 - p1.x) : p1.x) * canvasElement.width;
        const x2 = (mirrorMode ? (1 - p2.x) : p2.x) * canvasElement.width;
        canvasCtx.moveTo(x1, p1.y * canvasElement.height);
        canvasCtx.lineTo(x2, p2.y * canvasElement.height);
        canvasCtx.stroke();
      }
    };

    // Torso
    drawLine(11, 12); // Shoulders
    drawLine(11, 23); // L Shoulder to Hip
    drawLine(12, 24); // R Shoulder to Hip
    drawLine(23, 24); // Hips

    // Arms (if hands active)
    if (limbMode === 'hands' || limbMode === 'both') {
      drawLine(11, 13); // L Shoulder to Elbow
      drawLine(13, 19); // L Elbow to Wrist
      drawLine(12, 14); // R Shoulder to Elbow
      drawLine(14, 20); // R Elbow to Wrist
    }

    // Legs (if legs active)
    if (limbMode === 'legs' || limbMode === 'both') {
      drawLine(23, 25); // L Hip to Knee
      drawLine(25, 27); // L Knee to Ankle
      drawLine(24, 26); // R Hip to Knee
      drawLine(26, 28); // R Knee to Ankle
    }
  }

  // 4. Draw active limb glowing catch indicators (wrists & ankles)
  activeLimbPoints.forEach(point => {
    canvasCtx.save();
    //canvasCtx.scale(1, -1);
    const glowColor = point.type === 'hand' ? 'var(--jade)' : 'var(--gold)';
    const ringColor = point.type === 'hand' ? '#00e676' : '#ffd600';
    
    // Outer pulse ring
    canvasCtx.shadowBlur = 20;
    canvasCtx.shadowColor = ringColor;
    
    canvasCtx.strokeStyle = ringColor;
    canvasCtx.lineWidth = 4;
    canvasCtx.beginPath();
    canvasCtx.arc(point.x, point.y, 24, 0, Math.PI * 2);
    canvasCtx.stroke();
    
    // Inner filled core
    canvasCtx.shadowBlur = 0;
    canvasCtx.fillStyle = point.type === 'hand' ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 214, 0, 0.4)';
    canvasCtx.beginPath();
    canvasCtx.arc(point.x, point.y, 12, 0, Math.PI * 2);
    canvasCtx.fill();

    // Limb tags/labels for calibration ease
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.font = 'bold 11px var(--font-display)';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(point.label, point.x, point.y - 32);
    
    canvasCtx.restore();
  });

  // 5. Render floating text (+10 / -10)
  floatingTexts.forEach(text => {
    canvasCtx.save();
    canvasCtx.fillStyle = text.color;
    canvasCtx.font = 'bold 28px var(--font-display)';
    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = text.color;
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(text.text, text.x, text.y);
    canvasCtx.restore();
  });

  // 6. Draw particles
  particles.forEach(p => {
    canvasCtx.save();
    canvasCtx.scale(-1, 1); // Mirror horizontally
    canvasCtx.globalAlpha = p.alpha;
    canvasCtx.fillStyle = p.color;
    canvasCtx.shadowBlur = 6;
    canvasCtx.shadowColor = p.color;
    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.restore();
  });

  // 7. Developer mode instructions label on Canvas
  if (devMode && gameState === 'playing') {
    canvasCtx.save();
    canvasCtx.fillStyle = 'rgba(0,0,0,0.6)';
    canvasCtx.fillRect(10, canvasElement.height - 40, canvasElement.width - 20, 30);
    canvasCtx.fillStyle = 'var(--gold)';
    canvasCtx.font = '14px var(--font-body)';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText('💻 DEVELOPER TESTING MODE ACTIVE: Click inside play area to catch items.', canvasElement.width / 2, canvasElement.height - 20);
    canvasCtx.restore();
  }

  canvasCtx.restore();
}

// --- GAME END SUMMARY ---
function endGame() {
  gameState = 'gameover';
  
  if (gameInterval) clearInterval(gameInterval);

  // Play gameover fanfare sound
  playSound('fanfare');

  // Increment games played
  gamesPlayed++;
  localStorage.setItem('chinatown_catcher_games', gamesPlayed);
  document.getElementById('gamesPlayedText').innerText = gamesPlayed;

  // Set highscore
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('chinatown_catcher_highscore', highScore);
    document.getElementById('highScoreText').innerText = highScore;
  }

  // Update game over display values
  document.getElementById('finalScoreVal').innerText = score;

  // Star ratings and custom active aging cheer messages
  const starsEl = document.getElementById('starRating');
  const cheerEl = document.getElementById('cheerMsg');

  if (score >= 120) {
    starsEl.innerText = '⭐⭐⭐';
    cheerEl.innerText = '💪 Incredible work! You moved with exceptional grace and energy!';
    cheerEl.style.color = 'var(--jade)';
  } else if (score >= 60) {
    starsEl.innerText = '⭐⭐';
    cheerEl.innerText = '🏮 Fantastic effort! You are doing great at keeping active and fit!';
    cheerEl.style.color = 'var(--gold)';
  } else {
    starsEl.innerText = '⭐';
    cheerEl.innerText = '🍑 Good try! Physical movement is the key to healthy living. Let\'s try again!';
    cheerEl.style.color = 'var(--text-main)';
  }

  // Show Game Over panel overlay
  document.getElementById('gameOverOverlay').classList.remove('hidden');
  document.getElementById('gameHud').classList.add('hidden');
  
  const gameArea = document.getElementById('gameArea');
  gameArea.classList.remove('playing');
  gameArea.classList.add('calibrating');
}

function restartCalibration() {
  // Reset screen overlays
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('calibOverlay').classList.remove('hidden');

  // Return to calibrating state
  gameState = 'calibrating';
  items = [];
  particles = [];
  floatingTexts = [];
  activeLimbPoints = [];

  // Reset button state
  if (devMode) {
    enableDevModeFallback();
  } else {
    const btnStart = document.getElementById('btnStartGame');
    btnStart.setAttribute('disabled', 'true');
    btnStart.innerHTML = 'Calibrating Camera... <span class="calibration-loading"></span>';
    btnStart.style.boxShadow = '';
    btnStart.style.background = '';
  }
}

// Toggle horizontal mirror state
function toggleMirror(enable) {
  mirrorMode = enable;
  document.querySelectorAll('#btnMirrorOff, #btnMirrorOn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (enable) {
    document.getElementById('btnMirrorOn').classList.add('active');
  } else {
    document.getElementById('btnMirrorOff').classList.add('active');
  }
}

// Set active limb mode (both, hands, legs)
function setLimbMode(mode) {
  limbMode = mode;
  document.querySelectorAll('#btnLimbHands, #btnLimbLegs, #btnLimbBoth').forEach(btn => {
    btn.classList.remove('active');
  });
  if (mode === 'hands') {
    document.getElementById('btnLimbHands').classList.add('active');
  } else if (mode === 'legs') {
    document.getElementById('btnLimbLegs').classList.add('active');
  } else if (mode === 'both') {
    document.getElementById('btnLimbBoth').classList.add('active');
  }
  
  // Update calibration overlay instructions text dynamically (Bilingual EN/CN)
  const instructions = document.getElementById('calibInstructions');
  if (instructions) {
    if (mode === 'hands') {
      instructions.innerHTML = `
        1. Allow webcam access when prompted. (请允许相机使用权限)<br>
        2. Position yourself so the camera sees your arms and hands. (请确保双手在相机范围内)<br>
        3. Stretch your arms and wave to test the tracking indicators. (伸展双臂进行测试)
      `;
    } else if (mode === 'legs') {
      instructions.innerHTML = `
        1. Allow webcam access when prompted. (请允许相机使用权限)<br>
        2. Take a step back so the camera sees your legs and feet. (请向后退，确保双腿在相机范围内)<br>
        3. Lift your knees or ankles to test the tracking indicators. (抬起膝盖或脚踝进行测试)
      `;
    } else {
      instructions.innerHTML = `
        1. Allow webcam access when prompted. (请允许相机使用权限)<br>
        2. Take a step back so the camera sees your hands and legs. (请确保双手和双腿都在相机范围内)<br>
        3. Stretch your arms and lift your knees to test the tracker indicators. (伸展双臂和抬起双膝进行测试)
      `;
    }
  }

  // If in calibration screen, immediately re-verify detection
  if (gameState === 'calibrating') {
    checkCalibration(latestHandsDetected, latestLegsDetected);
  }

  initAudio();
}
