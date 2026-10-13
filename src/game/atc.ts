import type { Weather } from './weather'
import { windPhrase } from './weather'

export type AtcPhase =
  | 'parked'
  | 'taxi-out'
  | 'lined-up'
  | 'cleared-takeoff'
  | 'airborne'
  | 'closed-traffic'
  | 'cleared-land'
  | 'go-around'
  | 'rollout'
  | 'taxi-in'
  | 'at-gate'

export interface AtcItem {
  id: string
  label: string
}

export interface AtcLine {
  who: 'you' | 'atc'
  text: string
}

export interface AtcContext {
  onRunway: boolean
  aligned: boolean
  airborne: boolean
  onGround: boolean
  iasKt: number
  altFt: number
  nearGate: boolean
  weather: Weather
}

const CALL = 'Canyon 318'

export class Atc {
  phase: AtcPhase = 'parked'
  lines: AtcLine[] = []
  lastClearance = ''
  private airborneLatch = false

  constructor() {
    this.say(
      'atc',
      'Kennedy Ground 121.9. Canyon 318, you are on runway 31L at the bay end, lined up. Advise ready for takeoff, or request taxi.',
    )
  }

  menu(): AtcItem[] {
    const follow = this.followUps()
    switch (this.phase) {
      case 'parked':
      case 'at-gate':
        return [
          { id: 'taxi', label: 'Request taxi' },
          { id: 'takeoff', label: 'Request takeoff' },
          { id: 'land', label: 'Request landing' },
          { id: 'gate', label: 'Request gate' },
          ...follow,
        ]
      case 'taxi-out':
      case 'taxi-in':
        return [
          { id: 'taxi', label: 'Request taxi' },
          { id: 'progressive', label: 'Request progressive' },
          { id: 'takeoff', label: 'Request takeoff' },
          { id: 'gate', label: 'Request gate' },
          { id: 'land', label: 'Request landing' },
          ...follow,
        ]
      case 'lined-up':
        return [
          { id: 'takeoff', label: 'Request takeoff' },
          { id: 'lineup', label: 'Line up and wait' },
          { id: 'taxi', label: 'Request taxi off' },
          { id: 'gate', label: 'Request gate' },
          ...follow,
        ]
      case 'cleared-takeoff':
        return [
          { id: 'takeoff', label: 'Confirm takeoff' },
          { id: 'cancel-takeoff', label: 'Cancel takeoff' },
          { id: 'land', label: 'Request landing' },
          { id: 'gate', label: 'Request gate' },
          ...follow,
        ]
      case 'airborne':
      case 'go-around':
        return [
          { id: 'closed-traffic', label: 'Request closed traffic' },
          { id: 'land', label: 'Request landing' },
          { id: 'go-around', label: 'Go around' },
          { id: 'taxi', label: 'Request taxi' },
          { id: 'gate', label: 'Request gate' },
          ...follow,
        ]
      case 'closed-traffic':
        return [
          { id: 'land', label: 'Request landing' },
          { id: 'downwind', label: 'Report downwind' },
          { id: 'go-around', label: 'Go around' },
          { id: 'gate', label: 'Request gate' },
          { id: 'taxi', label: 'Request taxi' },
          ...follow,
        ]
      case 'cleared-land':
        return [
          { id: 'land', label: 'Confirm landing' },
          { id: 'go-around', label: 'Go around' },
          { id: 'taxi', label: 'Request taxi' },
          { id: 'gate', label: 'Request gate' },
          ...follow,
        ]
      case 'rollout':
        return [
          { id: 'taxi', label: 'Request taxi' },
          { id: 'gate', label: 'Request gate' },
          { id: 'land', label: 'Request landing' },
          { id: 'takeoff', label: 'Request takeoff' },
          ...follow,
        ]
      default: {
        const neverPhase: never = this.phase
        return neverPhase
      }
    }
  }

