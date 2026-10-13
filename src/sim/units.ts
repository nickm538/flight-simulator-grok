export const MPS_PER_KT = 0.514444
export const M_PER_FT = 0.3048
export const M_PER_NM = 1852

export function mpsToKt(mps: number): number {
  return mps / MPS_PER_KT
}

export function ktToMps(kt: number): number {
  return kt * MPS_PER_KT
}

export function mToFt(m: number): number {
  return m / M_PER_FT
}

export function ftToM(ft: number): number {
  return ft * M_PER_FT
}

export function mpsToFpm(mps: number): number {
  return mps * 196.850394
}

/** KJFK magnetic variation, 13° west, fixed for this game. Magnetic = true + 13°. */
export const VARIATION_WEST_DEG = 13

export function trueToMag(trueDeg: number): number {
  return (trueDeg + VARIATION_WEST_DEG + 360) % 360
}

export function magToTrue(magDeg: number): number {
  return (magDeg - VARIATION_WEST_DEG + 360) % 360
}
