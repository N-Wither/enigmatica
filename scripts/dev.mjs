import { watch } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProject, projectRoot, sourceRoot } from './build.mjs'

const reloadPath = '/__enigmatica_reload'
const reloadClient = `<script>
(() => {
  const events = new EventSource('${reloadPath}');
  let revision;
  events.addEventListener('ready', event => {
    if (revision && revision !== event.data) location.reload();
    revision = event.data;
  });
  events.addEventListener('reload', () => location.reload());
})();
</script>`
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
}

export async function startDevServer({ port = Number(process.env.PORT ?? 3000) } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT')
  const outputRoot = path.join(projectRoot, 'dev')
  const clients = new Set()
  let revision = 0
  let timer
  let pending = false
  let closed = false
  let building

  async function rebuild() {
    do {
      pending = false
      try {
        await buildProject({ development: true })
        revision++
        for (const client of clients) client.write(`event: reload\ndata: ${revision}\n\n`)
        console.log('Rebuilt dev/')
      } catch (error) {
        console.error('Build failed; fix the source to retry.\n', error)
      }
    } while (pending && !closed)
  }

  function scheduleBuild() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (closed) return
      if (building) pending = true
      else building = rebuild().finally(() => { building = undefined })
    }, 100)
  }

  // Start watching before the first build to avoid missing edits during startup.
  const watcher = watch(sourceRoot, { recursive: true }, scheduleBuild)
  watcher.on('error', error => console.error('Source watcher error:', error))
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (pathname === reloadPath && request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        response.write(`event: ready\ndata: ${revision}\n\n`)
        clients.add(response)
        response.on('close', () => clients.delete(response))
        return
      }
      let filename = path.resolve(outputRoot, `.${pathname}`)
      const insideOutput = candidate => candidate === outputRoot || candidate.startsWith(outputRoot + path.sep)
      if (!insideOutput(filename)) {
        response.writeHead(403).end()
        return
      }
      if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html')
      if (!insideOutput(await realpath(filename))) {
        response.writeHead(403).end()
        return
      }
      let body = await readFile(filename)
      if (path.extname(filename).toLowerCase() === '.html') {
        const html = body.toString('utf8')
        body = Buffer.from(/<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${reloadClient}</body>`) : html + reloadClient)
      }
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store', 'Content-Length': body.length,
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch (error) {
      response.writeHead(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : error instanceof URIError ? 400 : 500).end()
    }
  })
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n')
  }, 15000)

  async function close() {
    closed = true
    clearTimeout(timer)
    clearInterval(heartbeat)
    watcher.close()
    for (const client of clients) client.end()
    if (server.listening) {
      const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      server.closeIdleConnections()
      await stopped
    }
    await building
  }

  try {
    building = buildProject({ development: true })
    await building
    building = undefined
    if (pending) scheduleBuild()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (error) {
    // Avoid awaiting the same rejected startup build again in close().
    building = undefined
    await close()
    throw error
  }
  return { url: `http://127.0.0.1:${server.address().port}`, close }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dev = await startDevServer()
    console.log(`Development server: ${dev.url}\nWatching src/; press Ctrl+C to stop.`)
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await dev.close() })
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
