import { describe, expect, it } from 'vitest'
import { autopilotOutputs, defaultAutopilot } from './autopilot'
import { createFlightState } from './flightModel'
import { calmEnv } from './patternPilot'

describe('autothrottle', () => {
  it('adjusts throttle consistently across frame rates', () => {
    const state = createFlightState(0, 0, 0)
    state.vn = 170 * 0.514444
    const env = calmEnv()
    const ap = { ...defaultAutopilot(), autothrottle: true, speedKt: 180 }

    const runFor = (dt: number, frames: number) => {
      let throttle = 0.4
      for (let i = 0; i < frames; i += 1) {
        throttle = autopilotOutputs(state, env, ap, throttle, dt).throttle
      }
      return throttle
    }

    expect(runFor(1 / 30, 30)).toBeCloseTo(runFor(1 / 60, 60))
  })
})
