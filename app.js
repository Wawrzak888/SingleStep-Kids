// SingleStep Kids - Main Logic
// Senior Mobile Web Developer Edition

// --- Constants ---
const TARGET_OBJECTS = [
    'bottle', 'cup', 'wine glass', 'bowl', 'backpack', 'handbag', 
    'book', 'teddy bear', 'sports ball', 'remote', 'cell phone', 
    'banana', 'apple', 'orange', 'sandwich'
];
const MIN_CONFIDENCE = 0.6;
const DETECTION_INTERVAL = 1500; // ms - ZWIĘKSZONO dla wydajności
const MODEL_TIMEOUT = 10000; // 10s timeout na model

// --- State ---
let model = null;
let modelLoadingPromise = null; // Promise ładowania modelu
let video = document.getElementById('webcam');
let canvas = document.getElementById('canvas');
let ctx = canvas ? canvas.getContext('2d') : null;
let isDetecting = false;
let foundObject = null;
let score = 0;
let deferredPrompt; // PWA Install Prompt

// --- UI Elements ---
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text'); // FIX: Added missing reference
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
const diagnostics = document.getElementById('diagnostics');
const diagHttps = document.getElementById('diag-https');
const diagPerm = document.getElementById('diag-perm');
const diagPwa = document.getElementById('diag-pwa');

function log(msg) {
    console.log(msg);
    if (diagnostics) {
        const line = document.createElement('div');
        line.innerText = `> ${msg}`;
        diagnostics.appendChild(line);
        diagnostics.scrollTop = diagnostics.scrollHeight;
    }
}

// --- 1. Environment Verification (HTTPS) ---
function checkEnvironment() {
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isHttps = location.protocol === 'https:';

    if (diagHttps) {
        diagHttps.innerText = `HTTPS: ${isHttps ? 'TAK ✅' : 'NIE ❌'} | Host: ${location.hostname}`;
    }

    if (!isHttps && !isLocalhost) {
        httpsWarning.classList.remove('hidden');
        log("CRITICAL: HTTPS REQUIRED!");
    }

    // Check Permissions API
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'camera' })
            .then(permissionStatus => {
                if (diagPerm) diagPerm.innerText = `Uprawnienia: ${permissionStatus.state.toUpperCase()}`;
                log(`Initial Permission State: ${permissionStatus.state}`);
                
                permissionStatus.onchange = () => {
                    if (diagPerm) diagPerm.innerText = `Uprawnienia: ${permissionStatus.state.toUpperCase()}`;
                    log(`Zmiana uprawnień: ${permissionStatus.state}`);
                };
            })
            .catch(err => {
                if (diagPerm) diagPerm.innerText = `Uprawnienia: Błąd API`;
                log(`Permissions Query Error: ${err.message}`);
            });
    } else {
        if (diagPerm) diagPerm.innerText = `Uprawnienia: API niedostępne (iOS/Old)`;
        log('Permissions API not supported');
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
    if (diagPwa) diagPwa.innerText = "PWA: Gotowe do instalacji ✅";
    log("'beforeinstallprompt' event was fired.");
});

if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            const { outcome } = await deferredPrompt.userChoice;
            log(`User response to the install prompt: ${outcome}`);
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
        log("Attempting to access rear camera (exact)...");
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { 
                facingMode: { exact: "environment" } 
            }
        });
    } catch (err) {
        log(`Exact environment camera failed: ${err.name}. Trying loose mode...`);
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { 
                    facingMode: "environment" 
                }
            });
        } catch (err2) {
            log(`Environment camera failed: ${err2.name}. Trying any video...`);
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: true
                });
            } catch (err3) {
                log(`All camera attempts failed: ${err3.name}`);
                showError(`Nie udało się uruchomić kamery: ${err3.name}. Sprawdź uprawnienia.`);
                return;
            }
        }
    }

    if (!stream) {
        showError("Strumień wideo jest pusty.");
        return;
    }

    log(`Stream acquired! ID: ${stream.id}`);

    // Attach stream to video
    video.srcObject = stream;
    
    // Wait for metadata to load to ensure dimensions
    return new Promise((resolve, reject) => {
        // Safety timeout for camera start
        const camTimeout = setTimeout(() => {
             reject(new Error("Camera start timeout (5s)"));
        }, 5000);

        video.onloadedmetadata = () => {
            clearTimeout(camTimeout);
            log(`Video metadata loaded: ${video.videoWidth}x${video.videoHeight}`);
            
            // NIE ustawiamy sztywno video.width/height, aby CSS (object-cover) działał poprawnie
            // video.width = video.videoWidth; 
            // video.height = video.videoHeight;
            
            // Canvas musi pasować do rozdzielczości wideo dla poprawnego rysowania ramek
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            video.play()
                .then(() => {
                    log("Video playing successfully");
                    resolve();
                })
                .catch(e => {
                    log(`Video play failed: ${e.message}`);
                    // Try playing muted if failed (sometimes autoplay policy blocks unmuted)
                    video.muted = true;
                    video.play().then(() => {
                         log("Video playing successfully (muted fallback)");
                         resolve();
                    }).catch(e2 => {
                        reject(new Error(`Błąd odtwarzania wideo: ${e2.message}`));
                    });
                });
        };
        
        // Handle stream errors
        video.onerror = (e) => {
             clearTimeout(camTimeout);
             reject(new Error(`Video Element Error: ${video.error ? video.error.message : 'Unknown'}`));
        };
    });
}

