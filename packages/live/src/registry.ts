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
  List,
  Modal,
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
  "Typography.Title": Typography.Title,
  "Typography.Link": Typography.Link,
  List,
  "List.Item": List.Item,
  Card,
  Space,
  Flex,
  Button,
  "Button.Group": Button.Group,
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
  Modal,
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

/**
 * 能直接接收裸字符串 children 的组件（内部自己包 <text>）。
 * 其余组件（Card/Space/Flex/Row/Col 等 box 容器）收到裸字符串会触发
 * OpenTUI "Text must be created inside of a text node" 崩溃，
 * content 需由渲染器包一层文本组件。
 */
export const rawTextContentComponents: ReadonlySet<string> = new Set([
  "Button",
  "Typography.Text",
  "Typography.Title",
  "Typography.Link",
  "Tag",
  "Divider",
  "Checkbox",
  "List",
  "List.Item",
])

/**
 * 活树的通用 content 最终会作为 React children 传入组件；但各组件的“主文案”
 * 不一定来自 children。把这个事实显式暴露给 agent，避免 Alert.content 更新后
 * 误以为标题应随之变化。
 */
export interface LiveTextSemantics {
  /** content 在该组件里的可见角色；没有 content 时不输出该行。 */
  content: "primary" | "body" | "children" | "unsupported"
  /** 最醒目的文本应写入的 antd 风格 prop。 */
  primaryProp?: string
  /** 次级说明文案应写入的 prop。 */
  secondaryProp?: string
}

export const liveTextSemantics: Readonly<Record<string, LiveTextSemantics>> = {
  Button: { content: "primary" },
  "Typography.Text": { content: "primary" },
  "Typography.Title": { content: "primary" },
  "Typography.Link": { content: "primary" },
  Tag: { content: "primary" },
  "List.Item": { content: "primary" },
  Alert: { content: "children", primaryProp: "message", secondaryProp: "description" },
  Card: { content: "body", primaryProp: "title" },
  FormItem: { content: "children", primaryProp: "label" },
  Statistic: { content: "children", primaryProp: "title" },
  Descriptions: { content: "children", primaryProp: "title" },
  Modal: { content: "body", primaryProp: "title" },
}
