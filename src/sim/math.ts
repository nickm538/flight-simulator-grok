/** East, up, north. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Basis {
  forward: Vec3
  up: Vec3
  right: Vec3
}

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function norm(a: Vec3): Vec3 {
  const l = len(a)
  if (l < 1e-8) return { x: 0, y: 1, z: 0 }
  return scale(a, 1 / l)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function wrapPi(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2)
  return t < 0 ? t + Math.PI * 2 - Math.PI : t - Math.PI
}

export function wrapTau(a: number): number {
  const t = a % (Math.PI * 2)
  return t < 0 ? t + Math.PI * 2 : t
}

export function deg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function rad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Aircraft basis. Heading is clockwise from true north.
 * Pitch is nose-up. Roll is right-wing-down.
 * Local visual axes match this: +Z forward, +Y up, +X right.
 */
export function basisFromAttitude(heading: number, pitch: number, roll: number): Basis {
  const ch = Math.cos(heading)
  const sh = Math.sin(heading)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const forward = { x: sh * cp, y: sp, z: ch * cp }
  const right = {
    x: ch * cr + sh * sp * sr,
    y: -cp * sr,
    z: -sh * cr + ch * sp * sr,
  }
  const up = cross(forward, right)
  return { forward, up, right }
}

export function worldToAero(v: Vec3, b: Basis): Vec3 {
  return {
    x: dot(v, b.forward),
    y: dot(v, b.right),
    z: -dot(v, b.up),
  }
}

export function aeroToWorld(ax: number, ay: number, az: number, b: Basis): Vec3 {
  return add(add(scale(b.forward, ax), scale(b.right, ay)), scale(b.up, -az))
}
