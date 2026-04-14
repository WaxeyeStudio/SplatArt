import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HalftonePass } from 'three/addons/postprocessing/HalftonePass.js'; 
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ==========================================
// --- 1. CONFIGURATION ---
// ==========================================
const CONFIG = {
    splats: [
        'splats/splat2_shell.sog', 
        'splats/splat3_pm1.sog',
        'splats/splat4_sunset.sog',
        'splats/splat5_party.sog',
        'splats/splat6_uro.sog',
		'splats/comvita1.sog',
		'splats/gallipoli2.sog',
		'splats/headsetBoy.sog',
		'splats/motat1.sog'
    ],
    
    // INTERACTION SETTINGS
    clicksToSwap: 2,               // <-- NEW: How many clicks/taps before loading a new splat

    baseScale: 1.0,                
    initialRotationY: THREE.MathUtils.degToRad(0), 

    // SPAWN SETTINGS
    spawnDuration: 1,            
    spawnDelay: 0.4,               

    // SPLAT ORIENTATION FIXES
    flipScaleY: true,              
    rotate180Z: false,             

    // DEPTH OF FIELD SETTINGS
    dofStrength: 2.0,              
    dofRadius: 0.3,                

    // SCREEN DISTORTION & BLUR SETTINGS
    maxDistortion: 0.5,            
    distortionDecay: 2.5,          

    // CLICK FLASH SETTINGS
    flashSize: 0.8,                
    flashDecay: 15.0,              
    flashColor: 0xffffff,          
    flashIntensity: 10.0,          

    // VIGNETTE SETTINGS
    vignetteDarkness: 0.5,         
    vignetteScale: 1.0,            

    // HALFTONE SETTINGS
    useHalftone: true,             
    halftoneShape: 1,              
    halftoneRadius: 4.0,           
    halftoneScatter: 0.0,          
    halftoneBlending: 0.4,         

    // Bloom Settings
    bloomStrength: 0.1,            
    bloomClickStrength: 2.5,       
    bloomRadius: 0.5,              
    bloomThreshold: 0.7,           

    // Camera & Movement Settings
    oscillationSpeed: 0.1,         
    oscillationAngle: THREE.MathUtils.degToRad(5), 
    hoverDistance: 4.0,            
    hoverSmoothness: 2.0,          
    cameraPullbackZ: 30,
    
    // GYROSCOPE SETTINGS
    gyroSensitivity: 1.2           
};
// ==========================================

