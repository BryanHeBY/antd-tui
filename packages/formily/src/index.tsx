import { createSchemaField, connect, mapProps, FormProvider as FormilyFormProvider } from "@formily/react"
import type { Field as FieldType, Form } from "@formily/core"
import type { ReactNode } from "react"
import {
  Button,
  Card,
  Col,
  FormItem as TuiFormItem,
  Input as TuiInput,
  InputNumber as TuiInputNumber,
  Row,
  Select as TuiSelect,
  Space,
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

/** schema 可用的组件注册表 */
export const schemaComponents = {
  FormItem,
  Input,
  InputNumber,
  Select,
  ResultText,
  Card,
  Space,
  Button,
  Row,
  Col,
} as const

/** 供 engine 做 x-component / x-decorator 白名单校验 */
export const componentWhitelist: string[] = Object.keys(schemaComponents)

export const SchemaField = createSchemaField({
  components: schemaComponents,
})

// @formily/react 的类型基于 React 17，在 React 19 下需要收窄返回类型
export const FormProvider = FormilyFormProvider as unknown as (props: {
  form: Form
  children?: ReactNode
}) => ReactNode
