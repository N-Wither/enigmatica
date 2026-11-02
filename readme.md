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

Put contents in `contents`, types are defined in `core/types.ts`.

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
  for an unlocked contact. Start buttons are disabled while a dialogue is active.
- `startDialogue(id)`: reject locked characters, completed nonrepeatable
  dialogues, and attempts to replace an active dialogue.
- `advanceDialogue()`: advance a message; a terminal message completes only
  when the player continues.
- `getDialogueOptions()`: calculate `normal`, `disable`, or `remove`
  presentation. `chooseDialogueOption(id)` checks the condition again.
- `submitDialogueInput(content)`: return `{ accepted, matched, node }`.
  Blank input is rejected. Trimmed, case-insensitive input matches the first
  gate containing any nonempty keyword. An unmatched input follows `next`
  when present, otherwise stays active for retry. Without gates, submission
  follows `next` or completes. `matched` means a gate matched, not merely
  that the input was accepted. Invalid targets throw before recording a response
  or applying option effects.
- `endDialogue()`: abort without marking completed; restarting is allowed.

Node effects execute once on each actual entry (including revisits); option
effects execute only on a successful choice. Use `message`, `choice`, `input`,
and `router` nodes; no separate end node is required. Omit a message's `next` to
finish after acknowledgement. A choice's destinations belong to its options.
Omitting a node's `type` defaults to `message`; the engine normalizes a copy
of its content, including engine-local dialogues. Other node types must be
explicit. Unknown explicit types do not fall back to messages.
`repeatable` defaults to false.

A `router` immediately chooses a destination from `targets` using relative
random weights, without showing a bubble or adding a transcript entry:

```json
{
  "type": "router",
  "targets": ["common", { "id": "rare", "weight": 0.25 }]
}
```

String targets and objects without `weight` use weight 1. Zero excludes a
target; weights must be finite nonnegative numbers. Empty/all-zero targets or
unknown destination IDs throw an error naming the dialogue and router; `next`
is not a fallback. Each encountered router validates all of its destinations.
The chosen chain is validated before recording a response or executing effects,
so a route error leaves game state unchanged. Successful router effects execute
once per entry, in path order, followed by the final node's effects. At most 100
consecutive automatic jumps are allowed per transition.

Messages whose speaker's character has the exact `player` tag align to the
right, with the avatar on the right and the name right-aligned. Untagged or
unknown speakers remain on the left. This applies to historical and current
messages; the contact owning the dialogue does not determine alignment.

Choice options and input nodes accept `as: "character-id"` to specify the
speaker of the selected option or submitted reply. If omitted, the first
character with the exact `player` tag in content order is used, regardless of
whether that character is unlocked as a contact (`getPlayerCharacter()`).
Responses use the same name, default avatar, and alignment as message nodes.
Explicit unknown IDs display as the speaker name without an avatar. If both
`as` and a default player are absent, the existing plain response bubble is
used. Choice text is localized; submitted input is always displayed literally,
including text beginning with `translate:`. Accepted retry inputs remain in
order. These are presentation-only message nodes: they add no acknowledgement
button, do not execute effects, and retain the existing saved history format.

`state.chatHistory[characterId]` is an ordered transcript. Entries contain
`dialogueId`, node `id`, and `kind`: `message`, `choice` (with
`optionId`), or `input` (with `userInput`). Repeated visits and accepted
unsuccessful inputs are retained. History has no controls and never runs effects.
Content definitions must remain available to render past messages and choices.

Save `engine.state` and pass it as the constructor's second argument to restore
progress without replaying entry effects. Dialogue state and history are detached
from snapshots. Old saves without history restore an empty transcript; earlier
branches are not reconstructed. Restoring a settled node does not reroll routes
or replay entry effects. A legacy save paused at a router continues routing,
skipping that saved router's already-applied effects while applying newly
entered nodes' effects. Automatic persistence is left to the game.

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

Desktop windows support title-bar dragging, raising, and closing. Below 1024px
or in portrait orientation, they become independently collapsible list entries,
and chat starts closed in a modal drawer. Desktop chat starts expanded. Chat
preferences, window positions, and open/folded states are kept in memory only.
Chat opens and closes over 200ms with ease-in-out timing: desktop columns resize
together, while the compact drawer slides with a fading backdrop. Closing waits
for the exit animation before closing the native dialog. Rapid reversals cancel
previous animations, and resizing settles immediately in the new layout.
Reduced-motion preferences disable these animations. Escape and backdrop
closing preserve modal focus behavior and return focus to the toggle.
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

Every `.ts` file in `src` becomes a `.js` file at the same relative path.
Other files are copied unchanged, including empty directories. Both commands
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


