import { FLAP_DETENTS, referenceSpeeds } from '../sim/aircraftConfig'
import type { EngineReadout } from '../sim/engines'
import type { AutopilotCommand } from '../sim/autopilot'
import type { AtcItem, AtcLine, AtcPhase } from '../game/atc'
import type { WeatherPreset } from '../game/weather'
import { RUNWAYS, gatePad, patternPlan, runwayPoint } from '../world/kjfk'

export type PageId = 'nd' | 'eng' | 'mcp' | 'fmc' | 'atc'

export type McpAction =
  | { type: 'toggle-ap' }
  | { type: 'toggle-at' }
  | { type: 'toggle-alt-mode' }
  | { type: 'step'; target: 'spd' | 'hdg' | 'alt' | 'vs'; delta: number }

export interface HudSnapshot {
  iasKt: number
  pitchDeg: number
  rollDeg: number
  altFt: number
  vsFpm: number
  headingMag: number
  groundSpeedKt: number
  throttle: number
  n1: number
  flapIndex: number
  gear: number
  gearCommandDown: boolean
  spoiler: number
  brake: number
  parkingBrake: boolean
  reverse: boolean
  engines: { left: EngineReadout; right: EngineReadout }
  ap: AutopilotCommand
  atcLines: AtcLine[]
  atcMenu: AtcItem[]
  atcPhase: AtcPhase
  radio: string
  windText: string
  visibilitySm: number
  weatherPreset: WeatherPreset
  chase: boolean
  lookMode: boolean
  wide: boolean
  crashed: boolean
  crashReason: string
  advisory: string
  onGround: boolean
  fpaDeg: number
  loc: number
  gsDev: number
  showApproach: boolean
  east: number
  north: number
  headingTrue: number
  fuelKg: number
  massKg: number
}

export interface OverlayHandlers {
  onThrottle(value: number): void
  onFlapIndex(index: number): void
  onGear(): void
  onView(): void
  onLookMode(): void
  onCenterLook(): void
  onBrake(held: boolean): void
  onReverse(): void
  onSpoiler(): void
  onMcp(action: McpAction): void
  onWeather(preset: WeatherPreset): void
  onAtc(id: string): void
  onYoke(pitch: number, roll: number): void
  onLook(yaw: number, pitch: number): void
  onReset(): void
}

export class CockpitOverlay {
  readonly root: HTMLElement
  private readonly pfd: HTMLCanvasElement
  private readonly nd: HTMLCanvasElement
  private readonly handlers: OverlayHandlers
  private page: PageId | null = null
  private wide = false
  private readonly media: MediaQueryList

  constructor(parent: HTMLElement, handlers: OverlayHandlers) {
    this.handlers = handlers
    this.root = document.createElement('div')
    this.root.className = 'hud'
    this.root.dataset.testid = 'hud'
    this.root.innerHTML = markup()
    parent.appendChild(this.root)
    const pfd = this.root.querySelector('canvas.pfd')
    const nd = this.root.querySelector('canvas.nd')
    if (!(pfd instanceof HTMLCanvasElement) || !(nd instanceof HTMLCanvasElement)) {
      throw new Error('Cockpit overlay is missing its displays.')
    }
    this.pfd = pfd
    this.nd = nd
    this.media = window.matchMedia('(min-width: 1100px) and (min-height: 700px)')
    this.wide = this.media.matches
    this.media.addEventListener('change', () => {
      this.wide = this.media.matches
      this.applyPage()
    })
    this.bind()
    this.applyPage()
  }

  closePage(): void {
    this.page = null
    this.applyPage()
  }

