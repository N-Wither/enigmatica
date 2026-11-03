import { ContentMaker as C } from '../../core/content-maker'

// Export arrays when one script defines several records. Scripts in this folder merge.
export default [
  C.dialogue('axv-check-in')
    .setName('translate:dialogue.axv-check-in')
    .setCharacter('axv')
    .setRepeatable(true)
    .setStartNode('entry')
    .addNode('entry', C.router().addTarget('hello'))
    .addNode('hello', C.message('axv', '你可以随时回来找我。今天有什么发现？').setNext('reply'))
    .addNode('reply', C.input().setPlaceholder('提交你的发现').setNext('goodbye'))
    .addNode('goodbye', C.message('axv', '我记下了，下次再聊。')),
]
