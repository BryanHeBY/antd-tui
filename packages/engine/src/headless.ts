/**
 * 无头挂载：不占 TTY 地把页面完整渲染起来，供 --check / --snapshot / --drive 复用。
 * 基于 @opentui 的测试渲染器（mockInput/mockMouse/captureCharFrame/captureSpans）。
 */
import type { TestRendererSetup } from "@opentui/core/testing"
import type { PageSchema } from "./validate"

export type FinishState =
  | { event: "submit"; values: Record<string, unknown> }
  | { event: "cancel" }

export interface HeadlessSession {
  setup: TestRendererSetup
  /** 让出宏任务并 flush 两轮：按键回调 setState 与连锁更新都落到渲染树后再取帧 */
  settle: () => Promise<void>
  /** 页面是否已完成（提交/取消）；完成后应输出事件并退出 */
  finished: () => FinishState | null
  /** 当前 form.values（--drive 的 values 操作用） */
  values: () => Record<string, unknown>
  destroy: () => void
}

export async function mountHeadless(
  schema: PageSchema,
  width: number,
  height: number,
): Promise<HeadlessSession> {
  const [{ testRender }, React, { App }] = await Promise.all([
    import("@opentui/react/test-utils"),
    import("react"),
    import("./App"),
  ])

  let finishState: FinishState | null = null
  let form: { values: unknown } | null = null
  const setup = await testRender(
    React.createElement(App, {
      schema,
      onFinish: (values: Record<string, unknown>) => {
        finishState = { event: "submit", values }
      },
      onCancel: () => {
        finishState = { event: "cancel" }
      },
      onFormReady: (f) => {
        form = f as { values: unknown }
      },
    }),
    { width, height },
  )

  const settle = async () => {
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await setup.flush()
    }
  }
  await settle()

  return {
    setup,
    settle,
    finished: () => finishState,
    // JSON 往返：values 是 observable 代理，structuredClone 不可用；协议侧本来就要 JSON 化
    values: () => (form ? JSON.parse(JSON.stringify(form.values)) : {}) as Record<string, unknown>,
    destroy: () => setup.renderer.destroy(),
  }
}

/** 解析 --size 80x24 形态的尺寸参数 */
export function parseSize(raw: string | undefined, fallback: { width: number; height: number }) {
  if (!raw) return fallback
  const m = /^(\d+)x(\d+)$/.exec(raw)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return null
  }
  return { width, height }
}
