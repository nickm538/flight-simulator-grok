import * as THREE from 'three'
import { CONTACT_DOWN, MAIN_X, MAIN_Z, NOSE_WHEEL_RADIUS, NOSE_X, WHEEL_RADIUS } from '../sim/aircraftConfig'
import type { FlightState } from '../sim/flightModel'
import { basisFromAttitude } from '../sim/math'

export interface SurfaceInput {
  pitch: number
  roll: number
  rudder: number
}

export interface AircraftVisual {
  root: THREE.Group
  effects: THREE.Points
  cockpitAnchor: THREE.Object3D
  update(state: FlightState, surfaces: SurfaceInput, dt: number): void
}

const CANYON = 0x1e4f9a
const RED = 0xc8102e
const GOLD = 0xe0a526

export function buildAircraft(): AircraftVisual {
  const root = new THREE.Group()
  root.name = 'canyon-737'
  const livery = new THREE.MeshStandardMaterial({
    map: liveryTexture(),
    roughness: 0.58,
    metalness: 0.08,
  })
  const white = new THREE.MeshStandardMaterial({ color: 0xe7edf2, roughness: 0.45, metalness: 0.2 })
  const gray = new THREE.MeshStandardMaterial({ color: 0xc5ccd4, roughness: 0.62, metalness: 0.15 })
  const metal = new THREE.MeshStandardMaterial({ color: 0xb7c0c8, roughness: 0.35, metalness: 0.55 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.7, metalness: 0.1 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
  const blue = new THREE.MeshStandardMaterial({ color: CANYON, roughness: 0.5, metalness: 0.12 })
  const red = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.45 })
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.42, metalness: 0.2 })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x163044,
    roughness: 0.08,
    metalness: 0.4,
    transparent: true,
    opacity: 0.1,
  })

  const fuselage = new THREE.Mesh(fuselageGeometry(), livery)
  fuselage.castShadow = true
  fuselage.receiveShadow = true
  fuselage.name = 'fuselage'
  root.add(fuselage)

  const wingMat = gray
  const rightWing = new THREE.Mesh(wingGeometry(false), wingMat)
  const leftWing = new THREE.Mesh(wingGeometry(true), wingMat)
  rightWing.castShadow = leftWing.castShadow = true
  root.add(rightWing, leftWing)
  root.add(winglet(false, blue, gold), winglet(true, blue, gold))

  const flapGroups: THREE.Group[] = []
  flapGroups.push(controlSurface(2.1, 7.2, -2.6, -0.45, 1.15, 0.09))
  flapGroups.push(controlSurface(-7.2, -2.1, -2.6, -0.45, 1.15, 0.09))
  flapGroups.push(controlSurface(7.4, 12.4, -4.15, -0.15, 0.85, 0.07))
  flapGroups.push(controlSurface(-12.4, -7.4, -4.15, -0.15, 0.85, 0.07))
  for (const flap of flapGroups) {
    ;(flap.children[0] as THREE.Mesh).material = gray
    root.add(flap)
  }

  const spoilers = [
    controlSurface(2.3, 7.4, -1.55, -0.05, 0.55, 0.04),
    controlSurface(-7.4, -2.3, -1.55, -0.05, 0.55, 0.04),
  ]
  for (const spoiler of spoilers) {
    ;(spoiler.children[0] as THREE.Mesh).material = white
    root.add(spoiler)
  }

  const ailerons = [
    controlSurface(12.6, 16.2, -5.15, 0.35, 0.55, 0.05),
    controlSurface(-16.2, -12.6, -5.15, 0.35, 0.55, 0.05),
  ]
  for (const aileron of ailerons) {
    ;(aileron.children[0] as THREE.Mesh).material = gray
    root.add(aileron)
  }

  const stab = new THREE.Mesh(stabilizerGeometry(), blue)
  stab.castShadow = true
  root.add(stab)
  const elevator = controlSurface(-6.2, 6.2, -19.6, 0.95, 1.05, 0.08)
  ;(elevator.children[0] as THREE.Mesh).material = blue
  root.add(elevator)

  const fin = new THREE.Mesh(finGeometry(), blue)
  fin.castShadow = true
  root.add(fin)
  const stripeA = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.28), gold)
  stripeA.position.set(0.06, 4.2, -18.2)
  stripeA.rotation.x = 0.7
  const stripeB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.22), red)
  stripeB.position.set(0.08, 3.3, -17.4)
  stripeB.rotation.x = 0.7
  root.add(stripeA, stripeB)
  const rudder = new THREE.Group()
  const rudderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.6, 1.15), blue)
  rudderMesh.geometry.translate(0, 2.1, -0.45)
  rudderMesh.position.set(0, 2.2, -19.3)
  rudder.add(rudderMesh)
  root.add(rudder)

  const fans: THREE.Group[] = []
  const exhausts: THREE.Object3D[] = []
  for (const side of [-1, 1]) {
    const engine = buildEngine(side, metal, dark, white)
    root.add(engine.root)
    fans.push(engine.fan)
    exhausts.push(engine.exhaust)
  }

  const nosePivot = new THREE.Group()
  nosePivot.position.set(0, -0.4, NOSE_X)
  const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, CONTACT_DOWN - 0.7, 8), metal)
  noseStrut.position.y = -(CONTACT_DOWN - 0.7) / 2
  nosePivot.add(noseStrut)
  const noseWheelSpin = wheelPair(NOSE_WHEEL_RADIUS, 0.18, 0.28, rubber, metal)
  noseWheelSpin.position.y = -(CONTACT_DOWN - 0.4 - NOSE_WHEEL_RADIUS)
  nosePivot.add(noseWheelSpin)
  root.add(nosePivot)

  const mainLeft = gearAssembly(MAIN_Z, -1, metal, rubber)
  const mainRight = gearAssembly(MAIN_Z, 1, metal, rubber)
  root.add(mainLeft.pivot, mainRight.pivot)

  const windowFrame = cockpitShell(dark, glass)
  root.add(windowFrame)

  const cockpitAnchor = new THREE.Object3D()
  cockpitAnchor.position.set(-0.52, 0.58, 14.55)
  root.add(cockpitAnchor)

  const navL = light(-1.55, 0.15, 16.2, 0xff3030)
  const navR = light(1.55, 0.15, 16.2, 0x30ff68)
  const navT = light(0, 7.3, -20.2, 0xffffff)
  root.add(navL, navR, navT)

  const effects = dustPoints()
  const dustState = createDust()

  return {
    root,
    effects,
    cockpitAnchor,
    update(state, surfaces, dt) {
      const basis = basisFromAttitude(state.heading, state.pitch, state.roll)
      const matrix = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(basis.right.x, basis.right.y, basis.right.z),
        new THREE.Vector3(basis.up.x, basis.up.y, basis.up.z),
        new THREE.Vector3(basis.forward.x, basis.forward.y, basis.forward.z),
      )
      root.quaternion.setFromRotationMatrix(matrix)
      root.position.set(state.east, state.alt, state.north)

      const spin = state.n1 * 34 * dt
      for (const fan of fans) fan.rotation.z += spin
      const retract = 1 - state.gear
      nosePivot.rotation.x = -retract * 1.55
      mainLeft.pivot.rotation.z = retract * 1.45
      mainRight.pivot.rotation.z = -retract * 1.45
      noseWheelSpin.rotation.x += state.noseOmega * dt
      mainLeft.spin.rotation.x += state.wheelOmega * dt
      mainRight.spin.rotation.x += state.wheelOmega * dt
      const flapRad = (-state.flapDeg * Math.PI) / 180
      for (const flap of flapGroups) flap.rotation.x = flapRad
      for (const spoiler of spoilers) spoiler.rotation.x = state.spoiler * 0.95
      ailerons[0].rotation.x = surfaces.roll * 0.35
      ailerons[1].rotation.x = -surfaces.roll * 0.35
      elevator.rotation.x = -surfaces.pitch * 0.32
      rudder.rotation.y = -surfaces.rudder * 0.35
      updateDust(effects, dustState, exhausts, state, dt)
    },
  }
}

