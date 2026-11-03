# Enigmatica

A framework for web narrative puzzle games.

Without explicit declaration, the paths shown below are relative to `src`.

## Concepts

Game cycle:
1. Contact with characters
2. Find keywords/evidence in dialogues
3. Unlock new items from characters or searching
4. Interact with items, trigger new events
5. Game state changes, unlock new contents
6. Reveal the truth step by step

## Managing Contents

Author generated content in `generator/<category>/*.ts` or `*.js`. Each script
must default-export one record (including a Builder) or an array of records.
Scripts in the same directory merge in relative-path dictionary order; array
order is preserved. Subdirectories generate independently. Output keeps the
relative directory and uses its final directory name plus `s.json`:
`generator/dialogue/dialogue_1.ts` and `dialogue_2.ts` both produce
`contents/dialogue/dialogues.json`. The `item` directory instead produces
`metadata.json`.

Run `npm run generate-contents` separately, or let `dev` and `build` generate
automatically. Commit generated JSON alongside its source scripts; edit the
scripts for subsequent changes. Unchanged JSON is not rewritten. Compilation,
execution, invalid exports, serialization errors, and duplicate IDs within an
output stop generation before any JSON is replaced. Handwritten contents are
preserved. Removing the last script in a directory does not delete its old JSON;
remove obsolete generated files explicitly.

Do not place entry scripts directly in `generator`. Every `.js`/`.ts` file
there is an entry; `.d.ts` files are ignored. Put shared helper modules outside
this tree. Import the pure `ContentMaker` module directly so generation works
without pre-existing JSON:

```ts
import { ContentMaker as C } from '../../core/content-maker'

export default C.dialogue('arrival')
  .setName('Arrival')
  .setCharacter('guide')
  .setStartNode('hello')
  .setCondition({ type: 'flag', id: 'arrived', value: true })
  .setAutoStart(true)
  .setAutoAdvance(2)
  .addNode('hello', C.message('guide', 'Welcome.').setNext('reply'))
  .addNode('reply', C.choice()
    .addOption(C.option('go', 'Continue', 'end').setAs('player')))
  .addNode('end', C.message('guide', 'Good luck.'))
```

Dialogue builders also offer `setRepeatable`; all retain `toJson()` and support
standard `toJSON()`, so explicit conversion is optional. `addNode` accepts
both typed node objects and builders. All node builders offer `setNext` and
`addEffect(...effects)`. Additional factories and methods:

- `message(speaker, text)`: `setEmotion`.
- `choice()`: `addOption(option)`.
- `option(id, text, next)`: `setAs`, `setCondition`,
  `setIfConditionNotMet('remove' | 'disable')`, `addEffect`.
- `input()`: `setPlaceholder`, `setValue`, `setAs`,
  `addGate(keywords, target)`.
- `router()`: `addTarget(id, weight?)`; omitted weight defaults to one.

The two files in `generator/dialogue` demonstrate all four node kinds.
`ContentMaker` remains re-exported from `contents/contents.ts` for existing callers.

**NOTE:** Items (common items, files etc.) are defined in various files, `contents/item/metadata.json` contains the item info for basic game logic, while some item has own component element because they may be interactive, these logic cannot be simply defined by `json` files. Item contents are wrapped in `GameItemElement` (found in `components/game-item.ts`), you can extend this class to create your own item component element.

## Assets

It's recommended to put all assets (images, music...) in `assets`. You can use `AssetManager` to convert asset path (relative to `assets`) to full url.

## Customize Game Logic

`main.ts` contains main logic of your game. You can edit it to customize your game logic.

Extract your custom fuctions to `custom` to make `main.ts` short and clean.

## Localization

Like Minecraft, put language jsons in `lang`. When game finds a string starting with `translate:` in game contents, it will try to find corresponding translation in your language file.

Check out how it works in `custom/translate.ts`.

## Dialogue API

**This section is written by ChatGPT**

Attach a game engine to `eg-chat.engine`. The chat subscribes while connected,
shows unlocked contacts, and lets the player start an available dialogue. Only
one dialogue can run at a time; switching contacts preserves its progress.

- `getCharacter(id)`, `getDialogue(id)`: look up content in this engine.
- `getAvailableDialogues(characterId)`: list uncompleted or repeatable dialogues
  for an unlocked contact whose start conditions currently pass. Start buttons are
  disabled while a dialogue is active.
- `startDialogue(id)`: reject locked characters, completed nonrepeatable
  dialogues, unmet start conditions, and attempts to replace an active dialogue.
- `advanceDialogue()`: advance a message; a terminal message completes only
  when acknowledged manually or by automatic advancement.
- `getDialogueOptions()`: calculate `normal`, `disable`, or `remove`
  presentation. `chooseDialogueOption(id)` checks the condition again.
- `submitDialogueInput(content)`: return `{ accepted, matched, node }`.
  Blank input is rejected. Trimmed, case-insensitive input matches the first
  gate containing any nonempty keyword. Keywords starting with `translate:` are
  resolved in the current language before matching; missing translations use the
  key without that prefix. Translation results are trimmed and matched without
  case sensitivity; blank keywords never match. An unmatched input follows `next`
  when present, otherwise stays active for retry. Without gates, submission
  follows `next` or completes. `matched` means a gate matched, not merely
  that the input was accepted. Invalid targets throw before recording a response
  or applying option effects.
- `endDialogue()`: abort without marking completed; restarting is allowed.

Node effects execute once on each actual entry (including revisits); option
effects execute only on a successful choice. Use `message`, `choice`, and
`input` nodes, plus automatic `router` nodes; no separate end node is required. Omit a message's `next` to
finish after acknowledgement. A choice's destinations belong to its options.
`repeatable` defaults to false. A dialogue's `condition` is checked only when
starting; later changes do not interrupt an active run.

