import * as THREE from 'three'
import type { FlightState } from '../sim/flightModel'
import { basisFromAttitude, rad } from '../sim/math'
import {
  RUNWAYS,
  RUNWAY_31L,
  baySideMeters,
  gatePad,
  isWater,
  onRunway,
  runwayPoint,
  taxiways,
  terminalBlocks,
  touchdown31L,
  type Enu,
  type RunwayStrip,
} from './kjfk'

export interface AirportWorld {
  update(state: FlightState, dt: number): void
}

export function createAirport(scene: THREE.Scene): AirportWorld {
  const grass = new THREE.MeshStandardMaterial({ color: 0x3f6d3c, roughness: 0.95 })
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1a5574, roughness: 0.35, metalness: 0.15 })
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6e7378, roughness: 0.86 })
  const taxiMat = new THREE.MeshStandardMaterial({ color: 0x5c6166, roughness: 0.9 })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe6c84a, roughness: 0.7 })
  const terminalMat = new THREE.MeshStandardMaterial({ color: 0xd5dbe3, roughness: 0.6 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x8fb4c9, roughness: 0.2, metalness: 0.4 })

  const water = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.y = -0.35
  scene.add(water)

  const land = landMesh(grass)
  land.receiveShadow = true
  scene.add(land)

  for (const runway of RUNWAYS) {
    const mesh = runwayMesh(runway)
    mesh.receiveShadow = true
    scene.add(mesh)
  }
  for (const segment of taxiways()) {
    scene.add(ribbon(segment.points, segment.halfWidth, 0.1, taxiMat))
    scene.add(ribbon(segment.points, 0.35, 0.14, yellow))
  }

  const threshold = runwayPoint(RUNWAY_31L, 3264 * 0.3048)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(RUNWAY_31L.widthM * 0.92, 0.04, 4), new THREE.MeshStandardMaterial({ color: 0xf4f7fb }))
  bar.position.set(threshold.east, 0.22, threshold.north)
  const aligned = basisFromAttitude(RUNWAY_31L.headingTrue, 0, 0)
  bar.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(aligned.right.x, aligned.right.y, aligned.right.z),
      new THREE.Vector3(aligned.up.x, aligned.up.y, aligned.up.z),
      new THREE.Vector3(aligned.forward.x, aligned.forward.y, aligned.forward.z),
    ),
  )
  scene.add(bar)

  const buildings = new THREE.Group()
  for (const block of terminalBlocks()) {
    const mass = new THREE.Mesh(new THREE.BoxGeometry(block.width, block.name === 'T4' ? 22 : 16, block.length), terminalMat)
    mass.position.set(block.center.east, block.name === 'T4' ? 11 : 8, block.center.north)
    mass.rotation.y = -block.heading
    mass.castShadow = true
    mass.receiveShadow = true
    const windows = new THREE.Mesh(new THREE.BoxGeometry(block.width + 0.4, 6, block.length * 0.72), glassMat)
    windows.position.set(block.center.east, 11, block.center.north)
    windows.rotation.y = -block.heading
    buildings.add(mass, windows)
    const label = terminalLabel(block.name)
    label.position.set(block.center.east, (block.name === 'T4' ? 22 : 16) + 4, block.center.north)
    buildings.add(label)
  }
  const gate = gatePad()
  const pad = new THREE.Mesh(new THREE.BoxGeometry(70, 0.08, 70), yellow)
  pad.position.set(gate.east, 0.16, gate.north)
  const gateSign = terminalLabel('B12')
  gateSign.position.set(gate.east, 8, gate.north)
  buildings.add(pad, gateSign)
  const tower = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 48, 8), concrete)
  shaft.position.y = 24
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 6, 8), glassMat)
  cab.position.y = 50
  tower.add(shaft, cab)
  tower.position.set(gate.east + 180, 0, gate.north - 40)
  buildings.add(tower)
  scene.add(buildings)

  const trees = buildTrees()
  scene.add(trees)

  const traffic = buildTraffic()
  scene.add(traffic.root)

  const papi = buildPapi()
  scene.add(papi.group)

  const lights = runwayLights()
  scene.add(lights)

  return {
    update(state, dt) {
      traffic.update(dt)
      updatePapi(papi, state)
    },
  }
}

function landMesh(material: THREE.Material): THREE.Mesh {
  const samples: Enu[] = []
  for (const runway of RUNWAYS) {
    for (const along of [-280, 0, runway.lengthM * 0.5, runway.lengthM, runway.lengthM + 200]) {
      for (const cross of [-70, 80, 560]) {
        samples.push(runwayPoint(runway, along, cross))
      }
    }
  }
  const center = samples.reduce(
    (acc, point) => ({ east: acc.east + point.east / samples.length, north: acc.north + point.north / samples.length }),
    { east: 0, north: 0 },
  )
  const expanded = samples.map((point) => {
    const dE = point.east - center.east
    const dN = point.north - center.north
    const length = Math.hypot(dE, dN) || 1
    return { east: point.east + (dE / length) * 260, north: point.north + (dN / length) * 260 }
  })
  const hull = convexHull(expanded).map((point) => {
    const side = baySideMeters(point.east, point.north)
    if (side <= 190) return point
    const left = RUNWAY_31L.left
    return {
      east: point.east - left.east * (side - 190),
      north: point.north - left.north * (side - 190),
    }
  })
  const positions: number[] = []
  for (let i = 0; i < hull.length; i += 1) {
    const next = hull[(i + 1) % hull.length]
    positions.push(center.east, 0.02, center.north, hull[i].east, 0.02, hull[i].north, next.east, 0.02, next.north)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, material)
}