  update(snapshot: HudSnapshot): void {
    this.root.dataset.layout = snapshot.wide ? 'wide' : 'narrow'
    this.root.classList.toggle('crashed', snapshot.crashed)
    const crash = this.root.querySelector('.crash p')
    if (crash) crash.textContent = snapshot.crashReason
    const chip = this.root.querySelector('[data-bind="phase"]')
    if (chip) chip.textContent = `${snapshot.radio} · ${labelPhase(snapshot.atcPhase)}`
    const note = this.root.querySelector('[data-bind="note"]')
    if (note) note.textContent = snapshot.advisory || 'Drag the view to pitch and roll. LOOK glances around.'
    const n1 = this.root.querySelector('[data-bind="n1"]')
    if (n1) n1.textContent = `N1 ${snapshot.n1.toFixed(0)}`
    const flapLabel = this.root.querySelector('[data-bind="flap"]')
    if (flapLabel) flapLabel.textContent = FLAP_DETENTS[snapshot.flapIndex] === 0 ? 'UP' : String(FLAP_DETENTS[snapshot.flapIndex])
    this.root.querySelectorAll<HTMLButtonElement>('[data-flap]').forEach((button) => {
      button.classList.toggle('is-on', Number(button.dataset.flap) === snapshot.flapIndex)
    })
    const gear = this.root.querySelector<HTMLButtonElement>('[data-gear]')
    if (gear) {
      gear.classList.toggle('is-down', snapshot.gearCommandDown)
      gear.textContent = snapshot.gear > 0.95 ? 'GEAR DOWN' : snapshot.gear < 0.05 ? 'GEAR UP' : 'GEAR …'
    }
    const knob = this.root.querySelector<HTMLElement>('.throttle-knob')
    if (knob) knob.style.bottom = `${snapshot.throttle * 100}%`
    const brake = this.root.querySelector('[data-brake]')
    brake?.classList.toggle('is-on', snapshot.brake > 0.5 || snapshot.parkingBrake)
    if (brake) brake.textContent = snapshot.parkingBrake ? 'PARK' : 'BRAKE'
    this.root.querySelector('[data-rev]')?.classList.toggle('is-on', snapshot.reverse)
    this.root.querySelector('[data-spoiler]')?.classList.toggle('is-on', snapshot.spoiler > 0.5)
    this.root.querySelector('[data-view]')?.classList.toggle('is-on', snapshot.chase)
    this.root.querySelector('[data-look]')?.classList.toggle('is-on', snapshot.lookMode)
    this.paintEngines(snapshot)
    this.paintMcp(snapshot)
    this.paintFmc(snapshot)
    this.paintAtc(snapshot)
    this.paintPfd(snapshot)
    this.paintNd(snapshot)
  }

