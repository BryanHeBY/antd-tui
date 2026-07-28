import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, useToken, darkPalette, defaultTokens, deriveTokens } from "../src"

/**
 * 主题体系：seed 色经暗色算法派生（对齐 antd v5 darkAlgorithm）。
 * 终端无 hover，antd 的 hover 档（色板第 7 阶）用于聚焦/前景高亮。
 */

describe("darkPalette", () => {
  test("蓝色种子的暗色板与 antd 官方色板逐值一致", () => {
    expect(darkPalette("#1677ff")).toEqual([
      "#111a2c",
      "#112545",
      "#15325b",
      "#15417e",
      "#1554ad",
      "#1668dc",
      "#3c89e8",
      "#65a9f3",
      "#8dc5f8",
      "#b7dcfa",
    ])
  })

  test("状态色种子派生出 antd 暗色主题默认值", () => {
    expect(darkPalette("#52c41a")[5]).toBe("#49aa19")
    expect(darkPalette("#faad14")[5]).toBe("#d89614")
    expect(darkPalette("#ff4d4f")[5]).toBe("#dc4446")
  })
})

describe("deriveTokens", () => {
  test("默认 token：主色为暗色填充档，hover 档更浅供黑底前景", () => {
    expect(defaultTokens.colorPrimary).toBe("#1668dc")
    expect(defaultTokens.colorPrimaryHover).toBe("#3c89e8")
    expect(defaultTokens.colorSuccess).toBe("#49aa19")
    expect(defaultTokens.colorError).toBe("#dc4446")
  })

  test("覆盖种子色时重新派生，而非原样使用", () => {
    const tokens = deriveTokens({ colorPrimary: "#722ed1" })
    // antd 暗紫色板：填充 #642ab5、hover #854eca
    expect(tokens.colorPrimary).toBe("#642ab5")
    expect(tokens.colorPrimaryHover).toBe("#854eca")
  })

  test("非种子键（含 colorPrimaryHover）允许直接覆盖", () => {
    const tokens = deriveTokens({ colorPrimaryHover: "#ffffff", colorText: "#cccccc" })
    expect(tokens.colorPrimaryHover).toBe("#ffffff")
    expect(tokens.colorText).toBe("#cccccc")
  })
})

describe("ConfigProvider", () => {
  test("theme.token 种子经派生后注入组件", async () => {
    function Probe() {
      const token = useToken()
      return <text>{`P=${token.colorPrimary} H=${token.colorPrimaryHover}`}</text>
    }
    const t = await renderTui(
      <ConfigProvider theme={{ token: { colorPrimary: "#722ed1" } }}>
        <Probe />
      </ConfigProvider>,
      { width: 60, height: 4 },
    )
    expect(t.frame()).toContain("P=#642ab5 H=#854eca")
    t.destroy()
  })
})
