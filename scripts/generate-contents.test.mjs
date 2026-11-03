import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { generateContents } from './generate-contents.mjs'

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'enigmatica-generator-test-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('enigmatica-generator-test-'))
    await rm(directory, { recursive: true, force: true })
  })
  const generatorRoot = path.join(directory, 'generator')
  const contentsRoot = path.join(directory, 'contents')
  await mkdir(generatorRoot)
  await mkdir(contentsRoot)
  return {
    generatorRoot, contentsRoot,
    async write(filename, content) {
      const destination = path.join(directory, filename)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, content)
    },
    async read(filename) { return readFile(path.join(contentsRoot, filename), 'utf8') },
    async generate() { return generateContents({ generatorRoot, contentsRoot }) },
  }
}

test('generator merges JS/TS records and arrays in stable order with isolated nested output and item naming', async t => {
  const f = await fixture(t)
  await f.write('generator/dialogue/z.js', 'export default {id: "z"}')
  await f.write('generator/dialogue/a.ts', 'const id: string = "a"; export default [{id}, {id:"b"}]')
  await f.write('generator/dialogue/ignored.d.ts', 'not executable')
  await f.write('generator/dialogue/ignored.txt', 'not executable')
  await f.write('generator/dialogue/chapter/main.ts', 'export default {id:"nested"}')
  await f.write('generator/item/main.js', 'export default {id:"note"}')
  await f.write('contents/item/items.html', '<p>Keep me</p>')
  assert.equal((await f.generate()).length, 3)
  assert.deepEqual(JSON.parse(await f.read('dialogue/dialogues.json')), [{ id: 'a' }, { id: 'b' }, { id: 'z' }])
  assert.deepEqual(JSON.parse(await f.read('dialogue/chapter/chapters.json')), [{ id: 'nested' }])
  assert.deepEqual(JSON.parse(await f.read('item/metadata.json')), [{ id: 'note' }])
  assert.equal(await f.read('item/items.html'), '<p>Keep me</p>')
  const before = await stat(path.join(f.contentsRoot, 'dialogue/dialogues.json'))
  assert.deepEqual(await f.generate(), [])
  assert.equal((await stat(path.join(f.contentsRoot, 'dialogue/dialogues.json'))).mtimeMs, before.mtimeMs)
  await f.write('generator/dialogue/z.js', 'export default {id:"updated"}')
  assert.equal((await f.generate()).length, 1)
  assert.equal(JSON.parse(await f.read('dialogue/dialogues.json')).at(-1).id, 'updated')
  assert.deepEqual((await readdir(path.join(f.contentsRoot, 'dialogue'))).sort(), ['chapter', 'dialogues.json'])
})

test('all builders serialize without existing JSON and expose every dialogue/node/option property', async t => {
  const f = await fixture(t)
  const builderPath = fileURLToPath(new URL('../src/core/content-maker.ts', import.meta.url)).split(path.sep).join('/')
  await f.write('generator/dialogue/main.ts', [
    'import { ContentMaker as C } from ' + JSON.stringify(builderPath),
    "const flag = {type:'flag', id:'ready', value:true} as const",
    "const effect = {type:'setFlag', id:'visited', value:true} as const",
    "const dialogue = C.dialogue('built').setName('Built').setCharacter('guide').setStartNode('route')",
    '  .setRepeatable(true).setAutoStart(true).setAutoAdvance(2).setCondition(flag)',
    "  .addNode('route', C.router().addTarget('hello', 2).addTarget('hello').addEffect(effect))",
    "  .addNode('hello', C.message('guide', 'Hello').setEmotion('happy').setNext('choose').addEffect(effect))",
    "  .addNode('choose', C.choice().addOption(C.option('go', 'Go', 'ask').setAs('player')",
    "    .setCondition(flag).setIfConditionNotMet('remove').addEffect(effect)))",
    "  .addNode('ask', C.input().setPlaceholder('Answer').setValue('default').setAs('player')",
    "    .addGate(['yes'], 'end').setNext('hello').addEffect(effect))",
    "  .addNode('end', {speaker:'guide', text:'Done'})",
    "if (JSON.stringify(dialogue.toJson()) !== JSON.stringify(dialogue)) throw new Error('toJson mismatch')",
    'export default dialogue',
  ].join('\n'))
  await f.generate()
  const [d] = JSON.parse(await f.read('dialogue/dialogues.json'))
  assert.deepEqual([d.name, d.characterId, d.startNode, d.repeatable, d.autoStart, d.autoAdvance], ['Built', 'guide', 'route', true, true, 2])
  assert.equal(d.condition.id, 'ready')
  assert.deepEqual(d.nodes.route.targets, [{ id: 'hello', weight: 2 }, 'hello'])
  assert.equal(d.nodes.hello.type, 'message')
  assert.equal(d.nodes.hello.emotion, 'happy')
  assert.equal(d.nodes.hello.effects[0].id, 'visited')
  assert.deepEqual(d.nodes.choose.options[0], { id:'go', text:'Go', next:'ask', as:'player',
    condition:{type:'flag',id:'ready',value:true}, ifConditionNotMet:'remove',
    effects:[{type:'setFlag',id:'visited',value:true}] })
  assert.deepEqual(d.nodes.ask.gates, [{ keywords:['yes'], target:'end' }])
  assert.equal(d.nodes.ask.value, 'default')
  assert.equal(d.nodes.ask.placeholder, 'Answer')
  assert.equal(d.nodes.ask.as, 'player')
  assert.equal(d.nodes.ask.next, 'hello')
  assert.equal(d.nodes.end.text, 'Done')
})

test('duplicate IDs, compile/runtime errors and invalid exports preserve every previous output', async t => {
  const f = await fixture(t)
  const oldDialogue = '[{"id":"old"}]\n'
  const oldEvent = '[{"id":"old-event"}]\n'
  await f.write('contents/dialogue/dialogues.json', oldDialogue)
  await f.write('contents/event/events.json', oldEvent)
  await f.write('generator/event/a.ts', 'export default {id:"new-event"}')
  await f.write('generator/dialogue/a.ts', 'export default {id:"same"}')
  for (const [code, message] of [
    ['export default {id:"same"}', /Duplicate content id/],
    ['throw new Error("intentional"); export default []', /intentional/],
    ['export const value = 1', /Missing default export/],
    ['export default 42', /record/],
    ['export default [null]', /record/],
    ['export default {id:"big",value:1n}', /BigInt/],
    ['export default {', /./],
  ]) {
    await f.write('generator/dialogue/b.ts', code)
    await assert.rejects(f.generate(), error => error.message.includes('b.ts') && message.test(error.message))
    assert.equal(await f.read('dialogue/dialogues.json'), oldDialogue)
    assert.equal(await f.read('event/events.json'), oldEvent)
    assert.deepEqual(await readdir(path.join(f.contentsRoot, 'dialogue')), ['dialogues.json'])
  }
})

test('generator rejects root entries, and missing/empty directories generate nothing', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.generate(), [])
  assert.deepEqual(await generateContents({ generatorRoot:path.join(f.generatorRoot, 'missing'), contentsRoot:f.contentsRoot }), [])
  await f.write('generator/root.ts', 'export default {id:"root"}')
  await assert.rejects(f.generate(), /content subdirectory/)
})
