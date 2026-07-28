import { createContext, useContext, useMemo, type ReactNode } from "react"
import { darkPalette } from "./color"

/**
 * 简化版 antd Design Token（终端语义）。
 *
 * 与 antd v5 相同的两级结构：seed token（colorPrimary 等种子色）经暗色算法
 * 派生出组件消费的 token。终端默认黑底，算法固定为 darkAlgorithm 等价实现；
 * 主基调：背景填充取色板深端、前景点缀取亮端，色相灰蓝、轻微可辨。
 * 尺寸单位为终端 cell。
 */
export interface ThemeTokens {
  /**
   * 主色（填充端）；终端适配：取色板第 4 阶（深灰蓝）。
   * 背景填充尽可能深，靠色相与中性灰区分即可（antd 为第 6 阶，终端上过于抢眼）。
   */
  colorPrimary: string
  /**
   * 主色前景档；终端适配为聚焦边框/选中标记/文字高亮等黑底前景。
   * 取色板第 9 阶（亮灰蓝）：终端字形纤细，前景色尽可能亮、饱和度由算法压低。
   */
  colorPrimaryHover: string
  colorSuccess: string
  colorWarning: string
  colorError: string
  colorText: string
  colorTextSecondary: string
  colorTextDisabled: string
  colorBorder: string
  colorBgContainer: string
  /** antd borderRadius 在终端映射为 border style */
  borderStyle: "single" | "rounded" | "double" | "heavy"
  /** 控件内边距（cell） */
  paddingXS: number
  padding: number
}

/** 参与暗色派生的种子色（与 antd seed token 同名同义） */
const SEED_KEYS = ["colorPrimary", "colorSuccess", "colorWarning", "colorError"] as const

export type SeedKey = (typeof SEED_KEYS)[number]

/** antd 默认种子色（亮色 seed，派生后得到暗色值） */
const defaultSeeds: Record<SeedKey, string> = {
  colorPrimary: "#1677ff",
  colorSuccess: "#52c41a",
  colorWarning: "#faad14",
  colorError: "#ff4d4f",
}

/**
 * 由种子色派生完整 token 表。
 * 中性色取 antd 暗色 alias token 在 #141414 背景上的实心等效值（终端不支持 alpha 文字）。
 */
export function deriveTokens(overrides: Partial<ThemeTokens> = {}): ThemeTokens {
  const seeds = { ...defaultSeeds }
  for (const key of SEED_KEYS) {
    const v = overrides[key]
    if (typeof v === "string") seeds[key] = v
  }
  const primary = darkPalette(seeds.colorPrimary)
  const derived: ThemeTokens = {
    colorPrimary: primary[3]!,
    colorPrimaryHover: primary[8]!,
    colorSuccess: darkPalette(seeds.colorSuccess)[5]!,
    colorWarning: darkPalette(seeds.colorWarning)[5]!,
    colorError: darkPalette(seeds.colorError)[5]!,
    colorText: "#dcdcdc",
    colorTextSecondary: "#adadad",
    colorTextDisabled: "#4f4f4f",
    colorBorder: "#424242",
    colorBgContainer: "transparent",
    borderStyle: "rounded",
    paddingXS: 1,
    padding: 1,
  }
  // 种子键已参与派生，不再原样覆盖；其余键按 ThemeTokens 白名单过滤后允许直接指定
  const merged = { ...derived } as Record<keyof ThemeTokens, unknown>
  for (const key of Object.keys(derived) as Array<keyof ThemeTokens>) {
    if ((SEED_KEYS as readonly string[]).includes(key)) continue
    const v = overrides[key]
    if (v !== undefined) merged[key] = v
  }
  return merged as ThemeTokens
}

export const defaultTokens: ThemeTokens = deriveTokens()

const ThemeContext = createContext<ThemeTokens>(defaultTokens)

export interface ConfigProviderProps {
  /** 终端主题覆盖；种子色（colorPrimary 等）经终端暗色算法派生 */
  tuiTheme?: { token?: Partial<ThemeTokens> }
  children?: ReactNode
}

export function ConfigProvider({ tuiTheme, children }: ConfigProviderProps) {
  const token = tuiTheme?.token
  const merged = useMemo(() => deriveTokens(token), [token])
  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>
}

export function useToken(): ThemeTokens {
  return useContext(ThemeContext)
}
