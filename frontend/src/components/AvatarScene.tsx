"use client";

import { useRef, useMemo, useEffect, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { Environment, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const FACECAP_PATH = '/avatar/facecap.glb';
const HEAD_PATH = '/avatar/head.glb';
const COLOR_MAP = '/avatar/Map-COL.jpg';
const NORMAL_MAP = '/avatar/normal.jpg';

// ARKit morph target names (as found in facecap.glb)
const ARKIT = {
    browInnerUp: 'browInnerUp',
    browDownL: 'browDown_L',
    browDownR: 'browDown_R',
    eyeBlinkL: 'eyeBlink_L',
    eyeBlinkR: 'eyeBlink_R',
    eyeSquintL: 'eyeSquint_L',
    eyeSquintR: 'eyeSquint_R',
    eyeLookUpL: 'eyeLookUp_L',
    eyeLookUpR: 'eyeLookUp_R',
    jawOpen: 'jawOpen',
    mouthClose: 'mouthClose',
    mouthFunnel: 'mouthFunnel',
    mouthPucker: 'mouthPucker',
    mouthLeft: 'mouthLeft',
    mouthRight: 'mouthRight',
    mouthSmileL: 'mouthSmile_L',
    mouthSmileR: 'mouthSmile_R',
    mouthFrownL: 'mouthFrown_L',
    mouthFrownR: 'mouthFrown_R',
    mouthDimpleL: 'mouthDimple_L',
    mouthDimpleR: 'mouthDimple_R',
    mouthShrugUpper: 'mouthShrugUpper',
    mouthShrugLower: 'mouthShrugLower',
    mouthOpen: 'mouthOpen',
    viseme_aa: 'viseme_aa',
    viseme_O: 'viseme_O',
    viseme_E: 'viseme_E',
    viseme_I: 'viseme_I',
    viseme_U: 'viseme_U',
    viseme_FF: 'viseme_FF',
    viseme_TH: 'viseme_TH',
    viseme_SS: 'viseme_SS',
    viseme_PP: 'viseme_PP',
    viseme_CH: 'viseme_CH',
    viseme_kk: 'viseme_kk',
    viseme_nn: 'viseme_nn',
    viseme_RR: 'viseme_RR',
    viseme_DD: 'viseme_DD',
    viseme_sil: 'viseme_sil',
};

// Helper: set/get morph targets
function setMorph(mesh: THREE.Mesh, name: string, value: number) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const idx = mesh.morphTargetDictionary[name];
    if (idx !== undefined) mesh.morphTargetInfluences[idx] = value;
}

function lerpMorph(mesh: THREE.Mesh, name: string, target: number, factor: number) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const idx = mesh.morphTargetDictionary[name];
    if (idx !== undefined) {
        mesh.morphTargetInfluences[idx] = THREE.MathUtils.lerp(
            mesh.morphTargetInfluences[idx], target, factor
        );
    }
}

// ─── Custom GLTF Loader with KTX2 + meshopt ──────────────────────────────
function useFacecapModel() {
    const { gl } = useThree();
    const [model, setModel] = useState<THREE.Group | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        const loader = new GLTFLoader();

        // Meshopt decoder
        loader.setMeshoptDecoder(MeshoptDecoder);

        // KTX2 loader
        const ktx2Loader = new KTX2Loader();
        ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.183.2/examples/jsm/libs/basis/');
        ktx2Loader.detectSupport(gl);
        loader.setKTX2Loader(ktx2Loader);

        loader.load(
            FACECAP_PATH,
            (gltf) => {
                console.log('✅ facecap.glb loaded successfully');
                // Enhance materials
                gltf.scene.traverse((child) => {
                    if ((child as THREE.Mesh).isMesh) {
                        const mesh = child as THREE.Mesh;
                        if (mesh.material) {
                            const mat = mesh.material as THREE.MeshStandardMaterial;
                            if (mat.isMeshStandardMaterial) {
                                mat.envMapIntensity = 0.8;
                                mat.roughness = Math.max(mat.roughness, 0.3);
                                mat.needsUpdate = true;
                            }
                        }
                        if (mesh.morphTargetDictionary) {
                            console.log('🎭 Morph targets:', Object.keys(mesh.morphTargetDictionary));
                        }
                    }
                });
                setModel(gltf.scene);
            },
            undefined,
            (err) => {
                console.error('❌ Failed to load facecap.glb:', err);
                setError(true);
            }
        );

        return () => {
            ktx2Loader.dispose();
        };
    }, [gl]);

    return { model, error };
}

