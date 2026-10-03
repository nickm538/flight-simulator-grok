# Canyon 318

An unofficial browser flight game. One original Boeing 737-800 NG–class jet, painted canyon blue, red, and gold, flies a visual pattern at KJFK.

This project is not affiliated with, endorsed by, or connected to Boeing, Southwest Airlines, or Microsoft. It does not use their software, gauges, logos, type manuals, or scenery. The airplane, instruments, and airport are original geometry drawn for this game.

The flight model is a simplified game approximation. It is not certified, not approved for training, and not Boeing aerodynamic or performance data.

## Fly the loop

You start on the stub at the end of runway 31L, flaps 5, parking brake set. Taxi straight ahead onto the runway, take off, fly the left pattern over the bay, and land back on 31L. Gate B12 is on the terminal ramp after rollout.

The phone never shows the whole cockpit. A compact primary flight display stays on screen with speed, attitude, altitude, vertical speed, and heading, and it sits in the bottom strip so it does not cover the windshield. The right edge is the thrust lever, flap detents, and gear handle, with hit targets at least 44px. Navigation, engines, the mode control panel, the FMC, and ATC open one page at a time over the view; on a phone those page buttons wrap under the display so they stay on screen. On a wide desktop window the primary flight display, nav, and engines sit side by side, and the other pages still open over the view. Phone viewports cap the WebGL pixel ratio at 1.5, leave shadows off, and shorten the fog only if frames stay slower than about 30 per second.

Drag the windshield to pitch and roll. Drag up to raise the nose. Two fingers, the right mouse button, or LOOK glance around. The exterior view shows the fans, gear, wheels, and the takeoff puff.

| Action | Touch | Keyboard |
| --- | --- | --- |
| Pitch / roll | Drag the view | W/S or arrows, A/D |
| Look | Two fingers, or LOOK | |
| Thrust | Right lever | Page Up / Page Down, `]` / `[` |
| Flaps | Detent buttons | F down, Shift+F up |
| Gear | Gear handle | G |
| Brakes | BRAKE, hold | Space |
| Reverse / spoilers | REV / SPLR | R / X |
| Outside view | VIEW | V |
| Center the look | CTR | C |

ATC is a local script. Request taxi, takeoff, landing, and a gate. Say again, wind, altimeter, wilco, and traffic in sight are follow-ups. Nothing calls a network.

Weather is local too. The FMC weather page sets bay breeze, calm, crosswind, or haze. Wind changes airspeed and drift. Lower visibility shortens the fog and adds a small gust.

## What is simulated, and what is simplified

Simulated in this pass:

- A 737-800-sized wing, mass, and two engines with spool-up, N1, and a thrust curve that falls off with speed
- Lift, drag, flaps, spoilers, and ground effect
- Gear springs and dampers, nosewheel steering, brakes, and reverse on the ground
- Wind added to the air vector, so headwind and crosswind change the takeoff and the pattern
- Visibility-scaled fog and a light gust
- Left closed traffic geometry for the real 31L/13R pavement, plus the other KJFK runways as scenery

Simplified on purpose:

- Stability augmentation commands pitch and roll rate in the air. It is a game feel system, not a 737 flight control law
- One thrust lever drives both engines. The engine page is a display curve, not an engine deck
- V-speeds are scaled game numbers for the weight you are carrying
- Flaps move faster than the airplane, so the pattern is playable
- No autoland. The mode control panel holds heading, altitude or vertical speed, and speed
- Flat ground, no traffic aircraft, no individual people, and no airports beyond this KJFK loop

## Run it

Install, play, and build:

```bash
npm install
npm run dev
npm test
npm run build
npm start
```

`npm run dev` serves the game for local play. `npm run build` typechecks and writes `dist/`. `npm start` serves that folder with Node. The server reads `PORT` when it is set and otherwise uses 8080. No API keys and no other environment variables are required.

The included `Dockerfile` builds the static game and runs the same server. It does not need secrets.