  private bind(): void {
    const throttle = this.root.querySelector<HTMLElement>('.throttle')
    const moveThrottle = (event: PointerEvent) => {
      if (!throttle) return
      const rect = throttle.getBoundingClientRect()
      const value = 1 - (event.clientY - rect.top) / rect.height
      this.handlers.onThrottle(Math.max(0, Math.min(1, value)))
    }
    throttle?.addEventListener('pointerdown', (event) => {
      throttle.setPointerCapture(event.pointerId)
      moveThrottle(event)
    })
    throttle?.addEventListener('pointermove', (event) => {
      if (throttle.hasPointerCapture(event.pointerId)) moveThrottle(event)
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-flap]').forEach((button) => {
      button.addEventListener('click', () => this.handlers.onFlapIndex(Number(button.dataset.flap)))
    })
    this.root.querySelector('[data-gear]')?.addEventListener('click', () => this.handlers.onGear())
    this.root.querySelector('[data-view]')?.addEventListener('click', () => this.handlers.onView())
    this.root.querySelector('[data-look]')?.addEventListener('click', () => this.handlers.onLookMode())
    this.root.querySelector('[data-center]')?.addEventListener('click', () => this.handlers.onCenterLook())
    const brake = this.root.querySelector('[data-brake]')
    brake?.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.handlers.onBrake(true)
    })
    const release = () => this.handlers.onBrake(false)
    brake?.addEventListener('pointerup', release)
    brake?.addEventListener('pointercancel', release)
    this.root.querySelector('[data-rev]')?.addEventListener('click', () => this.handlers.onReverse())
    this.root.querySelector('[data-spoiler]')?.addEventListener('click', () => this.handlers.onSpoiler())
    this.root.querySelector('[data-reset]')?.addEventListener('click', () => this.handlers.onReset())
    this.root.querySelector('[data-close]')?.addEventListener('click', () => this.closePage())

    this.root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const page = button.dataset.page as PageId
        if (this.wide && (page === 'nd' || page === 'eng')) {
          this.page = null
        } else {
          this.page = this.page === page ? null : page
        }
        this.applyPage()
      })
    })

    this.bindSteppers()
    this.root.querySelector('[data-ap]')?.addEventListener('click', () => this.handlers.onMcp({ type: 'toggle-ap' }))
    this.root.querySelector('[data-at]')?.addEventListener('click', () => this.handlers.onMcp({ type: 'toggle-at' }))
    this.root.querySelector('[data-alt-mode]')?.addEventListener('click', () => this.handlers.onMcp({ type: 'toggle-alt-mode' }))
    this.root.querySelectorAll<HTMLButtonElement>('[data-wx]').forEach((button) => {
      button.addEventListener('click', () => this.handlers.onWeather(button.dataset.wx as WeatherPreset))
    })

    this.bindYoke()
  }

  private bindSteppers(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) => {
      const target = button.dataset.step as 'spd' | 'hdg' | 'alt' | 'vs'
      const delta = Number(button.dataset.delta)
      let timer = 0
      const fire = () => this.handlers.onMcp({ type: 'step', target, delta })
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        fire()
        timer = window.setInterval(fire, 140)
      })
      const stop = () => window.clearInterval(timer)
      button.addEventListener('pointerup', stop)
      button.addEventListener('pointercancel', stop)
      button.addEventListener('pointerleave', stop)
    })
  }

  private bindYoke(): void {
    const yoke = this.root.querySelector<HTMLElement>('.yoke')
    if (!yoke) return
    const pointers = new Map<number, { x: number; y: number; ox: number; oy: number }>()
    yoke.addEventListener('contextmenu', (event) => event.preventDefault())
    yoke.addEventListener('pointerdown', (event) => {
      yoke.setPointerCapture(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, ox: event.clientX, oy: event.clientY })
      if (pointers.size >= 2) this.handlers.onYoke(0, 0)
    })
    yoke.addEventListener('pointermove', (event) => {
      const pointer = pointers.get(event.pointerId)
      if (!pointer) return
      const dx = event.clientX - pointer.x
      const dy = event.clientY - pointer.y
      pointer.x = event.clientX
      pointer.y = event.clientY
      const looking = pointers.size >= 2 || event.buttons === 2 || this.root.classList.contains('look-mode')
      if (looking) {
        this.handlers.onLook(dx * 0.005, dy * 0.004)
        this.handlers.onYoke(0, 0)
        return
      }
      const pitch = Math.max(-1, Math.min(1, -(event.clientY - pointer.oy) / 110))
      const roll = Math.max(-1, Math.min(1, (event.clientX - pointer.ox) / 130))
      this.handlers.onYoke(pitch, roll)
    })
    const end = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pointers.size === 0) this.handlers.onYoke(0, 0)
    }
    yoke.addEventListener('pointerup', end)
    yoke.addEventListener('pointercancel', end)
  }

  setLookMode(on: boolean): void {
    this.root.classList.toggle('look-mode', on)
  }

  private applyPage(): void {
    this.root.dataset.page = this.page ?? ''
    this.root.dataset.layout = this.wide ? 'wide' : 'narrow'
    const title = this.root.querySelector('[data-bind="page-title"]')
    if (title) title.textContent = pageTitle(this.page)
    this.root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.page === this.page)
    })
  }

  private paintEngines(snapshot: HudSnapshot): void {
    paintEngineColumn(this.root, 'l', snapshot.engines.left)
    paintEngineColumn(this.root, 'r', snapshot.engines.right)
  }

  private paintMcp(snapshot: HudSnapshot): void {
    setText(this.root, 'spd', Math.round(snapshot.ap.speedKt).toString())
    setText(this.root, 'hdg', Math.round(snapshot.ap.headingMag).toString().padStart(3, '0'))
    setText(this.root, 'alt', Math.round(snapshot.ap.altitudeFt).toString())
    setText(this.root, 'vs', Math.round(snapshot.ap.vsFpm).toString())
    this.root.querySelector('[data-ap]')?.classList.toggle('is-on', snapshot.ap.engaged)
    this.root.querySelector('[data-at]')?.classList.toggle('is-on', snapshot.ap.autothrottle)
    const mode = this.root.querySelector('[data-alt-mode]')
    if (mode) mode.textContent = snapshot.ap.altitudeMode === 'alt' ? 'ALT HOLD' : 'V/S HOLD'
  }

  private paintFmc(snapshot: HudSnapshot): void {
    const speeds = referenceSpeeds(snapshot.massKg)
    setText(this.root, 'mass', `${Math.round(snapshot.massKg / 100) / 10} t`)
    setText(this.root, 'fuel', `${Math.round(snapshot.fuelKg)} kg`)
    setText(this.root, 'v1', Math.round(speeds.v1).toString())
    setText(this.root, 'vr', Math.round(speeds.vr).toString())
    setText(this.root, 'v2', Math.round(speeds.v2).toString())
    setText(this.root, 'vapp', Math.round(speeds.vapp).toString())
    const legs = this.root.querySelector('[data-bind="legs"]')
    if (legs) {
      const plan = patternPlan()
      legs.innerHTML = plan.waypoints
        .map((point) => {
          const dist = Math.hypot(point.east - snapshot.east, point.north - snapshot.north) / 1852
          return `<li><span>${point.name}</span><span>${dist.toFixed(1)} nm</span><span>${Math.round(point.altM / 0.3048)} ft</span></li>`
        })
        .join('')
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-wx]').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.wx === snapshot.weatherPreset)
    })
    setText(this.root, 'wx', `${snapshot.windText}, vis ${snapshot.visibilitySm.toFixed(0)} sm`)
  }

  private paintAtc(snapshot: HudSnapshot): void {
    const log = this.root.querySelector('[data-bind="atc-log"]')
    if (log) {
      log.innerHTML = snapshot.atcLines
        .map((line) => `<p class="${line.who}"><strong>${line.who === 'you' ? 'You' : 'ATC'}</strong> ${escapeHtml(line.text)}</p>`)
        .join('')
      log.scrollTop = log.scrollHeight
    }
    const menu = this.root.querySelector<HTMLElement>('[data-bind="atc-menu"]')
    const signature = snapshot.atcMenu.map((item) => `${item.id}:${item.label}`).join('|')
    if (menu && menu.dataset.signature !== signature) {
      menu.dataset.signature = signature
      menu.innerHTML = ''
      for (const item of snapshot.atcMenu) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = item.label
        button.dataset.testid = `atc-${item.id}`
        button.addEventListener('click', () => this.handlers.onAtc(item.id))
        menu.appendChild(button)
      }
    }
  }

  private paintPfd(snapshot: HudSnapshot): void {
    const canvas = this.pfd
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = canvas.clientWidth || 280
    const height = canvas.clientHeight || 150
    fitCanvas(canvas, ctx, width, height)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#071018'
    ctx.fillRect(0, 0, width, height)
    drawTape(ctx, 6, 8, width * 0.2, height - 16, snapshot.iasKt, 'SPD', '#d7e4f2', Math.round(snapshot.ap.speedKt))
    const boxX = width * 0.24
    const boxW = width * 0.46
    const boxY = 8
    const boxH = height * 0.68
    ctx.save()
    ctx.beginPath()
    ctx.rect(boxX, boxY, boxW, boxH)
    ctx.clip()
    const cx = boxX + boxW / 2
    const cy = boxY + boxH / 2
    ctx.translate(cx, cy)
    ctx.rotate((-snapshot.rollDeg * Math.PI) / 180)
    const px = boxH / 42
    ctx.translate(0, (snapshot.pitchDeg * px))
    ctx.fillStyle = '#1f6cab'
    ctx.fillRect(-width, -height * 2, width * 2, height * 2)
    ctx.fillStyle = '#7a5732'
    ctx.fillRect(-width, 0, width * 2, height * 2)
    ctx.strokeStyle = '#f4f7fb'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-boxW, 0)
    ctx.lineTo(boxW, 0)
    ctx.stroke()
    ctx.fillStyle = '#f4f7fb'
    ctx.font = '11px sans-serif'
    for (const mark of [-20, -10, 10, 20]) {
      const y = -mark * px
      ctx.fillRect(-28, y, 56, 1)
      ctx.fillText(String(Math.abs(mark)), 32, y + 4)
    }
    ctx.restore()
    ctx.strokeStyle = '#f2c14e'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(cx - 42, cy)
    ctx.lineTo(cx - 16, cy)
    ctx.lineTo(cx, cy + 8)
    ctx.lineTo(cx + 16, cy)
    ctx.lineTo(cx + 42, cy)
    ctx.stroke()
    const fpm = (snapshot.pitchDeg - snapshot.fpaDeg) * px
    ctx.strokeStyle = '#9be7c4'
    ctx.beginPath()
    ctx.arc(cx, cy + fpm, 7, 0, Math.PI * 2)
    ctx.stroke()
    if (snapshot.showApproach) {
      ctx.strokeStyle = '#e0a526'
      ctx.strokeRect(cx - 8 + snapshot.loc * 36, cy - 26, 16, 10)
      ctx.strokeRect(cx + 28, cy - 8 + snapshot.gsDev * 26, 10, 16)
    }
    drawTape(ctx, width * 0.74, 8, width * 0.24, height * 0.68, snapshot.altFt, 'ALT', '#d7e4f2', Math.round(snapshot.ap.altitudeFt))
    ctx.fillStyle = '#f4f7fb'
    ctx.font = '12px sans-serif'
    ctx.fillText(`${Math.round(snapshot.vsFpm)} fpm`, width * 0.74, height * 0.78)
    ctx.fillText(`${Math.round(snapshot.headingMag).toString().padStart(3, '0')}°`, width * 0.42, height - 10)
    ctx.strokeStyle = '#8fb4c9'
    ctx.beginPath()
    const arcY = height - 22
    ctx.moveTo(boxX, arcY)
    ctx.lineTo(boxX + boxW, arcY)
    ctx.stroke()
  }

  private paintNd(snapshot: HudSnapshot): void {
    const canvas = this.nd
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = canvas.clientWidth || 280
    const height = canvas.clientHeight || 180
    fitCanvas(canvas, ctx, width, height)
    ctx.fillStyle = '#07141c'
    ctx.fillRect(0, 0, width, height)
    const range = 6 * 1852
    const scale = Math.min(width, height) * 0.42 / range
    const cx = width / 2
    const cy = height / 2
    const project = (east: number, north: number) => ({
      x: cx + (east - snapshot.east) * scale,
      y: cy - (north - snapshot.north) * scale,
    })
    ctx.strokeStyle = '#1e3d52'
    ctx.beginPath()
    ctx.arc(cx, cy, range * scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#d7dee6'
    ctx.lineWidth = 3
    for (const runway of RUNWAYS) {
      const a = project(runway.low.east, runway.low.north)
      const b = project(runway.high.east, runway.high.north)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.strokeStyle = '#e0a526'
    ctx.lineWidth = 1
    const plan = patternPlan()
    ctx.beginPath()
    plan.waypoints.forEach((point, index) => {
      const p = project(point.east, point.north)
      if (index === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
    const gate = project(gatePad().east, gatePad().north)
    ctx.fillStyle = '#e0a526'
    ctx.fillRect(gate.x - 3, gate.y - 3, 6, 6)
    const aim = runwayPoint(RUNWAYS[0], 3264 * 0.3048 + 360)
    const td = project(aim.east, aim.north)
    ctx.strokeStyle = '#9be7c4'
    ctx.strokeRect(td.x - 4, td.y - 4, 8, 8)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(snapshot.headingTrue)
    ctx.fillStyle = '#f4f7fb'
    ctx.beginPath()
    ctx.moveTo(0, -10)
    ctx.lineTo(7, 8)
    ctx.lineTo(-7, 8)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = '#9fb3c8'
    ctx.font = '12px sans-serif'
    ctx.fillText('6 NM', 8, 16)
    ctx.fillText(snapshot.windText, 8, height - 10)
  }
}

function markup(): string {
  const flaps = FLAP_DETENTS.map(
    (detent, index) =>
      `<button type="button" data-flap="${index}">${detent === 0 ? 'UP' : detent}</button>`,
  ).join('')
  return `
    <div class="yoke" data-testid="yoke"></div>
    <aside class="thumb" data-testid="thumb">
      <div class="throttle" data-testid="throttle">
        <div class="throttle-knob"></div>
        <span data-bind="n1">N1 22</span>
      </div>
      <div class="flap-stack" data-testid="flaps">
        <span class="thumb-label">FLAPS <strong data-bind="flap">5</strong></span>
        ${flaps}
      </div>
      <button type="button" class="gear-handle is-down" data-gear data-testid="gear">GEAR DOWN</button>
    </aside>
    <footer class="dock">
      <div class="dock-panels">
        <section class="panel panel-pfd">
          <canvas class="pfd" data-testid="pfd"></canvas>
        </section>
        <section class="panel panel-nd">
          <canvas class="nd" data-testid="nd"></canvas>
        </section>
        <section class="panel panel-eng" data-testid="engines">
          ${engineMarkup('l', 'ENG 1')}
          ${engineMarkup('r', 'ENG 2')}
        </section>
      </div>
      <div class="dock-bar">
        <span class="phase" data-bind="phase">GND 121.9</span>
        <button type="button" data-page="nd">ND</button>
        <button type="button" data-page="eng">ENG</button>
        <button type="button" data-page="mcp">MCP</button>
        <button type="button" data-page="fmc">FMC</button>
        <button type="button" data-page="atc" data-testid="atc-open">ATC</button>
        <button type="button" data-view>VIEW</button>
        <button type="button" data-look>LOOK</button>
        <button type="button" data-center>CTR</button>
        <button type="button" data-brake>PARK</button>
        <button type="button" data-rev>REV</button>
        <button type="button" data-spoiler>SPLR</button>
        <span class="note" data-bind="note"></span>
      </div>
    </footer>
    <section class="sheet" data-testid="sheet">
      <header>
        <h2 data-bind="page-title">Page</h2>
        <button type="button" data-close>Close</button>
      </header>
      <div class="page page-mcp" data-testid="mcp">
        <div class="mode-row">
          <button type="button" data-ap>AP</button>
          <button type="button" data-at>A/T</button>
          <button type="button" data-alt-mode>ALT HOLD</button>
        </div>
        ${stepper('SPD', 'spd', [-10, -1, 1, 10])}
        ${stepper('HDG', 'hdg', [-10, -1, 1, 10])}
        ${stepper('ALT', 'alt', [-1000, -100, 100, 1000])}
        ${stepper('V/S', 'vs', [-500, -100, 100, 500])}
      </div>
      <div class="page page-fmc" data-testid="fmc">
        <p class="fine">Game performance numbers for this model. Not certified and not Boeing data.</p>
        <div class="fmc-grid">
          <span>Mass</span><strong data-bind="mass"></strong>
          <span>Fuel</span><strong data-bind="fuel"></strong>
          <span>V1</span><strong data-bind="v1"></strong>
          <span>VR</span><strong data-bind="vr"></strong>
          <span>V2</span><strong data-bind="v2"></strong>
          <span>VAPP</span><strong data-bind="vapp"></strong>
        </div>
        <h3>Left pattern 31L</h3>
        <ul class="legs" data-bind="legs"></ul>
        <h3>Local weather</h3>
        <p data-bind="wx"></p>
        <div class="wx-row">
          <button type="button" data-wx="calm">Calm</button>
          <button type="button" data-wx="bay">Bay breeze</button>
          <button type="button" data-wx="cross">Crosswind</button>
          <button type="button" data-wx="haze">Haze</button>
        </div>
      </div>
      <div class="page page-atc" data-testid="atc">
        <div class="atc-log" data-bind="atc-log"></div>
        <div class="atc-menu" data-bind="atc-menu"></div>
      </div>
    </section>
    <div class="crash">
      <p></p>
      <button type="button" data-reset>Return to 31L</button>
    </div>
  `
}

function engineMarkup(side: 'l' | 'r', title: string): string {
  return `
    <div class="engine-col">
      <h3>${title}</h3>
      <p><span>N1</span><strong data-bind="n1-${side}"></strong></p>
      <p><span>EGT</span><strong data-bind="egt-${side}"></strong></p>
      <p><span>N2</span><strong data-bind="n2-${side}"></strong></p>
      <p><span>FF</span><strong data-bind="ff-${side}"></strong></p>
    </div>
  `
}

function stepper(label: string, target: 'spd' | 'hdg' | 'alt' | 'vs', deltas: number[]): string {
  const buttons = deltas.map(
    (delta) => `<button type="button" data-step="${target}" data-delta="${delta}">${delta > 0 ? '+' : ''}${delta}</button>`,
  )
  const mid = Math.floor(buttons.length / 2)
  return `<div class="stepper"><span>${label}</span>${buttons.slice(0, mid).join('')}<strong data-bind="${target}"></strong>${buttons.slice(mid).join('')}</div>`
}

function paintEngineColumn(root: ParentNode, side: 'l' | 'r', engine: EngineReadout): void {
  setText(root, `n1-${side}`, `${engine.n1.toFixed(1)}%`)
  setText(root, `egt-${side}`, `${Math.round(engine.egt)}°`)
  setText(root, `n2-${side}`, `${engine.n2.toFixed(1)}%`)
  setText(root, `ff-${side}`, `${Math.round(engine.ff)} kg/h`)
}

function setText(root: ParentNode, name: string, value: string): void {
  root.querySelectorAll(`[data-bind="${name}"]`).forEach((node) => {
    if (node.textContent !== value) node.textContent = value
  })
}

function fitCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const nextW = Math.max(1, Math.floor(width * dpr))
  const nextH = Math.max(1, Math.floor(height * dpr))
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW
    canvas.height = nextH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawTape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  label: string,
  color: string,
  bug: number,
): void {
  ctx.fillStyle = '#0c1824'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#24506d'
  ctx.strokeRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.font = '11px sans-serif'
  ctx.fillText(label, x + 6, y + 14)
  ctx.font = 'bold 22px sans-serif'
  ctx.fillStyle = '#f4f7fb'
  const text = label === 'ALT' ? Math.round(value).toString() : Math.round(value).toString()
  ctx.fillText(text, x + 8, y + h / 2)
  ctx.fillStyle = '#e0a526'
  ctx.font = '12px sans-serif'
  ctx.fillText(bug.toString(), x + 8, y + h - 8)
}

function pageTitle(page: PageId | null): string {
  switch (page) {
    case 'nd':
      return 'Navigation'
    case 'eng':
      return 'Engines'
    case 'mcp':
      return 'Mode control'
    case 'fmc':
      return 'Flight management'
    case 'atc':
      return 'Kennedy clearance'
    case null:
      return ''
    default: {
      const neverPage: never = page
      return neverPage
    }
  }
}

function labelPhase(phase: AtcPhase): string {
  switch (phase) {
    case 'parked':
      return 'HOLD SHORT'
    case 'taxi-out':
      return 'TAXI'
    case 'lined-up':
      return 'LINE UP'
    case 'cleared-takeoff':
      return 'CLEARED TKOF'
    case 'airborne':
      return 'AIRBORNE'
    case 'closed-traffic':
      return 'CLOSED TRAFFIC'
    case 'cleared-land':
      return 'CLEARED LAND'
    case 'go-around':
      return 'GO AROUND'
    case 'rollout':
      return 'ROLLOUT'
    case 'taxi-in':
      return 'TAXI IN'
    case 'at-gate':
      return 'GATE B12'
    default: {
      const neverPhase: never = phase
      return neverPhase
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}
