import { dialogues } from '../contents/contents'
import { DialogueNode } from './types'

/** An actual visit or response, ordered within a character's transcript. */
export interface ChatHistoryEntry {
  dialogueId: string
  id: string
  kind: 'message' | 'choice' | 'input'
  optionId?: string
  userInput?: string
}

export interface DialogueInputResult {
  accepted: boolean
  matched: boolean
  node: DialogueNode | null
}

/** Legacy helper for the bundled game content. Prefer engine.getDialogue for custom content. */
export namespace DialogueUtils {
  export function getNodeFrom(dialogueId: string, nodeId: string) {
    return dialogues.find(dialogue => dialogue.id === dialogueId)?.nodes[nodeId]
  }
}
