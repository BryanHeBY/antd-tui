import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useKeyboard } from "@opentui/react"

/**
 * 焦点管理系统（最小版）。
 * 浏览器自带 tab order，终端没有，因此这里维护一个按挂载顺序排序的
 * focusable 注册表，Tab/Shift+Tab 循环切换，Enter 激活 action 类元素。
 * 注册项可选提供 getRect（布局后屏幕坐标），↑↓←→ 按空间最近邻导航。
 */

export type FocusableKind = "input" | "action" | "capture"

export interface FocusableRect {
  x: number
  y: number
  width: number
  height: number
}

interface FocusableEntry {
  id: string
  kind: FocusableKind
  disabled: boolean
  /** input 自己接管 Tab（如 Shell 补全）时，FocusScope 不执行焦点切换。 */
  captureTab?: boolean
  activate?: () => void
  getRect?: () => FocusableRect | null
}

type ArrowDirection = "up" | "down" | "left" | "right"

interface FocusContextValue {
  focusedId: string | null
  register: (entry: FocusableEntry) => () => void
  focusNext: () => void
  focusPrev: () => void
  /** 鼠标点击组件时把焦点转移过去（entry 需未禁用） */
  focusById: (id: string) => void
  /** 当前焦点元素的类别（热键组件用它避免吞掉输入框按键） */
  getFocusedKind: () => FocusableKind | null
  /** 本作用域是否在栈顶（浮层打开时下层作用域的按键须静默） */
  isActiveScope: () => boolean
}

const FocusContext = createContext<FocusContextValue | null>(null)

/** 嵌套深度：Modal 等浮层在更深的作用域内渲染 */
const FocusDepthContext = createContext<number>(-1)

/**
 * 每棵 React 树一份的作用域注册表（顶层 FocusScope 创建并经 context 下发）。
 * 仅「深度最大者」响应键盘；同深度并列（兄弟浮层）时后注册者为栈顶。
 * 不能挂模块级：同进程多 root（测试常见）会互相污染；也不能用挂载顺序判深度：
 * React 的 effect 是子先父后。
 */
interface ScopeRegistry {
  entries: Map<string, { depth: number; seq: number }>
  counter: number
}

const ScopeRegistryContext = createContext<ScopeRegistry | null>(null)

export interface FocusScopeProps {
  /**
   * 挂起本作用域：不参与栈顶竞争（isActiveScope 恒 false）、下发的 focusedId
   * 置空（子组件全部失焦，input 类不再吞按键）。宿主应用用它做键盘分区，
   * 如 vibe-tui 在「输入行模式」下挂起页面画板。鼠标事件不受影响。
   */
  suspended?: boolean
  children?: ReactNode
}

