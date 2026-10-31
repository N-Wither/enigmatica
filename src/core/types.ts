import { Item } from "./item";

export interface Character {
  id: string
  name: string
  tags?: string[]
  description?: string
  avatars?: {
    default: string
    [emotion: string]: string
  }
}

type Operator = '>=' | '>' | '==' | '<' | '<=' | '!='

export type Condition =
  | { type: 'flag'; id: string; value: boolean }
  | { type: 'event'; id: string; completed: boolean }
  | { type: 'itemUnlocked'; id: string; unlocked: boolean }
  | { type: 'itemCount'; id: string; op: Operator; value: number; state?: Item.State}
  | {
      type: 'variable'
      id: string
      op: Operator
      value: number | string
    }
  | { type: 'action'; name: string; target?: string }
  | { type: 'all'; conditions: Condition[] }
  | { type: 'any'; conditions: Condition[] }
  | { type: 'not'; condition: Condition }

export type Effect =
  | { type: 'setFlag'; id: string; value: boolean }
  | { type: 'setVariable'; id: string; value: number | string }
  | { type: 'unlockItem'; id: string }
  | { type: 'unlockCharacter'; id: string }
  | { type: 'discoverClue'; id: string }
  | { type: 'triggerEvent'; id: string }
  | { type: 'giveItem', id: string, count?: number, state?: Record<string, unknown>}
  | { 
    type: 'custom',
    method: string,
    /** 
     * The game engine will automatically be the first argument.
     * @example ```
     * { type: 'custom', method: 'myMethod', args: [1, 2]} // Your custom effect
     * myMethod(engine, 1, 2) // Actual call in game engine
     * ```
     */
    args?: unknown[]
  }

export interface Dialogue {
  id: string
  characterId: string
  startNode: string
  nodes: Record<string, DialogueNode>
  /** Default: `false` */
  repeatable?: boolean
}
type DialogueNodeType = 'message' | 'choice' | 'input'
interface BasicDialogueNode<T extends DialogueNodeType> {
  type: T
  next?: string
  effects?: Effect[]
}
interface DialogueChoiceOption {
  id: string
  text: string
  next: string
  condition?: Condition
  /** Determines how to show this option when condition not met, default to `disable`. */
  ifConditionNotMet?: 'remove' | 'disable'
  effects?: Effect[]
}
export interface CalculatedDialogChoiceOption extends DialogueChoiceOption {
  show: 'remove' | 'disable' | 'normal'
}
export interface StartedDialogueInfo {
  id: string
  done: boolean
  currentNode: string
  chosenOptions?: string[]
}

export interface MessageDialogNode extends BasicDialogueNode<'message'> {
  speaker: string
  /** Defines which avatar to show, if omitted, use the default avatar. */
  emotion?: string
  text: string
  /** If omitted, this node will be treated as the final node. */
  next?: string
}

export interface ChoiceDialogNode extends BasicDialogueNode<'choice'> {
  options: DialogueChoiceOption[]
}

export interface InputDialogNode extends BasicDialogueNode<'input'> {
  /** The placeholder of input box. */
  placeholder?: string
  /** The default value of input box. */
  value?: string
  /** If user input matches the keywords, jump to a node. */
  gates?: {
    keywords: string[]
    target: string
  }[]
}

export type DialogueNode = MessageDialogNode | ChoiceDialogNode | InputDialogNode

export interface GameEvent {
  id: string
  trigger: {
    type: 'stateChange' | 'action' | 'manual'
    action?: string
  }
  condition?: Condition
  effects: Effect[]
  once: boolean
}
