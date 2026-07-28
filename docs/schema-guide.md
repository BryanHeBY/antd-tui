# antd-tui 页面 Schema 编写规范

面向生成页面 Schema 的 Agent 与人类作者。engine 读入一份 JSON(信封协议),校验后渲染为交互式终端界面,交互结果以 NDJSON 写回 stdout。完整可运行的黄金样例见 `examples/`(索引见第 7 节)。

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
  "state": {                        // 可选：响应式 UI 状态初值（$state，不回传，见第 2 节）
    "current": 0
  },
  "theme": {                        // 可选：主题覆盖，形状同 antd ConfigProvider
    "token": { "colorPrimary": "#722ed1" }
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

### theme:主题覆盖

形状完全对齐 antd ConfigProvider 的 `theme.token`。种子色(`colorPrimary` / `colorSuccess` / `colorWarning` / `colorError`)传 antd 亮色 seed 值即可,引擎内置 antd 暗色算法(darkAlgorithm 等价实现)自动派生贴合黑底的低饱和色阶——与 antd 暗色主题同源同值,不要自己调暗颜色:

```jsonc
"theme": { "token": { "colorPrimary": "#722ed1" } }   // 紫色主题,派生填充 #3e2069(深)、前景 #cda8f0(亮)
```

终端适配差异:algorithm 固定为暗色(终端默认黑底);主基调为「背景填充取色板深端、前景点缀取亮端」——终端字形纤细,填充要深、前景要亮,色相灰蓝、轻微可辨(与 antd 网页端的取档不同)。

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

### 表达式可用的作用域:三个状态通道各司其职

| 名称 | 响应式 | 回传 | 用途 |
|---|---|---|---|
| `$form` | ✅ | ✅ | **只装用户输入**。读值 `$form.values.xxx`,写值 `$form.setValuesIn('xxx', v)` |
| `$state` | ✅ | ❌ | 驱动渲染的 UI 状态(当前选中项、模拟负载等)。初值在信封 `state` 段声明,表达式读 `$state.xxx` 自动联动,scope 函数直接赋值 `$state.xxx = v` |
| `$memo` | ❌ | ❌ | 非渲染状态(timer 句柄、"上次按键是 ="标记位) |
| scope 函数 | — | — | 按名直接调用 |

**纪律:不要把 UI 内部状态或静态展示数据放进 `form` 字段**——interactive 模式 Esc 回传 `form.values`,里面必须只有用户输入。静态展示值(如 Statistic 的数字)用 void 节点 + `x-component-props.value` 传入。

```jsonc
"state": { "current": 0, "cpu": 42 },
"scope": { "addLoad": "{{ (d) => { $state.cpu = Math.min(100, $state.cpu + d) } }}" },
"form": { ... "x-component-props": { "percent": "{{ $state.cpu }}" } ... }
```

⚠️ scope 里可用 `Function()` 求值(如计算器),第一阶段不做限制;长期会提供受控的求值助手,新 schema 尽量少依赖裸 eval。

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

生成后必须先过校验再交付,两档都无需 TTY:

```sh
# 静态校验:结构、未知键(拦 typo)、组件与 props 键白名单、表达式语法与未定义引用
bun packages/engine/src/cli.ts --schema your.schema.json --dry-run

# 静态校验 + 无头渲染一帧:再兜住表达式运行时崩溃、props 类型错等动态问题(推荐)
bun packages/engine/src/cli.ts --schema your.schema.json --check
```

校验失败输出 `{"event":"invalid","errors":[...]}`(退出码 2),errors 带 JSON 路径且一次性列全,按路径逐条修复即可。

## 7. 示例索引:什么场景抄哪个

每个示例对应一种页面范式,生成时先归类场景、再照抄对应示例的结构:

| 示例 | 范式 | 覆盖的知识点 |
|---|---|---|
| `examples/deploy-config.schema.json` | 填表回传 | form 模式、`x-decorator: FormItem`、全部录入组件(Input/InputNumber/TextArea/Slider/Select/Checkbox(Group)/RadioGroup/Switch)、`title`/`required`/`default`/`enum`、`x-validator` pattern 校验、`x-reactions` 联动显隐、自定义 `actions` 文案 |
| `examples/service-dashboard.schema.json` | 信息展示 + 轻交互 | interactive 模式、全部展示组件(Alert/Tag/Statistic/Progress/Descriptions/Spin/Table/Divider)、Card/Space/Row/Col 布局、`state` 段 + `$state` 驱动交互、`x-component-props` 动态表达式 |
| `examples/calculator.schema.json` | 自包含交互应用 | interactive 模式、逻辑全收进 scope 函数、`$memo` 隐藏状态、单字符热键矩阵、`x-content` 文案、Grid 自适应布局 |

Formily 习惯写法提示(与 @formily/antd 一致):

- 字段标签用 schema `title`(FormItem 自动读取),不要写进 `x-component-props`
- 选项用 schema `enum`(自动转组件 `options`),初始值用 `default`,必填用 `required`
- 展示"用户输入值"的组件(如 ResultText)挂在**数据字段**上,值走 `field.value`;静态展示数据(如 Statistic 的指标数字)用 void 节点 + `x-component-props.value`,动态展示用 `{{ $state.xxx }}` 表达式——不要为展示数据开真值字段(会混进回传)
- 联动显隐用标准 `x-reactions`:`{ "dependencies": ["其他字段"], "fulfill": { "state": { "visible": "{{ $deps[0] === true }}" } } }`
- 终端只有两类热键:单字符(匹配可见字符)与命名键(如 `backspace`),同一 schema 里两类可并存,框架按长度自动区分

注意:终端无滚动,页面自然高度应控制在目标终端行数内(内容超高会被压缩变形)。
