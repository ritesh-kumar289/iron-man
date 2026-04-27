import { useRef, useEffect, Suspense, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useScroll, ScrollControls, Environment, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

const lerp = THREE.MathUtils.lerp

/* ─────────────────────────────────────────
   City skyline – procedural buildings
───────────────────────────────────────── */
const CITY_DATA = (() => {
  /* deterministic xorshift32 so the layout is identical on every render */
  let s = 0xc0ffee0
  const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff }
  return Array.from({ length: 55 }, (_, i) => {
    const h = 0.6 + rng() * 7.0
    return {
      key : i,
      w   : 0.25 + rng() * 1.2,
      h,
      d   : 0.25 + rng() * 0.9,
      x   : (rng() - 0.5) * 28,
      z   : -6   - rng() * 24,
      ec  : rng() > 0.55 ? '#ffcc55' : rng() > 0.35 ? '#99bbff' : '#ffffff',
      ei  : 0.03 + rng() * 0.10,
    }
  })
})()

function CityBackground({ groupRef }) {
  return (
    <group ref={groupRef}>
      {/* Night sky backdrop */}
      <mesh position={[0, 10, -42]}>
        <planeGeometry args={[110, 40]} />
        <meshBasicMaterial color="#020212" transparent />
      </mesh>
      {/* Buildings */}
      {CITY_DATA.map(b => (
        <mesh key={b.key} position={[b.x, b.h / 2, b.z]}>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial
            color="#08081c"
            emissive={b.ec}
            emissiveIntensity={b.ei}
            roughness={0.9}
            transparent
          />
        </mesh>
      ))}
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -16]}>
        <planeGeometry args={[60, 55]} />
        <meshStandardMaterial color="#060618" roughness={1} transparent />
      </mesh>
      {/* Atmospheric city-glow point lights */}
      <pointLight position={[-3, 0.6, -6]}  color="#ff9922" intensity={0.7} distance={8}  decay={2} />
      <pointLight position={[ 3, 0.6, -6]}  color="#ff9922" intensity={0.7} distance={8}  decay={2} />
      <pointLight position={[ 0, 0.6, -12]} color="#4466cc" intensity={0.6} distance={10} decay={2} />
      <pointLight position={[-5, 0.6, -15]} color="#ff9922" intensity={0.4} distance={8}  decay={2} />
      <pointLight position={[ 5, 0.6, -15]} color="#ff9922" intensity={0.4} distance={8}  decay={2} />
    </group>
  )
}

