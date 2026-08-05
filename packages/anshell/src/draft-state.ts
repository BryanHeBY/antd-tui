import type { CompletionItem, SyntaxDiagnostic } from "./shell"

export interface DraftState {
  input: string
  routeOverride: "shell" | "agent" | null
  diagnostic: SyntaxDiagnostic | null
  completions: CompletionItem[]
}

export type DraftAction =
  | { type: "change"; input: string }
  | { type: "reset" }
  | { type: "route"; route: DraftState["routeOverride"] }
  | { type: "diagnostic"; diagnostic: SyntaxDiagnostic | null }
  | { type: "completions"; completions: CompletionItem[] }

export const initialDraftState: DraftState = {
  input: "",
  routeOverride: null,
  diagnostic: null,
  completions: [],
}

/** 保证输入、分诊覆盖和派生提示在提交/取消时作为一个整体更新。 */
export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "change":
      return { ...state, input: action.input, diagnostic: null, completions: [] }
    case "reset":
      return initialDraftState
    case "route":
      return { ...state, routeOverride: action.route, diagnostic: null, completions: [] }
    case "diagnostic":
      return { ...state, diagnostic: action.diagnostic }
    case "completions":
      return { ...state, completions: action.completions }
  }
}
