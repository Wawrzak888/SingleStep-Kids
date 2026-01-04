// SingleStep Kids - Main Logic
// Senior Mobile Web Developer Edition

// --- Constants ---
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
let foundObject = null;
let score = 0;
let deferredPrompt; // PWA Install Prompt

// --- UI Elements ---
const loadingScreen = document.getElementById('loading-screen');
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
const iosHint = document.getElementById('ios-hint');
const httpsWarning = document.getElementById('https-warning');
const errorModal = document.getElementById('error-modal');
const errorText = document.getElementById('error-text');

// --- 1. Environment Verification (HTTPS) ---
function checkEnvironment() {
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isHttps = location.protocol === 'https:';

    if (!isHttps && !isLocalhost) {
        httpsWarning.classList.remove('hidden');
        console.error("HTTPS Required!");
    }
}

// --- 2. PWA Installation Logic ---
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    if (installBtn) {
        installBtn.classList.remove('hidden');
    }
    console.log("'beforeinstallprompt' event was fired.");
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again, throw it away
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    });
}

// Check for iOS to show hint
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
    return (window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone);
}

if (isIOS() && !isStandalone()) {
    if (iosHint) iosHint.classList.remove('hidden');
}

// --- 3. Camera Logic (Critical Fixes) ---
async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showError("Twoja przeglądarka nie obsługuje kamery. Sprawdź HTTPS.");
        return;
    }

    let stream = null;

    try {
        console.log("Attempting to access rear camera (exact)...");
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { 
                facingMode: { exact: "environment" } 
            }
        });
    } catch (err) {
        console.warn("Exact environment camera failed, trying loose mode...", err);
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { 
                    facingMode: "environment" 
                }
            });
        } catch (err2) {
            console.warn("Environment camera failed, trying any video...", err2);
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: true
                });
            } catch (err3) {
                console.error("All camera attempts failed", err3);
                showError(`Nie udało się uruchomić kamery: ${err3.name}. Sprawdź uprawnienia.`);
                return;
            }
        }
    }

    if (!stream) {
        showError("Strumień wideo jest pusty.");
        return;
    }

    // Attach stream to video
    video.srcObject = stream;
    
    // Wait for metadata to load to ensure dimensions
    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            console.log(`Video metadata loaded: ${video.videoWidth}x${video.videoHeight}`);
            
            // Force dimensions
            video.width = video.videoWidth;
            video.height = video.videoHeight;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            video.play()
                .then(() => {
                    console.log("Video playing successfully");
                    resolve();
                })
                .catch(e => {
                    console.error("Video play failed", e);
                    // Try playing muted if failed (sometimes autoplay policy blocks unmuted)
                    video.muted = true;
                    video.play().then(resolve).catch(e2 => {
                        showError(`Błąd odtwarzania wideo: ${e2.message}`);
                    });
                });
        };
    });
}

// --- 4. Initialization ---
async function init() {
    checkEnvironment();
    updateLoadingProgress(10);

    try {
        // Load AI Model
        model = await cocoSsd.load();
        updateLoadingProgress(50);
        console.log("AI Model loaded");

        // Show Start Screen
        loadingScreen.classList.add('hidden');
        permissionScreen.classList.remove('hidden');

    } catch (err) {
        console.error("AI Load Error", err);
        showError("Nie udało się załadować AI. Odśwież stronę.");
    }
}

// Start Button Handler
startBtn.addEventListener('click', async () => {
    // User gesture starts here
    permissionScreen.classList.add('hidden');
    loadingScreen.classList.remove('hidden');
    updateLoadingProgress(60);

    try {
        await startCamera();
        
        updateLoadingProgress(100);
        
        // Hide loader, show game
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            gameUI.classList.remove('hidden');
            startGame();
        }, 500);

    } catch (err) {
        console.error("Start Error", err);
        showError("Błąd podczas uruchamiania: " + err.message);
        permissionScreen.classList.remove('hidden');
    }
});

// --- 5. Game Logic ---
function startGame() {
    isDetecting = true;
    speak("Cześć! Poszukajmy bałaganu. Rozejrzyj się!");
    detectLoop();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (video && canvas) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
}

async function detectLoop() {
    if (!isDetecting) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const predictions = await model.detect(video);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const relevantPredictions = predictions.filter(p => 
            TARGET_OBJECTS.includes(p.class) && p.score > MIN_CONFIDENCE
        );

        if (relevantPredictions.length > 0) {
            handleDetection(relevantPredictions[0]);
        } else {
            resetDetectionState();
        }
    }

    requestAnimationFrame(detectLoop);
}

let detectionStabilizer = 0;
const STABILIZATION_THRESHOLD = 10; // Frames

function handleDetection(prediction) {
    const [x, y, width, height] = prediction.bbox;
    
    // Visuals
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#00FF00';
    ctx.font = '20px Fredoka';
    ctx.fillText(translateClass(prediction.class), x, y - 10);

    // Locking Logic
    if (foundObject !== prediction.class) {
        detectionStabilizer++;
        if (detectionStabilizer > STABILIZATION_THRESHOLD) {
            foundObject = prediction.class;
            onObjectFound(prediction.class);
        }
    } else {
        // Keep button visible
        detectionStabilizer = Math.min(detectionStabilizer + 1, 20);
    }
}

function resetDetectionState() {
    detectionStabilizer = Math.max(0, detectionStabilizer - 1);
    if (detectionStabilizer === 0 && foundObject) {
        foundObject = null;
        hideActionUI();
    }
}

function onObjectFound(className) {
    const plName = translateClass(className);
    statusBadge.innerText = `🎯 Znaleziono: ${plName}`;
    statusBadge.className = "bg-green-500 text-white px-4 py-2 rounded-full font-bold shadow-lg animate-bounce";
    
    messageText.innerText = `Brawo! To jest ${plName}. Posprzątaj to!`;
    messageBox.classList.remove('translate-y-20', 'opacity-0');
    
    actionBtn.classList.remove('hidden');
    
    speak(`Widzę ${plName}! Czy możesz to posprzątać?`);
}

function hideActionUI() {
    statusBadge.innerText = "🔍 Szukam...";
    statusBadge.className = "bg-yellow-400 text-yellow-900 px-4 py-2 rounded-full font-bold shadow-lg animate-pulse";
    
    messageBox.classList.add('translate-y-20', 'opacity-0');
    actionBtn.classList.add('hidden');
}

actionBtn.addEventListener('click', () => {
    score += 10;
    scoreEl.innerText = score;
    confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
    });
    speak("Świetnie! Masz 10 punktów!");
    hideActionUI();
    foundObject = null; // Reset current lock to allow finding it again or others
});

// --- Helpers ---
function updateLoadingProgress(percent) {
    if (loadingBar) loadingBar.style.width = `${percent}%`;
}

function showError(msg) {
    if (errorText) errorText.innerText = msg;
    if (errorModal) errorModal.classList.remove('hidden');
    console.error(msg);
}

function speak(text) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pl-PL';
        window.speechSynthesis.speak(utterance);
    }
}

function translateClass(className) {
    const dict = {
        'bottle': 'butelka', 'cup': 'kubek', 'wine glass': 'kieliszek', 
        'bowl': 'miska', 'backpack': 'plecak', 'handbag': 'torebka', 
        'book': 'książka', 'teddy bear': 'miś', 'sports ball': 'piłka', 
        'remote': 'pilot', 'cell phone': 'telefon', 'banana': 'banan', 
        'apple': 'jabłko', 'orange': 'pomarańcza', 'sandwich': 'kanapka'
    };
    return dict[className] || className;
}

// Start
init();