function fuselageGeometry(): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [-22.1, 0.06],
    [-21.1, 0.42],
    [-19.4, 1.12],
    [-17.2, 1.6],
    [-14.2, 1.82],
    [-6, 1.88],
    [11.4, 1.88],
    [13.8, 1.7],
    [15.3, 1.25],
    [16.45, 0.74],
    [17.3, 0.3],
    [17.85, 0.02],
  ]
  const segments = 20
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const z0 = profile[0][0]
  const z1 = profile[profile.length - 1][0]
  for (let i = 0; i < profile.length; i += 1) {
    const [z, radius] = profile[i]
    for (let s = 0; s < segments; s += 1) {
      const ang = (s / segments) * Math.PI * 2
      const x = Math.cos(ang) * radius
      const y = Math.sin(ang) * radius
      positions.push(x, y, z)
      uvs.push(s / segments, (z - z0) / (z1 - z0))
    }
  }
  for (let i = 0; i < profile.length - 1; i += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = i * segments + s
      const b = i * segments + ((s + 1) % segments)
      const c = (i + 1) * segments + s
      const d = (i + 1) * segments + ((s + 1) % segments)
      indices.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function liveryTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not paint the livery.')
  ctx.fillStyle = '#1e4f9a'
  ctx.fillRect(0, 0, 512, 1024)
  ctx.fillStyle = '#163872'
  ctx.fillRect(0, 0, 512, 180)
  const stripe = (uCenter: number) => {
    const x = uCenter * 512
    ctx.fillStyle = '#e0a526'
    ctx.fillRect(x - 16, 220, 10, 620)
    ctx.fillStyle = '#c8102e'
    ctx.fillRect(x - 4, 220, 12, 620)
    ctx.fillStyle = '#d7dee6'
    ctx.fillRect(x + 10, 250, 8, 560)
    ctx.fillStyle = '#0c1218'
    for (let i = 0; i < 28; i += 1) {
      ctx.fillRect(x - 10, 280 + i * 18, 14, 10)
    }
  }
  stripe(0.5)
  stripe(0.0)
  stripe(1.0)
  ctx.strokeStyle = '#f2f5f8'
  ctx.lineWidth = 3
  ctx.strokeRect(248, 430, 22, 46)
  ctx.strokeRect(248, 520, 22, 46)
  ctx.fillStyle = '#f4f7fb'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('N318CG', 300, 780)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}

