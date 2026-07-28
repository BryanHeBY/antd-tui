/**
 * 页面 Schema（信封协议）定义与校验。
 * 两级概念：外层信封是本引擎的「页面 Schema」；其中 form 字段的值
 * 才是 Formily 生态定义的「表单 Schema」（ISchema，SchemaField 消费）。
 *
 * 面向 agent 生成的输入，校验策略是「尽可能拒绝」：
 * 未知键报错（拦 typo）、表达式在 dry-run 阶段做语法解析与未定义引用检查
 * （只解析不执行）、字段结构按 Formily 子集深查。
 * 不引入 ajv，用轻量结构校验 + 白名单遍历，错误信息带 JSON 路径、一次性收集。
 */

export interface PageAction {
  type: "submit" | "cancel"
  label?: string
}

export interface PageSchema {
  version: string
  page?: {
    title?: string
    description?: string
    /**
     * 页面模式，默认 "form"。
     * form：底部操作栏（actions，缺省为提交+取消），Esc 取消。
     * interactive：无操作栏的自包含交互页面，Esc 完成并回传当前值。
     */
    mode?: "form" | "interactive"
  }
  /** 具名表达式函数表：{ 函数名: "{{ 箭头函数 }}" }，编译后注入 form 表达式作用域（含 $form/$state/$memo） */
  scope?: Record<string, string>
  /**
   * 页面级响应式状态初值。运行时包装为 observable 注入 $state：
   * 表达式读 $state.xxx 自动响应、scope 函数可写；不进 form.values、不回传。
   * 分工：$state = 驱动渲染的 UI 状态；$memo = 非渲染状态（timer 等）；form.values = 只装用户输入。
   */
  state?: Record<string, unknown>
  /** 终端主题覆盖；种子色（colorPrimary/colorSuccess/colorWarning/colorError）经暗色算法派生。 */
  tuiTheme?: { token?: Record<string, string | number> }
  /** 表单 Schema：Formily ISchema，根节点须为 type: "object" */
  form: Record<string, unknown>
  actions?: PageAction[]
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const ENVELOPE_KEYS = new Set(["version", "page", "scope", "state", "tuiTheme", "form", "actions"])
const PAGE_KEYS = new Set(["title", "description", "mode"])
const ACTION_KEYS = new Set(["type", "label"])
const THEME_KEYS = new Set(["token"])
const ACTION_TYPES = new Set(["submit", "cancel"])

const BORDER_STYLES = new Set(["single", "rounded", "double", "heavy"])
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** 字段节点允许的键（Formily ISchema 本引擎消费的子集） */
const NODE_KEYS = new Set([
  "type",
  "title",
  "description",
  "default",
  "enum",
  "required",
  "properties",
  "items",
  "x-component",
  "x-decorator",
  "x-component-props",
  "x-decorator-props",
  "x-content",
  "x-hidden",
  "x-visible",
  "x-display",
  "x-disabled",
  "x-read-only",
  "x-read-pretty",
  "x-reactions",
  "x-validator",
  "x-value",
  "x-index",
  "x-pattern",
])

const FIELD_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "void",
  "date",
  "datetime",
])

const EXPR_RE = /^\s*\{\{([\s\S]*)\}\}\s*$/

/** 表达式作用域内置可用名（运行时由 engine 注入或 JS 全局） */
const EXPR_GLOBALS = new Set([
  "$form",
  "$state",
  "$memo",
  "$self",
  "$deps",
  "$values",
  "$record",
  "$index",
  "Math",
  "JSON",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "Date",
  "RegExp",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Function",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "console",
])

const JS_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "typeof",
  "new",
  "void",
  "delete",
  "function",
  "in",
  "of",
  "do",
  "else",
  "try",
  "finally",
  "throw",
])

/**
 * 表达式静态检查（只解析不执行）：
 * 1. 语法：new Function 解析失败即报错，把运行时暴雷前移到 dry-run；
 * 2. 未定义调用：表达式里 name(...) 形式的调用，name 必须是 scope 函数、
 *    内置全局或表达式内自行声明的名字（启发式，字符串字面量已剔除避免误报）。
 */
function checkExpression(
  raw: string,
  path: string,
  scopeNames: Set<string>,
  errors: string[],
): void {
  const m = EXPR_RE.exec(raw)
  if (!m) return
  const inner = m[1]!
  try {
    // 仅做语法解析，函数体不会被调用
    new Function(`return (${inner})`)
  } catch (err) {
    errors.push(`${path} 表达式语法错误：${(err as Error).message}`)
    return
  }

  // 剔除字符串/模板字面量，避免文案里的 "xxx(" 误报
  const stripped = inner.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')

  const declared = new Set<string>()
  for (const dm of stripped.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(dm[1]!)
  }
  // 箭头函数参数：(a, b) => 与 a =>
  for (const pm of stripped.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of pm[1]!.split(",")) {
      const name = part.trim().split(/[=:\s]/)[0]
      if (name) declared.add(name)
    }
  }
  for (const pm of stripped.matchAll(/(?<![\w$)])([A-Za-z_$][\w$]*)\s*=>/g)) {
    declared.add(pm[1]!)
  }

  for (const cm of stripped.matchAll(/(?<![.\w$)])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = cm[1]!
    if (
      JS_KEYWORDS.has(name) ||
      EXPR_GLOBALS.has(name) ||
      scopeNames.has(name) ||
      declared.has(name)
    ) {
      continue
    }
    errors.push(
      `${path} 调用了未定义的函数 "${name}"（不在 scope 段，也不是内置全局）`,
    )
  }
}

