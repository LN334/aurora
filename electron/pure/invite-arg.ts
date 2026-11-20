/**
 * 从命令行里认出邀请链接。
 *
 * 只做一件事，单独放出来是因为它只在这一种形状上出错：Windows 把协议参数
 * 递进来时，有时干干净净一条 `aurora://join?…`，有时连着引号，有时命令行里
 * 还混着 `--dev` 这类我们自己的参数。写进 main.ts 就意味着这段判断只能靠
 * 手动点链接去试，这里可以直接喂几种 argv 把行为钉住。
 */
export function inviteFromArgv(argv: readonly string[]): string | null {
  const hit = argv.find((arg) => /^"?aurora:\/\//i.test(arg))
  return hit ? hit.replace(/^"|"$/g, '') : null
}
