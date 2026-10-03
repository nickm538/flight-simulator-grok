/** Display-only engine instruments. A curve for the panel, not an engine deck. */

export interface EngineReadout {
  n1: number
  egt: number
  n2: number
  ff: number
}

export function engineReadout(n1Fraction: number, airspeed: number, side: 'L' | 'R'): EngineReadout {
  const split = side === 'L' ? 0 : -0.35
  const n1 = Math.max(0, n1Fraction * 100 + split)
  const spool = Math.max(0, (n1Fraction - 0.2) / 0.8)
  const egt = 330 + 590 * Math.pow(spool, 1.12) + Math.min(28, airspeed * 0.08)
  const n2 = 54 + 46 * Math.pow(Math.max(n1Fraction, 0), 0.9)
  const ff = (260 + 3400 * Math.pow(spool, 1.22)) * (1 + airspeed / 450)
  return { n1, egt, n2, ff }
}