interface WingStation {
  x: number
  zLe: number
  chord: number
  y: number
  thick: number
}

function wingGeometry(mirror: boolean): THREE.BufferGeometry {
  const stations: WingStation[] = [
    { x: 1.65, zLe: 2.5, chord: 6.5, y: -0.55, thick: 0.74 },
    { x: 6.2, zLe: 0.35, chord: 4.3, y: -0.28, thick: 0.42 },
    { x: 11.4, zLe: -2.35, chord: 2.7, y: 0.08, thick: 0.24 },
    { x: 16.5, zLe: -5.35, chord: 1.5, y: 0.52, thick: 0.12 },
  ]
  return loftStations(stations, mirror)
}

function stabilizerGeometry(): THREE.BufferGeometry {
  return loftStations(
    [
      { x: 0.7, zLe: -16.6, chord: 3.3, y: 0.72, thick: 0.26 },
      { x: 6.5, zLe: -19.15, chord: 1.15, y: 1.15, thick: 0.08 },
    ],
    false,
  )
}

function loftStations(stations: WingStation[], mirror: boolean): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const per = 6
  stations.forEach((station) => {
    const x = mirror ? -station.x : station.x
    const zLe = station.zLe
    const chord = station.chord
    const y = station.y
    const t = station.thick
    const ring = [
      [x, y, zLe],
      [x, y + t * 0.42, zLe - chord * 0.22],
      [x, y + t * 0.16, zLe - chord * 0.72],
      [x, y, zLe - chord],
      [x, y - t * 0.22, zLe - chord * 0.7],
      [x, y - t * 0.32, zLe - chord * 0.28],
    ]
    for (const point of ring) positions.push(point[0], point[1], point[2])
  })
  for (let i = 0; i < stations.length - 1; i += 1) {
    for (let p = 0; p < per; p += 1) {
      const a = i * per + p
      const b = i * per + ((p + 1) % per)
      const c = (i + 1) * per + p
      const d = (i + 1) * per + ((p + 1) % per)
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function winglet(mirror: boolean, blue: THREE.Material, gold: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const sign = mirror ? -1 : 1
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 1.15), blue)
  mesh.position.set(16.7 * sign, 1.7, -5.7)
  mesh.rotation.z = mirror ? 0.35 : -0.35
  mesh.castShadow = true
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 1.05), gold)
  band.position.set(16.7 * sign, 2.35, -5.75)
  group.add(mesh, band)
  return group
}

