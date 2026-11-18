import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { test } from 'node:test'
import { decryptKrc, parseKrc } from '../electron/kugou/lyrics.ts'

/**
 * 把明文 KRC 反着做一遍加密，用来做往返测试。
 *
 * 上游的加密是「4 字节魔数 +（异或 + zlib）」，密钥与魔数都是定值；这里按同一
 * 顺序造样本，测试就不必联网，也不必把上游的歌词存进仓库。
 */
const KRC_KEY = Buffer.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69
])

function encrypt(text: string): string {
  const body = deflateSync(Buffer.from('\uFEFF' + text, 'utf8'))
  for (let i = 0; i < body.length; i += 1) body[i] ^= KRC_KEY[i % KRC_KEY.length]
  return Buffer.concat([Buffer.from('krc1'), body]).toString('base64')
}

/** language 行的值：一条或多条语言轨，按行排列。 */
function language(payload: { language: number; lyricContent: string[][] }[]): string {
  return Buffer.from(JSON.stringify({ content: payload, version: 1 }), 'utf8').toString('base64')
}

test('decrypts a KRC payload back to plain text', () => {
  const plain = '[ti:测试]\n[1000,500](1000,500,0)第一行'
  const decrypted = decryptKrc(encrypt(plain))
  assert.equal(decrypted, plain)
})

test('splits a KRC into body lines and drops the word tags', () => {
  const plain = [
    '[ti:夜に駆ける]',
    '[ar:YOASOBI]',
    '[1671,600]<0,300,0>沈む<300,300,0>ように',
    '[3438,700]<0,350,0>溶けてゆくように'
  ].join('\n')
  const document = parseKrc(plain)
  assert.equal(document.lines.length, 2)
  assert.equal(document.lines[0].time, 1671)
  assert.equal(document.lines[0].text, '沈むように')
  assert.equal(document.translation.length, 0)
})

test('pairs the Chinese language track with the body lines', () => {
  const body = [
    '[1671,600]<0,300,0>沈むように',
    '[3438,700]<0,350,0>溶けてゆくように'
  ].join('\n')
  const plain = body + '\n[language:' + language([
    { language: 0, lyricContent: [['宛'], ['如'], ['沉'], ['溺'], ['般']].map((row) => row) }
  ]) + ']'
  // 上面那条语言轨只有 5 行、对不上正文；换成按行对齐的两行，验证的是配对逻辑。
  const aligned = body + '\n[language:' + language([
    { language: 0, lyricContent: [['宛', '如', '沉', '溺', '般'], ['溶', '化', '般']] }
  ]) + ']'
  const document = parseKrc(aligned)
  assert.equal(document.lines.length, 2)
  assert.equal(document.translation.length, 2)
  assert.equal(document.translation[0].time, 1671)
  assert.equal(document.translation[0].text, '宛如沉溺般')
  assert.equal(document.translation[1].text, '溶化般')
})

test('prefers the translated track over the romanised one', () => {
  const body = '[1671,600]<0,300,0>沈むように'
  const plain = body + '\n[language:' + language([
    { language: 0, lyricContent: [['shi', 'zu', 'mu', 'yo', 'u', 'ni']] },
    { language: 0, lyricContent: [['宛', '如', '沉', '溺', '般']] }
  ]) + ']'
  const document = parseKrc(plain)
  assert.equal(document.translation.length, 1)
  assert.equal(document.translation[0].text, '宛如沉溺般')
})

test('leaves translation empty when only a romanised track exists', () => {
  const plain = '[1671,600]<0,300,0>沈むように' + '\n[language:' + language([
    { language: 0, lyricContent: [['shi', 'zu', 'mu', 'yo', 'u', 'ni']] }
  ]) + ']'
  const document = parseKrc(plain)
  assert.equal(document.translation.length, 0)
})

test('ignores a malformed language payload instead of throwing', () => {
  const plain = '[1000,500]<0,500,0>第一行\n[language:not-base64!!]'
  const document = parseKrc(plain)
  assert.equal(document.lines.length, 1)
  assert.equal(document.translation.length, 0)
})
