import { useRef, useEffect, Suspense, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useScroll, ScrollControls, Environment, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

const lerp = THREE.MathUtils.lerp

/* ─── Blue flame cone ─── */
function Flame({ position, scale = 1, visRef }) {
  const meshRef = useRef()
  const matRef = useRef()
  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const visible = visRef.current
    meshRef.current.visible = visible
    if (!visible) return
    const t = clock.getElapsedTime()
    meshRef.current.scale.y = scale * (0.8 + Math.sin(t * 12) * 0.25)
    meshRef.current.scale.x = scale * (0.5 + Math.sin(t * 9 + 1) * 0.15)
    if (matRef.current) matRef.current.emissiveIntensity = 4 + Math.sin(t * 8) * 2
  })
  return (
    <mesh ref={meshRef} position={position} rotation={[Math.PI, 0, 0]}>
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

/* ─── Speed lines (particle sheet) ─── */
const SPEED_LINE_COUNT = 150
const SPEED_LINE_POSITIONS = (() => {
  const arr = new Float32Array(SPEED_LINE_COUNT * 3)
  for (let i = 0; i < SPEED_LINE_COUNT; i++) {
    arr[i * 3]     = (Math.random() - 0.5) * 16
    arr[i * 3 + 1] = (Math.random() - 0.5) * 9
    arr[i * 3 + 2] = (Math.random() - 0.5) * 24 - 5
  }
  return arr
})()

function SpeedLines({ visRef }) {
  const count = SPEED_LINE_COUNT
  const positions = SPEED_LINE_POSITIONS
  const geoRef  = useRef()
  const pointsRef = useRef()
  useFrame((_, delta) => {
    if (!pointsRef.current) return
    pointsRef.current.visible = visRef.current
    if (!visRef.current || !geoRef.current) return
    const pos = geoRef.current.attributes.position
    for (let i = 0; i < count; i++) {
      pos.array[i * 3 + 2] += delta * 20
      if (pos.array[i * 3 + 2] > 10) pos.array[i * 3 + 2] = -20
    }
    pos.needsUpdate = true
  })
  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#88ddff"
        size={0.05}
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

/* ─── Repulsor beam ─── */
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
    <mesh ref={ref} position={[0.25, 1.45, -1.5]} rotation={[Math.PI / 2, 0, 0]}>
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

/* ─── Scene inner (inside ScrollControls) ─── */
function SceneContent() {
  const scroll = useScroll()
  const { camera, size } = useThree()

  const standRef  = useRef()
  const flyRef    = useRef()
  const shootRef  = useRef()
  const arcLightRef = useRef()

  /* visibility refs – mutated in useFrame, no re-render needed */
  const flamesVisRef   = useRef(false)
  const speedVisRef    = useRef(false)
  const beamIntensityRef = useRef(0)

  /* flash DOM ref */
  const flashEl = useRef(null)
  useEffect(() => {
    flashEl.current = document.getElementById('flash-overlay')
  }, [])

  /* load models */
  const stand = useGLTF('/iron_man.glb')
  const fly   = useGLTF('/iron_man-flying.glb')
  const shoot = useGLTF('/iron_man_last.glb')

  /* fix material transparency on load */
  useEffect(() => {
    const fix = (model) => {
      model.scene.traverse(c => {
        if (c.isMesh && c.material) {
          if (Array.isArray(c.material)) {
            c.material = c.material.map(m => { const n = m.clone(); n.transparent = true; return n })
          } else {
            c.material = c.material.clone()
            c.material.transparent = true
          }
        }
      })
    }
    fix(stand); fix(fly); fix(shoot)
  }, [stand, fly, shoot])

  const modelScale = size.width < 640 ? 0.65 : 1

  useFrame(() => {
    const t = scroll.offset
    const fly3   = flyRef.current
    const stand3 = standRef.current
    const shoot3 = shootRef.current

    /* helper to fade all mesh materials in a group */
    const fadeGroup = (group, opacity) => {
      if (!group) return
      group.traverse(c => {
        if (c.isMesh && c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => { m.opacity = opacity })
          else c.material.opacity = opacity
        }
      })
    }

    /* ── ACT 1 (0 – 40%) – standing reveal ── */
    if (t < 0.4) {
      if (stand3) stand3.visible = true
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = false
      flamesVisRef.current = false
      speedVisRef.current  = false
      beamIntensityRef.current = 0

      if (t < 0.1) {
        const p = t / 0.1
        camera.position.set(0, 1.2, 6)
        camera.lookAt(0, 1, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(0.1, 1.5, p)
      } else if (t < 0.25) {
        const p = (t - 0.1) / 0.15
        camera.position.set(lerp(0, 1.5, p), lerp(1.2, 1.6, p), lerp(6, 3.8, p))
        camera.lookAt(0, 1.2, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(1.5, 3, p)
      } else {
        const p = (t - 0.25) / 0.15
        camera.position.set(lerp(1.5, 0.5, p), lerp(1.6, 0.8, p), lerp(3.8, 3, p))
        camera.lookAt(0, 1, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = 3
      }
    }

    /* ── TRANSITION 40-45% – cross-fade stand → fly ── */
    else if (t < 0.45) {
      const p = (t - 0.4) / 0.05
      if (stand3) { stand3.visible = true; fadeGroup(stand3, lerp(1, 0, p)) }
      if (fly3)   { fly3.visible = true;   fadeGroup(fly3,   lerp(0, 1, p)) }
      if (shoot3)   shoot3.visible = false
      camera.position.set(0, lerp(0.8, -1, p), lerp(3, 4, p))
      camera.lookAt(0, 1, 0)
      flamesVisRef.current = p > 0.3
    }

    /* ── ACT 2 (45-85%) – flight sequence ── */
    else if (t < 0.85) {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = true
      if (shoot3) shoot3.visible = false
      flamesVisRef.current = true
      beamIntensityRef.current = 0

      if (t < 0.55) {
        /* takeoff burst */
        const p = (t - 0.45) / 0.1
        camera.position.set(0, lerp(-1, 2, p), lerp(4, 6, p))
        camera.lookAt(0, 1, 0)
        if (fly3) { fly3.position.set(0, lerp(-0.5, 0, p), 0); fly3.rotation.set(0, 0, 0) }
        speedVisRef.current = false
      } else if (t < 0.7) {
        /* forward flight */
        const p = (t - 0.55) / 0.15
        camera.position.set(0, lerp(2, 1.5, p), lerp(6, 4, p))
        camera.lookAt(0, 1.5, -12 * p - 5)
        if (fly3) { fly3.position.set(0, 0, lerp(0, -15, p)); fly3.rotation.set(0, 0, 0) }
        speedVisRef.current = true
      } else if (t < 0.8) {
        /* side sweep */
        const p = (t - 0.7) / 0.1
        camera.position.set(lerp(0, -4, p), 1.5, lerp(4, 2, p))
        camera.lookAt(0, 1.5, -15)
        if (fly3) fly3.rotation.z = lerp(0, -0.35, p)
        speedVisRef.current = true
      } else {
        /* front hero lock */
        const p = (t - 0.8) / 0.05
        camera.position.set(lerp(-4, 0, p), 1.5, lerp(2, -2, p))
        if (fly3) {
          fly3.position.set(0, 0, lerp(-15, -5, p))
          fly3.rotation.set(0, lerp(Math.PI, 0, p), lerp(-0.35, 0, p))
        }
        camera.lookAt(0, 1.5, fly3 ? fly3.position.z : -5)
        speedVisRef.current = false
      }
    }

    /* ── TRANSITION 85-87% – cross-fade fly → shoot ── */
    else if (t < 0.87) {
      const p = (t - 0.85) / 0.02
      if (stand3) stand3.visible = false
      if (fly3)   { fly3.visible = true;   fadeGroup(fly3,   lerp(1, 0, p)) }
      if (shoot3) { shoot3.visible = true; fadeGroup(shoot3, lerp(0, 1, p)) }
      flamesVisRef.current = false
      speedVisRef.current  = false
      camera.position.set(lerp(0, 1, p), 1.5, lerp(-2, 2.5, p))
      camera.lookAt(0, 1.4, 0)
    }

    /* ── ACT 3 (87-100%) – repulsor blast ── */
    else {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = true
      flamesVisRef.current = false
      speedVisRef.current  = false

      if (t < 0.92) {
        const p = (t - 0.87) / 0.05
        camera.position.set(1, lerp(1.5, 1.4, p), 2.5)
        camera.lookAt(0, 1.4, 0)
        beamIntensityRef.current = lerp(0, 0.4, p)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 6, p)
      } else if (t < 0.98) {
        const p = (t - 0.92) / 0.06
        camera.position.set(0, 1.4, lerp(2.5, 0.8, p))
        camera.lookAt(0, 1.4, 0)
        beamIntensityRef.current = lerp(0.4, 0.9, p)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(6, 12, p)
      } else {
        /* final blast + shake + flash */
        const p = (t - 0.98) / 0.02
        camera.position.set(
          (Math.random() - 0.5) * 0.025,
          1.4 + (Math.random() - 0.5) * 0.025,
          0.5
        )
        camera.lookAt(0, 1.4, -3)
        beamIntensityRef.current = 1
        if (arcLightRef.current) arcLightRef.current.intensity = 15
        if (flashEl.current) {
          const fo = p < 0.5 ? p * 2 : (1 - p) * 2
          flashEl.current.style.opacity = fo
        }
      }
    }
  })

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} color="#fff4d0" />
      <directionalLight position={[-4, 2, -3]} intensity={0.35} color="#002255" />
      <pointLight ref={arcLightRef} position={[0, 1.35, 0.55]} color="#00ccff" intensity={0.5} distance={3} decay={2} />

      <fog attach="fog" args={['#00000a', 10, 50]} />

      {/* Standing model */}
      <group ref={standRef} scale={modelScale}>
        <primitive object={stand.scene} position={[0, -1, 0]} />
      </group>

      {/* Flying model + flames */}
      <group ref={flyRef} scale={modelScale} visible={false}>
        <primitive object={fly.scene} position={[0, 0, 0]} />
        <Flame position={[-0.12, -0.32, 0.12]} scale={1.3} visRef={flamesVisRef} />
        <Flame position={[ 0.12, -0.32, 0.12]} scale={1.3} visRef={flamesVisRef} />
        <Flame position={[-0.38,  0.05, 0.18]} scale={0.75} visRef={flamesVisRef} />
        <Flame position={[ 0.38,  0.05, 0.18]} scale={0.75} visRef={flamesVisRef} />
      </group>

      {/* Shooting model + repulsor beam */}
      <group ref={shootRef} scale={modelScale} visible={false}>
        <primitive object={shoot.scene} position={[0, -1, 0]} />
        <RepulsorBeam intensityRef={beamIntensityRef} />
      </group>

      {/* Speed lines */}
      <SpeedLines visRef={speedVisRef} />
    </>
  )
}

/* ─── Loading overlay ─── */
function Loader() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 30,
      background: '#000008', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 20,
      fontFamily: 'monospace',
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

/* ─── Root export ─── */
export default function IronManScene() {
  const [loaded, setLoaded] = useState(false)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>

      {/* Flash overlay – mutated directly via DOM ref for perf */}
      <div
        id="flash-overlay"
        style={{
          position: 'fixed', inset: 0,
          background: 'white', opacity: 0,
          pointerEvents: 'none', zIndex: 20,
        }}
      />

      {/* Scroll hint – only shown after load */}
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
          toneMappingExposure: 1.3,
        }}
        camera={{ fov: 50, near: 0.05, far: 300 }}
        dpr={[1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2)]}
        style={{ background: '#000008', width: '100%', height: '100%' }}
      >
        <Suspense fallback={null} onResolve={() => setLoaded(true)}>
          <ScrollControls pages={10} damping={0.18}>
            <SceneContent />
            <Preload all />
          </ScrollControls>
        </Suspense>
        <Suspense fallback={null}>
          <Environment preset="night" />
        </Suspense>
        <EffectComposer>
          <Bloom luminanceThreshold={0.12} luminanceSmoothing={0.85} intensity={1.6} mipmapBlur />
          <Vignette eskil={false} offset={0.08} darkness={0.92} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
