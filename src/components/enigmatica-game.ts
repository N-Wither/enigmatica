import { css, html, LitElement, type PropertyValues } from 'lit'
import { GameEngine, type GameState } from '../core/engine'
import { GameItemElement, ItemEvent } from './game-item'
import type { EgChatElement } from './game/chat'
import { EgInventoryElement } from './game/inventory'
import { EgWorktableElement } from './game/worktable'
import { compactLayout } from './game/layout'
import { localize } from '../custom/translate'
import type { Item } from '../core/item'

/**
 * The game app.
 * 
 * You can inherit this class to add/modify methods.
 * 
 * @fires game-state-change when game state changes, the event's `detail` is the new state.
 */
export class EnigmaticaGameElement extends LitElement {
  static override properties = {
    engine: { attribute: false },
    compact: { state: true },
  }

  static styles = css`
    :host { --chat-toggle-button-width: 2.4rem; }
    :host { display: flex; flex-direction: column; height: 100vh; height: 100dvh; min-height: 0; color: #243249; font-family: system-ui, sans-serif; }
    * { box-sizing: border-box; }
    .toolbar { display: flex; align-items: center; gap: 1rem; padding: .5rem .75rem; border-bottom: 1px solid #d8dfe9; background: #fff; }
    .brand { font-weight: 700; }
    button[part=chat-toggle] { grid-area: button; display: flex; align-items: center; justify-content: center; font: inherit; color: inherit; cursor: pointer; padding: .5rem .75rem; background: white; border: none; border-inline-end: 1px solid #ccd5e3; height: 100%; transition: 0.2s; }
    button[part=chat-toggle]:focus-visible { outline: 2px solid #365fa4; outline-offset: 2px; }
    button[part=chat-toggle]:is(:hover, :focus) { background-color: #e4e7f3; }
    main { container-type: inline-size; display: grid; flex: 1; min-height: 0; min-width: 0; grid-template-columns: 36% var(--chat-toggle-button-width) minmax(0, 1fr); grid-template-rows: minmax(0, 3fr) minmax(0, 1fr); grid-template-areas: 'chat button worktable' 'chat button inventory'; }
    main.collapsed, main.compact { grid-template-columns: 0% var(--chat-toggle-button-width) minmax(0, 1fr); }
    /* Keep desktop content at its expanded width while the grid track clips it. */
    dialog { position: relative; inset: auto; display: flex; flex-shrink: 0; flex-direction: column; width: 36cqw; height: 100%; min-width: 0; min-height: 0; max-width: none; max-height: none; padding: 0; margin: 0; overflow: hidden; color: inherit; border: 0; border-right: 1px solid #d8dfe9; background: white; }
    dialog:not([open]) { display: none; }
    .chat-header { display: flex; align-items: center; justify-content: space-between; padding: .5rem .75rem; border-bottom: 1px solid #d8dfe9; }
    .chat-body { flex: 1; min-height: 0; overflow: hidden; }
    [part=chat] { grid-area: chat; display: flex; min-width: 0; overflow: hidden; }
    [part=worktable] { grid-area: worktable; min-width: 0; min-height: 0; overflow: hidden; }
    [part=inventory] { grid-area: inventory; min-width: 0; min-height: 0; overflow: hidden; border-top: 1px solid #d8dfe9; }
    slot { display: block; height: 100%; min-height: 0; }
    slot[hidden] { display: none; }
    ::slotted(eg-chat), ::slotted(eg-worktable), ::slotted(eg-inventory) { height: 100%; min-height: 0; min-width: 0; max-height: none; }
    .compact dialog { position: fixed; inset: 0 auto 0 0; width: min(100%, 34rem); height: 100vh; height: 100dvh; box-shadow: .5rem 0 2rem #16283c40; translate: -100% 0; }
    .compact dialog[data-visible] { translate: 0 0; }
    dialog::backdrop { background: #16283c80; opacity: 0; transition: opacity 200ms ease-in-out; }
    dialog[data-visible]::backdrop { opacity: 1; }
    dialog[data-instant]::backdrop { transition: none; }
    @media (prefers-reduced-motion: reduce) { dialog::backdrop { transition: none; } }
    [part=chat-hide] { background-color: transparent; border: none; font-family: inherit; font-size: inherit; }
    [part=chat-hide]:is(:hover, :focus) { background-color: #00000011; }
  `

  /** Assign an engine configured with content and optional saved state. */
  declare engine: GameEngine
  #observedEngine?: GameEngine
  #unsubscribe?: () => void
  declare compact: boolean
  #media?: MediaQueryList
  #desktopOpen = true
  #compactOpen = false
  #dialogModal = false
  #chatTarget?: boolean
  #chatLayout?: boolean
  #chatFromColumns?: string
  #chatAnimations: Animation[] = []
  #chatRevision = 0
  #chatInstant = false
  #reducedMotion?: MediaQueryList

