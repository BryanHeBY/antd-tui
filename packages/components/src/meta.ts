/**
 * 组件表面元数据：白名单供 engine（schema 校验）与 live（$ui 操作级校验）共用。
 * 放在 components 包：这两张表描述的就是本包组件的公开 props 表面。
 */

/** 页面可用的组件名（x-component / $ui.add 的合法取值） */
export const componentWhitelist: string[] = [
  "FormItem",
  "Input",
  "InputNumber",
  "TextArea",
  "Slider",
  "Select",
  "Checkbox",
  "Checkbox.Group",
  "Radio.Group",
  "Switch",
  "Typography.Text",
  "Typography.Link",
  "List",
  "List.Item",
  "Card",
  "Space",
  "Flex",
  "Button",
  "Alert",
  "Tag",
  "Divider",
  "Progress",
  "Statistic",
  "Descriptions",
  "Spin",
  "Table",
  "Row",
  "Col",
]

/**
 * 各组件 props 的合法键表：未知 prop 键直接拒绝（拦 typo 与臆造字段）。
 *
 * 维护约定：键名与组件 Props 接口一致；value/onChange 由绑定层注入，
 * 但作者也允许显式书写（如 void Statistic 的静态 value、Button 的 onClick）。
 */
export const componentPropsWhitelist: Record<string, readonly string[]> = {
  FormItem: ["label", "required", "help", "validateStatus"],
  Input: ["placeholder", "disabled", "value", "style", "tuiOnChange", "tuiOnPressEnter"],
  TextArea: ["placeholder", "disabled", "rows", "style", "value", "defaultValue", "tuiOnChange"],
  InputNumber: ["placeholder", "disabled", "value", "onChange"],
  Slider: ["min", "max", "step", "disabled", "tuiShowValue", "style", "value", "onChange"],
  Select: ["options", "disabled", "value", "tuiOnChange"],
  Checkbox: ["checked", "disabled", "value", "tuiOnChange"],
  "Checkbox.Group": ["options", "disabled", "tuiDirection", "value", "onChange"],
  "Radio.Group": ["options", "disabled", "optionType", "tuiDirection", "value", "tuiOnChange"],
  Switch: [
    "checked",
    "disabled",
    "loading",
    "checkedChildren",
    "unCheckedChildren",
    "value",
    "tuiOnChange",
  ],
  "Typography.Text": ["type", "strong", "tuiAlign"],
  "Typography.Link": ["href", "disabled", "type", "underline", "tuiOnClick"],
  List: ["dataSource", "renderItem", "loading", "header", "footer", "bordered", "split", "locale"],
  "List.Item": ["extra", "actions"],
  Card: ["title"],
  Space: ["direction", "size", "wrap"],
  Flex: ["vertical", "gap", "justify", "align", "wrap", "flex", "style", "tuiScroll"],
  Button: ["type", "disabled", "block", "tuiSize", "style", "tuiHotkey", "tuiOnClick"],
  Alert: ["type", "message", "description", "showIcon"],
  Tag: ["color", "bordered"],
  Divider: ["dashed", "orientation"],
  Progress: ["percent", "status", "showInfo", "style"],
  Statistic: ["title", "value", "precision", "prefix", "suffix", "tuiValueType"],
  Descriptions: ["title", "items", "column", "bordered"],
  Spin: ["spinning", "tip", "tuiIntervalMs"],
  Table: ["columns", "dataSource", "rowKey", "bordered", "tuiEmptyText"],
  Row: ["gutter", "align", "justify", "wrap", "style"],
  Col: ["span", "offset", "flex", "style"],
}
