import { rad } from '../sim/math'
import { M_PER_FT, M_PER_NM } from '../sim/units'

/** FAA AIP AD 2 KJFK coordinates. Local east/north meters about the published ARP. */

export interface Enu {
  east: number
  north: number
}

export interface RunwayStrip {
  id: string
  lowId: string
  highId: string
  low: Enu
  high: Enu
  lengthM: number
  widthM: number
  /** True heading from the low end toward the high end, radians, clockwise from north. */
  headingTrue: number
  headingTrueDeg: number
  forward: Enu
  right: Enu
  left: Enu
}

export interface Waypoint {
  name: string
  east: number
  north: number
  altM: number
}

const ARP_LAT = dms(40, 38, 23.741)
const ARP_LON = -dms(73, 46, 43.292)

function dms(d: number, m: number, s: number): number {
  return d + m / 60 + s / 3600
}

export function latLonToEnu(lat: number, lon: number): Enu {
  const lat0 = (ARP_LAT * Math.PI) / 180
  const north = ((lat - ARP_LAT) * Math.PI * 6378137) / 180
  const east = ((lon - ARP_LON) * Math.PI * 6378137 * Math.cos(lat0)) / 180
  return { east, north }
}

function headingOf(from: Enu, to: Enu): { heading: number; length: number; forward: Enu } {
  const east = to.east - from.east
  const north = to.north - from.north
  const length = Math.hypot(east, north)
  return {
    heading: Math.atan2(east, north),
    length,
    forward: { east: east / length, north: north / length },
  }
}

function sideVectors(forward: Enu): { right: Enu; left: Enu } {
  return {
    right: { east: forward.north, north: -forward.east },
    left: { east: -forward.north, north: forward.east },
  }
}

function makeRunway(
  id: string,
  lowId: string,
  lowLat: number,
  lowLon: number,
  highId: string,
  highLat: number,
  highLon: number,
  widthFt: number,
): RunwayStrip {
  const low = latLonToEnu(lowLat, lowLon)
  const high = latLonToEnu(highLat, highLon)
  const geo = headingOf(low, high)
  const sides = sideVectors(geo.forward)
  const headingTrue = (geo.heading + Math.PI * 2) % (Math.PI * 2)
  return {
    id,
    lowId,
    highId,
    low,
    high,
    lengthM: geo.length,
    widthM: widthFt * M_PER_FT,
    headingTrue,
    headingTrueDeg: (headingTrue * 180) / Math.PI,
    forward: geo.forward,
    right: sides.right,
    left: sides.left,
  }
}

export const RUNWAY_31L = makeRunway(
  '13R/31L',
  '31L',
  dms(40, 37, 40.7799),
  -dms(73, 46, 18.4107),
  '13R',
  dms(40, 38, 54.1008),
  -dms(73, 49, 0.173),
  200,
)

export const RUNWAY_31R = makeRunway(
  '13L/31R',
  '31R',
  dms(40, 38, 37.4085),
  -dms(73, 45, 33.3818),
  '13L',
  dms(40, 39, 27.952),
  -dms(73, 47, 24.8606),
  200,
)

export const RUNWAY_4L = makeRunway(
  '04L/22R',
  '04L',
  dms(40, 37, 19.2754),
  -dms(73, 47, 8.1029),
  '22R',
  dms(40, 39, 1.8338),
  -dms(73, 45, 47.9596),
  200,
)

export const RUNWAY_4R = makeRunway(
  '04R/22L',
  '04R',
  dms(40, 37, 31.5418),
  -dms(73, 46, 13.2441),
  '22L',
  dms(40, 38, 42.8531),
  -dms(73, 45, 17.5027),
  200,
)

export const RUNWAYS: RunwayStrip[] = [RUNWAY_31L, RUNWAY_31R, RUNWAY_4L, RUNWAY_4R]

/** 31L landing threshold is displaced 3,264 ft from the pavement end. */
export const DISPLACED_31L_M = 3264 * M_PER_FT

export const FIELD_ELEVATION_FT = 13

export function alongRunway(runway: RunwayStrip, point: Enu): { along: number; cross: number } {
  const relE = point.east - runway.low.east
  const relN = point.north - runway.low.north
  return {
    along: relE * runway.forward.east + relN * runway.forward.north,
    cross: relE * runway.right.east + relN * runway.right.north,
  }
}

export function onRunway(runway: RunwayStrip, east: number, north: number, margin = 0): boolean {
  const frame = alongRunway(runway, { east, north })
  return frame.along >= -margin && frame.along <= runway.lengthM + margin && Math.abs(frame.cross) <= runway.widthM * 0.5 + margin
}

export function runwayPoint(runway: RunwayStrip, along: number, cross = 0): Enu {
  return {
    east: runway.low.east + runway.forward.east * along + runway.right.east * cross,
    north: runway.low.north + runway.forward.north * along + runway.right.north * cross,
  }
}

/** Aim point a little past the displaced threshold, where the PAPI is built. */
export function touchdown31L(): Enu {
  return runwayPoint(RUNWAY_31L, DISPLACED_31L_M + 360)
}

export interface SpawnPose {
  east: number
  north: number
  heading: number
}

