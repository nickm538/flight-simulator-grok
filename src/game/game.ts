import * as THREE from 'three'
import { buildAircraft } from '../aircraft/buildAircraft'
import { FLAP_DETENTS } from '../sim/aircraftConfig'
import { autopilotOutputs, defaultAutopilot, type AutopilotCommand } from '../sim/autopilot'
import { engineReadout } from '../sim/engines'
import {
  createFlightState,
  groundSpeed,
  iasMps,
  massOf,
  stepFlight,
  type FlightState,
} from '../sim/flightModel'
import { basisFromAttitude, clamp, deg, rad, wrapPi } from '../sim/math'
import { mpsToFpm, mpsToKt, mToFt, trueToMag } from '../sim/units'
import { CockpitOverlay, type HudSnapshot, type McpAction } from '../ui/CockpitOverlay'
import { createAirport } from '../world/airport'
import {
  RUNWAY_31L,
  approachGeometry,
  gatePad,
  isWater,
  onRunway,
  spawnPose,
} from '../world/kjfk'
import { createSky } from '../world/sky'
import { Atc, radioLabel } from './atc'
import { weatherPreset, windField, windPhrase, visibilitySm, type Weather } from './weather'

const HOLD = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'PageUp',
  'PageDown',
])

export class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly cockpitCam: THREE.PerspectiveCamera
  private readonly chaseCam: THREE.PerspectiveCamera
  private readonly aircraft = buildAircraft()
  private readonly airport: ReturnType<typeof createAirport>
  private readonly sky: ReturnType<typeof createSky>
  private readonly overlay: CockpitOverlay
  private readonly keys = new Set<string>()
  private state: FlightState
  private weather: Weather = weatherPreset('bay')
  private ap: AutopilotCommand = defaultAutopilot()
  private atc = new Atc()
  private time = 0
  private throttle = 0
  private yokePitch = 0
  private yokeRoll = 0
  private keyPitch = 0
  private keyRoll = 0
  private keyRudder = 0
  private flapIndex = 3
  private gearDown = true
  private spoiler = 0
  private reverse = false
  private parkingBrake = true
  private pointerBrake = false
  private spaceBrake = false
  private chase = false
  private snapChase = false
  private lookMode = false
  private lookYaw = 0
  private lookPitch = 0
  private note = 'Flaps 5, park brake set. You are lined up on 31L. Add thrust to roll.'
  private wideMedia = window.matchMedia('(min-width: 1100px) and (min-height: 700px)')
  private last = performance.now()
  private pixelRatio = 1
  private fogScale = 1
  private slowFrames = 0
  private fastFrames = 0
  /** Skip adaptation across a viewport-tier change so one resize hitch does not cut desktop quality. */
  private settleFrames = 90
  private readonly frameWindow: number[] = []

  constructor(private readonly app: HTMLElement) {
    const phone = this.phoneTier()
    this.pixelRatio = phone ? 1.5 : 2
    this.renderer = new THREE.WebGLRenderer({
      antialias: !phone,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatio))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = !phone
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.className = 'world-canvas'
    this.app.appendChild(this.renderer.domElement)

    this.cockpitCam = new THREE.PerspectiveCamera(68, 1, 0.15, 28000)
    this.chaseCam = new THREE.PerspectiveCamera(32, 1, 0.35, 28000)
    this.renderer.setClearColor(0xc9b89a, 1)
    this.scene.add(this.aircraft.root)
    this.scene.add(this.aircraft.effects)
    this.sky = createSky(this.scene)
    this.airport = createAirport(this.scene)
    const sun = this.scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined
    if (sun && this.renderer.shadowMap.enabled) {
      sun.castShadow = true
      sun.shadow.mapSize.set(1024, 1024)
      sun.shadow.camera.near = 8
      sun.shadow.camera.far = 280
      sun.shadow.camera.left = -70
      sun.shadow.camera.right = 70
      sun.shadow.camera.top = 70
      sun.shadow.camera.bottom = -70
      this.scene.add(sun.target)
    }

    const spawn = spawnPose()
    this.state = createFlightState(spawn.east, spawn.north, spawn.heading)
    this.overlay = new CockpitOverlay(this.app, {
      onThrottle: (value) => this.setThrottle(value),
      onFlapStep: (delta) => {
        this.flapIndex = clamp(this.flapIndex + delta, 0, FLAP_DETENTS.length - 1)
      },
      onGear: () => {
        this.gearDown = !this.gearDown
      },
      onView: () => {
        this.chase = !this.chase
        this.snapChase = true
      },
      onLookMode: () => {
        this.lookMode = !this.lookMode
        this.overlay.setLookMode(this.lookMode)
      },
      onCenterLook: () => {
        this.lookYaw = 0
        this.lookPitch = 0
      },
      onBrake: (held) => {
        this.pointerBrake = held
      },
      onReverse: () => {
        this.reverse = !this.reverse
      },
      onSpoiler: () => {
        this.spoiler = this.spoiler > 0.5 ? 0 : 1
      },
      onMcp: (action) => this.onMcp(action),
      onWeather: (preset) => {
        this.weather = weatherPreset(preset)
      },
      onAtc: (id) => this.atc.choose(id, this.atcContext()),
      onYoke: (pitch, roll) => {
        this.yokePitch = pitch
        this.yokeRoll = roll
      },
      onLook: (yaw, pitch) => {
        this.lookYaw = clamp(this.lookYaw - yaw, -1.7, 1.7)
        this.lookPitch = clamp(this.lookPitch - pitch, -0.5, 0.65)
      },
      onReset: () => this.reset(),
    })
    this.bindKeys()
    this.resize()
    window.addEventListener('resize', () => this.resize())
    this.wideMedia.addEventListener('change', () => {
      this.pixelRatio = this.phoneTier() ? 1.5 : 2
      this.fogScale = 1
      this.slowFrames = 0
      this.fastFrames = 0
      this.frameWindow.length = 0
      this.settleFrames = 45
      this.renderer.shadowMap.enabled = !this.phoneTier()
      this.sky.setDetail(1)
      this.resize()
    })
  }

  quality() {
    const samples = this.frameWindow.length
    const sorted = [...this.frameWindow].sort((a, b) => a - b)
    const at = (p: number) => (samples === 0 ? 0 : sorted[Math.min(samples - 1, Math.floor(p * (samples - 1)))])
    const mean = samples === 0 ? 0 : this.frameWindow.reduce((sum, ms) => sum + ms, 0) / samples
    return {
      samples,
      meanMs: mean,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      pixelRatio: this.renderer.getPixelRatio(),
      ratioTarget: this.pixelRatio,
      fogScale: this.fogScale,
      shadows: this.renderer.shadowMap.enabled,
      phone: this.phoneTier(),
    }
  }

  start(): void {
    const loop = (now: number) => {
      const elapsedMs = now - this.last
      this.last = now
      const dt = Math.min(0.05, elapsedMs / 1000 || 0)
      this.frame(dt, elapsedMs)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  read() {
    const env = this.environment()
    return {
      alt: this.state.alt,
      ias: mpsToKt(Math.max(0, iasMps(this.state, env))),
      onGround: this.state.onGround,
      gear: this.state.gear,
      n1: this.state.n1,
      heading: this.state.heading,
      east: this.state.east,
      north: this.state.north,
      pitch: this.state.pitch,
      roll: this.state.roll,
      vu: this.state.vu,
      gs: groundSpeed(this.state),
      crashed: this.state.crashed,
      crashReason: this.state.crashReason,
      phase: this.atc.phase,
      throttle: this.throttle,
      flapIndex: this.flapIndex,
      gearDown: this.gearDown,
    }
  }

  private frame(dt: number, elapsedMs: number): void {
    this.adaptQuality(elapsedMs)
    this.time += dt
    this.keyPitch = glide(this.keyPitch, axis(this.keys, 'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'), dt)
    this.keyRoll = glide(this.keyRoll, axis(this.keys, 'ArrowRight', 'KeyD', 'ArrowLeft', 'KeyA'), dt)
    this.keyRudder = glide(this.keyRudder, axis(this.keys, 'KeyE', '', 'KeyQ', ''), dt)
    if (this.keys.has('BracketRight') || this.keys.has('Equal') || this.keys.has('PageUp') || this.keys.has('NumpadAdd')) {
      this.setThrottle(this.throttle + dt * 0.45)
    }
    if (this.keys.has('BracketLeft') || this.keys.has('Minus') || this.keys.has('PageDown') || this.keys.has('NumpadSubtract')) {
      this.setThrottle(this.throttle - dt * 0.45)
    }
    this.spaceBrake = this.keys.has('Space')
    if (this.throttle > 0.22) this.parkingBrake = false

    const env = this.environment()
    const pilotPitch = clamp(this.yokePitch + this.keyPitch, -1, 1)
    const pilotRoll = clamp(this.yokeRoll + this.keyRoll, -1, 1)
    const assisted = autopilotOutputs(this.state, env, this.ap, this.throttle)
    let pitch = pilotPitch
    let roll = pilotRoll
    let throttle = this.throttle
    if (this.ap.engaged) {
      if (Math.abs(pilotPitch) > 0.55 || Math.abs(pilotRoll) > 0.55) {
        this.ap.engaged = false
        this.note = 'Autopilot disconnected.'
      } else {
        pitch = assisted.pitch
        roll = assisted.roll
      }
    }
    if (this.ap.autothrottle) {
      throttle = assisted.throttle
      this.throttle = throttle
    }
    if (this.throttle > 0.22) this.parkingBrake = false

    stepFlight(
      this.state,
      {
        pitch,
        roll,
        rudder: this.keyRudder,
        throttle,
        brake: this.pointerBrake || this.spaceBrake ? 1 : 0,
        reverse: this.reverse,
        flapIndex: this.flapIndex,
        gearDown: this.gearDown,
        spoiler: this.spoiler,
        spoilerArmed: true,
        parkingBrake: this.parkingBrake,
      },
      env,
      dt,
    )
    if (this.state.onGround && this.state.hasLiftedOff && isWater(this.state.east, this.state.north)) {
      this.state.crashed = true
      this.state.crashReason = 'Ditched in Jamaica Bay.'
    }
    this.atc.observe(this.atcContext())
    this.aircraft.update(this.state, { pitch, roll, rudder: this.keyRudder }, dt)
    this.airport.update(this.state, dt)
    this.sky.apply(this.weather)
    this.updateCameras(dt)
    this.overlay.update(this.snapshot())
    const camera = this.chase ? this.chaseCam : this.cockpitCam
    this.frameViewport()
    this.renderer.render(this.scene, camera)
  }

  private updateCameras(dt: number): void {
    const basis = basisFromAttitude(this.state.heading, this.state.pitch, this.state.roll)
    const right = new THREE.Vector3(basis.right.x, basis.right.y, basis.right.z)
    const up = new THREE.Vector3(basis.up.x, basis.up.y, basis.up.z)
    const forward = new THREE.Vector3(basis.forward.x, basis.forward.y, basis.forward.z)
    const pos = new THREE.Vector3(this.state.east, this.state.alt, this.state.north)
    const eye = pos
      .clone()
      .addScaledVector(right, -0.46)
      .addScaledVector(up, 0.78)
      .addScaledVector(forward, 15.35)
    const lookDir = forward
      .clone()
      .multiplyScalar(Math.cos(this.lookPitch) * Math.cos(this.lookYaw))
      .addScaledVector(up, Math.sin(this.lookPitch))
      .addScaledVector(right, Math.sin(this.lookYaw))
    this.cockpitCam.position.copy(eye)
    this.cockpitCam.up.copy(up)
    this.cockpitCam.lookAt(eye.clone().add(lookDir))
    const desired = pos
      .clone()
      .addScaledVector(forward, 11)
      .addScaledVector(up, 1.5)
      .addScaledVector(right, 8)
    desired.y = Math.max(1.4, desired.y)
    if (this.snapChase || this.chaseCam.position.lengthSq() < 4 || this.chaseCam.position.distanceTo(desired) > 30) {
      this.chaseCam.position.copy(desired)
      this.snapChase = false
    }
    this.chaseCam.position.lerp(desired, 1 - Math.exp(-dt * 6))
    this.chaseCam.up.set(0, 1, 0)
    this.chaseCam.lookAt(pos.x, pos.y + 1.2, pos.z)
    const sun = this.scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined
    if (sun?.castShadow) {
      sun.position.set(this.state.east - 90, this.state.alt + 140, this.state.north + 50)
      sun.target.position.set(this.state.east, this.state.alt, this.state.north)
      sun.target.updateMatrixWorld()
    }
  }

  private snapshot(): HudSnapshot {
    const env = this.environment()
    const air = Math.max(0, iasMps(this.state, env))
    const gs = Math.max(groundSpeed(this.state), 1)
    const geo = approachGeometry(this.state.east, this.state.north)
    const headingError = Math.abs(wrapPi(this.state.heading - RUNWAY_31L.headingTrue))
    return {
      iasKt: mpsToKt(air),
      pitchDeg: deg(this.state.pitch),
      rollDeg: deg(this.state.roll),
      altFt: mToFt(this.state.alt) + 13,
      vsFpm: mpsToFpm(this.state.vu),
      headingMag: trueToMag(deg(this.state.heading)),
      groundSpeedKt: mpsToKt(groundSpeed(this.state)),
      throttle: this.ap.autothrottle ? this.throttle : this.throttle,
      n1: this.state.n1 * 100,
      flapIndex: this.flapIndex,
      gear: this.state.gear,
      gearCommandDown: this.gearDown,
      spoiler: this.state.spoiler,
      brake: this.pointerBrake || this.spaceBrake ? 1 : 0,
      parkingBrake: this.parkingBrake,
      reverse: this.reverse,
      engines: {
        left: engineReadout(this.state.n1, air, 'L'),
        right: engineReadout(this.state.n1, air, 'R'),
      },
      ap: this.ap,
      atcLines: this.atc.lines,
      atcMenu: this.atc.menu(),
      atcPhase: this.atc.phase,
      radio: radioLabel(this.atc.phase),
      windText: windPhrase(this.weather),
      visibilitySm: visibilitySm(this.weather),
      weatherPreset: this.weather.preset,
      chase: this.chase,
      lookMode: this.lookMode,
      wide: this.wideMedia.matches,
      crashed: this.state.crashed,
      crashReason: this.state.crashReason,
      advisory: this.state.advisory || this.note,
      onGround: this.state.onGround,
      fpaDeg: deg(Math.atan2(this.state.vu, gs)),
      loc: clamp(geo.cross / 140, -1, 1),
      gsDev: clamp((this.state.alt - geo.desiredAlt) / 45, -1, 1),
      showApproach: geo.along > 300 && geo.along < 12000 && this.state.alt < 900 && headingError < 0.7,
      east: this.state.east,
      north: this.state.north,
      headingTrue: this.state.heading,
      fuelKg: this.state.fuelKg,
      massKg: massOf(this.state),
    }
  }

  private environment() {
    const wind = windField(this.weather)
    return { windEast: wind.east, windNorth: wind.north, gust: wind.gust, time: this.time }
  }

  private atcContext() {
    const env = this.environment()
    const resting = this.state.alt < 8
    return {
      onRunway: onRunway(RUNWAY_31L, this.state.east, this.state.north, 8),
      aligned: Math.abs(wrapPi(this.state.heading - RUNWAY_31L.headingTrue)) < rad(15),
      airborne: !this.state.onGround && this.state.alt > 12,
      onGround: this.state.onGround && resting,
      iasKt: mpsToKt(Math.max(0, iasMps(this.state, env))),
      altFt: mToFt(this.state.alt) + 13,
      nearGate: Math.hypot(this.state.east - gatePad().east, this.state.north - gatePad().north) < 70,
      weather: this.weather,
    }
  }

  private setThrottle(value: number): void {
    this.throttle = clamp(value, 0, 1)
    if (this.ap.autothrottle) {
      this.ap.autothrottle = false
      this.note = 'Autothrottle off.'
    }
  }

  private onMcp(action: McpAction): void {
    switch (action.type) {
      case 'toggle-ap':
        this.ap.engaged = !this.ap.engaged
        this.note = this.ap.engaged ? 'Autopilot on. Heading and altitude.' : 'Autopilot off.'
        break
      case 'toggle-at':
        this.ap.autothrottle = !this.ap.autothrottle
        this.note = this.ap.autothrottle ? 'Autothrottle on.' : 'Autothrottle off.'
        break
      case 'toggle-alt-mode':
        this.ap.altitudeMode = this.ap.altitudeMode === 'alt' ? 'vs' : 'alt'
        break
      case 'step':
        this.stepBug(action.target, action.delta)
        break
      default: {
        const neverAction: never = action
        throw new Error(`Unhandled MCP action ${String(neverAction)}`)
      }
    }
  }

  private stepBug(target: 'spd' | 'hdg' | 'alt' | 'vs', delta: number): void {
    switch (target) {
      case 'spd':
        this.ap.speedKt = clamp(this.ap.speedKt + delta, 100, 330)
        break
      case 'hdg':
        this.ap.headingMag = (Math.round(this.ap.headingMag + delta) + 360) % 360
        break
      case 'alt':
        this.ap.altitudeFt = clamp(this.ap.altitudeFt + delta, 13, 10000)
        break
      case 'vs':
        this.ap.vsFpm = clamp(this.ap.vsFpm + delta, -2500, 3000)
        break
      default: {
        const neverTarget: never = target
        throw new Error(`Unhandled bug ${String(neverTarget)}`)
      }
    }
  }

  private reset(): void {
    const spawn = spawnPose()
    this.state = createFlightState(spawn.east, spawn.north, spawn.heading)
    this.throttle = 0
    this.parkingBrake = true
    this.flapIndex = 3
    this.gearDown = true
    this.spoiler = 0
    this.reverse = false
    this.ap = defaultAutopilot()
    this.atc = new Atc()
    this.time = 0
    this.note = 'Reset on the 31L stub.'
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (event) => {
      if (HOLD.has(event.code) || event.code.startsWith('Arrow')) event.preventDefault()
      this.keys.add(event.code)
      if (event.repeat) return
      if (event.code === 'KeyF') this.flapIndex = clamp(this.flapIndex + (event.shiftKey ? -1 : 1), 0, FLAP_DETENTS.length - 1)
      if (event.code === 'KeyG') this.gearDown = !this.gearDown
      if (event.code === 'KeyV') this.chase = !this.chase
      if (event.code === 'KeyR') this.reverse = !this.reverse
      if (event.code === 'KeyX') this.spoiler = this.spoiler > 0.5 ? 0 : 1
      if (event.code === 'KeyC') {
        this.lookYaw = 0
        this.lookPitch = 0
      }
      if (event.code === 'Escape') this.overlay.closePage()
    })
    window.addEventListener('keyup', (event) => this.keys.delete(event.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  private phoneTier(): boolean {
    return !this.wideMedia.matches
  }

  private adaptQuality(elapsedMs: number): void {
    if (this.settleFrames > 0) {
      this.settleFrames -= 1
      return
    }
    const ms = elapsedMs
    // A single stalled frame (resize, tab hidden) is not a sustained frame rate.
    if (!(ms > 0 && ms < 80)) {
      this.slowFrames = 0
      return
    }
    this.frameWindow.push(ms)
    if (this.frameWindow.length > 120) this.frameWindow.shift()
    const cap = this.phoneTier() ? 1.5 : 2
    if (ms > 34) {
      this.slowFrames += 1
      this.fastFrames = 0
    } else if (ms < 16.7) {
      this.fastFrames += 1
      this.slowFrames = 0
    } else {
      this.slowFrames = 0
      this.fastFrames = 0
    }
    if (this.slowFrames >= 18 && (this.pixelRatio > 1 || this.fogScale > 0.62)) {
      this.pixelRatio = Math.max(1, Math.round((this.pixelRatio - 0.25) * 4) / 4)
      this.fogScale = Math.max(0.62, Math.round((this.fogScale - 0.12) * 100) / 100)
      this.slowFrames = 0
      this.fastFrames = 0
      this.sky.setDetail(this.fogScale)
      this.resize()
    } else if (this.fastFrames >= 150 && (this.pixelRatio < cap || this.fogScale < 1)) {
      this.pixelRatio = Math.min(cap, Math.round((this.pixelRatio + 0.25) * 4) / 4)
      this.fogScale = Math.min(1, Math.round((this.fogScale + 0.08) * 100) / 100)
      this.slowFrames = 0
      this.fastFrames = 0
      this.sky.setDetail(this.fogScale)
      this.resize()
    }
  }

  private resize(): void {
    const width = this.app.clientWidth || window.innerWidth
    const height = this.app.clientHeight || window.innerHeight
    const cap = this.phoneTier() ? 1.5 : 2
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatio, cap))
    this.renderer.setSize(width, height, false)
    this.frameViewport()
  }

  /** On a phone, draw into the windshield above the dock and left of the thumb rail. */
  private frameViewport(): void {
    const width = this.app.clientWidth || window.innerWidth
    const height = this.app.clientHeight || window.innerHeight
    let viewX = 0
    let viewY = 0
    let viewW = width
    let viewH = height
    if (this.phoneTier()) {
      const dock = this.app.querySelector('.dock')?.getBoundingClientRect().height ?? 0
      const thumbLeft = this.app.querySelector('.thumb')?.getBoundingClientRect().left ?? width
      viewW = Math.max(1, Math.round(thumbLeft))
      viewH = Math.max(1, Math.round(height - dock))
      viewY = Math.max(0, Math.round(height - viewH))
      this.renderer.setScissorTest(true)
    } else {
      this.renderer.setScissorTest(false)
    }
    this.renderer.setViewport(viewX, viewY, viewW, viewH)
    this.renderer.setScissor(viewX, viewY, viewW, viewH)
    const aspect = viewW / viewH
    this.cockpitCam.aspect = aspect
    this.chaseCam.aspect = aspect
    this.cockpitCam.updateProjectionMatrix()
    this.chaseCam.updateProjectionMatrix()
  }
}

function axis(keys: Set<string>, positive: string, positiveAlt: string, negative: string, negativeAlt: string): number {
  const plus = keys.has(positive) || (positiveAlt !== '' && keys.has(positiveAlt))
  const minus = keys.has(negative) || (negativeAlt !== '' && keys.has(negativeAlt))
  return (plus ? 1 : 0) - (minus ? 1 : 0)
}

function glide(current: number, target: number, dt: number): number {
  const rate = target === 0 ? 6 : 3
  return current + clamp(target - current, -rate * dt, rate * dt)
}