  constructor() {
    super()
    this.engine = new GameEngine()
    this.compact = false
  }

  get state(): GameState {
    return this.engine.state
  }

  override render() {
    const open = this.compact ? this.#compactOpen : this.#desktopOpen
    return html`
      <header class="toolbar">
        <span class="brand">Enigmatica</span>
      </header>
      <main class=${this.compact ? 'compact' : open ? '' : 'collapsed'}>
        <section part="chat">
          <dialog id="chat-drawer" aria-label=${localize('ui.chat')}
          @cancel=${(event: Event) => { event.preventDefault(); this.#setChatOpen(false) }}
          @click=${(event: MouseEvent) => {
            const dialog = event.currentTarget as HTMLDialogElement
            const rect = dialog.getBoundingClientRect()
            if (this.compact && event.target === dialog &&
              (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) this.#setChatOpen(false)
            }}>
            <div class="chat-header">
              <strong>${localize('ui.chat')}</strong>
              <button part="chat-hide" type="button" aria-label=${localize('ui.hide_chat')}
              @click=${() => this.#setChatOpen(false)}>×</button>
            </div>
            <div class="chat-body"><slot name="chat" @slotchange=${this.#syncChildren}></slot></div>
          </dialog>
        </section>
        <button part="chat-toggle" type="button" aria-expanded=${open} aria-controls="chat-drawer"
          @click=${() => this.#setChatOpen(!open)}>
          ${localize(open ? 'ui.hide_chat' : 'ui.show_chat')}
        </button>
        <section part="worktable"><slot name="worktable" @slotchange=${this.#syncChildren}></slot></section>
        <section part="inventory"><slot name="inventory" @slotchange=${this.#syncChildren}></slot></section>
        <slot hidden></slot>
      </main>
    `
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('item-interact', this.#itemEventHandler)
    this.addEventListener('inventory-item-toggle', this.#inventoryToggle)
    this.addEventListener('worktable-change', this.#worktableChanged)
    this.#media = globalThis.matchMedia?.(compactLayout)
    this.compact = this.#media?.matches ?? false
    this.#media?.addEventListener('change', this.#layoutChanged)
    this.#reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.#reducedMotion?.addEventListener('change', this.#motionChanged)
    globalThis.addEventListener?.('resize', this.#chatResized)
    this.#observeEngine()
  }

  override disconnectedCallback(): void {
    this.removeEventListener('item-interact', this.#itemEventHandler)
    this.removeEventListener('inventory-item-toggle', this.#inventoryToggle)
    this.removeEventListener('worktable-change', this.#worktableChanged)
    this.#media?.removeEventListener('change', this.#layoutChanged)
    this.#reducedMotion?.removeEventListener('change', this.#motionChanged)
    globalThis.removeEventListener?.('resize', this.#chatResized)
    this.#cancelChatAnimations()
    this.#chatTarget = undefined
    this.#chatLayout = undefined
    this.renderRoot?.querySelector?.<HTMLDialogElement>('dialog')?.close()
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#observedEngine = undefined
    super.disconnectedCallback()
  }

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    super.willUpdate(changedProperties)
    if (changedProperties.has('engine') && this.isConnected) this.#observeEngine()
  }

  protected override updated(): void {
    this.#syncChildren()
    this.#syncChat()
  }

  #cancelChatAnimations(): void {
    this.#chatRevision++
    for (const animation of this.#chatAnimations) animation.cancel()
    this.#chatAnimations = []
  }

  #syncChat(): void {
    const dialog = this.renderRoot.querySelector?.<HTMLDialogElement>('dialog')
    const main = this.renderRoot.querySelector?.<HTMLElement>('main')
    if (!dialog || !main || !this.isConnected) return
    const open = this.compact ? this.#compactOpen : this.#desktopOpen
    const sameLayout = this.#chatLayout === this.compact
    if (sameLayout && this.#chatTarget === open) return
    const fromTranslate = dialog.open ? getComputedStyle(dialog).translate : '-100% 0px'
    const fromColumns = this.#chatFromColumns
    this.#chatFromColumns = undefined
    this.#cancelChatAnimations()
    const revision = this.#chatRevision
    this.#chatLayout = this.compact
    this.#chatTarget = open
    const animate = sameLayout && !this.#chatInstant && !this.#reducedMotion?.matches
    this.#chatInstant = false
    dialog.toggleAttribute('data-instant', !animate)
    if (dialog.open && this.#dialogModal !== this.compact) dialog.close()
    if (open && !dialog.open) {
      this.#dialogModal = this.compact
      if (this.compact) dialog.showModal()
      else dialog.show()
    }
    // Establish the initial backdrop opacity before changing its visible state.
    if (dialog.open) getComputedStyle(dialog, '::backdrop').opacity
    dialog.toggleAttribute('data-visible', open)
    const timing = { duration: 200, easing: 'ease-in-out' }
    if (animate && this.compact && dialog.open) {
      this.#chatAnimations.push(dialog.animate([
        { translate: fromTranslate }, { translate: open ? '0px 0px' : '-100% 0px' }
      ], timing))
    } else if (animate && !this.compact && fromColumns) {
      this.#chatAnimations.push(main.animate([
        { gridTemplateColumns: fromColumns },
        { gridTemplateColumns: getComputedStyle(main).gridTemplateColumns }
      ], timing))
    }
    const finish = () => {
      if (revision !== this.#chatRevision || !this.isConnected) return
      this.#chatAnimations = []
      if (!open) {
        const restoreFocus = dialog.open && (this.#dialogModal || dialog.contains(this.shadowRoot?.activeElement ?? null))
        dialog.close()
        if (restoreFocus) this.renderRoot.querySelector<HTMLButtonElement>('[part=chat-toggle]')?.focus()
      }
    }
    if (this.#chatAnimations.length) {
      void Promise.all(this.#chatAnimations.map(animation => animation.finished)).then(finish, () => {})
    } else finish()
  }

  #setChatOpen(open: boolean): void {
    const main = this.renderRoot.querySelector?.<HTMLElement>('main')
    if (main) this.#chatFromColumns = getComputedStyle(main).gridTemplateColumns
    if (this.compact) this.#compactOpen = open
    else this.#desktopOpen = open
    this.requestUpdate()
  }

  #chatResized = (): void => {
    // Pixel grid endpoints become stale on resize; settle in the new layout.
    this.#chatInstant = true
    this.#chatTarget = undefined
    this.#chatFromColumns = undefined
    this.requestUpdate()
  }

  #motionChanged = (): void => {
    this.#chatInstant = true
    this.#chatTarget = undefined
    this.requestUpdate()
  }

  #layoutChanged = (): void => {
    this.compact = this.#media?.matches ?? false
  }

  #syncChildren = (): void => {
    for (const child of Array.from(this.children ?? [])) {
      if (['eg-chat', 'eg-worktable', 'eg-inventory'].includes(child.localName)) {
        ;(child as EgChatElement | EgWorktableElement | EgInventoryElement).engine = this.engine
      }
    }
    const worktable = this.#worktable
    if (worktable) this.#syncOpenItems(worktable.openItems)
  }

