/**
 * agent 冷启动知识：硬编码的引导 prompt 与 $ui 精简指南。
 * vibe-tui 可能运行在任意 cwd（乃至编译产物中），不能依赖仓库文档文件，
 * 因此关键规范内嵌于此；组件 props 速查表从白名单生成——与运行时校验同源，零漂移。
 */
import { componentPropsWhitelist, componentWhitelist } from "@antd-tui/components"
import { inputBindings } from "@antd-tui/live"
// @ts-expect-error Bun 文本导入:构建期把示例源码内联为字符串(不依赖运行时文件系统)
import dashboardSource from "../../../examples/repl/dashboard.tsx" with { type: "text" }

/** 会话就绪后立即注入（新建与恢复都注入）：让 agent 知道自己身处 vibe-tui */
export const BOOT_PROMPT = [
  "你已连接 vibe-tui —— 一块由你（agent）驱动的终端 UI 画布。人类通过底部输入框与你对话，也会直接操作你渲染的界面。",
  "可用 MCP 工具：",
  "- vibetui_guide()：$ui 活对象树的编写规范与样例，画任何页面前先读它",
  "- vibetui_example()：dashboard 参考实现源码全文（登录页/App Shell/表单校验/列表表格）；搭上述任一类页面前先取它照着写",
  "- vibetui_eval(code)：会话级 JS REPL；可一次执行完整 JS（函数、循环、整页构建），也可分次调试；顶层变量、函数与闭包跨调用保留",
  "- vibetui_snapshot()：等待绘制完成后查看 agent 页面字符画；不受 F2/F3、状态栏或输入框影响",
  "- vibetui_host_snapshot()：查看人类当前完整终端画面（含 F3 对话记录），仅用于诊断宿主状态",
  '界面事件会以 "[page] ..." 开头的消息回流给你（按钮点击等）；$ui 的 handler 里可直接调用 $agent.send(text, payload?)。',
  "现在：先调用 vibetui_guide 学习规范；若要搭的是登录页 / 导航壳 / 多区域页 / 表单 / 列表表格，紧接着调用 vibetui_example 取参考实现。",
  "然后开始搭建，节奏是骨架优先：第一个 vibetui_eval 保持 10 行以内（页面元信息 + 带 id 的顶层容器 + 每区一行占位），让人类立刻看到骨架；随后每次 eval 只填一个区域。人类在等你，首个 eval 越短他等得越少。",
  "若没有明确场景，渲染一个简洁的欢迎页（标题 + 一句能力介绍 + 几个引导按钮，按钮回调用 $agent.send 把用户意图回流给你）。",
].join("\n")

/** 组件 → 可用 props 速查表：直接从白名单生成，新增组件/props 自动出现在 guide 里 */
function buildComponentReference(): string {
  const bindable = new Set([...Object.keys(inputBindings), "Typography.Text"])
  return componentWhitelist
    .map((name) => {
      const props = componentPropsWhitelist[name] ?? []
      const mark = bindable.has(name) ? "〔可 name 绑定〕" : ""
      return `- ${name}${mark}：${props.length > 0 ? props.join(" / ") : "（无 props）"}`
    })
    .join("\n")
}

/**
 * vibetui_example 工具返回的内容：dashboard 参考实现全文 + vibe 环境适配说明。
 * 源码经 Bun 文本导入内联，与仓库示例同源（CI 冒烟验证过），零同步债。
 */
export const EXAMPLE_REFERENCE = `# dashboard 参考实现（登录页 → App Shell 全组件示例）

这是仓库黄金示例 examples/repl/dashboard.tsx 的源码全文，覆盖全部组件与常用 props：
登录页（Title/Link/tuiOnPressEnter/Button loading/Modal footer:null）、$ui.clear() 整页换页、
满幅 App Shell（page padding/gap 0 + 背景色条）、导航重建分区、watch 联动插删、真函数校验写回。

## 在 vibe-tui 里借用时的三处适配
1. 忽略 import 行与 TS 类型标注（: LiveNode / as const 等）——vibetui_eval 是纯 JS。
2. 示例的 actions?.submit / actions?.cancel 是宿主退出出口，vibe 里不存在——
   改用 $agent.send("submit", payload) / $agent.send("cancel") 把结果回流给你自己。
3. 示例包在 buildDashboard($ui) 函数里——vibe 里直接顶层写语句即可（$ui 已在作用域）。

## 源码
\`\`\`ts
${dashboardSource as string}
\`\`\`
`

