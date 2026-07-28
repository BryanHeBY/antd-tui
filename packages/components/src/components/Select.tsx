import { useMemo, useRef } from "react"
import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

export interface SelectOption {
  label: string
  value: string | number | boolean
}

export interface SelectProps {
  value?: string | number | boolean
  onChange?: (value: SelectOption["value"]) => void
  options?: SelectOption[]
  disabled?: boolean
}

/**
 * 选择器。终端形态为内联列表（而非浮层下拉），聚焦后用 ↑/↓ 选择，
 * 鼠标点击选项行直接选中（并把焦点转移过来）。
 */
export function Select({ value, onChange, options = [], disabled = false }: SelectProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const { focused, requestFocus } = useFocusable({
    kind: "input",
    disabled,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  const tuiOptions = useMemo(
    () =>
      options.map((o) => ({
        name: o.label,
        description: "",
        value: o.value,
      })),
    [options],
  )

  // opentui select 对同一次选择会同时触发 onChange 与 onSelect，这里按值幂等去重；
  // 与 antd 一致：重复选择当前值不触发 onChange
  const lastEmitted = useRef<SelectOption["value"] | undefined>(undefined)
  const emit = (next: SelectOption["value"]) => {
    if (next === value || next === lastEmitted.current) return
    lastEmitted.current = next
    onChange?.(next)
    // OpenTUI 对一次用户选择可能同步触发 onChange 和 onSelect，微任务内保留
    // 去重标记即可。若一直保留，受控父组件拒绝/回滚本次值后，用户将再也无法选择
    // 同一个选项。
    queueMicrotask(() => {
      if (lastEmitted.current === next) lastEmitted.current = undefined
    })
  }

  // 兼容 @opentui/react select 事件的不同参数形态：(index, option) 或 (option)
  const handleChange = (...args: unknown[]) => {
    let picked: { value?: SelectOption["value"] } | undefined
    for (const a of args) {
      if (a && typeof a === "object" && "value" in (a as object)) {
        picked = a as { value?: SelectOption["value"] }
        break
      }
    }
    if (!picked) {
      const idx = args.find((a) => typeof a === "number") as number | undefined
      if (idx !== undefined) picked = tuiOptions[idx]
    }
    if (picked && picked.value !== undefined) emit(picked.value)
  }

  // value 不在 options 中时不高亮任何项（-1），而非误显示第一项
  const selectedIndex = options.findIndex((o) => o.value === value)

  // showDescription=false 时每选项占 1 行，首行紧贴上边框，据此把点击 y 换算为选项下标
  const handleMouseDown = (event: MouseEvent) => {
    if (disabled) return
    requestFocus()
    const el = boxRef.current
    if (!el) return
    const idx = event.y - el.y - 1
    const picked = options[idx]
    if (picked !== undefined) emit(picked.value)
  }

  return (
    <box
      ref={boxRef}
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimaryHover : token.colorBorder,
      }}
      onMouseDown={handleMouseDown}
    >
      <select
        options={tuiOptions}
        selectedIndex={selectedIndex}
        focused={focused && !disabled}
        showDescription={false}
        onChange={handleChange}
        onSelect={handleChange}
        style={{ height: Math.max(1, tuiOptions.length), flexGrow: 1 }}
      />
    </box>
  )
}
