# 参与 Aurora

这个仓库是个人项目，但 issue 和 PR 都欢迎。动手之前先看一眼这几条，能省掉一轮来回。

这份文件只讲流程。**命令、代码结构、测试与性能口径都在 [README](README.md) 的「开发者」一节**，这里不重复抄一遍 —— 抄两遍的东西迟早有一遍是错的。

## 报问题

用 [问题模板](.github/ISSUE_TEMPLATE/bug_report.yml) 填，最少给三样：

1. **版本号** —— 设置 → 更新与关于里能看到。老版本上的问题可能已经修了。
2. **复现步骤** —— 从打开应用开始按顺序写。只出现过一次的也照实写，别为了凑步骤编。
3. **日志** —— 安装版在 `%APPDATA%\aurora-player\startup.log`。日志里有账号 cookie，贴之前把带 token 的行删掉。

先看 README 的「常见问题」与「已知限制」。四个在线平台都走第三方接口，某个会员曲放不了、某首歌搜不到，多半是平台侧的限制；这类不会当 bug 修。

## 改代码

### 最短路径

```bash
npm install
npm run dev      # 热更新 + 真实窗口
npm run check    # 提交前必须绿：类型 + 测试 + 四项审计
```

国内网络装依赖卡在 Electron 二进制上的处理，README 里写了 `.npmrc` 的配法。

### 分支与提交信息

- 分支名 `fix/...`、`feat/...`、`docs/...`，一个分支一件事。
- 提交信息沿用仓库现有风格：`type(scope): 中文说清做了什么`。
  - type：`fix` `feat` `perf` `refactor` `docs` `chore` `test` `build`
  - scope：`player` `roam` `home` `lyrics` `settings` `onboarding` `pack` 这类模块名
  - 例：`fix(player): 启动恢复的队列不再自己开唱，预取也不替它取地址`
- 标题写「做了什么」，不要写「改了哪个文件」。一个提交只做一件事 —— 修 bug 和顺手调格式请分开。
- 正文只在需要解释**为什么**时才写。代码能说清的就别写。

### 几条硬约定

这些不是风格偏好，改错了会坏：

1. **依赖方向单向**：`views → features → ui`。`electron/pure` 里不许 import Electron，否则裸 Node 测试加载不了。
2. **一页只有一个标题**，由外壳打；页内不再重复。**不在页内另造侧栏。** 配色只来自当前封面，改界面前先看 `src/styles/tokens.css`。
3. **平台改动四个平台一起改。** 网易云、QQ、酷狗、汽水共用同一套页面与列表，只修一家等于埋了一个「这家能点、那家不能点」的坑。
4. **不绕过平台付费。** 会员曲就返回 `vip-required` 并跳过，不找替代源把它放出来。这是产品立场，不是没做完。
5. **音频与封面不能直连外网**：音频走主进程的 `aurora-remote:` 代理（顺带做 Range 转发与地址白名单）；`artUrl` 必须同源或带 CORS 头，否则封面进不了 Canvas 取色。
6. **界面里的交互不能走进死路。** 关掉一项功能时，界面上要给回入口或说明；不允许「点了没变化」。

更完整的设计记录在 [docs/architecture.md](docs/architecture.md)，界面规则在 [docs/ui-design.md](docs/ui-design.md)。

### 测试

- 不依赖 Electron 的纯逻辑放进 `tests/`，用 `node --test`。新增纯函数尽量配一条用例。
- 界面改动跑一次 `npm run smoke`：它起独立窗口逐页点过去，收控制台报错、破图与未捕获异常，失败返回 1。
- 动过渲染循环（封面墙、歌词滚动、可视化）要在 PR 里给前后数字，口径见 [docs/perf-baseline.md](docs/perf-baseline.md)。同产物连跑抖动约 ±0.3pp，差不到 0.5pp 不算优化。
- `npm run check` 里的四项审计会拦：加载不到的文件、没人命中的 CSS 选择器、指向已不存在文件的路径、只在本文件内用的 `export`。别为了让它们过而加 `// audit-ignore` —— 仓库里没有这个机制，该删就删。

### 别提交的东西

`.gitignore` 里已经拦住了：`node_modules/`、`dist*/`、`release*/`、`.probe-*`、`shots/`、`.smoke/`、`vendor/`、`design/`。被带进提交通常是用了 `git add -f`，回滚掉再提交。

## 发版

发版由维护者执行，流程写在 README 的「发版」一节，定期维护清单在 [docs/maintenance.md](docs/maintenance.md)。

**这个仓库有一条额外规则：打包发布（改版本号 + `npm run dist` + 建 GitHub Release）之前必须先征得项目所有者同意。** 提交与推送不受限。

## 许可

提交进这个仓库的代码按 [MIT](LICENSE) 授权。
