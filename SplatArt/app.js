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
        'splat2_shell.sog', 
        'splat3_pm1.sog',
        'splat4_sunset.sog',
        'splat5_party.sog',
		'splat6_uro.sog'
    ],
    
    baseScale: 1.0,                
    initialRotationY: THREE.MathUtils.degToRad(-20), 

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
    vignetteDarkness: 0.4,         
    vignetteScale: 1.2,            

    // HALFTONE SETTINGS
    useHalftone: true,             
    halftoneShape: 1,              
    halftoneRadius: 4.0,           
    halftoneScatter: 0.0,          
    halftoneBlending: 0.4,         

    // Bloom Settings
    bloomStrength: 0.2,            
    bloomClickStrength: 2.5,       
    bloomRadius: 0.5,              
    bloomThreshold: 0.7,           

    // Camera & Movement Settings
    oscillationSpeed: 0.1,         
    oscillationAngle: THREE.MathUtils.degToRad(15), 
    hoverDistance: 6.0,            
    hoverSmoothness: 2.0,          
    cameraPullbackZ: 30,
    
    // --- NEW: GYROSCOPE SETTINGS ---
    gyroSensitivity: 1.2           // How dramatically the camera moves when you tilt the phone
    // -------------------------------
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

// --- 5. LOAD INITIAL RANDOM SPLAT ---
const pivot = new THREE.Group();
scene.add(pivot);
pivot.rotation.y = CONFIG.initialRotationY;

let currentSplatIndex = Math.floor(Math.random() * CONFIG.splats.length);
let activeSplat = new SplatMesh({ url: CONFIG.splats[currentSplatIndex] });

const targetScaleY = CONFIG.flipScaleY ? -CONFIG.baseScale : CONFIG.baseScale;
const finalScale = new THREE.Vector3(CONFIG.baseScale, targetScaleY, CONFIG.baseScale);

activeSplat.scale.set(0, 0, 0);

if (CONFIG.rotate180Z) {
    activeSplat.rotation.z = Math.PI; 
}

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

// Spawn Animation Trackers
let isSpawning = true;
let spawnTimer = 0;

// Gyroscope tracking flag
let gyroInitialized = false;

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
}

// --- NEW: GYROSCOPE MATH FUNCTION ---
function handleDeviceOrientation(event) {
    let gamma = event.gamma; // Left/Right tilt (-90 to 90)
    let beta = event.beta;   // Front/Back tilt (-180 to 180)

    // Bail out if the device doesn't actually have a gyroscope
    if (gamma === null || beta === null) return;

    // Clamp the raw degrees to a reasonable holding range so it doesn't spin wildly
    let clampedGamma = Math.max(-30, Math.min(30, gamma));
    
    // Normal holding position for a phone is tilted back about 45 degrees
    let clampedBeta = Math.max(15, Math.min(75, beta));

    // Map those degree ranges to our WebGL -1 to 1 screen space
    let mappedX = clampedGamma / 30;
    let mappedY = -((clampedBeta - 45) / 30);

    // Apply sensitivity and update the camera targets!
    targetMouseX = mappedX * CONFIG.gyroSensitivity;
    targetMouseY = mappedY * CONFIG.gyroSensitivity;
}
// ------------------------------------

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
    // If the gyro is active, we let it drive the camera instead of touch dragging
    if (!gyroInitialized && e.touches.length > 0) {
        const touch = e.touches[0];
        targetMouseX = (touch.clientX / window.innerWidth) * 2 - 1;
        targetMouseY = -(touch.clientY / window.innerHeight) * 2 + 1;
    }
}, { passive: true }); 

window.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
        // 1. Setup the touch impact
        const touch = e.touches[0];
        
        if (!gyroInitialized) {
            targetMouseX = (touch.clientX / window.innerWidth) * 2 - 1;
            targetMouseY = -(touch.clientY / window.innerHeight) * 2 + 1;
        }
        
        triggerClickEffects(touch.clientX, touch.clientY);

        // 2. Secretly request Gyroscope permissions on the first tap!
        if (!gyroInitialized) {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                // iOS 13+ requires explicit permission
                DeviceOrientationEvent.requestPermission()
                    .then(permissionState => {
                        if (permissionState === 'granted') {
                            window.addEventListener('deviceorientation', handleDeviceOrientation);
                            gyroInitialized = true;
                        }
                    })
                    .catch(console.error); // Fails silently if they deny it
            } else {
                // Standard Android/Desktop doesn't require explicit permission
                window.addEventListener('deviceorientation', handleDeviceOrientation);
                gyroInitialized = true;
            }
        }
    }
}, { passive: true });

// --- 7. ANIMATION LOOP ---
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1); 
    const time = clock.getElapsedTime();
	
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