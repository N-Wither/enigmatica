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
