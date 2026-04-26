import { useRef, useEffect, Suspense, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useScroll, ScrollControls, Environment, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

const lerp = THREE.MathUtils.lerp

/* ─────────────────────────────────────────
   Flame cone (attached to a wrapper group)
───────────────────────────────────────── */
function Flame({ scale = 1, visRef }) {
  const meshRef = useRef()
  const matRef  = useRef()
  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const on = visRef.current
    meshRef.current.visible = on
    if (!on) return
    const t = clock.getElapsedTime()
    meshRef.current.scale.y = scale * (0.8 + Math.sin(t * 12) * 0.25)
    meshRef.current.scale.x = scale * (0.5 + Math.sin(t * 9 + 1) * 0.15)
    if (matRef.current) matRef.current.emissiveIntensity = 4 + Math.sin(t * 8) * 2
  })
  return (
    <mesh ref={meshRef} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[0.08, 0.4, 8]} />
      <meshStandardMaterial
        ref={matRef}
        emissive="#00ccff"
        emissiveIntensity={5}
        color="#001133"
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

/* ─────────────────────────────────────────
   Speed-line particles
───────────────────────────────────────── */
const SL_COUNT = 150
const SL_POS = (() => {
  const a = new Float32Array(SL_COUNT * 3)
  for (let i = 0; i < SL_COUNT; i++) {
    a[i * 3]     = (Math.random() - 0.5) * 16
    a[i * 3 + 1] = (Math.random() - 0.5) * 9
    a[i * 3 + 2] = (Math.random() - 0.5) * 24 - 5
  }
  return a
})()

