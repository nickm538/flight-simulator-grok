import {
  C_MAIN,
  C_NOSE,
  CONTACT_DOWN,
  FLAP_DETENTS,
  FLAP_LIMIT_KT,
  FUEL_START_KG,
  G,
  IXX,
  IYY,
  IZZ,
  K_MAIN,
  K_NOSE,
  MAC,
  MAIN_X,
  MAIN_Z,
  MASS_EMPTY_KG,
  NOSE_WHEEL_RADIUS,
  NOSE_X,
  PAYLOAD_KG,
  RHO,
  THRUST_EACH_N,
  WHEEL_RADIUS,
  WING_AREA,
  restAltitude,
} from './aircraftConfig'
import { engineReadout } from './engines'
import {
  add,
  aeroToWorld,
  basisFromAttitude,
  clamp,
  cross,
  dot,
  len,
  norm,
  scale,
  sub,
  type Basis,
  type Vec3,
  worldToAero,
  wrapTau,
} from './math'
import { mpsToKt } from './units'

export interface ControlInput {
  /** Nose up positive, -1..1 */
  pitch: number
  /** Right wing down positive when airborne. On the ground this steers. */
  roll: number
  /** Nose right positive. */
  rudder: number
  /** 0 idle, 1 takeoff thrust. */
  throttle: number
  /** 0..1 wheel brakes. */
  brake: number
  reverse: boolean
  flapIndex: number
  gearDown: boolean
  /** Manual speedbrake 0..1. */
  spoiler: number
  spoilerArmed: boolean
  parkingBrake: boolean
}

export interface SimEnvironment {
  windEast: number
  windNorth: number
  /** Extra gust amplitude in m/s. Tied to wind and visibility by the caller. */
  gust: number
  time: number
}

export interface FlightState {
  east: number
  north: number
  alt: number
  ve: number
  vn: number
  vu: number
  pitch: number
  roll: number
  heading: number
  p: number
  q: number
  r: number
  throttle: number
  n1: number
  flapIndex: number
  flapDeg: number
  gear: number
  spoiler: number
  fuelKg: number
  wheelOmega: number
  noseOmega: number
  onGround: boolean
  noseWow: boolean
  mainWow: boolean
  hasLiftedOff: boolean
  strutCompress: number
  dust: boolean
  crashed: boolean
  crashReason: string
  advisory: string
  airborneSeconds: number
}

export const SUBSTEPS = 4

export function massOf(state: FlightState): number {
  return MASS_EMPTY_KG + PAYLOAD_KG + state.fuelKg
}

export function createFlightState(east: number, north: number, heading: number): FlightState {
  const fuelKg = FUEL_START_KG
  const mass = MASS_EMPTY_KG + PAYLOAD_KG + fuelKg
  return {
    east,
    north,
    alt: restAltitude(mass),
    ve: 0,
    vn: 0,
    vu: 0,
    pitch: 0,
    roll: 0,
    heading,
    p: 0,
    q: 0,
    r: 0,
    throttle: 0,
    n1: 0.22,
    flapIndex: 3,
    flapDeg: 5,
    gear: 1,
    spoiler: 0,
    fuelKg,
    wheelOmega: 0,
    noseOmega: 0,
    onGround: true,
    noseWow: true,
    mainWow: true,
    hasLiftedOff: false,
    strutCompress: 0.07,
    dust: false,
    crashed: false,
    crashReason: '',
    advisory: '',
    airborneSeconds: 0,
  }
}

export function iasMps(state: FlightState, env: SimEnvironment): number {
  const basis = basisFromAttitude(state.heading, state.pitch, state.roll)
  const air = airVelocity(state, env)
  return Math.max(0, dot(air, basis.forward))
}

export function groundSpeed(state: FlightState): number {
  return Math.hypot(state.ve, state.vn)
}

function airVelocity(state: FlightState, env: SimEnvironment): Vec3 {
  const gustE = env.gust * Math.sin(env.time * 0.63 + 0.4)
  const gustN = env.gust * Math.cos(env.time * 0.51)
  return {
    x: state.ve - env.windEast - gustE,
    y: state.vu,
    z: state.vn - env.windNorth - gustN,
  }
}

function flapLift(deg: number): number {
  if (deg <= 0) return 0
  if (deg <= 5) return 0.3 * (deg / 5)
  if (deg <= 15) return 0.3 + 0.34 * ((deg - 5) / 10)
  if (deg <= 30) return 0.64 + 0.4 * ((deg - 15) / 15)
  return 1.04 + 0.16 * ((deg - 30) / 10)
}

