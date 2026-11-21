import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalArtwork, upstreamOfArtwork } from '../src/features/library/artwork-url.ts'

/*
 * 这一组钉的是 0.9.19 的真 bug：拆包装时没把尺寸段剥干净，整串被当成图片
 * 地址，浏览器按相对路径解析，主进程去 asar 里找文件，一串 404、封面变色块。
 */

const upstream = 'http://p3.music.126.net/abc==/109951173.jpg'

test('带一层尺寸段的包装能取出上游地址', () => {
  const art = 'aurora-remote://image/n1000/' + encodeURIComponent(upstream)
  assert.equal(upstreamOfArtwork(art), upstream)
})

test('套了两层尺寸段也能剥干净', () => {
  const art = 'aurora-remote://image/n200/n1000/' + encodeURIComponent(upstream)
  assert.equal(upstreamOfArtwork(art), upstream)
})

test('https 也认', () => {
  const https = upstream.replace('http:', 'https:')
  assert.equal(upstreamOfArtwork('aurora-remote://image/n96/' + encodeURIComponent(https)), https)
})

test('裸的 http 地址原样返回', () => {
  assert.equal(upstreamOfArtwork(upstream), upstream)
})

test('本机自定义协议不冒充 http（调用方会原样用）', () => {
  assert.equal(upstreamOfArtwork('aurora-media://art/320/C:/a.jpg'), null)
  assert.equal(isLocalArtwork('aurora-media://art/320/C:/a.jpg'), true)
})

test('空与坏值给 null，不会让调用方拿坏地址去请求', () => {
  assert.equal(upstreamOfArtwork(null), null)
  assert.equal(upstreamOfArtwork(''), null)
  assert.equal(upstreamOfArtwork('aurora-remote://image/n1000/%E0%A4%A'), null)
})
