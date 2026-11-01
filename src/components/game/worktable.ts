import { css, html, LitElement, type PropertyValues } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import type { GameEngine } from '../../core/engine'
import type { Item } from '../../core/item'
import { translate } from '../../custom/translate'
import { compactLayout } from './layout'

interface WindowState {
  visible: boolean
  expanded: boolean
  x: number
  y: number
  z: number
}

export class EgWorktableElement extends LitElement {
  static properties = { engine: { attribute: false }, compact: { state: true } }
  static styles = css`
    :host { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; color: #243249; }
    h2 { margin: 0; padding: .75rem 1rem; font-size: 1rem; border-bottom: 1px solid #d8dfe9; }
    .surface { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #eef2f7; isolation: isolate; }
    .window { position: absolute; display: flex; flex-direction: column; width: max-content; min-width: min(16rem, 100%); max-width: 100%; max-height: 100%; box-sizing: border-box; border: 1px solid #bac8db; border-radius: .65rem; background: white; box-shadow: 0 .3rem 1rem #24324926; overflow: hidden; }
    .window[hidden], .content[hidden] { display: none; }
    .titlebar { display: flex; align-items: center; gap: .5rem; background: #e5ecf6; cursor: grab; touch-action: none; user-select: none; flex-shrink: 0; }
    .title { flex: 1; min-width: 0; padding: .65rem .8rem; text-align: left; overflow-wrap: anywhere; }
    button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; }
    .title:disabled { color: inherit; opacity: 1; cursor: inherit; }
    .close { padding: .65rem .85rem; flex-shrink: 0; }
    button:focus-visible { outline: 2px solid #365fa4; outline-offset: -3px; }
    .content { padding: .85rem; overflow: auto; min-height: 0; overflow-wrap: anywhere; }
    .empty { margin: 1rem; color: #5c6b80; }
    .surface.compact { overflow: auto; padding: .5rem; }
    .compact .window { position: relative; width: 100%; max-height: none; margin-bottom: .5rem; box-shadow: none; }
    .compact .titlebar { cursor: default; touch-action: auto; }
    .compact .content { overflow: auto; }
  `

  declare engine?: GameEngine
  declare compact: boolean
  #windows = new Map<Item.ItemInstance, WindowState>()
  #observedEngine?: GameEngine
  #unsubscribe?: () => void
  #media?: MediaQueryList
  #resize?: ResizeObserver
  #observedWindows = new Set<Element>()
  #z = 0
  #drag?: { item: Item.ItemInstance; handle: HTMLElement; pointerId: number; x: number; y: number; startX: number; startY: number }

  constructor() {
    super()
    this.compact = false
  }

  get openItems(): readonly Item.ItemInstance[] {
    return [...this.#windows].filter(([, state]) => state.visible).map(([item]) => item)
  }

  toggleItem(item: Item.ItemInstance): void {
    if (!item.element || !this.engine?.inventory.items.has(item)) return
    let state = this.#windows.get(item)
    if (state?.visible) { this.hideItem(item); return }
    if (!state) {
      const offset = (this.#windows.size % 8) * 28
      state = { visible: false, expanded: true, x: offset, y: offset, z: 0 }
      this.#windows.set(item, state)
    }
    state.visible = true
    state.expanded = true
    state.z = ++this.#z
    this.#changed()
  }

  hideItem(item: Item.ItemInstance): void {
    const state = this.#windows.get(item)
    if (!state?.visible) return
    if (this.#drag?.item === item) this.#stopDrag()
    state.visible = false
    this.#changed()
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.#media = globalThis.matchMedia?.(compactLayout)
    this.compact = this.#media?.matches ?? false
    this.#media?.addEventListener('change', this.#layoutChanged)
    this.#observeEngine()
    if (globalThis.ResizeObserver) this.#resize = new ResizeObserver(() => this.#clampWindows())
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      const surface = this.renderRoot.querySelector('.surface')
      if (surface) this.#resize?.observe(surface)
      this.#observeWindows()
    })
  }

  override disconnectedCallback(): void {
    this.#stopDrag()
    this.#media?.removeEventListener('change', this.#layoutChanged)
    this.#resize?.disconnect()
    this.#resize = undefined
    this.#observedWindows.clear()
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    // Retain the engine identity and windows across temporary DOM disconnects.
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed)
    if (changed.has('engine') && this.isConnected) this.#observeEngine()
  }

  protected override updated(): void {
    this.#observeWindows()
    this.#clampWindows()
  }