// ─── FaceCap Avatar ─────────────────────────────────────────────────────────
function FaceCapAvatar({
    analyserRef,
    isSpeaking,
    isThinking,
}: {
    analyserRef: React.MutableRefObject<AnalyserNode | null>;
    isSpeaking: boolean;
    isThinking: boolean;
}) {
    const { model, error } = useFacecapModel();
    const groupRef = useRef<THREE.Group>(null);
    const meshesRef = useRef<THREE.Mesh[]>([]);
    const dataArray = useMemo(() => new Uint8Array(256), []);
    const timeRef = useRef(0);
    const blinkTimerRef = useRef(0);
    const nextBlinkRef = useRef(2 + Math.random() * 4);
    const smoothJawRef = useRef(0);
    const smoothVolumeRef = useRef(0);

    // Collect morph target meshes
    useEffect(() => {
        if (!model) return;
        const meshes: THREE.Mesh[] = [];
        model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
                    meshes.push(mesh);
                }
            }
        });
        meshesRef.current = meshes;
        console.log(`🎭 Found ${meshes.length} morph meshes`);
    }, [model]);

    useFrame((_, delta) => {
        if (!groupRef.current || !model) return;
        timeRef.current += delta;
        const t = timeRef.current;
        const meshes = meshesRef.current;

        // ── Idle breathing / subtle head motion ──
        groupRef.current.rotation.y = Math.sin(t * 0.3) * 0.04;
        groupRef.current.rotation.x = Math.sin(t * 0.22) * 0.02;
        groupRef.current.position.y = Math.sin(t * 0.8) * 0.006;

        // ── Natural blinking ──
        blinkTimerRef.current += delta;
        let blinkVal = 0;
        if (blinkTimerRef.current >= nextBlinkRef.current) {
            const p = blinkTimerRef.current - nextBlinkRef.current;
            if (p < 0.07) blinkVal = p / 0.07;
            else if (p < 0.12) blinkVal = 1;
            else if (p < 0.2) blinkVal = 1 - (p - 0.12) / 0.08;
            else {
                blinkTimerRef.current = 0;
                nextBlinkRef.current = 2 + Math.random() * 5;
            }
        }

        // ── Audio analysis ──
        let volume = 0;
        let midVol = 0;
        let highVol = 0;

        if (isSpeaking && analyserRef.current) {
            try {
                analyserRef.current.getByteFrequencyData(dataArray);
                let lowSum = 0;
                for (let i = 1; i < 8; i++) lowSum += dataArray[i];
                let midSum = 0;
                for (let i = 8; i < 24; i++) midSum += dataArray[i];
                let highSum = 0;
                for (let i = 24; i < 48; i++) highSum += dataArray[i];

                volume = lowSum / 7 / 255;
                midVol = midSum / 16 / 255;
                highVol = highSum / 24 / 255;
            } catch (e) {}
        }

        smoothVolumeRef.current = THREE.MathUtils.lerp(smoothVolumeRef.current, volume, 0.3);
        const sv = smoothVolumeRef.current;

        const targetJaw = THREE.MathUtils.clamp(volume * 1.4, 0, 0.85);
        smoothJawRef.current = THREE.MathUtils.lerp(smoothJawRef.current, targetJaw, 0.25);

        // ── Apply morphs ──
        for (const mesh of meshes) {
            // Blinking
            lerpMorph(mesh, ARKIT.eyeBlinkL, blinkVal, 0.5);
            lerpMorph(mesh, ARKIT.eyeBlinkR, blinkVal, 0.5);

            if (isSpeaking) {
                // Jaw & mouth
                lerpMorph(mesh, ARKIT.jawOpen, smoothJawRef.current, 0.3);

                // Visemes driven by frequency bands
                const aa = THREE.MathUtils.clamp(sv * 1.6, 0, 1);
                const oo = THREE.MathUtils.clamp(midVol * 1.3, 0, 1);
                const ee = THREE.MathUtils.clamp(midVol * 0.9, 0, 0.7);
                const ss = THREE.MathUtils.clamp(highVol * 2.0, 0, 0.8);

                lerpMorph(mesh, ARKIT.viseme_aa, aa * 0.6, 0.25);
                lerpMorph(mesh, ARKIT.viseme_O, oo * 0.5, 0.25);
                lerpMorph(mesh, ARKIT.viseme_E, ee * 0.4, 0.25);
                lerpMorph(mesh, ARKIT.viseme_SS, ss * 0.4, 0.25);
                lerpMorph(mesh, ARKIT.viseme_FF, THREE.MathUtils.clamp(highVol * 1.5, 0, 0.5) * 0.3, 0.2);

                // Slight smile while speaking
                lerpMorph(mesh, ARKIT.mouthSmileL, 0.15 + Math.sin(t * 2) * 0.05, 0.1);
                lerpMorph(mesh, ARKIT.mouthSmileR, 0.15 + Math.sin(t * 2.2) * 0.05, 0.1);
                lerpMorph(mesh, ARKIT.browInnerUp, 0.1 + sv * 0.2, 0.1);

                // Head nod while speaking
                groupRef.current.rotation.x += Math.sin(t * 3) * 0.02 * sv;
                groupRef.current.rotation.y += Math.sin(t * 2) * 0.015;
                groupRef.current.rotation.z = Math.sin(t * 1.8) * 0.01;
            } else if (isThinking) {
                // Concentration expression
                lerpMorph(mesh, ARKIT.jawOpen, 0, 0.15);
                lerpMorph(mesh, ARKIT.browDownL, 0.3 + Math.sin(t * 1.5) * 0.1, 0.1);
                lerpMorph(mesh, ARKIT.browDownR, 0.3 + Math.sin(t * 1.5) * 0.1, 0.1);
                lerpMorph(mesh, ARKIT.mouthPucker, 0.15, 0.1);
                lerpMorph(mesh, ARKIT.eyeSquintL, 0.2, 0.1);
                lerpMorph(mesh, ARKIT.eyeSquintR, 0.2, 0.1);
                lerpMorph(mesh, ARKIT.mouthSmileL, 0, 0.1);
                lerpMorph(mesh, ARKIT.mouthSmileR, 0, 0.1);

                // Clear visemes
                for (const v of [ARKIT.viseme_aa, ARKIT.viseme_O, ARKIT.viseme_E, ARKIT.viseme_SS, ARKIT.viseme_FF]) {
                    lerpMorph(mesh, v, 0, 0.15);
                }

                // Thinking head tilt
                groupRef.current.rotation.z = Math.sin(t * 0.8) * 0.04;
                groupRef.current.rotation.x += Math.sin(t * 0.5) * 0.02 - 0.03;
            } else {
                // Idle: gentle neutral
                lerpMorph(mesh, ARKIT.jawOpen, 0, 0.1);
                lerpMorph(mesh, ARKIT.mouthSmileL, 0.08, 0.05);
                lerpMorph(mesh, ARKIT.mouthSmileR, 0.08, 0.05);
                lerpMorph(mesh, ARKIT.browDownL, 0, 0.05);
                lerpMorph(mesh, ARKIT.browDownR, 0, 0.05);
                lerpMorph(mesh, ARKIT.mouthPucker, 0, 0.05);
                lerpMorph(mesh, ARKIT.browInnerUp, 0, 0.05);
                lerpMorph(mesh, ARKIT.eyeSquintL, 0, 0.05);
                lerpMorph(mesh, ARKIT.eyeSquintR, 0, 0.05);

                // Clear visemes
                for (const v of [ARKIT.viseme_aa, ARKIT.viseme_O, ARKIT.viseme_E, ARKIT.viseme_SS, ARKIT.viseme_FF]) {
                    lerpMorph(mesh, v, 0, 0.1);
                }
            }
        }
    });

    if (error) {
        return <HeadAvatar analyserRef={analyserRef} isSpeaking={isSpeaking} isThinking={isThinking} />;
    }

    if (!model) return null;

    return (
        <group ref={groupRef} position={[0, -0.85, 0]} scale={0.95}>
            <primitive object={model} />
        </group>
    );
}

