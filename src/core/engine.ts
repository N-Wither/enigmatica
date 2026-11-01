import { items } from '../contents/contents'
import { ObjectUtils } from '../custom/util/object'
import type { ChatHistoryEntry, DialogueInputResult } from './dialogue'
import { Inventory } from './inventory'
import { Item } from './item'
import type { CalculatedDialogChoiceOption, Character, Condition, Dialogue, DialogueNode, Effect, GameEvent, StartedDialogueInfo } from './types'

export interface GameContent {
  characters?: Character[]
  dialogues?: Dialogue[]
  items?: Item.Metadata[]
  events?: GameEvent[]
}

export interface GameAction {
  name: string
  target?: string
  details?: Record<string, unknown>
}

export interface GameState {
  flags: Record<string, boolean>
  variables: Record<string, number | string>
  unlockedItems: string[]
  unlockedCharacters: string[]
  discoveredClues: string[]
  completedEvents: string[]
  dialogue: StartedDialogueInfo | null
  inventory: Item.Instance[]
  completedDialogues: StartedDialogueInfo[]
  chatHistory: Record<string, ChatHistoryEntry[]>
}

export type CustomMethod = (engine: GameEngine, ...args: unknown[]) => unknown

/** Owns game state; content and UI can communicate through actions and effects. */
export class GameEngine {
  readonly #characters: Map<string, Character>
  readonly #items: Map<string, Item.Metadata>
  readonly #dialogues: Map<string, Dialogue>
  readonly #events: Map<string, GameEvent>
  readonly #flags: Record<string, boolean>
  readonly #variables: Record<string, number | string>
  readonly #unlockedItems: Set<string>
  readonly #unlockedCharacters: Set<string>
  readonly #discoveredClues: Set<string>
  readonly #completedEvents: Set<string>
  readonly #listeners = new Set<(state: GameState) => void>()
  readonly #firedEvents = new Set<string>()
  readonly #inventory = new Inventory()
  readonly #completedDialogues: StartedDialogueInfo[]
  readonly #chatHistory: Record<string, ChatHistoryEntry[]>
  readonly #customMethods = new Map<string, CustomMethod>
  #dialogue: GameState['dialogue']
  #action?: GameAction
  #changed = false
  #updating = false

  constructor(content: GameContent = {}, initialState: Partial<GameState> = {}) {
    this.#characters = this.#index(content.characters ?? [])
    this.#items = this.#index(content.items ?? [])
    this.#dialogues = this.#index(content.dialogues ?? [])
    this.#events = this.#index(content.events ?? [])
    this.#flags = Object.assign(Object.create(null), initialState.flags)
    this.#variables = Object.assign(Object.create(null), initialState.variables)
    this.#unlockedItems = new Set(initialState.unlockedItems)
    this.#unlockedCharacters = new Set(initialState.unlockedCharacters)
    this.#discoveredClues = new Set(initialState.discoveredClues)
    this.#completedEvents = new Set(initialState.completedEvents)
    this.#dialogue = initialState.dialogue ? { ...structuredClone(initialState.dialogue), done: false } : null
    this.#inventory.add(...(initialState.inventory?.map(Item.from) ?? []))
    this.#inventory.subscribe(() => {
      if (this.#updating) this.#changed = true
      else this.#update(() => { this.#changed = true })
    })
    this.#completedDialogues = structuredClone(initialState.completedDialogues ?? [])
    this.#chatHistory = Object.assign(Object.create(null), structuredClone(initialState.chatHistory ?? {}))
    if (this.#dialogue) this.getCurrentDialogueNode()
    this.#update(() => { this.#changed = true })
  }

