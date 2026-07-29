/**
 * 活对象树渲染器：每节点一个 observer 组件。
 * 插入/删除只重渲染父节点（childIds 变），props 热换只重渲染该节点——
 * 兄弟不动，已聚焦的 Input 光标/内容不受影响。
 */
import { createElement, type ReactNode } from "react"
import { toJS } from "@formily/reactive"
import { observer } from "@formily/reactive-react"
import { useKeyboard } from "@opentui/react"
import { Flex, Typography, useFocusScopeState } from "@antd-tui/components"
import { DISPLAY_BINDING_COMPONENT, inputBindings, liveComponents } from "./registry"
import type { LiveTree } from "./tree"

export interface LiveViewProps {
  tree: LiveTree
  hideHint?: boolean
  /** 宿主自己接管 Esc（如 vibe-tui）时置 false；缺省行为与 PageView 一致 */
  handleEscape?: boolean
  /** interactive 模式 Esc 默认动作：完成并回传 $ui.data 快照 */
  onFinish?: (values: Record<string, unknown>) => void
  /** form 模式 Esc 默认动作：取消 */
  onCancel?: () => void
}

/** 与 PageView 同款圈闭守卫：仅当本 FocusScope 是栈顶时响应 Esc */
function EscapeHandler({ onEscape }: { onEscape: () => void }) {
  const { isActiveScope } = useFocusScopeState()
  useKeyboard((key) => {
    if (key.name === "escape" && isActiveScope()) onEscape()
  })
  return null
}

const NodeView = observer(({ tree, id }: { tree: LiveTree; id: string }) => {
  const record = tree.record(id)
  if (!record) return null
  // toJS 双重作用：深读建立深依赖（嵌套 style/options 变更也触发本节点重渲染），
  // 同时传给组件的是普通对象而非代理（组件不是 observer，读代理不会追踪）；函数原样穿透
  const props: Record<string, unknown> = toJS(record.state.props)
  const name = record.state.name

  if (name !== undefined) {
    const binding = inputBindings[record.component]
    if (binding) {
      const userHandler = props[binding.changeProp] as ((value: unknown) => void) | undefined
      props[binding.valueProp] = tree.data[name] ?? binding.emptyValue
      props[binding.changeProp] = (value: unknown) => {
        tree.data[name] = value
        userHandler?.(value)
      }
    }
  }

  let children: ReactNode
  if (name !== undefined && record.component === DISPLAY_BINDING_COMPONENT) {
    const value = tree.data[name]
    children = value === undefined || value === null ? "—" : String(value)
  } else if (record.state.content !== undefined) {
    children = record.state.content
  } else if (record.state.childIds.length > 0) {
    children = record.state.childIds.map((cid) => (
      <NodeView key={cid} tree={tree} id={cid} />
    ))
  }

  return createElement(liveComponents[record.component], props, children)
})

export const LiveView = observer(
  ({ tree, hideHint = false, handleEscape = true, onFinish, onCancel }: LiveViewProps) => {
    const page = tree.pageMeta
    const interactive = page.mode !== "form"
    const escapeOn = handleEscape && tree.escapeMode !== "none"
    const onEscape = () =>
      tree.runEscape(() => {
        // 与 PageView 一致：interactive Esc = 完成回传；form Esc = 取消。
        // data 可能含函数（agent 自存的辅助函数），JSON 往返顺带滤掉
        if (interactive) onFinish?.(JSON.parse(JSON.stringify(tree.data)) as Record<string, unknown>)
        else onCancel?.()
      })
    const hint = interactive
      ? `方向键 移动 · Enter 确认${escapeOn ? " · Esc 退出" : ""}`
      : `Tab 切换焦点 · Enter 确认${escapeOn ? " · Esc 取消" : ""}`
    return (
      <Flex vertical gap={1} style={{ padding: 1, width: "100%", height: "100%" }}>
        {escapeOn ? <EscapeHandler onEscape={onEscape} /> : null}
        {page.title ? <Typography.Title>{page.title}</Typography.Title> : null}
        {page.description ? (
          <Typography.Text type="secondary">{page.description}</Typography.Text>
        ) : null}
        <Flex vertical gap={1} flex={1} tuiScroll>
          {tree.rootChildIds.map((id) => (
            <NodeView key={id} tree={tree} id={id} />
          ))}
        </Flex>
        {hideHint ? null : <Typography.Text type="secondary">{hint}</Typography.Text>}
      </Flex>
    )
  },
)
