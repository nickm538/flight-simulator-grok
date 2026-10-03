import { referenceSpeeds } from './aircraftConfig'
import type { ControlInput, FlightState, SimEnvironment } from './flightModel'
import { createFlightState, groundSpeed, iasMps, massOf, stepFlight } from './flightModel'
import { clamp, rad, wrapPi } from './math'
import { mpsToFpm, mpsToKt } from './units'
import { RUNWAY_31L, approachGeometry, onRunway, patternPlan, spawnPose } from '../world/kjfk'

export interface PatternResult {
  landed: boolean
  crashed: boolean
  crashReason: string
  maxAltM: number
  rotated: boolean
  touchdownFpm: number
  bounceM: number
  stopped: boolean
  onRunwayAtStop: boolean
  taxied: boolean
  steered: boolean
  trace: string
}

const DT = 1 / 30

type PilotPhase =
  | 'taxi'
  | 'wiggle'
  | 'realign'
  | 'roll'
  | 'rotate'
  | 'climb'
  | 'cross'
  | 'downwind'
  | 'base'
  | 'final'
  | 'flare'
  | 'stop'

export function flyVisualPattern(env: SimEnvironment = calmEnv()): PatternResult {
  const spawn = spawnPose()
  const state = createFlightState(spawn.east, spawn.north, spawn.heading)
  const speeds = referenceSpeeds(massOf(state))
  const plan = patternPlan()
  const trace: string[] = []
  let phase: PilotPhase = 'taxi'
  let maxAlt = 0
  let rotated = false
  let touchdownFpm = 0
  let touchdownAlt = 0
  let bounce = 0
  let landed = false
  let taxied = false
  let steered = false
  let headingAtWiggle = state.heading
  let lastPhase: PilotPhase = 'taxi'
  let throttle = 0
  const total = 14 * 60 * 30

  const input = (): ControlInput => ({
    pitch: 0,
    roll: 0,
    rudder: 0,
    throttle,
    brake: 0,
    reverse: false,
    flapIndex: state.flapIndex,
    gearDown: true,
    spoiler: 0,
    spoilerArmed: true,
    parkingBrake: false,
  })

  const log = (t: number) => {
    if (t % 10 > DT * 1.5 && trace.length > 0 && trace.length % 8 !== 0) return
    trace.push(
      `${phase} t=${t.toFixed(0)} alt=${state.alt.toFixed(0)} ias=${mpsToKt(Math.max(0, iasMps(state, env))).toFixed(0)} hdg=${((state.heading * 180) / Math.PI).toFixed(0)} pitch=${((state.pitch * 180) / Math.PI).toFixed(1)} vs=${state.vu.toFixed(1)} gs=${groundSpeed(state).toFixed(0)}`,
    )
  }

  for (let step = 0; step < total; step += 1) {
    const t = step * DT
    env.time = t
    maxAlt = Math.max(maxAlt, state.alt)
    const controls = input()
    const ias = mpsToKt(Math.max(0, iasMps(state, env)))
    const geo = approachGeometry(state.east, state.north)

    if (phase === 'taxi') {
      throttle = 0.38
      controls.throttle = throttle
      controls.pitch = 0
      controls.roll = 0
      if (groundSpeed(state) > 6 && Math.hypot(state.east - spawn.east, state.north - spawn.north) > 35) {
        taxied = true
        phase = 'wiggle'
        headingAtWiggle = state.heading
      }
    } else if (phase === 'wiggle') {
      throttle = 0.3
      controls.throttle = throttle
      controls.roll = 0.9
      if (Math.abs(wrapPi(state.heading - headingAtWiggle)) > rad(8)) {
        steered = true
        phase = 'realign'
      }
    } else if (phase === 'realign') {
      throttle = 0.34
      controls.throttle = throttle
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue)
      const linedUp = Math.abs(wrapPi(state.heading - RUNWAY_31L.headingTrue)) < rad(4)
      const on = onRunway(RUNWAY_31L, state.east, state.north, 8)
      if (linedUp && on && groundSpeed(state) > 4) phase = 'roll'
      if (t > 90 && linedUp && Math.abs(approachGeometry(state.east, state.north).cross) < 25) phase = 'roll'
    } else if (phase === 'roll') {
      throttle = 1
      controls.throttle = throttle
      controls.flapIndex = 3
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue) * 0.4
      controls.pitch = 0
      if (ias > speeds.vr) phase = 'rotate'
    } else if (phase === 'rotate') {
      throttle = 1
      controls.throttle = throttle
      controls.pitch = state.pitch < rad(11) ? 0.85 : pitchHold(state, rad(10))
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue) * 0.25
      if (state.pitch > rad(6)) rotated = true
      if (state.alt > 25 && state.vu > 1) phase = 'climb'
    } else if (phase === 'climb') {
      controls.gearDown = state.alt > 45 ? false : true
      controls.flapIndex = state.alt > 90 ? 0 : 3
      throttle = speedHold(ias, 180, state.alt > 50 ? throttle : 0.9, DT)
      controls.throttle = throttle
      controls.pitch = state.alt < plan.altitudeM - 50 ? pitchHold(state, rad(8)) : altHold(state, plan.altitudeM)
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue)
      if (state.alt > plan.altitudeM - 40 && ias < 200 && geo.along < -1600) phase = 'cross'
    } else if (phase === 'cross') {
      const leg = headingPlus(-90)
      throttle = speedHold(ias, 180, throttle, DT)
      controls.throttle = throttle
      controls.gearDown = false
      controls.flapIndex = 0
      controls.pitch = altHold(state, plan.altitudeM)
      controls.roll = steerToward(state, leg)
      if (Math.abs(wrapPi(leg - state.heading)) < rad(20) && geo.cross < -1750) phase = 'downwind'
    } else if (phase === 'downwind') {
      const leg = headingPlus(180)
      const descending = geo.along > -200
      const targetAlt = descending
        ? clamp(Math.max(geo.along, 0) * Math.tan(rad(3)) + 80, 240, plan.altitudeM)
        : plan.altitudeM
      throttle = speedHold(ias, descending ? 160 : 175, throttle, DT)
      controls.throttle = throttle
      controls.gearDown = geo.along > 2500
      controls.flapIndex = geo.along > 2500 ? 5 : geo.along > 400 ? 3 : 0
      controls.pitch = altHold(state, targetAlt)
      controls.roll = steerToward(state, leg)
      if (Math.abs(wrapPi(leg - state.heading)) < rad(25) && geo.along > 4300 && state.alt < 360) phase = 'base'
    } else if (phase === 'base') {
      const leg = headingPlus(90)
      throttle = speedHold(ias, speeds.vapp + 8, throttle, DT)
      controls.throttle = throttle
      controls.gearDown = true
      controls.flapIndex = 7
      controls.pitch = altHold(state, clamp(geo.desiredAlt + 30, 180, 320))
      controls.roll = steerToward(state, leg)
      if (Math.abs(wrapPi(leg - state.heading)) < rad(30) && geo.cross > -1200) phase = 'final'
    } else if (phase === 'final') {
      controls.gearDown = true
      controls.flapIndex = 7
      throttle = speedHold(ias, speeds.vapp, throttle, DT)
      controls.throttle = Math.min(throttle, 0.75)
      const intercept = clamp(-geo.cross * 0.0009, -0.35, 0.35)
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue + intercept)
      controls.pitch = glidePitch(state, geo.desiredAlt)
      if (state.alt < 16 && Math.abs(geo.cross) < 80 && geo.along < 600) phase = 'flare'
      if (state.onGround && state.hasLiftedOff) phase = 'stop'
    } else if (phase === 'flare') {
      controls.gearDown = true
      controls.flapIndex = 7
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue + clamp(-geo.cross * 0.001, -0.2, 0.2))
      controls.pitch = pitchHold(state, state.alt < 7 ? rad(5) : rad(3.5))
      throttle = state.alt < 9 ? 0.02 : 0.18
      controls.throttle = throttle
      if (state.onGround && state.hasLiftedOff) phase = 'stop'
    } else if (phase === 'stop') {
      if (!landed) {
        landed = true
        touchdownFpm = mpsToFpm(state.vu)
        touchdownAlt = state.alt
      }
      bounce = Math.max(bounce, state.alt - touchdownAlt)
      controls.pitch = state.pitch > rad(2) ? -0.35 : 0
      controls.roll = steerToward(state, RUNWAY_31L.headingTrue) * 0.5
      controls.throttle = 0
      controls.brake = 1
      controls.reverse = groundSpeed(state) > 18
      controls.gearDown = true
      controls.spoiler = 1
      throttle = 0
      if (groundSpeed(state) < 6) break
    }

    if (phase !== lastPhase) {
      trace.push(
        `-> ${phase} t=${t.toFixed(0)} alt=${state.alt.toFixed(0)} along=${geo.along.toFixed(0)} cross=${geo.cross.toFixed(0)} ias=${ias.toFixed(0)} hdg=${((state.heading * 180) / Math.PI).toFixed(0)}`,
      )
      lastPhase = phase
    }
    stepFlight(state, controls, env, DT)
    if (step % 450 === 0) log(t)
    if (state.crashed) {
      trace.push(`CRASH ${state.crashReason}`)
      break
    }
  }

  const stopped = landed && groundSpeed(state) < 8
  return {
    landed,
    crashed: state.crashed,
    crashReason: state.crashReason,
    maxAltM: maxAlt,
    rotated,
    touchdownFpm,
    bounceM: bounce,
    stopped,
    onRunwayAtStop: stopped && onRunway(RUNWAY_31L, state.east, state.north, 40),
    taxied,
    steered,
    trace: trace.join('\n'),
  }
}

