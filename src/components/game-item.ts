import { html, LitElement } from 'lit'

export class ItemEvent extends CustomEvent<unknown> {
  details: { name: string } & Record<string, any> = { name: ''}

  constructor(
    name: string,
    details?: Record<string, any>,
  ) {
    super('item-interact', {
      bubbles: true,
    })
    this.details.name = name
    Object.assign(this.details, details)
  }
}

export class GameItemElement extends LitElement {
  render() {
    return html`<slot></slot>`
  }
  /** Dispatch an auto-bubbling `ItemEvent`.*/
  emit(name: string, details?: Record<string, any>) {
    this.dispatchEvent(new ItemEvent(name, details))
  }
}

customElements.define('game-item', GameItemElement)
