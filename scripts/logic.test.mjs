import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

// Bundle the engine and components together so imports and custom-element classes
// share one module instance, just as they do in the browser build.
const { customElements } = await import('@lit-labs/ssr-dom-shim')
globalThis.customElements = customElements
const bundle = await build({
  stdin: {
    contents: "export { GameEngine } from './src/core/engine.ts'; export { EnigmaticaGameElement } from './src/components/enigmatica-game.ts'; export { EgChatElement } from './src/components/game/chat.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
})
const { GameEngine, EnigmaticaGameElement, EgChatElement } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'))

const flag = (id, value = true) => ({ type: 'flag', id, value })
const setFlag = (id, value = true) => ({ type: 'setFlag', id, value })
const event = (id, trigger, effects, condition, once = true) => ({ id, trigger, effects, condition, once })

test('conditions cover defaults, nesting, actions and all variable operators', () => {
  const engine = new GameEngine({}, { variables: { count: 3, text: 'code' } })
  assert.equal(engine.checkCondition(flag('missing', false)), true)
  assert.equal(engine.checkCondition({ type: 'event', id: 'missing', completed: false }), true)
  assert.equal(engine.checkCondition({ type: 'itemUnlocked', id: 'missing', unlocked: false }), true)
  assert.equal(engine.checkCondition({ type: 'all', conditions: [] }), true)
  assert.equal(engine.checkCondition({ type: 'any', conditions: [] }), false)
  assert.equal(engine.checkCondition({ type: 'not', condition: flag('missing') }), true)
  assert.equal(engine.checkCondition({ type: 'any', conditions: [flag('missing'), flag('missing', false)] }), true)
  for (const [op, value, expected] of [['>=', 3, true], ['>', 3, false], ['==', 3, true], ['<', 4, true], ['<=', 2, false], ['!=', 4, true]]) {
    assert.equal(engine.checkCondition({ type: 'variable', id: 'count', op, value }), expected, op)
  }
  assert.equal(engine.checkCondition({ type: 'variable', id: 'text', op: '==', value: 'code' }), true)
  assert.equal(engine.checkCondition({ type: 'variable', id: 'count', op: '==', value: '3' }), false)
  assert.equal(engine.checkCondition({ type: 'variable', id: 'missing', op: '!=', value: 0 }), false)
  const condition = { type: 'action', name: 'inspect', target: 'letter' }
  assert.equal(engine.checkCondition(condition, { name: 'inspect', target: 'letter' }), true)
  assert.equal(engine.checkCondition(condition, { name: 'inspect', target: 'other' }), false)
  assert.equal(engine.checkCondition(condition), false)
})

test('initialization unlocks unconditional and eligible items and evaluates initial events', () => {
  const engine = new GameEngine({
    characters: [{ id: 'guide', name: 'Guide' }],
    items: [{ id: 'letter', name: 'Letter' }, { id: 'key', name: 'Key', unlockableWhen: flag('ready') }],
    events: [event('initial', { type: 'stateChange' }, [setFlag('ready'), { type: 'unlockCharacter', id: 'guide' }])],
  })
  assert.deepEqual(engine.state.unlockedItems, ['letter', 'key'])
  assert.deepEqual(engine.getAvailableItems().map(item => item.id), ['letter', 'key'])
  assert.deepEqual(engine.getAvailableCharacters().map(character => character.id), ['guide'])
  assert.deepEqual(engine.state.completedEvents, ['initial'])
})

test('effects settle chained conditions regardless of content order and notify once', () => {
  const engine = new GameEngine({
    items: [{ id: 'key', name: 'Key', unlockableWhen: flag('ready') }],
    events: [
      event('last', { type: 'stateChange' }, [{ type: 'discoverClue', id: 'truth' }], { type: 'itemUnlocked', id: 'key', unlocked: true }),
      event('middle', { type: 'stateChange' }, [setFlag('ready')], flag('start')),
    ],
  })
  const snapshots = []
  engine.subscribe(state => snapshots.push(state))
  engine.applyEffects([setFlag('start'), { type: 'setVariable', id: 'chapter', value: 2 }])
  assert.deepEqual(engine.state.discoveredClues, ['truth'])
  assert.equal(engine.state.variables.chapter, 2)
  assert.equal(snapshots.length, 1)
  assert.deepEqual(snapshots[0], engine.state)
})

test('action matching uses target and does not leak into subsequent updates or listeners', () => {
  const condition = { type: 'action', name: 'inspect', target: 'letter' }
  const engine = new GameEngine({
    items: [{ id: 'evidence', name: 'Evidence', unlockableWhen: { type: 'all', conditions: [condition, flag('ready')] } }],
    events: [event('inspect', { type: 'action', action: 'inspect' }, [setFlag('seen')], condition)],
  })
  engine.subscribe(() => assert.equal(engine.checkCondition(condition), false))
  engine.dispatchAction({ name: 'open', target: 'letter' })
  engine.dispatchAction({ name: 'inspect', target: 'other' })
  assert.deepEqual(engine.state.completedEvents, [])
  engine.dispatchAction({ name: 'inspect', target: 'letter' })
  assert.equal(engine.state.flags.seen, true)
  engine.applyEffects([setFlag('ready')])
  assert.deepEqual(engine.state.unlockedItems, [])
  engine.dispatchAction({ name: 'inspect', target: 'letter' })
  assert.deepEqual(engine.state.unlockedItems, ['evidence'])
})

test('wildcard actions, manual triggers, once and repeatable events retain their semantics', () => {
  const engine = new GameEngine({ events: [
    event('wildcard', { type: 'action' }, [setFlag('anyAction')]),
    event('manual', { type: 'manual' }, [setFlag('manual')], flag('allowed')),
    event('once', { type: 'action', action: 'go' }, [setFlag('once')]),
    event('repeat', { type: 'action', action: 'go' }, [setFlag('repeat')], undefined, false),
  ] })
  engine.dispatchAction({ name: 'go' })
  assert.equal(engine.state.flags.anyAction, true)
  assert.equal(engine.state.flags.manual, undefined)
  assert.equal(engine.triggerEvent('manual'), false)
  engine.applyEffects([setFlag('allowed')])
  assert.equal(engine.triggerEvent('manual'), true)
  assert.equal(engine.triggerEvent('manual'), false)
  engine.applyEffects([setFlag('once', false), setFlag('repeat', false)])
  engine.dispatchAction({ name: 'go' })
  assert.equal(engine.state.flags.once, false)
  assert.equal(engine.state.flags.repeat, true)
  assert.throws(() => engine.triggerEvent('missing'), /Unknown event/)
})

test('explicit event cycles terminate and can run again in another update', () => {
  const engine = new GameEngine({ events: [
    event('a', { type: 'manual' }, [{ type: 'triggerEvent', id: 'b' }], undefined, false),
    event('b', { type: 'manual' }, [{ type: 'triggerEvent', id: 'a' }, setFlag('done')], undefined, false),
  ] })
  assert.equal(engine.triggerEvent('a'), true)
  assert.deepEqual(engine.state.completedEvents, ['a', 'b'])
  engine.applyEffects([setFlag('done', false)])
  assert.equal(engine.triggerEvent('a'), true)
  assert.equal(engine.state.flags.done, true)
})

test('repeatable state events do not spin when their own effects change state', () => {
  const engine = new GameEngine({ events: [
    event('on', { type: 'stateChange' }, [setFlag('switch')], flag('switch', false), false),
    event('off', { type: 'stateChange' }, [setFlag('switch', false)], flag('switch'), false),
  ] })
  assert.equal(engine.state.flags.switch, false)
  assert.deepEqual(engine.state.completedEvents, ['on', 'off'])
  engine.applyEffects([setFlag('tick')])
  assert.equal(engine.state.flags.switch, false)
})

test('snapshots are detached, subscriptions can be removed and no-ops do not notify', () => {
  const engine = new GameEngine()
  let calls = 0
  const unsubscribe = engine.subscribe(state => { calls++; state.flags.external = true })
  engine.applyEffects([setFlag('ready'), { type: 'unlockItem', id: 'key' }])
  engine.applyEffects([setFlag('ready'), { type: 'unlockItem', id: 'key' }])
  engine.dispatchAction({ name: 'unused' })
  assert.equal(calls, 1)
  const snapshot = engine.state
  snapshot.flags.ready = false
  snapshot.unlockedItems.push('external')
  assert.equal(engine.state.flags.ready, true)
  assert.equal(engine.state.flags.external, undefined)
  assert.deepEqual(engine.state.unlockedItems, ['key'])
  unsubscribe()
  engine.applyEffects([setFlag('later')])
  assert.equal(calls, 1)
})

const dialogue = {
  id: 'intro', characterId: 'guide', startNode: 'hello', nodes: {
    hello: { type: 'message', speaker: 'guide', text: 'Hello', next: 'choice', effects: [{ type: 'setVariable', id: 'chapter', value: 1 }] },
    choice: { type: 'choice', options: [
      { id: 'ask', text: 'Ask', next: 'end', condition: flag('known'), effects: [{ type: 'discoverClue', id: 'answer' }] },
      { id: 'broken', text: 'Broken', next: 'missing', effects: [setFlag('shouldNotRun')] },
    ] },
    end: { type: 'message', speaker: 'guide', text: 'Done', effects: [{ type: 'unlockCharacter', id: 'guide' }] },
    single: { type: 'message', speaker: 'guide', text: 'Goodbye' },
  },
}

test('dialogues apply entry and choice effects, reject locked choices and end cleanly', () => {
  const engine = new GameEngine({ characters: [{ id: 'guide', name: 'Guide' }], dialogues: [dialogue] }, { unlockedCharacters: ['guide'] })
  assert.equal(engine.startDialogue('intro').type, 'message')
  assert.equal(engine.state.variables.chapter, 1)
  assert.equal(engine.advanceDialogue().type, 'choice')
  assert.throws(() => engine.advanceDialogue(), /Choose a dialogue option/)
  assert.throws(() => engine.chooseDialogueOption('ask'), /unavailable/)
  assert.throws(() => engine.chooseDialogueOption('absent'), /Unknown dialogue option/)
  assert.throws(() => engine.chooseDialogueOption('broken'), /Unknown dialogue node/)
  assert.equal(engine.state.flags.shouldNotRun, undefined)
  engine.applyEffects([setFlag('known')])
  assert.equal(engine.chooseDialogueOption('ask').type, 'message')
  assert.equal(engine.advanceDialogue(), null)
  assert.equal(engine.state.dialogue, null)
  assert.deepEqual(engine.state.discoveredClues, ['answer'])
  assert.deepEqual(engine.state.unlockedCharacters, ['guide'])
  assert.equal(engine.advanceDialogue(), null)
})

test('saved state restores dialogue without replaying entry effects', () => {
  const engine = new GameEngine({ characters: [{ id: 'guide', name: 'Guide' }], dialogues: [dialogue] }, { unlockedCharacters: ['guide'] })
  engine.startDialogue('intro')
  engine.applyEffects([{ type: 'setVariable', id: 'chapter', value: 7 }])
  const restored = new GameEngine({ characters: [{ id: 'guide', name: 'Guide' }], dialogues: [dialogue] }, engine.state)
  assert.equal(restored.getCurrentDialogueNode().text, 'Hello')
  assert.equal(restored.state.variables.chapter, 7)
  restored.endDialogue()
  assert.equal(restored.state.dialogue, null)
  assert.throws(() => restored.startDialogue('missing'), /Unknown dialogue/)
  assert.throws(() => new GameEngine({ items: [{ id: 'x' }, { id: 'x' }] }), /duplicate/)
  assert.throws(() => new GameEngine({ events: [{}] }), /Missing/)
})

test('a terminal message without next closes the dialogue', () => {
  const engine = new GameEngine({ characters: [{ id: 'guide', name: 'Guide' }], dialogues: [{ ...dialogue, startNode: 'single' }] }, { unlockedCharacters: ['guide'] })
  engine.startDialogue('intro')
  assert.equal(engine.advanceDialogue(), null)
})

// Use Lit's own server DOM shim to exercise event wiring and subscriptions.
// Rendering is skipped here; the browser bundle is compiled separately below.
const reactiveElementPrototype = Object.getPrototypeOf(Object.getPrototypeOf(EnigmaticaGameElement.prototype))
class TestGame extends EnigmaticaGameElement {
  connected = false
  get isConnected() { return this.connected }
  createRenderRoot() { return {} }
  update(changedProperties) { reactiveElementPrototype.update.call(this, changedProperties) }
  connect() { this.connected = true; this.connectedCallback() }
  disconnect() { this.connected = false; this.disconnectedCallback() }
}
customElements.define('test-game', TestGame)

test('component forwards item targets and payloads, cleans up and reconnects once', async () => {
  const game = new TestGame()
  game.engine = new GameEngine({ events: [event('inspect', { type: 'action', action: 'inspect' }, [setFlag('seen')], { type: 'action', name: 'inspect', target: 'letter' })] })
  const notifications = []
  game.addEventListener('game-state-change', ev => notifications.push(ev.detail))
  game.connect()
  await game.updateComplete
  const item = new (customElements.get('game-item'))()
  item.id = 'letter'
  item.__eventTargetParent = game
  item.emit('inspect', { page: 2 })
  assert.equal(game.state.flags.seen, true)
  assert.equal(notifications.length, 2)
  const forwarded = []
  const dispatch = game.engine.dispatchAction.bind(game.engine)
  game.engine.dispatchAction = action => { forwarded.push(action); dispatch(action) }
  game.disconnect()
  item.emit('inspect')
  assert.equal(forwarded.length, 0)
  game.engine.applyEffects([setFlag('offline')])
  assert.equal(notifications.length, 2)
  game.connect()
  item.emit('inspect', { target: 'override', page: 3 })
  assert.deepEqual(forwarded, [{ name: 'inspect', target: 'override', details: { name: 'inspect', target: 'override', page: 3 } }])
  assert.equal(notifications.length, 3)
  game.disconnect()
})

test('component switches subscriptions when its engine property is replaced', async () => {
  const game = new TestGame()
  const oldEngine = game.engine
  game.connect()
  await game.updateComplete
  let notifications = 0
  game.addEventListener('game-state-change', () => { notifications++ })
  game.engine = new GameEngine()
  await game.updateComplete
  assert.equal(notifications, 1)
  oldEngine.applyEffects([setFlag('old')])
  assert.equal(notifications, 1)
  game.engine.applyEffects([setFlag('new')])
  assert.equal(notifications, 2)
  assert.equal(game.state.flags.old, undefined)
  game.disconnect()
})

test('nested games route an interaction only to its nearest game', async () => {
  const outer = new TestGame()
  const inner = new TestGame()
  inner.__eventTargetParent = outer
  outer.connect()
  inner.connect()
  await Promise.all([outer.updateComplete, inner.updateComplete])
  const received = []
  outer.engine.dispatchAction = () => received.push('outer')
  inner.engine.dispatchAction = () => received.push('inner')
  const item = new (customElements.get('game-item'))()
  item.__eventTargetParent = inner
  item.emit('inspect')
  assert.deepEqual(received, ['inner'])
  outer.disconnect()
  inner.disconnect()
})

test('game component bundles for browsers', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/components/enigmatica-game.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  })
  assert.equal(result.warnings.length, 0)
  assert.ok(result.outputFiles[0].contents.length > 0)
})

