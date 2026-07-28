import { createContext, useContext, type ReactNode } from "react"

/**
 * 简化版 antd Design Token（终端语义）。
 * 颜色沿用 antd 暗色主题色板；尺寸单位为终端 cell。
 */
export interface ThemeTokens {
  colorPrimary: string
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

export const defaultTokens: ThemeTokens = {
  colorPrimary: "#1677ff",
  colorSuccess: "#52c41a",
  colorWarning: "#faad14",
  colorError: "#ff4d4f",
  colorText: "#e6e6e6",
  colorTextSecondary: "#8c8c8c",
  colorTextDisabled: "#595959",
  colorBorder: "#424242",
  colorBgContainer: "transparent",
  borderStyle: "rounded",
  paddingXS: 1,
  padding: 1,
}

const ThemeContext = createContext<ThemeTokens>(defaultTokens)

export interface ConfigProviderProps {
  /** 对齐 antd：token 覆盖放在 theme.token */
  theme?: { token?: Partial<ThemeTokens> }
  children?: ReactNode
}

export function ConfigProvider({ theme, children }: ConfigProviderProps) {
  const merged = { ...defaultTokens, ...theme?.token }
  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>
}

export function useToken(): ThemeTokens {
  return useContext(ThemeContext)
}
