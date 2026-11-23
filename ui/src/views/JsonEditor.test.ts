import { jsonError, pretty } from "./JsonEditor";

test("jsonError says where JSON breaks, and why", () => {
  expect(jsonError('{\n  "a": 1\n}')).toBe("");
  expect(jsonError("")).toBe("");
  expect(jsonError('{\n  "versions": [x\n}')).toBe('line 2, column 16: unexpected "x"');
  expect(jsonError('{"a": 1,}')).toBe("line 1, column 9: no , before }");
  expect(jsonError('{"a": 1 "b": 2}')).toBe('line 1, column 9: expected , or }, found "\\""');
  expect(jsonError("{a: 1}")).toBe('line 1, column 2: expected a "key", found "a"');
  expect(jsonError('{"a": [1, 2}')).toBe('line 1, column 12: expected , or ], found "}"');
  expect(jsonError('{"a": "b')).toBe('line 1, column 9: unterminated string: missing "');
  expect(jsonError('{"a": 1}}')).toBe('line 1, column 9: unexpected "}" after the value');
  expect(jsonError('{"a":')).toBe("line 1, column 6: unexpected end: something is missing");
  expect(jsonError('{"s": "a\\"b", "n": -1.5e3, "t": true, "z": null}')).toBe("");
});

test("pretty indents JSON two spaces; other text stays as it is", () => {
  expect(pretty('{"a":[1]}')).toBe('{\n  "a": [\n    1\n  ]\n}');
  expect(pretty("not json")).toBe("not json");
});
