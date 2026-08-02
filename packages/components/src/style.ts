/**
 * antd 风格 style（CSS 子集）→ OpenTUI/Yoga 布局属性映射。
 * 框架层支持，让 schema 用标准 CSS 语义（如 flex: 1、height: "100%"）表达自适应。
 * 视觉字段同样取 CSS 标准名（color/backgroundColor/textAlign）；
 * 终端暂不提供 fontWeight；正文采用常规字重，组件按信息语义为标题、按钮和关键数值加粗。
 */
export interface CssLikeStyle {
  /** CSS flex 简写：数字 n → flexGrow n / flexShrink 1 / flexBasis 0 */
  flex?: number
  width?: number | `${number}%`
  height?: number | `${number}%`
  minWidth?: number
  minHeight?: number
  padding?: number
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
  /** 同 CSS：文本前景色（仅文本类组件消费；容器不支持继承） */
  color?: string
  /** 同 CSS：背景色 */
  backgroundColor?: string
  /** 同 CSS 语义：文本在父容器中的水平对齐（终端以交叉轴 alignSelf 实现） */
  textAlign?: "left" | "center" | "right"
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
    "padding",
    "marginTop",
    "marginBottom",
    "marginRight",
    "marginLeft",
    "backgroundColor",
  ] as const) {
    if (style[key] !== undefined) out[key] = style[key]
  }
  return out
}

/** 文本类组件消费的视觉字段：fg/bg 走 text 属性，textAlign 映射为交叉轴对齐 */
export function toTextStyle(style?: CssLikeStyle): {
  fg?: string
  bg?: string
  alignSelf?: "flex-end" | "center"
} {
  if (!style) return {}
  return {
    ...(style.color !== undefined ? { fg: style.color } : {}),
    ...(style.backgroundColor !== undefined ? { bg: style.backgroundColor } : {}),
    ...(style.textAlign === "right"
      ? { alignSelf: "flex-end" as const }
      : style.textAlign === "center"
        ? { alignSelf: "center" as const }
        : {}),
  }
}