// Dialogue regression coverage uses engine-local content, not the shipped demo.
const guide = { id: 'guide', name: 'Guide' }
function dialogueEngine(dialogues, initial = {}) {
  return new GameEngine({ characters: [guide], dialogues }, { unlockedCharacters: ['guide'], ...initial })
}
const terminal = { id: 'one', characterId: 'guide', startNode: 'same', nodes: {
  same: { type: 'message', speaker: 'guide', text: 'One' },
} }

test('terminal messages await acknowledgement; abort and repeat rules preserve ordered history', () => {
  const engine = dialogueEngine([terminal, { ...terminal, id: 'repeat', repeatable: true }])
  assert.equal(engine.getCharacter('guide').name, 'Guide')
  assert.equal(engine.getDialogue('one').startNode, 'same')
  engine.startDialogue('one')
  assert.equal(engine.state.dialogue.done, false)
  assert.equal(engine.state.completedDialogues.length, 0)
  assert.throws(() => engine.startDialogue('repeat'), /already active/)
  engine.endDialogue()
  assert.equal(engine.state.completedDialogues.length, 0)
  engine.startDialogue('one')
  engine.advanceDialogue()
  assert.equal(engine.state.completedDialogues[0].done, true)
  assert.throws(() => engine.startDialogue('one'), /already completed/)
  for (let i = 0; i < 2; i++) { engine.startDialogue('repeat'); engine.advanceDialogue() }
  assert.deepEqual(engine.state.completedDialogues.map(run => run.id), ['one', 'repeat', 'repeat'])
  assert.deepEqual(engine.state.chatHistory.guide.map(entry => [entry.dialogueId, entry.id]),
    [['one', 'same'], ['one', 'same'], ['repeat', 'same'], ['repeat', 'same']])
  assert.deepEqual(engine.getAvailableDialogues('guide').map(value => value.id), ['repeat'])
  const locked = dialogueEngine([terminal], { unlockedCharacters: [] })
  assert.deepEqual(locked.getAvailableDialogues('guide'), [])
  assert.throws(() => locked.startDialogue('one'), /locked/)
  assert.throws(() => dialogueEngine([{ ...terminal, characterId: 'absent' }]).startDialogue('one'), /unknown/)
})