/** On runway 31L, just up from the bay end, lined up for the takeoff roll. */
export function spawnPose(): SpawnPose {
  const linedUp = runwayPoint(RUNWAY_31L, 220)
  return { east: linedUp.east, north: linedUp.north, heading: RUNWAY_31L.headingTrue }
}

export interface PatternPlan {
  altitudeM: number
  offsetM: number
  waypoints: Waypoint[]
  touchdown: Enu
}

/** Left closed traffic for runway 31L. Offsets are over the bay, matching the published left pattern. */
export function patternPlan(): PatternPlan {
  const runway = RUNWAY_31L
  const altitudeM = 1500 * M_PER_FT
  const offsetM = 1.15 * M_PER_NM
  const td = touchdown31L()
  const fwd = runway.forward
  const left = runway.left
  const finalDist = altitudeM / Math.tan(rad(3))
  const point = (name: string, alongFromTd: number, leftM: number, altM: number): Waypoint => ({
    name,
    east: td.east + fwd.east * alongFromTd + left.east * leftM,
    north: td.north + fwd.north * alongFromTd + left.north * leftM,
    altM,
  })
  return {
    altitudeM,
    offsetM,
    touchdown: td,
    waypoints: [
      point('UPWIND', 2800, 0, altitudeM),
      point('CROSSWIND', 3600, offsetM, altitudeM),
      point('ABEAM', 400, offsetM, altitudeM),
      point('DOWNWIND', -finalDist * 0.55, offsetM, altitudeM * 0.78),
      point('BASE', -finalDist, offsetM * 0.45, altitudeM * 0.62),
      point('FINAL', -finalDist, 0, finalDist * Math.tan(rad(3))),
    ],
  }
}

export interface TaxiSegment {
  halfWidth: number
  points: Enu[]
}

export function taxiways(): TaxiSegment[] {
  const bay = RUNWAY_31L
  const segments: TaxiSegment[] = []
  segments.push({
    halfWidth: 14,
    points: [runwayPoint(bay, -160), runwayPoint(bay, 40)],
  })
  const parallelStart = runwayPoint(bay, -40, 115)
  const parallelEnd = runwayPoint(bay, bay.lengthM + 40, 115)
  segments.push({ halfWidth: 15, points: [parallelStart, parallelEnd] })
  for (const along of [180, 1400, 2600, 3800]) {
    segments.push({
      halfWidth: 12,
      points: [runwayPoint(bay, along, 0), runwayPoint(bay, along, 115)],
    })
  }
  const gate = gatePad()
  const mid = runwayPoint(bay, bay.lengthM * 0.42, 115)
  segments.push({
    halfWidth: 18,
    points: [mid, { east: gate.east, north: gate.north }],
  })
  return segments
}

export function gatePad(): Enu {
  const bay = RUNWAY_31L
  const north = RUNWAY_31R
  const midBay = runwayPoint(bay, bay.lengthM * 0.48)
  const midNorth = runwayPoint(north, north.lengthM * 0.45)
  return {
    east: midBay.east * 0.55 + midNorth.east * 0.45,
    north: midBay.north * 0.55 + midNorth.north * 0.45,
  }
}

export function terminalBlocks(): { center: Enu; length: number; width: number; heading: number; name: string }[] {
  const gate = gatePad()
  const heading = RUNWAY_4L.headingTrue
  const fwd = { east: Math.sin(heading), north: Math.cos(heading) }
  const names = ['T1', 'T4', 'T5', 'T8']
  const lengths = [180, 320, 200, 220]
  return names.map((name, index) => {
    const shift = (index - 1.5) * 280
    return {
      name,
      length: lengths[index] ?? 200,
      width: index === 1 ? 90 : 70,
      heading,
      center: {
        east: gate.east + fwd.east * shift,
        north: gate.north + fwd.north * shift,
      },
    }
  })
}

/** Positive values sit on the bay side of runway 31L (left traffic / Jamaica Bay). */
export function baySideMeters(east: number, north: number): number {
  const runway = RUNWAY_31L
  const relE = east - runway.low.east
  const relN = north - runway.low.north
  return relE * runway.left.east + relN * runway.left.north
}

export function isWater(east: number, north: number): boolean {
  if (baySideMeters(east, north) > 210) return true
  const west = RUNWAY_31L.high
  const relE = east - west.east
  const relN = north - west.north
  return relE * RUNWAY_31L.forward.east + relN * RUNWAY_31L.forward.north > 280 && baySideMeters(east, north) > -400
}

export interface ApproachGeometry {
  /** Meters before the aim point, positive on final. */
  along: number
  /** Meters right of the extended centerline. */
  cross: number
  desiredAlt: number
  headingTrue: number
}

export function approachGeometry(east: number, north: number): ApproachGeometry {
  const runway = RUNWAY_31L
  const td = touchdown31L()
  const relE = east - td.east
  const relN = north - td.north
  const ahead = relE * runway.forward.east + relN * runway.forward.north
  return {
    along: -ahead,
    cross: relE * runway.right.east + relN * runway.right.north,
    desiredAlt: Math.max(0, -ahead) * Math.tan(rad(3)),
    headingTrue: runway.headingTrue,
  }
}
