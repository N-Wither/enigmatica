import { ContentMaker as C } from '../../core/content-maker'

export default C.dialogue('greetings')
  .setName('translate:dialogue.greetings')
  .setCharacter('aac')
  .setStartNode('hello')
  .addNode('hello', C.message('aac', '早上好。').setNext('reply-1'))
  .addNode('reply-1', C.message('ela', '有什么事吗？').setNext('reply-2'))
  .addNode('reply-2', C.message('aac', '档案室里留有一条线索，想先了解哪件事？').setNext('topics'))
  .addNode(
    'topics',
    C.choice()
      .addOption(C.option('hint', '给我一个关键词提示。', 'hint').addEffect({ type: 'setFlag', id: 'knows_archive', value: true }))
      .addOption(C.option('answer', '我知道关键词了。', 'question').setCondition({ type: 'flag', id: 'knows_archive', value: true }))
      .addOption(C.option('secret', '查看隐藏线索。', 'question').setCondition({ type: 'flag', id: 'secret', value: true }).setIfConditionNotMet('remove')),
  )
  .addNode('hint', C.message('aac', '试试“档案”或 archive。现在可以选择回答了。').setNext('topics'))
  .addNode('question', C.input().setPlaceholder('输入你想到的关键词').addGate(['translate:keyword.archive'], 'goodbye').setNext('wrong-keyword'))
  .addNode('wrong-keyword', C.message('aac', '不对哦。').setNext('question'))
  .addNode('goodbye', C.message('aac', '找到了！之后可以再去问问档案服务。').addEffect({ type: 'discoverClue', id: 'archive_keyword' }, { type: 'unlockCharacter', id: 'axv' }))