/* ─────────────────────────────────────────
   Starfield (used in Scenes 2 & 3)
───────────────────────────────────────── */
const STAR_POSITIONS = (() => {
  const a = new Float32Array(2000 * 3)
  for (let i = 0; i < 2000; i++) {
    const r  = 100 + Math.random() * 80
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    a[i * 3]     = r * Math.sin(ph) * Math.cos(th)
    a[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
    a[i * 3 + 2] = r * Math.cos(ph)
  }
  return a
})()

function StarField({ visRef }) {
  const ptsRef = useRef()
  const matRef = useRef()
  useFrame(() => {
    if (!matRef.current || !ptsRef.current) return
    const target = visRef.current ? 0.85 : 0
    matRef.current.opacity = lerp(matRef.current.opacity, target, 0.05)
    ptsRef.current.visible = matRef.current.opacity > 0.01
  })
  return (
    <points ref={ptsRef} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={STAR_POSITIONS} count={2000} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color="#ddeeff"
        size={0.18}
        transparent
        opacity={0}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

/* ─────────────────────────────────────────
   Rotating planet (used in Scenes 2 & 3)
───────────────────────────────────────── */
function Planet({ groupRef }) {
  const meshRef = useRef()
  useFrame((_, dt) => {
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.07
  })
  return (
    <group ref={groupRef} visible={false}>
      {/* Planet sphere */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[2.2, 64, 64]} />
        <meshStandardMaterial
          color="#1a4888"
          emissive="#071828"
          emissiveIntensity={0.5}
          roughness={0.65}
          metalness={0.1}
        />
      </mesh>
      {/* Atmosphere glow shell */}
      <mesh>
        <sphereGeometry args={[2.38, 32, 32]} />
        <meshStandardMaterial
          color="#4477ff"
          transparent
          opacity={0.13}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
      {/* Rim light so Bloom picks up the atmosphere */}
      <pointLight color="#2255dd" intensity={5} distance={16} decay={2} />
    </group>
  )
}

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
/* How high the standing model rises during the takeoff sequence (world units) */
const TAKEOFF_Y = 2.8

function SceneContent() {
  const scroll = useScroll()
  const { camera, size } = useThree()

  const standRef    = useRef()
  const flyRef      = useRef()
  const shootRef    = useRef()
  const arcLightRef = useRef()
  /* city props */
  const carRef      = useRef()
  const towerRef    = useRef()
  /* new environment refs */
  const cityRef     = useRef()
  const starsVisRef = useRef(false)
  const planetRef   = useRef()
  const fogRef      = useRef()

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
    const city3  = cityRef.current
    const planet3 = planetRef.current

    /* ── Update fog based on scene ──
       City (t<0.42): near fog for atmosphere.
       Space (t≥0.42): push fog very far so stars & planet are always visible. */
    if (fogRef.current) {
      const spaceFactor = Math.min(1, Math.max(0, (t - 0.35) / 0.07))
      fogRef.current.near = lerp(12, 200, spaceFactor)
      fogRef.current.far  = lerp(55, 800, spaceFactor)
    }

    /* ════════════════════════════════════
       ACT 1  (0 → 0.35)
       Standing model + Koenigsegg car + Avengers Tower + City skyline.
       Camera: wide establishing zoom-out → zoom to face → orbital sweep → behind.
    ════════════════════════════════════ */
    if (t < 0.35) {
      if (stand3) stand3.visible = true
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = false
      if (car3)   car3.visible   = true
      if (tower3) tower3.visible = true
      if (city3)  city3.visible  = true
      starsVisRef.current = false
      if (planet3) planet3.visible = false
      flamesVisRef.current = false

      /* ── 0-5%: wide establishing shot – full city skyline reveal ── */
      if (t < 0.05) {
        const p = t / 0.05
        /* Start far back so the whole city+Iron Man composition is visible,
           then slowly drift forward (zoom-in feel) */
        camera.position.set(
          lerp(3.5,  2.0, p),
          lerp(3.8,  1.6, p),
          lerp(14.0, 7.5, p)
        )
        camera.lookAt(lerp(-0.5, -0.5, p), lerp(1.5, 0.8, p), 0)
        fadeGroup(stand3, lerp(0, 1, p))
        fadeGroup(car3,   lerp(0, 1, p))
        fadeGroup(tower3, lerp(0, 0.6, p))
        if (city3) fadeGroup(city3, lerp(0, 1, p))
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(0.1, 1.5, p)

      /* ── 5-7%: settle to standard shot, arc-light powers up ── */
      } else if (t < 0.07) {
        const p = (t - 0.05) / 0.02
        camera.position.set(
          lerp(2.0, 0,   p),
          lerp(1.6, 1.1, p),
          lerp(7.5, 5.5, p)
        )
        camera.lookAt(0, lerp(0.8, 1.1, p), 0)
        fadeGroup(tower3, lerp(0.6, 0.7, p))
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
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
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
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
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = 4

      /* ── 27-35%: camera sweeps behind; at ~30% Iron Man begins takeoff ── */
      } else {
        const p = (t - 0.27) / 0.08
        /* Takeoff begins at p=0.375 (t≈0.30), reaches full TAKEOFF_Y at p=1 (t=0.35) */
        const riseP  = Math.max(0, (p - 0.375) / 0.625)
        const standY = TAKEOFF_Y * riseP * riseP           // ease-in acceleration

        if (stand3) stand3.position.y = standY
        speedVisRef.current = riseP > 0.05

        /* camera tracks upward with the rising model */
        camera.position.set(
          lerp(2.5,  0,    p),
          lerp(1.4,  1.55, p) + standY * 0.65,
          lerp(0.3, -2.8,  p)
        )
        camera.lookAt(0, 1.4 + standY * 0.55, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(4, 3, p)
      }
    }

    /* ════════════════════════════════════
       TRANSITION 1 → 2  (35-42%)
       Stand model continues rising & fades out.
       Fly model fades in at the same altitude.
       City fades out. Tower fades out. Stars & planet fade in.
    ════════════════════════════════════ */
    else if (t < 0.42) {
      const p = (t - 0.35) / 0.07

      /* Stand model: continues rising and fades out */
      if (stand3) {
        stand3.visible    = true
        stand3.position.y = TAKEOFF_Y + lerp(0, 3.5, p)
        fadeGroup(stand3, lerp(1, 0, Math.min(1, p * 1.6)))
      }
      /* Fly model: fades in near the takeoff altitude, then settles */
      if (fly3) {
        fly3.visible = true
        fly3.position.set(0, lerp(TAKEOFF_Y * 0.5, 0, p), 0)
        fly3.rotation.set(0, 0, 0)
        fadeGroup(fly3, lerp(0, 1, p))
      }
      if (shoot3) shoot3.visible = false

      /* City, car & tower all fade out as we leave the city */
      if (car3)   { car3.visible   = true; fadeGroup(car3,   lerp(1, 0, p)) }
      if (tower3) { tower3.visible = true; fadeGroup(tower3, lerp(0.7, 0, p)) }
      if (city3)  { city3.visible  = true; fadeGroup(city3,  lerp(1, 0, p)) }

      /* Space environment fades in */
      starsVisRef.current = true
      if (planet3) {
        planet3.visible = true
        planet3.position.set(lerp(6, 5, p), lerp(6, 9, p), lerp(-20, -28, p))
        fadeGroup(planet3, lerp(0, 1, p))
      }

      flamesVisRef.current = false
      speedVisRef.current  = p < 0.5   // speed lines during first half of transition

      /* Camera sweeps from behind to front at elevated altitude */
      const camAngle = lerp(Math.PI, 0, p)
      const radius   = lerp(2.8, 2.0, p)
      const yOffset  = TAKEOFF_Y * lerp(0.8, 0, p)  // fade out altitude offset
      camera.position.set(
        Math.sin(camAngle) * radius * 0.55,
        lerp(1.55, 1.1, p) + yOffset,
        Math.cos(camAngle) * radius
      )
      camera.lookAt(0, lerp(1.4, 0.9, p) + yOffset * 0.5, 0)
      if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 2, p)
    }

    /* ════════════════════════════════════
       ACT 2  (42-78%)
       Flying model in space. Planet & stars visible.
       Tower/city hidden. Camera frames the planet.
    ════════════════════════════════════ */
    else if (t < 0.78) {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = true
      if (shoot3) shoot3.visible = false
      if (car3)   car3.visible   = false
      if (tower3) tower3.visible = false
      if (city3)  city3.visible  = false
      starsVisRef.current = true
      if (planet3) {
        planet3.visible = true
        planet3.position.set(5, 9, -28)
        fadeGroup(planet3, 1)
      }
      flamesVisRef.current = false

      /* Iron Man climbs from y=0 toward the planet (0 at 50%, peak at 78%) */
      const flyProgress = Math.max(0, (t - 0.50) / 0.28)
      const flyY = lerp(0, 4.8, flyProgress)

      /* ── 42-50%: close shot on suit front; fly model descends from takeoff height to 0 ── */
      if (t < 0.50) {
        speedVisRef.current = false
        const p = (t - 0.42) / 0.08
        camera.position.set(
          lerp(0.0, 0.0, p),
          lerp(2.2, 1.0, p),
          lerp(3.5, 1.3, p)
        )
        camera.lookAt(0, lerp(2.0, 0.8, p), 0)
        if (fly3) { fly3.position.set(0, lerp(TAKEOFF_Y * 0.5, 0, p), 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 2.5, p)

      /* ── 50-58%: pull back to reveal planet in background; Iron Man begins ascent ── */
      } else if (t < 0.58) {
        speedVisRef.current = true
        const p = (t - 0.50) / 0.08
        camera.position.set(
          lerp(0.0, -0.8, p),
          lerp(1.0,  3.5, p),
          lerp(1.3,  7.0, p)
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
        const camAngle  = lerp(0.1, Math.PI * 0.65, p)
        const camRadius = lerp(6.0, 5.0, p)
        camera.position.set(
          Math.sin(camAngle) * camRadius,
          lerp(3.5, flyY + 2.0, p),
          Math.cos(camAngle) * camRadius
        )
        camera.lookAt(0, lerp(flyY * 0.5, flyY, p), 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 3, p)

      /* ── 70-78%: final banking climb toward the planet ── */
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
       Dive close into the flying model, swap to shoot model.
       Planet stays visible in space background.
    ════════════════════════════════════ */
    else if (t < 0.88) {
      flamesVisRef.current = false
      speedVisRef.current  = false
      if (car3)   car3.visible   = false
      if (tower3) tower3.visible = false
      if (city3)  city3.visible  = false
      starsVisRef.current = true
      /* Planet stays put; reposition toward shooting direction over this window */
      if (planet3) {
        planet3.visible = true
        const pp = (t - 0.78) / 0.10
        planet3.position.set(
          lerp(5,  1, pp),
          lerp(9,  3.5, pp),
          lerp(-28, -20, pp)
        )
        fadeGroup(planet3, 1)
      }

      /* Phase A (78-83%): zoom into fly body */
      if (t < 0.83) {
        const p = (t - 0.78) / 0.05
        if (stand3) stand3.visible = false
        if (fly3)   { fly3.visible = true; fadeGroup(fly3, 1) }
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

      /* Phase C (85-88%): zoom out to reveal shoot model in space */
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
       Shooting model – Iron Man charging toward the planet.
       Planet is front-and-center in the shooting direction.
    ════════════════════════════════════ */
    else {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = true
      if (car3)   car3.visible   = false
      if (tower3) tower3.visible = false
      if (city3)  city3.visible  = false
      starsVisRef.current = true
      flamesVisRef.current = false
      speedVisRef.current  = false

      /* Planet is now directly ahead of Iron Man, slightly above – the target */
      if (planet3) {
        planet3.visible = true
        planet3.position.set(0, 4.0, -20)
        fadeGroup(planet3, 1)
      }

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
        const angle  = lerp(0, Math.PI * 2, p)
        const radius = lerp(2.8, 3.5, p)
        camera.position.set(
          Math.sin(angle) * radius + lerp(0.3, 0, p),
          lerp(1.4, 2.5, p),
          Math.cos(angle) * radius
        )
        camera.lookAt(0, 1.2, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(5, 8, p)

      /* ── 97-100%: straight zoom-in from the front – Iron Man + planet in frame ── */
      } else {
        const p  = (t - 0.97) / 0.03
        const ep = p * p * (3 - 2 * p)  // ease-in-out
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

      <fog ref={fogRef} attach="fog" args={['#00000a', 12, 55]} />

      {/* ── City skyline (Scene 1 only) ── */}
      <CityBackground groupRef={cityRef} />

      {/* ── Starfield (Scenes 2 & 3) ── */}
      <StarField visRef={starsVisRef} />

      {/* ── Rotating planet (Scenes 2 & 3) ── */}
      <Planet groupRef={planetRef} />

      {/* ── Standing model ──
          raw mesh ~2307 units tall → scale 0.001 → ~2.3 units */}
      <group ref={standRef} scale={modelScale}>
        <primitive object={stand.scene} scale={0.001} position={[0, 0, 0]} />
      </group>

      {/* ── Koenigsegg One:1 ──
          Sketchfab root matrix: scale≈0.143 + z-up→y-up.
          Result: ~2.4 wide, ~4.6 long in z, wheels already at y≈0, roof at y≈1.19.
          Positioned close to Iron Man's left side for a side-by-side reveal.
          Angled slightly to face the camera for a heroic side-front reveal. */}
      <group ref={carRef} position={[-1.7, 0, 0.5]} rotation={[0, -0.35, 0]} scale={modelScale}>
        <primitive object={car.scene} position={[0, 0, 0]} />
      </group>

      {/* ── Avengers Tower ──
          Sketchfab root matrix: z-up→y-up, no extra scale.
          After that transform: base at y=0, top at y≈59 (already upright – NO rotation needed).
          group scale=0.1 → tower ~5.9 units tall, ~1.5 units wide.
          Placed behind Iron Man so it looks like a distant skyscraper. */}
      <group ref={towerRef} position={[0.5, 0, -25]} scale={0.1}>
        <primitive object={tower.scene} />
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
