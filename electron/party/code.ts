/**
 * 房间码归一。
 *
 * 手念的码常带 `-` 或空格（`ABC-DEF`），照原样比对永远对不上；而比对一旦
 * 靠 `trim().toUpperCase()` 这种半吊子归一，就会出现「房主屏幕上写着 ABCD，
 * 客人填 ABCD 却被拒」这种查不出原因的怪事。
 *
 * 房间、局域网发现、渲染层三处都按同一套规则收口，所以单独放一份。
 */
export function cleanCode(raw: string): string {
  return raw.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 8)
}
