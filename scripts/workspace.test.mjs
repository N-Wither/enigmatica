import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const { customElements } = await import('@lit-labs/ssr-dom-shim')
globalThis.customElements = customElements
const bundle = await build({
  stdin: {
    contents: `export { GameEngine } from './src/core/engine';
      export { EnigmaticaGameElement } from './src/components/enigmatica-game';
      export { EgInventoryElement } from './src/components/game/inventory';
      export { EgWorktableElement } from './src/components/game/worktable';
      export { GameItemElement, ItemEvent } from './src/components/game-item';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
})
const { GameEngine, EnigmaticaGameElement, EgInventoryElement, EgWorktableElement, GameItemElement, ItemEvent } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'))

// Unit tests exercise state and event wiring. Real DOM/layout tests live separately.
globalThis.document = { createElement: () => {
  const element = new GameItemElement()
  element.remove = () => {}
  return element
} }
const reactivePrototype = Object.getPrototypeOf(Object.getPrototypeOf(EgWorktableElement.prototype))
function withoutDOM(Base) {
  return class extends Base {
    connected = false
    get isConnected() { return this.connected }
    createRenderRoot() { return { querySelector: () => null, querySelectorAll: () => [] } }
    update(changed) { reactivePrototype.update.call(this, changed) }
    updated() {}
    connect() { this.connected = true; this.connectedCallback() }
    disconnect() { this.connected = false; this.disconnectedCallback() }
  }
}
class Worktable extends withoutDOM(EgWorktableElement) {}
class Inventory extends withoutDOM(EgInventoryElement) {}
class Game extends withoutDOM(EnigmaticaGameElement) {
  updated() { EnigmaticaGameElement.prototype.updated.call(this) }
}
customElements.define('test-worktable', Worktable)
customElements.define('test-inventory', Inventory)
customElements.define('test-game-shell', Game)

const makeEngine = () => new GameEngine({}, { inventory: [
  { id: 'notepad', count: 1, state: { page: 'first' } },
  { id: 'notepad', count: 1, state: { page: 'second' } },
  { id: 'plain', count: 3 },
] })

test('worktable starts hidden, toggles by instance, and preserves its content references', async () => {
  const table = new Worktable()
  table.engine = makeEngine()
  table.connect()
  await table.updateComplete
  const [first, second, plain] = table.engine.inventory.toArray()
  const element = first.element
  assert.deepEqual(table.openItems, [])
  table.toggleItem(plain)
  table.toggleItem({ element }) // An element alone is not a member of this inventory.
  assert.deepEqual(table.openItems, [])
  const notifications = []
  table.addEventListener('worktable-change', event => {
    assert.equal(event.bubbles, true)
    assert.equal(event.composed, true)
    notifications.push(event.detail.openItems)
  })
  table.toggleItem(first)
  table.toggleItem(second)
  assert.deepEqual(table.openItems, [first, second])
  table.hideItem(first)
  assert.deepEqual(table.openItems, [second])
  table.toggleItem(first)
  assert.equal(first.element, element)
  table.engine.applyEffects([{ type: 'setFlag', id: 'tick', value: true }])
  assert.deepEqual(table.openItems, [first, second])
  assert.equal(first.element, element)
  table.toggleItem(first)
  table.hideItem(second)
  assert.deepEqual(table.openItems, [])
  assert.ok(notifications.length >= 6)
  table.disconnect()
})

test('inventory mutations notify the engine once and remove only the matching window', async () => {
  const engine = makeEngine()
  const table = new Worktable()
  table.engine = engine
  table.connect()
  await table.updateComplete
  const [first, second] = engine.inventory.toArray()
  table.toggleItem(first)
  table.toggleItem(second)
  let notifications = 0
  engine.subscribe(() => notifications++)
  engine.inventory.remove(first)
  assert.equal(notifications, 1)
  assert.deepEqual(table.openItems, [second])
  engine.inventory.remove(first)
  assert.equal(notifications, 1)
  engine.inventory.add({ id: 'notepad', count: 1, state: { page: 'third' } })
  assert.equal(notifications, 2)
  assert.deepEqual(table.openItems, [second])
  table.disconnect()
})

test('giveItem alone publishes inventory changes, batching with other effects', () => {
  const engine = new GameEngine({}, { unlockedItems: ['notepad'] })
  let notifications = 0
  engine.subscribe(() => notifications++)
  engine.applyEffects([{ type: 'giveItem', id: 'notepad' }, { type: 'giveItem', id: 'notepad' }])
  assert.equal(notifications, 1)
  assert.equal(engine.inventory.toArray().length, 1)
  assert.equal(engine.inventory.toArray()[0].count, 2)
})

test('workspace views replace subscriptions, clear old windows and disconnect cleanly', async () => {
  for (const View of [Worktable, Inventory]) {
    const counts = [0, 0]
    const engines = [makeEngine(), makeEngine()]
    engines.forEach((engine, index) => {
      const subscribe = engine.subscribe.bind(engine)
      engine.subscribe = listener => {
        counts[index]++
        const unsubscribe = subscribe(listener)
        return () => { counts[index]--; unsubscribe() }
      }
    })
    const view = new View()
    view.engine = engines[0]
    view.connect()
    await view.updateComplete
    assert.deepEqual(counts, [1, 0])
    if (view instanceof Worktable) view.toggleItem(engines[0].inventory.toArray()[0])
    view.engine = engines[1]
    await view.updateComplete
    assert.deepEqual(counts, [0, 1])
    if (view instanceof Worktable) {
      assert.deepEqual(view.openItems, [])
      const item = engines[1].inventory.toArray()[0]
      view.toggleItem(item)
      view.disconnect()
      view.connect()
      await view.updateComplete
      assert.deepEqual(view.openItems, [item])
    }
    view.disconnect()
    assert.deepEqual(counts, [0, 0])
    view.connect()
    await view.updateComplete
    assert.deepEqual(counts, [0, 1])
    view.disconnect()
  }
})

test('shell shares its engine and synchronizes inventory requests and window closes', async () => {
  const game = new Game()
  const table = new Worktable()
  const inventory = new Inventory()
  Object.defineProperty(game, 'children', { value: [table, inventory] })
  for (const [view, name] of [[table, 'eg-worktable'], [inventory, 'eg-inventory']]) {
    Object.defineProperty(view, 'localName', { value: name })
    Object.defineProperty(view, 'parentElement', { value: game })
    view.__eventTargetParent = game
  }
  game.engine = makeEngine()
  game.connect()
  await game.updateComplete
  table.connect()
  inventory.connect()
  await Promise.all([table.updateComplete, inventory.updateComplete])
  assert.equal(table.engine, game.engine)
  assert.equal(inventory.engine, game.engine)
  const item = game.engine.inventory.toArray()[0]
  inventory.dispatchEvent(new CustomEvent('inventory-item-toggle', { detail: { item }, bubbles: true, composed: true }))
  assert.deepEqual(table.openItems, [item])
  assert.deepEqual(inventory.openItems, [item])
  table.hideItem(item)
  assert.deepEqual(inventory.openItems, [])
  table.disconnect()
  inventory.disconnect()
  game.disconnect()
})

test('item actions cross component boundaries and resolve the inventory ID before element ID', async () => {
  const game = new Game()
  game.engine = makeEngine()
  game.connect()
  await game.updateComplete
  const item = game.engine.inventory.toArray()[0]
  item.element.id = 'different-dom-id'
  item.element.__eventTargetParent = game
  const received = []
  game.engine.dispatchAction = action => received.push(action)
  const event = new ItemEvent('inspect')
  assert.equal(event.composed, true)
  item.element.dispatchEvent(event)
  item.element.emit('inspect', { target: 'explicit' })
  const nested = new GameItemElement()
  nested.__eventTargetParent = item.element
  nested.emit('inspect')
  game.dispatchEvent(new ItemEvent('inspect'))
  assert.deepEqual(received.map(action => action.target), ['notepad', 'explicit', 'notepad', undefined])
  game.disconnect()
})


test('item interactions sync declared state before action conditions and publish one detached snapshot', async () => {
  const game = new Game()
  game.engine = new GameEngine({ events: [{
    id: 'edited', once: true, trigger: { type: 'action', action: 'content-change' },
    condition: { type: 'itemCount', id: 'notepad', op: '>=', value: 1, state: { content: 'new text' } },
    effects: [{ type: 'setFlag', id: 'edited', value: true }],
  }] }, { inventory: [
    { id: 'notepad', count: 1, state: { content: 'old', data: { pages: ['one'] } } },
    { id: 'notepad', count: 1, state: { content: 'other' } },
  ] })
  game.connect()
  await game.updateComplete
  const [first, second] = game.engine.inventory.toArray()
  first.element.__eventTargetParent = game
  const snapshots = []
  game.engine.subscribe(state => snapshots.push(state))
  first.element.content = 'new text'
  first.element.data.pages.push('two')
  first.element.internalProperty = 'never save'
  assert.deepEqual(first.state.data.pages, ['one'])
  first.element.emit('content-change', { target: 'explicit' })
  assert.equal(game.engine.state.flags.edited, true)
  assert.equal(snapshots.length, 1)
  assert.equal(first.state.content, 'new text')
  assert.equal(second.state.content, 'other')
  assert.equal(Object.hasOwn(first.state, 'internalProperty'), false)
  assert.deepEqual(first.state.data.pages, ['one', 'two'])
  first.element.data.pages.push('three')
  snapshots[0].inventory[0].state.data.pages.push('snapshot')
  assert.deepEqual(first.state.data.pages, ['one', 'two'])
  const restored = new GameEngine({}, game.engine.state).inventory.toArray()[0]
  assert.equal(restored.element.content, 'new text')
  assert.deepEqual(restored.element.data.pages, ['one', 'two'])
  game.disconnect()
})

test('sync-only interactions notify once, unchanged state is quiet and foreign instances are rejected', () => {
  const engine = makeEngine()
  const [first] = engine.inventory.toArray()
  let notifications = 0
  engine.subscribe(() => notifications++)
  first.element.page = 'edited'
  engine.dispatchAction({ name: 'edit' }, first)
  assert.equal(first.state.page, 'edited')
  assert.equal(notifications, 1)
  engine.dispatchAction({ name: 'edit' }, first)
  assert.equal(notifications, 1)
  assert.throws(() => engine.dispatchAction({ name: 'edit' }, makeEngine().inventory.toArray()[0]), /not in this inventory/)
  assert.equal(notifications, 1)
  first.setState({ data: { value: 1 } })
  first.element.data.value = 2
  assert.equal(first.state.data.value, 1)
  first.syncStateFromElement()
  assert.equal(first.state.data.value, 2)
})

test('nested games synchronize only the owning inventory, including nested item controls', async () => {
  const outer = new Game(), inner = new Game()
  outer.engine = makeEngine()
  inner.engine = makeEngine()
  outer.connect()
  inner.connect()
  inner.__eventTargetParent = outer
  await Promise.all([outer.updateComplete, inner.updateComplete])
  const innerItem = inner.engine.inventory.toArray()[0]
  const outerItem = outer.engine.inventory.toArray()[0]
  innerItem.element.__eventTargetParent = inner
  const control = new GameItemElement()
  control.__eventTargetParent = innerItem.element
  innerItem.element.page = 'inner changed'
  outerItem.element.page = 'outer unsynchronized'
  control.emit('edit')
  assert.equal(innerItem.state.page, 'inner changed')
  assert.equal(outerItem.state.page, 'first')
  inner.disconnect()
  outer.disconnect()
})