export function FocusScope({ suspended = false, children }: FocusScopeProps) {
  const scopeId = useId()
  const depth = useContext(FocusDepthContext) + 1
  const parentRegistry = useContext(ScopeRegistryContext)
  const ownRegistryRef = useRef<ScopeRegistry | null>(null)
  if (!parentRegistry && ownRegistryRef.current === null) {
    ownRegistryRef.current = { entries: new Map(), counter: 0 }
  }
  const registry = parentRegistry ?? ownRegistryRef.current!
  const entriesRef = useRef<FocusableEntry[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedIdRef = useRef<string | null>(null)
  focusedIdRef.current = focusedId
  const suspendedRef = useRef(suspended)
  suspendedRef.current = suspended

  useEffect(() => {
    if (suspended) return
    registry.entries.set(scopeId, { depth, seq: ++registry.counter })
    return () => {
      registry.entries.delete(scopeId)
    }
  }, [registry, scopeId, depth, suspended])

  const isActiveScope = () => {
    if (suspendedRef.current) return false
    const mine = registry.entries.get(scopeId)
    if (!mine) return true
    for (const [id, entry] of registry.entries) {
      if (id === scopeId) continue
      if (entry.depth > mine.depth || (entry.depth === mine.depth && entry.seq > mine.seq)) {
        return false
      }
    }
    return true
  }

  const enabled = () => entriesRef.current.filter((e) => !e.disabled)

  const move = useCallback((step: 1 | -1) => {
    const list = enabled()
    if (list.length === 0) return
    const current = focusedIdRef.current
    const idx = list.findIndex((e) => e.id === current)
    const nextIdx = idx < 0 ? 0 : (idx + step + list.length) % list.length
    setFocusedId(list[nextIdx]!.id)
  }, [])

  const register = useCallback((entry: FocusableEntry) => {
    entriesRef.current.push(entry)
    // 首个未禁用元素自动获得焦点；焦点项变为 disabled 时也要转给可用项。
    setFocusedId((prev) => {
      const current = entriesRef.current.find((item) => item.id === prev)
      return current && !current.disabled ? prev : (enabled()[0]?.id ?? null)
    })
    return () => {
      entriesRef.current = entriesRef.current.filter((e) => e.id !== entry.id)
      setFocusedId((prev) => (prev === entry.id ? (enabled()[0]?.id ?? null) : prev))
    }
  }, [])

  const spatialMove = useCallback((dir: ArrowDirection) => {
    const candidates = enabled().filter((e) => e.getRect?.())
    if (candidates.length === 0) return
    const current = entriesRef.current.find((e) => e.id === focusedIdRef.current)
    const curRect = current?.getRect?.()
    if (!current || !curRect) {
      setFocusedId(candidates[0]!.id)
      return
    }
    const cx = curRect.x + curRect.width / 2
    const cy = curRect.y + curRect.height / 2
    const horizontal = dir === "left" || dir === "right"
    interface Scored {
      entry: FocusableEntry
      primary: number
      secondary: number
    }
    const scored: Scored[] = []
    for (const entry of candidates) {
      if (entry.id === current.id) continue
      const rect = entry.getRect!()!
      const dx = rect.x + rect.width / 2 - cx
      const dy = rect.y + rect.height / 2 - cy
      if (horizontal) {
        if (dir === "left" ? dx >= 0 : dx <= 0) continue
        scored.push({ entry, primary: Math.abs(dx), secondary: Math.abs(dy) })
      } else {
        if (dir === "up" ? dy >= 0 : dy <= 0) continue
        scored.push({ entry, primary: Math.abs(dy), secondary: Math.abs(dx) })
      }
    }
    if (scored.length === 0) return
    // 锥形过滤：优先同行/同列方向的候选（终端字符宽高比约 1:2，垂直距离按 2 倍折算）
    const inCone = scored.filter((s) =>
      horizontal ? s.primary >= s.secondary * 2 : s.primary * 2 >= s.secondary,
    )
    const pool = inCone.length > 0 ? inCone : scored
    let best: FocusableEntry | null = null
    let bestScore = Infinity
    for (const s of pool) {
      const score = s.primary + s.secondary * 3
      if (score < bestScore) {
        bestScore = score
        best = s.entry
      }
    }
    if (best) setFocusedId(best.id)
  }, [])

  useKeyboard((key) => {
    // 焦点圈闭：浮层打开时只有最内层作用域响应按键
    if (!isActiveScope()) return
    const focused = entriesRef.current.find((e) => e.id === focusedIdRef.current)
    // capture 类组件（内嵌终端）独占全部按键：Tab 要透传给子进程做 shell 补全
    if (focused && focused.kind === "capture") return
    if (key.name === "tab") {
      if (focused?.captureTab) return
      move(key.shift ? -1 : 1)
      return
    }
    if (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") {
      // input 类组件自行消费方向键（光标移动 / Select 选项切换）
      if (focused && focused.kind === "input") return
      spatialMove(key.name)
      return
    }
    if (key.name === "return" || key.name === "enter") {
      // input 类组件自行消费 Enter（onSubmit），这里只激活 action
      if (focused && focused.kind === "action" && !focused.disabled) focused.activate?.()
    }
  })

  const focusById = useCallback((id: string) => {
    const entry = entriesRef.current.find((e) => e.id === id)
    if (entry && !entry.disabled) setFocusedId(id)
  }, [])

  const value = useMemo<FocusContextValue>(
    () => ({
      // 挂起时对子组件隐藏焦点：input 类失焦不再吞按键，恢复后焦点原样回来
      focusedId: suspended ? null : focusedId,
      register,
      focusNext: () => move(1),
      focusPrev: () => move(-1),
      focusById,
      getFocusedKind: () =>
        entriesRef.current.find((e) => e.id === focusedIdRef.current)?.kind ?? null,
      isActiveScope,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedId, register, move, focusById, suspended],
  )

  return (
    <ScopeRegistryContext.Provider value={registry}>
      <FocusDepthContext.Provider value={depth}>
        <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
      </FocusDepthContext.Provider>
    </ScopeRegistryContext.Provider>
  )
}

/**
 * 非 focusable 的作用域状态访问：供 Esc 等全局键盘处理在动手前
 * 判断本层是否在栈顶（浮层打开时下层的 Esc 必须静默）。
 */
export function useFocusScopeState() {
  const ctx = useContext(FocusContext)
  return { isActiveScope: ctx?.isActiveScope ?? (() => true) }
}

export interface UseFocusableOptions {
  kind: FocusableKind
  disabled?: boolean
  /** input 是否自行处理 Tab；为 true 时本作用域不把 Tab 当焦点导航。 */
  captureTab?: boolean
  onActivate?: () => void
  /** 返回布局后的屏幕矩形；提供后参与 ↑↓←→ 空间导航 */
  getRect?: () => FocusableRect | null
}

export function useFocusable({
  kind,
  disabled = false,
  captureTab = false,
  onActivate,
  getRect,
}: UseFocusableOptions) {
  const ctx = useContext(FocusContext)
  const id = useId()
  const activateRef = useRef(onActivate)
  activateRef.current = onActivate
  const getRectRef = useRef(getRect)
  getRectRef.current = getRect

  useEffect(() => {
    if (!ctx) return
    return ctx.register({
      id,
      kind,
      disabled,
      captureTab,
      activate: () => activateRef.current?.(),
      getRect: () => getRectRef.current?.() ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.register, id, kind, disabled, captureTab])

  return {
    focused: ctx?.focusedId === id,
    /** 鼠标点击时调用，把焦点转移到本组件 */
    requestFocus: () => ctx?.focusById(id),
    focusNext: ctx?.focusNext ?? (() => {}),
    focusPrev: ctx?.focusPrev ?? (() => {}),
    getFocusedKind: ctx?.getFocusedKind ?? (() => null),
    isActiveScope: ctx?.isActiveScope ?? (() => true),
  }
}
