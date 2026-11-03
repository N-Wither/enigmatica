import { GameEngine } from './core/engine'
import { type EnigmaticaGameElement } from './components/enigmatica-game'
import { characters, dialogues, items, events} from './contents/contents'

const engine = new GameEngine(
  {
    characters,
    events,
    items,
    dialogues,
  },
  {
    unlockedItems: ['notepad'],
    unlockedCharacters: ['aac'],
    inventory: [
      {id: 'notepad', count: 1},
      {id: 'docfile', count: 1, state: { content: 'translate:content.demo_docfile_1' }},
      {id: 'docfile', count: 1, state: { content: 'translate:content.demo_docfile_2' }},
    ]
  },
)

const gameApp = document.querySelector('enigmatica-game') as EnigmaticaGameElement

if (gameApp == null) throw new TypeError('Game app element not found.')

gameApp.engine = engine
