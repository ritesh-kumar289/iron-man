import { useRef, useEffect, Suspense, useState, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useScroll, ScrollControls, Environment, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import * as THREE from 'three'

const lerp = THREE.MathUtils.lerp
/* Smooth-start + smooth-stop easing (C1 continuous at 0 and 1) */
const smootherstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (t * (t * 6 - 15) + 10) }

/* ─────────────────────────────────────────
   Module-level drag state (mutated each frame / on pointer events;
   never triggers React re-renders).
   targetX / targetZ: smoothed world position for the Koenigsegg.
   Base position: x=-1.7, z=0.5 (matching the original JSX position).
───────────────────────────────────────── */
const dragState = { active: false, lastX: 0, lastY: 0, targetX: -1.7, targetZ: 0.5 }

/* ─────────────────────────────────────────
   Low-poly night city environment (Scene 1 / Act 1)
   Model bounding box (local): X(-21.7..13.6) Y(-25.8..5.3) Z(-9.1..5.7)

   Canvas fov=50° → horizontal half-FOV = ±39.6°.

   Non-uniform scale [0.3, 1.2, 0.3]:
     X world width:  35.3 × 0.3 = 10.6  → centred at x=1.2 → ±5.3 world X
     Y building tops: 5.3 × 1.2 - 1.5 pos-y = 4.86 world — tall skyline
     Z depth:        14.8 × 0.3 = 4.44 world (shallow)

   Position [1.2, -1.5, -35]:
     From the side-sweep camera (x=2.5, z=0.3 looking at 0,1.4,0) the city's
     left edge is 71° off-axis and the right edge is 88° off-axis — both well
     outside the ±39.6° half-FOV → city is invisible from the side camera.
     From front cameras the city spans only ±8° horizontally: a tight backdrop
     visible only straight behind Iron Man.

   renderOrder = 0 on all city meshes ensures characters (renderOrder = 10)
   always paint over city pixels — eliminates any see-through artefacts.
───────────────────────────────────────── */
function NightCityEnv({ groupRef }) {
  const city = useGLTF('/night_city/scene.gltf')
  useEffect(() => {
    city.scene.traverse(c => {
      if (!c.isMesh || !c.material) return
      c.renderOrder = 0   // city always draws before characters (renderOrder=10)
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      mats.forEach(m => {
        m.transparent = true   // required for fadeGroup opacity transitions
        // Boost emissive city lights so they glow under dark ambient lighting
        if (m.emissiveMap || (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0)) {
          m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 1, 2)
        }
      })
    })
  }, [city])
  return (
    <group ref={groupRef}>
      {/* Non-uniform scale: narrow X/Z footprint, tall Y — distant skyline backdrop */}
      <primitive object={city.scene} scale={[0.3, 1.2, 0.3]} position={[1.2, -1.5, -35]} />
      {/* Dark ground plane that extends from the characters to the city */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#020209" roughness={1} />
      </mesh>
    </group>
  )
}

/* ─────────────────────────────────────────
   Galaxy sky sphere (Scenes 2 & 3)
   The raw mesh is a unit sphere with an emissive galaxy panorama texture.
   Scaled up to 280 units so the camera is always inside.
───────────────────────────────────────── */
function GalaxySky({ groupRef }) {
  const galaxy = useGLTF('/galaxy.glb')
  useEffect(() => {
    galaxy.scene.traverse(c => {
      if (!c.isMesh || !c.material) return
      if (Array.isArray(c.material)) {
        c.material = c.material.map(m => {
          const n = m.clone()
          n.side = THREE.DoubleSide
          n.depthWrite = false
          n.transparent = true
          return n
        })
      } else {
        const n = c.material.clone()
        n.side = THREE.DoubleSide
        n.depthWrite = false
        n.transparent = true
        c.material = n
      }
    })
  }, [galaxy])
  return (
    <group ref={groupRef} visible={false}>
      <primitive object={galaxy.scene} scale={280} />
    </group>
  )
}

