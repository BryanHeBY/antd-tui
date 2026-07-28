import { createContext, useContext, useMemo, type ReactNode } from "react"
import { darkPalette } from "./color"

/**
 * 简化版 antd Design Token（终端语义）。
 *
 * 与 antd v5 相同的两级结构：seed token（colorPrimary 等种子色）经暗色算法
 * 派生出组件消费的 token。终端默认黑底，算法固定为 darkAlgorithm 等价实现；
 * 终端无 hover，antd 的 hover 档（色板第 7 阶）挪给聚焦/前景高亮使用。
 * 尺寸单位为终端 cell。
 */
export interface ThemeTokens {
  /** 同 antd（经暗色算法派生）：主色，用于填充（主按钮底色、开关开启底色等） */
  colorPrimary: string
  /** 同 antd（经暗色算法派生）：主色 hover 档；终端适配为聚焦边框/选中标记等黑底前景 */
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
    colorPrimary: primary[5]!,
    colorPrimaryHover: primary[6]!,
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
  // 种子键已参与派生，不再原样覆盖；其余键（含 colorPrimaryHover）允许直接指定
  const rest = { ...overrides }
  for (const key of SEED_KEYS) delete rest[key]
  return { ...derived, ...rest }
}

export const defaultTokens: ThemeTokens = deriveTokens()

const ThemeContext = createContext<ThemeTokens>(defaultTokens)

export interface ConfigProviderProps {
  /** 对齐 antd：token 覆盖放在 theme.token；种子色（colorPrimary 等）经暗色算法派生 */
  theme?: { token?: Partial<ThemeTokens> }
  children?: ReactNode
}

export function ConfigProvider({ theme, children }: ConfigProviderProps) {
  const token = theme?.token
  const merged = useMemo(() => deriveTokens(token), [token])
  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>
}

export function useToken(): ThemeTokens {
  return useContext(ThemeContext)
}