// --- 4. Initialization ---
async function init() {
    checkEnvironment();
    updateLoadingProgress(10);
    log("Init started...");

    // Rozpocznij ładowanie modelu w tle, ale nie czekaj na niego
    log("Starting background model loading...");
    modelLoadingPromise = loadModelWithTimeout();

    // Pokaż ekran startowy natychmiast (nie blokuj UI modelem)
    loadingScreen.classList.add('hidden');
    permissionScreen.classList.remove('hidden');
}

async function loadModelWithTimeout() {
    try {
        // Wyścig: Model vs Timeout
        const loadPromise = cocoSsd.load({ base: 'lite_mobilenet_v2' }); // Wymuś wersję lite
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), MODEL_TIMEOUT)
        );

        model = await Promise.race([loadPromise, timeoutPromise]);
        log("AI Model loaded successfully (Background)");
        if (isDetecting) {
            statusBadge.innerText = "🔍 Szukam...";
            statusBadge.classList.remove('bg-gray-400');
            statusBadge.classList.add('bg-yellow-400', 'animate-pulse');
        }
        return model;
    } catch (err) {
        log(`AI Model Load Failed: ${err.message}`);
        if (isDetecting) {
            statusBadge.innerText = "⚠️ Brak AI";
            statusBadge.className = "bg-red-500 text-white px-4 py-2 rounded-full font-bold shadow-lg";
        }
        return null;
    }
}

// Start Button Handler
startBtn.addEventListener('click', async () => {
    console.log('App started - User clicked Start');
    
    // User gesture starts here
    try {
        permissionScreen.classList.add('hidden');
        loadingScreen.classList.remove('hidden');
        
        // Safe check for loadingText
        if(loadingText) loadingText.innerText = "Uruchamiam kamerę..."; 
        updateLoadingProgress(30);

        // --- STEP 1: CAMERA ---
        log("Step 1: Starting Camera...");
        await startCamera();
        log("Step 1: Camera OK ✅");
        updateLoadingProgress(60);

        // --- STEP 2: MODEL ---
        log("Step 2: Waiting for AI Model...");
        if(loadingText) loadingText.innerText = "Budzę AI...";
        
        if (!model) {
            log("Model not ready yet, waiting...");
            // If background loading hasn't finished, await it now
            if (modelLoadingPromise) {
                model = await modelLoadingPromise;
            } else {
                 // Should not happen if init() ran, but safety net
                 model = await loadModelWithTimeout();
            }
        }
        
        if (!model) throw new Error("AI Model failed to load");
        
        console.log('Model loaded');
        log("Step 2: AI Model OK ✅");
        updateLoadingProgress(100);

        // --- STEP 3: GAME START ---
        log("Step 3: Starting Game Loop...");
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            gameUI.classList.remove('hidden');
            startGame();
        }, 500);

    } catch (err) {
        console.error("Critical Start Error:", err);
        
        // Show error on screen (Critical Requirement)
        if(loadingText) {
            loadingText.innerText = "BŁĄD: " + err.message;
            loadingText.classList.add('text-red-500', 'font-bold');
        } else {
            alert("BŁĄD KRYTYCZNY: " + err.message);
        }

        showError("Błąd startu: " + err.message);
        
        // Fallback option after delay
        setTimeout(() => {
             permissionScreen.classList.remove('hidden');
             loadingScreen.classList.add('hidden');
        }, 3000);
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
try {
    init();
} catch (e) {
    console.error("Critical Init Error:", e);
    // Fallback: remove loading screen anyway so user can try to interact or see error
    if (loadingScreen) loadingScreen.classList.add('hidden');
    if (permissionScreen) permissionScreen.classList.remove('hidden');
    showError("Błąd inicjalizacji: " + e.message);
}