  /** Returns a detached snapshot suitable for saving or rendering. */
  get state(): GameState {
    return {
      flags: { ...this.#flags },
      variables: { ...this.#variables },
      unlockedItems: [...this.#unlockedItems],
      unlockedCharacters: [...this.#unlockedCharacters],
      discoveredClues: [...this.#discoveredClues],
      completedEvents: [...this.#completedEvents],
      dialogue: structuredClone(this.#dialogue),
      inventory: [...this.#inventory.toPlainArray()],
      completedDialogues: structuredClone(this.#completedDialogues),
      chatHistory: structuredClone(this.#chatHistory)
    }
  }

  get inventory() {
    return this.#inventory
  }

  subscribe(listener: (state: GameState) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  getAvailableItems(): Item.Metadata[] {
    return [...this.#items.values()].filter(item => this.#unlockedItems.has(item.id))
  }

  getAvailableCharacters(): Character[] {
    return [...this.#characters.values()].filter(character => this.#unlockedCharacters.has(character.id))
  }

  getCharacter(id: string): Character | undefined { return this.#characters.get(id) }

  getDialogue(id: string): Dialogue | undefined { return this.#dialogues.get(id) }

  getAvailableDialogues(characterId: string): Dialogue[] {
    if (!this.#unlockedCharacters.has(characterId)) return []
    return [...this.#dialogues.values()].filter(dialogue => dialogue.characterId === characterId &&
      (dialogue.repeatable === true || !this.#completedDialogues.some(run => run.id === dialogue.id && run.done)))
  }

  getDialogueOptions(): CalculatedDialogChoiceOption[] {
    const node = this.getCurrentDialogueNode()
    if (node?.type !== 'choice') return []
    return node.options.map(option => ({ ...option, show: !option.condition || this.checkCondition(option.condition)
      ? 'normal' : option.ifConditionNotMet ?? 'disable' }))
  }

  checkCondition(condition: Condition, action = this.#action): boolean {
    switch (condition.type) {
      case 'flag': return (this.#flags[condition.id] ?? false) === condition.value
      case 'event': return this.#completedEvents.has(condition.id) === condition.completed
      case 'itemUnlocked': return this.#unlockedItems.has(condition.id) === condition.unlocked
      case 'itemCount': {
        let arr = Array.from(this.#inventory).filter((i) => i.id == condition.id)
        if (condition.state != undefined) {
          arr = arr.filter((i) => ObjectUtils.partialSame( i.state, condition.state))
        }
        let count = 0
        arr.forEach((i) => {
          count += i.count
        })
        switch (condition.op) {
          case '>=': return count >= condition.value
          case '>': return count > condition.value
          case '==': return count == condition.value
          case '<': return count < condition.value
          case '<=': return count <= condition.value
          case '!=': return count != condition.value
        }
      }
      case 'action': return action?.name === condition.name && (condition.target === undefined || action.target === condition.target)
      case 'all': return condition.conditions.every(value => this.checkCondition(value, action))
      case 'any': return condition.conditions.some(value => this.checkCondition(value, action))
      case 'not': return !this.checkCondition(condition.condition, action)
      case 'variable': {
        const value = this.#variables[condition.id]
        // Missing values and mixed types must not pass through JS coercion.
        if (value === undefined || typeof value !== typeof condition.value) return false
        switch (condition.op) {
          case '==': return value === condition.value
          case '!=': return value !== condition.value
          case '>=': return value >= condition.value
          case '>': return value > condition.value
          case '<': return value < condition.value
          case '<=': return value <= condition.value
        }
      }
    }
  }

  dispatchAction(action: GameAction): void {
    this.#update(() => {}, action)
  }

  applyEffects(effects: readonly Effect[]): void {
    this.#update(() => this.#applyEffects(effects))
  }

  get customMethods() {
    return this.#customMethods
  }

  /** Explicit triggers also honour conditions and the event's once setting. */
  triggerEvent(id: string): boolean {
    let triggered = false
    this.#update(() => { triggered = this.#fireEvent(id) })
    return triggered
  }

  getCurrentDialogueNode(): DialogueNode | null {
    if (!this.#dialogue) return null
    return this.#getDialogueNode(this.#dialogue.id, this.#dialogue.currentNode)
  }

  startDialogue(id: string): DialogueNode | null {
    const dialogue = this.#dialogues.get(id)
    if (!dialogue) throw new Error(`Unknown dialogue: ${id}`)
    if (this.#dialogue) throw new Error('A dialogue is already active')
    if (!this.#characters.has(dialogue.characterId) || !this.#unlockedCharacters.has(dialogue.characterId)) {
      throw new Error('Dialogue character is locked or unknown: ' + dialogue.characterId)
    }
    if (!this.getAvailableDialogues(dialogue.characterId).some(value => value.id === id)) {
      throw new Error('Dialogue is already completed: ' + id)
    }
    this.#getDialogueNode(id, dialogue.startNode)
    this.#update(() => this.#enterDialogueNode(id, dialogue.startNode))
    return this.getCurrentDialogueNode()
  }

  advanceDialogue(): DialogueNode | null {
    const current = this.#dialogue
    const node = this.getCurrentDialogueNode()
    if (!current || !node) return null
    if (node.type !== 'message') throw new Error('Choose a dialogue option before advancing')
    if (node.next !== undefined) this.#getDialogueNode(current.id, node.next)
    this.#update(() => {
      if (node.next !== undefined) this.#enterDialogueNode(current.id, node.next)
      else this.#endDialogue(true)
    })
    return this.getCurrentDialogueNode()
  }

  chooseDialogueOption(id: string): DialogueNode | null {
    const current = this.#dialogue
    const node = this.getCurrentDialogueNode()
    if (!current || node?.type !== 'choice') throw new Error('No dialogue choice is active')
    const option = node.options.find(value => value.id === id)
    if (!option) throw new Error(`Unknown dialogue option: ${id}`)
    if (option.condition && !this.checkCondition(option.condition)) throw new Error(`Dialogue option is unavailable: ${id}`)
    this.#getDialogueNode(current.id, option.next)
    this.#update(() => {
      this.#record({ dialogueId: current.id, id: current.currentNode, kind: 'choice', optionId: id })
      ;(current.chosenOptions ??= []).push(id)
      this.#applyEffects(option.effects ?? [])
      this.#enterDialogueNode(current.id, option.next)
    })
    return this.getCurrentDialogueNode()
  }

  submitDialogueInput(content: string): DialogueInputResult {
    const current = this.#dialogue
    const node = this.getCurrentDialogueNode()
    if (!current || node?.type !== 'input') throw new Error('No dialogue input is active')
    const text = content.trim()
    if (!text) return { accepted: false, matched: false, node }
    const normalized = text.toLowerCase()
    const gate = node.gates?.find(gate => gate.keywords.some(keyword => {
      const key = keyword.trim().toLowerCase()
      return key.length > 0 && normalized.includes(key)
    }))
    const target = gate?.target ?? node.next
    if (target !== undefined) this.#getDialogueNode(current.id, target)
    this.#update(() => {
      this.#record({ dialogueId: current.id, id: current.currentNode, kind: 'input', userInput: text })
      if (target !== undefined) this.#enterDialogueNode(current.id, target)
      else if (!node.gates?.length) this.#endDialogue(true)
    })
    return { accepted: true, matched: gate !== undefined, node: this.getCurrentDialogueNode() }
  }

  /** Abort the active run without marking it completed. */
  endDialogue(): void {
    this.#update(() => this.#endDialogue())
  }

  #index<T extends { id: string }>(values: T[]): Map<string, T> {
    const result = new Map<string, T>()
    for (const value of values) {
      if (!value.id || result.has(value.id)) throw new Error(`Missing or duplicate content id: ${value.id}`)
      result.set(value.id, value)
    }
    return result
  }

  #update(operation: () => void, action?: GameAction): void {
    this.#changed = false
    this.#updating = true
    this.#action = action
    try {
      operation()
      this.#settle()
    } finally {
      this.#updating = false
      this.#action = undefined
      this.#firedEvents.clear()
    }
    if (this.#changed) {
      this.#changed = false
      for (const listener of [...this.#listeners]) listener(this.state)
    }
  }

  #settle(): void {
    // Revisit earlier conditions when later effects unlock new content. Each
    // event can fire only once per update, including repeatable/cyclic events.
    let progressed: boolean
    do {
      progressed = false
      for (const item of this.#items.values()) {
        if (!this.#unlockedItems.has(item.id) && (!item.unlockableWhen || this.checkCondition(item.unlockableWhen))) {
          this.#add(this.#unlockedItems, item.id)
          progressed = true
        }
      }
      for (const event of this.#events.values()) {
        const matches = event.trigger.type === 'stateChange'
          ? this.#changed
          : event.trigger.type === 'action' && this.#action !== undefined && (event.trigger.action === undefined || event.trigger.action === this.#action.name)
        if (matches && this.#fireEvent(event.id)) progressed = true
      }
    } while (progressed)
  }

  #fireEvent(id: string): boolean {
    const event = this.#events.get(id)
    if (!event) throw new Error(`Unknown event: ${id}`)
    if (this.#firedEvents.has(id) || (event.once && this.#completedEvents.has(id))) return false
    if (event.condition && !this.checkCondition(event.condition)) return false
    this.#firedEvents.add(id)
    this.#add(this.#completedEvents, id)
    this.#applyEffects(event.effects)
    return true
  }

  #applyEffects(effects: readonly Effect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'setFlag':
          if (this.#flags[effect.id] !== effect.value) {
            this.#flags[effect.id] = effect.value
            this.#changed = true
          }
          break
        case 'setVariable':
          if (this.#variables[effect.id] !== effect.value) {
            this.#variables[effect.id] = effect.value
            this.#changed = true
          }
          break
        case 'unlockItem': this.#add(this.#unlockedItems, effect.id); break
        case 'unlockCharacter': this.#add(this.#unlockedCharacters, effect.id); break
        case 'discoverClue': this.#add(this.#discoveredClues, effect.id); break
        case 'triggerEvent': this.#fireEvent(effect.id); break
        case 'giveItem': {
          if (items.find((i) => i.id == effect.id) == undefined) {
            console.warn(`Unknown item: "${effect.id}"`)
            break
          }
          if (this.#unlockedItems.has(effect.id) == false) {
            console.warn(`The item with id "${effect.id}" is not unlocked.`)
            break
          }
          const item = Item.of(effect.id, effect.count ?? 1, effect.state)
          this.#inventory.add(item)
          break
        }
        case 'custom': {
          const args = effect.args ?? []
          const method = this.#customMethods.get(effect.method)
          method ? method(this, ...args) : console.warn(`Unknown custom effect method "${effect.method}".`)
        }
      }
    }
  }

  #add(values: Set<string>, id: string): void {
    if (values.has(id)) return
    values.add(id)
    this.#changed = true
  }

  #getDialogueNode(dialogueId: string, nodeId: string): DialogueNode {
    const node = this.#dialogues.get(dialogueId)?.nodes[nodeId]
    if (!node) throw new Error(`Unknown dialogue node: ${dialogueId}/${nodeId}`)
    return node
  }

  #record(entry: ChatHistoryEntry): void {
    const characterId = this.#dialogues.get(entry.dialogueId)!.characterId
    ;(this.#chatHistory[characterId] ??= []).push(entry)
    this.#changed = true
  }

  #enterDialogueNode(dialogueId: string, nodeId: string): void {
    const node = this.#getDialogueNode(dialogueId, nodeId)
    const chosenOptions = this.#dialogue?.chosenOptions ?? []
    this.#dialogue = { id: dialogueId, currentNode: nodeId, done: false, chosenOptions }
    this.#changed = true
    if (node.type === 'message') this.#record({ dialogueId, id: nodeId, kind: 'message' })
    this.#applyEffects(node.effects ?? [])
  }

  #endDialogue(completed = false): void {
    if (!this.#dialogue) return
    if (completed) this.#completedDialogues.push({ ...structuredClone(this.#dialogue), done: true })
    this.#dialogue = null
    this.#changed = true
  }
}
