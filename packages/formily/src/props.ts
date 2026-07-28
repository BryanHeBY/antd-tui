/**
 * 各组件 x-component-props / x-decorator-props 的合法键表。
 * 供 engine 校验 agent 生成的 schema：未知 prop 键直接拒绝（拦 typo 与臆造字段）。
 *
 * 维护约定：键名与组件 Props 接口一致；value/onChange 由 formily 注入，
 * 但作者也允许显式书写（如 void Statistic 的静态 value、Button 的 onClick）。
 */
export const componentPropsWhitelist: Record<string, readonly string[]> = {
  FormItem: ["label", "required", "help", "validateStatus"],
  Input: ["placeholder", "disabled", "onPressEnter", "value", "onChange"],
  TextArea: ["placeholder", "disabled", "rows", "value", "onChange"],
  InputNumber: ["placeholder", "disabled", "value", "onChange"],
  Slider: ["min", "max", "step", "disabled", "tuiShowValue", "style", "value", "onChange"],
  Select: ["options", "disabled", "value", "onChange"],
  Checkbox: ["checked", "disabled", "value", "onChange"],
  CheckboxGroup: ["options", "disabled", "tuiDirection", "value", "onChange"],
  RadioGroup: ["options", "disabled", "optionType", "tuiDirection", "value", "onChange"],
  Switch: [
    "checked",
    "disabled",
    "loading",
    "checkedChildren",
    "unCheckedChildren",
    "value",
    "onChange",
  ],
  ResultText: ["type", "bold", "align", "value"],
  Card: ["title"],
  Space: ["direction", "size"],
  Button: ["type", "disabled", "block", "tuiSize", "style", "tuiHotkey", "onClick"],
  Alert: ["type", "message", "description", "showIcon"],
  Tag: ["color", "bordered"],
  Divider: ["dashed", "orientation"],
  Progress: ["percent", "status", "showInfo", "style"],
  Statistic: ["title", "value", "precision", "prefix", "suffix", "tuiValueType"],
  Descriptions: ["title", "items", "column", "bordered"],
  Spin: ["spinning", "tip", "tuiIntervalMs"],
  Table: ["columns", "dataSource", "rowKey", "bordered", "tuiEmptyText"],
  Row: ["gutter", "style"],
  Col: ["span", "flex", "style"],
}
