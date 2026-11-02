import { ObjectUtils } from '../custom/util/object'
import { Item } from './item'

interface ItemFilter {
  id: string
  count?: number
  state?: Item.State
}

export class Inventory {
  items = new Set<Item.ItemInstance>()
  #listeners = new Set<() => void>()

  /** Observe mutations made through add/remove, including direct inventory usage. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener()
  }

  has(id: string): boolean
  has(item: Item.Instance): boolean
  has(filter: string | Item.Instance) {
    if (typeof filter == 'string') {
      return Array.from(this.items).some((i) => i.id == filter)
    } else {
      return Array.from(this.items).some((i) => Item.same(i, filter))
    }
  }

  find(idOrfilter: string | ItemFilter): Item.ItemInstance[] {
    if (typeof idOrfilter == 'string') {
      return Array.from(this.items).filter((i) => i.id == idOrfilter)
    } else {
      let found = Array.from(this.items).filter((i) => i.id == idOrfilter.id)
      if (idOrfilter.count != undefined) {
        found = found.filter((i) => i.count == idOrfilter.count)
      }
      if (idOrfilter.state != undefined) {
        found = found.filter((i) => ObjectUtils.same(i.state, idOrfilter.state))
      }
      return found
    }
  }

  add(id: string): this
  add(...items: Item.Instance[]): this
  add(...items: (Item.Instance | string)[]) {
    if (items.length == 1 && typeof items[0] == 'string') {
      return this.add(Item.of(items[0]))
    } else {
      items.filter((item) => typeof item != 'string').forEach((item) => {
        const found = this.find(item)
        if (found.length == 0) {
          this.items.add(Item.from(item))
        } else {
          found[0].count += item.count
        }
      })
      if (items.length) this.#changed()
      return this
    }
  }

  consume(id: string, count?: number): this
  consume(filter: ItemFilter, count?: number): this
  consume(idOrFilter: string | ItemFilter, count = 1) {
    if (typeof idOrFilter == 'string') {
      this.consume({ id: idOrFilter })
    } else {
      const { id, state } = idOrFilter
      const target = this.find({ id, state })[0]
      if (target) {
        target.count -= count
        this.#cleanup()
      }
    }
    return this
  }

  remove(id: string): void
  remove(item: Item.Instance): void
  remove(filter: string | Item.Instance) {
    const removed = this.find(filter)
    removed.forEach((i) => {
      this.items.delete(i)
      i.element?.remove()
    })
    if (removed.length) this.#changed()
  }

  toArray(): Item.ItemInstance[] {
    return Array.from(this.items)
  }

  toPlainArray() {
    return this.toArray().map((i) => i.toPlainObject())
  }

  #cleanup() {
    const prevCount = this.items.size
    this.items.forEach((i) => {
      if (i.count <= 0) {
        this.items.delete(i)
      }
    })
    if (this.items.size < prevCount) {
      this.#changed()
    }
  }

  *[Symbol.iterator]() {
    for (const item of this.items) {
      yield item
    }
  }
}
