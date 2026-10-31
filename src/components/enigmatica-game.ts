import { html, LitElement, type PropertyValues } from 'lit'
import { GameEngine, type GameState } from '../core/engine'
import { GameItemElement, ItemEvent } from './game-item'

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
  }

  /** Assign an engine configured with content and optional saved state. */
  declare engine: GameEngine
  #observedEngine?: GameEngine
  #unsubscribe?: () => void

  constructor() {
    super()
    this.engine = new GameEngine()
  }

  get state(): GameState {
    return this.engine.state
  }

  override render() {
    return html`<slot></slot>`
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('item-interact', this.#itemEventHandler)
    this.#observeEngine()
  }

  override disconnectedCallback(): void {
    this.removeEventListener('item-interact', this.#itemEventHandler)
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#observedEngine = undefined
    super.disconnectedCallback()
  }

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    super.willUpdate(changedProperties)
    if (changedProperties.has('engine') && this.isConnected) this.#observeEngine()
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
    const target = typeof ev.details.target === 'string' ? ev.details.target : item?.id || undefined
    this.engine.dispatchAction({ name: ev.details.name, target, details: { ...ev.details } })
  }
}

customElements.define('enigmatica-game', EnigmaticaGameElement)
