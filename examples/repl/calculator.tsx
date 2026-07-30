/**
 * REPL 版计算器：与 examples/schema/calculator.json 功能一致，
 * 但由 $ui 活对象树搭建——计算逻辑是真 JS 函数（闭包持有 justEvaluated 标记），
 * 没有 "{{ }}" 表达式字符串；键盘用循环生成，不必手写 20 个按钮的 JSON。
 *
 * 运行：bun run examples:calc:repl（需要 TTY）；Esc = 完成回传 display
 */
import type { LiveUi } from "@antd-tui/live"

export function buildCalculator($ui: LiveUi): void {
  $ui.page({
    title: "TUI 计算器（REPL 版）",
    description: "由 $ui 活对象树搭建，逻辑为真 JS 闭包",
    mode: "interactive",
  })

  // 计算器自身不留行间隙：连体组的边框就是节奏，紧凑布局能在常见终端高度完整呈现。
  const calculator = $ui.add("Flex", {
    id: "calculator",
    props: { vertical: true, gap: 0, style: { width: "100%" } },
  })
  // 显示区做成"计算器屏幕"：深色底条与连体键盘同宽（键盘右侧预留 1 列画共享边框，
  // 故底条 marginRight: 2 对齐键盘右边框），数字右对齐贴右缘——屏与键盘成为有机整体。
  calculator
    .add("Flex", {
      id: "screen",
      props: {
        vertical: true,
        align: "flex-end",
        style: { marginRight: 2, backgroundColor: "#1f1f1f", padding: 1 },
      },
    })
    .add("Typography.Text", {
      name: "display",
      default: "0",
      props: { type: "warning", strong: true },
    })

  // —— 计算逻辑：真函数；justEvaluated 直接活在闭包里，不需要 $memo 通道 ——
  let justEvaluated = false
  const display = () => String($ui.data.display ?? "0")
  const setDisplay = (value: string) => {
    $ui.data.display = value
  }

  const pressDigit = (d: string) => {
    const s = display()
    if (justEvaluated) {
      justEvaluated = false
      setDisplay(d)
      return
    }
    if (s.slice(-1) === "%") return
    setDisplay(s === "0" || s === "错误" ? d : s + d)
  }
  const pressOp = (op: string) => {
    const s = display()
    if (s === "错误") return
    justEvaluated = false
    const trimmed = "+-×÷".includes(s.slice(-1)) ? s.slice(0, -1) : s
    setDisplay(trimmed + op)
  }
  const pressDot = () => {
    const s = display()
    if (s === "错误" || justEvaluated) {
      justEvaluated = false
      setDisplay("0.")
      return
    }
    const segment = s.split(/[+\-×÷%]/).pop() ?? ""
    if (segment.includes(".")) return
    setDisplay(segment === "" ? `${s}0.` : `${s}.`)
  }
  const pressPercent = () => {
    const s = display()
    if (s === "错误" || "+-×÷%.".includes(s.slice(-1))) return
    justEvaluated = false
    setDisplay(`${s}%`)
  }
  const clearAll = () => {
    justEvaluated = false
    setDisplay("0")
  }
  const deleteOne = () => {
    const s = display()
    justEvaluated = false
    setDisplay(s === "错误" || s.length <= 1 ? "0" : s.slice(0, -1))
  }
  const evaluate = () => {
    const s = display()
    if (s === "错误") return
    try {
      const expr = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/%/g, "/100")
      const result = Function(`return (${expr})`)() as number
      setDisplay(Number.isFinite(result) ? String(Math.round(result * 1e10) / 1e10) : "错误")
      justEvaluated = true
    } catch {
      setDisplay("错误")
      justEvaluated = false
    }
  }

  // —— 键盘：循环生成 ——
  interface Cell {
    label: string
    onClick?: () => void
    flex?: number
    primary?: boolean
    hotkey?: string
  }
  const rows: Cell[][] = [
    [
      { label: "AC", onClick: clearAll, hotkey: "c" },
      { label: "DEL", onClick: deleteOne, hotkey: "backspace" },
      { label: "%", onClick: pressPercent },
      { label: "÷", onClick: () => pressOp("÷"), primary: true, hotkey: "/" },
    ],
    [
      { label: "7" },
      { label: "8" },
      { label: "9" },
      { label: "×", onClick: () => pressOp("×"), primary: true, hotkey: "*" },
    ],
    [
      { label: "4" },
      { label: "5" },
      { label: "6" },
      { label: "-", onClick: () => pressOp("-"), primary: true },
    ],
    [
      { label: "1" },
      { label: "2" },
      { label: "3" },
      { label: "+", onClick: () => pressOp("+"), primary: true },
    ],
    [
      { label: "0", flex: 2 },
      { label: ".", onClick: pressDot },
      { label: "=", onClick: evaluate, primary: true },
    ],
  ]
  const keypad = calculator.add("Button.Group", {
    props: {
      block: true,
      tuiBordered: true,
    },
  })
  for (const cells of rows) {
    // 连体操作组：布局仍使用 antd 的 Row / Col；Button.Group 只负责共享边框。
    const row = keypad.add("Row", { props: { gutter: 0, wrap: false } })
    for (const cell of cells) {
      const col = row.add("Col", { props: { flex: cell.flex ?? 1 } })
      col.add("Button", {
        content: cell.label,
        props: {
          ...(cell.primary ? { type: "primary" } : {}),
          tuiHotkey: cell.hotkey ?? cell.label,
          tuiOnClick: cell.onClick ?? (() => pressDigit(cell.label)),
        },
      })
    }
  }
}

if (import.meta.main) {
  const { runLiveExample } = await import("./host")
  await runLiveExample(($ui) => buildCalculator($ui))
}