function flapDrag(deg: number): number {
  return 0.01 * (deg / 5) + 0.07 * Math.pow(deg / 40, 1.15)
}

interface GearHit {
  aeroX: number
  aeroY: number
  k: number
  c: number
  nose: boolean
}

const GEAR: GearHit[] = [
  { aeroX: NOSE_X, aeroY: 0, k: K_NOSE, c: C_NOSE, nose: true },
  { aeroX: MAIN_X, aeroY: -MAIN_Z, k: K_MAIN, c: C_MAIN, nose: false },
  { aeroX: MAIN_X, aeroY: MAIN_Z, k: K_MAIN, c: C_MAIN, nose: false },
]

function worldOmega(state: FlightState, basis: Basis): Vec3 {
  return add(
    add(scale(basis.forward, -state.p), scale(basis.right, -state.q)),
    scale(basis.up, state.r),
  )
}

function applyWorldForce(
  force: Vec3,
  point: Vec3,
  cg: Vec3,
  basis: Basis,
  acc: Vec3,
  moment: Vec3,
  mass: number,
): void {
  acc.x += force.x / mass
  acc.y += force.y / mass
  acc.z += force.z / mass
  const tau = cross(sub(point, cg), force)
  moment.x += -dot(tau, basis.forward)
  moment.y += -dot(tau, basis.right)
  moment.z += dot(tau, basis.up)
}

export function stepFlight(state: FlightState, input: ControlInput, env: SimEnvironment, dt: number): void {
  if (state.crashed) return
  const steps = SUBSTEPS
  const h = Math.min(Math.max(dt, 0), 0.05) / steps
  let time = env.time
  for (let i = 0; i < steps; i += 1) {
    stepOnce(state, input, { ...env, time }, h)
    time += h
  }
}

