import { css, html, LitElement, type PropertyValues } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import type { GameEngine } from '../../core/engine'
import type { Item } from '../../core/item'
import { translate } from '../../custom/translate'

export class EgInventoryElement extends LitElement {
  static properties = {
    engine: { attribute: false },
    openItems: { attribute: false },
  }

  static styles = css`
    :host { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; color: #243249; }
    h2 { font-size: 1rem; margin: 0; padding: .75rem 1rem; border-bottom: 1px solid #d8dfe9; }
    .items { display: flex; align-content: flex-start; flex-wrap: wrap; gap: .5rem; padding: .75rem; overflow: auto; }
    button { font: inherit; padding: .65rem .85rem; border: 1px solid #ccd5e3; border-radius: .5rem; background: white; color: inherit; cursor: pointer; overflow-wrap: anywhere; }
    button[aria-pressed=true] { background: #dce7fa; border-color: #6d8cbd; }
    button:disabled { cursor: default; opacity: .6; }
    button:focus-visible { outline: 2px solid #365fa4; outline-offset: 2px; }
    .count { margin-inline-start: .5rem; font-variant-numeric: tabular-nums; }
    p { padding: 0 1rem; color: #5c6b80; }
  `

  declare engine?: GameEngine
  declare openItems: readonly Item.ItemInstance[]
  #observedEngine?: GameEngine
  #unsubscribe?: () => void

  constructor() {
    super()
    this.openItems = []
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.#observeEngine()
  }

  override disconnectedCallback(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#observedEngine = undefined
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed)
    if (changed.has('engine') && this.isConnected) this.#observeEngine()
  }

  #observeEngine(): void {
    if (this.#observedEngine === this.engine) return
    this.#unsubscribe?.()
    this.#observedEngine = this.engine
    this.#unsubscribe = this.engine?.subscribe(() => this.requestUpdate())
    this.requestUpdate()
  }

  override render() {
    const items = this.engine?.inventory.toArray() ?? []
    return html`
      <h2>${translate('translate:ui.inventory')}</h2>
      ${items.length ? html`<div class="items">${repeat(items, item => item, item => html`
        <button type="button" ?disabled=${!item.element} aria-pressed=${this.openItems.includes(item)}
          title=${item.element ? item.displayName : translate('translate:ui.item_unavailable')}
          @click=${() => this.dispatchEvent(new CustomEvent('inventory-item-toggle', {
            detail: { item }, bubbles: true, composed: true,
          }))}>
          ${item.displayName}<span class="count">×${item.count}</span>
          ${!item.element ? html`<span> — ${translate('translate:ui.item_unavailable')}</span>` : ''}
        </button>`)}</div>` : html`<p role="status">${translate('translate:ui.inventory_empty')}</p>`}
    `
  }
}

customElements.define('eg-inventory', EgInventoryElement)
