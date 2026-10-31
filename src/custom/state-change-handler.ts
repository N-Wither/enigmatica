import type { EnigmaticaGameElement } from '../components/enigmatica-game'
import { Inventory } from '../core/inventory'
import { Item } from '../core/item'
import { translate } from './translate'
import { DomUtils } from './util/dom'

const inventory = DomUtils.$w('div', '#inventory')
const worktable = DomUtils.$w('div', '#worktable')

export function handleGameStateChange(app: EnigmaticaGameElement) {
  renderInventory(app.engine.inventory)
}

// WIP
function renderInventory(inv: Inventory) {
  inv.items.forEach((item) => {
    DomUtils.make('button', translate(Item.getName(item.id)))
      .appendTo(inventory)
      .class('inventory-item')

    item.element && worktable.append(item.element)
  })
}
