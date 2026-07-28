import { createSchemaField, connect, mapProps, FormProvider as FormilyFormProvider } from "@formily/react"
import { Schema } from "@formily/json-schema"
import type { Field as FieldType, Form } from "@formily/core"
import type { ReactNode } from "react"
import {
  Alert,
  Button,
  Card,
  Checkbox as TuiCheckbox,
  Col,
  Descriptions,
  Divider,
  FormItem as TuiFormItem,
  Input as TuiInput,
  InputNumber as TuiInputNumber,
  Progress,
  Radio as TuiRadio,
  Row,
  Select as TuiSelect,
  Slider as TuiSlider,
  Space,
  Spin,
  Statistic,
  Switch as TuiSwitch,
  Table,
  Tag,
  Typography,
  type SelectOption,
} from "@antd-tui/components"

/**
 * Formily x-component / x-decorator → antd-tui 组件映射层。
 * 对应官方 @formily/antd-v5 的角色。
 */

// 装饰器：从 field 状态注入 label / required / help（错误信息）
const FormItem = connect(
  TuiFormItem,
  mapProps((props, field) => {
    const f = field as FieldType
    const errors = f.selfErrors ?? []
    return {
      ...props,
      label: (props as { label?: string }).label ?? (f.title as string),
      required: f.required,
      help: errors.length > 0 ? errors.join("; ") : undefined,
      validateStatus: errors.length > 0 ? ("error" as const) : undefined,
    }
  }),
)

// formily 通过 onChange 下发值变更，桥接到 TUI 命名的 tuiOnChange
const Input = connect(
  TuiInput,
  mapProps((props) => {
    const { onChange, ...rest } = props as { onChange?: (value: string) => void }
    return { ...rest, tuiOnChange: onChange }
  }),
)

const InputNumber = connect(TuiInputNumber)

// enum 会被 formily 写入 field.dataSource，这里转成组件的 options
const Select = connect(
  TuiSelect,
  mapProps((props, field) => {
    const f = field as FieldType
    const dataSource = (f.dataSource ?? []) as Array<{ label?: string; value?: unknown }>
    const options: SelectOption[] = dataSource.map((item) => ({
      label: String(item.label ?? item.value),
      value: item.value as SelectOption["value"],
    }))
    return { ...props, options }
  }),
)

// TextArea：终端缓冲区自维护内容，formily 的 value 仅作初值
const TextArea = connect(
  TuiInput.TextArea,
  mapProps((props) => {
    const { onChange, value, ...rest } = props as {
      onChange?: (value: string) => void
      value?: string
    }
    return { ...rest, tuiDefaultValue: value, tuiOnChange: onChange }
  }),
)

const Slider = connect(TuiSlider)

// 单个 Checkbox：formily 的 onChange 桥接到 tuiOnChange（值即 boolean）
const Checkbox = connect(
  TuiCheckbox,
  mapProps((props) => {
    const { onChange, value, ...rest } = props as {
      onChange?: (checked: boolean) => void
      value?: boolean
    }
    return { ...rest, checked: value ?? false, tuiOnChange: onChange }
  }),
)

// Checkbox.Group / Radio.Group：enum 转 options，onChange 语义与 antd 一致
function useOptionsFromField(field: unknown) {
  const f = field as FieldType
  const dataSource = (f.dataSource ?? []) as Array<{ label?: string; value?: unknown }>
  return dataSource.map((item) => ({
    label: String(item.label ?? item.value),
    value: item.value as string | number,
  }))
}

const CheckboxGroup = connect(
  TuiCheckbox.Group,
  mapProps((props, field) => ({ ...props, options: useOptionsFromField(field) })),
)

const RadioGroup = connect(
  TuiRadio.Group,
  mapProps((props, field) => {
    const { onChange, ...rest } = props as { onChange?: (value: string | number) => void }
    return { ...rest, options: useOptionsFromField(field), tuiOnChange: onChange }
  }),
)

const Switch = connect(
  TuiSwitch,
  mapProps((props) => {
    const { value, ...rest } = props as { value?: boolean }
    return { ...rest, checked: value ?? false }
  }),
)

// 只读展示组件（TUI 自有，无 antd 对应）：把 field.value 渲染为高亮文本
interface ResultTextProps {
  value?: unknown
  type?: "secondary" | "success" | "warning" | "danger"
  bold?: boolean
  align?: "left" | "center" | "right"
}

function ResultTextView({ value, type = "success", bold = true, align }: ResultTextProps) {
  return (
    <Typography.Text type={type} strong={bold} tuiAlign={align}>
      {value === undefined || value === null || value === "" ? "—" : String(value)}
    </Typography.Text>
  )
}

const ResultText = connect(ResultTextView)

// 展示组件挂 void 节点时，ReactiveField 会把 value 覆盖为 undefined
// （{...componentProps, value} 的展开顺序所致），这里从 componentProps 找回
const StatisticBinding = connect(
  Statistic,
  mapProps((props, field) => {
    const value = (props as { value?: unknown }).value
    if (value !== undefined) return props
    const cp = (field as { componentProps?: { value?: string | number } }).componentProps
    return { ...props, value: cp?.value }
  }),
)

/** schema 可用的组件注册表 */
export const schemaComponents = {
  FormItem,
  Input,
  InputNumber,
  TextArea,
  Slider,
  Select,
  Checkbox,
  CheckboxGroup,
  RadioGroup,
  Switch,
  ResultText,
  Card,
  Space,
  Button,
  Alert,
  Tag,
  Divider,
  Progress,
  Statistic: StatisticBinding,
  Descriptions,
  Spin,
  Table,
  Row,
  Col,
} as const

/** 供 engine 做 x-component / x-decorator 白名单校验 */
export const componentWhitelist: string[] = Object.keys(schemaComponents)

export { componentPropsWhitelist } from "./props"

export const SchemaField = createSchemaField({
  components: schemaComponents,
})

/**
 * 编译页面 Schema 的 scope 段：{ 函数名: "{{ 表达式 }}" } → 可注入 SchemaField scope 的具名函数表。
 * base 通常为 { $form, $memo }；Formily 表达式引擎按作用域惰性查找，
 * 因此 scope 函数之间可互相调用（不受定义顺序限制）。
 */
export function compileScope(
  defs: Record<string, string> | undefined,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = { ...base }
  for (const [name, expr] of Object.entries(defs ?? {})) {
    scope[name] = Schema.shallowCompile(expr, scope)
  }
  return scope
}

// @formily/react 的类型基于 React 17，在 React 19 下需要收窄返回类型
export const FormProvider = FormilyFormProvider as unknown as (props: {
  form: Form
  children?: ReactNode
}) => ReactNode
