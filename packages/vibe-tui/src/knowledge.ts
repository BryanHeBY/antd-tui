/**
 * agent 冷启动知识:硬编码的引导 prompt 与 schema 精简指南。
 * vibe-tui 可能运行在任意 cwd(乃至编译产物中),不能依赖仓库文档文件,
 * 因此关键规范内嵌于此;完整版见仓库 docs/schema-guide.md。
 */

/** 会话就绪后立即注入(新建与恢复都注入):让 agent 知道自己身处 vibe-tui */
export const BOOT_PROMPT = [
  "你已连接 vibe-tui —— 一块由你(agent)驱动的终端 UI 画布。人类通过底部输入框与你对话,也会直接操作你渲染的界面。",
  "可用 MCP 工具:",
  "- vibetui_guide():页面 Schema 编写规范与样例,画任何页面前先读它",
  "- vibetui_render(schema):渲染/替换画布页面,校验失败会返回带 JSON 路径的错误",
  "- vibetui_eval(code):在页面上下文执行 JS 读写数据(不换页,界面自动联动)",
  "- vibetui_snapshot():查看当前画布字符画",
  '界面事件会以 "[page] ..." 开头的消息回流给你(按钮点击、表单 submit 的 JSON 等)。',
  "现在:先调用 vibetui_guide 学习规范,然后渲染一个适合当前对话场景的初始界面;若没有明确场景,渲染一个简洁的欢迎页(标题 + 一句能力介绍 + 几个引导按钮,按钮用 $agent.send 把用户意图回流给你)。",
].join("\n")

/** vibetui_guide 工具返回的内容:精简规范 + 一个可直接照抄的黄金样例 */
export const SCHEMA_GUIDE = `# antd-tui 页面 Schema 速成(vibe-tui 版)

页面 = 一份 JSON(信封协议),字段与 antd v5 + Formily 完全同语义,不要发明字段。

## 信封结构
{
  "version": "0.1",
  "page": { "title": "标题", "description": "副标题", "mode": "form" | "interactive" },
  "scope": { "fnName": "{{ (arg) => { ... } }}" },     // 具名函数表,逻辑全收在这里
  "state": { "count": 0 },                              // 响应式 UI 状态初值($state,不回传)
  "theme": { "token": { "colorPrimary": "#722ed1" } },  // 可选,antd ConfigProvider 形状
  "form": { "type": "object", "properties": { ... } },  // Formily ISchema,根必须 object
  "actions": [ { "type": "submit", "label": "提交" }, { "type": "cancel" } ]  // 仅 form 模式
}

## 模式
- form:填表回传,底部渲染 actions(缺省 提交+取消)
- interactive:自包含交互页(仪表盘/工具),无操作栏

## 三个状态通道
- $form:只装用户输入。读 $form.values.xxx,写 $form.setValuesIn('xxx', v)
- $state:响应式 UI 状态(state 段声明初值),表达式读 {{ $state.xxx }} 自动联动,函数里直接赋值
- $memo:非渲染状态(timer/标记位)
纪律:展示数据不要开真值字段;interactive 回传的 form.values 里只能有用户输入。

## vibe-tui 专属
- $agent.send(text, payload?):把事件/数据推给 agent,如 "tuiOnClick": "{{ () => $agent.send('refresh', $form.values) }}"
- vibetui_eval 修改的是运行时数据;vibetui_render 会按 schema 初值重置

## 可用组件(x-component)
录入:Input / TextArea / InputNumber / Select / Checkbox / CheckboxGroup / RadioGroup / Switch / Slider(均配 "x-decorator": "FormItem",标签用 title,选项用 enum,必填 required: true)
展示:Alert / Tag / Statistic / Progress / Descriptions / Spin / Table / Divider / ResultText
布局:Card / Space / Row / Col
按钮:Button(文案用 x-content;props: type/tuiSize/tuiHotkey/tuiOnClick)

## 常用写法
- 文案一律 x-content,不用 children
- 联动显隐: "x-reactions": { "dependencies": ["其他字段"], "fulfill": { "state": { "visible": "{{ $deps[0] === true }}" } } }
- 校验: "required": true 与 "x-validator": { "pattern": "^[a-z]+$", "message": "..." } / { "minimum": 1, "maximum": 65535 }
- 静态展示值挂 void 节点 + x-component-props.value;动态展示用 {{ $state.xxx }} 表达式
- 终端无滚动条概念,页面自然高度别超终端;热键单字符("a")或命名键("backspace")

## 黄金样例(interactive 计数器,可直接照抄结构)
{
  "version": "0.1",
  "page": { "title": "计数器", "mode": "interactive" },
  "state": { "count": 0 },
  "scope": { "inc": "{{ (d) => { $state.count += d } }}" },
  "form": {
    "type": "object",
    "properties": {
      "stat": { "type": "void", "x-component": "Statistic",
        "x-component-props": { "title": "当前计数", "value": "{{ $state.count }}" } },
      "row": { "type": "void", "x-component": "Space", "x-component-props": { "size": 2 },
        "properties": {
          "btnUp": { "type": "void", "x-component": "Button", "x-content": "+1",
            "x-component-props": { "tuiSize": "small", "tuiHotkey": "+", "tuiOnClick": "{{ () => inc(1) }}" } },
          "btnPush": { "type": "void", "x-component": "Button", "x-content": "上报",
            "x-component-props": { "tuiSize": "small", "tuiOnClick": "{{ () => $agent.send('count', $state.count) }}" } }
        } }
    }
  }
}

渲染后调 vibetui_snapshot 自查布局;校验失败按 errors 里的 JSON 路径逐条修。`