/* ─────────────────────────────────────────
   Thanos (Scene 3)
   After Sketchfab root transforms, Thanos is ~20 units tall in local space.
   At scale=0.15 → ~3 units tall (larger than Iron Man for dramatic presence).
   Placed at positive z (in front of Iron Man) so he's visible when camera
   is behind Iron Man during the 360° orbit.
───────────────────────────────────────── */
function ThanosModel({ groupRef }) {
  const thanos = useGLTF('/thanos.glb')
  useEffect(() => {
    thanos.scene.traverse(c => {
      if (!c.isMesh || !c.material) return
      if (Array.isArray(c.material)) {
        c.material = c.material.map(m => { const n = m.clone(); n.transparent = true; return n })
      } else {
        c.material = c.material.clone()
        c.material.transparent = true
      }
    })
  }, [thanos])
  return (
    <group ref={groupRef} visible={false}>
      {/* rotation Y=π so Thanos faces toward Iron Man (negative z direction) */}
      <primitive object={thanos.scene} scale={0.15} position={[0, 0, 0]} rotation={[0, Math.PI, 0]} />
    </group>
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
    <points ref={pointsRef} visible={false}>
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
  const carRef      = useRef()
  /* environment refs */
  const cityRef     = useRef()
  const galaxyRef   = useRef()
  const thanosRef   = useRef()
  const fogRef      = useRef()

  const speedVisRef = useRef(false)

  /* models */
  const stand  = useGLTF('/iron_man.glb')
  const fly    = useGLTF('/iron_man-flying.glb')
  const shoot  = useGLTF('/iron_man_last.glb')
  const car    = useGLTF('/koenigsegg/scene.gltf')

  /* prepare materials – clone + lock depth; do NOT force transparent=true by default.
     transparent is toggled dynamically by fadeGroup only when opacity < 1.
     Keeping transparent=false at full opacity puts meshes in the opaque render queue
     where GPU depth-test gives pixel-perfect results — eliminates the blur artefact. */
  useEffect(() => {
    const fix = (model) => {
      model.scene.traverse(c => {
        if (!c.isMesh || !c.material) return
        c.renderOrder = 10  // render characters after city (renderOrder=0)
        if (Array.isArray(c.material)) {
          c.material = c.material.map(m => {
            const n = m.clone()
            n.transparent = false   // opaque by default — only enabled when fading
            n.depthWrite  = true
            n.opacity     = 1
            return n
          })
        } else {
          c.material = c.material.clone()
          c.material.transparent = false
          c.material.depthWrite  = true
          c.material.opacity     = 1
        }
      })
    }
    fix(stand); fix(fly); fix(shoot); fix(car)
    shoot.scene.traverse(c => {
      if (c.name && c.name.toLowerCase().includes('concrete')) c.visible = false
    })
  }, [stand, fly, shoot, car])

  const modelScale = size.width < 640 ? 0.65 : 1

  /* ── helpers ── */
  const fadeGroup = (group, opacity) => {
    if (!group) return
    group.traverse(c => {
      if (!c.isMesh || !c.material) return
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      mats.forEach(m => {
        /* Toggle transparent only when needed — avoids unnecessary shader recompile */
        const needTrans = opacity < 0.999
        if (m.transparent !== needTrans) { m.transparent = needTrans; m.needsUpdate = true }
        m.opacity = opacity
      })
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
    const city3  = cityRef.current
    const galaxy3 = galaxyRef.current
    const thanos3 = thanosRef.current

    /* ── Dynamic fog: city haze in Act 1, deep-space in Acts 2 & 3 ── */
    if (fogRef.current) {
      const sf = Math.min(1, Math.max(0, (t - 0.35) / 0.07))
      fogRef.current.near = lerp(18, 200, sf)
      fogRef.current.far  = lerp(80, 800, sf)
    }

    /* ════════════════════════════════════
       ACT 1  (0 → 0.35)
       Standing model + Koenigsegg + Helipad sky.
       Camera: wide establishing zoom-out → zoom to face → orbital sweep → behind.
    ════════════════════════════════════ */
    if (t < 0.35) {
      if (stand3) stand3.visible = true
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = false
      if (car3)   car3.visible   = true
      if (city3)  city3.visible  = true
      if (galaxy3) galaxy3.visible = false
      if (thanos3) thanos3.visible = false

      /* ── Car position: slide in from off-screen left during first 5%, then follow drag ── */
      if (car3) {
        if (t < 0.05) {
          const ep = smootherstep(t / 0.05)
          car3.position.x = lerp(-7, dragState.targetX, ep)
          car3.position.z = dragState.targetZ
        } else {
          car3.position.x = lerp(car3.position.x, dragState.targetX, 0.1)
          car3.position.z = lerp(car3.position.z, dragState.targetZ, 0.1)
        }
      }

      /* ── 0-5%: wide establishing shot – city skyline + Iron Man ── */
      if (t < 0.05) {
        const p  = t / 0.05
        const ep = smootherstep(p)
        camera.position.set(
          lerp(3.5,  2.0, ep),
          lerp(3.8,  1.6, ep),
          lerp(14.0, 7.5, ep)
        )
        camera.lookAt(lerp(-0.5, -0.5, ep), lerp(1.5, 0.8, ep), 0)
        fadeGroup(stand3, lerp(0, 1, p))
        fadeGroup(car3,   lerp(0, 1, p))
        fadeGroup(city3,  lerp(0, 1, p))
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(0.1, 1.5, p)

      /* ── 5-7%: settle to standard shot ── */
      } else if (t < 0.07) {
        const p  = (t - 0.05) / 0.02
        const ep = smootherstep(p)
        camera.position.set(
          lerp(2.0, 0,   ep),
          lerp(1.6, 1.1, ep),
          lerp(7.5, 5.5, ep)
        )
        camera.lookAt(0, lerp(0.8, 1.1, ep), 0)
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(1.5, 2, p)

      /* ── 7-17%: zoom in close to face/chest ── */
      } else if (t < 0.17) {
        const p  = (t - 0.07) / 0.10
        const ep = smootherstep(p)
        camera.position.set(
          lerp(0,   0.2,  ep),
          lerp(1.1, 1.75, ep),
          lerp(5.5, 2.0,  ep)
        )
        camera.lookAt(0, lerp(1.1, 1.5, ep), 0)
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 4, p)

      /* ── 17-27%: sweep around the right side ── */
      } else if (t < 0.27) {
        const p  = (t - 0.17) / 0.10
        const ep = smootherstep(p)
        camera.position.set(
          lerp(0.2, 2.5,  ep),
          lerp(1.75, 1.4, ep),
          lerp(2.0, 0.3,  ep)
        )
        camera.lookAt(0, 1.4, 0)
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = 4

      /* ── 27-35%: camera sweeps behind; at ~30% Iron Man begins takeoff ── */
      } else {
        const p = (t - 0.27) / 0.08
        /* Takeoff begins at p=0.375 (t≈0.30), reaches TAKEOFF_Y at p=1 (t=0.35) */
        const riseP  = Math.max(0, (p - 0.375) / 0.625)
        const standY = TAKEOFF_Y * riseP * riseP   // ease-in acceleration

        if (stand3) stand3.position.y = standY
        speedVisRef.current = false  // no speed-lines during Act 1 takeoff

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
       Stand continues rising & fades out; fly fades in.
       City/car fade out; galaxy fades in.
    ════════════════════════════════════ */
    else if (t < 0.42) {
      const p = (t - 0.35) / 0.07

      /* Reset car drag target back to base position during transition */
      dragState.targetX = lerp(dragState.targetX, -1.7, 0.05)
      dragState.targetZ = lerp(dragState.targetZ,  0.5, 0.05)

      if (stand3) {
        stand3.visible    = true
        stand3.position.y = TAKEOFF_Y + lerp(0, 3.5, p)
        fadeGroup(stand3, lerp(1, 0, Math.min(1, p * 1.6)))
      }
      if (fly3) {
        // Only reveal flying model after stand has fully faded (stand reaches 0 at p=0.625)
        const flyP = Math.max(0, (p - 0.65) / 0.35)
        fly3.visible = flyP > 0
        if (flyP > 0) {
          fly3.position.set(0, lerp(TAKEOFF_Y * 0.5, 0, flyP), 0)
          fly3.rotation.set(0, 0, 0)
          fadeGroup(fly3, flyP)
        }
      }
      if (shoot3) shoot3.visible = false

      if (car3) {
        /* Car drives off-screen to the right while fading out */
        car3.visible = true
        const carExitP = smootherstep(p)
        car3.position.x = lerp(dragState.targetX, 8, carExitP)
        fadeGroup(car3, lerp(1, 0, Math.min(1, p * 1.3)))
      }
      if (city3)  { city3.visible  = true; fadeGroup(city3,  lerp(1, 0, p)) }

      if (galaxy3) {
        galaxy3.visible = true
        fadeGroup(galaxy3, lerp(0, 1, p))
      }
      if (thanos3) thanos3.visible = false

      speedVisRef.current = p < 0.5

      /* Smooth camera arc sweep with ease-in-out */
      const ep       = smootherstep(p)
      const camAngle = lerp(Math.PI, 0, ep)
      const radius   = lerp(2.8, 3.5, ep)   // end at z=3.5 (was 2.0) — fly model not zoomed-in
      const yOffset  = TAKEOFF_Y * lerp(0.8, 0, ep)
      camera.position.set(
        Math.sin(camAngle) * radius * 0.55,
        lerp(1.55, 1.1, ep) + yOffset,
        Math.cos(camAngle) * radius
      )
      camera.lookAt(0, lerp(1.4, 0.9, ep) + yOffset * 0.5, 0)
      if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 2, p)
    }

    /* ════════════════════════════════════
       ACT 2  (42-78%)
       Flying model in space with galaxy background.
    ════════════════════════════════════ */
    else if (t < 0.78) {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = true
      if (shoot3) shoot3.visible = false
      if (car3)   car3.visible   = false
      if (city3)  city3.visible  = false
      if (galaxy3) { galaxy3.visible = true; fadeGroup(galaxy3, 1) }
      if (thanos3) thanos3.visible = false

      const flyProgress = Math.max(0, (t - 0.50) / 0.28)
      const flyY = lerp(0, 4.8, flyProgress)

      /* ── 42-50%: smooth pull-back from transition end (z=3.5) — fly model zooms out ── */
      if (t < 0.50) {
        speedVisRef.current = false
        const p = (t - 0.42) / 0.08
        camera.position.set(0, lerp(1.4, 1.8, p), lerp(3.5, 5.5, p))
        camera.lookAt(0, lerp(1.0, 0.8, p), 0)
        if (fly3) { fly3.position.set(0, lerp(0.3, 0, p), 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 2.5, p)

      /* ── 50-58%: pull back; Iron Man ascends ── */
      } else if (t < 0.58) {
        speedVisRef.current = true
        const p = (t - 0.50) / 0.08
        camera.position.set(lerp(0, -0.8, p), lerp(1.8, 3.5, p), lerp(5.5, 7.0, p))
        camera.lookAt(0, lerp(0.8, flyY + 0.5, p), 0)
        if (fly3) { fly3.position.set(0, flyY, 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2.5, 2, p)

      /* ── 58-70%: 360° barrel roll while climbing ── */
      } else if (t < 0.70) {
        speedVisRef.current = false
        const p = (t - 0.58) / 0.12
        if (fly3) { fly3.position.set(0, flyY, 0); fly3.rotation.set(0, p * Math.PI * 2, 0) }
        const camAngle  = lerp(0.1, Math.PI * 0.65, p)
        const camRadius = lerp(6.0, 5.0, p)
        camera.position.set(Math.sin(camAngle) * camRadius, lerp(3.5, flyY + 2.0, p), Math.cos(camAngle) * camRadius)
        camera.lookAt(0, lerp(flyY * 0.5, flyY, p), 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 3, p)

      /* ── 70-78%: final banking climb ── */
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
          fly3.rotation.set(lerp(0, 0.18, p), Math.PI * 2, lerp(0, -0.35, p))
        }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 2.5, p)
      }
    }

    /* ════════════════════════════════════
       TRANSITION 2 → 3  (78-88%)
       Dive close, swap fly → shoot model. Galaxy stays. Thanos fades in.
    ════════════════════════════════════ */
    else if (t < 0.88) {
      speedVisRef.current = false
      if (car3)   car3.visible   = false
      if (city3)  city3.visible  = false
      if (galaxy3) { galaxy3.visible = true; fadeGroup(galaxy3, 1) }

      /* Start fading Thanos in early so it's ready for the orbit */
      if (thanos3) {
        thanos3.visible = true
        thanos3.position.set(0, 0.5, 12)
        fadeGroup(thanos3, lerp(0, 1, (t - 0.78) / 0.10))
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

      /* Phase B (83-85%): swap fly → shoot */
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

      /* Phase C (85-88%): zoom out to reveal shoot model */
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
       Shooting model heading toward Thanos.
       Galaxy backdrop. Thanos at positive Z (visible from behind Iron Man).
    ════════════════════════════════════ */
    else {
      if (stand3) stand3.visible = false
      if (fly3)   fly3.visible   = false
      if (shoot3) shoot3.visible = true
      if (car3)   car3.visible   = false
      if (city3)  city3.visible  = false
      if (galaxy3) { galaxy3.visible = true; fadeGroup(galaxy3, 1) }
      speedVisRef.current = false

      /* Thanos fully visible at positive z in front of Iron Man */
      if (thanos3) {
        thanos3.visible = true
        thanos3.position.set(0, 0.5, 12)
        fadeGroup(thanos3, 1)
      }

      /* ── 88-93%: drift in from front; settle at orbit start position ── */
      if (t < 0.93) {
        const p = (t - 0.88) / 0.05
        camera.position.set(lerp(0, 0, p), lerp(1.5, 1.4, p), lerp(5.0, 2.8, p))
        camera.lookAt(0, 1.2, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(3, 5, p)

      /* ── 93-97%: half-orbit front→behind Iron Man; at angle=π camera is at
            z=-3.5 with Thanos (z=12) visible straight ahead ── */
      } else if (t < 0.97) {
        const p = (t - 0.93) / 0.04
        const angle  = lerp(0, Math.PI, p)        // HALF circle: front → behind
        const radius = lerp(2.8, 3.5, p)
        camera.position.set(
          Math.sin(angle) * radius,
          lerp(1.4, 2.5, p),
          Math.cos(angle) * radius
        )
        camera.lookAt(0, 1.2, 0)
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(5, 8, p)

      /* ── 97-100%: fly toward Thanos – our true final scene ── */
      } else {
        const p  = (t - 0.97) / 0.03
        const ep = p * p * (3 - 2 * p)
        /* fade Iron Man out quickly so he doesn't block the zoom path */
        fadeGroup(shoot3, lerp(1, 0, Math.min(1, p * 4)))
        /* camera flies from behind Iron Man (z=-3.5) toward Thanos (z=12) */
        camera.position.set(lerp(0, 0.2, ep), lerp(2.5, 3.8, ep), lerp(-3.5, 9.5, ep))
        /* look target tracks to Thanos face (y≈3.3 at scale=0.15, group y=0.5) */
        camera.lookAt(lerp(0, 0, ep), lerp(1.2, 3.3, ep), lerp(0, 12, ep))
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(8, 14, ep)
      }
    }
  })

  /* ══════════════════════════════════════
     JSX
  ══════════════════════════════════════ */
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]}   intensity={1.4} color="#fff4d0" />
      <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#002255" />
      {/* Arc reactor glow on Iron Man */}
      <pointLight
        ref={arcLightRef}
        position={[0, 1.5, 0.5]}
        color="#00ccff"
        intensity={0.5}
        distance={4}
        decay={2}
      />
      {/* Dedicated Thanos illumination */}
      <pointLight position={[0, 5, 12]}  color="#ff7744" intensity={5} distance={25} decay={2} />

      <fog ref={fogRef} attach="fog" args={['#00000a', 25, 120]} />

      {/* ── Low-poly night city (Scene 1 only) ── */}
      <NightCityEnv groupRef={cityRef} />

      {/* ── Galaxy sky sphere (Scenes 2 & 3) ── */}
      <GalaxySky groupRef={galaxyRef} />

      {/* ── Thanos (Scene 3 – positive z, visible from behind Iron Man) ── */}
      <ThanosModel groupRef={thanosRef} />

      {/* ── Standing model ── */}
      <group ref={standRef} scale={modelScale}>
        <primitive object={stand.scene} scale={0.001} position={[0, 0, 0]} />
      </group>

      {/* ── Koenigsegg One:1 – slightly smaller (×0.88) ── */}
      <group ref={carRef} position={[-1.7, 0, 0.5]} rotation={[0, -0.35, 0]} scale={modelScale * 0.88}>
        <primitive object={car.scene} position={[0, 0, 0]} />
      </group>

      {/* ── Flying model ── */}
      <group ref={flyRef} scale={modelScale} visible={false}>
        <primitive object={fly.scene} position={[0, 0, 0]} />
      </group>

      {/* ── Fighting / shooting model ── */}
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

/* ─── F1 car spinner inside the loading screen ─── */
function LoaderScene3D() {
  const { scene } = useGLTF('/koenigsegg/scene.gltf')
  /* Deep-clone scene + materials so this Canvas owns independent copies */
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse(c => {
      if (!c.isMesh || !c.material) return
      if (Array.isArray(c.material)) {
        c.material = c.material.map(m => m.clone())
      } else {
        c.material = c.material.clone()
      }
    })
    return clone
  }, [scene])

  const groupRef = useRef()
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.65
    }
  })

  return (
    <group ref={groupRef} position={[0, -0.35, 0]} rotation={[0, -0.35, 0]}>
      <primitive object={clonedScene} />
    </group>
  )
}

