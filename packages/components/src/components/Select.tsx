import { useMemo } from "react"
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
 * 选择器。终端形态为内联列表（而非浮层下拉），聚焦后用 ↑/↓ 选择。
 */
export function Select({ value, onChange, options = [], disabled = false }: SelectProps) {
  const token = useToken()
  const { focused } = useFocusable({ kind: "input", disabled })

  const tuiOptions = useMemo(
    () =>
      options.map((o) => ({
        name: o.label,
        description: "",
        value: o.value,
      })),
    [options],
  )

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
    if (picked && picked.value !== undefined) onChange?.(picked.value)
  }

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )

  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimary : token.colorBorder,
      }}
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