const branching = { id: 'branch', characterId: 'guide', startNode: 'choose', nodes: {
  choose: { type: 'choice', effects: [{ type: 'custom', method: 'entered' }], options: [
    { id: 'disabled', text: 'Disabled', condition: flag('ready'), next: 'finish' },
    { id: 'hidden', text: 'Hidden', condition: flag('ready'), ifConditionNotMet: 'remove', next: 'finish' },
    { id: 'loop', text: 'Again', next: 'choose', effects: [{ type: 'custom', method: 'chosen' }] },
    { id: 'broken', text: 'Broken', next: 'absent', effects: [setFlag('bad')] },
  ] },
  finish: { type: 'message', speaker: 'guide', text: 'Finish' },
} }

test('choices without next remain active; availability, loops and failed jumps have correct effects', () => {
  const engine = dialogueEngine([branching])
  let entered = 0, chosen = 0, notifications = 0
  engine.customMethods.set('entered', () => entered++)
  engine.customMethods.set('chosen', () => chosen++)
  engine.subscribe(() => notifications++)
  engine.startDialogue('branch')
  assert.equal(engine.getCurrentDialogueNode().type, 'choice')
  assert.equal(entered, 1)
  assert.deepEqual(engine.getDialogueOptions().map(option => option.show), ['disable', 'remove', 'normal', 'normal'])
  const before = engine.state
  assert.throws(() => engine.chooseDialogueOption('disabled'), /unavailable/)
  assert.throws(() => engine.chooseDialogueOption('broken'), /Unknown dialogue node/)
  assert.deepEqual(engine.state, before)
  assert.equal(notifications, 1)
  engine.chooseDialogueOption('loop')
  assert.equal(entered, 2)
  assert.equal(chosen, 1)
  assert.equal(notifications, 2)
  assert.deepEqual(engine.state.dialogue.chosenOptions, ['loop'])
  engine.applyEffects([setFlag('ready')])
  assert.deepEqual(engine.getDialogueOptions().map(option => option.show), ['normal', 'normal', 'normal', 'normal'])
  engine.chooseDialogueOption('disabled')
  engine.advanceDialogue()
  assert.deepEqual(engine.state.completedDialogues[0].chosenOptions, ['loop', 'disabled'])
  assert.deepEqual(engine.state.chatHistory.guide.map(entry => entry.kind), ['choice', 'choice', 'message'])
})

const inputDialogue = { id: 'input', characterId: 'guide', startNode: 'ask', nodes: {
  ask: { type: 'input', effects: [{ type: 'custom', method: 'entered' }], gates: [
    { keywords: [' ', ' Archive ', '档案'], target: 'first' },
    { keywords: ['archive'], target: 'second' },
    { keywords: ['broken'], target: 'missing' },
  ] },
  first: { type: 'message', speaker: 'guide', text: 'First' },
  second: { type: 'message', speaker: 'guide', text: 'Second' },
} }

test('input rejects empty, retries misses, matches first normalized gate and validates before recording', () => {
  const engine = dialogueEngine([inputDialogue])
  let entered = 0, notifications = 0
  engine.customMethods.set('entered', () => entered++)
  engine.subscribe(() => notifications++)
  engine.startDialogue('input')
  assert.equal(engine.submitDialogueInput('  ').accepted, false)
  assert.equal(notifications, 1)
  assert.equal(engine.submitDialogueInput(' unknown ').matched, false)
  assert.equal(engine.state.dialogue.currentNode, 'ask')
  assert.equal(entered, 1)
  const before = engine.state
  assert.throws(() => engine.submitDialogueInput('broken'), /Unknown dialogue node/)
  assert.deepEqual(engine.state, before)
  const result = engine.submitDialogueInput('  The ARCHIVE is here  ')
  assert.equal(result.accepted, true)
  assert.equal(result.matched, true)
  assert.equal(result.node.text, 'First')
  assert.deepEqual(engine.state.chatHistory.guide.map(entry => entry.userInput).filter(Boolean),
    ['unknown', 'The ARCHIVE is here'])
  assert.throws(() => engine.submitDialogueInput('again'), /No dialogue input/)
  const chinese = dialogueEngine([inputDialogue])
  chinese.customMethods.set('entered', () => {})
  chinese.startDialogue('input')
  assert.equal(chinese.submitDialogueInput('查阅档案').matched, true)
})

test('unmatched input follows default; ungated inputs advance or complete', () => {
  for (const ask of [
    { type: 'input', gates: [{ keywords: ['key'], target: 'second' }], next: 'first' },
    { type: 'input', next: 'first' },
    { type: 'input', gates: [] },
    { type: 'input' },
  ]) {
    const engine = dialogueEngine([{ ...inputDialogue, nodes: { ...inputDialogue.nodes, ask } }])
    engine.startDialogue('input')
    const result = engine.submitDialogueInput('a reply')
    assert.equal(result.accepted, true)
    assert.equal(result.matched, false)
    if (ask.next) assert.equal(result.node.text, 'First')
    else { assert.equal(result.node, null); assert.equal(engine.state.completedDialogues.length, 1) }
    assert.equal(engine.state.chatHistory.guide[0].userInput, 'a reply')
  }
})