/* ─── Loading screen ─── */
function Loader({ fadingOut }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 30,
      background: '#000008',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12, fontFamily: 'monospace',
      opacity: fadingOut ? 0 : 1,
      transition: 'opacity 0.9s ease-out',
      pointerEvents: fadingOut ? 'none' : 'auto',
    }}>
      {/* 3D car spinner */}
      <div style={{ width: '100%', height: '58vh', position: 'relative' }}>
        <Canvas
          camera={{ fov: 45, position: [0, 1.3, 5.2] }}
          gl={{ antialias: true, alpha: true }}
          dpr={[1, 1.5]}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.3} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} color="#fff4d0" />
          <pointLight position={[0, 2, 2]} color="#00ccff" intensity={6} distance={8} decay={2} />
          <pointLight position={[-3, 1, -2]} color="#002255" intensity={2} distance={10} decay={2} />
          <Suspense fallback={null}>
            <LoaderScene3D />
          </Suspense>
        </Canvas>
      </div>
      <div style={{ color: 'rgba(0,200,255,0.8)', fontSize: 11, letterSpacing: 4, animation: 'ironpulse 2s infinite' }}>
        LOADING
      </div>
      <style>{`
        @keyframes ironpulse { 0%,100% { opacity:0.3 } 50% { opacity:1 } }
      `}</style>
    </div>
  )
}

