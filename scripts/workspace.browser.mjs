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
async function execute(source) { await evaluate(`(async () => { ${source}; })()`) }
async function settle() {
  await evaluate(`(async () => {
    for (let i = 0; i < 5; i++) await Promise.all([app, table, inventory, chat].map(element => element.updateComplete));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(app.shadowRoot.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})));
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
  await execute(`window.app = document.querySelector('enigmatica-game'); window.table = app.querySelector('eg-worktable'); window.inventory = app.querySelector('eg-inventory'); window.chat = app.querySelector('eg-chat'); window.drawer = app.shadowRoot.querySelector('dialog'); window.toggle = app.shadowRoot.querySelector('[part=chat-toggle]');`)
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


  // Inspect midpoints in one browser task so CDP latency cannot hide transitions.
  await viewport(1440, 900)
  const closing = await evaluate(`(async () => {
    const main = app.shadowRoot.querySelector('main');
    const before = app.shadowRoot.querySelector('[part=chat]').getBoundingClientRect().width;
    toggle.click(); await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 70));
    const during = app.shadowRoot.querySelector('[part=chat]').getBoundingClientRect().width;
    return {open:drawer.open, moving:main.getAnimations().length > 0, between:during > 0 && during < before};
  })()`)
  assert.deepEqual(closing, { open: true, moving: true, between: true })
  await settle()
  assert.equal(await evaluate('drawer.open'), false)
  assert.equal(await evaluate(`app.shadowRoot.querySelector('[part=chat]').getBoundingClientRect().width`), 0)
  await execute(`await (async () => {
    toggle.click(); await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 60));
    toggle.click(); await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 40));
    toggle.click(); await app.updateComplete;
  })()`)
  await settle()
  assert.equal(await evaluate(`drawer.open && toggle.getAttribute('aria-expanded') === 'true'`), true)
  assert.equal(await withinBounds(), true)
  await execute(`toggle.click(); await app.updateComplete`)
  await viewport(1300, 850)
  assert.equal(await evaluate('drawer.open'), false)
  assert.equal(await evaluate(`app.shadowRoot.querySelector('[part=chat]').getBoundingClientRect().width`), 0)
  await click('toggle')
  await execute(`toggle.click(); await app.updateComplete`)
  await viewport(390, 844)
  assert.equal(await evaluate('drawer.open'), false)
  await viewport(1440, 900)
  assert.equal(await evaluate('drawer.open'), false)
  await click('toggle')
  await viewport(390, 844)
  const opening = await evaluate(`(async () => {
    toggle.click(); await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 70));
    const rect = drawer.getBoundingClientRect();
    const opacity = Number(getComputedStyle(drawer,'::backdrop').opacity);
    return {modal:drawer.matches(':modal'), between:rect.left < 0 && rect.left > -rect.width, fading:opacity > 0 && opacity < 1};
  })()`)
  assert.deepEqual(opening, { modal: true, between: true, fading: true })
  await settle()
  const hiding = await evaluate(`(async () => {
    app.shadowRoot.querySelector('[part=chat-hide]').click(); await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 70));
    const rect = drawer.getBoundingClientRect();
    const opacity = Number(getComputedStyle(drawer,'::backdrop').opacity);
    return {open:drawer.open, between:rect.left < 0 && rect.left > -rect.width, fading:opacity > 0 && opacity < 1};
  })()`)
  assert.deepEqual(hiding, { open: true, between: true, fading: true })
  await settle()
  assert.equal(await evaluate(`!drawer.open && app.shadowRoot.activeElement === toggle`), true)
  await execute(`toggle.click(); await app.updateComplete; toggle.click(); await app.updateComplete; toggle.click(); await app.updateComplete`)
  await viewport(1440, 900)
  assert.equal(await evaluate(`drawer.open && !drawer.matches(':modal')`), true)
  await viewport(390, 844)
  assert.equal(await evaluate(`drawer.matches(':modal')`), true)
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await settle()
  const reduced = await evaluate(`(async () => {
    app.shadowRoot.querySelector('[part=chat-hide]').click(); await app.updateComplete;
    const closed = !drawer.open;
    toggle.click(); await app.updateComplete;
    return {closed, modal:drawer.matches(':modal'), animations:app.shadowRoot.getAnimations({subtree:true}).length};
  })()`)
  assert.deepEqual(reduced, { closed: true, modal: true, animations: 0 })
  await key('Escape')
  await command('Emulation.setEmulatedMedia', { features: [] })
  await settle()
  await viewport(1440, 900)
  console.log('PASS chat animation midpoints, grid resizing, reversals, breakpoint changes, backdrop fade and reduced motion')

  // Verify actual geometry using engine-local content.
  await execute(`window.chatTestEngine = app.engine; window.chatTestOpen = [...table.openItems]; window.playerChat = new app.engine.constructor({
    characters:[{id:'guide',name:'Guide',avatars:{default:'image/avatars/default.png'}},
      {id:'player',name:'Player',tags:['player'],avatars:{default:'image/avatars/default.png'}},
      {id:'no-avatar',name:'No avatar',tags:['player']}, {id:'ordinary',name:'Ordinary',tags:['Player']}],
    dialogues:[{id:'layout',characterId:'guide',startNode:'npc',nodes:{
      npc:{speaker:'guide',text:'NPC message',next:'player'},
      player:{speaker:'player',text:'Player message',next:'no-avatar'},
      'no-avatar':{speaker:'no-avatar',text:'Player without avatar',next:'unknown'},
      unknown:{speaker:'missing',text:'Unknown character',next:'ordinary'},
      ordinary:{speaker:'ordinary',text:'Case-sensitive tag',next:'long'},
      long:{speaker:'player',text:'A long player message '.repeat(80)}
    }}]
  },{unlockedCharacters:['guide']}); app.engine = playerChat; playerChat.startDialogue('layout');
  for(let i=0;i<5;i++) playerChat.advanceDialogue();`)
  await settle()
  async function chatGeometry() {
    return evaluate(`(() => {
      const nodes = [...chat.shadowRoot.querySelector('[part=history]').querySelectorAll('eg-dialognode')];
      const rect = element => element.getBoundingClientRect();
      const npc = nodes[0].shadowRoot, player = nodes[1].shadowRoot, noAvatar = nodes[2].shadowRoot;
      const row = player.querySelector('[part=wrapper]');
      const avatar = player.querySelector('[part=avatar]'), bubble = player.querySelector('[part=message]');
      const long = nodes[5].shadowRoot.querySelector('[part=wrapper]');
      return {
        count:nodes.length,
        npcLeft:rect(npc.querySelector('[part=avatar]')).right <= rect(npc.querySelector('[part=message]')).left,
        playerRight:rect(avatar).left >= rect(bubble).right && Math.abs(rect(avatar).right - rect(row).right) < 1,
        rightName:getComputedStyle(player.querySelector('[part=speaker]')).textAlign === 'right',
        normalText:getComputedStyle(player.querySelector('[part=content]')).direction === 'ltr',
        noAvatar:!noAvatar.querySelector('[part=avatar]') && Math.abs(rect(noAvatar.querySelector('[part=message]')).right - rect(noAvatar.querySelector('[part=wrapper]')).right) < 1,
        unknown:!nodes[3].isPlayer && !nodes[3].shadowRoot.querySelector('[part=avatar]'),
        caseSensitive:!nodes[4].isPlayer,
        fits:long.scrollWidth <= long.clientWidth && chat.shadowRoot.querySelector('[part=chat-panel-wrapper]').scrollWidth <= chat.shadowRoot.querySelector('[part=chat-panel-wrapper]').clientWidth,
        noDuplicate:[...chat.shadowRoot.querySelectorAll('eg-dialognode')].filter(node=>node.shadowRoot.querySelector('[part=message]')).length === 6
      };
    })()`)
  }
  const expectedGeometry = { count: 6, npcLeft: true, playerRight: true, rightName: true, normalText: true,
    noAvatar: true, unknown: true, caseSensitive: true, fits: true, noDuplicate: true }
  assert.deepEqual(await chatGeometry(), expectedGeometry)
  await screenshot('player-messages-desktop')
  await viewport(390, 844)
  await click('toggle')
  assert.deepEqual(await chatGeometry(), expectedGeometry)
  await screenshot('player-messages-compact')
  await execute(`app.engine = new playerChat.constructor({characters:[{id:'guide',name:'Guide'},
    {id:'player',name:'Player',tags:['player'],avatars:{default:'image/avatars/default.png'}}],
    dialogues:[{id:'legacy',characterId:'guide',startNode:'hello',nodes:{hello:{speaker:'player',text:'Legacy active message'}}}]
  },{unlockedCharacters:['guide'],dialogue:{id:'legacy',currentNode:'hello',done:false}})`)
  await settle()
  assert.equal(await evaluate(`(() => {
    const nodes = [...chat.shadowRoot.querySelectorAll('eg-dialognode')];
    const wrapper = nodes[0]?.shadowRoot.querySelector('[part=wrapper]');
    const avatar = wrapper?.querySelector('[part=avatar]');
    return nodes.length === 1 && nodes[0].isPlayer && wrapper.lastElementChild === avatar &&
      Math.abs(avatar.getBoundingClientRect().right - wrapper.getBoundingClientRect().right) < 1;
  })()`), true)

  // Choice/input replies share the real character-message renderer and controls.
  await execute(`window.responseContent = {
    characters:[{id:'guide',name:'Guide',avatars:{default:'image/avatars/default.png'}},
      {id:'player',name:'Player',tags:['player'],avatars:{default:'image/avatars/default.png'}}],
    dialogues:[{id:'responses',characterId:'guide',startNode:'npc-choice',nodes:{
      'npc-choice':{type:'choice',options:[{id:'reply',as:'guide',text:'translate:ui.send',next:'npc-input',effects:[{type:'setVariable',id:'votes',value:1,operation:'add'}]}]},
      'npc-input':{type:'input',as:'guide',next:'player-choice'},
      'player-choice':{type:'choice',options:[{id:'reply',text:'translate:ui.send',next:'player-input'}]},
      'player-input':{type:'input',effects:[{type:'setVariable',id:'entries',value:1,operation:'add'}],gates:[{keywords:['finish'],target:'end'}]},
      end:{speaker:'guide',text:'End'}
    }}]
  }; app.engine = new playerChat.constructor(responseContent,{unlockedCharacters:['guide']});
  app.engine.startDialogue('responses');
  window.activeReply = () => [...chat.shadowRoot.querySelectorAll('eg-dialognode')].find(node => node.active);`)
  await settle()
  await execute(`window.expectedReply = activeReply().shadowRoot.querySelector('[part=option]').textContent`)
  await click(`activeReply().shadowRoot.querySelector('[part=option]')`)
  await execute(`activeReply().shadowRoot.querySelector('input').value = 'NPC reply'`)
  await click(`activeReply().shadowRoot.querySelector('button[type=submit]')`)
  await click(`activeReply().shadowRoot.querySelector('[part=option]')`)
  for (const text of ['translate:ui.send', '<img src=x onerror="alert(1)">']) {
    await execute(`activeReply().shadowRoot.querySelector('input').value = ${JSON.stringify(text)}`)
    await click(`activeReply().shadowRoot.querySelector('button[type=submit]')`)
  }
  async function responseGeometry() {
    return evaluate(`(() => {
      const nodes = [...chat.shadowRoot.querySelector('[part=history]').querySelectorAll('eg-dialognode')];
      return nodes.map(node => {
        const root = node.shadowRoot, wrapper = root.querySelector('[part=wrapper]');
        const avatar = root.querySelector('[part=avatar]'), bubble = root.querySelector('[part=message]');
        const row = wrapper.getBoundingClientRect(), image = avatar.getBoundingClientRect(), message = bubble.getBoundingClientRect();
        return {speaker:root.querySelector('[part=speaker]').textContent, text:root.querySelector('[part=content]').textContent,
          aligned:node.isPlayer ? image.left >= message.right && Math.abs(image.right-row.right) < 1
            : image.right <= message.left && Math.abs(image.left-row.left) < 1,
          literal:root.querySelector('[part=content]').children.length === 0,
          controls:!!root.querySelector('button,form')};
      });
    })()`)
  }
  const localizedReply = await evaluate('expectedReply')
  const expectedResponses = [
    ['Guide', localizedReply], ['Guide', 'NPC reply'], ['Player', localizedReply],
    ['Player', 'translate:ui.send'], ['Player', '<img src=x onerror="alert(1)">'],
  ].map(([speaker, text]) => ({ speaker, text, aligned: true, literal: true, controls: false }))
  assert.deepEqual(await responseGeometry(), expectedResponses)
  assert.deepEqual(await evaluate('app.engine.state.variables'), { votes: 1, entries: 1 })
  assert.equal(await evaluate('app.engine.state.dialogue.currentNode'), 'player-input')
  await screenshot('as-responses-compact')
  await execute(`app.engine = new playerChat.constructor(responseContent, app.engine.state)`)
  await settle()
  assert.deepEqual(await responseGeometry(), expectedResponses)
  assert.deepEqual(await evaluate('app.engine.state.variables'), { votes: 1, entries: 1 })
  await viewport(1440, 900)
  assert.deepEqual(await responseGeometry(), expectedResponses)
  await screenshot('as-responses-desktop')
  await viewport(390, 844)
  console.log('PASS as/default reply speakers, real choice/input events, localized choices, literal input, geometry and restored history')

  await key('Escape')
  await execute('app.engine = chatTestEngine')
  await settle()
  await execute(`for (const item of chatTestOpen) table.toggleItem(item)`)
  await settle()
  await execute(`window.note = firstItem.element; window.firstWindow = [...table.shadowRoot.querySelectorAll('.window')].find(element => element.contains(note));`)
  assert.equal(await evaluate(`note.shadowRoot.querySelector('textarea').value`), 'Persistent note / 保留内容')
  console.log('PASS player/NPC geometry, avatars, missing characters, exact tags, long text, omitted types, history and legacy active messages')

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