// ─── Fallback: Head.glb Avatar (no morph targets, simpler animation) ────
function HeadAvatar({
    analyserRef,
    isSpeaking,
    isThinking,
}: {
    analyserRef: React.MutableRefObject<AnalyserNode | null>;
    isSpeaking: boolean;
    isThinking: boolean;
}) {
    const { scene } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const modelRef = useRef<THREE.Group | null>(null);
    const dataArray = useMemo(() => new Uint8Array(128), []);
    const timeRef = useRef(0);
    const smoothMouthRef = useRef(0);

    useEffect(() => {
        const loader = new GLTFLoader();
        loader.load(HEAD_PATH, (gltf) => {
            console.log('✅ head.glb loaded');
            const textureLoader = new THREE.TextureLoader();
            const colorTex = textureLoader.load(COLOR_MAP);
            const normalTex = textureLoader.load(NORMAL_MAP);
            colorTex.colorSpace = THREE.SRGBColorSpace;
            colorTex.flipY = false;

            gltf.scene.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    const mesh = child as THREE.Mesh;
                    mesh.material = new THREE.MeshStandardMaterial({
                        map: colorTex,
                        normalMap: normalTex,
                        roughness: 0.65,
                        metalness: 0.05,
                        envMapIntensity: 0.6,
                    });
                }
            });

            modelRef.current = gltf.scene as unknown as THREE.Group;
            if (groupRef.current) {
                groupRef.current.add(gltf.scene);
            }
        });
    }, []);

    useFrame((_, delta) => {
        if (!groupRef.current) return;
        timeRef.current += delta;
        const t = timeRef.current;

        // Idle sway
        groupRef.current.rotation.y = Math.sin(t * 0.3) * 0.04;
        groupRef.current.rotation.x = Math.sin(t * 0.2) * 0.02;
        groupRef.current.position.y = Math.sin(t * 0.8) * 0.005;

        let targetMouth = 0;
        if (isSpeaking && analyserRef.current) {
            try {
                analyserRef.current.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 1; i < 10; i++) sum += dataArray[i];
                targetMouth = THREE.MathUtils.clamp(sum / 9 / 255 * 1.5, 0, 1);
            } catch (e) {}
        }
        smoothMouthRef.current = THREE.MathUtils.lerp(smoothMouthRef.current, targetMouth, 0.2);

        // Animate head movement based on audio
        if (isSpeaking) {
            groupRef.current.rotation.x += smoothMouthRef.current * 0.1;
            groupRef.current.rotation.y += Math.sin(t * 2) * 0.015;
        } else if (isThinking) {
            groupRef.current.rotation.z = Math.sin(t * 0.8) * 0.03;
        }
    });

    return <group ref={groupRef} position={[0, -0.3, 0]} scale={1.0} />;
}

