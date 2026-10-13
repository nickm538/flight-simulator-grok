import { Game } from './game/game'
import './style.css'

const app = document.querySelector('#app')
if (!(app instanceof HTMLElement)) throw new Error('Missing #app')

const game = new Game(app)
const debug = {
  read: () => game.read(),
  quality: () => game.quality(),
  throttle: (value: number) => {
    const withThrottle = game as unknown as { setThrottle(value: number): void }
    withThrottle.setThrottle(value)
  },
}
Object.assign(window, { __canyon: debug })
game.start()