// --- 2. SETUP SCENE & RENDERER ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = CONFIG.cameraPullbackZ;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; 
renderer.outputColorSpace = THREE.SRGBColorSpace; 
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- 3. CUSTOM SCREEN SHADER (RIPPLE + LENS BLUR + VIGNETTE) ---
const DistortionShader = {
    uniforms: {
        'tDiffuse': { value: null }, 
        'uCenter': { value: new THREE.Vector2(0.5, 0.5) }, 
        'uStrength': { value: 0.0 }, 
        'uTime': { value: 0.0 },
        'uAspect': { value: window.innerWidth / window.innerHeight },
        'uDofStrength': { value: CONFIG.dofStrength },
        'uDofRadius': { value: CONFIG.dofRadius },
        'uVigDarkness': { value: CONFIG.vignetteDarkness },
        'uVigScale': { value: CONFIG.vignetteScale }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uCenter;
        uniform float uStrength;
        uniform float uTime;
        uniform float uAspect;
        uniform float uDofStrength;
        uniform float uDofRadius;
        uniform float uVigDarkness;
        uniform float uVigScale;
        varying vec2 vUv;

        void main() {
            vec2 uv = vUv;

            // A. SHOCKWAVE RIPPLE
            float dist = distance(uv, uCenter);
            float ripple = sin(dist * 30.0 - uTime * 15.0) * 0.03 * uStrength;
            uv += normalize(uv - uCenter) * ripple;

            // B. RADIAL ZOOM BLUR
            vec4 color = vec4(0.0);
            float total = 0.0;
            vec2 toCenter = uCenter - uv;
            float blurAmount = uStrength * 0.15; 
            
            for (int i = 0; i < 10; i++) {
                float percent = float(i) / 10.0;
                vec2 sampleUv = uv + toCenter * percent * blurAmount;
                color += texture2D(tDiffuse, sampleUv);
                total += 1.0;
            }
            color /= total;

            // C. PERIPHERAL DEPTH OF FIELD
            vec2 aspectUv = vec2(vUv.x * uAspect, vUv.y);
            vec2 aspectCenter = vec2(0.5 * uAspect, 0.5);
            float screenDist = distance(aspectUv, aspectCenter); 
            
            float dofBlurAmount = smoothstep(uDofRadius, uDofRadius + 0.3, screenDist) * uDofStrength;
            
            if (dofBlurAmount > 0.0) {
                vec4 dofColor = vec4(0.0);
                float taps = 8.0;
                float twopi = 6.28318530718;
                
                for (float i = 0.0; i < 8.0; i++) {
                    vec2 offset = vec2(cos(i * twopi / taps), sin(i * twopi / taps)) * dofBlurAmount * 0.01;
                    offset.x /= uAspect; 
                    dofColor += texture2D(tDiffuse, uv + offset);
                }
                color = mix(color, dofColor / taps, smoothstep(0.0, 1.0, dofBlurAmount * 5.0));
            }

            // D. VIGNETTE
            float vigDist = distance(vUv, vec2(0.5, 0.5));
            float vignette = smoothstep(uVigScale, uVigScale - 0.5, vigDist * (1.0 + uVigDarkness));
            color.rgb *= vignette;

            gl_FragColor = color;
        }
    `
};

// --- 4. POST-PROCESSING PIPELINE ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 
    CONFIG.bloomStrength, 
    CONFIG.bloomRadius, 
    CONFIG.bloomThreshold
);

const halftonePass = new HalftonePass(window.innerWidth, window.innerHeight, {
    shape: CONFIG.halftoneShape,
    radius: CONFIG.halftoneRadius,
    scatter: CONFIG.halftoneScatter,
    blending: CONFIG.halftoneBlending 
});

const distortionPass = new ShaderPass(DistortionShader);

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

composer.addPass(distortionPass); 

if (CONFIG.useHalftone) {
    composer.addPass(halftonePass);
}

// --- 5. PRELOAD ALL SPLATS (OBJECT POOL) ---
const pivot = new THREE.Group();
scene.add(pivot);
pivot.rotation.y = CONFIG.initialRotationY;

// Array to hold all our preloaded 3D objects
const splatPool = [];

// Calculate final scale once based on settings
const targetScaleY = CONFIG.flipScaleY ? -CONFIG.baseScale : CONFIG.baseScale;
const finalScale = new THREE.Vector3(CONFIG.baseScale, targetScaleY, CONFIG.baseScale);

// Loop through the config and build ALL of them into memory immediately
for (let i = 0; i < CONFIG.splats.length; i++) {
    let mesh = new SplatMesh({ url: CONFIG.splats[i] });
    
    if (CONFIG.rotate180Z) {
        mesh.rotation.z = Math.PI; 
    }
    
    splatPool.push(mesh);
}

// Pick a random starting index
let currentSplatIndex = Math.floor(Math.random() * CONFIG.splats.length);

// Assign the active splat from our pool
let activeSplat = splatPool[currentSplatIndex];

// Start the first one at zero scale for the spawn-in animation
activeSplat.scale.set(0, 0, 0);
pivot.add(activeSplat);


// --- 5.5 CLICK FLASH SPHERE SETUP ---
const flashGeometry = new THREE.SphereGeometry(CONFIG.flashSize, 16, 16);
const flashMaterial = new THREE.MeshBasicMaterial({ 
    color: new THREE.Color(CONFIG.flashColor).multiplyScalar(CONFIG.flashIntensity),
    transparent: true,
    depthTest: false 
});
const clickFlash = new THREE.Mesh(flashGeometry, flashMaterial);
clickFlash.visible = false;
scene.add(clickFlash);

const raycaster = new THREE.Raycaster();
const clickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); 
const intersectPoint = new THREE.Vector3();
const zeroVector = new THREE.Vector3(0, 0, 0);

// --- 6. INTERACTION & STATE MACHINE ---
let targetMouseX = 0;
let targetMouseY = 0;
let currentDistortion = 0; 
let currentBloom = CONFIG.bloomStrength; 

let isSpawning = true;
let spawnTimer = 0;
let gyroInitialized = false;

// --- NEW: Touch active flag to override gyro ---
let isTouching = false; 

// Splat Swap Tracker
let clickCount = 0;

function loadNewSplat() {
    // 1. Remove the old splat from the screen
    pivot.remove(activeSplat);

    // 2. Pick a new random splat index
    let newIndex = Math.floor(Math.random() * CONFIG.splats.length);
    while (newIndex === currentSplatIndex && CONFIG.splats.length > 1) {
        newIndex = Math.floor(Math.random() * CONFIG.splats.length);
    }
    currentSplatIndex = newIndex;

    // 3. Grab the new preloaded splat from our pool
    activeSplat = splatPool[currentSplatIndex];

    // 4. Snap it to full size instantly and add it to the scene
    activeSplat.scale.copy(finalScale);
    pivot.add(activeSplat);
}

function triggerClickEffects(clientX, clientY) {
    const clickUvX = clientX / window.innerWidth;
    const clickUvY = 1.0 - (clientY / window.innerHeight);
    distortionPass.uniforms.uCenter.value.set(clickUvX, clickUvY);
    currentDistortion = CONFIG.maxDistortion;
    currentBloom = CONFIG.bloomClickStrength;

    raycaster.setFromCamera(new THREE.Vector2(targetMouseX, targetMouseY), camera);
    raycaster.ray.intersectPlane(clickPlane, intersectPoint);
    
    clickFlash.position.copy(intersectPoint);
    clickFlash.position.z += 2.0; 
    clickFlash.scale.set(1, 1, 1);
    clickFlash.material.opacity = 1.0;
    clickFlash.visible = true;

    // Trigger swap based on the CONFIG variable
    clickCount++;
    if (clickCount % CONFIG.clicksToSwap === 0) {
        loadNewSplat();
    }
}

// --- GYROSCOPE MATH FUNCTION ---
function handleDeviceOrientation(event) {
    // If the user's finger is on the screen, ignore the gyro completely!
    if (isTouching) return; 

    let gamma = event.gamma; 
    let beta = event.beta;   

    if (gamma === null || beta === null) return;

    let clampedGamma = Math.max(-30, Math.min(30, gamma));
    let clampedBeta = Math.max(15, Math.min(75, beta));

    let mappedX = clampedGamma / 30;
    let mappedY = -((clampedBeta - 45) / 30);

    targetMouseX = mappedX * CONFIG.gyroSensitivity;
    targetMouseY = mappedY * CONFIG.gyroSensitivity;
}

// A. Desktop Mouse Support
window.addEventListener('mousemove', (e) => {
    targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
    targetMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('mousedown', (e) => {
    if (e.button === 0) triggerClickEffects(e.clientX, e.clientY);
});

// B. Mobile Touch & Gyro Support
window.addEventListener('touchmove', (e) => {
    // We removed the `!gyroInitialized` check here so it ALWAYS registers dragging
    if (e.touches.length > 0) {
        const touch = e.touches[0];
        targetMouseX = (touch.clientX / window.innerWidth) * 2 - 1;
        targetMouseY = -(touch.clientY / window.innerHeight) * 2 + 1;
    }
}, { passive: true }); 

window.addEventListener('touchstart', (e) => {
    isTouching = true; // Tell the system a finger is down
    
    if (e.touches.length > 0) {
        const touch = e.touches[0];
        
        // Always snap the camera to the tap position instantly
        targetMouseX = (touch.clientX / window.innerWidth) * 2 - 1;
        targetMouseY = -(touch.clientY / window.innerHeight) * 2 + 1;
        
        triggerClickEffects(touch.clientX, touch.clientY);

        if (!gyroInitialized) {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission()
                    .then(permissionState => {
                        if (permissionState === 'granted') {
                            window.addEventListener('deviceorientation', handleDeviceOrientation);
                            gyroInitialized = true;
                        }
                    })
                    .catch(console.error); 
            } else {
                window.addEventListener('deviceorientation', handleDeviceOrientation);
                gyroInitialized = true;
            }
        }
    }
}, { passive: true });

// When the user lifts their finger, re-enable the gyro
window.addEventListener('touchend', () => {
    isTouching = false;
});
window.addEventListener('touchcancel', () => {
    isTouching = false;
});

// --- 7. ANIMATION LOOP ---
const timer = new THREE.Timer(); 

renderer.setAnimationLoop(() => {
    timer.update(); 

    const dt = Math.min(timer.getDelta(), 0.1); 
    const time = timer.getElapsed(); 
	
    // --- SPAWN-IN ANIMATION ---
    if (isSpawning) {
        spawnTimer += dt;
        
        if (spawnTimer > CONFIG.spawnDelay) {
            let progress = Math.min((spawnTimer - CONFIG.spawnDelay) / CONFIG.spawnDuration, 1.0);
            let ease = 1 - Math.pow(1 - progress, 3);
            
            activeSplat.scale.set(
                finalScale.x * ease,
                finalScale.y * ease,
                finalScale.z * ease
            );

            if (progress >= 1.0) isSpawning = false;
        }
    }

    // --- FORCE HALFTONE UPDATES ---
    if (CONFIG.useHalftone) {
        halftonePass.uniforms.shape.value = CONFIG.halftoneShape;
        halftonePass.uniforms.radius.value = CONFIG.halftoneRadius;
        halftonePass.uniforms.scatter.value = CONFIG.halftoneScatter;
        halftonePass.uniforms.blending.value = CONFIG.halftoneBlending;

        halftonePass.uniforms.rotateR.value = 0;
        halftonePass.uniforms.rotateG.value = 0;
        halftonePass.uniforms.rotateB.value = 0;
    }

    // --- SHRINK AND FADE CLICK SPARK ---
    if (clickFlash.visible) {
        clickFlash.scale.lerp(zeroVector, dt * CONFIG.flashDecay);
        clickFlash.material.opacity = THREE.MathUtils.lerp(clickFlash.material.opacity, 0, dt * CONFIG.flashDecay);
        
        if (clickFlash.scale.x < 0.02) clickFlash.visible = false;
    }

    distortionPass.uniforms.uTime.value = time;
    currentDistortion = THREE.MathUtils.lerp(currentDistortion, 0, dt * CONFIG.distortionDecay);
    distortionPass.uniforms.uStrength.value = currentDistortion;

    currentBloom = THREE.MathUtils.lerp(currentBloom, CONFIG.bloomStrength, dt * CONFIG.distortionDecay);
    bloomPass.strength = currentBloom;

    pivot.rotation.y = CONFIG.initialRotationY + Math.sin(time * CONFIG.oscillationSpeed) * CONFIG.oscillationAngle; 
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetMouseX * CONFIG.hoverDistance, dt * CONFIG.hoverSmoothness);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetMouseY * CONFIG.hoverDistance, dt * CONFIG.hoverSmoothness);
    camera.lookAt(0, 0, 0);

    composer.render();
});

// --- 8. RESIZE LOGIC ---
window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    
    if (CONFIG.useHalftone) halftonePass.setSize(window.innerWidth, window.innerHeight);
    
    distortionPass.uniforms.uAspect.value = aspect;
});