function steerToward(state: FlightState, heading: number): number {
  if (state.onGround && !state.hasLiftedOff) {
    const err = wrapPi(heading - state.heading)
    return clamp(err * 2.4, -1, 1)
  }
  const err = wrapPi(heading - state.heading)
  const bankCmd = clamp(err * 1.05, -0.42, 0.42)
  return clamp((bankCmd - state.roll) * 2.3, -1, 1)
}

function pitchHold(state: FlightState, pitch: number): number {
  const qCmd = clamp((pitch - state.pitch) * 1.2, -0.3, 0.3)
  return clamp(qCmd / 0.38, -1, 1)
}

function altHold(state: FlightState, alt: number): number {
  const vs = clamp((alt - state.alt) * 0.4, -6, 8)
  return vsHold(state, vs)
}

function vsHold(state: FlightState, vs: number): number {
  const vsErr = vs - state.vu
  const pitch = clamp(state.pitch + vsErr * 0.09, -0.08, 0.18)
  return pitchHold(state, pitch)
}

function glidePitch(state: FlightState, desiredAlt: number): number {
  const altErr = state.alt - desiredAlt
  const gs = Math.max(50, groundSpeed(state))
  const vs = -gs * Math.tan(rad(3))
  const vsTarget = clamp(vs - altErr * 0.22, -6, -0.3)
  const pitchTarget = clamp(rad(2.2) + (vsTarget - state.vu) * 0.045 - altErr * 0.0015, rad(-2), rad(8))
  return pitchHold(state, pitchTarget)
}

function headingPlus(deltaDeg: number): number {
  return (RUNWAY_31L.headingTrue + rad(deltaDeg) + Math.PI * 4) % (Math.PI * 2)
}

function speedHold(iasKt: number, target: number, throttle: number, dt: number): number {
  return clamp(throttle + (target - iasKt) * 0.08 * dt, 0, 1)
}

export function calmEnv(): SimEnvironment {
  return { windEast: 0, windNorth: 0, gust: 0, time: 0 }
}
