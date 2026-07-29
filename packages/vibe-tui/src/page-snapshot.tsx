/**
 * 独立的页面快照渲染器。
 *
 * 它和宿主终端共用同一个 LiveTree，却拥有自己的内存 renderer。因此 agent
 * 校验 $ui 时不会受 F3 对话记录、状态栏或输入框影响，也不需要短暂替换人类的画面。
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { createElement } from "react"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { LiveTree, LiveView } from "@antd-tui/live"

export interface PageSnapshotRenderer {
  capture: (width: number, height: number) => Promise<string>
  destroy: () => void
}

/** 创建只写内存的第二个 React/OpenTUI 根，用于输出纯 $ui 页面帧。 */
export async function createPageSnapshotRenderer(tree: LiveTree): Promise<PageSnapshotRenderer> {
  const test = await createTestRenderer({ width: 1, height: 1 })
  const root = createRoot(test.renderer)
  root.render(
    <ConfigProvider>
      {/* 快照是页面结构/样式验收，不能因独立 renderer 自动聚焦首个控件，
          否则会与宿主当前 F2 键盘模式无关地出现焦点框。 */}
      <FocusScope suspended>
        <LiveView tree={tree} handleEscape={false} hideHint />
      </FocusScope>
    </ConfigProvider>,
  )

  return {
    async capture(width, height) {
      // 尺寸来自宿主画板已完成布局的 pane，和人类看到的 $ui 区域严格一致。
      test.resize(Math.max(1, width), Math.max(1, height))
      test.renderer.requestRender()
      // MobX observer 和 React 提交可能跨一个调度回合；flush 会等到帧稳定后再读取。
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      await test.flush()
      return test.captureCharFrame()
    },
    destroy() {
      root.unmount()
      test.renderer.destroy()
    },
  }
}
