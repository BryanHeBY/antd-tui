# antd-tui

面向 Agent 的终端 UI 引擎。用一套贴近 [Ant Design](https://ant.design/) 命名的 React 组件库在终端里搭建可鼠标交互的界面,并提供三条抽象通路——声明式 JSON Schema、命令式 `$ui` 活对象树、原生 React 组件——让人类与 Agent 都能生成、驱动同一套页面。

底层渲染基于 [OpenTUI](https://github.com/sst/opentui);运行时为 [Bun](https://bun.sh/)。

## 为什么

终端里做交互界面通常要手写光标、布局与事件循环。antd-tui 把这些收敛成组件:你用 `<Button>`、`<Table>`、`<FormItem>` 的直觉写页面,拿到的是可点击、可聚焦、可滚动的真机终端界面。更进一步,它为 Agent 设计了机器友好的驱动面——Schema 校验、无头快照、Playwright 式驱动会话、以及一块完全由 Agent 经 MCP 工具操控的画布。

## 包结构

Bun workspace,十个包:

| 包 | 职责 |
|---|---|
| `@antd-tui/components` | 纯 React 终端组件库(31 个组件)+ 主题 token + 焦点系统 + 组件白名单元数据 |
| `@antd-tui/engine` | 页面 Schema 校验、`PageView`/`App` 渲染、无头快照与 `--drive` 驱动器、CLI |
| `@antd-tui/formily` | 把 Formily `SchemaField` 映射到组件库(Schema 通路的表单引擎) |
| `@antd-tui/live` | `$ui` 活对象树运行时:真 JS 对象 + 真函数、操作级校验、observable 自驱渲染 |
| `@antd-tui/acp` | ACP 客户端桥:连接 agent 子进程,把 `session/update` 的各变体、权限请求、会话/模式/模型/取消都摊成宿主可用的回调与方法,纯协议、零 UI |
| `@antd-tui/vibe-tui` | 完全由 ACP Agent 驱动的画布,经内置 MCP 工具生成/操作界面 |
| `@antd-tui/antop` | 可嵌入或以 CLI 运行的终端系统监控器 |
| `@antd-tui/anterm` | 内嵌可交互子终端(能跑 `vim` / `htop` / `ssh`)+ 可被宿主复用的 PTY 会话与 flow 平铺渲染 |
| `@antd-tui/anshell` | agent 时代的流式对话式 shell:所有命令跑在一条长驻 shell 里(OSC 133 切卡片),真实 bash 补全与斜杠命令 |
| `@antd-tui/test-utils` | 进程内终端渲染的测试夹具 |

## 三条通路

同一个页面可以用三种方式表达,`examples/` 下的计算器与运维面板各有三份等价实现,可对照阅读:

| 通路 | 形态 | 换页 | 联动 | 校验 | 适用 |
|---|---|---|---|---|---|
| **schema** (`examples/schema/`) | 声明式 JSON | `x-visible` | `x-reactions` | `x-validator` | Agent 生成、可静态校验的页面 |
| **repl** (`examples/repl/`) | 命令式 `$ui` 活对象树 | `$ui.clear()` 重建 | `$ui.watch` 插删 | 真函数写回 FormItem | 增量搭建、真闭包逻辑 |
| **react** (`examples/react/`) | 原生 React 组件 | 条件渲染 | `useState` | 普通函数 | 手写应用 |

## 快速开始

```sh
bun install

# 计算器:三种通路
bun run examples:calc          # schema 版(engine 渲染 JSON)
bun run examples:calc:repl     # repl 版($ui 活对象树)
bun run examples:calc:react    # 原生 React 版

# 运维控制台:登录页 + App Shell(顶栏/侧栏/多区域),覆盖全部组件
bun run examples:dash
bun run examples:dash:repl
bun run examples:dash:react

# antop:原生 React 的现代终端资源监视器(htop/btop 风格)
bun run antop
```

示例需要在真实终端(TTY)中运行。

## engine:给 Agent 的驱动面

engine 把页面 Schema 当作可校验、可无头驱动的产物:

```sh
# 校验(不渲染)
bun packages/engine/src/cli.ts --schema examples/schema/dashboard.json --dry-run

# 导出单帧:字符画 / ANSI 彩色 / SVG 矢量图
bun packages/engine/src/cli.ts --schema x.json --snapshot --format svg > x.svg

# Playwright 式交互会话(stdin/stdout NDJSON:看帧 → 点击/输入 → 再看帧)
bun packages/engine/src/cli.ts --schema x.json --drive
```

交互结果以 NDJSON 写回 stdout(`{"event":"submit","values":{...}}` / `{"event":"cancel"}`)。详见 [`docs/schema-guide.md`](docs/schema-guide.md) 与 [`docs/driver.md`](docs/driver.md)。

编译为独立二进制:

```sh
bun run build:bin   # → dist/antd-tui-engine
```

## vibe-tui:Agent 驱动的画布

`vibe-tui` 是一块完全由 Agent 驱动的终端界面:人类在底部输入框对话,Agent 经 [ACP](https://agentclientprotocol.com/) 连入,通过内置 MCP 工具在 `$ui` 活对象树上生成、操作界面。

```sh
# 用内置 mock agent 体验
bun run vibe:mock

# 接入真实 ACP agent
bun packages/vibe-tui/src/cli.ts --agent "qodercli --acp"
```

MCP 工具:`vibetui_eval`(会话级 JS REPL)、`vibetui_snapshot` / `vibetui_host_snapshot`(页面/宿主截帧)、`vibetui_layout`(Row/Col 布局诊断)、`vibetui_inspect`(节点 props 与可见文本)、`vibetui_dispatch`(语义事件自测)、`vibetui_reset`(清空页面与 REPL 作用域)、`vibetui_guide`(编写规范)、`vibetui_example`(参考实现源码)。会话就绪后自动注入引导:默认可直接执行完整 JS；不熟悉 API 或搭复杂壳时按需读取 guide/example；只有需要尽早展示中间结果时再分区增量构建。

交互:输入框输入 prompt(Enter 发送);F2 进入页面模式操作画板,F3 对话记录,Esc 返回;鼠标随时可点画板。

## antop:终端系统监控器

`@antd-tui/antop` 是仓库内独立的 React workspace package，同时提供真实终端 CLI。它采集 CPU、内存、磁盘 IO 与进程数据，支持 CPU / IO / 看板页、表头排序、列宽拖动和进程详情弹窗。

```sh
# 需要真实 TTY
bun run antop
```

作为组件嵌入时可传入 `snapshot` 做确定性渲染/测试，或省略它以自动采样本机数据：

```tsx
import { Antop } from "@antd-tui/antop"

<Antop />
```

## anterm:内嵌终端

`@antd-tui/anterm` 在页面里嵌一块真正的子终端 —— `vim`、`htop`、`ssh` 都能跑。

实现上没有任何 native 依赖:PTY 用 Bun 1.3 起内置的 `Bun.Terminal`(`Bun.spawn({ terminal })`),屏幕模型用零依赖的 `@xterm/headless`,再把 cell 网格按行合并成 `StyledText` 交给 `<text>` 渲染。

```sh
# 需要真实 TTY;省略命令则跑 $SHELL
bun run anterm
bun run anterm htop
```

```tsx
import { Anterm } from "@antd-tui/anterm"

<Anterm command="bash" autoFocus style={{ flexGrow: 1 }} />
```

九个要点:

- **全键捕获**。终端要收到 Tab(shell 补全)、方向键、Enter,所以它以 `kind: "capture"` 注册进焦点系统,`FocusScope` 不再替它消费任何按键。代价是焦点出不来,需按 `tuiEscapeKey`(默认 `Ctrl+]`,telnet 风格)交还。宿主若要保留少量自己的快捷键(如切换窗口大小),用 `tuiHotkeys`(键名如 `"ctrl+o"`)拦下,命中的键不透传子进程。
- **会话可被宿主复用**。`tuiSession` 接管一个宿主自己 `createAntermSession` 建出的 PTY,组件卸载时**不**终止它——于是同一个会话能在流内卡片与浮层视图之间搬移而不重启子进程(`tuiResizeSession` 决定该视图的尺寸是否同步回 PTY)。配套开关:`tuiKeyboardDisabled`(宿主统一接管输入)、`tuiReadOnly`(退出后只读展示,不再注册焦点)、`tuiBackgroundColor`(与宿主卡片底色融合)。
- **flow 平铺渲染**。`tuiFlow` 改用 normal buffer 从首行平铺,卡片高度随实际输出行数自然增长(而非固定视口),让命令输出能嵌进宿主的滚动历史流;若会话曾整屏重画、append-only 历史已不可还原,用 `tuiFlowViewport` 退化为只冻结当前视口。
- **光标分两条路**。视口模式(浮层/全屏)把子进程的光标交给**宿主终端的真光标**(`setCursorPosition`):自带闪烁与用户的光标样式,也不会像涂色单元格那样在分页器反复重画后留下白块。flow 卡片仍把光标涂进单元格——真光标不受 scrollbox 视口裁剪,卡片滚出视口后它会飘在别的位置。
- **会话暴露行为读面**。`normalScreen`(即便已切到 alternate screen 仍可读流式历史)、`alternateScreen`、`screenTakeover`、`normalContentRows` / `normalOutputRows`、`cursorVisible` —— 宿主据此按**程序的实际行为**而非命令名决定呈现(如切 alternate screen 就把会话升格成浮层)。
- **OSC 标记读面**。`onOsc` 转发子进程的 OSC 7(cwd)与 133(FinalTerm 语义 prompt 标记),带上序列被解析当刻的 buffer 行列——这是把一条长驻 shell 的输出切成命令区间的唯一准确来源;`AntermMark`(基于 xterm `registerMarker`)对 scrollback 裁剪安全但对 reflow 不安全,`screenTakeoverSeq` 把整屏擦除从 sticky 布尔换成可按命令比较的代数。anshell 的长驻 shell 模型就架在这套读面上。
- **自建控制终端**。Bun 的 `spawn({ terminal })` 不给子进程建立控制终端(`ps` 里 TT 是 `?`),于是 pty 的 ISIG 找不到前台进程组——Ctrl-C 只回显 `^C`,不产生 SIGINT,作业控制也不工作。Linux 上用 util-linux 的 `setsid --ctty` 补上这一步;其他平台降级为直接运行(显示与输入照常,信号键失效)。
- **鼠标按协商级别透传**。子进程经 DECSET 1000/1002/1003 声明追踪级别,组件据此过滤事件种类,并按 1006 决定用 SGR 还是 X10 编码。注意 DECSET 允许合并参数(htop 发的是 `\x1b[?1006;1000h`),必须按参数拆开判断,否则会退化成 X10 而让子进程把坐标字节读成按键。子进程没要鼠标时,滚轮用来翻组件自己的回看缓冲。
- **ANSI 0-15 走自带色板**。opentui 会把 palette 索引摊平成 xterm 的静态默认值(ANSI 1 是 `#800000`),放在现代终端里内容会明显发闷,所以组件自带一张 Campbell 色板,可经 `tuiPalette` 覆盖。索引 16-255 是与主题无关的标准 256 色立方体,不受影响。

## anshell:对话式 shell

`@antd-tui/anshell`(CLI `ansh`)不是传统 shell,而是一个**流式对话框**(仿 CC/codex/bash):历史自上而下流动、各条成卡片。所有命令跑在**一条长驻交互 shell** 里,靠 OSC 133 语义标记切成卡片(VS Code / Warp 的 shell integration 做法)——`export`/`source venv`/别名/`cd`/作业控制/`history` 全部跨命令留存。仅支持 bash 与 zsh(其余 shell 启动即报错)。流尾是一张可编辑的草稿输入卡,提示符按路由变:Shell `$`、Agent `◆`;斜杠命令不另加提示符——用户敲的那个 `/` 本身就是提示符(只染色),所以草稿与冻结后的卡片头逐字一致,不会出现 `/ /session` 这种双斜杠或掉斜杠;`Ctrl+T` 可覆盖当前草稿的路由(斜杠命令输入上是三档轮换),提交后恢复自动判断。输入卡与较暗的输出卡紧贴排列,没有独立底部输入框。

卡片的符号是一套:`$` 经 Shell 解释、`▶` 不经 Shell 直接 exec、`◆` agent、`/` 斜杠命令、`*` 工具调用、`!` 权限请求、`·` 系统提示。

提示符做成**主色徽章**:cwd 占一块实心方块,底色是 `colorPrimary` 再压暗一档(直接用主色配主色系文字对比度不够)、文字纯白,左右各一格内边距、硬边收尾——不用端帽字符(半圆/三角/半块都要么太小要么依赖字体),也不用又一档灰(灰阶之间差异太小、扫视时抓不住);底色仍从主题派生,覆盖主色时徽章跟着变。徽章之后所有路由的提示符都在同一列起笔(原生 input 在徽章后自带一格,`$`/`◆` 各补一个空格对齐),草稿与冻结后的卡片头因此逐字对齐。卡片底色仍分三档,从亮到暗:输入 `#1f1f1f`、agent 回复 `#1a1a1a`、输出 `#171717`。斜杠命令的结果不是纯文本行而是结构化的 `CommandRow`(标记 + 主体 + 参数提示 + 说明 + 备注),因此 `/help` 的命令名、`/session` 的当前会话、`/mode` 的当前模式都能各自上色,而不必靠猜字符串边界。

- **命令**:首词是已知命令(PATH 可执行 / builtin / shell 自报的函数别名),或整行含 Shell 结构(`| > & ; $` …)→ 写进那条长驻 shell。卡片头是 `<cwd> $ <整行>`,输出是 `133;C`→`133;D` 之间行区间的实时派生,命令结束时冻结成**不可变快照**(冻结画面与最后一帧逐格一致)。输入区支持语义高亮与异步 `bash/zsh -n` 诊断。
- **真实补全（bash）**:`Tab` 把整行交给那条 shell 里 bash 自己的 completion spec 跑一遍(`complete -p` 取 spec → 调 `-F` 函数 → 回带 `COMPREPLY`),所以 `git checkout <Tab>` 列的是真分支、`systemctl <Tab>` 是真单元。bash-completion 多为懒加载,驱动带 **124 重试**;没有已注册 spec 的裸命令/路径/`$VAR` 回退到宿主的启发式补全(它会 stat 目录)。多个候选时草稿卡下方展开下拉框,`↑↓` 选择(抢在命令历史之前)、`Tab` 前进、`Enter` 接受、`Esc` 收起。zsh 暂用启发式。请求经 shell 的 `runHidden` 文件通道传输,不碰 PTY 引号。
- **全屏行为**:不按命令名特判。命令切到 alternate screen(或 `Ctrl+O` 强制)时,那条共享 shell 的视图被搬进**全屏**浮层(vim/less/htop 的原生体验),退出后卡片原样留在流里(`<cwd> $ <整行>  (exit N)` + 输出块)。浮层两档**同宽**(只差高度)——这样 cols 恒定、xterm 不会 reflow,浮层才能安全 resize 共享 shell。`Ctrl+O` 在全屏↔居中弹窗间切换。整屏重画(`clear` / `\e[2J`)按 `screenTakeoverSeq` 只让**那一条**命令降级为视口快照,不像旧的 sticky 布尔那样污染整个会话。
- **agent**:无法解析的自然语言 → 交给 agent(配置了 `--agent` 时经 `@antd-tui/acp` 走 prompt/stream;否则回一句系统提示)。agent 的流式回复、思考、工具调用、权限请求各自成卡片,与 shell 卡片同一套版式。轮次在途时**不发新的草稿卡**(仿 shell 的 prompt 未归位),流尾只有一行 `⠋ 运行中 · Esc 中断`——否则输入卡会先冒出来、agent 的文字再插到它上面;`Esc`/`Ctrl-C` 等价 `/cancel`,轮次收敛后草稿归位。
- **斜杠命令**:`/` 开头进入第三条路由(优先于 shell/agent 分诊),草稿卡下方展开内联候选菜单——`↑↓` 选择、`Tab` 补全、`Enter` 执行(命令名没敲全且该命令带参数提示时,Enter 先补全名字等参数)、`Esc` 收起。命名空间里合流两类命令:
  - **本地命令**映射到真正的 ACP 方法,并按 agent 声明的能力过滤(没声明就不出现在菜单里):`/session`(`session/list`·`new`·`load <id>`·`delete <id>`)、`/mode`(`session/set_mode`)、`/model`(ACP **没有** `session/set_model`,模型是 `category:"model"` 的 select 配置项,走 `session/set_config_option`)、`/cancel`(`session/cancel`)、`/usage`(`usage_update` 上报的占用与费用)、`/permissions`(权限记忆与审计,`reset` 清空)、`/help`。
  - **agent 命令**来自 `available_commands_update`(全量替换、推送式,启动时为空),带 `description` 与 `input.hint`;ACP 没有 execute 方法,执行就是编译成一段 `/name args` 的 `session/prompt` 文本。
  - 判定只认「`/` 开头且首词里没有第二个 `/`」,`/usr/bin/ls`、`/tmp/x.sh` 仍然是可执行路径,照旧走 shell。**单段**绝对路径(`/tmp`、`/start.sh`)天生两义——`Ctrl+T` 在这种输入上三档轮换(斜杠命令 → Shell → Agent)让用户直接裁决,强制路由优先于斜杠识别,而不是靠更多猜测规则。
- **权限审计**:`session/request_permission` 不再自动放行,而是开一张待决策卡片(`! <工具> 需要授权` + 编号选项);待决策期间草稿不渲染,键盘完全归卡片——数字键选项、`Esc`/`Ctrl-C` 取消。选中 `allow_always`/`reject_always` 会按工具名写进本地记忆,下次同名工具直接命中并在卡片上标「(记忆)」;`/permissions` 查看记忆与审计流水。agent 换了选项集时记忆自动失效,重新问人。

```sh
# 需要真实 TTY
bun run ansh
bun run ansh --agent "<agent 启动命令>"
bun run ansh --shell /usr/bin/bash  # 覆盖默认 $SHELL；仅支持 bash/zsh
bun run ansh --no-rc                # 不 source 用户 dotfiles（干净环境）

# 打包成单文件可执行（dist/ansh，约 124MB，目标机无需装 bun）
bun run build:ansh
./dist/ansh
```

打包用 `bun build --compile` 而不是输出 mjs:opentui 的原生库来自平台专属包
(`@opentui/core-<platform>-<arch>`),`--compile` 会把 `libopentui.so` 连同
tree-sitter 资产一起嵌进 `$bunfs`(opentui 自己就识别这种路径);而 mjs 路线会散出
十几个文件——两个 13MB 的 `.so`(glibc/musl)加几 MB wasm——且目标机仍要装 bun,
因为 anshell 依赖 `Bun.Terminal` 这类 Bun 独有 API。opentui 又静态引用了全部平台包
而本机只装了当前平台,所以两种打包都要把异平台包标成 `--external`。

```tsx
import { Anshell } from "@antd-tui/anshell"

<Anshell shell="/usr/bin/zsh" agentCmd={["qodercli", "--acp"]} />
```

要点:

- **感知式行内输入(所见即所得)**。自动路由以 `$`(Shell)/`◆`(Agent)实时反馈,`Ctrl+T` 显式切换当前草稿;Enter 后原样冻结,输出以较暗底色的卡片紧贴其下,所有流项目之间不留空行。无独立底部输入框、无状态行,cwd 融进每张输入卡的提示符。
- **一条 shell,卡片是它的切片**。命令输出按 OSC 133 的 `C`/`D` 标记切成卡片;标记带 `ansh=<nonce>`,会话里再开一层 shell(它用你自己的 rc、可能自带别家 shell integration)的标记 nonce 不符会被丢弃,不会把外层卡片切断。alternate screen 升格为全屏浮层,复用同一个会话。
- **退出用 Ctrl-D / exit**——`exit` 直接让那条 shell 退出、应用随之收场;草稿中 **Ctrl-C 取消当前输入**,命令运行中则原样交给 PTY 产生中断。
- **cwd 由 shell 经 OSC 7 上报**:`cd`/`pwd`/`export`/`source` 全回归真 shell,徽章跟着 OSC 7 变。唯一的宿主内建是 `clear`(清卡片流,不清 shell 屏幕)。
- 命令历史经 ↑↓ 翻阅(`Input` 无方向键钩子,由组件级 `useKeyboard` 处理)。

内部结构按三层分目录:`shell/` 是与 shell 打交道的执行层、`agent/` 是 ACP/斜杠命令层、`ui/` 是渲染与草稿状态层;根目录只留入口(`Anshell.tsx`/`cli.tsx`)、桶文件(`index.ts`)、共享类型(`types.ts`)与 shell↔agent 分诊(`triage.ts`)。

- `shell/` **执行与分析层**:`lexer.ts` 只做单行词法(着色、命令位置、补全边界),**不做任何展开**;`syntax.ts` 调 `bash -n`/`zsh -n` 空跑出诊断(带超时),**不参与路由**;`completion.ts` 给命令/`$ENV`/文件路径三类启发式补全,`completion-live.ts` 把整行交给 bash 自己的 completion spec 跑(带 124 重试);`dialect.ts`(bash/zsh 判定)、`rc.ts`(临时 rc 注入:先 source 用户配置再追加 prompt 钩子,与 starship/p10k 共存;bash `PROMPT_COMMAND` 前置以拿到真实 `$?`;每条标记带 nonce)、`session.ts`(OSC 事件 → idle/inFlight 状态机 + 命令边界 + cwd + `runHidden` 静默命令走文件通道)、`range.ts`(`[C, D)` 行区间代数,运行中单调水位线,标记被裁/整屏重画的降级)。
- `agent/` **ACP/斜杠层**(都不碰 React,可独立测试):`commands.ts` 斜杠命令表(`parseSlash`/`listCommands`/`matchCommands`/`compileAgentCommand`),`slash-actions.ts` 把每条本地命令映射到真正的 ACP 方法(依赖经参数注入,React 细节留在 `Anshell`),`permissions.ts` 权限记忆与审计流水,`tool-content.ts` 把 ACP 的 `ToolCallContent` 压成几行摘要。
- `ui/` **渲染与状态层**:`draft-state.ts` 草稿的单一 reducer(输入/路由覆盖/诊断/补全候选/斜杠菜单原子更新);`useShellSession.tsx` React 接缝——建会话、把 OSC 事件接进 transcript、维护 cwd/浮层,并把行区间快照成 `StyledText[]`(运行中每帧派生,`133;D` 同步冻结;命令在飞用同步 ref 标志,提交当刻即翻转,紧跟的 stdin 不丢);`cards.tsx` 的 `ShellCard`/`RunningShellCard` 只渲染行区间快照、不自持会话;`overlays.tsx` 纯浮层视图(弹窗↔全屏同宽只差高度);`transcript.ts` 块级状态机;`theme.ts` 卡片底色。

## 组件

31 个组件,命名与语义对齐 antd:`Button` / `Input` / `InputNumber` / `TextArea` / `Select` / `Checkbox` / `Radio` / `Switch` / `Slider` / `FormItem` / `Typography`(Text/Title/Link)/ `Card` / `Space` / `Flex` / `Row` / `Col` / `List` / `Table` / `Descriptions` / `Statistic` / `Progress` / `Tag` / `Alert` / `Divider` / `Spin` / `Modal` / `message` 等。

命名原则:与 antd **行为完全一致**的字段沿用原名(如 `type`、`options`、`onChange`);因终端适配而**行为相近但不同**的字段加 `tui` 前缀(如 `tuiOnClick` 无 DOM 事件参、`tuiHotkey` 全局热键、`tuiScroll` 滚动视口)。样式经 `style`(CSS 子集:`width`/`flex`/`flexGrow`/`flexShrink`/`flexBasis`/`padding`/`margin*`/`color`/`backgroundColor`/`textAlign`/`overflow`)表达。

**输入增强**(anshell 的语法高亮与 Tab 补全就建在这三项之上):

- `tuiHighlights: InputHighlight[]` —— 在原生输入缓冲上叠加语义高亮(`color` / `backgroundColor` / `bold` / `italic` / `underline` / `dim`)。起止偏移按 **Unicode code point** 计,`end` 不含。
- `tuiShowCursor: boolean` —— 隐藏终端原生光标但**保留输入焦点**。opentui 的原生光标不受 scrollbox 视口裁剪,滚动看历史时需要靠它避免光标浮在历史上方。
- `tuiOnTab: (ctx: InputTabContext) => InputEdit | void | Promise<...>` —— 接管 Tab。返回 `InputEdit {value, cursor}` 时 Input 会在受控值回填后恢复光标位置;返回 `void` 则只消费按键(适合仅展示候选列表)。异步补全期间的值变更会作废在途结果。
- 配套的焦点系统开关 `useFocusable({ captureTab: true })`:让该控件独占 Tab,`FocusScope` 不再拿 Tab 切换焦点。

## 开发

```sh
bun run typecheck   # tsc --noEmit
bun test            # 全量测试(进程内渲染真帧)
```

测试基于 `@antd-tui/test-utils` 的进程内渲染器,断言真实字符帧,与真机渲染同一管线。