/** 深挖一个值（props 对象/x-reactions 等）里的全部表达式字符串做静态检查 */
function checkExpressionsDeep(
  value: unknown,
  path: string,
  scopeNames: Set<string>,
  errors: string[],
): void {
  if (typeof value === "string") {
    checkExpression(value, path, scopeNames, errors)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkExpressionsDeep(item, `${path}/${i}`, scopeNames, errors))
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      checkExpressionsDeep(child, `${path}/${key}`, scopeNames, errors)
    }
  }
}

function reportUnknownKeys(
  obj: Record<string, unknown>,
  allowedKeys: Set<string>,
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}/${key} 是未知键（可用：${[...allowedKeys].join(", ")}）`)
    }
  }
}

export function validatePageSchema(
  input: unknown,
  whitelist: string[],
  propsWhitelist?: Record<string, readonly string[]>,
): ValidationResult {
  const errors: string[] = []
  const allow = new Set(whitelist)

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["根节点必须是 JSON 对象"] }
  }
  const root = input as Record<string, unknown>

  reportUnknownKeys(root, ENVELOPE_KEYS, "", errors)

  if (typeof root.version !== "string") {
    errors.push("/version 必须是字符串")
  }

  if (root.page !== undefined) {
    if (typeof root.page !== "object" || root.page === null) {
      errors.push("/page 必须是对象")
    } else {
      reportUnknownKeys(root.page as Record<string, unknown>, PAGE_KEYS, "/page", errors)
      const mode = (root.page as Record<string, unknown>).mode
      if (mode !== undefined && mode !== "form" && mode !== "interactive") {
        errors.push('/page/mode 必须是 "form" 或 "interactive"')
      }
    }
  }

  // 先收集 scope 函数名，供全树表达式的未定义引用检查使用
  const scopeNames = new Set<string>()
  if (root.scope !== undefined) {
    if (typeof root.scope !== "object" || root.scope === null || Array.isArray(root.scope)) {
      errors.push("/scope 必须是对象")
    } else {
      for (const name of Object.keys(root.scope as Record<string, unknown>)) scopeNames.add(name)
      for (const [name, expr] of Object.entries(root.scope as Record<string, unknown>)) {
        if (typeof expr !== "string") {
          errors.push(`/scope/${name} 必须是 "{{ 表达式 }}" 字符串`)
        } else if (!EXPR_RE.test(expr)) {
          // 未包裹的字符串不会被 Formily 编译成函数，运行时才暴雷；提前到 dry-run 报错
          errors.push(`/scope/${name} 表达式必须整体包裹在 {{ }} 中`)
        } else {
          checkExpression(expr, `/scope/${name}`, scopeNames, errors)
        }
      }
    }
  }

  if (root.state !== undefined) {
    if (typeof root.state !== "object" || root.state === null || Array.isArray(root.state)) {
      errors.push("/state 必须是对象")
    }
  }

  if (root.tuiTheme !== undefined) {
    if (typeof root.tuiTheme !== "object" || root.tuiTheme === null || Array.isArray(root.tuiTheme)) {
      errors.push("/tuiTheme 必须是对象")
    } else {
      reportUnknownKeys(root.tuiTheme as Record<string, unknown>, THEME_KEYS, "/tuiTheme", errors)
      const themeToken = (root.tuiTheme as Record<string, unknown>).token
      if (themeToken !== undefined) {
        if (typeof themeToken !== "object" || themeToken === null || Array.isArray(themeToken)) {
          errors.push("/tuiTheme/token 必须是对象")
        } else {
          for (const [name, value] of Object.entries(themeToken as Record<string, unknown>)) {
            if (typeof value !== "string" && typeof value !== "number") {
              errors.push(`/tuiTheme/token/${name} 必须是字符串或数字`)
            } else if (name.startsWith("color")) {
              // 非法 hex 会在色板派生里算出 NaN，静默渲染成 #NaNNaN；提前拦截
              if (typeof value !== "string" || !(HEX_COLOR_RE.test(value) || value === "transparent")) {
                errors.push(`/tuiTheme/token/${name} 必须是 #RGB / #RRGGBB 色值（或 "transparent"）`)
              }
            } else if (name === "borderStyle" && !BORDER_STYLES.has(value as string)) {
              errors.push(`/tuiTheme/token/borderStyle 必须是 ${[...BORDER_STYLES].join(" / ")} 之一`)
            }
          }
        }
      }
    }
  }

  if (typeof root.form !== "object" || root.form === null) {
    errors.push("/form 必须是 Formily schema 对象")
  } else {
    const form = root.form as Record<string, unknown>
    if (form.type !== "object") {
      errors.push('/form/type 必须为 "object"')
    }
    walkSchema(form, "/form", allow, scopeNames, errors, propsWhitelist)
  }

  if (root.actions !== undefined) {
    if (!Array.isArray(root.actions)) {
      errors.push("/actions 必须是数组")
    } else {
      root.actions.forEach((action, i) => {
        if (typeof action !== "object" || action === null) {
          errors.push(`/actions/${i} 必须是对象`)
          return
        }
        const a = action as Record<string, unknown>
        reportUnknownKeys(a, ACTION_KEYS, `/actions/${i}`, errors)
        if (typeof a.type !== "string" || !ACTION_TYPES.has(a.type)) {
          errors.push(`/actions/${i}/type 必须是 "submit" 或 "cancel"`)
        }
      })
    }
  }

  return { ok: errors.length === 0, errors }
}

