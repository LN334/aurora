/**
 * 在线地址的寿命。
 *
 * 平台签的 CDN 链接大约二十分钟到期，地址缓存也只认八分钟（见
 * features/online/streams 的 STREAM_TTL_MS）。一份地址装进元素之后不会因为
 * 这一首还在播就停止衰老：问得越晚，越可能拿到一份已经签废的链接——要么
 * 403，要么元素根本没有数据。用户看到的就是「放着放着去干别的，回来点播放
 * 没声音，切一首立刻好」：切歌能救回来，只是因为它重新取了一次地址。
 *
 * 判据是「这份地址装上去多久了」，不是「暂停了多久」。暂停只是用户唯一会
 * 注意到它的时机，不是地址老化的原因。比缓存 TTL 早一分钟，留出取流的时间。
 */
export const STALE_SOURCE_MS = 7 * 60 * 1000

/**
 * 元素里那份地址还能不能用。
 *
 * 只对在线地址判：本机文件的地址不会签名过期，重装反倒白停一下。
 * `loadedAt` 为 0 表示还没装上过地址，没有东西会过期。
 */
export function sourceIsStale(online: boolean, loadedAt: number, now: number): boolean {
  return online && loadedAt > 0 && now - loadedAt >= STALE_SOURCE_MS
}
