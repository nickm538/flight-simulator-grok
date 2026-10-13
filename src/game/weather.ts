import { clamp, rad } from '../sim/math'
import { ktToMps, magToTrue } from '../sim/units'

export type WeatherPreset = 'calm' | 'bay' | 'cross' | 'haze'

export interface Weather {
  preset: WeatherPreset
  /** Direction the wind comes from, magnetic degrees. */
  windFromMag: number
  windKt: number
  visibilityM: number
}

export interface WindField {
  east: number
  north: number
  gust: number
}

export function weatherPreset(preset: WeatherPreset): Weather {
  switch (preset) {
    case 'calm':
      return { preset, windFromMag: 300, windKt: 2, visibilityM: 20000 }
    case 'bay':
      return { preset, windFromMag: 310, windKt: 8, visibilityM: 14000 }
    case 'cross':
      return { preset, windFromMag: 230, windKt: 14, visibilityM: 11000 }
    case 'haze':
      return { preset, windFromMag: 190, windKt: 7, visibilityM: 4200 }
    default: {
      const neverPreset: never = preset
      return neverPreset
    }
  }
}

/** Wind and a visibility-scaled gust. Both enter the flight model. */
export function windField(weather: Weather): WindField {
  const fromTrue = rad(magToTrue(weather.windFromMag))
  const speed = ktToMps(weather.windKt)
  const visFactor = clamp(1 - weather.visibilityM / 16000, 0, 1)
  return {
    east: -Math.sin(fromTrue) * speed,
    north: -Math.cos(fromTrue) * speed,
    gust: speed * 0.11 * visFactor,
  }
}

export function windPhrase(weather: Weather): string {
  const dir = String(Math.round(weather.windFromMag / 10) * 10).padStart(3, '0')
  return `wind ${dir} at ${Math.round(weather.windKt)}`
}

export function visibilitySm(weather: Weather): number {
  return weather.visibilityM / 1609.344
}
