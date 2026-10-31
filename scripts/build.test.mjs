import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { buildProject, projectRoot, sourceRoot } from './build.mjs'
import { startDevServer } from './dev.mjs'

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function eventually(check) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try { if (await check()) return } catch { /* Rebuild may be replacing files. */ }
    await delay(50)
  }
  assert.fail('Timed out waiting for a rebuild')
}

test('build mirrors the source tree, compiles every TS entry and preserves assets', async () => {
  const fixture = await mkdtemp(path.join(sourceRoot, '.build-test-'))
  try {
    await mkdir(path.join(fixture, 'nested/empty'), { recursive: true })
    await writeFile(path.join(fixture, 'nested/entry.ts'), 'export const answer: number = 42')
    await writeFile(path.join(fixture, 'nested/asset.bin'), Buffer.from([0, 255, 13, 10]))
    const output = await buildProject()
    async function verify(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name)
        const destination = path.join(output, path.relative(sourceRoot, source).replace(/\.ts$/, '.js'))
        if (entry.isDirectory()) {
          assert.equal((await stat(destination)).isDirectory(), true)
          await verify(source)
        } else if (source.endsWith('.ts')) {
          assert.equal((await stat(destination)).isFile(), true)
          await assert.rejects(stat(destination.replace(/\.js$/, '.ts')), { code: 'ENOENT' })
        } else {
          assert.deepEqual(await readFile(destination), await readFile(source))
        }
      }
    }
    await verify(sourceRoot)
    assert.ok((await readdir(path.join(output, '_chunks'))).some(name => name.endsWith('.js')))
    assert.doesNotMatch(await readFile(path.join(output, 'components/enigmatica-game.js'), 'utf8'), /from\s*["']lit["']/)
    await writeFile(path.join(output, '.stale-test-file'), 'stale')
    await buildProject()
    await assert.rejects(stat(path.join(output, '.stale-test-file')), { code: 'ENOENT' })
  } finally {
    assert.ok(fixture.startsWith(sourceRoot + path.sep))
    await rm(fixture, { recursive: true, force: true })
    await buildProject()
  }
})

test('dev serves files and reload events for additions, changes, renames and deletions', async () => {
  const dev = await startDevServer({ port: 0 })
  const fixture = await mkdtemp(path.join(sourceRoot, '.build-test-'))
  const outputFixture = path.join(projectRoot, 'dev', path.basename(fixture))
  const controller = new AbortController()
  const events = []
  let reading
  try {
    const html = await fetch(dev.url).then(response => response.text())
    assert.match(html, /new EventSource/)
    assert.match(html, /components\/enigmatica-game\.js/)
    // Every HTML module URL must resolve to generated JavaScript, including chat.
    for (const [, url] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.ok(url.endsWith('.js'), url)
      const response = await fetch(new URL(url, dev.url))
      assert.equal(response.status, 200, url)
      assert.match(response.headers.get('content-type'), /javascript/, url)
    }
    assert.doesNotMatch(await readFile(path.join(projectRoot, 'dev/index.html'), 'utf8'), /new EventSource/)
    const js = await fetch(dev.url + '/components/enigmatica-game.js')
    assert.equal(js.status, 200)
    assert.match(js.headers.get('content-type'), /javascript/)
    assert.match(await js.text(), /sourceMappingURL=data:/)
    assert.equal((await fetch(dev.url + '/missing')).status, 404)
    assert.equal((await fetch(dev.url + '/%ZZ')).status, 400)
    assert.equal((await fetch(dev.url + '/%2e%2e%5cpackage.json')).status, 403)
    const stream = await fetch(dev.url + '/__enigmatica_reload', { signal: controller.signal })
    const reader = stream.body.getReader()
    reading = (async () => {
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        events.push(decoder.decode(value, { stream: true }))
      }
    })().catch(error => { if (error.name !== 'AbortError') throw error })
    await eventually(() => events.join('').includes('event: ready'))
    await writeFile(path.join(fixture, 'entry.ts'), 'export const value: number = 1')
    await eventually(async () => (await readFile(path.join(outputFixture, 'entry.js'), 'utf8')).includes('= 1'))
    await writeFile(path.join(fixture, 'entry.ts'), 'export const value: number = 2')
    await eventually(async () => (await readFile(path.join(outputFixture, 'entry.js'), 'utf8')).includes('= 2'))
    const reloads = events.join('').split('event: reload').length
    await writeFile(path.join(fixture, 'asset.txt'), 'new asset')
    await eventually(async () => (await readFile(path.join(outputFixture, 'asset.txt'), 'utf8')) === 'new asset')
    await eventually(() => events.join('').split('event: reload').length > reloads)
    await writeFile(path.join(fixture, 'asset.txt'), 'updated asset')
    await eventually(async () => (await fetch(dev.url + '/' + path.basename(fixture) + '/asset.txt').then(response => response.text())) === 'updated asset')
    await rename(path.join(fixture, 'entry.ts'), path.join(fixture, 'renamed.ts'))
    await eventually(async () => {
      await stat(path.join(outputFixture, 'renamed.js'))
      try { await stat(path.join(outputFixture, 'entry.js')); return false } catch (error) { return error.code === 'ENOENT' }
    })
    // A broken edit must keep the last successful output and recover on correction.
    const previous = await readFile(path.join(outputFixture, 'renamed.js'), 'utf8')
    const reportedErrors = []
    const reportError = console.error
    console.error = (...args) => reportedErrors.push(args)
    try {
      await writeFile(path.join(fixture, 'renamed.ts'), 'export const value: number = ;')
      await eventually(() => reportedErrors.length > 0)
      assert.equal(await readFile(path.join(outputFixture, 'renamed.js'), 'utf8'), previous)
      assert.equal((await fetch(dev.url)).status, 200)
      await writeFile(path.join(fixture, 'renamed.ts'), 'export const value: number = 3')
      await eventually(async () => (await readFile(path.join(outputFixture, 'renamed.js'), 'utf8')).includes('= 3'))
    } finally {
      console.error = reportError
    }
    await rm(path.join(fixture, 'asset.txt'))
    await eventually(async () => (await fetch(dev.url + '/' + path.basename(fixture) + '/asset.txt')).status === 404)
  } finally {
    controller.abort()
    await reading
    await dev.close()
    assert.ok(fixture.startsWith(sourceRoot + path.sep))
    await rm(fixture, { recursive: true, force: true })
    await buildProject({ development: true })
  }
})