  #observeWindows(): void {
    const windows = new Set(this.renderRoot.querySelectorAll('.window'))
    for (const window of this.#observedWindows) {
      if (!windows.has(window)) this.#resize?.unobserve(window)
    }
    for (const window of windows) {
      if (!this.#observedWindows.has(window)) this.#resize?.observe(window)
    }
    this.#observedWindows = windows
  }

  #observeEngine(): void {
    if (this.#observedEngine === this.engine && this.#unsubscribe) return
    this.#unsubscribe?.()
    if (this.#observedEngine !== this.engine) {
      this.#stopDrag()
      this.#windows.clear()
      this.#z = 0
    }
    this.#observedEngine = this.engine
    this.#unsubscribe = this.engine?.subscribe(() => this.#syncInventory())
    this.#syncInventory()
  }

  #syncInventory(): void {
    for (const item of this.#windows.keys()) {
      if (!this.engine?.inventory.items.has(item)) {
        if (this.#drag?.item === item) this.#stopDrag()
        this.#windows.delete(item)
      }
    }
    this.#changed()
  }

  #changed(): void {
    this.requestUpdate()
    this.dispatchEvent(new CustomEvent('worktable-change', {
      detail: { openItems: this.openItems }, bubbles: true, composed: true,
    }))
  }

  #layoutChanged = (): void => {
    this.#stopDrag()
    this.compact = this.#media?.matches ?? false
  }

  #clampWindows(): void {
    if (this.compact) return
    const surface = this.renderRoot.querySelector<HTMLElement>('.surface')
    if (!surface) return
    const windows = this.renderRoot.querySelectorAll<HTMLElement>('.window')
    let changed = false
    ;[...this.#windows].forEach(([, state], index) => {
      const window = windows[index]
      if (!state.visible || !window) return
      const x = Math.max(0, Math.min(state.x, surface.clientWidth - window.offsetWidth))
      const y = Math.max(0, Math.min(state.y, surface.clientHeight - window.offsetHeight))
      if (x !== state.x || y !== state.y) { state.x = x; state.y = y; changed = true }
    })
    if (changed) this.requestUpdate()
  }

  #startDrag(event: PointerEvent, item: Item.ItemInstance): void {
    if (this.compact || event.button !== 0 || this.#drag) return
    const path = event.composedPath()
    if (path.some(node => node instanceof HTMLElement && node.classList.contains('close'))) return
    const state = this.#windows.get(item)!
    const handle = event.currentTarget as HTMLElement
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    this.#drag = { item, handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: state.x, startY: state.y }
  }

  #moveDrag = (event: PointerEvent): void => {
    const drag = this.#drag
    if (!drag || drag.pointerId !== event.pointerId) return
    const state = this.#windows.get(drag.item)!
    state.x = drag.startX + event.clientX - drag.x
    state.y = drag.startY + event.clientY - drag.y
    this.#clampWindows()
    this.requestUpdate()
  }

  #endDrag = (event: PointerEvent): void => {
    if (this.#drag?.pointerId === event.pointerId) this.#stopDrag()
  }

  #stopDrag(): void {
    const drag = this.#drag
    this.#drag = undefined
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId)
  }

  override render() {
    return html`
      <h2>${translate('translate:ui.worktable')}</h2>
      <div class=${this.compact ? 'surface compact' : 'surface'}>
        ${!this.openItems.length ? html`<p class="empty" role="status">${translate('translate:ui.worktable_empty')}</p>` : ''}
        ${repeat([...this.#windows], ([item]) => item, ([item, state]) => html`
          <section class="window" ?hidden=${!state.visible} aria-label=${item.displayName}
            style=${this.compact ? '' : `left:${state.x}px;top:${state.y}px;z-index:${state.z}`}
            @pointerdown=${() => { state.z = ++this.#z; this.requestUpdate() }}>
            <div class="titlebar" @pointerdown=${(event: PointerEvent) => this.#startDrag(event, item)}
              @pointermove=${this.#moveDrag} @pointerup=${this.#endDrag}
              @pointercancel=${this.#endDrag} @lostpointercapture=${this.#endDrag}>
              <button class="title" type="button" ?disabled=${!this.compact}
                aria-expanded=${!this.compact || state.expanded}
                @click=${() => { if (this.compact) { state.expanded = !state.expanded; this.requestUpdate() } }}>
                ${this.compact ? (state.expanded ? '▾ ' : '▸ ') : ''}${item.displayName}
              </button>
              <button class="close" type="button" aria-label=${translate('translate:ui.close_item', item.displayName)}
                @click=${() => this.hideItem(item)}>×</button>
            </div>
            <div class="content" ?hidden=${this.compact && !state.expanded}>${item.element}</div>
          </section>`)}
      </div>
    `
  }
}

customElements.define('eg-worktable', EgWorktableElement)
