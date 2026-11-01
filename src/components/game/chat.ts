import { css, html, LitElement, nothing, type PropertyValues } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import type { GameEngine } from '../../core/engine'
import type { ChatHistoryEntry } from '../../core/dialogue'
import { AssetManager } from '../../core/asset'
import { translate } from '../../custom/translate'
import './dialog-node'

export class EgChatElement extends LitElement {
  static properties = {
    engine: { attribute: false },
    currentCharacter: { type: String, attribute: 'current-character' },
    feedback: { state: true },
  }

  static styles = css`
    :host { --avatar-size: 3rem; display: flex; min-width: 0; min-height: 0; height: 100%; color: #243249; font-family: system-ui, sans-serif; }
    * { box-sizing: border-box; }
    [part=character-list] { width: min(12rem, 45%); flex-shrink: 0; overflow: auto; background: #f4f6fa; padding: .5rem; }
    .character-info { display: flex; align-items: center; gap: .5rem; width: 100%; text-align: left; margin-bottom: .4rem; }
    .character-info[aria-pressed=true] { background: #dce7fa; border-color: #6d8cbd; }
    .avatar, .initial { width: var(--avatar-size); height: var(--avatar-size); flex-shrink: 0; border-radius: 50%; object-fit: cover; }
    .initial { display: grid; place-items: center; background: #dce3ee; }
    .name { font-weight: 600; }
    .character-text { min-width: 0; overflow-wrap: anywhere; }
    .desc { display: block; font-size: .8em; color: #5c6b80; }
    [part=chat-panel-wrapper] { flex: 1; min-width: 0; overflow-y: auto; padding: 1rem; }
    h2 { margin: 0 0 1rem; font-size: 1.1rem; overflow-wrap: anywhere; }
    button { font: inherit; padding: .5rem .75rem; background: white; border: 1px solid #ccd5e3; border-radius: .5rem; cursor: pointer; }
    button:disabled { cursor: default; opacity: .5; }
    [part=dialogue-list] { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
    [part=response] { margin: .75rem 0 .75rem auto; padding: .75rem 1rem; width: fit-content; max-width: 85%; white-space: pre-wrap; overflow-wrap: anywhere; background: #dce7fa; border-radius: .75rem; }
    [role=status] { color: #5c6b80; }
    :focus-visible { outline: 2px solid #365fa4; outline-offset: 2px; }
    @media (max-width: 560px) {
      [part=character-list] { width: 4.25rem; padding: .25rem; }
      .character-info { padding: .25rem; }
      .character-text { display: none; }
    }
  `

  declare engine?: GameEngine
  declare currentCharacter: string
  private declare feedback: string
  #observedEngine?: GameEngine
  #unsubscribe?: () => void

  constructor() {
    super()
    this.currentCharacter = ''
    this.feedback = ''
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
    if (changed.has('currentCharacter')) this.feedback = ''
    const characters = this.engine?.getAvailableCharacters() ?? []
    if (!characters.some(character => character.id === this.currentCharacter)) {
      this.currentCharacter = characters[0]?.id ?? ''
    }
  }

  #observeEngine(): void {
    if (this.#observedEngine === this.engine) return
    this.#unsubscribe?.()
    this.#observedEngine = this.engine
    this.#unsubscribe = this.engine?.subscribe(() => this.requestUpdate())
    this.feedback = ''
    this.requestUpdate()
  }

  #perform(operation: () => void): void {
    try { this.feedback = ''; operation() }
    catch (error) { this.feedback = error instanceof Error ? error.message : String(error) }
  }

  #history(entry: ChatHistoryEntry) {
    const engine = this.engine!
    const node = engine.getDialogue(entry.dialogueId)?.nodes[entry.id]
    if (!node) return nothing
    if (entry.kind === 'message' && node.type === 'message') {
      return html`<eg-dialognode .node=${node} .character=${engine.getCharacter(node.speaker)}></eg-dialognode>`
    }
    const response = entry.kind === 'choice' && node.type === 'choice'
      ? node.options.find(option => option.id === entry.optionId)?.text : entry.userInput
    return response === undefined ? nothing : html`<div part="response">${entry.kind === 'choice' ? translate(response) : response}</div>`
  }

  override render() {
    const engine = this.engine
    if (!engine) return html`<p role="status">${translate('translate:ui.no_engine')}</p>`
    const characters = engine.getAvailableCharacters()
    const state = engine.state
    const selected = engine.getCharacter(this.currentCharacter)
    const current = state.dialogue
    const active = current && engine.getDialogue(current.id)?.characterId === this.currentCharacter
    const node = active ? engine.getCurrentDialogueNode() : null
    const history = state.chatHistory[this.currentCharacter] ?? []
    // Old saves can have an active message without a transcript. Render that message once.
    const last = history.at(-1)
    const recorded = node?.type === 'message' && last?.kind === 'message' &&
      last.dialogueId === current?.id && last.id === current?.currentNode
    return html`
      <nav part="character-list" aria-label=${translate('translate:ui.contacts')}>
        ${characters.map(character => {
          const avatar = character.avatars?.default
          return html`<button class="character-info" aria-label=${translate(character.name)}
            aria-pressed=${character.id === this.currentCharacter}
            @click=${() => { this.currentCharacter = character.id }}>
            ${avatar ? html`<img class="avatar" alt="" src=${AssetManager.urlFromPath(avatar)} />`
              : html`<span class="initial" aria-hidden="true">${translate(character.name).slice(0, 1)}</span>`}
            <span class="character-text"><span class="name">${translate(character.name)}</span>
              <span class="desc">${translate(character.description ?? '')}</span></span>
          </button>`
        })}
      </nav>
      <section part="chat-panel-wrapper">
        ${selected ? html`<h2>${translate(selected.name)}</h2>` : html`<p>${translate('translate:ui.no_contacts')}</p>`}
        <div part="history">${history.map(entry => this.#history(entry))}</div>
        ${node && current ? keyed(current.id + ':' + current.currentNode, html`
          <eg-dialognode .node=${node} .active=${true} .messageRecorded=${recorded}
            .character=${node.type === 'message' ? engine.getCharacter(node.speaker) : undefined}
            .options=${engine.getDialogueOptions()}
            @continue=${() => this.#perform(() => { engine.advanceDialogue() })}
            @choice=${(event: CustomEvent<{ id: string }>) => this.#perform(() => { engine.chooseDialogueOption(event.detail.id) })}
            @dialogue-input=${(event: CustomEvent<{ content: string }>) => this.#perform(() => {
              const result = engine.submitDialogueInput(event.detail.content)
              if (!result.accepted) this.feedback = translate('translate:ui.empty_input')
              else if (!result.matched && result.node === node) this.feedback = translate('translate:ui.input_retry')
            })}>
          </eg-dialognode>`) : nothing}
        ${current && !active ? html`<p role="status">${translate('translate:ui.other_dialogue_active')}</p>` : nothing}
        <p role="status" aria-live="polite">${this.feedback}</p>
        <div part="dialogue-list">
          ${engine.getAvailableDialogues(this.currentCharacter).map(dialogue => html`
            <button ?disabled=${!!current} @click=${() => this.#perform(() => { engine.startDialogue(dialogue.id) })}>
              ${translate('translate:ui.start_dialogue', dialogue.id)}
            </button>`)}
        </div>
        ${selected && !current && !engine.getAvailableDialogues(this.currentCharacter).length ? html`<p>${translate('translate:ui.no_dialogues')}</p>` : nothing}
      </section>
    `
  }
}

customElements.define('eg-chat', EgChatElement)