  choose(id: string, ctx: AtcContext): void {
    const wind = windPhrase(ctx.weather)
    switch (id) {
      case 'taxi':
        this.requestTaxi(ctx, wind)
        break
      case 'progressive':
        this.say('you', `${CALL}, request progressive.`)
        this.reply(`${CALL}, you are on the bay runway. Continue straight ahead, runway 31L.`)
        break
      case 'takeoff':
        this.requestTakeoff(ctx, wind)
        break
      case 'lineup':
        this.say('you', `${CALL}, ready to line up.`)
        if (ctx.onRunway && ctx.aligned) {
          this.phase = 'lined-up'
          this.reply(`${CALL}, runway 31L, line up and wait. ${wind}.`)
        } else {
          this.reply(`${CALL}, continue taxi to runway 31L, then line up and wait.`)
        }
        break
      case 'cancel-takeoff':
        this.say('you', `${CALL}, cancel takeoff.`)
        if (ctx.iasKt < 80 && ctx.onGround) {
          this.phase = 'lined-up'
          this.reply(`${CALL}, takeoff clearance cancelled. Stop straight ahead on runway 31L.`)
        } else {
          this.reply(`${CALL}, unable to cancel. Continue and fly the clearance.`)
        }
        break
      case 'land':
        this.requestLanding(ctx, wind)
        break
      case 'closed-traffic':
        this.say('you', `${CALL}, request left closed traffic.`)
        if (!ctx.airborne) {
          this.reply(`${CALL}, closed traffic is for after departure. Taxi and takeoff first.`)
        } else {
          this.phase = 'closed-traffic'
          this.reply(
            `${CALL}, left closed traffic runway 31L approved. Pattern altitude 1,500 feet. Report midfield downwind. ${wind}.`,
          )
        }
        break
      case 'downwind':
        this.say('you', `${CALL}, midfield downwind, runway 31L.`)
        this.reply(`${CALL}, roger. Number one, report turning base, or request landing.`)
        break
      case 'go-around':
        this.say('you', `${CALL}, going around.`)
        this.phase = 'go-around'
        this.reply(`${CALL}, go around approved. Fly runway heading, climb to 1,500. Contact tower 123.9.`)
        break
      case 'gate':
        this.requestGate(ctx)
        break
      case 'say-again':
        this.say('you', `${CALL}, say again.`)
        this.reply(this.lastClearance || `${CALL}, no outstanding clearance. Request taxi when ready.`)
        break
      case 'wind':
        this.say('you', `${CALL}, request wind check.`)
        this.reply(`${CALL}, ${wind}. Visibility ${Math.round(ctx.weather.visibilityM / 1609)} miles.`)
        break
      case 'altimeter':
        this.say('you', `${CALL}, request altimeter.`)
        this.reply(`${CALL}, altimeter 2992. Field elevation 13. This is a fixed game setting, not a live METAR.`)
        break
      case 'wilco':
        this.say('you', `${CALL}, wilco.`)
        this.reply(`${CALL}, roger.`)
        break
      case 'traffic':
        this.say('you', `${CALL}, traffic in sight.`)
        this.reply(`${CALL}, roger, follow the bay runway for the left pattern.`)
        break
      default:
        this.say('you', `${CALL}.`)
        this.reply(`${CALL}, say request again.`)
        break
    }
  }

  observe(ctx: AtcContext): void {
    if (ctx.airborne && !this.airborneLatch) {
      this.airborneLatch = true
      if (this.phase === 'cleared-takeoff') {
        this.phase = 'airborne'
        this.reply(`${CALL} airborne. Climb runway heading. Request closed traffic for the left pattern.`)
      } else if (this.phase !== 'closed-traffic' && this.phase !== 'cleared-land' && this.phase !== 'go-around' && this.phase !== 'airborne') {
        this.phase = 'airborne'
        this.reply(`${CALL}, you are airborne without a takeoff clearance. Continue runway heading and call for closed traffic.`)
      }
    }
    if (this.airborneLatch && ctx.onGround && ctx.iasKt < 100 && ctx.altFt < 80) {
      this.airborneLatch = false
      const cleared = this.phase === 'cleared-land'
      this.phase = 'rollout'
      this.reply(
        cleared
          ? `${CALL}, nice to have you down. Exit when able and request taxi to the gate.`
          : `${CALL}, I show you on the surface. Landing clearance was not on file. Taxi is available when you stop.`,
      )
    }
    if ((this.phase === 'taxi-in' || this.phase === 'rollout') && ctx.nearGate && ctx.iasKt < 12) {
      this.phase = 'at-gate'
      this.reply(`${CALL}, gate B12. Parking brake when stopped. The pattern is available when you want another loop.`)
    }
    if (this.phase === 'taxi-out' && ctx.onRunway && ctx.aligned && ctx.iasKt < 40) {
      this.phase = 'lined-up'
      this.reply(`${CALL}, you are on runway 31L. Hold in position and request takeoff.`)
    }
  }

