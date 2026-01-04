// --- Configuration ---
const TARGET_OBJECTS = [
    'bottle', 'cup', 'wine glass', 'bowl', 'backpack', 'handbag', 
    'book', 'teddy bear', 'sports ball', 'remote', 'cell phone', 
    'banana', 'apple', 'orange', 'sandwich'
];
const MIN_CONFIDENCE = 0.6;
const DETECTION_INTERVAL = 500; // ms

// --- State ---
let model = null;
let video = document.getElementById('webcam');
let canvas = document.getElementById('canvas');
let ctx = canvas ? canvas.getContext('2d') : null;
let isDetecting = false;
let foundObject = null; // The object currently "locked on"
let score = 0;
let lastSpeakTime = 0;
let animationId = null;

// --- DOM Elements ---
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');
const loadingBar = document.getElementById('loading-bar');
const permissionScreen = document.getElementById('permission-screen');
const startBtn = document.getElementById('start-btn');
const gameUI = document.getElementById('game-ui');
const scoreEl = document.getElementById('score');
const statusBadge = document.getElementById('status-badge');
const messageBox = document.getElementById('message-box');
const messageText = document.getElementById('message-text');
const actionBtn = document.getElementById('action-btn');
const installBtn = document.getElementById('install-btn');
const debugConsole = document.getElementById('debug-console');

function log(msg) {
    console.log(msg);
    if(debugConsole) {
        debugConsole.innerHTML += `<div>> ${msg}</div>`;
        debugConsole.scrollTop = debugConsole.scrollHeight;
    }
}

// --- PWA Installation Logic ---
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    log('PWA: beforeinstallprompt fired');
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    if(installBtn) {
        installBtn.classList.remove('hidden');
        log('PWA: Install button shown');
    }
});

if(installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {
            log('PWA: No deferredPrompt available');
            return;
        }
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        log(`PWA: User response: ${outcome}`);
        // We've used the prompt, and can't use it again, throw it away
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    });
}

// --- Initialization ---
async function init() {
    log('Init started');
    updateLoadingProgress(10, 'Rozgrzewam silniki AI...');
    
    try {
        // Load COCO-SSD Model
        model = await cocoSsd.load();
        log('AI Model loaded');
        updateLoadingProgress(50, 'Model AI załadowany!');
        
        // Show Permission Screen
        loadingScreen.classList.add('hidden');
        permissionScreen.classList.remove('hidden');
        log('Waiting for user start...');
        
    } catch (err) {
        log(`AI Error: ${err.message}`);
        console.error('Failed to load model', err);
        alert('Błąd ładowania AI. Spróbuj odświeżyć stronę.');
    }
}

// Start Button Handler
startBtn.addEventListener('click', async () => {
    log('Start button clicked');
    // Call getUserMedia IMMEDIATELY to preserve user gesture
    // We do this before any await or UI updates
    
    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        log('API Error: navigator.mediaDevices.getUserMedia not available');
        alert('Twoja przeglądarka nie obsługuje kamery (lub brak HTTPS).');
        return;
    }

    try {
        // Try to get stream immediately
        log('Requesting camera stream...');
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: 'environment' }
            });
        } catch (e) {
            log(`Rear camera failed: ${e.name} - ${e.message}. Trying fallback...`);
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
            } catch (e2) {
                log(`Fallback camera failed: ${e2.name} - ${e2.message}`);
                throw e2;
            }
        }
        
        if (!stream) {
            throw new Error('Stream is null or undefined');
        }

        log(`Stream acquired! ID: ${stream.id}`);
        video.srcObject = stream;
        
        // Now update UI
        permissionScreen.classList.add('hidden');
        loadingScreen.classList.remove('hidden');
        updateLoadingProgress(60, 'Łączę z kamerą...');
        
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play().then(() => {
                    resizeCanvas();
                    log('Video playing');
                    resolve();
                }).catch(e => {
                    log(`Play error: ${e.message}`);
                    showDebugError(`Play error: ${e.message}`);
                });
            };
        });
        
        updateLoadingProgress(100, 'Gotowe!');
        
        setTimeout(() => {
            loadingScreen.classList.add('opacity-0');
            setTimeout(() => {
                loadingScreen.classList.add('hidden');
                startGame();
            }, 500);
        }, 500);
        
    } catch (err) {
        log(`Camera Error: ${err.name} - ${err.message}`);
        console.error('Camera error', err);
        let msg = `Błąd kamery: ${err.name}.`;
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            msg += ' (Brak HTTPS?)';
        }
        alert(msg);
        permissionScreen.classList.remove('hidden');
    }
});

