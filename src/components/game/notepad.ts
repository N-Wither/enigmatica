import { css, html } from "lit";
import { GameItemElement } from "../game-item";
import { translate } from "../../custom/translate";

class EgNotepadElement extends GameItemElement {
  static styles = css`
    :root {
      display: block;
    }

    textarea {
      resize: none;
      font-family: inherit;
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
