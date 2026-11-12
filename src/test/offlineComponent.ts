/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

export type Tree = { tag: unknown; props: Record<string, unknown> };
export const jsx = {
  jsx: (tag: unknown, props: Record<string, unknown>) => ({ tag, props }),
  jsxs: (tag: unknown, props: Record<string, unknown>) => ({ tag, props }),
  Fragment: "fragment",
};
export function compile(source: string, filename: string) {
  return ts.transpileModule(source.replaceAll("import.meta.env.VITE_API_URL", "undefined"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
}
export function loadComponent(relative: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
  const module = { exports: {} };
  runInNewContext(compile(source, relative), {
    module, exports: module.exports, console, Date, URL, URLSearchParams, Response, Headers, AbortController,
    fetch() { throw new Error("Live fetch blocked by offline harness"); },
    require(name: string) {
      if (name.endsWith(".css")) return {};
      if (name in mocks) return mocks[name];
      throw new Error(`Unmocked dependency: ${name}`);
    },
    ...globals,
  }, { filename: relative });
  return module.exports as Record<string, (props: Record<string, unknown>) => Tree>;
}
export function findNode(tree: unknown, match: (node: Tree) => boolean): Tree | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findNode(child, match); if (found) return found; }
  } else if (tree && typeof tree === "object" && "props" in tree) {
    const node = tree as Tree;
    if (match(node)) return node;
    return findNode(node.props.children, match);
  }
}