function stepOnce(state: FlightState, input: ControlInput, env: SimEnvironment, dt: number): void {
  const mass = massOf(state)
  const weight = mass * G

  const throttle = clamp(input.throttle, 0, 1)
  state.throttle = throttle
  const n1Target = 0.22 + 0.78 * throttle
  const spool = 1 - Math.exp(-dt / 2.3)
  state.n1 += (n1Target - state.n1) * spool

  const iasKt = mpsToKt(Math.max(0, iasMps(state, env)))
  let flapIndex = clamp(Math.round(input.flapIndex), 0, FLAP_DETENTS.length - 1)
  const movingDown = FLAP_DETENTS[flapIndex] > state.flapDeg + 0.1
  const limit = FLAP_LIMIT_KT[flapIndex]
  if (movingDown && iasKt > limit) {
    flapIndex = state.flapIndex
    state.advisory = `Flap load relief. ${FLAP_DETENTS[flapIndex]} is limited to ${limit} kt in this model.`
  } else if (state.advisory.startsWith('Flap load')) {
    state.advisory = ''
  }
  state.flapIndex = flapIndex
  const flapTarget = FLAP_DETENTS[flapIndex]
  const flapStep = 6 * dt
  state.flapDeg += clamp(flapTarget - state.flapDeg, -flapStep, flapStep)

  if (input.gearDown) {
    state.gear = Math.min(1, state.gear + dt / 7)
  } else if (!state.onGround) {
    state.gear = Math.max(0, state.gear - dt / 7)
  } else {
    state.advisory = state.advisory || 'Gear stays down on the ground.'
  }

  let spoilerTarget = clamp(input.spoiler, 0, 1)
  if (input.spoilerArmed && state.hasLiftedOff && state.mainWow && throttle < 0.22 && !input.reverse) {
    spoilerTarget = 1
  }
  state.spoiler += clamp(spoilerTarget - state.spoiler, -dt / 1.2, dt / 1.2)

  const basis = basisFromAttitude(state.heading, state.pitch, state.roll)
  const air = airVelocity(state, env)
  const airSpeed = len(air)
  const va = worldToAero(air, basis)
  const alpha = Math.atan2(va.z, Math.max(va.x, 2))
  const beta = Math.atan2(va.y, Math.max(8, Math.hypot(va.x, va.z)))

  const flapCl = flapLift(state.flapDeg)
  const qBar = 0.5 * RHO * airSpeed * airSpeed
  let cl = 0.18 + 4.8 * alpha + flapCl - 0.58 * state.spoiler
  const clMax = 1.18 + flapCl * 1.12
  const stall = 0.32 - state.flapDeg * 0.0022
  if (alpha > stall) {
    const over = (alpha - stall) / 0.1
    cl = Math.min(cl, clMax) * Math.max(0.42, 1 - 0.7 * over)
  } else {
    cl = clamp(cl, -0.4, clMax)
  }
  const induced = 0.044 * cl * cl
  const ge = Math.exp(-Math.max(state.alt, 0) / 20)
  cl *= 1 + 0.1 * ge
  let cd =
    0.02 +
    induced * (1 - 0.22 * ge) +
    flapDrag(state.flapDeg) +
    0.028 * state.gear +
    0.085 * state.spoiler
  if (alpha > stall) cd += 0.12

  const airHat = airSpeed > 1 ? scale(air, 1 / airSpeed) : basis.forward
  let liftDir = sub(basis.up, scale(airHat, dot(basis.up, airHat)))
  if (len(liftDir) < 0.2) liftDir = basis.up
  else liftDir = norm(liftDir)

  const lift = qBar * WING_AREA * cl
  const drag = qBar * WING_AREA * cd
  const frac = Math.max(0, (state.n1 - 0.22) / 0.78)
  let thrust = 2 * THRUST_EACH_N * (0.045 + 0.955 * frac)
  thrust *= 1 - 0.2 * Math.min(1, airSpeed / 170)
  if (input.reverse && state.onGround) thrust *= -0.55

  const force = add(add(scale(liftDir, lift), scale(airHat, -drag)), scale(basis.forward, thrust))
  force.y -= weight

  const cg: Vec3 = { x: state.east, y: state.alt, z: state.north }
  const acc: Vec3 = { x: force.x / mass, y: force.y / mass, z: force.z / mass }
  const moment = vZero()
  const omega = worldOmega(state, basis)

  let noseLoad = 0
  let mainLoad = 0
  let maxPen = 0
  state.noseWow = false
  state.mainWow = false

  for (const gear of GEAR) {
    const down = CONTACT_DOWN
    const point = add(cg, aeroToWorld(gear.aeroX, gear.aeroY, down, basis))
    const pen = -point.y
    if (pen <= 0) continue
    maxPen = Math.max(maxPen, pen)
    const r = sub(point, cg)
    const pointVel = add(vOf(state), cross(omega, r))
    let normal = gear.k * pen - gear.c * pointVel.y
    if (normal < 0) normal = 0
    normal = Math.min(normal, weight * 5)
    if (gear.nose) {
      noseLoad += normal
      if (normal > 2000) state.noseWow = true
    } else {
      mainLoad += normal
      if (normal > 4000) state.mainWow = true
    }
    applyWorldForce({ x: 0, y: normal, z: 0 }, point, cg, basis, acc, moment, mass)
  }
  state.onGround = state.mainWow || state.noseWow
  state.strutCompress = clamp(maxPen, 0, 0.45)

  if (state.pitch > 0.2 && state.mainWow) {
    const tail = add(cg, aeroToWorld(-16.5, 0, 0.4, basis))
    const tailPen = -tail.y
    if (tailPen > 0) {
      applyWorldForce({ x: 0, y: Math.min(weight * 2, 8e5 * tailPen), z: 0 }, tail, cg, basis, acc, moment, mass)
      state.advisory = 'Tail skid.'
    }
  }

  const gs = Math.hypot(state.ve, state.vn)
  if (state.onGround) {
    const mu = 0.02 + clamp(input.brake, 0, 1) * 0.48 + (input.parkingBrake ? 0.9 : 0)
    const support = clamp((noseLoad + mainLoad) / weight, 0, 1.4)
    if (gs > 0.2) {
      const decel = Math.min(gs / dt, mu * G * Math.max(0.35, support))
      acc.x -= (state.ve / gs) * decel
      acc.z -= (state.vn / gs) * decel
    }
  }

  state.ve += acc.x * dt
  state.vu += acc.y * dt
  state.vn += acc.z * dt

  if (state.onGround) {
    const lateral = state.ve * basis.right.x + state.vn * basis.right.z
    const bleed = Math.min(1, dt * 8)
    state.ve -= basis.right.x * lateral * bleed
    state.vn -= basis.right.z * lateral * bleed
    if ((input.parkingBrake || input.brake > 0.8) && gs < 0.6 && throttle < 0.2) {
      state.ve = 0
      state.vn = 0
    }
  }

  state.east += state.ve * dt
  state.alt += state.vu * dt
  state.north += state.vn * dt
  if (state.alt < -0.5 && state.onGround) state.alt = 0

  const airBlend = airborneBlend(state)
  const vSafe = Math.max(airSpeed, 12)
  let pitchMoment = moment.y
  if (airBlend < 0.9) {
    const elevator = clamp(input.pitch, -1, 1)
    const cm =
      -1.2 * alpha -
      (16 * state.q * MAC) / (2 * vSafe) +
      0.9 * elevator
    pitchMoment += qBar * WING_AREA * MAC * cm + thrust * 0.12
  }
  const qFromMoment = pitchMoment / IYY
  const qCmd = input.pitch * 0.38
  const qFromSas = (qCmd - state.q) * 5.5
  state.q += (qFromMoment * (1 - airBlend) + qFromSas * airBlend) * dt

  const pCmd = state.onGround ? 0 : input.roll * 0.9
  const pSas = (pCmd - state.p) * 5
  const pGround = state.onGround ? -state.p * 8 - state.roll * 14 : 0
  state.p += ((moment.x / IXX) * (1 - airBlend) + pSas + pGround) * dt

  if (state.onGround && state.noseWow) {
    const steer = clamp(input.rudder + input.roll, -1, 1)
    const steerAngle = steer * 0.7
    const wheelbase = NOSE_X - MAIN_X
    const speed = Math.max(gs, 0)
    const kinematic = (speed / wheelbase) * Math.tan(steerAngle)
    const pivot = speed < 7 ? steer * 0.7 * (1 - speed / 7) : 0
    const yawCmd = kinematic + pivot
    state.r += (yawCmd - state.r) * Math.min(1, dt * 10)
  } else {
    const coordGain = state.alt > 45 ? 1 : clamp(state.alt / 45, 0, 1)
    const coord = (G * Math.sin(clamp(state.roll, -0.7, 0.7))) / Math.max(airSpeed, 32)
    const targetR = coord * coordGain + input.rudder * 0.65 + beta * 1.35
    state.r += (targetR - state.r) * Math.min(1, dt * 3.2)
    state.r += (moment.z / IZZ) * dt * 0.15
  }

  const cth = Math.max(0.3, Math.cos(state.pitch))
  const sph = Math.sin(state.roll)
  const cph = Math.cos(state.roll)
  state.pitch += (state.q * cph - state.r * sph) * dt
  state.roll += (state.p + Math.tan(clamp(state.pitch, -0.45, 0.45)) * (state.q * sph + state.r * cph)) * dt
  state.heading = wrapTau(state.heading + ((state.q * sph + state.r * cph) / cth) * dt)
  state.pitch = clamp(state.pitch, -0.45, 0.55)
  state.roll = clamp(state.roll, -1.1, 1.1)
  state.p = clamp(state.p, -1.5, 1.5)
  state.q = clamp(state.q, -0.8, 0.8)
  state.r = clamp(state.r, -1.2, 1.2)

  const forwardSpeed = state.ve * basis.forward.x + state.vn * basis.forward.z
  if (state.onGround) {
    state.wheelOmega = forwardSpeed / WHEEL_RADIUS
    state.noseOmega = forwardSpeed / NOSE_WHEEL_RADIUS
  } else {
    state.wheelOmega *= Math.exp(-dt * 0.45)
    state.noseOmega *= Math.exp(-dt * 0.45)
  }

  if (!state.onGround && state.alt > restAltitude(mass) + 6) {
    state.hasLiftedOff = true
    state.airborneSeconds += dt
  }
  state.dust = state.onGround && state.n1 > 0.72 && gs > 12

  const ff = engineReadout(state.n1, airSpeed, 'L').ff + engineReadout(state.n1, airSpeed, 'R').ff
  state.fuelKg = Math.max(600, state.fuelKg - (ff / 3600) * dt)

  if (!Number.isFinite(state.alt) || !Number.isFinite(state.pitch)) {
    state.crashed = true
    state.crashReason = 'The flight model diverged.'
    return
  }
  if (state.hasLiftedOff && state.onGround && state.vu < -6.2) {
    state.crashed = true
    state.crashReason = 'Hard landing. Vertical speed was too high.'
  } else if (state.hasLiftedOff && state.onGround && Math.abs(state.roll) > 0.42) {
    state.crashed = true
    state.crashReason = 'Wing strike.'
  } else if (state.onGround && state.pitch > 0.32) {
    state.crashed = true
    state.crashReason = 'Tail strike.'
  }
}

function airborneBlend(state: FlightState): number {
  const rest = restAltitude(massOf(state))
  const byAlt = clamp((state.alt - rest - 1.1) / 2.4, 0, 1)
  const rotating = !state.noseWow && state.pitch > 0.1 ? 1 : 0
  return Math.max(byAlt, rotating)
}

function vOf(state: FlightState): Vec3 {
  return { x: state.ve, y: state.vu, z: state.vn }
}

function vZero(): Vec3 {
  return { x: 0, y: 0, z: 0 }
}
