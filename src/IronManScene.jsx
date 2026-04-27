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
   Main scene (lives inside ScrollControls)
───────────────────────────────────────── */
function SceneContent() {
  const scroll = useScroll()
  const { camera, size } = useThree()

  const standRef    = useRef()
  const flyRef      = useRef()
  const shootRef    = useRef()
  const arcLightRef = useRef()
  /* new props */
  const carRef      = useRef()
  const towerRef    = useRef()

  const flamesVisRef = useRef(false)
  const speedVisRef  = useRef(false)

  /* models */
  const stand  = useGLTF('/iron_man.glb')
  const fly    = useGLTF('/iron_man-flying.glb')
  const shoot  = useGLTF('/iron_man_last.glb')
  /* Koenigsegg One:1 – Sketchfab root matrix already applies 1/7 scale + z→y-up rotation.
     After that transform the car is: ~2.4 wide, ~4.6 long (z), ~1.2 tall (y from -1.19..0).
     We lift it by +1.19 via primitive position so wheels sit at world y=0. */
  const car    = useGLTF('/koenigsegg/scene.gltf')
  /* Avengers Tower – Sketchfab root matrix applies z→y-up with no scale.
     After that the tower extends from y=0 (top) down to y≈-59 (base).
     We apply rotation [π,0,0] on the primitive to flip it upright (base y=0, top y≈59).
     At group scale=0.1 the tower is ~5.9 units tall and ~1.5 wide. */
  const tower  = useGLTF('/avengers_tower/scene.gltf')

  /* prepare materials – clone + enable transparency */
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
    fix(stand); fix(fly); fix(shoot); fix(car); fix(tower)
    shoot.scene.traverse(c => {
      if (c.name && c.name.toLowerCase().includes('concrete')) c.visible = false
    })
  }, [stand, fly, shoot, car, tower])

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

  /* ══════════════════════════════════════
     MAIN FRAME LOOP
  ══════════════════════════════════════ */
  useFrame(() => {
    const t      = scroll.offset
    const stand3 = standRef.current
    const fly3   = flyRef.current
    const shoot3 = shootRef.current
    const car3   = carRef.current
    const tower3 = towerRef.current

    /* ════════════════════════════════════
       ACT 1  (0 → 0.35)
       Standing model + Koenigsegg car + distant Avengers Tower.
       Camera: wide establishing shot → zoom to face → orbital sweep.
    ════════════════════════════════════ */
    if (t < 0.35) {
      if (stand3) stand3.visible = true
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = false
      if (car3)   car3.visible   = true
      if (tower3) tower3.visible = true
      flamesVisRef.current = false
      speedVisRef.current  = false

      /* ── 0-5%: wide establishing shot – Koenigsegg + Iron Man + distant tower ── */
      if (t < 0.05) {
        const p = t / 0.05
        /* camera starts slightly right & elevated for a classic reveal angle */
        camera.position.set(
          lerp(2.0, 0.5,  p),
          lerp(1.6, 1.3,  p),
          lerp(7.5, 6.0,  p)
        )
        camera.lookAt(lerp(-0.5, 0, p), lerp(0.8, 1.0, p), 0)
        fadeGroup(stand3, lerp(0, 1, p))
        fadeGroup(car3,   lerp(0, 1, p))
        fadeGroup(tower3, lerp(0, 0.6, p))
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(0.1, 1.5, p)

      /* ── 5-7%: settle to standard shot, arc-light powers up ── */
      } else if (t < 0.07) {
        const p = (t - 0.05) / 0.02
        camera.position.set(
          lerp(0.5, 0,   p),
          lerp(1.3, 1.1, p),
          lerp(6.0, 5.5, p)
        )
        camera.lookAt(0, lerp(1.0, 1.1, p), 0)
        fadeGroup(tower3, lerp(0.6, 0.7, p))
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(1.5, 2, p)

      /* ── 7-17%: zoom in close to face/chest ── */
      } else if (t < 0.17) {
        const p = (t - 0.07) / 0.10
        camera.position.set(
          lerp(0,   0.2,  p),
          lerp(1.1, 1.75, p),
          lerp(5.5, 2.0,  p)
        )
        camera.lookAt(0, lerp(1.1, 1.5, p), 0)
        fadeGroup(tower3, lerp(0.7, 0.8, p))
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 4, p)

      /* ── 17-27%: sweep around the right side (past the Koenigsegg) ── */
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
       Cross-fade stand → fly. Car fades out. Tower stays visible.
    ════════════════════════════════════ */
    else if (t < 0.42) {
      const p = (t - 0.35) / 0.07
      if (stand3) { stand3.visible = true; fadeGroup(stand3, lerp(1, 0, p)) }
      if (fly3)   { fly3.visible = true;   fadeGroup(fly3,   lerp(0, 1, p)) }
      if (shoot3)   shoot3.visible = false
      /* Koenigsegg fades out as we leave scene 1 */
      if (car3) { car3.visible = true; fadeGroup(car3, lerp(1, 0, p)) }
      if (tower3) { tower3.visible = true; fadeGroup(tower3, lerp(0.7, 1, p)) }
      flamesVisRef.current = false
      speedVisRef.current  = false
      const camAngle = lerp(Math.PI, 0, p)
      const radius   = lerp(2.8, 2.0, p)
      camera.position.set(
        Math.sin(camAngle) * radius * 0.55,
        lerp(1.55, 1.1, p),
        Math.cos(camAngle) * radius
      )
      camera.lookAt(0, lerp(1.4, 0.9, p), 0)
      if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 2, p)
    }

    /* ════════════════════════════════════
       ACT 2  (42-78%)
       Flying model rises toward the top of the Avengers Tower.
       Camera frames the tower as a dramatic backdrop throughout.
    ════════════════════════════════════ */
    else if (t < 0.78) {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = true
      if (shoot3) shoot3.visible = false
      if (car3)   car3.visible   = false
      if (tower3) tower3.visible = true
      flamesVisRef.current = false

      /* Iron Man world-y tracks how high it has climbed toward the tower top (~5.4 units) */
      const flyProgress = Math.max(0, (t - 0.50) / 0.28) // 0 at 50%, 1 at 78%
      const flyY = lerp(0, 4.8, flyProgress)

      /* ── 42-50%: close shot on suit front, rising slowly ── */
      if (t < 0.50) {
        speedVisRef.current = false
        const p = (t - 0.42) / 0.08
        camera.position.set(
          lerp(0.0,  0.0, p),
          lerp(1.1,  1.0, p),
          lerp(2.0,  1.3, p)
        )
        camera.lookAt(0, lerp(0.9, 0.8, p), 0)
        if (fly3) { fly3.position.set(0, lerp(-0.1, 0, p), 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 2.5, p)

      /* ── 50-58%: pull back to reveal tower in background; Iron Man begins ascent ── */
      } else if (t < 0.58) {
        speedVisRef.current = true
        const p = (t - 0.50) / 0.08
        /* tilt camera up to frame rising Iron Man with the tower behind */
        camera.position.set(
          lerp(0.0, -0.8, p),
          lerp(1.0, 3.5,  p),
          lerp(1.3, 7.0,  p)
        )
        camera.lookAt(0, lerp(0.8, flyY + 0.5, p), 0)
        if (fly3) { fly3.position.set(0, flyY, 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2.5, 2, p)

      /* ── 58-70%: 360° barrel roll while climbing; camera orbits high ── */
      } else if (t < 0.70) {
        speedVisRef.current = false
        const p = (t - 0.58) / 0.12
        if (fly3) {
          fly3.position.set(0, flyY, 0)
          fly3.rotation.set(0, p * Math.PI * 2, 0)
        }
        const camAngle = lerp(0.1, Math.PI * 0.65, p)
        const camRadius = lerp(6.0, 5.0, p)
        camera.position.set(
          Math.sin(camAngle) * camRadius,
          lerp(3.5, flyY + 2.0, p),
          Math.cos(camAngle) * camRadius
        )
        camera.lookAt(0, lerp(flyY * 0.5, flyY, p), 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 3, p)

      /* ── 70-78%: final banking climb toward the tower top ── */
      } else {
        speedVisRef.current = true
        const p = (t - 0.70) / 0.08
        const camAngle = lerp(Math.PI * 0.65, Math.PI * 1.0, p)
        camera.position.set(
          Math.sin(camAngle) * lerp(5.0, 4.0, p),
          lerp(flyY + 2.0, flyY + 1.2, p),
          Math.cos(camAngle) * lerp(5.0, 4.0, p)
        )
        camera.lookAt(0, lerp(flyY, flyY + 0.3, p), 0)
        if (fly3) {
          fly3.position.set(0, flyY, 0)
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
       Tower fades out as we dive close into the flying model.
    ════════════════════════════════════ */
    else if (t < 0.88) {
      flamesVisRef.current = false
      speedVisRef.current  = false
      if (car3)   car3.visible   = false
      if (tower3) { tower3.visible = true; fadeGroup(tower3, lerp(1, 0, (t - 0.78) / 0.10)) }

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

      /* Phase B (83-85%): swap – fly fades out, shoot fades in */
      } else if (t < 0.85) {
        const p = (t - 0.83) / 0.02
        if (stand3) stand3.visible = false
        if (fly3)   { fly3.visible = true;   fadeGroup(fly3,   lerp(1, 0, p)) }
        if (shoot3) { shoot3.visible = true; fadeGroup(shoot3, lerp(0, 1, p)) }
        camera.position.set(
          Math.sin(Math.PI * 1.15) * 0.7,
          1.2,
          Math.cos(Math.PI * 1.15) * 0.7
        )
        camera.lookAt(0, 1.1, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = 4

      /* Phase C (85-88%): zoom out to reveal fight model */
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
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(4, 3, p)
      }
    }

    /* ════════════════════════════════════
       ACT 3  (88-100%)
       Fighting model – slightly scaled down.
       Camera: drift in → full 360° orbit → straight zoom-in finale.
    ════════════════════════════════════ */
    else {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = true
      if (car3)   car3.visible   = false
      if (tower3) tower3.visible = false
      flamesVisRef.current = false
      speedVisRef.current  = false

      /* ── 88-93%: drift in from front wide shot ── */
      if (t < 0.93) {
        const p = (t - 0.88) / 0.05
        camera.position.set(
          lerp(0,   0.3, p),
          lerp(1.5, 1.4, p),
          lerp(5.0, 2.8, p)
        )
        camera.lookAt(0, 1.2, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 5, p)

      /* ── 93-97%: full 360° orbit with rising camera; lands at front for finale ── */
      } else if (t < 0.97) {
        const p = (t - 0.93) / 0.04
        /* Full 2π sweep brings the camera back to the front (cos(2π)=1) */
        const angle  = lerp(0, Math.PI * 2, p)
        const radius = lerp(2.8, 3.5, p)
        camera.position.set(
          Math.sin(angle) * radius + lerp(0.3, 0, p),
          lerp(1.4, 2.5, p),
          Math.cos(angle) * radius
        )
        camera.lookAt(0, 1.2, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(5, 8, p)

      /* ── 97-100%: straight zoom-in from the front toward the arc reactor ── */
      } else {
        const p = (t - 0.97) / 0.03
        /* ease-in-out so the zoom feels cinematic, not mechanical */
        const ep = p * p * (3 - 2 * p)
        camera.position.set(
          lerp(0,   0,   ep),
          lerp(2.5, 1.3, ep),
          lerp(3.5, 1.0, ep)
        )
        camera.lookAt(0, lerp(1.2, 1.2, ep), 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(8, 12, ep)
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

      {/* ── Koenigsegg One:1 ──
          Sketchfab root matrix: scale≈0.143 + z-up→y-up rotation.
          Result: ~2.4 wide, ~4.6 long in z, roof at y=0, wheels at y≈-1.19.
          Positioned to the left of Iron Man; y-offset lifts wheels to ground level.
          Angled slightly to face the camera for a heroic side-front reveal. */}
      <group ref={carRef} position={[-2.6, 0, 0.4]} rotation={[0, -0.35, 0]} scale={modelScale}>
        <primitive object={car.scene} position={[0, 1.19, 0]} />
      </group>

      {/* ── Avengers Tower ──
          Sketchfab root matrix: z-up→y-up, no extra scale → tower hangs y=0..−59.
          rotation={[π,0,0]} flips it upright: base at y=0, top at y≈59.
          group scale=0.1 → tower ~5.9 units tall, ~1.5 wide.
          Placed center-back so it's framed between Iron Man in scene 1
          and acts as the flight target for scene 2. */}
      <group ref={towerRef} position={[0.5, -0.5, -25]} scale={0.1}>
        <primitive object={tower.scene} rotation={[Math.PI, 0, 0]} />
      </group>

      {/* ── Flying model ── */}
      <group ref={flyRef} scale={modelScale} visible={false}>
        <primitive object={fly.scene} position={[0, 0, 0]} />
      </group>

      {/* ── Fighting model (slightly smaller than previous versions) ── */}
      <group ref={shootRef} scale={modelScale} visible={false}>
        <primitive object={shoot.scene} scale={0.004} position={[0, 0, 0]} />
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

/* preload all assets so Suspense resolves in one batch */
useGLTF.preload('/iron_man.glb')
useGLTF.preload('/iron_man-flying.glb')
useGLTF.preload('/iron_man_last.glb')
useGLTF.preload('/koenigsegg/scene.gltf')
useGLTF.preload('/avengers_tower/scene.gltf')

/* ─── Root ─── */
export default function IronManScene() {
  const [loaded, setLoaded] = useState(false)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>

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