/* preload all assets so Suspense resolves in one batch */
useGLTF.preload('/iron_man.glb')
useGLTF.preload('/iron_man-flying.glb')
useGLTF.preload('/iron_man_last.glb')
useGLTF.preload('/koenigsegg/scene.gltf')
useGLTF.preload('/night_city/scene.gltf')
useGLTF.preload('/galaxy.glb')
useGLTF.preload('/thanos.glb')

/* ─── Root ─── */
export default function IronManScene() {
  const [loaded, setLoaded]             = useState(false)
  const [loaderHidden, setLoaderHidden] = useState(false)

  const handleLoaded = () => {
    setLoaded(true)
    /* Keep loader mounted until CSS fade-out finishes (~900 ms) */
    setTimeout(() => setLoaderHidden(true), 950)
  }

  /* ── Pointer handlers for car drag interactivity ── */
  const handlePointerDown = (e) => {
    dragState.active = true
    dragState.lastX  = e.clientX
    dragState.lastY  = e.clientY
  }
  const handlePointerMove = (e) => {
    if (!dragState.active) return
    const dx = e.clientX - dragState.lastX
    const dy = e.clientY - dragState.lastY
    dragState.lastX = e.clientX
    dragState.lastY = e.clientY
    /* 0.012 world-units per pixel — feels natural at z≈5 camera distance */
    dragState.targetX = Math.max(-5.5, Math.min(2.0, dragState.targetX + dx * 0.012))
    dragState.targetZ = Math.max(-2.0, Math.min(3.0, dragState.targetZ + dy * 0.012))
  }
  const handlePointerUp    = () => { dragState.active = false }
  const handlePointerLeave = () => { dragState.active = false }

  return (
    <div
      style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', cursor: 'grab' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >

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

      {/* Loader stays mounted during fade-out; fadingOut triggers CSS opacity transition */}
      {!loaderHidden && <Loader fadingOut={loaded} />}

      <Canvas
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        camera={{ fov: 50, near: 0.05, far: 400 }}
        dpr={[1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2)]}
        style={{ background: '#000008', width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <ScrollControls pages={10} damping={0.18}>
            <SceneContent />
            <Preload all />
          </ScrollControls>
          <OnLoaded onLoaded={handleLoaded} />
        </Suspense>
        <Suspense fallback={null}>
          <Environment preset="night" />
        </Suspense>
        <EffectComposer>
          {/* Higher threshold keeps metallic car surfaces sharp; city emissive lights still glow */}
          <Bloom luminanceThreshold={0.50} luminanceSmoothing={0.9} intensity={0.55} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={0.65} />
          {/* Subtle chromatic aberration for cinematic lens feel */}
          <ChromaticAberration offset={[0.0018, 0.0018]} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}

