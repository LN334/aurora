import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitLyricLine } from '../src/features/lyrics/line-parts.ts'

test('英文原文配中文译文时拆成两行', () => {
  assert.deepEqual(splitLyricLine('Still remember when we met / 依然记得我们相遇的时候'), {
    main: 'Still remember when we met',
    sub: '依然记得我们相遇的时候'
  })
})

test('日文原文配中文译文时拆成两行', () => {
  assert.deepEqual(splitLyricLine('今を抱きしめられたら / 能够紧紧拥抱现在'), {
    main: '今を抱きしめられたら',
    sub: '能够紧紧拥抱现在'
  })
})

test('中文原文配英文译文也拆开', () => {
  assert.deepEqual(splitLyricLine('我把名字写在起雾的玻璃上 / I wrote it on the fog'), {
    main: '我把名字写在起雾的玻璃上',
    sub: 'I wrote it on the fog'
  })
})

test('日文译文同样算译文', () => {
  assert.deepEqual(splitLyricLine('Baby I love you / ベイビーアイラブユー'), {
    main: 'Baby I love you',
    sub: 'ベイビーアイラブユー'
  })
})

test('两段都是中文时不动，那是合作署名', () => {
  assert.deepEqual(splitLyricLine('周乘羽 / 卡力老虎'), { main: '周乘羽 / 卡力老虎', sub: '' })
})

test('两段都是英文时不动，那是同一句的重复或语气变体', () => {
  assert.deepEqual(splitLyricLine('(oh-oh-oh / oh-oh-oh)'), { main: '(oh-oh-oh / oh-oh-oh)', sub: '' })
})

test('没有分隔符时整句保留', () => {
  assert.deepEqual(splitLyricLine('然后是场空 加上不死的心痛'), { main: '然后是场空 加上不死的心痛', sub: '' })
})

test('空串与只有分隔符时安全', () => {
  assert.deepEqual(splitLyricLine(''), { main: '', sub: '' })
  assert.deepEqual(splitLyricLine(' / '), { main: '/', sub: '' })
})
