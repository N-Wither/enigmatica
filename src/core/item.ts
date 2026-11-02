import { GameItemElement } from '../components/game-item'
import { items } from '../contents/contents'
import { translate } from '../custom/translate'
import { ObjectUtils } from '../custom/util/object'
import type { Condition } from './types'

/** Types and methods about items in game. */
export namespace Item {
  export interface Metadata {
    id: string
    name: string
    element: string
    tags?: string[]
    category?: string
    customData?: Record<string, any>
    unlockableWhen?: Condition
    /** The default state of complex or interactive items. */
    defaultState?: State
  }

  export interface Instance {
    id: string
    count: number
    /** The element representing a item. */
    element?: GameItemElement
    /** Optional custom properties. These properties will be copied to `element` */
    state?: Record<string, unknown>
  }

  export type State = Record<string, unknown>

  export class ItemInstance implements Instance {
    count = 1
    state: State = {}
    element?: GameItemElement

    constructor(public id: string, count = 1) {
      this.id = id
      this.count = count

      const elementName = getElementName(id)
      if (elementName != undefined) {
        this.element = document.createElement(elementName) as GameItemElement
      }

      const defaultState = getMetaData(id)?.defaultState
      if (defaultState != undefined) {
        this.setState(defaultState)
      }
    }

    get displayName() {
      return getDisplayName(this)
    }

    /** Using this method will trigger element update. */
    setState(k: string, v: unknown): this
    setState(state: State): this
    setState(propOrState: string | State, value?: unknown) {
      if (typeof propOrState == 'string') {
        this.state[propOrState] = value
        if (this.element != undefined) {
          Reflect.set(this.element, propOrState, value)
        }
      } else {
        Object.assign(this.state, propOrState)
      }
      if (this.element) {
        Object.assign(this.element, this.state)
      }
      return this
    }

    toPlainObject() {
      const result: Instance = {
        id: this.id,
        count: this.count
      }
      if (ObjectUtils.isEmpty(this.state) == false) {
        result.state = JSON.parse(JSON.stringify(this.state)) as State
      }
      return result
    }
  }

  export function from(instance: Instance) {
    const item = new ItemInstance(instance.id, instance.count)
    if (instance.state) {
      item.setState(structuredClone(instance.state))
    }
    return item
  }

  export function of(id: string, count = 1, state?: State) {
    const item = new ItemInstance(id, count)
    if (state != undefined) {
      item.setState( state)
    }
    return item
  }

  export function getMetaData(id: string) {
    return (items as Metadata[]).find((i) => i.id == id)
  }

  export function getName(id: string) {
    return items.find((i) => i.id == id)?.name ?? `[MISSING ${id}]`
  }

  export function getElementName(id: string) {
    return items.find((i) => i.id == id)?.element
  }

  export function getDisplayName(item: Instance) {
    return translate(getName(item.id))
  }

  export function same(item1: Instance, item2: Instance): boolean {
    if (item1.id != item2.id) return false
    if (ObjectUtils.same(item1.state, item2.state) == false) return false
    return true
  }
}
