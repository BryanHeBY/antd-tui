export {
  lexShell,
  SHELL_BUILTINS,
  toCodePointOffset,
  toUtf16Offset,
  unquoteShellWord,
  type ShellLexResult,
  type ShellToken,
  type ShellTokenKind,
} from "./lexer"
export { checkShellSyntax, resolveShell, type SyntaxDiagnostic } from "./syntax"
export {
  commonPrefix,
  completeShellInput,
  type CompletionItem,
  type CompletionResult,
} from "./completion"
