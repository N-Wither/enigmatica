import { css, html, LitElement, nothing } from 'lit'
import type { CalculatedDialogChoiceOption, Character, DialogueNode } from '../../core/types'
import { localize, translate } from '../../custom/translate'
import { AssetManager } from '../../core/asset'

/** Presentational node: the owning chat handles all state changes and effects. */
export class EgDialogNodeElement extends LitElement {
  static properties = {
    node: { attribute: false },
    character: { attribute: false },
    options: { attribute: false },
    active: { type: Boolean },
    messageRecorded: { type: Boolean },
    literalText: { type: Boolean },
    isPlayer: { type: Boolean, reflect: true }
  }

  static styles = css`
    :host { display: block; margin-block: .75rem; font: inherit; }
    :host([isplayer]) [part=wrapper] { justify-content: flex-end; }
    :host([isplayer]) [part=speaker] { text-align: end; }
    [part=wrapper] { display: flex; gap: .75rem; align-items: flex-start; }
    [part=avatar] { flex-shrink: 0; width: 3rem; height: 3rem; border-radius: 50%; object-fit: cover; }
    [part=message] { min-width: 0; text-align: start; padding: 0.3rem; border-radius: .75rem; max-width: 36rem; overflow-wrap: anywhere; }
    [part=speaker] { font-size: .85em; font-weight: 600; margin-bottom: .4rem; }
    [part=content] { white-space: pre-wrap; }
    .choice { flex-wrap: wrap; }
    button, input { font: inherit; padding: .65rem .9rem; border: 1px solid #a8b3c5; border-radius: .5rem; }
    button { cursor: pointer; background: #fff; }
    button:disabled { cursor: default; opacity: .5; }
    input { min-width: 0; flex: 1; }
    form { display: flex; gap: .5rem; width: 100%; }
    [part=continue] { margin-top: .5rem; }
    :focus-visible { outline: 2px solid #365fa4; outline-offset: 2px; }
  `

  declare node: DialogueNode
  declare character?: Character
  declare options: CalculatedDialogChoiceOption[]
  declare active: boolean
  declare messageRecorded: boolean
  /** User input must not be interpreted as a localization key. */
  declare literalText: boolean
  declare isPlayer: boolean

  constructor() {
    super()
    this.options = []
    this.active = false
    this.messageRecorded = false
    this.literalText = false
    this.isPlayer = false
  }

  override render() {
    const node = this.node
    if (!node) return nothing
    switch (node.type) {
      case undefined:
      case 'message': {
        const avatar = this.character?.avatars?.[node.emotion ?? 'default'] || this.character?.avatars?.default
        const image = html`<img part="avatar" alt="" src=${AssetManager.urlFromPath(avatar ?? '')} />`
        return html`
          ${this.messageRecorded ? nothing : html`<div part="wrapper">
            ${(avatar && !this.isPlayer) ? image : nothing}
            <div part="message">
              <div part="speaker">${translate(this.character?.name ?? node.speaker)}</div>
              <div part="content">${this.literalText ? node.text : translate(node.text)}</div>
            </div>
            ${(avatar && this.isPlayer) ? image : nothing}
          </div>`}
          ${this.active ? html`<button part="continue" @click=${() => this.emit('continue')}>${localize('ui.continue')}</button>` : nothing}
        `
      }
      case 'choice':
        return this.active ? html`<div part="wrapper" class="choice">
          ${this.options.filter(option => option.show !== 'remove').map(option => html`
            <button part="option" ?disabled=${option.show === 'disable'}
              @click=${() => this.emit('choice', { id: option.id })}>${translate(option.text)}</button>
          `)}
        </div>` : nothing
      case 'input':
        return this.active ? html`<div part="wrapper"><form @submit=${(event: SubmitEvent) => {
          event.preventDefault()
          this.dispatchInput()
        }}>
          <input aria-label=${translate(node.placeholder ?? 'translate:ui.reply')}
            placeholder=${translate(node.placeholder ?? 'translate:ui.reply')} .value=${node.value ?? ''}
            @keydown=${(event: KeyboardEvent) => {
              if (event.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                this.dispatchInput()
              }
            }} />
          <button type="submit">${localize('ui.send')}</button>
        </form></div>` : nothing
      case 'router': {
        return nothing
      }
      default:
        return html`<div>${localize('error.unknown_node_type', (node as DialogueNode).type)}</div>`
    }
  }

  private emit(name: string, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  dispatchInput(): void {
    const input = this.renderRoot.querySelector('input')
    if (input) this.emit('dialogue-input', { content: input.value })
  }
}

customElements.define('eg-dialognode', EgDialogNodeElement)
