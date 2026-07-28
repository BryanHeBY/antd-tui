/**
 * 页面 Schema（信封协议）定义与校验。
 * 两级概念：外层信封是本引擎的「页面 Schema」；其中 form 字段的值
 * 才是 Formily 生态定义的「表单 Schema」（ISchema，SchemaField 消费）。
 * 不引入 ajv，用轻量结构校验 + 组件白名单遍历，错误信息带 JSON 路径。
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
  /**
   * 主题覆盖，形状对齐 antd ConfigProvider：{ token: { colorPrimary: "#722ed1" } }。
   * 种子色（colorPrimary/colorSuccess/colorWarning/colorError）经暗色算法派生。
   */
  theme?: { token?: Record<string, string | number> }
  /** 表单 Schema：Formily ISchema，根节点须为 type: "object" */
  form: Record<string, unknown>
  actions?: PageAction[]
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const ACTION_TYPES = new Set(["submit", "cancel"])

const BORDER_STYLES = new Set(["single", "rounded", "double", "heavy"])
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function validatePageSchema(input: unknown, whitelist: string[]): ValidationResult {
  const errors: string[] = []
  const allow = new Set(whitelist)

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["根节点必须是 JSON 对象"] }
  }
  const root = input as Record<string, unknown>

  if (typeof root.version !== "string") {
    errors.push("/version 必须是字符串")
  }

  if (root.page !== undefined) {
    if (typeof root.page !== "object" || root.page === null) {
      errors.push("/page 必须是对象")
    } else {
      const mode = (root.page as Record<string, unknown>).mode
      if (mode !== undefined && mode !== "form" && mode !== "interactive") {
        errors.push('/page/mode 必须是 "form" 或 "interactive"')
      }
    }
  }

  if (root.scope !== undefined) {
    if (typeof root.scope !== "object" || root.scope === null || Array.isArray(root.scope)) {
      errors.push("/scope 必须是对象")
    } else {
      for (const [name, expr] of Object.entries(root.scope as Record<string, unknown>)) {
        if (typeof expr !== "string") {
          errors.push(`/scope/${name} 必须是 "{{ 表达式 }}" 字符串`)
        } else if (!/^\s*\{\{[\s\S]*\}\}\s*$/.test(expr)) {
          // 未包裹的字符串不会被 Formily 编译成函数，运行时才暴雷；提前到 dry-run 报错
          errors.push(`/scope/${name} 表达式必须整体包裹在 {{ }} 中`)
        }
      }
    }
  }

  if (root.state !== undefined) {
    if (typeof root.state !== "object" || root.state === null || Array.isArray(root.state)) {
      errors.push("/state 必须是对象")
    }
  }

  if (root.theme !== undefined) {
    if (typeof root.theme !== "object" || root.theme === null || Array.isArray(root.theme)) {
      errors.push("/theme 必须是对象")
    } else {
      const themeToken = (root.theme as Record<string, unknown>).token
      if (themeToken !== undefined) {
        if (typeof themeToken !== "object" || themeToken === null || Array.isArray(themeToken)) {
          errors.push("/theme/token 必须是对象")
        } else {
          for (const [name, value] of Object.entries(themeToken as Record<string, unknown>)) {
            if (typeof value !== "string" && typeof value !== "number") {
              errors.push(`/theme/token/${name} 必须是字符串或数字`)
            } else if (name.startsWith("color")) {
              // 非法 hex 会在色板派生里算出 NaN，静默渲染成 #NaNNaN；提前拦截
              if (typeof value !== "string" || !(HEX_COLOR_RE.test(value) || value === "transparent")) {
                errors.push(`/theme/token/${name} 必须是 #RGB / #RRGGBB 色值（或 "transparent"）`)
              }
            } else if (name === "borderStyle" && !BORDER_STYLES.has(value as string)) {
              errors.push(`/theme/token/borderStyle 必须是 ${[...BORDER_STYLES].join(" / ")} 之一`)
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
    walkSchema(form, "/form", allow, errors)
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
        if (typeof a.type !== "string" || !ACTION_TYPES.has(a.type)) {
          errors.push(`/actions/${i}/type 必须是 "submit" 或 "cancel"`)
        }
      })
    }
  }

  return { ok: errors.length === 0, errors }
}

/** 递归遍历 Formily schema，校验 x-component / x-decorator 是否在白名单内 */
function walkSchema(
  node: Record<string, unknown>,
  path: string,
  allow: Set<string>,
  errors: string[],
): void {
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
      walkSchema(child as Record<string, unknown>, `${path}/properties/${name}`, allow, errors)
    }
  }

  // items（数组场景，PoC 预留）
  const items = node.items
  if (items !== undefined && typeof items === "object" && items !== null && !Array.isArray(items)) {
    walkSchema(items as Record<string, unknown>, `${path}/items`, allow, errors)
  }
}
