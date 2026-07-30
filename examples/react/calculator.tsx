/**
 * 原生 React 版计算器:与 schema/repl 版功能一致,但不经 engine 也不经 $ui——
 * 组件库当普通 React 组件用,状态是 useState、逻辑是组件内普通函数。
 * 三版对照:schema 声明式(JSON) / repl 命令式($ui 活对象树) / react 组件式(本文件)。
 *
 * 运行:bun run examples:calc:react(需要 TTY);Esc = 完成回传 display
 */
import { useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { Button, Col, Flex, Row, Typography, useFocusScopeState } from "@antd-tui/components"
import type { ExampleActions } from "./host"

interface Cell {
  label: string
  kind?: "op" | "dot" | "percent" | "clear" | "delete" | "equals"
  flex?: number
  hotkey?: string
}

const ROWS: Cell[][] = [
  [
    { label: "AC", kind: "clear", hotkey: "c" },
    { label: "DEL", kind: "delete", hotkey: "backspace" },
    { label: "%", kind: "percent" },
    { label: "÷", kind: "op", hotkey: "/" },
  ],
  [{ label: "7" }, { label: "8" }, { label: "9" }, { label: "×", kind: "op", hotkey: "*" }],
  [{ label: "4" }, { label: "5" }, { label: "6" }, { label: "-", kind: "op" }],
  [{ label: "1" }, { label: "2" }, { label: "3" }, { label: "+", kind: "op" }],
  [{ label: "0", flex: 2 }, { label: ".", kind: "dot" }, { label: "=", kind: "equals" }],
]

export function Calculator({ actions }: { actions?: ExampleActions }) {
  const [display, setDisplay] = useState("0")
  // 与 repl 版的闭包标记同职责:等号后输入数字直接开新算式
  const justEvaluatedRef = useRef(false)
  const { isActiveScope } = useFocusScopeState()

  const pressDigit = (d: string) => {
    if (justEvaluatedRef.current) {
      justEvaluatedRef.current = false
      setDisplay(d)
      return
    }
    setDisplay((s) => (s.slice(-1) === "%" ? s : s === "0" || s === "错误" ? d : s + d))
  }
  const pressOp = (op: string) => {
    justEvaluatedRef.current = false
    setDisplay((s) =>
      s === "错误" ? s : ("+-×÷".includes(s.slice(-1)) ? s.slice(0, -1) : s) + op,
    )
  }
  const pressDot = () => {
    if (justEvaluatedRef.current) {
      justEvaluatedRef.current = false
      setDisplay("0.")
      return
    }
    setDisplay((s) => {
      if (s === "错误") return "0."
      const segment = s.split(/[+\-×÷%]/).pop() ?? ""
      if (segment.includes(".")) return s
      return segment === "" ? `${s}0.` : `${s}.`
    })
  }
  const pressPercent = () => {
    justEvaluatedRef.current = false
    setDisplay((s) => (s === "错误" || "+-×÷%.".includes(s.slice(-1)) ? s : `${s}%`))
  }
  const clearAll = () => {
    justEvaluatedRef.current = false
    setDisplay("0")
  }
  const deleteOne = () => {
    justEvaluatedRef.current = false
    setDisplay((s) => (s === "错误" || s.length <= 1 ? "0" : s.slice(0, -1)))
  }
  const evaluate = () => {
    setDisplay((s) => {
      if (s === "错误") return s
      try {
        const expr = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/%/g, "/100")
        const result = Function(`return (${expr})`)() as number
        justEvaluatedRef.current = true
        return Number.isFinite(result) ? String(Math.round(result * 1e10) / 1e10) : "错误"
      } catch {
        justEvaluatedRef.current = false
        return "错误"
      }
    })
  }

  const press = (cell: Cell) => {
    switch (cell.kind) {
      case "op":
        return pressOp(cell.label)
      case "dot":
        return pressDot()
      case "percent":
        return pressPercent()
      case "clear":
        return clearAll()
      case "delete":
        return deleteOne()
      case "equals":
        return evaluate()
      default:
        return pressDigit(cell.label)
    }
  }

  // Esc = 完成回传(与 schema/repl 版的 interactive 语义一致)
  useKeyboard((key) => {
    if (key.name === "escape" && isActiveScope()) actions?.submit({ display })
  })

  return (
    <Flex vertical gap={0} style={{ padding: 1, width: "100%", height: "100%" }}>
      <Typography.Title>TUI 计算器（React 版）</Typography.Title>
      <Typography.Text type="secondary">组件库当普通 React 组件用，状态即 useState</Typography.Text>
      {/* 屏显条:深色底 + 右对齐,与键盘右边框对齐(连体组右侧预留 1 列) */}
      <Flex vertical align="flex-end" style={{ marginRight: 2, backgroundColor: "#1f1f1f", padding: 1 }}>
        <Typography.Text type="warning" strong>
          {display}
        </Typography.Text>
      </Flex>
      <Button.Group block tuiBordered>
        {ROWS.map((cells, r) => (
          <Row key={r} gutter={0} wrap={false}>
            {cells.map((cell) => (
              <Col key={cell.label} flex={cell.flex ?? 1}>
                <Button
                  type={cell.kind === "op" || cell.kind === "equals" ? "primary" : "default"}
                  tuiHotkey={cell.hotkey ?? cell.label}
                  tuiOnClick={() => press(cell)}
                >
                  {cell.label}
                </Button>
              </Col>
            ))}
          </Row>
        ))}
      </Button.Group>
    </Flex>
  )
}

if (import.meta.main) {
  const { runReactExample } = await import("./host")
  await runReactExample((actions) => <Calculator actions={actions} />)
}
