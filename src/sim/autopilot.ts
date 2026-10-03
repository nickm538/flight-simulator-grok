import type { FlightState, SimEnvironment } from './flightModel'
import { iasMps } from './flightModel'
import { clamp, rad, wrapPi } from './math'
import { mpsToKt } from './units'

export type AltitudeMode = 'alt' | 'vs'

export interface AutopilotCommand {
  engaged: boolean
  autothrottle: boolean
  /** Magnetic heading bug, degrees. */
  headingMag: number
  speedKt: number
  altitudeFt: number
  vsFpm: number
  altitudeMode: AltitudeMode
}

export interface AutopilotOutput {
  pitch: number
  roll: number
  throttle: number
}

export function defaultAutopilot(): AutopilotCommand {
  return {
    engaged: false,
    autothrottle: false,
    headingMag: 314,
    speedKt: 180,
    altitudeFt: 1500,
    vsFpm: 0,
    altitudeMode: 'alt',
  }
}

/**
 * Heading, altitude, and speed holds for the mode control panel.
 * Outputs are the same stick and throttle axes the player uses.
 */
export function autopilotOutputs(
  state: FlightState,
  env: SimEnvironment,
  ap: AutopilotCommand,
  throttleNow: number,
): AutopilotOutput {
  const trueDeg = (ap.headingMag - 13 + 360) % 360
  const err = wrapPi(rad(trueDeg) - state.heading)
  const bankCmd = clamp(err * 1.15, -0.45, 0.45)
  const roll = state.onGround ? 0 : clamp((bankCmd - state.roll) * 2.4, -1, 1)

  const altM = ap.altitudeFt * 0.3048
  const vsCmd =
    ap.altitudeMode === 'vs' ? clamp(ap.vsFpm * 0.00508, -8, 8) : clamp((altM - state.alt) * 0.42, -7, 8)
  const gs = Math.max(45, Math.hypot(state.ve, state.vn))
  const fpa = Math.atan2(vsCmd, gs)
  const vsErr = vsCmd - state.vu
  const pitchTarget = clamp(fpa + vsErr * 0.04, -0.14, 0.16)
  const qCmd = clamp((pitchTarget - state.pitch) * 1.35, -0.3, 0.3)
  const pitch = state.onGround ? 0 : clamp(qCmd / 0.38, -1, 1)

  const ias = mpsToKt(Math.max(0, iasMps(state, env)))
  const speedErr = ap.speedKt - ias
  const throttle = clamp(throttleNow + speedErr * 0.015, 0.05, 1)

  return {
    pitch: ap.engaged ? pitch : 0,
    roll: ap.engaged ? roll : 0,
    throttle: ap.autothrottle ? throttle : throttleNow,
  }
}