`autoStart` defaults to false. Eligible unlocked contacts are checked after
initialization and settled game updates; the first eligible dialogue in content
order starts when no dialogue is active. Each satisfied-condition period permits
one start, including manual starts. The condition must become false before it
can automatically trigger again; unconditional repeatable dialogues auto-start
only once. Busy conversations are not replaced, and expired action conditions
are not queued. `state.autoStartConsumed` persists this behavior across saves;
older saves without the field remain supported.

A finite positive `autoAdvance` specifies seconds between message advances,
including terminal acknowledgement. Choice and input nodes wait for the player;
routers resolve immediately. Continue advances immediately and resets the next
message's interval. Switching contacts and collapsing chat do not pause timers
or force another contact open. Disconnecting chat clears its timer; reconnecting
waits a full interval. Replacing its engine also clears old timers. Automatic
advance errors appear in chat feedback and do not repeatedly retry that node.

`state.chatHistory[characterId]` is an ordered transcript. Entries contain
`dialogueId`, node `id`, and `kind`: `message`, `choice` (with
`optionId`), or `input` (with `userInput`). Repeated visits and accepted
unsuccessful inputs are retained. History has no controls and never runs effects.
Content definitions must remain available to render past messages and choices.

Save `engine.state` and pass it as the constructor's second argument to restore
progress without replaying entry effects. Dialogue state and history are detached
from snapshots. Old saves without history restore an empty transcript; earlier
branches are not reconstructed. Automatic persistence is left to the game.

## Game layout and workspace

The shell connects its direct `eg-chat`, `eg-worktable`, and `eg-inventory`
children to `enigmatica-game.engine`. Give them the corresponding named slots:

```html
<enigmatica-game>
  <eg-chat slot="chat"></eg-chat>
  <eg-worktable slot="worktable"></eg-worktable>
  <eg-inventory slot="inventory"></eg-inventory>
</enigmatica-game>
```

Import the shell module to register the workspace and inventory; import the chat
and individual item modules as in `index.html`. Standalone workspace/inventory
components accept an `engine` property too and manage their own subscriptions.

Inventory buttons toggle the actual `Item.ItemInstance` in the worktable. Items
without an element remain listed but cannot be opened. Items start hidden,
including newly acquired ones. Opened items retain their element and local DOM
state when hidden, folded, or switched between desktop and compact layouts.
The worktable exposes `toggleItem(item)`, `hideItem(item)`, and readonly
`openItems`. The inventory accepts `openItems` to indicate selected buttons.

`inventory-item-toggle` carries `{ item }`; `worktable-change` carries
`{ openItems }`. Both events bubble and cross Shadow DOM boundaries. The shell
connects these events automatically. Item actions also cross Shadow DOM and
default their target to the owning inventory instance's ID. UI visibility does
not dispatch game actions or enter saved game state.

Item components should update their properties before calling `emit(name, details?)`.
The shell passes the owning inventory instance to `dispatchAction(action, sourceItem?)`;
the engine calls `syncStateFromElement()` before checking event conditions, within
one update and notification. Only keys already declared in the instance's
`state` (from `defaultState`, initial state, or `setState`) are read back.
State values are copied so nested element properties and saved snapshots remain
independent. Explicit action targets do not change which instance is synchronized.
The notepad emits `content-change` on textarea change, and restores its content
from saved state. Use `setState` for programmatic property changes.

Desktop windows support title-bar dragging, raising, and closing. Below 1024px
or in portrait orientation, they become independently collapsible list entries,
and chat starts closed in a modal drawer. Desktop chat starts expanded. Chat
preferences, window positions, and open/folded states are kept in memory only.
Inventory `add`/`remove` mutations notify the engine and refresh connected views;
direct edits to the underlying `items` Set bypass this notification mechanism.

## Build & Deploy

**This section is written by ChatGPT**

Requires Node.js 20 or newer. Install dependencies with `npm install`.

Start the local test server:
```shell
npm test
# or: npm run dev
```

Open `http://127.0.0.1:3000`. The server compiles into `dev`, watches all of
`src` (including static assets and added/deleted files), and reloads connected
browser pages after a successful rebuild. Stop it with Ctrl+C. Set the `PORT`
environment variable to use another port (PowerShell: `$env:PORT=3001; npm test`).
If compilation fails, the server reports the error and retries on the next edit.

Run build script:
```shell
npm run build
```

Before compiling, content generators run automatically. Every `.ts` file in `src`
outside `generator` becomes a `.js` file at the same relative path. The entire
`src/generator` tree is excluded from both `dev` and `dist`.
Other files outside that tree are copied unchanged, including empty directories. Both commands
clean their output directory to remove stale files. Browser dependencies are
bundled into shared modules under `_chunks`; development builds include inline
source maps and production builds are minified. HTML module script URLs should
refer to the generated `.js` files. Compilation does not perform TypeScript type
checking.

Deploy the `dist` directory to your server. No npm dependencies are required on
the server.

Run automated logic and build/server checks:
```shell
npm run test:unit
```

These checks rebuild `dev` and `dist`; stop the development server before running them.

Run real-browser workspace, responsive layout, pointer, and modal-focus checks:
```shell
npm run test:browser
```

This optional check requires Node.js 22+ and an installed Chromium, Chrome, or
Edge. It uses a temporary browser profile and automatically detects common
installation paths; set `BROWSER_PATH` to override the executable. It starts and
stops its own local development server and does not download a browser.