// Remove old setupCamera function as we integrated it into click handler
// function setupCamera() { ... } 


function showDebugError(msg) {
    // Optional: display error on screen for mobile debugging
    const errDiv = document.createElement('div');
    errDiv.style.position = 'fixed';
    errDiv.style.bottom = '0';
    errDiv.style.left = '0';
    errDiv.style.width = '100%';
    errDiv.style.backgroundColor = 'rgba(255,0,0,0.8)';
    errDiv.style.color = 'white';
    errDiv.style.padding = '10px';
    errDiv.style.zIndex = '9999';
    errDiv.style.fontSize = '12px';
    errDiv.innerText = msg;
    document.body.appendChild(errDiv);
    setTimeout(() => errDiv.remove(), 10000);
}

function resizeCanvas() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}

window.addEventListener('resize', () => {
    if(video) resizeCanvas();
});

// --- Game Logic ---
function startGame() {
    gameUI.classList.remove('hidden');
    isDetecting = true;
    speak("Cześć! Poszukajmy bałaganu do posprzątania. Rozejrzyj się!");
    detectLoop();
}

async function detectLoop() {
    if (!isDetecting) return;

    // Detect objects
    const predictions = await model.detect(video);
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Filter interesting objects
    const relevantPredictions = predictions.filter(p => 
        TARGET_OBJECTS.includes(p.class) && p.score > MIN_CONFIDENCE
    );

    if (relevantPredictions.length > 0) {
        // Just pick the most confident one to avoid chaos
        const target = relevantPredictions[0];
        handleDetection(target);
    } else {
        resetDetectionState();
    }

    // Loop
    // Throttle to save battery (aim for ~2 FPS for detection, but keep UI fluid if we had other animations)
    // Since we are waiting for detection, we can just use setTimeout
    setTimeout(() => {
        requestAnimationFrame(detectLoop);
    }, DETECTION_INTERVAL);
}

let detectionStabilizer = 0; // To prevent flickering
const STABILIZATION_THRESHOLD = 5; // Frames

function handleDetection(prediction) {
    // Draw Bounding Box
    const [x, y, width, height] = prediction.bbox;
    
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 10);
    ctx.stroke();

    ctx.fillStyle = '#00FF00';
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, y - 30, width, 30);
    ctx.globalAlpha = 1.0;
    
    ctx.fillStyle = '#000000';
    ctx.font = '18px Fredoka';
    ctx.fillText(translateClass(prediction.class) + ` (${Math.round(prediction.score * 100)}%)`, x + 10, y - 8);

    // Logic to lock onto an object
    if (foundObject !== prediction.class) {
        detectionStabilizer++;
        if (detectionStabilizer > STABILIZATION_THRESHOLD) {
            foundObject = prediction.class;
            onObjectFound(prediction.class);
        }
    } else {
        detectionStabilizer = Math.min(detectionStabilizer + 1, 10);
    }
}

