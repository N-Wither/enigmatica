import { css, html } from "lit";
import { GameItemElement } from "../game-item";
import { translate } from "../../custom/translate";

class EgNotepadElement extends GameItemElement {
  static styles = css`
    :host {
      display: block;
    }

    textarea {
      resize: none;
      font-family: inherit;
      box-sizing: border-box;
      max-width: 100%;
    }
  `

  render() {
    return html`
    <div>${translate('translate:item.notepad')}</div>
    <textarea cols="24" rows="16" name=${translate('translate:item.notepad')}></textarea>
    `
  }
}

customElements.define('eg-notepad', EgNotepadElement)
