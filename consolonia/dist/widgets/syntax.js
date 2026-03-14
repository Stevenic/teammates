/**
 * Syntax highlighting — plugin-driven tokenizer for code blocks.
 *
 * Each language plugin implements `SyntaxHighlighter` which splits a
 * line of source code into `SyntaxToken[]`. The markdown renderer
 * maps token types to `TextStyle` via `SyntaxTheme`.
 *
 * Built-in plugins: JavaScript/TypeScript, Python, C#.
 *
 * Register custom languages:
 *   import { registerHighlighter } from "@teammates/consolonia";
 *   registerHighlighter({ name: "ruby", aliases: ["rb"], tokenize: ... });
 */
import { WHITE, CYAN, GREEN, YELLOW, BLUE, MAGENTA, GRAY, } from "../pixel/color.js";
export const DEFAULT_SYNTAX_THEME = {
    keyword: { fg: MAGENTA },
    string: { fg: GREEN },
    number: { fg: YELLOW },
    comment: { fg: GRAY, italic: true },
    operator: { fg: CYAN },
    punctuation: { fg: WHITE },
    type: { fg: CYAN },
    function: { fg: BLUE },
    variable: { fg: WHITE },
    constant: { fg: YELLOW, bold: true },
    decorator: { fg: YELLOW },
    attribute: { fg: CYAN },
    text: { fg: WHITE },
};
// ── Registry ─────────────────────────────────────────────────────
const registry = new Map();
/** Register a syntax highlighter for one or more language aliases. */
export function registerHighlighter(highlighter) {
    registry.set(highlighter.name.toLowerCase(), highlighter);
    for (const alias of highlighter.aliases) {
        registry.set(alias.toLowerCase(), highlighter);
    }
}
/** Look up a highlighter by language name/alias. Returns null if not found. */
export function getHighlighter(lang) {
    return registry.get(lang.toLowerCase()) ?? null;
}
/** Tokenize a line using the registered highlighter for the given language. */
export function highlightLine(lang, line) {
    const h = getHighlighter(lang);
    if (!h)
        return [{ text: line, type: "text" }];
    return h.tokenize(line);
}
/**
 * Build a simple highlighter from an ordered list of regex rules.
 * Each rule's pattern is tested against the remaining input at each
 * position. First match wins. Unmatched characters become "text".
 */
