/**
 * antd 风格 style（CSS 子集）→ OpenTUI/Yoga 布局属性映射。
 * 框架层支持，让 schema 用标准 CSS 语义（如 flex: 1、height: "100%"）表达自适应。
 */
export interface CssLikeStyle {
  /** CSS flex 简写：数字 n → flexGrow n / flexShrink 1 / flexBasis 0 */
  flex?: number
  width?: number | `${number}%`
  height?: number | `${number}%`
  minWidth?: number
  minHeight?: number
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
}

export function toBoxStyle(style?: CssLikeStyle): Record<string, unknown> {
  if (!style) return {}
  const out: Record<string, unknown> = {}
  if (style.flex !== undefined) {
    out.flexGrow = style.flex
    out.flexShrink = 1
    out.flexBasis = 0
  }
  for (const key of [
    "width",
    "height",
    "minWidth",
    "minHeight",
    "marginTop",
    "marginBottom",
    "marginLeft",
    "marginRight",
  ] as const) {
    if (style[key] !== undefined) out[key] = style[key]
  }
  return out
}
