import type {
  ChoiceDialogNode, Condition, Dialogue, DialogueNode, Effect,
  InputDialogNode, MessageDialogNode, RouterDialogNode,
} from '../core/types'

type ChoiceOption = ChoiceDialogNode['options'][number]

/** Builders serialize as ordinary content records, with no runtime dependencies. */
class JsonBuilder<T> {
  toJSON(): T { return { ...this } as T }
  toJson(): T { return JSON.parse(JSON.stringify(this.toJSON())) }
}

class DialogueBuilder extends JsonBuilder<Dialogue> implements Dialogue {
  name = ''
  characterId = ''
  startNode = ''
  nodes: Record<string, DialogueNode> = {}
  repeatable = false
  autoStart = false
  autoAdvance?: number
  condition?: Condition

  constructor(public id: string) { super() }
  setName(value: string) { this.name = value; return this }
  setCharacter(id: string) { this.characterId = id; return this }
  setStartNode(id: string) { this.startNode = id; return this }
  setRepeatable(value: boolean) { this.repeatable = value; return this }
  setCondition(value: Condition) { this.condition = value; return this }
  setAutoStart(value: boolean) { this.autoStart = value; return this }
  setAutoAdvance(interval: number) { this.autoAdvance = interval; return this }
  addNode(id: string, node: DialogueNode) {
    this.nodes[id] = node instanceof JsonBuilder ? node.toJson() : structuredClone(node)
    return this
  }
}

abstract class NodeBuilder<T extends DialogueNode> extends JsonBuilder<T> {
  abstract readonly type: T['type']
  next?: string
  effects?: Effect[]
  setNext(id: string) { this.next = id; return this }
  addEffect(...effects: Effect[]) { (this.effects ??= []).push(...effects); return this }
}

class MessageNodeBuilder extends NodeBuilder<MessageDialogNode> implements MessageDialogNode {
  readonly type = 'message'
  emotion?: string
  constructor(public speaker: string, public text: string) { super() }
  setEmotion(value: string) { this.emotion = value; return this }
}

class ChoiceOptionBuilder extends JsonBuilder<ChoiceOption> implements ChoiceOption {
  as?: string
  condition?: Condition
  ifConditionNotMet?: 'remove' | 'disable'
  effects?: Effect[]
  constructor(public id: string, public text: string, public next: string) { super() }
  setAs(id: string) { this.as = id; return this }
  setCondition(value: Condition) { this.condition = value; return this }
  setIfConditionNotMet(value: 'remove' | 'disable') { this.ifConditionNotMet = value; return this }
  addEffect(...effects: Effect[]) { (this.effects ??= []).push(...effects); return this }
}

class ChoiceNodeBuilder extends NodeBuilder<ChoiceDialogNode> implements ChoiceDialogNode {
  readonly type = 'choice'
  options: ChoiceOption[] = []
  addOption(option: ChoiceOption) {
    this.options.push(option instanceof JsonBuilder ? option.toJson() : structuredClone(option))
    return this
  }
}

class InputNodeBuilder extends NodeBuilder<InputDialogNode> implements InputDialogNode {
  readonly type = 'input'
  placeholder?: string
  value?: string
  as?: string
  gates?: NonNullable<InputDialogNode['gates']>
  setPlaceholder(value: string) { this.placeholder = value; return this }
  setValue(value: string) { this.value = value; return this }
  setAs(id: string) { this.as = id; return this }
  addGate(keywords: string[], target: string) {
    (this.gates ??= []).push({ keywords: [...keywords], target })
    return this
  }
}

class RouterNodeBuilder extends NodeBuilder<RouterDialogNode> implements RouterDialogNode {
  readonly type = 'router'
  targets: RouterDialogNode['targets'] = []
  addTarget(id: string, weight?: number) {
    this.targets.push(weight === undefined ? id : { id, weight })
    return this
  }
}

export namespace ContentMaker {
  export function dialogue(id: string) { return new DialogueBuilder(id) }
  export function message(speaker: string, text: string) { return new MessageNodeBuilder(speaker, text) }
  export function choice() { return new ChoiceNodeBuilder() }
  export function option(id: string, text: string, next: string) { return new ChoiceOptionBuilder(id, text, next) }
  export function input() { return new InputNodeBuilder() }
  export function router() { return new RouterNodeBuilder() }
}