// ─── Glow Ring ──────────────────────────────────────────────────────────────
function GlowRing({ isSpeaking, isThinking }: { isSpeaking: boolean; isThinking: boolean }) {
    const ringRef = useRef<THREE.Mesh>(null);
    const timeRef = useRef(0);

    const ringMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#4a7aff',
        emissive: '#2255cc',
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        metalness: 0.8,
        roughness: 0.2,
    }), []);

    useFrame((_, delta) => {
        if (!ringRef.current) return;
        timeRef.current += delta;
        ringRef.current.rotation.z += delta * 0.15;

        const mat = ringRef.current.material as THREE.MeshStandardMaterial;
        if (isSpeaking) {
            mat.emissiveIntensity = 0.6 + Math.sin(timeRef.current * 4) * 0.3;
            mat.opacity = 0.25 + Math.sin(timeRef.current * 3) * 0.1;
            mat.emissive.set('#3377ff');
        } else if (isThinking) {
            mat.emissiveIntensity = 0.3 + Math.sin(timeRef.current * 2) * 0.2;
            mat.opacity = 0.15;
            mat.emissive.set('#ffaa33');
        } else {
            mat.emissiveIntensity = 0.2 + Math.sin(timeRef.current) * 0.1;
            mat.opacity = 0.1;
            mat.emissive.set('#2255cc');
        }
    });

    return (
        <mesh ref={ringRef} position={[0, -1.1, -0.5]} rotation={[Math.PI / 2, 0, 0]} material={ringMat}>
            <torusGeometry args={[1.2, 0.015, 16, 128]} />
        </mesh>
    );
}

