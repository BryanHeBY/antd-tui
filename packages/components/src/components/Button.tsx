import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { useKeyboard, useOnResize } from "@opentui/react"
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react"
import { useFocusable } from "../focus"
import { toBoxStyle, type CssLikeStyle } from "../style"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 */
export interface ButtonProps {
  /** 同 antd（子集）：按钮类型 */
  type?: "primary" | "default"
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 同 antd：加载中（显示旋转帧并阻止点击，视觉不置灰） */
  loading?: boolean
  /** 同 antd：危险语义（错误色边框/文字） */
  danger?: boolean
  /** 同 antd：宽度撑满父容器 */
  block?: boolean
  /** 类似 antd size 但形态不同：small 为无边框填充色块（终端里紧凑形态无法保留边框） */
  tuiSize?: "middle" | "small"
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  /**
   * TUI 扩展：全局热键（输入类组件聚焦时失效）。
   * 命名空间规则：单字符（如 "7" "+" "%"）只匹配可见字符 key.sequence；
   * 多字符（如 "backspace" "f1"）只匹配命名键 key.name。
   */
  tuiHotkey?: string
  /** 类似 antd onClick，但终端无 DOM 事件参数 */
  tuiOnClick?: () => void
  children?: ReactNode
}

export interface ButtonGroupProps {
  /** 同 antd：整组占满父容器。 */
  block?: boolean
  /**
   * TUI 扩展：把后代 Button 作为一个连续边框面板渲染。
   *
   * 适用于 Row/Col 组成的按键盘。边框按最终布局矩形合并，
   * 不要求调用方声明行、列或单元格跨度。
   */
  tuiBordered?: boolean
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

interface ButtonGroupContextValue {
  block: boolean
  collapsed: boolean
  registerCell?: (id: string, cell: BoxRenderable) => () => void
}

const ButtonGroupContext = createContext<ButtonGroupContextValue | null>(null)

const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function ButtonBase({
  type = "default",
  disabled = false,
  loading = false,
  danger = false,
  block = false,
  tuiSize = "middle",
  style,
  tuiHotkey,
  tuiOnClick,
  children,
}: ButtonProps) {
  const token = useToken()
  const group = useContext(ButtonGroupContext)
  const boxRef = useRef<BoxRenderable | null>(null)
  const cellId = useId()
  // loading 与 antd 一致：阻止交互但不置灰
  const locked = disabled || loading
  const [spinFrame, setSpinFrame] = useState(0)
  useEffect(() => {
    if (!loading) return
    const timer = setInterval(() => setSpinFrame((f) => (f + 1) % SPIN_FRAMES.length), 100)
    return () => clearInterval(timer)
  }, [loading])
  const { focused, getFocusedKind, isActiveScope, requestFocus } = useFocusable({
    kind: "action",
    disabled: locked,
    onActivate: tuiOnClick,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  useEffect(() => {
    if (!group?.collapsed || !group.registerCell || !boxRef.current) return
    return group.registerCell(cellId, boxRef.current)
  }, [cellId, group?.collapsed, group?.registerCell])

  // 浏览器直觉：点击按钮同时把焦点转移过去
  const handleMouseDown = () => {
    if (locked) return
    requestFocus()
    tuiOnClick?.()
  }

  useKeyboard((key) => {
    if (!tuiHotkey || locked || !isActiveScope()) return
    // 输入框/选择器聚焦时按键归它们，热键静默
    if (getFocusedKind() === "input") return
    // 单字符走可见字符（sequence），多字符走命名键（name），两套命名空间不混用
    const hit = tuiHotkey.length === 1 ? key.sequence === tuiHotkey : key.name === tuiHotkey
    if (hit) tuiOnClick?.()
  })

  const isPrimary = type === "primary"
  const label = (
    <>
      {loading ? `${SPIN_FRAMES[spinFrame]} ` : ""}
      {children}
    </>
  )

  if (group) {
    // 普通 Group 保持 antd 一维按钮组的紧凑形态。连续面板则由父级统一绘制边框，
    // 因此每一个按钮预留一格内边距给 overlay，不可再自行绘制完整 border。
    // 连续边框由同级 overlay 统一绘制，焦点只强调文字色，不能以整块背景覆盖连接线。
    const backgroundColor = disabled || group.collapsed ? "transparent" : focused ? "#202020" : "transparent"
    const textColor = disabled
      ? token.colorTextDisabled
      : danger
        ? token.colorError
        : isPrimary || focused
          ? token.colorPrimaryHover
          : token.colorText
    return (
      <box
        ref={boxRef}
        style={{
          backgroundColor,
          minHeight: group.collapsed ? 2 : 1,
          ...(group.collapsed
            ? {
                // 第一行由共享边框层占用，第二行才是按钮内容；每格两行即可连续且紧凑。
                width: "100%" as const,
                height: 2,
                paddingTop: 1,
                paddingLeft: 1,
                paddingRight: 1,
              }
            : { paddingLeft: 1, paddingRight: 1 }),
          alignItems: "center",
          justifyContent: "center",
          ...(group.block && !group.collapsed ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : {}),
          ...toBoxStyle(style),
        }}
        onMouseDown={handleMouseDown}
      >
        <text attributes={TextAttributes.BOLD} fg={textColor} bg={backgroundColor}>
          {label}
        </text>
      </box>
    )
  }

  if (tuiSize === "small") {
    // 紧凑形态：纯色块 + 白字粗体，聚焦时反色。
    // default = 中性灰底，primary = 深灰蓝底（主基调：背景深、前景亮）
    const backgroundColor = disabled
      ? "#262626"
      : focused
        ? "#e6e6e6"
        : danger
          ? token.colorError
          : isPrimary
            ? token.colorPrimary
            : "#373737"
    const textColor = disabled ? token.colorTextDisabled : focused ? "#141414" : "#ffffff"
    return (
      <box
        ref={boxRef}
        style={{
          backgroundColor,
          minHeight: 1,
          alignItems: "center",
          justifyContent: "center",
          ...(block ? { width: "100%" } : { paddingLeft: 1, paddingRight: 1 }),
          ...toBoxStyle(style),
        }}
        onMouseDown={handleMouseDown}
      >
        <text attributes={TextAttributes.BOLD} fg={textColor} bg={backgroundColor}>
          {label}
        </text>
      </box>
    )
  }

  // 主基调：中尺寸按钮中性透明底 + 边框，主色只做轻微点缀
  // （primary = 主色边框 + 亮端主色文字；纯色块形态用 tuiSize: "small"）
  const borderColor = disabled
    ? token.colorTextDisabled
    : danger
      ? token.colorError
      : focused
        ? token.colorPrimaryHover
        : isPrimary
          ? token.colorPrimary
          : token.colorBorder
  const textColor = disabled
    ? token.colorTextDisabled
    : danger
      ? token.colorError
      : isPrimary || focused
        ? token.colorPrimaryHover
        : token.colorText

  return (
    <box
      ref={boxRef}
      border
      style={{
        borderStyle: focused ? "double" : token.borderStyle,
        borderColor,
        height: 3,
        paddingLeft: block ? 0 : 2,
        paddingRight: block ? 0 : 2,
        alignItems: "center",
        justifyContent: "center",
        ...(block ? { width: "100%" } : null),
        ...toBoxStyle(style),
      }}
      onMouseDown={handleMouseDown}
    >
      <text attributes={TextAttributes.BOLD} fg={textColor}>
        {label}
      </text>
    </box>
  )
}

type BorderGlyph = { x: number; y: number; char: string }

const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8

function pointKey(x: number, y: number) {
  return `${x}:${y}`
}

function collapsedBorderGlyphs(root: BoxRenderable, cells: Iterable<BoxRenderable>): BorderGlyph[] {
  const connections = new Map<string, number>()
  const add = (x: number, y: number, direction: number) => {
    if (x < 0 || y < 0 || x >= root.width || y >= root.height) return
    const key = pointKey(x, y)
    connections.set(key, (connections.get(key) ?? 0) | direction)
  }
  const horizontal = (y: number, from: number, to: number) => {
    for (let x = from; x < to; x++) {
      add(x, y, EAST)
      add(x + 1, y, WEST)
    }
  }
  const vertical = (x: number, from: number, to: number) => {
    for (let y = from; y < to; y++) {
      add(x, y, SOUTH)
      add(x, y + 1, NORTH)
    }
  }

  for (const cell of cells) {
    const x = cell.x - root.x
    const y = cell.y - root.y
    const right = x + cell.width
    const bottom = y + cell.height
    if (cell.width < 2 || cell.height < 2 || x < 0 || y < 0 || right >= root.width || bottom >= root.height) {
      continue
    }
    horizontal(y, x, right)
    horizontal(bottom, x, right)
    vertical(x, y, bottom)
    vertical(right, y, bottom)
  }

  const maxX = root.width - 1
  const maxY = root.height - 1
  return [...connections.entries()].flatMap(([key, directions]) => {
    const [x, y] = key.split(":").map(Number)
    const char =
      directions === (EAST | SOUTH) && x === 0 && y === 0
        ? "╭"
        : directions === (SOUTH | WEST) && x === maxX && y === 0
          ? "╮"
          : directions === (NORTH | EAST) && x === 0 && y === maxY
            ? "╰"
            : directions === (NORTH | WEST) && x === maxX && y === maxY
              ? "╯"
              : ({
                  [NORTH]: "│",
                  [EAST]: "─",
                  [SOUTH]: "│",
                  [WEST]: "─",
                  [NORTH | SOUTH]: "│",
                  [EAST | WEST]: "─",
                  [EAST | SOUTH]: "┌",
                  [SOUTH | WEST]: "┐",
                  [NORTH | EAST]: "└",
                  [NORTH | WEST]: "┘",
                  [NORTH | EAST | SOUTH]: "├",
                  [NORTH | SOUTH | WEST]: "┤",
                  [EAST | SOUTH | WEST]: "┬",
                  [NORTH | EAST | WEST]: "┴",
                  [NORTH | EAST | SOUTH | WEST]: "┼",
                }[directions] ?? "")
    return char ? [{ x, y, char }] : []
  })
}

function CollapsedBorderLayer({
  rootRef,
  cellsRef,
  revision,
}: {
  rootRef: RefObject<BoxRenderable | null>
  cellsRef: MutableRefObject<Map<string, BoxRenderable>>
  revision: number
}) {
  const token = useToken()
  const [glyphs, setGlyphs] = useState<BorderGlyph[]>([])
  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root || root.width < 2 || root.height < 2) return false
    const next = collapsedBorderGlyphs(root, cellsRef.current.values())
    if (next.length === 0) return false
    setGlyphs((current) =>
      current.length === next.length && current.every((glyph, index) => {
        const other = next[index]
        return glyph.x === other.x && glyph.y === other.y && glyph.char === other.char
      })
        ? current
        : next,
    )
    return true
  }, [cellsRef, rootRef])

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const retry = () => {
      if (cancelled) return
      if (measure() || attempts++ >= 8) return
      setTimeout(retry, 16)
    }
    retry()
    return () => {
      cancelled = true
    }
  }, [measure, revision])

  useOnResize(() => {
    setTimeout(measure, 16)
  })

  return (
    <box style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
      {glyphs.map((glyph) => (
        <box key={`${glyph.x}:${glyph.y}`} style={{ position: "absolute", top: glyph.y, left: glyph.x, width: 1, height: 1 }}>
          <text fg={token.colorBorder}>{glyph.char}</text>
        </box>
      ))}
    </box>
  )
}