test('saved history, active choices and completion arrays are detached and restore without entry effects', () => {
  const engine = dialogueEngine([branching])
  let effects = 0
  engine.customMethods.set('entered', () => effects++)
  engine.customMethods.set('chosen', () => effects++)
  engine.startDialogue('branch')
  engine.chooseDialogueOption('loop')
  const saved = engine.state
  const restored = dialogueEngine([branching], saved)
  assert.equal(effects, 3)
  assert.deepEqual(restored.state, saved)
  saved.dialogue.chosenOptions.push('outside')
  saved.chatHistory.guide[0].optionId = 'outside'
  saved.chatHistory.guide.push({})
  assert.deepEqual(restored.state.dialogue.chosenOptions, ['loop'])
  assert.equal(restored.state.chatHistory.guide[0].optionId, 'loop')
  assert.equal(engine.state.chatHistory.guide.length, 1)
  restored.applyEffects([setFlag('ready')])
  restored.chooseDialogueOption('disabled')
  restored.advanceDialogue()
  const completed = restored.state
  completed.completedDialogues[0].chosenOptions.push('outside')
  assert.deepEqual(restored.state.completedDialogues[0].chosenOptions, ['loop', 'disabled'])
  const old = dialogueEngine([terminal], { dialogue: { id: 'one', currentNode: 'same', done: false } })
  assert.deepEqual(old.state.chatHistory, {})
  assert.equal(old.getCurrentDialogueNode().text, 'One')
})

class TestChat extends EgChatElement {
  connected = false
  get isConnected() { return this.connected }
  createRenderRoot() { return {} }
  update(changed) { reactiveElementPrototype.update.call(this, changed) }
  connect() { this.connected = true; this.connectedCallback() }
  disconnect() { this.connected = false; this.disconnectedCallback() }
}
customElements.define('test-chat', TestChat)

test('chat defaults contacts, subscribes once, switches engines and cleans up on disconnect', async () => {
  const oldEngine = dialogueEngine([terminal])
  const nextEngine = new GameEngine({ characters: [{ id: 'other', name: 'Other' }] }, { unlockedCharacters: ['other'] })
  const counts = { old: 0, next: 0 }
  for (const [engine, key] of [[oldEngine, 'old'], [nextEngine, 'next']]) {
    const subscribe = engine.subscribe.bind(engine)
    engine.subscribe = listener => { counts[key]++; const unsubscribe = subscribe(listener); return () => { counts[key]--; unsubscribe() } }
  }
  const chat = new TestChat()
  chat.engine = oldEngine
  chat.connect()
  await chat.updateComplete
  assert.equal(chat.currentCharacter, 'guide')
  assert.equal(counts.old, 1)
  chat.engine = nextEngine
  await chat.updateComplete
  assert.equal(chat.currentCharacter, 'other')
  assert.deepEqual(counts, { old: 0, next: 1 })
  chat.disconnect()
  assert.equal(counts.next, 0)
  chat.connect()
  await chat.updateComplete
  assert.equal(counts.next, 1)
  nextEngine.applyEffects([{ type: 'unlockCharacter', id: 'guide' }])
  await chat.updateComplete
  chat.disconnect()
  assert.equal(counts.next, 0)
  const empty = new TestChat()
  empty.engine = new GameEngine()
  empty.connect()
  await empty.updateComplete
  assert.equal(empty.currentCharacter, '')
  empty.disconnect()
})

// Inspect Lit's public template results without replacing its renderer or DOM.
function templates(value) {
  if (Array.isArray(value)) return value.flatMap(templates)
  if (!value || typeof value !== 'object') return []
  const nested = Array.isArray(value.values) ? value.values.flatMap(templates) : []
  return value.strings ? [value, ...nested] : nested
}
function bindings(template) {
  const result = {}
  template.values.forEach((value, index) => {
    const match = template.strings[index].match(/([.@?][\w-]+)=$/)
    if (match) result[match[1]] = value
  })
  return result
}

test('chat renders engine-local history once, with controls only for the selected active conversation', async () => {
  globalThis.document = { documentElement: { lang: 'en' } }
  const content = {
    characters: [guide, { id: 'other', name: 'Other' }],
    dialogues: [terminal, { ...terminal, id: 'other-talk', characterId: 'other' }],
  }
  const engine = new GameEngine(content, { unlockedCharacters: ['guide', 'other'] })
  engine.startDialogue('one')
  const chat = new TestChat()
  chat.engine = engine
  chat.connect()
  await chat.updateComplete
  let rendered = templates(chat.render())
  let nodes = rendered.filter(template => template.strings.join('').includes('<eg-dialognode'))
  assert.equal(nodes.length, 2)
  assert.equal(bindings(nodes[0])['.node'].text, 'One')
  assert.equal(bindings(nodes[0])['.character'].name, 'Guide')
  assert.equal(bindings(nodes[0])['@continue'], undefined)
  assert.equal(bindings(nodes[1])['.messageRecorded'], true)
  assert.equal(bindings(nodes[1])['.active'], true)
  chat.currentCharacter = 'other'
  await chat.updateComplete
  rendered = templates(chat.render())
  assert.equal(rendered.filter(template => template.strings.join('').includes('<eg-dialognode')).length, 0)
  const startButtons = rendered.filter(template => template.strings.join('').includes('?disabled='))
  assert.equal(startButtons.length, 1)
  assert.equal(bindings(startButtons[0])['?disabled'], true)
  engine.advanceDialogue()
  engine.startDialogue('other-talk')
  await chat.updateComplete
  nodes = templates(chat.render()).filter(template => template.strings.join('').includes('<eg-dialognode'))
  assert.equal(nodes.length, 2)
  assert.equal(bindings(nodes[1])['.active'], true)
  engine.advanceDialogue()
  await chat.updateComplete
  nodes = templates(chat.render()).filter(template => template.strings.join('').includes('<eg-dialognode'))
  assert.equal(nodes.length, 1)
  assert.equal(bindings(nodes[0])['.active'], undefined)
  chat.disconnect()
})

test('dialogue node hides historical controls, renders conditional options, and avoids IME submission', () => {
  const NodeElement = customElements.get('eg-dialognode')
  const element = new NodeElement()
  element.node = terminal.nodes.same
  element.character = guide
  assert.equal(templates(element.render()).some(template => template.strings.join('').includes('part="continue"')), false)
  element.active = true
  element.messageRecorded = true
  let rendered = templates(element.render())
  assert.equal(rendered.some(template => template.strings.join('').includes('part="message"')), false)
  assert.equal(rendered.some(template => template.strings.join('').includes('part="continue"')), true)
  element.node = branching.nodes.choose
  element.options = [
    { id: 'normal', text: 'Normal', show: 'normal' },
    { id: 'disabled', text: 'Disabled', show: 'disable' },
    { id: 'hidden', text: 'Hidden', show: 'remove' },
  ]
  const buttons = templates(element.render()).filter(template => template.strings.join('').includes('part="option"'))
  assert.equal(buttons.length, 2)
  assert.equal(bindings(buttons[0])['?disabled'], false)
  assert.equal(bindings(buttons[1])['?disabled'], true)
  element.node = { type: 'input' }
  const form = templates(element.render()).find(template => bindings(template)['@keydown'])
  const keydown = bindings(form)['@keydown']
  let submissions = 0
  element.renderRoot = { querySelector: () => ({ value: 'archive' }) }
  element.addEventListener('dialogue-input', event => {
    submissions++
    assert.deepEqual(event.detail, { content: 'archive' })
  })
  keydown({ key: 'Enter', isComposing: true, preventDefault() { assert.fail('IME confirmation must not be cancelled') } })
  keydown({ key: 'Enter', isComposing: false, keyCode: 229, preventDefault() { assert.fail('IME confirmation must not be cancelled') } })
  assert.equal(submissions, 0)
  keydown({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {} })
  assert.equal(submissions, 1)
  element.dispatchInput()
  assert.equal(submissions, 2)
  element.active = false
  assert.equal(templates(element.render()).length, 0)
})


function routedDialogue(nodes, startNode = 'route') {
  return { id: 'routed', characterId: 'guide', startNode, nodes }
}
const message = text => ({ speaker: 'guide', text })