  get #worktable(): EgWorktableElement | undefined {
    return Array.from(this.children ?? []).find((child): child is EgWorktableElement => child instanceof EgWorktableElement)
  }

  #syncOpenItems(items: readonly Item.ItemInstance[]): void {
    for (const child of Array.from(this.children ?? [])) {
      if (child instanceof EgInventoryElement) child.openItems = items
    }
  }

  #inventoryToggle = (event: Event): void => {
    if (!(event instanceof CustomEvent) || event.composedPath().find(node => node instanceof EnigmaticaGameElement) !== this) return
    const source = event.composedPath()[0]
    if (source instanceof EgInventoryElement && source.parentElement === this) this.#worktable?.toggleItem(event.detail.item)
  }

  #worktableChanged = (event: Event): void => {
    if (!(event instanceof CustomEvent) || event.composedPath()[0] !== this.#worktable) return
    this.#syncOpenItems(event.detail.openItems)
  }

  #observeEngine(): void {
    if (this.#observedEngine === this.engine) return
    this.#unsubscribe?.()
    this.#observedEngine = this.engine
    this.#unsubscribe = this.engine.subscribe(state => this.#stateChanged(state))
    this.#stateChanged(this.engine.state)
  }

  #stateChanged(state: GameState): void {
    this.requestUpdate()
    this.dispatchEvent(new CustomEvent<GameState>('game-state-change', {
      detail: state,
      bubbles: true,
      composed: true,
    }))
  }

  #itemEventHandler = (ev: Event): void => {
    if (!(ev instanceof ItemEvent) || !ev.details.name) return
    const path = ev.composedPath()
    // A nested game owns its own item interactions.
    if (path.find(element => element instanceof EnigmaticaGameElement) !== this) return
    const item = path.find((element): element is GameItemElement => element instanceof GameItemElement)
    const instance = this.engine.inventory.toArray().find(instance => instance.element && path.includes(instance.element))
    const target = typeof ev.details.target === 'string' ? ev.details.target : instance?.id || item?.id || undefined
    this.engine.dispatchAction({ name: ev.details.name, target, details: { ...ev.details } }, instance)
  }
}

customElements.define('enigmatica-game', EnigmaticaGameElement)
