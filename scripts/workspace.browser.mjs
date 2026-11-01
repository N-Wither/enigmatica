// Optional real-browser regressions, using an installed Chromium browser and CDP.
// No browser download or additional npm package is required. Requires Node >=22.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startDevServer } from './dev.mjs'

const browserPath = [process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(candidate => candidate && existsSync(candidate))
if (!browserPath) throw new Error('Set BROWSER_PATH to an installed Chromium/Edge/Chrome executable.')
if (!globalThis.WebSocket) throw new Error('Browser checks require Node.js 22 or newer.')

const profile = await mkdtemp(path.join(os.tmpdir(), 'enigmatica-browser-'))
const server = await startDevServer({ port: 0 })
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: 'ignore' })
let launchError
browser.on('error', error => { launchError = error })
let socket
let nextId = 0
const pending = new Map()
const errors = []
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function eventually(operation) {
  const deadline = Date.now() + 15000
  let lastError
  while (Date.now() < deadline) {
    if (launchError) throw launchError
    try { const result = await operation(); if (result) return result } catch (error) { lastError = error }
    await delay(30)
  }
  throw new Error('Timed out waiting for browser', { cause: lastError })
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(source) {
  const result = await command('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function execute(source) { await evaluate(`${source}; void 0`) }
async function settle() {
  await evaluate(`(async () => {
    for (let i = 0; i < 5; i++) await Promise.all([app, table, inventory, chat].map(element => element.updateComplete));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`)
}
async function viewport(width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false,
    screenOrientation: { type: width > height ? 'landscapePrimary' : 'portraitPrimary', angle: width > height ? 90 : 0 } })
  await settle()
}
async function click(expression) {
  const point = await evaluate(`(() => { const rect = (${expression}).getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}; })()`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  await settle()
}
async function key(key) {
  const windowsVirtualKeyCode = key === 'Escape' ? 27 : 9
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode })
  await settle()
}
async function withinBounds() {
  return evaluate(`(() => {
    const bounds = table.shadowRoot.querySelector('.surface').getBoundingClientRect();
    return [...table.shadowRoot.querySelectorAll('.window:not([hidden])')].every(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= bounds.left - 1 && rect.top >= bounds.top - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
    });
  })()`)
}
async function screenshot(name) {
  if (!process.env.BROWSER_SCREENSHOT_DIR) return
  await mkdir(process.env.BROWSER_SCREENSHOT_DIR, { recursive: true })
  const { data } = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(process.env.BROWSER_SCREENSHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
}

try {
  const port = await eventually(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(server.url)}`, { method: 'PUT' }).then(response => response.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timeout)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  await command('Runtime.enable')
  await command('Page.enable')
  await eventually(() => evaluate(`!!document.querySelector('eg-worktable')?.engine && !!document.querySelector('eg-worktable')?.shadowRoot`))
  await execute(`window.app = document.querySelector('enigmatica-game'); window.table = app.querySelector('eg-worktable'); window.inventory = app.querySelector('eg-inventory'); window.chat = app.querySelector('eg-chat'); window.drawer = app.shadowRoot.querySelector('dialog'); window.toggle = app.shadowRoot.querySelector('#chat-toggle');`)
  await viewport(1440, 900)
  assert.equal(await evaluate(`table.openItems.length`), 0)
  assert.equal(await evaluate(`drawer.open && !drawer.matches(':modal')`), true)
  assert.equal(await evaluate(`inventory.shadowRoot.querySelectorAll('button').length`), 2)

  await click(`inventory.shadowRoot.querySelector('button')`)
  assert.equal(await evaluate(`table.openItems.length`), 1)
  await click(`table.shadowRoot.querySelector('eg-notepad').shadowRoot.querySelector('textarea')`)
  await command('Input.insertText', { text: 'Persistent note / 保留内容' })
  await execute(`window.note = table.shadowRoot.querySelector('eg-notepad'); window.firstWindow = table.shadowRoot.querySelector('.window'); window.firstItem = table.openItems[0];`)
  await click(`inventory.shadowRoot.querySelector('button')`)
  assert.equal(await evaluate(`firstWindow.hidden`), true)
  await click(`inventory.shadowRoot.querySelector('button')`)
  assert.equal(await evaluate(`table.shadowRoot.querySelector('eg-notepad') === note && note.shadowRoot.querySelector('textarea').value === 'Persistent note / 保留内容'`), true)
  await click(`inventory.shadowRoot.querySelectorAll('button')[1]`)
  assert.equal(await evaluate(`table.openItems.length`), 2)

  // Drag the title bar with real pointer input, then test both worktable edges.
  const title = await evaluate(`(() => { const r = firstWindow.querySelector('.titlebar').getBoundingClientRect(); return {x:r.x + 20,y:r.y + r.height/2}; })()`)
  const original = await evaluate(`({ x: firstWindow.offsetLeft, y: firstWindow.offsetTop })`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...title })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...title })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: title.x + 170, y: title.y + 110 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: title.x + 170, y: title.y + 110 })
  await settle()
  assert.equal(await evaluate(`firstWindow.offsetLeft > ${original.x} && firstWindow.offsetTop > ${original.y}`), true)
  assert.equal(await evaluate(`Number(firstWindow.style.zIndex) > Number(table.shadowRoot.querySelectorAll('.window')[1].style.zIndex)`), true)
  assert.equal(await withinBounds(), true)
  const dragStart = await evaluate(`(() => { const r = firstWindow.querySelector('.titlebar').getBoundingClientRect(); return {x:r.x+20,y:r.y+r.height/2}; })()`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...dragStart })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: 1438, y: 898 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 1438, y: 898 })
  await settle()
  assert.equal(await withinBounds(), true)
  await click('toggle')
  assert.equal(await evaluate(`drawer.open`), false)
  assert.equal(await withinBounds(), true)
  await click('toggle')
  assert.equal(await withinBounds(), true)
  await screenshot('desktop')
  console.log('PASS desktop windows: toggle, retained input, drag, stacking, bounds, chat collapse')

  for (const [width, height, compact] of [[390, 844, true], [844, 390, true], [1200, 1600, true], [1023, 700, true], [1024, 700, false], [1440, 900, false]]) {
    await viewport(width, height)
    assert.equal(await evaluate('table.compact'), compact, `${width}×${height}`)
    assert.equal(await evaluate('app.compact'), compact)
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    assert.equal(await evaluate(`table.shadowRoot.querySelector('eg-notepad') === note && note.shadowRoot.querySelector('textarea').value === 'Persistent note / 保留内容'`), true)
    if (!compact) assert.equal(await withinBounds(), true)
  }
  await viewport(390, 844)
  assert.equal(await evaluate('drawer.open'), false)
  assert.equal(await evaluate(`table.shadowRoot.querySelectorAll('.title[aria-expanded=true]').length`), 2)
  await click(`firstWindow.querySelector('.title')`)
  assert.equal(await evaluate(`firstWindow.querySelector('.content').hidden`), true)
  assert.equal(await evaluate(`inventory.shadowRoot.querySelector('button').getAttribute('aria-pressed')`), 'true')
  await click(`firstWindow.querySelector('.title')`)
  assert.equal(await evaluate(`note.shadowRoot.querySelector('textarea').value`), 'Persistent note / 保留内容')
  await screenshot('compact')
  await click('toggle')
  assert.equal(await evaluate(`drawer.matches(':modal')`), true)
  assert.equal(await evaluate(`(() => { const nav = chat.shadowRoot.querySelector('[part=character-list]'); return nav.scrollWidth <= nav.clientWidth; })()`), true)
  await screenshot('chat-drawer')
  await execute('toggle.focus()')
  assert.equal(await evaluate('app.shadowRoot.activeElement === toggle'), false)
  for (let i = 0; i < 8; i++) {
    await key('Tab')
    // Native dialogs may tab to browser chrome (reported as body), but never to background controls.
    assert.equal(await evaluate(`(() => { let element = document.activeElement; while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement; return element === document.body || drawer.contains(element) || chat.contains(element) || element?.getRootNode() === chat.shadowRoot || element?.getRootNode()?.host?.localName === 'eg-dialognode'; })()`), true)
  }
  await key('Escape')
  assert.equal(await evaluate('drawer.open'), false)
  assert.equal(await evaluate(`app.shadowRoot.activeElement === toggle`), true)
  await click('toggle')
  await viewport(1440, 900)
  assert.equal(await evaluate(`drawer.open && !drawer.matches(':modal')`), true)
  await viewport(390, 844)
  assert.equal(await evaluate(`drawer.matches(':modal')`), true)
  await key('Escape')
  await viewport(844, 390)
  await click('toggle')
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 820, y: 180 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 820, y: 180 })
  await settle()
  assert.equal(await evaluate('drawer.open'), false)
  console.log('PASS compact layouts: breakpoints, orientation, multiple folds, retained input, modal focus/Escape/backdrop/preferences')

  // Use the production bundle's own classes to test actual shadow-boundary events.
  await viewport(1440, 900)
  await execute(`window.actions = []; window.originalDispatch = app.engine.dispatchAction; app.engine.dispatchAction = action => actions.push(action); note.emit('inspect'); note.emit('inspect', {target:'explicit'});`)
  assert.deepEqual(await evaluate(`actions.map(action => action.target)`), ['notepad', 'explicit'])
  await execute(`app.engine.dispatchAction = originalDispatch; app.engine.applyEffects([{type:'setFlag',id:'test_tick',value:true}]);`)
  await settle()
  assert.equal(await evaluate(`inventory.shadowRoot.querySelectorAll('button').length`), 2)
  await click(`firstWindow.querySelector('.close')`)
  assert.equal(await evaluate(`inventory.shadowRoot.querySelector('button').getAttribute('aria-pressed')`), 'false')
  await execute(`app.engine.inventory.add({id:'notepad',count:1,state:{page:'another'}}); app.engine.inventory.add({id:'plain',count:3});`)
  await settle()
  assert.equal(await evaluate(`inventory.shadowRoot.querySelectorAll('button').length`), 4)
  assert.equal(await evaluate(`inventory.shadowRoot.querySelectorAll('button')[3].disabled`), true)
  await click(`inventory.shadowRoot.querySelectorAll('button')[2]`)
  await execute(`window.other = table.openItems.find(item => item.id === 'notepad'); app.engine.inventory.remove(firstItem);`)
  await settle()
  assert.equal(await evaluate(`table.openItems.includes(other) && !note.isConnected`), true)
  await execute(`window.oldEngine = app.engine; app.engine = new oldEngine.constructor({}, {inventory:[{id:'notepad',count:1}]});`)
  await settle()
  assert.equal(await evaluate(`table.engine === app.engine && inventory.engine === app.engine && chat.engine === app.engine && table.openItems.length === 0 && table.shadowRoot.querySelectorAll('.window').length === 0`), true)
  assert.deepEqual(errors, [])
  console.log('PASS actual Shadow DOM events, inventory identity/removal, disabled items, engine replacement; no browser exceptions')
} finally {
  for (const request of pending.values()) clearTimeout(request.timeout)
  socket?.close()
  if (browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve))
    browser.kill()
    await exited
  }
  await server.close()
  // mkdtemp created this task-specific directory directly beneath the OS temp root.
  if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('enigmatica-browser-')) throw new Error('Unexpected browser profile path')
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