function finGeometry(): THREE.BufferGeometry {
  const positions = [
    0, 1.5, -15.2,
    0.16, 1.5, -15.2,
    0.12, 7.5, -19.6,
    -0.12, 7.5, -19.6,
    0, 1.7, -20.4,
    0, 1.5, -17.8,
  ]
  const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 1, 5, 2, 5, 4, 2]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function controlSurface(x0: number, x1: number, zHinge: number, y: number, chord: number, thick: number): THREE.Group {
  const group = new THREE.Group()
  const span = Math.abs(x1 - x0)
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(span, thick, chord),
    new THREE.MeshStandardMaterial({ color: 0xc5ccd4 }),
  )
  mesh.geometry.translate(0, 0, -chord / 2)
  mesh.position.set((x0 + x1) / 2, y, zHinge)
  group.add(mesh)
  group.position.copy(mesh.position)
  mesh.position.set(0, 0, 0)
  return group
}

function buildEngine(
  side: number,
  metal: THREE.Material,
  dark: THREE.Material,
  white: THREE.Material,
): { root: THREE.Group; fan: THREE.Group; exhaust: THREE.Object3D } {
  const root = new THREE.Group()
  root.position.set(5.55 * side, -1.38, -0.35)
  const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.86, 4.15, 18, 1, true), white)
  nacelle.rotation.x = Math.PI / 2
  nacelle.castShadow = true
  root.add(nacelle)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.12, 8, 18), metal)
  lip.position.z = 2.05
  root.add(lip)
  const fan = new THREE.Group()
  fan.position.z = 1.88
  const backplate = new THREE.Mesh(new THREE.CircleGeometry(0.86, 18), dark)
  backplate.position.z = -0.16
  fan.add(backplate)
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 12), metal)
  spinner.rotation.x = Math.PI / 2
  spinner.position.z = 0.12
  fan.add(spinner)
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd5dde6, roughness: 0.4, metalness: 0.35 })
  const markedBlade = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4, metalness: 0.2 })
  for (let i = 0; i < 18; i += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.16), i === 0 ? markedBlade : bladeMat)
    blade.position.y = 0.5
    const pivot = new THREE.Group()
    pivot.rotation.z = (i / 18) * Math.PI * 2
    pivot.add(blade)
    fan.add(pivot)
  }
  root.add(fan)
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.74, 0.8, 16, 1, true), dark)
  nozzle.rotation.x = Math.PI / 2
  nozzle.position.z = -2.15
  root.add(nozzle)
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 2.4), white)
  pylon.position.set(0, 0.95, 0.1)
  root.add(pylon)
  const exhaust = new THREE.Object3D()
  exhaust.position.set(0, 0, -2.5)
  root.add(exhaust)
  return { root, fan, exhaust }
}

