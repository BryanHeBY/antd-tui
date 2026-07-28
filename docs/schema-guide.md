# antd-tui 页面 Schema 编写规范

面向生成页面 Schema 的 Agent 与人类作者。engine 读入一份 JSON(信封协议),校验后渲染为交互式终端界面,交互结果以 NDJSON 写回 stdout。完整可运行的黄金样例见 `examples/calculator.schema.json`。

两级概念:外层信封整体是本引擎的「页面 Schema」;其中 `form` 字段的值才是 Formily 生态定义的「表单 Schema」(ISchema,由 SchemaField 消费)。

## 1. 信封协议

```jsonc
{
  "version": "0.1",
  "page": {
    "title": "页面标题",            // 可选
    "description": "副标题说明",    // 可选
    "mode": "form"                  // 可选："form"（默认）| "interactive"
  },
  "scope": {                        // 可选：具名表达式函数表
    "fnName": "{{ (arg) => ... }}"
  },
  "form": { "type": "object", "properties": { ... } },  // Formily 表单 Schema（ISchema），根节点必须是 object
  "actions": [                      // 可选，仅 form 模式生效；缺省 = 提交 + 取消
    { "type": "submit", "label": "提交" },
    { "type": "cancel", "label": "取消" }
  ]
}
```

### page.mode

- `form`(默认):底部渲染操作栏(`actions`),Esc 取消。适合"填完提交"的表单页。
- `interactive`:不渲染操作栏,Esc 完成并回传当前 `form.values`。适合计算器这类自包含交互页面。

### 输出协议(stdout,NDJSON)

| 事件 | 含义 | 退出码 |
|---|---|---|
| `{"event":"valid"}` | `--dry-run` 校验通过 | 0 |
| `{"event":"submit","values":{...}}` | 用户提交(interactive 模式 Esc 同此) | 0 |
| `{"event":"cancel"}` | 用户取消 | 1 |
| `{"event":"invalid","errors":[...]}` | 页面 Schema 校验失败 | 2 |
| `{"event":"error","message":"..."}` | 运行错误 / 环境不满足 | 2 / 3 |

## 2. scope:逻辑收进具名函数

**规则:交互逻辑一律定义在 `scope` 段的具名函数里,`x-component-props` 中只写一行调用。** 不要把多语句逻辑内联进组件 props——那会导致重复、难审查、bug 藏进长字符串。

```jsonc
"scope": {
  "pressDigit": "{{ (d) => { const s = $form.values.display; $form.setValuesIn('display', s === '0' ? d : s + d) } }}"
},
"form": { ... "x-component-props": { "onClick": "{{ () => pressDigit('7') }}" } ... }
```

- 函数名用动词短语:`pressDigit` / `evaluate` / `clearAll`
- 表达式必须整体包裹在 `{{ }}` 中;多语句用 block-body 箭头函数 `{{ () => { ...; ... } }}`
- scope 函数之间可互相调用,不受定义顺序限制

### 表达式可用的作用域

| 名称 | 说明 |
|---|---|
| `$form` | Formily 表单实例。读值 `$form.values.xxx`,写值 `$form.setValuesIn('xxx', v)`(联动刷新绑定该字段的展示组件) |
| `$memo` | 页面级可变对象,存放隐藏交互状态(如"上次按键是 ="标记)。**不进 `form.values`、不回传** |
| scope 函数 | 按名直接调用 |

## 3. 组件字段约定

- 组件与字段最大程度对齐 antd:同名字段行为完全一致;`tui` 前缀 = TUI 扩展或有终端适配差异(如 `tuiSize`、`tuiHotkey`)
- 可用组件以 engine 校验白名单为准(`--dry-run` 报错信息会列出全量)

### 文案用 x-content

void 节点的显示文案用 `x-content`,不要用 `x-component-props.children`:

```jsonc
"btnClear": {
  "type": "void",
  "x-component": "Button",
  "x-content": "AC",
  "x-component-props": { "onClick": "{{ () => clearAll() }}" }
}
```

### tuiHotkey 命名空间

- **单字符**(`"7"` `"+"` `"%"`):匹配可见字符(按键序列)
- **多字符**(`"backspace"` `"f1"`):匹配命名键
- 输入类组件(Input 等)聚焦时热键静默,按键归输入组件

## 4. 节点命名

void 节点名不参与取值,但影响可读性与 LLM 模仿质量。用语义化命名:

- 行:`rowTop` / `rowSeven`;列:`colClear` / `col7`;按钮:`btnClear` / `btn7` / `btnEquals`
- 取值字段(非 void)按业务命名:`display` / `username`

## 5. 自适应布局样板

终端高度自适应用 antd 兼容语法表达,框架负责映射到终端布局引擎:

```jsonc
"rowTop": {
  "type": "void",
  "x-component": "Row",
  "x-component-props": { "gutter": 1, "style": { "flex": 1 } },   // 行均分剩余高度
  "properties": {
    "colClear": {
      "type": "void",
      "x-component": "Col",
      "x-component-props": { "flex": 1 },                          // 列按 flex 比例分宽
      "properties": {
        "btnClear": {
          "type": "void",
          "x-component": "Button",
          "x-content": "AC",
          "x-component-props": {
            "tuiSize": "small",
            "block": true,                                         // 撑满列宽
            "style": { "height": "100%" }                          // 撑满行高
          }
        }
      }
    }
  }
}
```

## 6. 校验

提交前先跑结构校验(不渲染、无需 TTY):

```sh
bun packages/engine/src/cli.ts --schema your.schema.json --dry-run
```