function SpeedLines({ visRef }) {
  const geoRef    = useRef()
  const pointsRef = useRef()
  useFrame((_, delta) => {
    if (!pointsRef.current) return
    pointsRef.current.visible = visRef.current
    if (!visRef.current || !geoRef.current) return
    const pos = geoRef.current.attributes.position
    for (let i = 0; i < SL_COUNT; i++) {
      pos.array[i * 3 + 2] += delta * 22
      if (pos.array[i * 3 + 2] > 10) pos.array[i * 3 + 2] = -20
    }
    pos.needsUpdate = true
  })
  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" array={SL_POS} count={SL_COUNT} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#88ddff" size={0.05} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

/* ─────────────────────────────────────────
   Repulsor beam
───────────────────────────────────────── */
function RepulsorBeam({ intensityRef }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    const iv = intensityRef.current
    ref.current.visible = iv > 0.05
    if (!ref.current.visible) return
    ref.current.material.emissiveIntensity = iv * (3 + Math.sin(clock.getElapsedTime() * 20))
    const s = 0.06 + iv * 0.14
    ref.current.scale.x = s
    ref.current.scale.y = s
    ref.current.scale.z = 0.5 + iv * 3
  })
  return (
    <mesh ref={ref} position={[0.25, 1.5, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[1, 1, 5, 16]} />
      <meshStandardMaterial
        emissive="#00aaff"
        emissiveIntensity={5}
        color="#000022"
        transparent
        opacity={0.92}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

/* ─────────────────────────────────────────
   Main scene (lives inside ScrollControls)
───────────────────────────────────────── */
function SceneContent() {
  const scroll = useScroll()
  const { camera, size } = useThree()

  const standRef    = useRef()
  const flyRef      = useRef()
  const shootRef    = useRef()
  const arcLightRef = useRef()

  /* mutated each frame, never cause re-render */
  const flamesVisRef     = useRef(false)
  const speedVisRef      = useRef(false)
  const beamIntensityRef = useRef(0)

  /* (bone-tracked flame refs removed – flames not used on flying model) */

  /* flash overlay */
  const flashEl = useRef(null)
  useEffect(() => { flashEl.current = document.getElementById('flash-overlay') }, [])

  /* models */
  const stand = useGLTF('/iron_man.glb')
  const fly   = useGLTF('/iron_man-flying.glb')
  const shoot = useGLTF('/iron_man_last.glb')

  /* prepare materials + hide concrete slab in shoot model */
  useEffect(() => {
    const fix = (model) => {
      model.scene.traverse(c => {
        if (!c.isMesh || !c.material) return
        if (Array.isArray(c.material)) {
          c.material = c.material.map(m => { const n = m.clone(); n.transparent = true; return n })
        } else {
          c.material = c.material.clone()
          c.material.transparent = true
        }
      })
    }
    fix(stand); fix(fly); fix(shoot)
    shoot.scene.traverse(c => {
      if (c.name && c.name.toLowerCase().includes('concrete')) c.visible = false
    })
  }, [stand, fly, shoot])

  const modelScale = size.width < 640 ? 0.65 : 1

  /* ── helpers ── */
  const fadeGroup = (group, opacity) => {
    if (!group) return
    group.traverse(c => {
      if (!c.isMesh || !c.material) return
      if (Array.isArray(c.material)) c.material.forEach(m => { m.opacity = opacity })
      else c.material.opacity = opacity
    })
  }

  /* (tryComputeBones removed – no flames on flying model) */

  /* ══════════════════════════════════════
     MAIN FRAME LOOP
  ══════════════════════════════════════ */
  useFrame(() => {
    const t      = scroll.offset
    const stand3 = standRef.current
    const fly3   = flyRef.current
    const shoot3 = shootRef.current

    /* always reset flash so it can't stay stuck white */
    if (flashEl.current) flashEl.current.style.opacity = '0'

    /* ════════════════════════════════════
       ACT 1  (0 → 0.35)
       Standing model – power-up then orbital tour
    ════════════════════════════════════ */
    if (t < 0.35) {
      if (stand3) stand3.visible = true
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = false
      flamesVisRef.current     = false
      speedVisRef.current      = false
      beamIntensityRef.current = 0

      /* ── 0-7%: fade in + arc reactor power-up ── */
      if (t < 0.07) {
        const p = t / 0.07
        camera.position.set(0, 1.1, 5.5)
        camera.lookAt(0, 1.1, 0)
        fadeGroup(stand3, lerp(0, 1, p))
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(0.1, 2, p)

      /* ── 7-17%: zoom in close to face/chest ── */
      } else if (t < 0.17) {
        const p = (t - 0.07) / 0.10
        camera.position.set(
          lerp(0,   0.2,  p),
          lerp(1.1, 1.75, p),
          lerp(5.5, 2.0,  p)
        )
        camera.lookAt(0, lerp(1.1, 1.5, p), 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 4, p)

      /* ── 17-27%: sweep around the right side ── */
      } else if (t < 0.27) {
        const p = (t - 0.17) / 0.10
        camera.position.set(
          lerp(0.2, 2.5,  p),
          lerp(1.75, 1.4, p),
          lerp(2.0, 0.3,  p)
        )
        camera.lookAt(0, 1.4, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = 4

      /* ── 27-35%: continue behind the model ── */
      } else {
        const p = (t - 0.27) / 0.08
        camera.position.set(
          lerp(2.5,  0,    p),
          lerp(1.4,  1.55, p),
          lerp(0.3, -2.8,  p)
        )
        camera.lookAt(0, 1.4, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(4, 3, p)
      }
    }

    /* ════════════════════════════════════
       TRANSITION 1 → 2  (35-42%)
       Cross-fade stand → fly; camera sweeps from behind and lands
       very close on the chest so the fly model starts already zoomed in
    ════════════════════════════════════ */
    else if (t < 0.42) {
      const p = (t - 0.35) / 0.07
      if (stand3) { stand3.visible = true; fadeGroup(stand3, lerp(1, 0, p)) }
      if (fly3)   { fly3.visible = true;   fadeGroup(fly3,   lerp(0, 1, p)) }
      if (shoot3)   shoot3.visible = false
      flamesVisRef.current = false
      speedVisRef.current  = false
      /* sweep from behind (0,1.55,-2.8) → very close front chest (0,0.8,1.5) */
      camera.position.set(
        lerp(0,    0.2, p),
        lerp(1.55, 0.8, p),
        lerp(-2.8, 1.5, p)
      )
      camera.lookAt(0, lerp(1.4, 0.6, p), 0)
      if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 2, p)
    }

    /* ════════════════════════════════════
       ACT 2  (42-78%)
       Flying model – starts very zoomed in on body, pulls back,
       360° barrel roll, banking cinematic. No thruster flames.
    ════════════════════════════════════ */
    else if (t < 0.78) {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = true
      if (shoot3) shoot3.visible = false
      flamesVisRef.current     = false
      beamIntensityRef.current = 0

      /* ── 42-50%: start very close on body, hold close / slight zoom-in ── */
      if (t < 0.50) {
        speedVisRef.current = false
        const p = (t - 0.42) / 0.08
        camera.position.set(
          lerp(0.2,  0.0, p),
          lerp(0.8,  1.0, p),
          lerp(1.5,  1.0, p)
        )
        camera.lookAt(0, lerp(0.6, 0.8, p), 0)
        if (fly3) { fly3.position.set(0, lerp(-0.2, 0, p), 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 2.5, p)

      /* ── 50-58%: pull back – full flying model revealed + speed lines ── */
      } else if (t < 0.58) {
        speedVisRef.current = true
        const p = (t - 0.50) / 0.08
        camera.position.set(
          lerp(0.0, 0,   p),
          lerp(1.0, 2.5, p),
          lerp(1.0, 5.5, p)
        )
        camera.lookAt(0, lerp(0.8, 0.8, p), 0)
        if (fly3) { fly3.position.set(0, 0, 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2.5, 2, p)

      /* ── 58-70%: 360° barrel roll; camera orbits concurrently ── */
      } else if (t < 0.70) {
        speedVisRef.current = false
        const p = (t - 0.58) / 0.12
        if (fly3) {
          fly3.position.set(0, 0, 0)
          fly3.rotation.set(0, p * Math.PI * 2, 0)
        }
        const camAngle = lerp(0.1, Math.PI * 0.65, p)
        camera.position.set(
          Math.sin(camAngle) * lerp(5.5, 4.5, p),
          lerp(2.5, 1.8, p),
          Math.cos(camAngle) * lerp(5.5, 4.5, p)
        )
        camera.lookAt(0, 0.8, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 3, p)

      /* ── 70-78%: banking side sweep + forward flight ── */
      } else {
        speedVisRef.current = true
        const p = (t - 0.70) / 0.08
        const camAngle = lerp(Math.PI * 0.65, Math.PI * 1.0, p)
        camera.position.set(
          Math.sin(camAngle) * lerp(4.5, 3.5, p),
          lerp(1.8, 1.5, p),
          Math.cos(camAngle) * lerp(4.5, 3.5, p)
        )
        camera.lookAt(0, 0.6, 0)
        if (fly3) {
          fly3.rotation.set(
            lerp(0,    0.18, p),
            Math.PI * 2,
            lerp(0,   -0.35, p)
          )
        }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 2.5, p)
      }
    }

    /* ════════════════════════════════════
       TRANSITION 2 → 3  (78-88%)
       Zoom the camera very close into the flying model's body (hides the
       model swap), switch to fight model at the close-up, then zoom out
       to reveal the fighting model standing – no visible pop.
    ════════════════════════════════════ */
    else if (t < 0.88) {
      flamesVisRef.current = false
      speedVisRef.current  = false

      /* Phase A (78-83%): zoom into fly body */
      if (t < 0.83) {
        const p = (t - 0.78) / 0.05
        if (stand3) stand3.visible = false
        if (fly3)   { fly3.visible = true;  fadeGroup(fly3, lerp(1, 1, p)) }
        if (shoot3)   shoot3.visible = false
        const camAngle = lerp(Math.PI * 1.0, Math.PI * 1.15, p)
        camera.position.set(
          Math.sin(camAngle) * lerp(3.5, 0.7, p),
          lerp(1.5, 1.2, p),
          Math.cos(camAngle) * lerp(3.5, 0.7, p)
        )
        camera.lookAt(0, 1.1, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2.5, 4, p)

      /* Phase B (83-85%): swap – fly fades out, shoot fades in, camera still close */
      } else if (t < 0.85) {
        const p = (t - 0.83) / 0.02
        if (stand3) stand3.visible = false
        if (fly3)   { fly3.visible = true;   fadeGroup(fly3,   lerp(1, 0, p)) }
        if (shoot3) { shoot3.visible = true; fadeGroup(shoot3, lerp(0, 1, p)) }
        /* keep camera at the same close-up position */
        camera.position.set(
          Math.sin(Math.PI * 1.15) * 0.7,
          1.2,
          Math.cos(Math.PI * 1.15) * 0.7
        )
        camera.lookAt(0, 1.1, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = 4

      /* Phase C (85-88%): zoom out from fight model body */
      } else {
        const p = (t - 0.85) / 0.03
        if (stand3) stand3.visible = false
        if (fly3)     fly3.visible = false
        if (shoot3) { shoot3.visible = true; fadeGroup(shoot3, 1) }
        camera.position.set(
          lerp(Math.sin(Math.PI * 1.15) * 0.7, 0,   p),
          lerp(1.2, 1.5, p),
          lerp(Math.cos(Math.PI * 1.15) * 0.7, 5.0, p)
        )
        camera.lookAt(0, lerp(1.1, 1.3, p), 0)
        beamIntensityRef.current = 0
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(4, 3, p)
      }
    }

    /* ════════════════════════════════════
       ACT 3  (88-100%)
       Fighting model – drift in, orbit behind,
       over-shoulder repulsor blast
    ════════════════════════════════════ */
    else {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = true
      flamesVisRef.current = false
      speedVisRef.current  = false

      /* ── 88-93%: camera drifts in from front wide shot ── */
      if (t < 0.93) {
        const p = (t - 0.88) / 0.05
        camera.position.set(
          lerp(0,   0.4,  p),
          lerp(1.5, 1.5,  p),
          lerp(5.0, 2.5,  p)
        )
        camera.lookAt(0, 1.3, 0)
        beamIntensityRef.current = 0
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 5, p)

      /* ── 93-97%: parametric arc orbit front → behind ── */
      } else if (t < 0.97) {
        const p = (t - 0.93) / 0.04
        const angle  = lerp(0, Math.PI, p)
        const radius = lerp(2.5, 3.0, p)
        camera.position.set(
          Math.sin(angle) * radius + lerp(0.4, 0, p),
          lerp(1.5, 1.9, p),
          Math.cos(angle) * radius
        )
        camera.lookAt(0, 1.3, 0)
        beamIntensityRef.current = lerp(0, 0.4, p)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(5, 10, p)

      /* ── 97-99%: over-the-shoulder repulsor charging ── */
      } else if (t < 0.99) {
        const p = (t - 0.97) / 0.02
        camera.position.set(
          lerp(0,   1.8, p),
          lerp(1.9, 1.7, p),
          lerp(-3.0, 2.8, p)
        )
        camera.lookAt(0, 1.3, 0)
        beamIntensityRef.current = lerp(0.4, 0.9, p)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(10, 15, p)

      /* ── 99-100%: full blast + camera shake + white flash ── */
      } else {
        const p = (t - 0.99) / 0.01
        camera.position.set(
          1.8 + (Math.random() - 0.5) * 0.035,
          1.7 + (Math.random() - 0.5) * 0.035,
          2.8
        )
        camera.lookAt(0, 1.3, 0)
        beamIntensityRef.current = 1
        if (arcLightRef.current) arcLightRef.current.intensity = 20
        if (flashEl.current) {
          const fo = p < 0.5 ? p * 2 : (1 - p) * 2
          flashEl.current.style.opacity = String(fo)
        }
      }
    }
  })

  /* ══════════════════════════════════════
     JSX
  ══════════════════════════════════════ */
  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 8, 5]}   intensity={1.1} color="#fff4d0" />
      <directionalLight position={[-4, 2, -3]} intensity={0.35} color="#002255" />
      <pointLight
        ref={arcLightRef}
        position={[0, 1.5, 0.5]}
        color="#00ccff"
        intensity={0.5}
        distance={4}
        decay={2}
      />

      <fog attach="fog" args={['#00000a', 12, 55]} />

      {/* ── Standing model ──
          raw mesh ~2307 units tall → scale 0.001 → ~2.3 units */}
      <group ref={standRef} scale={modelScale}>
        <primitive object={stand.scene} scale={0.001} position={[0, 0, 0]} />
      </group>

      {/* ── Flying model (no attached flames) ── */}
      <group ref={flyRef} scale={modelScale} visible={false}>
        <primitive object={fly.scene} position={[0, 0, 0]} />
      </group>

      {/* ── Fighting model + repulsor beam ──
          scale 0.001 to match standing model; no rotation override
          (model is upright in its own coordinate space) */}
      <group ref={shootRef} scale={modelScale} visible={false}>
        <primitive object={shoot.scene} scale={0.001} position={[0, 0, 0]} />
        <RepulsorBeam intensityRef={beamIntensityRef} />
      </group>

      <SpeedLines visRef={speedVisRef} />
    </>
  )
}

/* ─── fires onLoaded once all Suspense siblings resolve ─── */
function OnLoaded({ onLoaded }) {
  useEffect(() => { onLoaded() }, [onLoaded])
  return null
}

/* ─── Loading screen ─── */
function Loader() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 30,
      background: '#000008',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 20, fontFamily: 'monospace',
    }}>
      <div style={{
        width: 60, height: 60, border: '2px solid #00ccff',
        borderTopColor: 'transparent', borderRadius: '50%',
        animation: 'ironspin 0.9s linear infinite',
      }} />
      <div style={{ color: 'rgba(0,200,255,0.8)', fontSize: 11, letterSpacing: 4 }}>
        LOADING
      </div>
      <style>{`@keyframes ironspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

/* ─── Root ─── */
export default function IronManScene() {
  const [loaded, setLoaded] = useState(false)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>

      {/* flash overlay – written directly from useFrame */}
      <div
        id="flash-overlay"
        style={{ position: 'fixed', inset: 0, background: 'white', opacity: 0, pointerEvents: 'none', zIndex: 20 }}
      />

      {loaded && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          color: 'rgba(0,200,255,0.7)', fontSize: 11, letterSpacing: 4,
          fontFamily: 'monospace', pointerEvents: 'none', zIndex: 15,
          animation: 'ironpulse 2s infinite',
        }}>
          SCROLL TO EXPERIENCE
          <style>{`@keyframes ironpulse{0%,100%{opacity:0.3}50%{opacity:1}}`}</style>
        </div>
      )}

      {!loaded && <Loader />}

      <Canvas
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        camera={{ fov: 50, near: 0.05, far: 300 }}
        dpr={[1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2)]}
        style={{ background: '#000008', width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <ScrollControls pages={10} damping={0.18}>
            <SceneContent />
            <Preload all />
          </ScrollControls>
          <OnLoaded onLoaded={() => setLoaded(true)} />
        </Suspense>
        <Suspense fallback={null}>
          <Environment preset="night" />
        </Suspense>
        <EffectComposer>
          {/* Reduced intensity + higher threshold to eliminate the whitish bloom haze */}
          <Bloom luminanceThreshold={0.28} luminanceSmoothing={0.9} intensity={0.9} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={0.65} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
