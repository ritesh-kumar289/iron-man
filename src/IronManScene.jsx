import { useRef, useEffect, Suspense, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useScroll, ScrollControls, Environment, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

const lerp = THREE.MathUtils.lerp

/* ─────────────────────────────────────────
   LA Helipad sky sphere (Scene 1 / Act 1)
   The GLB is a panoramic sphere (same kind as galaxy.glb).
   We replace every mesh's material with a lighting-independent
   MeshBasicMaterial so the sky texture is always visible regardless
   of ambient/directional lighting, fog, or depth-buffer state.
   renderOrder=-10 ensures the sky draws first (background), and
   depthTest=false means it never gets clipped by foreground geometry.
───────────────────────────────────────── */
function HelipadSky({ groupRef }) {
  const helipad = useGLTF('/sky_pano_-_l.a._helipad.glb')
  useEffect(() => {
    helipad.scene.traverse(c => {
      if (!c.isMesh || !c.material) return
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      c.material = mats.map(m => new THREE.MeshBasicMaterial({
        map:          m.map          || m.emissiveMap || null,
        side:         THREE.BackSide,   // camera is inside the sphere
        depthWrite:   false,
        depthTest:    false,            // always draw behind everything
        fog:          false,
      }))
      if (c.material.length === 1) c.material = c.material[0]
      c.renderOrder = -10              // render before all other objects
    })
  }, [helipad])
  return (
    <group ref={groupRef}>
      <primitive object={helipad.scene} scale={300} />
      {/* Ground plane lives here so it is hidden with the city in later scenes */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#030310" roughness={1} />
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

      /* ── 0-5%: wide establishing shot – city skyline + Iron Man ── */
      if (t < 0.05) {
        const p = t / 0.05
        camera.position.set(
          lerp(3.5,  2.0, p),
          lerp(3.8,  1.6, p),
          lerp(14.0, 7.5, p)
        )
        camera.lookAt(lerp(-0.5, -0.5, p), lerp(1.5, 0.8, p), 0)
        fadeGroup(stand3, lerp(0, 1, p))
        fadeGroup(car3,   lerp(0, 1, p))
        fadeGroup(city3,  lerp(0, 1, p))
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(0.1, 1.5, p)

      /* ── 5-7%: settle to standard shot ── */
      } else if (t < 0.07) {
        const p = (t - 0.05) / 0.02
        camera.position.set(
          lerp(2.0, 0,   p),
          lerp(1.6, 1.1, p),
          lerp(7.5, 5.5, p)
        )
        camera.lookAt(0, lerp(0.8, 1.1, p), 0)
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
        if (stand3) stand3.position.y = 0
        speedVisRef.current = false
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
        speedVisRef.current = riseP > 0.05

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

      if (stand3) {
        stand3.visible    = true
        stand3.position.y = TAKEOFF_Y + lerp(0, 3.5, p)
        fadeGroup(stand3, lerp(1, 0, Math.min(1, p * 1.6)))
      }
      if (fly3) {
        fly3.visible = true
        fly3.position.set(0, lerp(TAKEOFF_Y * 0.5, 0, p), 0)
        fly3.rotation.set(0, 0, 0)
        fadeGroup(fly3, lerp(0, 1, p))
      }
      if (shoot3) shoot3.visible = false

      if (car3)   { car3.visible   = true; fadeGroup(car3,   lerp(1, 0, p)) }
      if (city3)  { city3.visible  = true; fadeGroup(city3,  lerp(1, 0, p)) }

      if (galaxy3) {
        galaxy3.visible = true
        fadeGroup(galaxy3, lerp(0, 1, p))
      }
      if (thanos3) thanos3.visible = false

      speedVisRef.current = p < 0.5

      const camAngle = lerp(Math.PI, 0, p)
      const radius   = lerp(2.8, 2.0, p)
      const yOffset  = TAKEOFF_Y * lerp(0.8, 0, p)
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

      /* ── 42-50%: zoomed-out entry; fly model settles from takeoff height to 0 ── */
      if (t < 0.50) {
        speedVisRef.current = false
        const p = (t - 0.42) / 0.08
        camera.position.set(0, lerp(3.5, 1.8, p), lerp(6.5, 2.8, p))
        camera.lookAt(0, lerp(2.5, 0.8, p), 0)
        if (fly3) { fly3.position.set(0, lerp(TAKEOFF_Y * 0.5, 0, p), 0); fly3.rotation.set(0, 0, 0) }
        if (arcLightRef.current) arcLightRef.current.intensity = lerp(2, 2.5, p)

      /* ── 50-58%: pull back; Iron Man ascends ── */
      } else if (t < 0.58) {
        speedVisRef.current = true
        const p = (t - 0.50) / 0.08
        camera.position.set(lerp(0, -0.8, p), lerp(1.0, 3.5, p), lerp(1.3, 7.0, p))
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

      <fog ref={fogRef} attach="fog" args={['#00000a', 18, 80]} />

      {/* ── LA Helipad sky sphere (Scene 1 only) ── */}
      <HelipadSky groupRef={cityRef} />

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
useGLTF.preload('/sky_pano_-_l.a._helipad.glb')
useGLTF.preload('/galaxy.glb')
useGLTF.preload('/thanos.glb')

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
        camera={{ fov: 50, near: 0.05, far: 400 }}
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
          <Bloom luminanceThreshold={0.28} luminanceSmoothing={0.9} intensity={0.9} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={0.65} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}