  private requestTaxi(ctx: AtcContext, wind: string): void {
    this.say('you', `${CALL}, request taxi.`)
    if (ctx.airborne) {
      this.reply(`${CALL}, taxi is after landing. You are still airborne.`)
      return
    }
    if (this.phase === 'rollout' || this.phase === 'at-gate' || ctx.nearGate) {
      this.phase = 'taxi-in'
      this.reply(`${CALL}, taxi to the terminal via the parallel. Gate B12 is on the ramp. ${wind}.`)
      return
    }
    if (ctx.onRunway && ctx.aligned) {
      this.phase = 'lined-up'
      this.reply(`${CALL}, you are already on runway 31L. Line up and wait, then request takeoff. ${wind}.`)
      return
    }
    this.phase = 'taxi-out'
    this.reply(
      `${CALL}, Kennedy Ground, taxi runway 31L. Continue straight ahead on the bay runway. ${wind}. Altimeter 2992.`,
    )
  }

  private requestTakeoff(ctx: AtcContext, wind: string): void {
    this.say('you', `${CALL}, ready for takeoff, runway 31L.`)
    if (ctx.airborne) {
      this.reply(`${CALL}, you are already airborne. Request closed traffic or landing.`)
      return
    }
    if (!ctx.onRunway || !ctx.aligned) {
      this.reply(`${CALL}, unable takeoff. You are not lined up on runway 31L. Continue the taxi.`)
      return
    }
    this.phase = 'cleared-takeoff'
    this.reply(`${CALL}, Kennedy Tower 123.9, runway 31L, ${wind}, cleared for takeoff.`)
  }

  private requestLanding(ctx: AtcContext, wind: string): void {
    this.say('you', `${CALL}, request landing, runway 31L.`)
    if (!ctx.airborne) {
      this.reply(`${CALL}, you are on the ground. Landing clearance is for the arrival.`)
      return
    }
    this.phase = 'cleared-land'
    const caution =
      ctx.iasKt > 180 ? ' Caution, speed. Plan about 140 knots on final.' : ctx.altFt > 2500 ? ' Descend to pattern altitude 1,500.' : ''
    this.reply(`${CALL}, runway 31L, cleared to land. ${wind}.${caution}`)
  }

  private requestGate(ctx: AtcContext): void {
    this.say('you', `${CALL}, request gate.`)
    if (ctx.airborne) {
      this.reply(`${CALL}, gate B12 is planned after landing. Fly the pattern and land on 31L first.`)
      return
    }
    if (ctx.nearGate) {
      this.phase = 'at-gate'
      this.reply(`${CALL}, gate B12 is open. Park on the ramp and set the brake.`)
      return
    }
    this.reply(`${CALL}, gate B12 is on the central terminal ramp. Taxi inbound after landing and I will clear you to the ramp.`)
  }

  private followUps(): AtcItem[] {
    return [
      { id: 'say-again', label: 'Say again' },
      { id: 'wind', label: 'Wind check' },
      { id: 'altimeter', label: 'Altimeter' },
      { id: 'wilco', label: 'Wilco' },
      { id: 'traffic', label: 'Traffic in sight' },
    ]
  }

  private say(who: 'you' | 'atc', text: string): void {
    this.lines.push({ who, text })
    if (this.lines.length > 14) this.lines.shift()
  }

  private reply(text: string): void {
    this.lastClearance = text
    this.say('atc', text)
  }
}

export function radioLabel(phase: AtcPhase): string {
  switch (phase) {
    case 'parked':
    case 'taxi-out':
    case 'rollout':
    case 'taxi-in':
    case 'at-gate':
      return 'GND 121.9'
    case 'lined-up':
    case 'cleared-takeoff':
    case 'airborne':
    case 'closed-traffic':
    case 'cleared-land':
    case 'go-around':
      return 'TWR 123.9'
    default: {
      const neverPhase: never = phase
      return neverPhase
    }
  }
}