function ButtonGroup({ block = false, tuiBordered = false, style, children }: ButtonGroupProps) {
  const token = useToken()
  const cellsRef = useRef(new Map<string, BoxRenderable>())
  const rootRef = useRef<BoxRenderable | null>(null)
  const [revision, setRevision] = useState(0)
  const registerCell = useCallback((id: string, cell: BoxRenderable) => {
    cellsRef.current.set(id, cell)
    setRevision((current) => current + 1)
    return () => {
      cellsRef.current.delete(id)
      setRevision((current) => current + 1)
    }
  }, [])
  const context = useMemo<ButtonGroupContextValue>(
    () => ({ block, collapsed: tuiBordered, ...(tuiBordered ? { registerCell } : {}) }),
    [block, registerCell, tuiBordered],
  )

  if (tuiBordered) {
    return (
      <ButtonGroupContext.Provider value={context}>
        <box
          ref={rootRef}
          style={{
            flexDirection: "column",
            ...(block ? { width: "100%" as const } : {}),
            // 共享的最右/最下边框没有对应按钮单元格，预留一个终端格防止绘制越界。
            paddingRight: 1,
            paddingBottom: 1,
            ...toBoxStyle(style),
          }}
        >
          <CollapsedBorderLayer rootRef={rootRef} cellsRef={cellsRef} revision={revision} />
          {children}
        </box>
      </ButtonGroupContext.Provider>
    )
  }

  const buttons = Children.toArray(children)
  const contents: ReactNode[] = []
  for (const [index, child] of buttons.entries()) {
    contents.push(child)
    if (index < buttons.length - 1) {
      contents.push(
        <text key={`button-group-divider-${index}`} fg={token.colorBorder}>
          │
        </text>,
      )
    }
  }

  return (
    <ButtonGroupContext.Provider value={context}>
      <box
        border
        style={{
          flexDirection: "row",
          ...(block ? { width: "100%" as const } : {}),
          borderStyle: token.borderStyle,
          borderColor: token.colorBorder,
          ...toBoxStyle(style),
        }}
      >
        {contents}
      </box>
    </ButtonGroupContext.Provider>
  )
}

export const Button = Object.assign(ButtonBase, { Group: ButtonGroup })
