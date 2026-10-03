import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type BraceAst = {
  type: string;
  value?: string;
  nodes?: BraceAst[];
};

type BracesApi = {
  (input: string, options?: { maxDepth?: number }): string[];
  compile(input: string | BraceAst, options?: { maxDepth?: number }): string;
  expand(input: string | BraceAst, options?: { maxDepth?: number }): string[];
  parse(input: string, options?: { maxDepth?: number }): BraceAst;
  stringify(input: string | BraceAst, options?: { maxDepth?: number }): string;
};

const require = createRequire(import.meta.url);
const braces = require("braces") as BracesApi;

function makeNestedAst(depth: number): BraceAst {
  let node: BraceAst = { type: "text", value: "value" };
  for (let index = 0; index < depth; index += 1) {
    node = { type: "brace", nodes: [node] };
  }
  return { type: "root", nodes: [node] };
}

describe("braces nesting-depth security patch", () => {
  it("rejects deeply nested brace and parenthesis patterns before recursive processing", () => {
    const nestedBraces = `${"{".repeat(1_000)}value${"}".repeat(1_000)}`;
    const nestedParentheses = `${"(".repeat(1_000)}value${")".repeat(1_000)}`;

    expect(() => braces(nestedBraces)).toThrow(/max depth/i);
    expect(() => braces.expand(nestedBraces)).toThrow(/max depth/i);
    expect(() => braces(nestedParentheses)).toThrow(/max depth/i);
  });

  it("guards compile, expand, and stringify when given a deeply nested AST directly", () => {
    const ast = makeNestedAst(101);

    expect(() => braces.compile(ast)).toThrow(/exceeds max depth/i);
    expect(() => braces.expand(ast)).toThrow(/exceeds max depth/i);
    expect(() => braces.stringify(ast)).toThrow(/exceeds max depth/i);
  });

  it("preserves normal expansion and supports a stricter caller-selected depth", () => {
    expect(braces.expand("{alpha,beta}")).toEqual(["alpha", "beta"]);
    expect(() => braces("{{alpha,beta},gamma}", { maxDepth: 1 })).toThrow(/max depth/i);
  });
});