/** vibetui_guide 工具返回的内容：$ui 精简规范 + 可直接照抄的黄金样例 */
export const LIVE_GUIDE = `# vibe-tui $ui 活对象树速成

画布是一棵活组件树，你用 vibetui_eval 在会话级真 JS REPL 中操作它；每次 eval 执行完立即上屏、立即可交互。
不写 JSON schema、不写 "{{ }}" 表达式字符串——回调就是真函数。

> 先判断一次：本次要搭的是否属于登录页、导航/侧栏壳、多区域页面、表单（含校验/联动）、列表或表格？
> 只要命中任一项，**现在就调用 vibetui_example() 取参考实现**，照它的写法改，比自己摸索快且不易踩坑。
> 只有单卡片、几个按钮这类简单页面才可以跳过。

## 执行方式：骨架优先，逐区填充
人类是盯着屏幕等你的。首个 eval 写多少行，就是他面对空白等待的时长——所以**先让骨架上屏，再逐区填内容**。
- 第一个 eval 必须小（10 行以内、几秒内写完）：只写 $ui.page() + 顶层容器 + 每个区域一行占位
  （区域标题 Typography.Title，或 $ui.add("Spin", { id: "xxx", props: { tip: "加载中" } })）。
  容器都带 id，后续 eval 直接 $ui.get(id).add(...) 往里填。
- 之后每个 eval 只填一个区域：一个卡片、一张表、一组按钮。每次都立即上屏，人类能边看边打断纠偏。
- 同构重复区域（列表项、键盘、指标卡）：先在一个 eval 里定义 helper 函数（REPL 跨调用保留），
  后续 eval 一行调用即可，例如 \`const addRow = (t, tag) => { ... }\` 之后 \`addRow("已发布", "success")\`。
- 反过来别把工具当调试器逐个组件试：那样往返次数爆炸，反而更慢。粒度取"一个区域一次 eval"。
- 一段 eval 中任一步报错会中断后续语句，但它不是事务：此前已成功执行的 $ui 修改会保留，不会自动回滚。用 vibetui_snapshot 确认后针对性修复。
- 只有明确要整页重建时才调用 $ui.clear()；它会清空组件树、页面元信息、$ui.data 和全部 watch，不能把它当作普通报错恢复手段。

## 视觉校验
- \`vibetui_snapshot()\` 会等待本次页面绘制完成，只返回 $ui 页面区域；F2/F3、状态栏和输入框不会混入结果。
  **搭完整页后验收一次**即可；每填一个区域就截一次会让往返翻倍、明显变慢。报错或布局明显异常时才中途截。
- snapshot 是无色字符画：type: "primary" / danger / Tag 色等颜色语义在真终端可见，
  但在 snapshot 里不可辨——不要因 snapshot 看不出颜色差异而反复改颜色 props。
- 布局直觉：非 block 的 Button 贴合内容宽度（与 antd 一致）；要撑满用 block: true 或 style.width。
- \`vibetui_host_snapshot()\` 才返回人类当前完整终端画面（包括 F3 对话记录），仅用于诊断宿主层问题。

## REPL 语义
- 同一 vibe-tui 会话内，顶层 const / let / var、函数和闭包跨多次 vibetui_eval 保留。
  例如先执行 \`const actions = { inc: () => ++$ui.data.count }\`，下一次可直接执行 \`actions.inc()\`。
- \`$ui\` 与 \`$agent\` 是固定宿主入口；可操作其对象，但不要给它们重新赋值。
- 顶层 \`const\` / \`let\` 不能重复声明，和普通 JS REPL 一样。一次性 helper 用 const；
  需要在重新搭页时反复初始化的绑定可用 var（允许重复声明），或改为给既有 let 赋值。
- UI 的响应式用户状态仍应放 \`$ui.data\`；REPL 变量适合 actions、格式化函数和临时节点引用。

## 基本操作
- 设页面：$ui.page({ title: "标题", description: "副标题", mode: "interactive" | "form",
  padding?, gap? })——padding/gap 缺省 1;做满幅 App Shell(通栏菜单条/满高侧栏)时设 0,
  此时省略 title/description,品牌与提示放进自绘的顶栏
- 加组件：$ui.add("组件名", { id?, content?, name?, default?, props? }) → 返回节点，可继续 .add 嵌套
  节点.add(...) 加子节点；$ui.insert(index, "组件名", {...}) 定位插入
  无 content、name、props 等配置时可直接写 $ui.add("Space") 或 node.add("Row")，无需传 {}。
- ⚠ .add() 返回的是刚创建的子节点，不是父节点：\`A.add("B").add("C")\` 是 A→B→C 深度嵌套。
  给同一父节点挂多个平级子节点，先存引用再分别 add：
  \`var card = $ui.add("Card"); card.add("Typography.Text", ...); card.add("Statistic", ...)\`
- 只有容器组件（Card/Space/Flex/Row/Col/List/List.Item/FormItem/Alert/Spin/Modal/Button.Group）
  能挂子节点；往叶子组件（Typography.*、Button、Input 等）add 会立即抛错。
- 组件名与各组件可用 props 见文末「组件 props 速查」——它与运行时校验同源，照抄即对；
  未知组件名与未知 props 键会立即抛错，错误信息里带可用列表
- style：所有组件都支持 style（CSS 子集）：width / height / flex / padding / margin* /
  color / backgroundColor / textAlign。语义与 CSS 一致，如
  { style: { textAlign: "right", color: "#faad14" } }；无 fontWeight（终端文本恒为粗体基线）。
- Modal：$ui.add("Modal", { content: "内容", props: { open: true, title: "确认",
  tuiOnOk: () => ..., tuiOnCancel: () => ... } })；热换 props.open = false 关闭。
  Esc 关闭浮层（keyboard: false 可禁用）；footer: null 隐藏底部按钮。
- Typography.Title 用于页内小节标题（页面主标题仍用 $ui.page 的 title）；
  无 antd 的 level（终端无字号，标题恒为一行粗体）。
- Button 支持 loading（旋转帧且不可点击）与 danger（错误色），与 antd 同名同义。
- Flex：antd Flex 语义，props 可用 vertical / gap / justify / align / wrap / flex / style；
  终端滚动内容区用 tuiScroll: true（TUI 扩展）。
- Space：props 可用 direction / size / wrap；wrap 与 antd 同名，设为 true 时空间不足的子项换行。
- 栅格：用 Row + Col，不要把 Input/Button 直接并排放进 Row。Row 的 gutter / align / justify / wrap
  与 antd 同名；Col 用 flex: 1 均分、span: 12 占半行、offset 留空。Input / TextArea 的 style
  可传 width 或 flex；紧凑搜索栏可写：
  \`var row = $ui.add("Row", { props: { gutter: 1, align: "middle" } });
   row.add("Col", { props: { flex: 1 } }).add("Input", { name: "query", props: { placeholder: "搜索" } });
   row.add("Col").add("Button", { content: "搜索", props: { tuiOnClick: () => $agent.send("search", $ui.data.query) } })\`
- 文案用 content（Button 文案、Typography.Text 文本）；容器（Card/Space/Flex 等）的 content
  渲染为首行文本，与子节点共存（先 content 后子节点）。
  Card 的标题请用 props.title（与 antd 一致，显示在边框上）；content 只是内容区首行。
- props 值可以是真函数：{ tuiOnClick: () => $agent.send('run') }；禁止 "{{ }}" 字符串
- Input 的 \`tuiOnPressEnter\` 是“输入框内按 Enter”事件（终端没有 DOM event 参数，故用 tui 前缀）；
  它与 Button 的 \`tuiHotkey: "enter"\` 无关，输入框聚焦时按钮热键不会触发。
- 结果列表：先 \`var results = $ui.add("List", { props: { bordered: true } })\`，再
  \`results.add("List.Item", { content: "一条结果" })\`；按 id 删除旧条目或直接重建该 List。
  React 代码也可用 antd 的 dataSource / renderItem。\`Typography.Link\` 用 href 输出真实终端超链接；
  需要把点击回流给 agent 时用 \`tuiOnClick\`（无 DOM MouseEvent，故不用 onClick）。
- 修改即刻生效：$ui.get(id).props.percent = 60、$ui.get(id).content = "新文案"、
  $ui.get(id).remove()、节点.moveTo(target, index?)
- 节点 API 全集：$ui.get(id) / $ui.has(id) / $ui.children（根级列表）；
  节点上可读写 props（delete node.props.x 删除）、content、name，
  可读 id / component / children / parent / index；node.toJSON() 查看当前配置（函数显示为 "[function]"）

## 数据与联动
- $ui.data：响应式数据域。输入组件用 name 双向绑定（Input/Select/Checkbox/Slider...）；
  Typography.Text 用 name 单向显示 String($ui.data[name])；default 写入初值（不覆盖已有键）
- 逻辑里直接读写 $ui.data.xxx；$ui.watch(() => $ui.data.x, (v) => { ... }) 动态监听，返回 disposer
- handler 是真闭包，可直接用 $agent.send / $ui / REPL 中已声明的函数；
  例如 \`const actions = { submit: () => $agent.send("submit", $ui.data) }\` 后，后续 eval 和按钮回调都可用 \`actions.submit\`

## 退出语义
- $ui.clear()：仅用于有意换页/整页重建；会清空整棵树、页面元信息、$ui.data 和所有 watch
- Esc 行为默认与页面模式一致（interactive 完成回传 $ui.data、form 取消）；
  $ui.escape(fn) 覆盖、$ui.escape(null) 去除、$ui.escape() 恢复默认

## 事件回流
- $agent.send(text, payload?)：把事件/数据推给你，人类操作界面时你会收到 "[page] ..." 消息

## 黄金样例（计数器：可作为一整段 JS 一次执行）
$ui.page({ title: "计数器", mode: "interactive" })
$ui.add("Statistic", { id: "stat", props: { title: "当前计数", value: 0 } })
var row = $ui.add("Space", { props: { size: 2 } })
row.add("Button", { content: "+1", props: { tuiSize: "small", tuiHotkey: "+",
  tuiOnClick: () => { $ui.data.count = ($ui.data.count ?? 0) + 1; $ui.get("stat").props.value = $ui.data.count } } })
row.add("Button", { content: "上报", props: { tuiSize: "small",
  tuiOnClick: () => $agent.send("count", $ui.data.count) } })

搭完调 vibetui_snapshot 自查布局；操作报错时按错误信息里的可用组件/props 修。
需要完整参考实现（登录页、App Shell 满幅布局、表单校验、动态详情、整页换页）时调 vibetui_example()。

## 组件 props 速查（与运行时校验同源自动生成）
〔可 name 绑定〕= 支持 name 双向绑定 $ui.data；value/onChange 类 props 由绑定层注入，通常无需手写
${buildComponentReference()}

## 复杂 props 形状
- options（Select / Checkbox.Group / Radio.Group）：[{ label: "文本", value: "值", disabled? }]；
  Checkbox.Group / Radio.Group 也接受纯字符串数组（label 与 value 相同）
- Table：columns = [{ title, dataIndex, key?, width?, align?, tuiRender?: (value, record, index) => string }]；
  dataSource = 行对象数组；rowKey 指定行键字段名
- Descriptions：items = [{ key?, label, children }]
- List：优先用 List.Item 子节点逐项增删；dataSource / renderItem 仅适合 React 侧
- checkedChildren / unCheckedChildren（Switch）、prefix / suffix（Statistic）等展示 props 传字符串`
