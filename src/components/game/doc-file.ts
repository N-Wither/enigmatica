import { css, html } from "lit";
import { GameItemElement } from "../game-item";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { translate } from "../../custom/translate";

export class EgDocFileElement extends GameItemElement {
  static properties = {
    head: { type: String },
    content: { type: String },
    source: { type: String }
  }

  static styles = css`
    :host {
      display: block;
    }
  `

  /** Holds the source elements to be cloned as the content. */
  static sourceElements = new Map<string, HTMLElement>

  declare head: string
  declare content: string
  /** The identifier of the source element to be used as content. */
  declare source: string

  render() {
    return html`
    <div part="title">${translate(this.head)}</div>
    <hr/>
    <div part="content">
      ${this.content ? unsafeHTML(translate(this.content)) : ''}
      ${this.source ? EgDocFileElement.sourceElements.get(this.source) : ''}
    </div>
    `
  }
}

customElements.define('eg-docfile', EgDocFileElement)
