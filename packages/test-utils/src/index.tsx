import { testRender } from "@opentui/react/test-utils"
import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing"
import { act, type ReactNode } from "react"

export { KeyCodes } from "@opentui/core/testing"

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

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
  /** 鼠标单击（自动 settle） */
  click: (x: number, y: number) => Promise<void>
  /** 鼠标双击（自动 settle） */
  doubleClick: (x: number, y: number) => Promise<void>
  /** 鼠标拖动（自动 settle） */
  drag: (fromX: number, fromY: number, toX: number, toY: number) => Promise<void>
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
  // autoFocus: core 的鼠标点击会聚焦第一个 focusable 祖先并 blur 当前输入框，
  // 与组件库的 FocusScope 焦点体系冲突（焦点权威在 FocusScope），必须关闭
  const raw = await testRender(node, { width: 60, height: 20, autoFocus: false, ...options })

  const flushUpdates = async () => {
    // 两轮「让出宏任务 + flush」：第一轮消化按键回调里的 setState，
    // 第二轮消化由重渲染引发的连锁更新（如 focused prop 变化触发 focus()）
    for (let i = 0; i < 2; i++) {
      await yieldMacrotask()
      await act(async () => {
        await raw.flush()
      })
    }
  }

  /**
   * OpenTUI 的输入/鼠标会同步进入 renderer，后续 React 更新则经异步任务投递。
   * 事件注入与每一次 flush 都进入 act；两者之间保留一个真实的任务周期，避免
   * 测试夹具改变输入协议与宿主异步源的时序。等待外部结果时，waitUntil 会在
   * 每轮观察间隔内单独进入 act；不能把整个轮询包在一个 act 中，否则 React 会
   * 延后提交，字符帧将永远看不到正在等待的异步结果。
   */
  const settle = async () => {
    await flushUpdates()
  }

  const runInteraction = async (interaction: () => void | Promise<void>) => {
    await act(async () => {
      await interaction()
    })
    await flushUpdates()
  }

  const press: TuiTestSetup["press"] = async (key, modifiers) => {
    await runInteraction(() => raw.mockInput.pressKey(key as never, modifiers))
  }

  const setup: TuiTestSetup = {
    raw,
    frame: () => raw.captureCharFrame(),
    settle,
    type: async (text) => {
      await runInteraction(() => raw.mockInput.typeText(text))
    },
    press,
    tab: async (shift = false) => {
      await runInteraction(() => raw.mockInput.pressTab(shift ? { shift: true } : undefined))
    },
    enter: async () => {
      await runInteraction(() => raw.mockInput.pressEnter())
    },
    escape: async () => {
      await act(async () => {
        raw.mockInput.pressEscape()
      })
      // legacy 键盘协议下 ESC 是转义序列前缀，parser 需要歧义等待超时后才会发出 escape 事件
      await new Promise((resolve) => setTimeout(resolve, 80))
      await flushUpdates()
    },
    click: async (x, y) => runInteraction(() => raw.mockMouse.click(x, y)),
    doubleClick: async (x, y) => runInteraction(() => raw.mockMouse.doubleClick(x, y)),
    drag: async (fromX, fromY, toX, toY) => runInteraction(() => raw.mockMouse.drag(fromX, fromY, toX, toY)),
    waitUntil: async (predicate, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error("waitUntil 超时")
        await act(async () => {
          await yieldMacrotask()
          await raw.flush()
        })
      }
    },
    destroy: () => {
      // renderer.destroy() 会触发 React 根节点卸载；外层 act 接住 renderer
      // 更新。OpenTUI 内部会在 onDestroy 中把全局 act 标记复位，因此在外层
      // act 结束前恢复它，避免 React 将这个嵌套销毁误报为环境未配置。
      act(() => {
        raw.renderer.destroy()
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
      })
    },
  }

  // 首次挂载后的 effect（焦点注册、尺寸测量等）会在下一轮任务中 setState。
  // 先在 act 内接住这一轮，再走常规 settle，避免首帧自身成为 act 警告来源。
  await act(async () => {
    await yieldMacrotask()
    await raw.flush()
  })
  await settle()
  return setup
}