// ─── Floating Particles ─────────────────────────────────────────────────────
function FloatingParticles({ count = 40, isSpeaking }: { count?: number; isSpeaking: boolean }) {
    const pointsRef = useRef<THREE.Points>(null);
    const timeRef = useRef(0);

    const { positions, speeds } = useMemo(() => {
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 0.8 + Math.random() * 1.5;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 3;
            positions[i * 3 + 2] = Math.sin(angle) * radius - 0.5;
            speeds[i] = 0.2 + Math.random() * 0.5;
        }
        return { positions, speeds };
    }, [count]);

    useFrame((_, delta) => {
        if (!pointsRef.current) return;
        timeRef.current += delta;
        const pos = pointsRef.current.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < count; i++) {
            pos[i * 3 + 1] += speeds[i] * delta * (isSpeaking ? 2 : 0.5);
            if (pos[i * 3 + 1] > 2) pos[i * 3 + 1] = -2;
        }
        pointsRef.current.geometry.attributes.position.needsUpdate = true;
    });

    return (
        <points ref={pointsRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    args={[positions, 3]}
                />
            </bufferGeometry>
            <pointsMaterial
                size={0.015}
                color="#6699ff"
                transparent
                opacity={0.4}
                sizeAttenuation
                depthWrite={false}
            />
        </points>
    );
}

// ─── Main Export ─────────────────────────────────────────────────────────────
interface AvatarSceneProps {
    analyserRef: React.MutableRefObject<AnalyserNode | null>;
    isSpeaking: boolean;
    isThinking: boolean;
}

export default function AvatarScene(props: AvatarSceneProps) {
    return (
        <div className="w-full h-full relative overflow-hidden" style={{ background: 'transparent' }}>
            <Canvas
                shadows
                gl={{
                    antialias: true,
                    alpha: true,
                    powerPreference: 'high-performance',
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.1,
                }}
                dpr={[1, 2]}
            >
                <PerspectiveCamera makeDefault fov={24} position={[0, 0.3, 5.5]} />
                <color attach="background" args={['#05050a']} />

                {/* Studio lighting for realistic skin */}
                <ambientLight intensity={0.4} />
                <directionalLight
                    position={[2, 3, 4]}
                    intensity={1.8}
                    color="#fff5ee"
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <directionalLight position={[-2, 1, 3]} intensity={0.6} color="#b8ccff" />
                <pointLight position={[0, 2, 2]} intensity={0.5} color="#ffffff" />
                {/* Cinematic rim lights */}
                <pointLight position={[-2, 0.5, -1]} intensity={0.8} color="#4a7aff" />
                <pointLight position={[2, 0.5, -1]} intensity={0.4} color="#7a44ff" />

                <Suspense fallback={null}>
                    <Environment preset="city" />
                    <FaceCapAvatar
                        analyserRef={props.analyserRef}
                        isSpeaking={props.isSpeaking}
                        isThinking={props.isThinking}
                    />
                </Suspense>

                <GlowRing isSpeaking={props.isSpeaking} isThinking={props.isThinking} />
                <FloatingParticles isSpeaking={props.isSpeaking} />

                <ContactShadows
                    position={[0, -1.6, 0]}
                    opacity={0.4}
                    scale={3}
                    blur={2.5}
                    far={2}
                    color="#000022"
                />
            </Canvas>
        </div>
    );
}