test('routers select relative weights at boundaries, default to one, and exclude zero', t => {
  const random = t.mock.method(Math, 'random', () => 0)
  const content = routedDialogue({
    route: { type: 'router', targets: ['a', { id: 'b' }, { id: 'c', weight: 2 }, { id: 'zero', weight: 0 }] },
    a: message('A'), b: message('B'), c: message('C'), zero: message('Never'),
  })
  for (const [draw, expected] of [[0, 'A'], [.249999, 'A'], [.25, 'B'], [.499999, 'B'], [.5, 'C'], [.999999, 'C']]) {
    random.mock.mockImplementation(() => draw)
    const engine = dialogueEngine([content])
    assert.equal(engine.startDialogue('routed').text, expected)
    assert.equal(engine.state.chatHistory.guide.length, 1)
    assert.notEqual(engine.state.chatHistory.guide[0].id, 'route')
  }
  random.mock.mockImplementation(() => .75)
  const large = dialogueEngine([routedDialogue({
    route: { type: 'router', targets: [{ id: 'a', weight: 1e308 }, { id: 'b', weight: 1e308 }] },
    a: message('A'), b: message('B'),
  })])
  assert.equal(large.startDialogue('routed').text, 'B')
})

test('all dialogue entry paths automatically route and apply effects in entry order once', t => {
  t.mock.method(Math, 'random', () => 0)
  const entered = id => [{ type: 'custom', method: 'entered', args: [id] }]
  for (const [entry, respond] of [
    [{ type: 'message', speaker: 'guide', text: 'Start', next: 'route' }, engine => engine.advanceDialogue()],
    [{ type: 'choice', options: [{ id: 'go', text: 'Go', next: 'route', effects: entered('option') }] }, engine => engine.chooseDialogueOption('go')],
    [{ type: 'input', gates: [{ keywords: ['key'], target: 'route' }] }, engine => engine.submitDialogueInput('key').node],
    [{ type: 'input', next: 'route' }, engine => engine.submitDialogueInput('anything').node],
  ]) {
    const engine = dialogueEngine([routedDialogue({
      entry, route: { type: 'router', targets: ['second'], effects: entered('route') },
      second: { type: 'router', targets: ['end'], effects: entered('second') },
      end: { ...message('End'), effects: entered('end') },
    }, 'entry')])
    const trace = [], snapshots = []
    engine.customMethods.set('entered', (engine, id) => trace.push([id, engine.state.dialogue.currentNode]))
    engine.subscribe(state => snapshots.push(state))
    engine.startDialogue('routed')
    assert.equal(respond(engine).text, 'End')
    assert.deepEqual(trace.map(value => value[0]), entry.type === 'choice' ? ['option', 'route', 'second', 'end'] : ['route', 'second', 'end'])
    assert.deepEqual(trace.slice(-3), [['route', 'route'], ['second', 'second'], ['end', 'end']])
    assert.equal(snapshots.length, 2)
    assert.equal(snapshots[1].dialogue.currentNode, 'end')
    assert.equal(engine.state.chatHistory.guide.some(entry => ['route', 'second'].includes(entry.id)), false)
  }
  for (const destination of [{ type: 'choice', options: [] }, { type: 'input' }]) {
    const engine = dialogueEngine([routedDialogue({ route: { type: 'router', targets: ['end'] }, end: destination })])
    assert.equal(engine.startDialogue('routed').type, destination.type)
    assert.equal(engine.state.chatHistory.guide, undefined)
  }
})

test('invalid routers fail before responses, state changes, notifications or effects', t => {
  t.mock.method(Math, 'random', () => 0)
  const invalid = [[], [{ id: 'end', weight: 0 }], [{ id: 'end', weight: -1 }],
    [{ id: 'end', weight: NaN }], [{ id: 'end', weight: Infinity }], [{ id: 'end', weight: null }],
    ['missing'], ['toString'], [{ id: 'missing', weight: 0 }]]
  for (const targets of invalid) {
    for (const kind of ['start', 'message', 'choice', 'input']) {
      const entry = kind === 'message' ? { ...message('Start'), type: 'message', next: 'route' }
        : kind === 'choice' ? { type: 'choice', options: [{ id: 'go', text: 'Go', next: 'route', effects: [setFlag('badOption')] }] }
        : { type: 'input', next: 'route' }
      const engine = dialogueEngine([routedDialogue({ entry,
        route: { type: 'router', targets: ['bad'], effects: [setFlag('badRoute')] },
        bad: { type: 'router', targets, next: 'end', effects: [setFlag('badTarget')] }, end: message('End'),
      }, kind === 'start' ? 'route' : 'entry')])
      if (kind !== 'start') engine.startDialogue('routed')
      const before = engine.state
      let notifications = 0
      engine.subscribe(() => notifications++)
      const attempt = () => kind === 'start' ? engine.startDialogue('routed') : kind === 'message' ? engine.advanceDialogue()
        : kind === 'choice' ? engine.chooseDialogueOption('go') : engine.submitDialogueInput('reply')
      assert.throws(attempt, new RegExp('Invalid router routed/bad:'))
      assert.deepEqual(engine.state, before)
      assert.equal(notifications, 0)
    }
  }
})

test('router chains allow 100 jumps and reject the 101st, including cycles, without mutation', t => {
  t.mock.method(Math, 'random', () => 0)
  for (const count of [100, 101]) {
    const nodes = { end: message('End') }
    for (let i = 0; i < count; i++) nodes['r' + i] = { type: 'router', targets: [i === count - 1 ? 'end' : 'r' + (i + 1)], effects: [setFlag('entered')] }
    const engine = dialogueEngine([routedDialogue(nodes, 'r0')])
    if (count === 100) assert.equal(engine.startDialogue('routed').text, 'End')
    else {
      const before = engine.state
      assert.throws(() => engine.startDialogue('routed'), new RegExp('routed/r100: Exceeded 100'))
      assert.deepEqual(engine.state, before)
    }
  }
  const engine = dialogueEngine([routedDialogue({ route: { type: 'router', targets: ['route'], effects: [setFlag('entered')] } })])
  const before = engine.state
  assert.throws(() => engine.startDialogue('routed'), /Exceeded 100/)
  assert.deepEqual(engine.state, before)
})

test('omitted types normalize on a copy and match message history, effects, completion and restore', () => {
  const raw = routedDialogue({ route: { ...message('Default message'), next: 'end', effects: [setFlag('entered')] }, end: message('End') })
  const engine = dialogueEngine([raw])
  assert.equal(engine.getDialogue('routed').nodes.route.type, 'message')
  assert.equal(raw.nodes.route.type, undefined)
  assert.equal(engine.startDialogue('routed').type, 'message')
  assert.equal(engine.state.flags.entered, true)
  engine.applyEffects([setFlag('entered', false)])
  const restored = dialogueEngine([raw], engine.state)
  assert.equal(restored.state.flags.entered, false)
  assert.equal(restored.getCurrentDialogueNode().type, 'message')
  assert.deepEqual(restored.state.chatHistory.guide.map(entry => entry.id), ['route'])
  assert.equal(restored.advanceDialogue().text, 'End')
  assert.equal(restored.advanceDialogue(), null)
  assert.equal(restored.state.completedDialogues[0].done, true)
  const legacy = dialogueEngine([raw], { dialogue: { id: 'routed', currentNode: 'route', done: false } })
  assert.equal(legacy.getCurrentDialogueNode().type, 'message')
  assert.equal(legacy.state.flags.entered, undefined)
})

