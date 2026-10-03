import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist')
const port = Number(process.env.PORT) || 8080

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const requested = normalize(decodeURIComponent(url.pathname))
  const relative = requested.replace(/^[/\\]+/, '')
  let path = resolve(root, relative)
  if (!path.startsWith(root)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html')
  if (!existsSync(path)) {
    response.writeHead(404)
    response.end('Not found')
    return
  }
  response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(response)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Canyon 318 listening on ${port}`)
})