function resetDetectionState() {
    detectionStabilizer = Math.max(0, detectionStabilizer - 1);
    if (detectionStabilizer === 0) {
        foundObject = null;
        // Hide UI elements if nothing found for a while
        if (actionBtn.classList.contains('hidden') === false) {
             // Keep button visible for a bit? No, hide it to encourage aiming.
             // Actually, UX-wise, if they move the camera while putting it away, we shouldn't punish them immediately.
             // But let's simplify: You must look at it to click "Done".
             actionBtn.classList.add('hidden');
             messageBox.classList.remove('translate-y-0', 'opacity-100');
             messageBox.classList.add('translate-y-20', 'opacity-0');
             statusBadge.innerText = "🔍 Szukam...";
             statusBadge.classList.remove('bg-green-500', 'text-white');
             statusBadge.classList.add('bg-yellow-400', 'text-yellow-900');
        }
    }
}

function onObjectFound(className) {
    const plName = translateClass(className);
    
    // Update UI
    statusBadge.innerText = `🎯 Znaleziono: ${plName}`;
    statusBadge.classList.remove('bg-yellow-400', 'text-yellow-900');
    statusBadge.classList.add('bg-green-500', 'text-white');

    messageText.innerText = `Widzę ${plName}! Posprzątaj to!`;
    messageBox.classList.remove('translate-y-20', 'opacity-0');
    messageBox.classList.add('translate-y-0', 'opacity-100');

    actionBtn.classList.remove('hidden');

    // Audio feedback (throttle to avoid spam)
    const now = Date.now();
    if (now - lastSpeakTime > 5000) {
        speak(`O! Widzę ${plName}. Szybko, zanieś na miejsce!`);
        playPing();
        lastSpeakTime = now;
    }
}

// Action Button Logic
actionBtn.addEventListener('click', () => {
    // Reward!
    confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
    });
    
    playSuccessSound();
    
    score += 10;
    scoreEl.innerText = score;
    scoreEl.classList.add('scale-150');
    setTimeout(() => scoreEl.classList.remove('scale-150'), 200);

    speak("Super! Dobra robota! Szukamy dalej!");

    // Temporarily hide button to force finding next target or re-finding
    actionBtn.classList.add('hidden');
    messageBox.classList.add('translate-y-20', 'opacity-0');
    
    // Reset found object to force re-detection
    foundObject = null;
    detectionStabilizer = 0;
});

// --- Utilities ---

function updateLoadingProgress(percent, text) {
    loadingBar.style.width = `${percent}%`;
    if(text) loadingText.innerText = text;
}

function translateClass(className) {
    const dict = {
        'bottle': 'butelkę',
        'cup': 'kubek',
        'wine glass': 'kieliszek',
        'bowl': 'miskę',
        'backpack': 'plecak',
        'handbag': 'torebkę',
        'book': 'książkę',
        'teddy bear': 'misia',
        'sports ball': 'piłkę',
        'remote': 'pilota',
        'cell phone': 'telefon',
        'banana': 'banana',
        'apple': 'jabłko',
        'orange': 'pomarańczę',
        'sandwich': 'kanapkę',
        'laptop': 'laptopa',
        'mouse': 'myszkę',
        'keyboard': 'klawiaturę'
    };
    return dict[className] || className;
}

// --- Audio System ---
const synth = window.speechSynthesis;
let voices = [];

function populateVoices() {
    voices = synth.getVoices();
}

populateVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoices;
}

function speak(text) {
    if (synth.speaking) {
        // console.log('speechSynthesis.speaking');
        return;
    }
    const utterThis = new SpeechSynthesisUtterance(text);
    
    // Find a Polish voice
    const plVoice = voices.find(voice => voice.lang.includes('pl'));
    if (plVoice) {
        utterThis.voice = plVoice;
    }
    
    utterThis.lang = 'pl-PL';
    utterThis.pitch = 1.2; // Slightly higher pitch for kid-friendly voice
    utterThis.rate = 1.0;
    synth.speak(utterThis);
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playPing() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playSuccessSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    
    // Arpeggio
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'triangle';
        osc.frequency.value = freq;
        
        const startTime = now + (i * 0.1);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
        
        osc.start(startTime);
        osc.stop(startTime + 0.4);
    });
}

// Start Init
window.addEventListener('DOMContentLoaded', init);
