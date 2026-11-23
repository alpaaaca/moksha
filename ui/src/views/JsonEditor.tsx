import { useRef, type KeyboardEvent } from "react";

// pretty re-indents JSON text two spaces deep; text that isn't JSON stays as it is.
export function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// jsonError says what is wrong with text as JSON, and where ("line 2,
// column 14: expected , or ]"); "" if nothing. Its own scan, so every
// browser says it the same way, with a place (Chrome's messages often have none).
export function jsonError(text: string): string {
  if (!text.trim()) return "";
  try {
    JSON.parse(text);
    return "";
  } catch {
    const [pos, what] = scan(text);
    const before = text.slice(0, pos).split("\n");
    return `line ${before.length}, column ${before[before.length - 1].length + 1}: ${what}`;
  }
}

// scan finds the first place text stops being JSON, and why.
function scan(text: string): [number, string] {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = (what: string): never => {
    throw [i, what];
  };
  const found = () => (i >= text.length ? "the end" : JSON.stringify(text[i]));
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail(`expected a "key", found ${found()}`);
        string();
        ws();
        if (text[i] !== ":") fail(`expected : after the key, found ${found()}`);
        i++;
        value();
        ws();
        if (text[i] === ",") {
          i++;
          ws();
          if (text[i] === "}") fail("no , before }");
          continue;
        }
        if (text[i] === "}") return void i++;
        fail(`expected , or }, found ${found()}`);
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ",") {
          i++;
          ws();
          if (text[i] === "]") fail("no , before ]");
          continue;
        }
        if (text[i] === "]") return void i++;
        fail(`expected , or ], found ${found()}`);
      }
    }
    if (c === '"') return string();
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (m && m[0]) return void (i += m[0].length);
    for (const w of ["true", "false", "null"]) if (text.startsWith(w, i)) return void (i += w.length);
    fail(i >= text.length ? "unexpected end: something is missing" : `unexpected ${found()}`);
  };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\n") fail('a string ends at the line\'s end: missing "');
      i += text[i] === "\\" ? 2 : 1;
    }
    if (i >= text.length) fail('unterminated string: missing "');
    i++;
  };
  try {
    value();
    ws();
    if (i < text.length) fail(`unexpected ${found()} after the value`);
    return [i, "not JSON"];
  } catch (e) {
    if (Array.isArray(e)) return e as [number, string];
    throw e;
  }
}

// JsonEditor edits JSON: line numbers, Tab indents, and onSubmit on ⌘/Ctrl+Enter.
// It grows with its text, up to a point, then scrolls.
export function JsonEditor({ value, onChange, onSubmit, label, error }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; label: string; error?: string }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;

  function key(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const t = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = t;
      onChange(value.slice(0, a) + "  " + value.slice(b));
      requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
    }
  }

  return (
    <div className={`json-editor${error ? " invalid" : ""}`}>
      <div className="json-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        aria-label={label}
        aria-invalid={!!error}
        className="mono"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        value={value}
        rows={Math.min(Math.max(lines, 3), 18)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={key}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
