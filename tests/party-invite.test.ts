import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inviteFromArgv } from '../electron/pure/invite-arg.ts'
import {
  inviteLink,
  inviteText,
  normalizeCode,
  parseInvite
} from '../src/features/party/invite.ts'

/*
 * 邀请串是「分享」这一条链路上唯一没有主进程兜底的地方：房主那边生成的是一段
 * 文本，客人那边要照着自己再解析出来。这里把两种写法、几种口念习惯都钉住，
 * 以后再改格式至少知道自己破坏了哪一种。
 */

test('自己生成的链接能被自己解析回来', () => {
  const link = inviteLink('192.168.1.5:7890', 'PARTY')
  /* 冒号不编码：这条链接要给人看，%3A 只会让人以为自己复制错了。 */
  assert.equal(link, 'aurora://join?h=192.168.1.5:7890&c=PARTY')
  assert.deepEqual(parseInvite(link), { place: '192.168.1.5:7890', code: 'PARTY' })
})

test('链接里的参数顺序与参数名都不挑', () => {
  assert.deepEqual(parseInvite('aurora://join?c=ABCDEF&h=10.0.0.7:9000'), {
    place: '10.0.0.7:9000',
    code: 'ABCDEF'
  })
  assert.deepEqual(parseInvite('aurora://join?address=10.0.0.7:9000&code=abcdef'), {
    place: '10.0.0.7:9000',
    code: 'ABCDEF'
  })
})

test('地址 + 房间码那一行也认，地址带不带 ws:// 都行', () => {
  assert.deepEqual(parseInvite('192.168.1.5:7890 PARTY'), {
    place: '192.168.1.5:7890',
    code: 'PARTY'
  })
  assert.deepEqual(parseInvite('ws://192.168.1.5:7890/  party'), {
    place: '192.168.1.5:7890',
    code: 'PARTY'
  })
  assert.deepEqual(parseInvite('demo.natfrp.cloud:23456，PARTY'), {
    place: 'demo.natfrp.cloud:23456',
    code: 'PARTY'
  })
})

test('手念时加的连字符不算房间码的一部分', () => {
  assert.deepEqual(parseInvite('10.1.1.2:7890 ABC-DEF'), {
    place: '10.1.1.2:7890',
    code: 'ABCDEF'
  })
})

test('只认出一样时也返回，缺的那一格由界面去补', () => {
  assert.deepEqual(parseInvite('192.168.1.5:7890'), {
    place: '192.168.1.5:7890',
    code: ''
  })
  assert.deepEqual(parseInvite('party'), { place: '', code: 'PARTY' })
})

test('地址不会被当成房间码', () => {
  /* 去掉标点后 10.0.0.2:30 也是一串字母数字，但它有冒号，不是码。 */
  assert.deepEqual(parseInvite('10.0.0.2:3000'), { place: '10.0.0.2:3000', code: '' })
})

test('什么都没认出来时返回 null，不拿半截东西去连', () => {
  assert.equal(parseInvite(''), null)
  assert.equal(parseInvite('   '), null)
  assert.equal(parseInvite('在吗'), null)
})

test('房间码归一：大写、去分隔符、限长', () => {
  assert.equal(normalizeCode(' abc-def '), 'ABCDEF')
  assert.equal(normalizeCode('abcdefghijkl'), 'ABCDEFGH')
  assert.equal(inviteText('192.168.1.5:7890', 'PARTY'), '192.168.1.5:7890 PARTY')
})

/*
 * 命令行里那一条。
 *
 * 这是「点链接进房」唯一自己写出来的判断：链接不在页面上，而在 argv 里。
 * 冷启动与第二次启动的形状略有差别（一次带着应用路径，一次是系统直接把链接
 * 塞过来），这里按实测的几种形状钉住。
 */
test('从 argv 里认出邀请链接，忽略自己的启动参数', () => {
  assert.equal(
    inviteFromArgv(['Aurora.exe', 'aurora://join?h=1.2.3.4:7890&c=PARTY']),
    'aurora://join?h=1.2.3.4:7890&c=PARTY'
  )
  assert.equal(inviteFromArgv(['electron', '.', '--dev']), null)
  assert.equal(inviteFromArgv([]), null)
})

test('带引号的参数也能认出来', () => {
  assert.equal(
    inviteFromArgv(['Aurora.exe', '"aurora://join?h=1.2.3.4:7890&c=PARTY"']),
    'aurora://join?h=1.2.3.4:7890&c=PARTY'
  )
})