function convexHull(points: Enu[]): Enu[] {
  const sorted = [...points].sort((a, b) => a.east - b.east || a.north - b.north)
  const cross = (o: Enu, a: Enu, b: Enu) => (a.east - o.east) * (b.north - o.north) - (a.north - o.north) * (b.east - o.east)
  const lower: Enu[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Enu[] = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function runwayMesh(runway: RunwayStrip): THREE.Mesh {
  const half = runway.widthM / 2
  const y = 0.2
  const corners = [
    runwayPoint(runway, 0, -half),
    runwayPoint(runway, 0, half),
    runwayPoint(runway, runway.lengthM, half),
    runwayPoint(runway, runway.lengthM, -half),
  ]
  const positions = new Float32Array([
    corners[0].east, y, corners[0].north,
    corners[1].east, y, corners[1].north,
    corners[2].east, y, corners[2].north,
    corners[3].east, y, corners[3].north,
  ])
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    map: runwayTexture(runway.lowId, runway.highId),
    roughness: 0.88,
  })
  return new THREE.Mesh(geometry, material)
}

function runwayTexture(low: string, high: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not paint the runway.')
  ctx.fillStyle = '#4e545a'
  ctx.fillRect(0, 0, 128, 1024)
  ctx.strokeStyle = '#f4f7fb'
  ctx.lineWidth = 4
  ctx.strokeRect(6, 4, 116, 1016)
  ctx.fillStyle = '#f4f7fb'
  for (let y = 40; y < 1000; y += 36) ctx.fillRect(60, y, 8, 18)
  for (let i = 0; i < 8; i += 1) {
    ctx.fillRect(10 + i * 14, 70, 8, 28)
    ctx.fillRect(10 + i * 14, 930, 8, 28)
  }
  ctx.save()
  ctx.translate(64, 150)
  ctx.fillStyle = '#f4f7fb'
  ctx.font = 'bold 42px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(low, 0, 0)
  ctx.restore()
  ctx.save()
  ctx.translate(64, 880)
  ctx.rotate(Math.PI)
  ctx.fillStyle = '#f4f7fb'
  ctx.font = 'bold 42px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(high, 0, 0)
  ctx.restore()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function ribbon(points: Enu[], halfWidth: number, y: number, material: THREE.Material): THREE.Mesh {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dx = next.east - prev.east
    const dz = next.north - prev.north
    const length = Math.hypot(dx, dz) || 1
    const rx = (-dz / length) * halfWidth
    const rz = (dx / length) * halfWidth
    positions.push(points[i].east + rx, y, points[i].north + rz, points[i].east - rx, y, points[i].north - rz)
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, material)
}

function terminalLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not paint a label.')
  ctx.fillStyle = '#10233f'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = '#e0a526'
  ctx.lineWidth = 8
  ctx.strokeRect(6, 6, 244, 116)
  ctx.fillStyle = '#f4f7fb'
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 64)
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(40, 20, 1)
  return sprite
}

function buildTrees(): THREE.InstancedMesh {
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 1.4, 5)
  trunk.translate(0, 0.7, 0)
  const crown = new THREE.ConeGeometry(1.15, 2.6, 6)
  crown.translate(0, 2.4, 0)
  const geometry = mergeParts([
    { geometry: trunk, color: new THREE.Color('#6b4a2e') },
    { geometry: crown, color: new THREE.Color('#2f6a34') },
  ])
  const count = 240
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), count)
  const dummy = new THREE.Object3D()
  let placed = 0
  const rand = mulberry(31)
  let guard = 0
  while (placed < count && guard < 4000) {
    guard += 1
    const east = (rand() - 0.5) * 7000
    const north = (rand() - 0.5) * 7000
    if (isWater(east, north) || pavement(east, north)) continue
    dummy.position.set(east, 0, north)
    dummy.rotation.y = rand() * Math.PI * 2
    const scale = 0.8 + rand() * 1.4
    dummy.scale.set(scale, scale, scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(placed, dummy.matrix)
    placed += 1
  }
  mesh.count = placed
  mesh.castShadow = false
  return mesh
}

function pavement(east: number, north: number): boolean {
  for (const runway of RUNWAYS) {
    if (onRunway(runway, east, north, 18)) return true
  }
  for (const segment of taxiways()) {
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      if (distanceToSegment(east, north, segment.points[i], segment.points[i + 1]) < segment.halfWidth + 6) return true
    }
  }
  const gate = gatePad()
  if (Math.hypot(east - gate.east, north - gate.north) < 160) return true
  return false
}

