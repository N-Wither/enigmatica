import { GameEngine } from './core/engine'
import { type EnigmaticaGameElement } from './components/enigmatica-game'
import { characters, dialogues, items, events} from './contents/contents'
import type { EgChatElement } from './components/game/chat'
import { handleGameStateChange } from './custom/state-change-handler'

const engine = new GameEngine(
  {
    characters,
    events,
    items,
    dialogues,
  },
  {
    unlockedItems: ['notepad'],
    unlockedCharacters: ['aac', 'ela'],
    inventory: [
      {id: 'notepad', count: 1},
      {id: 'docfile', count: 1, state: { content: 'translate:content.demo_docfile_1' }},
    ]
  },
)

const gameApp = document.querySelector('enigmatica-game') as EnigmaticaGameElement

if (gameApp == null) throw new TypeError('Game app element not found.')

gameApp.engine = engine
const chat = gameApp.querySelector<EgChatElement>('eg-chat')
if (chat) chat.engine = engine

gameApp.addEventListener('game-state-change', (e) => {
  if (e instanceof CustomEvent == false) return
  handleGameStateChange(gameApp)
})