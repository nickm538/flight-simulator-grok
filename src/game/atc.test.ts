import { describe, expect, it } from 'vitest'
import { Atc } from './atc'
import { weatherPreset, windField } from './weather'

const ground = {
  onRunway: false,
  aligned: false,
  airborne: false,
  onGround: true,
  iasKt: 0,
  altFt: 13,
  nearGate: false,
  weather: weatherPreset('bay'),
}

describe('scripted ATC', () => {
  it('clears taxi, takeoff, landing, and the gate with phase-matched replies', () => {
    const atc = new Atc()
    expect(atc.menu().some((item) => item.id === 'taxi')).toBe(true)
    expect(atc.menu().some((item) => item.id === 'gate')).toBe(true)

    atc.choose('taxi', ground)
    expect(atc.phase).toBe('taxi-out')
    expect(atc.lastClearance).toContain('taxi runway 31L')

    atc.choose('takeoff', ground)
    expect(atc.lastClearance).toContain('not lined up')

    atc.choose('takeoff', { ...ground, onRunway: true, aligned: true, iasKt: 0 })
    expect(atc.phase).toBe('cleared-takeoff')
    expect(atc.lastClearance).toContain('cleared for takeoff')

    const airborne = { ...ground, onRunway: false, aligned: true, airborne: true, onGround: false, iasKt: 160, altFt: 800 }
    atc.observe(airborne)
    expect(atc.phase).toBe('airborne')

    atc.choose('closed-traffic', airborne)
    expect(atc.lastClearance).toContain('left closed traffic')

    atc.choose('land', { ...airborne, iasKt: 190, altFt: 1600 })
    expect(atc.phase).toBe('cleared-land')
    expect(atc.lastClearance).toContain('cleared to land')
    expect(atc.lastClearance.toLowerCase()).toContain('speed')

    atc.choose('go-around', airborne)
    expect(atc.phase).toBe('go-around')
    expect(atc.lastClearance).toContain('go around')

    atc.choose('gate', airborne)
    expect(atc.lastClearance).toContain('B12')

    atc.observe({ ...ground, onGround: true, airborne: false, iasKt: 40, altFt: 13 })
    expect(atc.phase).toBe('rollout')
    atc.choose('gate', { ...ground, nearGate: true, iasKt: 5 })
    expect(atc.phase).toBe('at-gate')
    expect(atc.lastClearance).toContain('B12')
  })
})

describe('local weather', () => {
  it('turns magnetic wind into a model vector and ties gusts to visibility', () => {
    const bay = windField(weatherPreset('bay'))
    const haze = windField(weatherPreset('haze'))
    const calm = windField(weatherPreset('calm'))
    expect(Math.hypot(bay.east, bay.north)).toBeGreaterThan(3)
    expect(haze.gust).toBeGreaterThan(bay.gust)
    expect(calm.gust).toBeLessThan(haze.gust)
  })
})
