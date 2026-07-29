import type { ComponentType } from "react"
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Flex,
  FormItem,
  Input,
  InputNumber,
  Progress,
  Radio,
  Row,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from "@antd-tui/components"

/** 组件名（与 componentWhitelist 对齐）→ 真组件；点号名与 schema 通路一致 */
export const liveComponents = {
  FormItem,
  Input,
  InputNumber,
  TextArea: Input.TextArea,
  Slider,
  Select,
  Checkbox,
  "Checkbox.Group": Checkbox.Group,
  "Radio.Group": Radio.Group,
  Switch,
  "Typography.Text": Typography.Text,
  Card,
  Space,
  Flex,
  Button,
  Alert,
  Tag,
  Divider,
  Progress,
  Statistic,
  Descriptions,
  Spin,
  Table,
  Row,
  Col,
} as unknown as Record<string, ComponentType<Record<string, unknown>>>

/**
 * 输入组件绑定元数据：name ↔ $ui.data 双向绑定所需。
 * 组件回调命名不统一（多数 tuiOnChange，Slider/InputNumber/Checkbox.Group 是 onChange；
 * boolean 组件受控 prop 是 checked），差异集中收敛在这张表。
 */
export interface InputBinding {
  valueProp: "value" | "checked"
  changeProp: "tuiOnChange" | "onChange"
  /** name 绑定且 data 无值时的兜底初值 */
  emptyValue?: unknown
}

export const inputBindings: Record<string, InputBinding> = {
  Input: { valueProp: "value", changeProp: "tuiOnChange", emptyValue: "" },
  TextArea: { valueProp: "value", changeProp: "tuiOnChange", emptyValue: "" },
  InputNumber: { valueProp: "value", changeProp: "onChange" },
  Slider: { valueProp: "value", changeProp: "onChange" },
  Select: { valueProp: "value", changeProp: "tuiOnChange" },
  Checkbox: { valueProp: "checked", changeProp: "tuiOnChange", emptyValue: false },
  "Checkbox.Group": { valueProp: "value", changeProp: "onChange", emptyValue: [] },
  "Radio.Group": { valueProp: "value", changeProp: "tuiOnChange" },
  Switch: { valueProp: "checked", changeProp: "tuiOnChange", emptyValue: false },
}

/** Typography.Text 的 name 绑定是单向显示（String(data[name])），无 change 回调 */
export const DISPLAY_BINDING_COMPONENT = "Typography.Text"
