import { Children, type ReactNode } from "react"
import { Divider } from "./Divider"
import { Spin } from "./Spin"
import { useToken } from "../theme"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * antd List 的终端实现。
 *
 * dataSource/renderItem 适合普通 React 用法；$ui 活树没有 JSX，因此 agent 应优先
 * 用 List.Item 子节点逐项增删。两种入口最终走同一份列表骨架。
 */
export interface ListLocale {
  emptyText?: ReactNode
}

export interface ListProps<T = unknown> {
  /** 同 antd：数据源 */
  dataSource?: T[]
  /** 同 antd：将数据源项渲染为条目 */
  renderItem?: (item: T, index: number) => ReactNode
  /** 同 antd：加载态；终端显示 Spin 取代 Web 遮罩层 */
  loading?: boolean | { spinning?: boolean; tip?: ReactNode }
  /** 同 antd：顶部内容 */
  header?: ReactNode
  /** 同 antd：底部内容 */
  footer?: ReactNode
  /** 同 antd：边框容器 */
  bordered?: boolean
  /** 同 antd：条目间分割线 */
  split?: boolean
  /** 同 antd：空状态文本 */
  locale?: ListLocale
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

export interface ListItemProps {
  /** 同 antd：条目右侧补充内容 */
  extra?: ReactNode
  /** 同 antd：条目动作区 */
  actions?: ReactNode[]
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

/** OpenTUI 的 box 不能直接放原始文本；List 的 slot/content 统一在此适配。 */
function TerminalContent({ children }: { children?: ReactNode }) {
  const token = useToken()
  if (typeof children === "string" || typeof children === "number") {
    return <text fg={token.colorText}>{String(children)}</text>
  }
  return <>{children}</>
}

function ListItem({ extra, actions, style, children }: ListItemProps) {
  return (
    <box style={{ flexDirection: "row", width: "100%", alignItems: "center", ...toBoxStyle(style) }}>
      <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
        <TerminalContent>{children}</TerminalContent>
      </box>
      {extra ? (
        <box style={{ flexShrink: 0, marginLeft: 1 }}>
          <TerminalContent>{extra}</TerminalContent>
        </box>
      ) : null}
      {actions && actions.length > 0 ? (
        <box style={{ flexShrink: 0, flexDirection: "row", gap: 1, marginLeft: 1 }}>
          {actions.map((action, index) => (
            <TerminalContent key={index}>{action}</TerminalContent>
          ))}
        </box>
      ) : null}
    </box>
  )
}

function normalizeLoading(loading: ListProps["loading"]): { spinning: boolean; tip?: ReactNode } {
  if (typeof loading === "object") return { spinning: loading.spinning ?? true, tip: loading.tip }
  return { spinning: loading === true }
}

function ListBase<T>({
  dataSource,
  renderItem,
  loading = false,
  header,
  footer,
  bordered = false,
  split = true,
  locale,
  style,
  children,
}: ListProps<T>) {
  const token = useToken()
  const sourceRows = dataSource
    ? dataSource.map((item, index) => renderItem?.(item, index) ?? <ListItem>{String(item)}</ListItem>)
    : Children.toArray(children)
  const rows = sourceRows.map((row, index) =>
    typeof row === "string" || typeof row === "number" ? <ListItem key={index}>{row}</ListItem> : row,
  )
  const { spinning, tip } = normalizeLoading(loading)

  const body = spinning ? (
    <Spin spinning tip={tip} />
  ) : rows.length === 0 ? (
    <text fg={token.colorTextSecondary}>{locale?.emptyText ?? "暂无数据"}</text>
  ) : (
    rows.map((row, index) => (
      <box key={index} style={{ flexDirection: "column", width: "100%" }}>
        {row}
        {split && index < rows.length - 1 ? <Divider /> : null}
      </box>
    ))
  )

  return (
    <box
      border={bordered}
      style={{
        flexDirection: "column",
        width: "100%",
        ...(bordered
          ? { borderStyle: token.borderStyle, borderColor: token.colorBorder, paddingLeft: 1, paddingRight: 1 }
          : {}),
        ...toBoxStyle(style),
      }}
    >
      {header ? (
        <box style={{ flexShrink: 0, marginBottom: 1 }}>
          <TerminalContent>{header}</TerminalContent>
        </box>
      ) : null}
      {body}
      {footer ? (
        <box style={{ flexShrink: 0, marginTop: 1 }}>
          <TerminalContent>{footer}</TerminalContent>
        </box>
      ) : null}
    </box>
  )
}

/** 复合组件：对齐 antd 的 List.Item。 */
export const List = Object.assign(ListBase, { Item: ListItem })
