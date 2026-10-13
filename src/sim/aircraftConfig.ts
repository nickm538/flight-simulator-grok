/** Published overall size used only as a scale reference. The mesh is original. */

export const MASS_EMPTY_KG = 41400
export const PAYLOAD_KG = 8000
export const FUEL_START_KG = 5600

export const WING_AREA = 124.6
export const WING_SPAN = 35.79
export const MAC = 4.17
export const THRUST_EACH_N = 107000

/** Uncompressed distance from the CG down to the tire contact patch. */
export const CONTACT_DOWN = 2.48
export const NOSE_X = 13.2
export const MAIN_X = -1.45
export const MAIN_Z = 2.62
export const WHEEL_RADIUS = 0.56
export const NOSE_WHEEL_RADIUS = 0.36

export const K_MAIN = 3.4e6
export const K_NOSE = 1.05e6
export const C_MAIN = 2.7 * Math.sqrt(K_MAIN * 25000)
export const C_NOSE = 2.7 * Math.sqrt(K_NOSE * 8000)

export const IXX = 2.4e6
export const IYY = 6.2e6
export const IZZ = 7.4e6

export const FLAP_DETENTS = [0, 1, 2, 5, 10, 15, 25, 30, 40] as const
export type FlapDetent = (typeof FLAP_DETENTS)[number]

/** Game flap-load relief, not a certified placard. */
export const FLAP_LIMIT_KT = [340, 250, 250, 230, 210, 200, 190, 175, 162] as const

export const RHO = 1.225
export const G = 9.80665

export function designMassKg(): number {
  return MASS_EMPTY_KG + PAYLOAD_KG + FUEL_START_KG
}

export function staticSag(massKg: number): number {
  return (massKg * G) / (2 * K_MAIN + K_NOSE)
}

export function restAltitude(massKg: number): number {
  return CONTACT_DOWN - staticSag(massKg)
}

/** Game V-speeds scaled from a mid-weight reference. Not Boeing data. */
export function referenceSpeeds(massKg: number): {
  v1: number
  vr: number
  v2: number
  vapp: number
  vref: number
} {
  const s = Math.sqrt(massKg / designMassKg())
  return {
    v1: 132 * s,
    vr: 140 * s,
    v2: 146 * s,
    vapp: 138 * s,
    vref: 133 * s,
  }
}
