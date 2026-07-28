import { testRender } from "@opentui/react/test-utils"
import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing"
import type { ReactNode } from "react"

export { KeyCodes } from "@opentui/core/testing"

/**
 * antd-tui 测试工具。
 *
 * 在 @opentui/react/test-utils 之上解决一个关键问题：
 * 按键触发的 React setState 走异步任务调度，OpenTUI 的 flush() 只推进
 * 渲染管线、不让出 JS 任务队列，导致「按键 → React 重渲染 → 焦点/UI 更新」
 * 需要先让出宏任务再 flush。这里的 settle() 与包装后的按键方法统一处理。
 */

export interface TuiTestSetup {
  /** 原始 OpenTUI TestRendererSetup（renderer/mockInput/mockMouse/captureCharFrame 等） */
  raw: TestRendererSetup
  /** 捕获当前字符帧（终端快照） */
  frame: () => string
  /** 让出宏任务并 flush 渲染，直到 React 更新落到渲染树 */
  settle: () => Promise<void>
  /** 输入文本（自动 settle） */
  type: (text: string) => Promise<void>
  /** 按下按键并 settle。key 用 KeyCodes 名称或原始序列 */
  press: (key: string, modifiers?: { shift?: boolean; ctrl?: boolean }) => Promise<void>
  /** Tab / Shift+Tab 移动焦点（自动 settle） */
  tab: (shift?: boolean) => Promise<void>
  /** Enter（自动 settle） */
  enter: () => Promise<void>
  /** Esc（自动 settle） */
  escape: () => Promise<void>
  /** 等待某个断言成立（轮询 settle） */
  waitUntil: (predicate: () => boolean, timeoutMs?: number) => Promise<void>
  /** 销毁 renderer */
  destroy: () => void
}

const yieldMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function renderTui(
  node: ReactNode,
  options: TestRendererOptions = {},
): Promise<TuiTestSetup> {
  const raw = await testRender(node, { width: 60, height: 20, ...options })

  const settle = async () => {
    // 两轮「让出宏任务 + flush」：第一轮消化按键回调里的 setState，
    // 第二轮消化由重渲染引发的连锁更新（如 focused prop 变化触发 focus()）
    for (let i = 0; i < 2; i++) {
      await yieldMacrotask()
      await raw.flush()
    }
  }

  const press: TuiTestSetup["press"] = async (key, modifiers) => {
    raw.mockInput.pressKey(key as never, modifiers)
    await settle()
  }

  const setup: TuiTestSetup = {
    raw,
    frame: () => raw.captureCharFrame(),
    settle,
    type: async (text) => {
      await raw.mockInput.typeText(text)
      await settle()
    },
    press,
    tab: async (shift = false) => {
      raw.mockInput.pressTab(shift ? { shift: true } : undefined)
      await settle()
    },
    enter: async () => {
      raw.mockInput.pressEnter()
      await settle()
    },
    escape: async () => {
      raw.mockInput.pressEscape()
      // legacy 键盘协议下 ESC 是转义序列前缀，parser 需要歧义等待超时后才会发出 escape 事件
      await new Promise((resolve) => setTimeout(resolve, 80))
      await settle()
    },
    waitUntil: async (predicate, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error("waitUntil 超时")
        await settle()
      }
    },
    destroy: () => raw.renderer.destroy(),
  }

  await settle()
  return setup
}