function distanceToSegment(east: number, north: number, a: Enu, b: Enu): number {
  const abE = b.east - a.east
  const abN = b.north - a.north
  const denom = abE * abE + abN * abN || 1
  const t = Math.max(0, Math.min(1, ((east - a.east) * abE + (north - a.north) * abN) / denom))
  return Math.hypot(east - (a.east + abE * t), north - (a.north + abN * t))
}

function mergeParts(parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  for (const part of parts) {
    const position = part.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i))
      colors.push(part.color.r, part.color.g, part.color.b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function buildTraffic(): { root: THREE.Group; update(dt: number): void } {
  const gate = gatePad()
  const loop = [
    { east: gate.east - 220, north: gate.north - 80 },
    { east: gate.east + 260, north: gate.north - 40 },
    { east: gate.east + 240, north: gate.north + 180 },
    { east: gate.east - 200, north: gate.north + 150 },
  ]
  const geometry = new THREE.BoxGeometry(2.4, 1.4, 6)
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xd7dde4, roughness: 0.6 }),
    loop.length * 3,
  )
  const root = new THREE.Group()
  root.add(mesh)
  const speeds = [7, 9, 6, 8, 10, 7.5, 8.5, 6.5, 9.5, 7.2, 8.2, 6.8]
  const offsets = speeds.map((_, index) => index / speeds.length)
  const dummy = new THREE.Object3D()
  return {
    root,
    update(dt) {
      for (let i = 0; i < speeds.length; i += 1) {
        offsets[i] = (offsets[i] + (dt * speeds[i]) / loopLength(loop)) % 1
        const point = pointOnLoop(loop, offsets[i])
        const ahead = pointOnLoop(loop, offsets[i] + 0.01)
        dummy.position.set(point.east, 0.8, point.north)
        dummy.rotation.y = -Math.atan2(ahead.east - point.east, ahead.north - point.north)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    },
  }
}

function loopLength(loop: Enu[]): number {
  let total = 0
  for (let i = 0; i < loop.length; i += 1) {
    const next = loop[(i + 1) % loop.length]
    total += Math.hypot(next.east - loop[i].east, next.north - loop[i].north)
  }
  return total
}

function pointOnLoop(loop: Enu[], t: number): Enu {
  const length = loopLength(loop)
  let remain = t * length
  for (let i = 0; i < loop.length; i += 1) {
    const next = loop[(i + 1) % loop.length]
    const span = Math.hypot(next.east - loop[i].east, next.north - loop[i].north)
    if (remain <= span) {
      const u = span === 0 ? 0 : remain / span
      return {
        east: loop[i].east + (next.east - loop[i].east) * u,
        north: loop[i].north + (next.north - loop[i].north) * u,
      }
    }
    remain -= span
  }
  return loop[0]
}

function buildPapi(): { group: THREE.Group; lamps: THREE.Mesh[] } {
  const group = new THREE.Group()
  const side = runwayPoint(RUNWAY_31L, 3264 * 0.3048 + 300, -RUNWAY_31L.widthM * 0.5 - 18)
  const lamps: THREE.Mesh[] = []
  for (let i = 0; i < 4; i += 1) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }),
    )
    const along = side
    lamp.position.set(
      along.east + RUNWAY_31L.forward.east * i * 8,
      1.2,
      along.north + RUNWAY_31L.forward.north * i * 8,
    )
    group.add(lamp)
    lamps.push(lamp)
  }
  return { group, lamps }
}

function updatePapi(papi: { lamps: THREE.Mesh[] }, state: FlightState): void {
  const aim = touchdown31L()
  const relE = state.east - aim.east
  const relN = state.north - aim.north
  const ahead = relE * RUNWAY_31L.forward.east + relN * RUNWAY_31L.forward.north
  const along = -ahead
  const angle = Math.atan2(Math.max(state.alt, 0), Math.max(along, 40))
  const whiteCount = angle > rad(3.4) ? 4 : angle > rad(3.1) ? 3 : angle > rad(2.7) ? 2 : angle > rad(2.4) ? 1 : 0
  papi.lamps.forEach((lamp, index) => {
    const material = lamp.material as THREE.MeshStandardMaterial
    const white = index >= 4 - whiteCount
    material.color.set(white ? 0xf4f7fb : 0xd02020)
    material.emissive.set(white ? 0xf4f7fb : 0xff2020)
  })
}

function runwayLights(): THREE.InstancedMesh {
  const geometry = new THREE.SphereGeometry(0.45, 6, 6)
  const material = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd27a, emissiveIntensity: 0.7 })
  const spots: Enu[] = []
  for (const runway of RUNWAYS) {
    const step = 90
    for (let along = 0; along <= runway.lengthM; along += step) {
      spots.push(runwayPoint(runway, along, runway.widthM * 0.5 + 4))
      spots.push(runwayPoint(runway, along, -runway.widthM * 0.5 - 4))
    }
  }
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length)
  const dummy = new THREE.Object3D()
  spots.forEach((spot, index) => {
    dummy.position.set(spot.east, 0.6, spot.north)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  })
  return mesh
}

function mulberry(seed: number): () => number {
  let value = seed
  return () => {
    value |= 0
    value = (value + 0x6d2b79f5) | 0
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