test('router saves restore the final node without rerolling; legacy routers skip saved entry effects', t => {
  const random = t.mock.method(Math, 'random', () => 0)
  const add = id => [{ type: 'setVariable', id, value: 1, operation: 'add' }]
  const content = routedDialogue({
    route: { type: 'router', targets: ['second'], effects: add('first') },
    second: { type: 'router', targets: ['end'], effects: add('second') },
    end: { ...message('End'), effects: add('end') },
  })
  const engine = dialogueEngine([content])
  engine.startDialogue('routed')
  const saved = engine.state, calls = random.mock.callCount()
  const restored = dialogueEngine([content], saved)
  restored.getCurrentDialogueNode()
  assert.deepEqual(restored.state, saved)
  assert.equal(random.mock.callCount(), calls)
  const legacy = dialogueEngine([content], {
    dialogue: { id: 'routed', currentNode: 'route', done: false, chosenOptions: ['previous'] }, variables: { first: 1 },
  })
  assert.deepEqual(legacy.state.variables, { first: 1, second: 1, end: 1 })
  assert.equal(legacy.state.dialogue.currentNode, 'end')
  assert.deepEqual(legacy.state.dialogue.chosenOptions, ['previous'])
  assert.deepEqual(legacy.state.chatHistory.guide.map(entry => entry.id), ['end'])
})

test('player flags follow the speaker in history and legacy active messages', async () => {
  globalThis.document = { documentElement: { lang: 'en' } }
  const content = routedDialogue({ route: { speaker: 'player', text: 'Player', next: 'end' }, end: message('Guide') })
  const makeEngine = initial => new GameEngine({ characters: [guide, { id: 'player', name: 'Player', tags: ['player'] }], dialogues: [content] }, { unlockedCharacters: ['guide'], ...initial })
  const engine = makeEngine()
  engine.startDialogue('routed')
  const chat = new TestChat()
  chat.engine = engine
  chat.connect()
  await chat.updateComplete
  let nodes = templates(chat.render()).filter(template => template.strings.join('').includes('<eg-dialognode'))
  assert.equal(nodes.length, 2)
  assert.equal(bindings(nodes[0])['.isPlayer'], true)
  assert.equal(bindings(nodes[1])['.isPlayer'], true)
  engine.advanceDialogue()
  await chat.updateComplete
  nodes = templates(chat.render()).filter(template => template.strings.join('').includes('<eg-dialognode'))
  assert.equal(bindings(nodes[1])['.isPlayer'], false)
  assert.equal(bindings(nodes[2])['.isPlayer'], false)
  chat.engine = makeEngine({ dialogue: { id: 'routed', currentNode: 'route', done: false } })
  await chat.updateComplete
  nodes = templates(chat.render()).filter(template => template.strings.join('').includes('<eg-dialognode'))
  assert.equal(nodes.length, 1)
  assert.equal(bindings(nodes[0])['.isPlayer'], true)
  assert.equal(bindings(nodes[0])['.messageRecorded'], false)
  chat.disconnect()
  const element = new (customElements.get('eg-dialognode'))()
  assert.equal(element.isPlayer, false)
  element.node = message('Standalone default')
  assert.equal(templates(element.render()).some(template => template.strings.join('').includes('part="message"')), true)
  element.node = { type: 'unknown', speaker: 'guide', text: 'Unknown' }
  assert.equal(templates(element.render()).some(template => template.strings.join('').includes('part="message"')), false)
})


const responsePlayer = { id: 'actor', name: 'Actor', tags: ['player'], avatars: { default: 'actor.png' } }
function responseEngine(choiceAs, inputAs, characters = [guide, responsePlayer], initial = {}) {
  return new GameEngine({ characters, dialogues: [{ id: 'responses', characterId: 'guide', startNode: 'choose', nodes: {
    choose: { type: 'choice', options: [{ id: 'reply', text: 'translate:ui.send', as: choiceAs, next: 'ask', effects: [setFlag('chosen')] }] },
    ask: { type: 'input', as: inputAs, effects: [setFlag('asked')], gates: [{ keywords: ['finish'], target: 'end' }] },
    end: { speaker: 'guide', text: 'End' },
  } }] }, { unlockedCharacters: ['guide'], ...initial })
}
function renderedHistoryNodes(chat) {
  return templates(chat.render()).filter(template => template.strings.join('').includes('<eg-dialognode'))
    .map(bindings).filter(properties => properties['.active'] !== true)
}

test('response speakers use explicit as or the first exact player tag, including locked contacts', async () => {
  globalThis.document = { documentElement: { lang: 'en' } }
  const secondPlayer = { id: 'second', name: 'Second', tags: ['player'] }
  const wrongTag = { id: 'wrong', name: 'Wrong tag', tags: ['Player'] }
  for (const [choiceAs, inputAs, expectedChoice, expectedInput] of [
    [undefined, undefined, 'actor', 'actor'], ['guide', 'second', 'guide', 'second'],
    ['missing', 'other-missing', 'missing', 'other-missing'],
  ]) {
    const engine = responseEngine(choiceAs, inputAs, [guide, wrongTag, responsePlayer, secondPlayer])
    assert.equal(engine.getPlayerCharacter().id, 'actor')
    assert.deepEqual(engine.getAvailableCharacters().map(character => character.id), ['guide'])
    engine.startDialogue('responses')
    engine.chooseDialogueOption('reply')
    engine.submitDialogueInput('reply')
    const chat = new TestChat()
    chat.engine = engine
    chat.connect()
    await chat.updateComplete
    const before = engine.state
    const nodes = renderedHistoryNodes(chat)
    assert.equal(nodes.length, 2)
    assert.deepEqual(nodes.map(properties => properties['.node'].speaker), [expectedChoice, expectedInput])
    assert.deepEqual(nodes.map(properties => properties['.literalText']), [false, true])
    assert.deepEqual(nodes.map(properties => properties['.isPlayer']), [expectedChoice === 'actor' || expectedChoice === 'second', expectedInput === 'actor' || expectedInput === 'second'])
    assert.equal(nodes[0]['.character']?.id, engine.getCharacter(expectedChoice)?.id)
    assert.equal(nodes[0]['.node'].type, 'message')
    assert.equal(nodes[0]['.node'].text, 'translate:ui.send')
    assert.equal(nodes[1]['.node'].text, 'reply')
    assert.equal(nodes[0]['@continue'], undefined)
    assert.deepEqual(engine.state, before)
    chat.disconnect()
  }
})

test('response rendering preserves literal input, localization, retry ordering and saved history without replay', async t => {
  const previousLocation = globalThis.location
  globalThis.location = { origin: 'http://localhost' }
  t.after(() => {
    if (previousLocation === undefined) delete globalThis.location
    else globalThis.location = previousLocation
  })
  globalThis.document = { documentElement: { lang: 'en' } }
  const engine = responseEngine('guide', undefined)
  engine.startDialogue('responses')
  engine.chooseDialogueOption('reply')
  const rawInputs = ['translate:ui.send', '<img src=x onerror="alert(1)">']
  for (const text of rawInputs) assert.equal(engine.submitDialogueInput(text).matched, false)
  engine.applyEffects([setFlag('chosen', false), setFlag('asked', false)])
  const restored = responseEngine('guide', undefined, [guide, responsePlayer], engine.state)
  for (const current of [engine, restored]) {
    const chat = new TestChat()
    chat.engine = current
    chat.connect()
    await chat.updateComplete
    const nodes = renderedHistoryNodes(chat)
    assert.equal(nodes.length, 3)
    assert.deepEqual(nodes.map(properties => properties['.node'].text), ['translate:ui.send', ...rawInputs])
    assert.deepEqual(current.state.chatHistory.guide.map(entry => entry.kind), ['choice', 'input', 'input'])
    for (const properties of nodes) {
      const element = new (customElements.get('eg-dialognode'))()
      element.node = properties['.node']
      element.character = properties['.character']
      element.literalText = properties['.literalText']
      const rendered = templates(element.render())
      assert.equal(rendered.some(template => template.strings.join('').includes('part="continue"')), false)
      const content = rendered.find(template => template.strings.join('').includes('part="content"'))
      assert.equal(content.values.includes(properties['.node'].text), properties['.literalText'])
    }
    assert.equal(current.state.flags.chosen, false)
    assert.equal(current.state.flags.asked, false)
    chat.disconnect()
  }
})

