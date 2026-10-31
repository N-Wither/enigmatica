import type { Item } from '../core/item'
import type { Character, Dialogue, GameEvent } from '../core/types'
import c from './character/characters.json' with { type: 'json' }
import d from './dialog/dialogs.json' with { type: 'json' }
import e from './event/events.json' with { type: 'json' }
import i from './item/metadata.json' with { type: 'json' }

const characters: Character[] = c
const dialogues: Dialogue[] = d
const events: GameEvent[] = e
const items: Item.Metadata[] = i

/** Provides tools for character data usage. */
export class WrappedCharacter implements Required<Character> {
  id = ''
  name = ''
  description = ''
  tags: string[] = []
  avatars: { [emotion: string]: string; default: string } = {
    default: ''
  }

  constructor(info?: Character) {
    if (info != undefined) {
      this.id = info.id
      this.name = info.name
      info.description && (this.description = info.description)
      info.avatars && (Object.assign(this.avatars, info.avatars))
      info.tags && (this.tags = info.tags)
    }
  }

  getAvatar(emotion = 'default') {
    return this.avatars[emotion] || this.avatars.default || ''
  }

  /** An empty character. */
  static MOCK = new WrappedCharacter()
  /** Creates an errored character to display error message. */
  static error(reason: string) {
    return new WrappedCharacter({
      id: '',
      name: reason
    })
  }
}

namespace ContentManager {
  export function getCharacter(id: string) {
    const found = characters.find((entry) => entry.id == id)
    if (found == undefined) {
      console.warn(`Failed to find character with id "${id}"`)
      return found
    } else {
      return new WrappedCharacter(found)
    }
  }

  export function getDialogue(id: string) {
    return dialogues.find((entry) => entry.id == id)
  }

  export function getEvent(id: string) {
    return events.find((entry) => entry.id == id)
  }

  export function getItemMetadata(id: string) {
    return items.find((entry) => entry.id == id)
  }
}

export {
  characters,
  dialogues,
  events,
  items,
  ContentManager
}