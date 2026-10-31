import { Item } from './item'

export class Inventory {
  items = new Set<Item.ItemInstance>()

  has(id: string): boolean
  has(item: Item.Instance): boolean
  has(filter: string | Item.Instance) {
    if (typeof filter == 'string') {
      return Array.from(this.items).some((i) => i.id == filter)
    } else {
      return Array.from(this.items).some((i) => Item.same(i, filter))
    }
  }

  find(idOrfilter: string | Item.Instance) {
    if (typeof idOrfilter == 'string') {
      return Array.from(this.items).filter((i) => i.id == idOrfilter)
    } else {
      if (idOrfilter.state == undefined) {
        return Array.from(this.items).filter((i) => i.id == idOrfilter.id && i.count == idOrfilter.count)
      } else {
        return Array.from(this.items).filter((i) => Item.same(i, idOrfilter))
      }
    }
  }

  add(id: string): this
  add(...items: Item.Instance[]): this
  add(...items: (Item.Instance | string)[]) {
    if (items.length == 1 && typeof items[0] == 'string') {
      this.add(Item.of(items[0]))
    } else {
      items.filter((item) => typeof item != 'string').forEach((item) => {
        const found = this.find(item)
        if (found.length == 0) {
          this.items.add(Item.from(item))
        } else {
          found[0].count += item.count
        }
      })
      return this
    }
  }

  remove(id: string): void
  remove(item: Item.Instance): void
  remove(filter: string | Item.Instance) {
    this.find(filter).forEach((i) => {
      this.items.delete(i)
      i.element?.remove()
    })
  }

  toArray(): Item.ItemInstance[] {
    return Array.from(this.items)
  }

  toPlainArray() {
    return this.toArray().map((i) => i.toPlainObject())
  }

  *[Symbol.iterator]() {
    for (const item of this.items) {
      yield item
    }
  }
}