/** 递归遍历 Formily schema：白名单、未知键、结构形状与表达式静态检查 */
function walkSchema(
  node: Record<string, unknown>,
  path: string,
  allow: Set<string>,
  scopeNames: Set<string>,
  errors: string[],
  propsWhitelist?: Record<string, readonly string[]>,
): void {
  reportUnknownKeys(node, NODE_KEYS, path, errors)

  if (node.type !== undefined && !FIELD_TYPES.has(node.type as string)) {
    errors.push(`${path}/type "${String(node.type)}" 不是合法字段类型（可用：${[...FIELD_TYPES].join(", ")}）`)
  }

  for (const key of ["x-component", "x-decorator"] as const) {
    const name = node[key]
    if (name !== undefined) {
      if (typeof name !== "string") {
        errors.push(`${path}/${key} 必须是字符串`)
      } else if (!allow.has(name)) {
        errors.push(`${path}/${key} "${name}" 不在组件白名单内（可用：${[...allow].join(", ")}）`)
      }
    }
  }

  if (node.enum !== undefined && !Array.isArray(node.enum)) {
    errors.push(`${path}/enum 必须是数组`)
  }

  if (node.required !== undefined && typeof node.required !== "boolean") {
    errors.push(`${path}/required 必须是布尔值`)
  }

  for (const key of ["x-component-props", "x-decorator-props"] as const) {
    const props = node[key]
    if (props !== undefined) {
      if (typeof props !== "object" || props === null || Array.isArray(props)) {
        errors.push(`${path}/${key} 必须是对象`)
      } else {
        // props 键白名单：按组件拒绝臆造/拼错的属性名
        const ownerKey = key === "x-component-props" ? "x-component" : "x-decorator"
        const owner = node[ownerKey]
        const allowed =
          typeof owner === "string" ? propsWhitelist?.[owner] : undefined
        if (allowed) {
          for (const propName of Object.keys(props as Record<string, unknown>)) {
            if (!allowed.includes(propName)) {
              errors.push(
                `${path}/${key}/${propName} 不是 ${String(owner)} 的合法属性（可用：${allowed.join(", ")}）`,
              )
            }
          }
        }
        checkExpressionsDeep(props, `${path}/${key}`, scopeNames, errors)
      }
    }
  }

  const reactions = node["x-reactions"]
  if (reactions !== undefined) {
    const list = Array.isArray(reactions) ? reactions : [reactions]
    list.forEach((r, i) => {
      const p = Array.isArray(reactions) ? `${path}/x-reactions/${i}` : `${path}/x-reactions`
      if (typeof r !== "object" || r === null) {
        errors.push(`${p} 必须是对象`)
      } else {
        checkExpressionsDeep(r, p, scopeNames, errors)
      }
    })
  }

  if (node["x-content"] !== undefined) {
    const content = node["x-content"]
    if (typeof content !== "string" && typeof content !== "number") {
      errors.push(`${path}/x-content 必须是字符串或数字`)
    } else if (typeof content === "string") {
      checkExpression(content, `${path}/x-content`, scopeNames, errors)
    }
  }

  const properties = node.properties
  if (properties !== undefined) {
    if (typeof properties !== "object" || properties === null) {
      errors.push(`${path}/properties 必须是对象`)
      return
    }
    for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
      if (typeof child !== "object" || child === null) {
        errors.push(`${path}/properties/${name} 必须是对象`)
        continue
      }
      walkSchema(
        child as Record<string, unknown>,
        `${path}/properties/${name}`,
        allow,
        scopeNames,
        errors,
        propsWhitelist,
      )
    }
  }

  // items（数组场景，PoC 预留）
  const items = node.items
  if (items !== undefined && typeof items === "object" && items !== null && !Array.isArray(items)) {
    walkSchema(items as Record<string, unknown>, `${path}/items`, allow, scopeNames, errors, propsWhitelist)
  }
}
