import type { CssLikeStyle } from "@antd-tui/components"

/** xterm 的鼠标追踪模式（由子进程经 DECSET 1000/1002/1003 协商）。 */
export type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any"

export interface AntermSessionOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  cols: number
  rows: number
  scrollback?: number
  onExit?: (code: number) => void
  onTitleChange?: (title: string) => void
}

/** 一次子终端会话：PTY 进程 + VT 屏幕模型。 */
export interface AntermSession {
  /** 宿主 → 子进程 */
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  /** 屏幕有变化时通知（已按帧合并） */
  onFrame(listener: () => void): () => void
  /** 取当前屏幕快照所需的读接口 */
  readonly screen: AntermScreen
  /** normal buffer 的读接口；active 切到 alternate screen 后仍可读取流式历史。 */
  readonly normalScreen: AntermScreen
  readonly exited: boolean
  /** 当前是否处于 alternate screen（vim/less/htop 等全屏程序的标准信号）。 */
  readonly alternateScreen: boolean
  /** 子进程是否在 normal buffer 上执行过整屏清除并重画（如 systemd 的 less -X）。 */
  readonly screenTakeover: boolean
  /** normal buffer 中包含当前光标行的自然内容高度。 */
  readonly normalContentRows: number
  /** normal buffer 中最后一行非空内容之后的高度，不包含尾部空光标行。 */
  readonly normalOutputRows: number
  /** 子进程是否请求了 SGR（1006）鼠标编码 */
  readonly sgrMouse: boolean
  /** DECTCEM（CSI ? 25 h/l）控制的子终端光标可见性。 */
  readonly cursorVisible: boolean
  readonly mouseTracking: MouseTrackingMode
  readonly applicationCursorKeys: boolean
  readonly bracketedPaste: boolean
  /** 回看滚动（scrollback），单位行 */
  scrollLines(delta: number): void
  scrollToBottom(): void
}

/** render.ts 需要的最小屏幕读接口，便于纯函数测试。 */
export interface AntermScreen {
  readonly cols: number
  readonly rows: number
  readonly cursorX: number
  readonly cursorY: number
  /** 光标在整个 buffer 中的绝对行号。 */
  readonly cursorAbsoluteY: number
  /** 视口首行在 buffer 中的绝对行号 */
  readonly viewportY: number
  getCell(absoluteY: number, x: number): AntermCell | null
}

export interface AntermCell {
  chars: string
  width: number
  fg: number
  bg: number
  fgMode: "default" | "palette" | "rgb"
  bgMode: "default" | "palette" | "rgb"
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  blink: boolean
  inverse: boolean
  strikethrough: boolean
}

export interface AntermHandle {
  write(data: string): void
  kill(): void
}

export interface AntermProps {
  /** 要运行的命令，如 "bash" */
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  onExit?: (code: number) => void
  style?: CssLikeStyle
  autoFocus?: boolean
  /** 复用由宿主拥有的 PTY 会话；组件卸载时不会终止该会话。 */
  tuiSession?: AntermSession
  /** 用 normal buffer 从首行平铺渲染，供流式历史自然增长。 */
  tuiFlow?: boolean
  /** flow 模式只冻结当前 viewport；用于曾整屏重画、已无法还原 append-only 历史的会话。 */
  tuiFlowViewport?: boolean
  /** 使用外部会话时，是否让当前视图尺寸同步回 PTY；浮层视图需要开启。 */
  tuiResizeSession?: boolean
  /** 退出后的只读展示态：保留画面，但不再注册为可交互焦点。 */
  tuiReadOnly?: boolean
  /** 仅关闭组件自身的键盘/粘贴转发；宿主可据此统一接管外部 PTY 会话的输入。 */
  tuiKeyboardDisabled?: boolean
  /** 覆盖终端默认背景色，供嵌入卡片与宿主底色融合。 */
  tuiBackgroundColor?: string
  /** 回看缓冲行数，默认 1000 */
  tuiScrollback?: number
  /**
   * 覆盖 ANSI 0-15 的色板（16 项 hex）。索引 16-255 是与主题无关的标准
   * 256 色立方体，不受此项影响。
   */
  tuiPalette?: readonly string[]
  /** 交还焦点的逃逸键，默认 "ctrl+]"（telnet 风格）。终端独占全部按键，没有它焦点出不来。 */
  tuiEscapeKey?: string
  /**
   * 宿主热键表（键名如 "ctrl+o"）。终端聚焦时命中的键被拦截并调用回调，不透传给
   * 子进程——供宿主保留少量自己的快捷键（如切换窗口大小）。
   */
  tuiHotkeys?: Record<string, () => void>
  tuiOnTitleChange?: (title: string) => void
  tuiOnReady?: (handle: AntermHandle) => void
}