test('responses without a player retain the fallback bubble, while explicit as still works', async () => {
  globalThis.document = { documentElement: { lang: 'en' } }
  for (const as of [undefined, 'guide']) {
    const engine = responseEngine(as, as, [guide])
    assert.equal(engine.getPlayerCharacter(), undefined)
    engine.startDialogue('responses')
    engine.chooseDialogueOption('reply')
    engine.submitDialogueInput('translate:ui.send')
    const chat = new TestChat()
    chat.engine = engine
    chat.connect()
    await chat.updateComplete
    const rendered = templates(chat.render())
    const fallback = rendered.filter(template => template.strings.join('').includes('part="response"'))
    assert.equal(fallback.length, as === undefined ? 2 : 0)
    assert.equal(renderedHistoryNodes(chat).length, as === undefined ? 0 : 2)
    if (as === undefined) assert.equal(fallback[1].values.includes('translate:ui.send'), true)
    chat.disconnect()
  }
})


const automatic = (id, extra = {}) => ({
  id, name: id, characterId: 'guide', startNode: 'hello',
  nodes: { hello: { speaker: 'guide', text: id } }, ...extra,
})
const autoEngine = (dialogues, initial = {}, events = []) => new GameEngine({
  characters: [guide], dialogues, events,
}, { unlockedCharacters: ['guide'], ...initial })

test('dialogue conditions filter availability, reject direct starts and do not interrupt active runs', () => {
  const engine = autoEngine([automatic('gated', { condition: flag('ready') })])
  assert.deepEqual(engine.getAvailableDialogues('guide'), [])
  const before = engine.state
  assert.throws(() => engine.startDialogue('gated'), /start condition/)
  assert.deepEqual(engine.state, before)
  engine.applyEffects([setFlag('ready')])
  assert.equal(engine.getAvailableDialogues('guide').length, 1)
  engine.startDialogue('gated')
  engine.applyEffects([setFlag('ready', false)])
  assert.equal(engine.state.dialogue.id, 'gated')
  engine.advanceDialogue()
  assert.equal(engine.state.dialogue, null)
})

test('auto starts wait for settled event chains, respect locks, order and active conversations', () => {
  const engine = autoEngine([
    automatic('locked', { characterId: 'missing', autoStart: true }),
    automatic('first', { autoStart: true, condition: flag('ready') }),
    automatic('second', { autoStart: true }),
  ], {}, [event('prepare', { type: 'stateChange' }, [setFlag('ready')])])
  assert.equal(engine.state.dialogue.id, 'first')
  engine.applyEffects([setFlag('unrelated')])
  assert.equal(engine.state.dialogue.id, 'first')
  engine.advanceDialogue()
  assert.equal(engine.state.dialogue.id, 'second')
  engine.advanceDialogue()
  assert.equal(engine.state.dialogue, null)
  const locked = autoEngine([automatic('unlock', { autoStart: true })], { unlockedCharacters: [] })
  assert.equal(locked.state.dialogue, null)
  locked.applyEffects([{ type: 'unlockCharacter', id: 'guide' }])
  assert.equal(locked.state.dialogue.id, 'unlock')
})

test('repeatable auto starts consume each true period, survive save/abort and allow manual replay', () => {
  const content = automatic('repeat', { autoStart: true, repeatable: true, condition: flag('ready') })
  const engine = autoEngine([content], { flags: { ready: true } })
  engine.endDialogue()
  engine.applyEffects([setFlag('unrelated')])
  assert.equal(engine.state.dialogue, null)
  assert.deepEqual(engine.state.autoStartConsumed, ['repeat'])
  const saved = engine.state
  saved.autoStartConsumed.push('detached')
  assert.deepEqual(engine.state.autoStartConsumed, ['repeat'])
  const restored = autoEngine([content], engine.state)
  assert.equal(restored.state.dialogue, null)
  restored.startDialogue('repeat')
  restored.advanceDialogue()
  assert.equal(restored.state.dialogue, null)
  restored.applyEffects([setFlag('ready', false)])
  assert.deepEqual(restored.state.autoStartConsumed, [])
  restored.applyEffects([setFlag('ready')])
  assert.equal(restored.state.dialogue.id, 'repeat')
  const legacy = { ...restored.state }
  delete legacy.autoStartConsumed
  const oldSave = autoEngine([content], legacy)
  oldSave.endDialogue()
  assert.equal(oldSave.state.dialogue, null)
})

test('unconditional repeatable auto dialogue runs once automatically', () => {
  const engine = autoEngine([automatic('once-per-period', { autoStart: true, repeatable: true })])
  engine.advanceDialogue()
  engine.dispatchAction({ name: 'tick' })
  assert.equal(engine.state.dialogue, null)
  engine.startDialogue('once-per-period')
  engine.advanceDialogue()
  assert.equal(engine.state.completedDialogues.length, 2)
})

test('action starts rearm after dispatch and do not queue expired actions while busy', () => {
  const engine = autoEngine([
    automatic('manual'),
    automatic('action', { autoStart: true, repeatable: true, condition: { type: 'action', name: 'inspect' } }),
  ])
  engine.startDialogue('manual')
  engine.dispatchAction({ name: 'inspect' })
  engine.endDialogue()
  assert.equal(engine.state.dialogue, null)
  for (let i = 0; i < 2; i++) {
    engine.dispatchAction({ name: 'inspect' })
    assert.equal(engine.state.dialogue.id, 'action')
    assert.equal(engine.state.autoStartConsumed.includes('action'), false)
    engine.advanceDialogue()
    assert.equal(engine.state.dialogue, null)
  }
})

test('variable add publishes once and unlocks a conditioned auto dialogue', () => {
  const engine = autoEngine([automatic('counted', { autoStart: true,
    condition: { type: 'variable', id: 'count', op: '>=', value: 2 } })])
  let notifications = 0
  engine.subscribe(() => notifications++)
  engine.applyEffects([{ type: 'setVariable', id: 'count', value: 2, operation: 'add' }])
  assert.equal(notifications, 1)
  assert.equal(engine.state.dialogue.id, 'counted')
})

// A deterministic clock avoids real waits and works with the project's Node 20 minimum.
function dialogueClock(t) {
  let now = 0, sequence = 0
  const timers = new Map()
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++sequence
    timers.set(id, { callback, at: now + delay })
    return id
  })
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id))
  return {
    get size() { return timers.size },
    tick(milliseconds) {
      const end = now + milliseconds
      let iterations = 0
      while (true) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry || entry[1].at > end) break
        assert.ok(++iterations < 1000, 'Timer loop')
        now = entry[1].at
        timers.delete(entry[0])
        entry[1].callback()
      }
      now = end
    },
  }
}
async function timedChat(t, extra = {}) {
  const chat = new TestChat()
  chat.engine = autoEngine([automatic('timed', { autoAdvance: 1, ...extra })])
  chat.engine.startDialogue('timed')
  chat.connect()
  await chat.updateComplete
  t.after(() => chat.disconnect())
  return chat
}

test('auto advance preserves deadlines across unrelated updates and advances background/self-loop messages', async t => {
  const clock = dialogueClock(t)
  const chat = await timedChat(t, { nodes: {
    hello: { speaker: 'guide', text: 'Loop', next: 'hello' },
  } })
  clock.tick(600)
  chat.engine.applyEffects([setFlag('tick')])
  chat.currentCharacter = 'other'
  await chat.updateComplete
  clock.tick(399)
  assert.equal(chat.engine.state.chatHistory.guide.length, 1)
  clock.tick(1)
  assert.equal(chat.engine.state.chatHistory.guide.length, 2)
  clock.tick(1000)
  assert.equal(chat.engine.state.chatHistory.guide.length, 3)
  assert.equal(clock.size, 1)
})

