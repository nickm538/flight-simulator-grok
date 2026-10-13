import { describe, expect, it } from 'vitest'
import { designMassKg, restAltitude } from './aircraftConfig'
import { createFlightState, groundSpeed, iasMps, stepFlight } from './flightModel'
import { calmEnv, flyVisualPattern } from './patternPilot'
import { mpsToKt } from './units'
import { RUNWAY_31L, spawnPose } from '../world/kjfk'

const dt = 1 / 30

describe('KJFK geometry', () => {
  it('places runway 31L on the published bay-runway length and true heading', () => {
    expect(RUNWAY_31L.lengthM).toBeGreaterThan(4400)
    expect(RUNWAY_31L.lengthM).toBeLessThan(4460)
    expect(RUNWAY_31L.headingTrueDeg).toBeGreaterThan(299)
    expect(RUNWAY_31L.headingTrueDeg).toBeLessThan(303)
    expect(RUNWAY_31L.lowId).toBe('31L')
  })
})

describe('flight model', () => {
  it('rests on the gear without bouncing', () => {
    const spawn = spawnPose()
    const state = createFlightState(spawn.east, spawn.north, spawn.heading)
    const env = calmEnv()
    const start = state.alt
    let min = state.alt
    let max = state.alt
    for (let i = 0; i < 30 * 5; i += 1) {
      env.time = i * dt
      stepFlight(
        state,
        {
          pitch: 0,
          roll: 0,
          rudder: 0,
          throttle: 0,
          brake: 1,
          reverse: false,
          flapIndex: 3,
          gearDown: true,
          spoiler: 0,
          spoilerArmed: true,
          parkingBrake: true,
        },
        env,
        dt,
      )
      if (i > 60) {
        min = Math.min(min, state.alt)
        max = Math.max(max, state.alt)
      }
    }
    expect(state.crashed).toBe(false)
    expect(Math.abs(state.pitch)).toBeLessThan(0.03)
    expect(Math.abs(state.roll)).toBeLessThan(0.03)
    expect(groundSpeed(state)).toBeLessThan(0.4)
    expect(max - min).toBeLessThan(0.05)
    expect(Math.abs(state.alt - start)).toBeLessThan(0.2)
    expect(state.alt).toBeGreaterThan(restAltitude(designMassKg()) - 0.25)
  })

  it('does not rotate at taxi speed and does rotate near Vr', () => {
    const spawn = spawnPose()
    const slow = createFlightState(spawn.east, spawn.north, spawn.heading)
    const env = calmEnv()
    for (let i = 0; i < 30 * 8; i += 1) {
      env.time = i * dt
      stepFlight(
        slow,
        {
          pitch: 1,
          roll: 0,
          rudder: 0,
          throttle: 0.35,
          brake: 0,
          reverse: false,
          flapIndex: 3,
          gearDown: true,
          spoiler: 0,
          spoilerArmed: false,
          parkingBrake: false,
        },
        env,
        dt,
      )
    }
    expect(slow.pitch).toBeLessThan(0.08)
    expect(slow.onGround).toBe(true)

    const fast = createFlightState(spawn.east, spawn.north, spawn.heading)
    let rotated = false
    for (let i = 0; i < 30 * 70; i += 1) {
      env.time = i * dt
      const ias = mpsToKt(Math.max(0, iasMps(fast, env)))
      const rotating = ias > 138 || fast.pitch > 0.05
      const qCmd = rotating ? Math.max(-0.25, Math.min(0.25, (0.17 - fast.pitch) * 1.1)) : 0
      stepFlight(
        fast,
        {
          pitch: rotating ? qCmd / 0.38 : 0,
          roll: 0,
          rudder: 0,
          throttle: fast.alt > 40 ? 0.8 : 1,
          brake: 0,
          reverse: false,
          flapIndex: 3,
          gearDown: fast.alt < 30,
          spoiler: 0,
          spoilerArmed: false,
          parkingBrake: false,
        },
        env,
        dt,
      )
      if (fast.pitch > 0.12 && ias > 130) rotated = true
      if (fast.alt > 80) break
    }
    expect(rotated).toBe(true)
    expect(fast.alt).toBeGreaterThan(60)
    expect(fast.crashed).toBe(false)
  })

  it('changes groundspeed when the wind changes', () => {
    const spawn = spawnPose()
    const still = createFlightState(spawn.east, spawn.north, spawn.heading)
    const head = createFlightState(spawn.east, spawn.north, spawn.heading)
    const calm = calmEnv()
    const wind = {
      windEast: -Math.sin(spawn.heading) * 12,
      windNorth: -Math.cos(spawn.heading) * 12,
      gust: 0,
      time: 0,
    }
    for (let i = 0; i < 30 * 25; i += 1) {
      calm.time = i * dt
      wind.time = i * dt
      const controls = {
        pitch: 0,
        roll: 0,
        rudder: 0,
        throttle: 0.85,
        brake: 0,
        reverse: false,
        flapIndex: 3,
        gearDown: true,
        spoiler: 0,
        spoilerArmed: false,
        parkingBrake: false,
      }
      stepFlight(still, controls, calm, dt)
      stepFlight(head, controls, wind, dt)
    }
    expect(iasMps(head, wind)).toBeGreaterThan(groundSpeed(head) + 4)
    expect(groundSpeed(still)).toBeGreaterThan(groundSpeed(head))
  })

  it('taxis, steers, flies the 31L pattern, and lands', () => {
    const result = flyVisualPattern()
    if (!result.landed || result.crashed || !result.stopped) {
      console.log(result.trace)
    }
    expect(result.taxied).toBe(true)
    expect(result.steered).toBe(true)
    expect(result.rotated).toBe(true)
    expect(result.maxAltM).toBeGreaterThan(400)
    expect(result.crashed).toBe(false)
    expect(result.landed).toBe(true)
    expect(result.touchdownFpm).toBeGreaterThan(-900)
    expect(result.bounceM).toBeLessThan(1.4)
    expect(result.stopped).toBe(true)
    expect(result.onRunwayAtStop).toBe(true)
  })
})
