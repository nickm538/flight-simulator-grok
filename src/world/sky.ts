import * as THREE from 'three'
import type { Weather } from '../game/weather'

export function createSky(scene: THREE.Scene): { apply(weather: Weather): void; setDetail(scale: number): void } {
  let detail = 1
  const uniforms = {
    top: { value: new THREE.Color('#1c4e86') },
    horizon: { value: new THREE.Color('#f0d7b0') },
    haze: { value: new THREE.Color('#c9d4de') },
    visibility: { value: 1 },
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(16000, 28, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 haze;
        uniform float visibility;
        void main() {
          float h = normalize(vDir).y;
          float lift = smoothstep(-0.05, 0.45, h);
          vec3 col = mix(horizon, top, lift);
          col = mix(haze, col, clamp(visibility, 0.25, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  )
  scene.add(sky)
  const hemi = new THREE.HemisphereLight(0xc5d7ee, 0x6d5a3e, 0.9)
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6)
  sun.position.set(-900, 1400, 500)
  scene.add(hemi, sun)
  const fog = new THREE.Fog(0xd5c7ae, 4000, 14000)
  scene.fog = fog
  sky.frustumCulled = false
  return {
    apply(weather) {
      const vis = weather.visibilityM
      uniforms.visibility.value = Math.max(0.25, Math.min(1, vis / 12000))
      fog.near = Math.max(280, vis * 0.18 * detail)
      fog.far = Math.max(fog.near + 700, vis * 0.92 * detail)
      sky.position.y = 0
    },
    setDetail(scale: number) {
      detail = Math.max(0.55, Math.min(1, scale))
    },
  }
}

export function attachShadows(renderer: THREE.WebGLRenderer, sunParent: THREE.Scene, target: THREE.Object3D): void {
  const sun = sunParent.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined
  if (!sun || !renderer.shadowMap.enabled) return
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 400
  sun.shadow.camera.left = -80
  sun.shadow.camera.right = 80
  sun.shadow.camera.top = 80
  sun.shadow.camera.bottom = -80
  sun.shadow.bias = -0.0004
  sun.target = target
  sunParent.add(sun.target)
}