function gearAssembly(
  zSpan: number,
  side: number,
  metal: THREE.Material,
  rubber: THREE.Material,
): { pivot: THREE.Group; spin: THREE.Group } {
  const pivot = new THREE.Group()
  pivot.position.set(2.15 * side, -0.55, MAIN_X)
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.7, 8), metal)
  strut.position.y = -0.85
  pivot.add(strut)
  const truck = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.9), metal)
  truck.position.y = -1.7
  pivot.add(truck)
  const spin = wheelPair(WHEEL_RADIUS, 0.28, 0.42, rubber, metal)
  spin.position.y = -(CONTACT_DOWN - 0.55 - WHEEL_RADIUS)
  pivot.add(spin)
  pivot.userData.span = zSpan
  return { pivot, spin }
}

function wheelPair(
  radius: number,
  width: number,
  gap: number,
  rubber: THREE.Material,
  metal: THREE.Material,
): THREE.Group {
  const spin = new THREE.Group()
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), rubber)
    wheel.rotation.z = Math.PI / 2
    wheel.position.x = side * gap
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.4, radius * 0.22, radius * 0.55),
      new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.4 }),
    )
    mark.position.set(side * gap, radius * 0.72, 0)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.38, radius * 0.38, width + 0.02, 10), metal)
    hub.rotation.z = Math.PI / 2
    hub.position.x = side * gap
    spin.add(wheel, hub, mark)
  }
  return spin
}

function cockpitShell(dark: THREE.Material, glass: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const glare = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 1.8), dark)
  glare.position.set(0, 0.28, 15.35)
  const overhead = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 2.4), dark)
  overhead.position.set(0, 1.18, 14.4)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 3.2), dark)
  floor.position.set(0, -0.15, 13.8)
  const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.12), dark)
  pillarL.position.set(-0.72, 0.7, 16.05)
  const pillarR = pillarL.clone()
  pillarR.position.x = 0.72
  const center = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.1), dark)
  center.position.set(0, 0.72, 16.2)
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.35), dark)
  sill.position.set(0, 0.42, 15.9)
  group.add(glare, overhead, floor, pillarL, pillarR, center, sill)
  void glass
  return group
}

function light(x: number, y: number, z: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

interface DustParticle {
  life: number
  vx: number
  vy: number
  vz: number
}

function dustPoints(): THREE.Points {
  const count = 100
  const positions = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xd8c2a2,
    size: 3.2,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    sizeAttenuation: true,
  })
  return new THREE.Points(geometry, material)
}

function createDust(): DustParticle[] {
  return Array.from({ length: 100 }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }))
}

function updateDust(
  points: THREE.Points,
  particles: DustParticle[],
  exhausts: THREE.Object3D[],
  state: FlightState,
  dt: number,
): void {
  const positions = points.geometry.getAttribute('position') as THREE.BufferAttribute
  const tmp = new THREE.Vector3()
  let cursor = 0
  if (state.dust) {
    for (const exhaust of exhausts) {
      exhaust.getWorldPosition(tmp)
      for (let n = 0; n < 2; n += 1) {
        const slot = particles[cursor % particles.length]
        slot.life = 0.7 + Math.random() * 0.4
        positions.setXYZ(cursor % particles.length, tmp.x, tmp.y, tmp.z)
        slot.vx = (Math.random() - 0.5) * 6
        slot.vy = 1.5 + Math.random() * 3
        slot.vz = (Math.random() - 0.5) * 6
        cursor += 1
      }
    }
  }
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    if (particle.life <= 0) {
      positions.setXYZ(i, 0, -20, 0)
      continue
    }
    particle.life -= dt
    const x = positions.getX(i) + particle.vx * dt
    const y = positions.getY(i) + particle.vy * dt
    const z = positions.getZ(i) + particle.vz * dt
    positions.setXYZ(i, x, y, z)
  }
  positions.needsUpdate = true
  const material = points.material as THREE.PointsMaterial
  material.opacity = state.dust ? 0.5 : 0.35
}