test('manual continue resets auto interval; choices and input wait, terminal messages complete', async t => {
  const clock = dialogueClock(t)
  const chat = await timedChat(t, { nodes: {
    hello: { speaker: 'guide', text: 'Start', next: 'next' },
    next: { speaker: 'guide', text: 'Next', next: 'choose' },
    choose: { type: 'choice', options: [{ id: 'go', text: 'Go', next: 'ask' }] },
    ask: { type: 'input', next: 'route' },
    route: { type: 'router', targets: ['end'] },
    end: { speaker: 'guide', text: 'Done' },
  } })
  clock.tick(800)
  chat.engine.advanceDialogue()
  clock.tick(200)
  assert.equal(chat.engine.state.dialogue.currentNode, 'next')
  clock.tick(800)
  assert.equal(chat.engine.state.dialogue.currentNode, 'choose')
  assert.equal(clock.size, 0)
  clock.tick(5000)
  chat.engine.chooseDialogueOption('go')
  assert.equal(clock.size, 0)
  chat.engine.submitDialogueInput('reply')
  assert.equal(chat.engine.state.dialogue.currentNode, 'end')
  clock.tick(1000)
  assert.equal(chat.engine.state.dialogue, null)
  assert.equal(clock.size, 0)
})

test('auto timers clean up on engine replacement/disconnect and reconnect waits a full interval', async t => {
  const clock = dialogueClock(t)
  const chat = await timedChat(t)
  const old = chat.engine
  clock.tick(600)
  chat.disconnect()
  assert.equal(clock.size, 0)
  clock.tick(5000)
  assert.equal(old.state.dialogue.id, 'timed')
  chat.connect()
  await chat.updateComplete
  clock.tick(999)
  assert.equal(old.state.dialogue.id, 'timed')
  const next = autoEngine([automatic('replacement', { autoAdvance: 1 })])
  next.startDialogue('replacement')
  chat.engine = next
  await chat.updateComplete
  clock.tick(1)
  assert.equal(next.state.dialogue.id, 'replacement')
  clock.tick(999)
  assert.equal(next.state.dialogue, null)
  assert.equal(old.state.dialogue.id, 'timed')
})

test('invalid auto intervals do not schedule, and a failing node reports once without automatic retries', async t => {
  const clock = dialogueClock(t)
  for (const interval of [undefined, 0, -1, NaN, Infinity]) {
    const chat = await timedChat(t, { autoAdvance: interval })
    assert.equal(clock.size, 0)
    chat.disconnect()
  }
  const chat = await timedChat(t, { nodes: { hello: { speaker: 'guide', text: 'Bad', next: 'missing' } } })
  clock.tick(1000)
  assert.match(chat.feedback, /Unknown dialogue node/)
  assert.equal(clock.size, 0)
  chat.engine.applyEffects([setFlag('unrelated')])
  await chat.updateComplete
  clock.tick(5000)
  assert.equal(clock.size, 0)
  assert.match(chat.feedback, /Unknown dialogue node/)
})


test('custom auto-start entry effects remain in the outer update and variable add zero is a no-op', () => {
  const engine = autoEngine([automatic('custom-entry', {
    autoStart:true, condition:flag('ready'),
    nodes:{hello:{speaker:'guide',text:'Hello',effects:[{type:'custom',method:'nested'}]}},
  })])
  engine.customMethods.set('nested', value => value.applyEffects([
    {type:'setVariable',id:'entries',value:1,operation:'add'},
  ]))
  let notifications = 0
  engine.subscribe(() => notifications++)
  engine.applyEffects([setFlag('ready')])
  assert.equal(engine.state.dialogue.id, 'custom-entry')
  assert.equal(engine.state.variables.entries, 1)
  assert.equal(notifications, 1)
  engine.applyEffects([{type:'setVariable',id:'entries',value:0,operation:'add'}])
  assert.equal(notifications, 1)
})


test('localized input gates prefer matched targets over next and otherwise use the default jump', t => {
  const previousDocument = globalThis.document
  t.after(() => { globalThis.document = previousDocument })
  for (const [lang, text, matched, expected] of [
    ['en-US', '  The ARCHIVE is here  ', true, 'First'],
    ['zh-CN', '  查阅档案  ', true, 'First'],
    ['zh-CN', 'archive', false, 'Second'],
    ['en-US', 'no matching keyword', false, 'Second'],
  ]) {
    globalThis.document = { documentElement: { lang } }
    const ask = { type:'input', next:'second', gates:[
      { keywords:['  translate:keyword.archive  '], target:'first' },
    ] }
    const engine = dialogueEngine([{ ...inputDialogue, nodes:{ ...inputDialogue.nodes, ask } }])
    engine.startDialogue('input')
    const result = engine.submitDialogueInput(text)
    assert.equal(result.accepted, true)
    assert.equal(result.matched, matched)
    assert.equal(result.node.text, expected)
    assert.equal(engine.state.chatHistory.guide[0].userInput, text.trim())
  }
})

test('input keywords resolve localization at submission time and unmatched gated inputs without next allow retry', t => {
  const previousDocument = globalThis.document
  t.after(() => { globalThis.document = previousDocument })
  globalThis.document = { documentElement: { lang:'en-US' } }
  const ask = { type:'input', gates:[{ keywords:['translate:keyword.archive'], target:'first' }] }
  const engine = dialogueEngine([{ ...inputDialogue, nodes:{ ...inputDialogue.nodes, ask } }])
  engine.startDialogue('input')
  assert.equal(engine.submitDialogueInput('档案').matched, false)
  assert.equal(engine.state.dialogue.currentNode, 'ask')
  globalThis.document.documentElement.lang = 'zh-CN'
  assert.equal(engine.submitDialogueInput('档案').matched, true)
  assert.equal(engine.getCurrentDialogueNode().text, 'First')
  assert.deepEqual(engine.state.chatHistory.guide.filter(entry => entry.kind === 'input').map(entry => entry.userInput), ['档案', '档案'])
})

test('missing keyword translations match the stripped key and empty localized keywords never match', t => {
  const previousDocument = globalThis.document
  t.after(() => { globalThis.document = previousDocument })
  for (const lang of ['en-US', 'zh-CN']) {
    globalThis.document = { documentElement: { lang } }
    const ask = { type:'input', next:'second', gates:[
      { keywords:['translate:', '  '], target:'missing' },
      { keywords:[' translate:missing.keyword ', 'translate:toString'], target:'first' },
    ] }
    for (const [text, matched, expected] of [
      ['This is MISSING.KEYWORD', true, 'First'],
      ['TOSTRING', true, 'First'],
      ['ordinary reply', false, 'Second'],
    ]) {
      const engine = dialogueEngine([{ ...inputDialogue, nodes:{ ...inputDialogue.nodes, ask } }])
      engine.startDialogue('input')
      const result = engine.submitDialogueInput(text)
      assert.equal(result.matched, matched)
      assert.equal(result.node.text, expected)
    }
  }
})

test('localized gate and default targets are validated before recording a reply or executing effects', t => {
  const previousDocument = globalThis.document
  t.after(() => { globalThis.document = previousDocument })
  globalThis.document = { documentElement: { lang:'en-US' } }
  for (const [target, next, text] of [
    ['missing', 'first', 'ARCHIVE'],
    ['first', 'missing', 'unmatched'],
  ]) {
    const ask = { type:'input', next, gates:[{ keywords:['translate:keyword.archive'], target }] }
    const engine = dialogueEngine([{ ...inputDialogue, nodes:{ ...inputDialogue.nodes, ask } }])
    engine.startDialogue('input')
    const before = engine.state
    assert.throws(() => engine.submitDialogueInput(text), /Unknown dialogue node/)
    assert.deepEqual(engine.state, before)
  }
})