function regexHighlighter(name, aliases, rules) {
    return {
        name,
        aliases,
        tokenize(line) {
            const tokens = [];
            let pos = 0;
            while (pos < line.length) {
                let matched = false;
                const remaining = line.slice(pos);
                for (const rule of rules) {
                    const m = rule.pattern.exec(remaining);
                    if (m && m.index === 0 && m[0].length > 0) {
                        tokens.push({ text: m[0], type: rule.type });
                        pos += m[0].length;
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    // Accumulate unmatched char into text
                    const last = tokens[tokens.length - 1];
                    if (last && last.type === "text") {
                        last.text += line[pos];
                    }
                    else {
                        tokens.push({ text: line[pos], type: "text" });
                    }
                    pos++;
                }
            }
            return tokens;
        },
    };
}
// ── Built-in: JavaScript / TypeScript ────────────────────────────
const JS_KEYWORDS = [
    "abstract", "as", "async", "await", "break", "case", "catch", "class",
    "const", "continue", "debugger", "default", "delete", "do", "else",
    "enum", "export", "extends", "finally", "for", "from", "function",
    "get", "if", "implements", "import", "in", "instanceof", "interface",
    "let", "new", "of", "package", "private", "protected", "public",
    "readonly", "return", "set", "static", "super", "switch", "this",
    "throw", "try", "type", "typeof", "var", "void", "while", "with",
    "yield",
];
const JS_CONSTANTS = ["true", "false", "null", "undefined", "NaN", "Infinity"];
const JS_TYPES = [
    "Array", "Boolean", "Date", "Error", "Function", "Map", "Number",
    "Object", "Promise", "RegExp", "Set", "String", "Symbol", "WeakMap",
    "WeakSet", "any", "boolean", "never", "number", "string", "unknown",
    "void", "bigint",
];
const jsHighlighter = regexHighlighter("javascript", ["js", "jsx", "ts", "tsx", "typescript", "mjs", "cjs"], [
    // Comments
    { type: "comment", pattern: /^\/\/.*/ },
    { type: "comment", pattern: /^\/\*[\s\S]*?\*\// },
    // Strings
    { type: "string", pattern: /^`(?:[^`\\]|\\.)*`/ },
    { type: "string", pattern: /^"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^'(?:[^'\\]|\\.)*'/ },
    // Template literal fragments (unclosed — just highlight to end of line)
    { type: "string", pattern: /^`[^`]*$/ },
    // Decorators
    { type: "decorator", pattern: /^@\w+/ },
    // Numbers
    { type: "number", pattern: /^0[xX][0-9a-fA-F_]+n?/ },
    { type: "number", pattern: /^0[bB][01_]+n?/ },
    { type: "number", pattern: /^0[oO][0-7_]+n?/ },
    { type: "number", pattern: /^\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?/ },
    // Constants
    { type: "constant", pattern: new RegExp(`^\\b(?:${JS_CONSTANTS.join("|")})\\b`) },
    // Types (capitalized or TS built-in)
    { type: "type", pattern: new RegExp(`^\\b(?:${JS_TYPES.join("|")})\\b`) },
    // Keywords
    { type: "keyword", pattern: new RegExp(`^\\b(?:${JS_KEYWORDS.join("|")})\\b`) },
    // Function calls
    { type: "function", pattern: /^\b[a-zA-Z_$]\w*(?=\s*\()/ },
    // Operators
    { type: "operator", pattern: /^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||<<|>>>|>>|\?\?|\?\.|[+\-*/%&|^~!<>=?:])/ },
    // Punctuation
    { type: "punctuation", pattern: /^[{}()\[\];,.]/ },
    // Identifiers
    { type: "variable", pattern: /^[a-zA-Z_$]\w*/ },
    // Whitespace
    { type: "text", pattern: /^\s+/ },
]);
registerHighlighter(jsHighlighter);
// ── Built-in: Python ─────────────────────────────────────────────
const PY_KEYWORDS = [
    "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from",
    "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
    "or", "pass", "raise", "return", "try", "while", "with", "yield",
    "match", "case",
];
const PY_CONSTANTS = ["True", "False", "None"];
const PY_TYPES = [
    "int", "float", "str", "bool", "list", "dict", "tuple", "set",
    "frozenset", "bytes", "bytearray", "complex", "range", "type",
    "object", "Exception", "ValueError", "TypeError", "KeyError",
    "IndexError", "AttributeError", "ImportError", "RuntimeError",
    "StopIteration", "Generator", "Callable", "Optional", "Union",
    "Any", "List", "Dict", "Tuple", "Set",
];
const pyHighlighter = regexHighlighter("python", ["py", "python3", "py3"], [
    // Comments
    { type: "comment", pattern: /^#.*/ },
    // Strings (triple-quoted)
    { type: "string", pattern: /^"""[\s\S]*?"""/ },
    { type: "string", pattern: /^'''[\s\S]*?'''/ },
    // Strings
    { type: "string", pattern: /^f"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^f'(?:[^'\\]|\\.)*'/ },
    { type: "string", pattern: /^r"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^r'(?:[^'\\]|\\.)*'/ },
    { type: "string", pattern: /^b"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^b'(?:[^'\\]|\\.)*'/ },
    { type: "string", pattern: /^"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^'(?:[^'\\]|\\.)*'/ },
    // Decorators
    { type: "decorator", pattern: /^@\w[\w.]*/ },
    // Numbers
    { type: "number", pattern: /^0[xX][0-9a-fA-F_]+/ },
    { type: "number", pattern: /^0[bB][01_]+/ },
    { type: "number", pattern: /^0[oO][0-7_]+/ },
    { type: "number", pattern: /^\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?/ },
    // Constants
    { type: "constant", pattern: new RegExp(`^\\b(?:${PY_CONSTANTS.join("|")})\\b`) },
    // Types
    { type: "type", pattern: new RegExp(`^\\b(?:${PY_TYPES.join("|")})\\b`) },
    // Keywords
    { type: "keyword", pattern: new RegExp(`^\\b(?:${PY_KEYWORDS.join("|")})\\b`) },
    // Function calls
    { type: "function", pattern: /^\b[a-zA-Z_]\w*(?=\s*\()/ },
    // self/cls
    { type: "variable", pattern: /^\b(?:self|cls)\b/ },
    // Operators
    { type: "operator", pattern: /^(?:->|:=|\*\*|\/\/|==|!=|<=|>=|<<|>>|[+\-*/%&|^~!<>=@])/ },
    // Punctuation
    { type: "punctuation", pattern: /^[{}()\[\]:;,.]/ },
    // Identifiers
    { type: "variable", pattern: /^[a-zA-Z_]\w*/ },
    // Whitespace
    { type: "text", pattern: /^\s+/ },
]);
registerHighlighter(pyHighlighter);
// ── Built-in: C# ────────────────────────────────────────────────
const CS_KEYWORDS = [
    "abstract", "as", "async", "await", "base", "bool", "break", "byte",
    "case", "catch", "char", "checked", "class", "const", "continue",
    "decimal", "default", "delegate", "do", "double", "else", "enum",
    "event", "explicit", "extern", "finally", "fixed", "float", "for",
    "foreach", "get", "goto", "if", "implicit", "in", "int", "interface",
    "internal", "is", "lock", "long", "namespace", "new", "object",
    "operator", "out", "override", "params", "partial", "private",
    "protected", "public", "readonly", "record", "ref", "required",
    "return", "sbyte", "sealed", "set", "short", "sizeof", "stackalloc",
    "static", "string", "struct", "switch", "this", "throw", "try",
    "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using",
    "var", "virtual", "void", "volatile", "when", "where", "while",
    "yield", "init", "global", "dynamic", "value", "nameof",
];
const CS_CONSTANTS = ["true", "false", "null"];
const CS_TYPES = [
    "Task", "List", "Dictionary", "HashSet", "IEnumerable", "IList",
    "ICollection", "IDictionary", "Action", "Func", "Nullable",
    "String", "Int32", "Int64", "Boolean", "Double", "Float",
    "Decimal", "Object", "Type", "Exception", "Console", "Math",
    "Span", "Memory", "ReadOnlySpan", "ValueTask",
];
const csHighlighter = regexHighlighter("csharp", ["cs", "c#"], [
    // Comments
    { type: "comment", pattern: /^\/\/.*/ },
    { type: "comment", pattern: /^\/\*[\s\S]*?\*\// },
    // Strings
    { type: "string", pattern: /^\$@"(?:[^"\\]|\\.|"")*"/ },
    { type: "string", pattern: /^@"(?:[^"\\]|"")*"/ },
    { type: "string", pattern: /^\$"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^'(?:[^'\\]|\\.)'/ },
    // Attributes
    { type: "attribute", pattern: /^\[[\w.]+(?:\(.*?\))?\]/ },
    // Numbers
    { type: "number", pattern: /^0[xX][0-9a-fA-F_]+[uUlLfFdDmM]?/ },
    { type: "number", pattern: /^0[bB][01_]+[uUlLfFdDmM]?/ },
    { type: "number", pattern: /^\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?[uUlLfFdDmM]?/ },
    // Constants
    { type: "constant", pattern: new RegExp(`^\\b(?:${CS_CONSTANTS.join("|")})\\b`) },
    // Types (built-in + PascalCase)
    { type: "type", pattern: new RegExp(`^\\b(?:${CS_TYPES.join("|")})\\b`) },
    { type: "type", pattern: /^\b[A-Z][a-zA-Z0-9]*(?=\s*[<{(])/ },
    // Keywords
    { type: "keyword", pattern: new RegExp(`^\\b(?:${CS_KEYWORDS.join("|")})\\b`) },
    // Generic type parameters
    { type: "type", pattern: /^<[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*>/ },
    // Method calls
    { type: "function", pattern: /^\b[a-zA-Z_]\w*(?=\s*[<(])/ },
    // Operators
    { type: "operator", pattern: /^(?:=>|&&|\|\||\?\?|\?\.|\?\[|==|!=|<=|>=|<<|>>|[+\-*/%&|^~!<>=?:])/ },
    // Punctuation
    { type: "punctuation", pattern: /^[{}()\[\];,.]/ },
    // Identifiers
    { type: "variable", pattern: /^[a-zA-Z_@]\w*/ },
    // Whitespace
    { type: "text", pattern: /^\s+/ },
]);
registerHighlighter(csHighlighter);
// ── Built-in: Bash / Shell ───────────────────────────────────────
const BASH_KEYWORDS = [
    "if", "then", "else", "elif", "fi", "for", "while", "until", "do",
    "done", "case", "esac", "in", "function", "select", "time", "coproc",
    "return", "exit", "break", "continue", "local", "declare", "typeset",
    "export", "readonly", "unset", "shift", "source", "eval", "exec",
    "trap",
];
const BASH_BUILTINS = [
    "echo", "printf", "read", "cd", "pwd", "pushd", "popd", "dirs",
    "set", "test", "true", "false", "command", "type", "which", "alias",
    "unalias", "bg", "fg", "jobs", "wait", "kill", "history",
    "getopts", "hash", "ulimit", "umask",
];
const bashHighlighter = regexHighlighter("bash", ["sh", "shell", "zsh", "fish", "ksh"], [
    // Comments
    { type: "comment", pattern: /^#.*/ },
    // Strings
    { type: "string", pattern: /^"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^'[^']*'/ },
    { type: "string", pattern: /^\$'(?:[^'\\]|\\.)*'/ },
    // Here-string
    { type: "string", pattern: /^<<<\s*\S+/ },
    // Variable expansions
    { type: "variable", pattern: /^\$\{[^}]*\}/ },
    { type: "variable", pattern: /^\$[A-Za-z_]\w*/ },
    { type: "variable", pattern: /^\$[0-9@#?*!$-]/ },
    // Command substitution
    { type: "function", pattern: /^\$\(/ },
    // Numbers
    { type: "number", pattern: /^\b\d+\b/ },
    // Builtins
    { type: "function", pattern: new RegExp(`^\\b(?:${BASH_BUILTINS.join("|")})\\b`) },
    // Keywords
    { type: "keyword", pattern: new RegExp(`^\\b(?:${BASH_KEYWORDS.join("|")})\\b`) },
    // Operators and redirections
    { type: "operator", pattern: /^(?:&&|\|\||>>|<<|[<>|&;])/ },
    { type: "operator", pattern: /^(?:==|!=|-eq|-ne|-lt|-gt|-le|-ge|-z|-n|-f|-d|-e|-r|-w|-x)/ },
    // Punctuation
    { type: "punctuation", pattern: /^[{}()\[\]]/ },
    // Flags
    { type: "constant", pattern: /^--?[a-zA-Z][\w-]*/ },
    // Identifiers
    { type: "variable", pattern: /^[a-zA-Z_]\w*/ },
    // Whitespace
    { type: "text", pattern: /^\s+/ },
]);
registerHighlighter(bashHighlighter);
// ── Built-in: JSON ───────────────────────────────────────────────
const jsonHighlighter = regexHighlighter("json", ["jsonc", "json5"], [
    // Comments (JSONC)
    { type: "comment", pattern: /^\/\/.*/ },
    { type: "comment", pattern: /^\/\*[\s\S]*?\*\// },
    // Property keys (quoted string before colon)
    { type: "type", pattern: /^"(?:[^"\\]|\\.)*"(?=\s*:)/ },
    // String values
    { type: "string", pattern: /^"(?:[^"\\]|\\.)*"/ },
    // Numbers
    { type: "number", pattern: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
    // Constants
    { type: "constant", pattern: /^\b(?:true|false|null)\b/ },
    // Punctuation
    { type: "punctuation", pattern: /^[{}()\[\]:,]/ },
    // Whitespace
    { type: "text", pattern: /^\s+/ },
]);
registerHighlighter(jsonHighlighter);
// ── Built-in: YAML ───────────────────────────────────────────────
const yamlHighlighter = regexHighlighter("yaml", ["yml"], [
    // Comments
    { type: "comment", pattern: /^#.*/ },
    // Document markers
    { type: "operator", pattern: /^(?:---|\.\.\.)$/ },
    // Keys (word before colon at start of line or after indent)
    { type: "type", pattern: /^[\w][\w.-]*(?=\s*:)/ },
    // Anchors and aliases
    { type: "decorator", pattern: /^[&*]\w+/ },
    // Tags
    { type: "attribute", pattern: /^![\w!./-]+/ },
    // Strings
    { type: "string", pattern: /^"(?:[^"\\]|\\.)*"/ },
    { type: "string", pattern: /^'(?:[^'\\]|\\.)*'/ },
    // Block scalar indicators
    { type: "operator", pattern: /^[|>][+-]?(?=\s|$)/ },
    // Constants
    { type: "constant", pattern: /^\b(?:true|false|null|yes|no|on|off|True|False|Null|Yes|No|On|Off|TRUE|FALSE|NULL|YES|NO|ON|OFF)\b/ },
    // Numbers
    { type: "number", pattern: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
    { type: "number", pattern: /^0[xX][0-9a-fA-F]+/ },
    { type: "number", pattern: /^0[oO][0-7]+/ },
    // Punctuation
    { type: "punctuation", pattern: /^[{}\[\]:,\-?]/ },
    // Plain scalars (unquoted values)
    { type: "variable", pattern: /^[^\s#:,\[\]{}]+/ },
    // Whitespace
    { type: "text", pattern: /^\s+/ },
]);
registerHighlighter(yamlHighlighter);
