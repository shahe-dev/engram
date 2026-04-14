import { describe, it, expect } from "vitest";
import { detectStack } from "../../src/graph/stack-detect.js";
import type { GraphNode } from "../../src/graph/schema.js";

function makeFileNode(sourceFile: string, label = sourceFile): GraphNode {
  return {
    id: `file:${sourceFile}`,
    label,
    kind: "file",
    sourceFile,
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: 0,
    queryCount: 0,
    metadata: {},
  };
}

function makeClassNode(label: string): GraphNode {
  return {
    id: `class:${label}`,
    label,
    kind: "class",
    sourceFile: "src/x.py",
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: 0,
    queryCount: 0,
    metadata: {},
  };
}

describe("detectStack", () => {
  it("returns empty set for empty input", () => {
    expect(detectStack([])).toEqual(new Set());
  });

  it("detects python from .py files", () => {
    const nodes = [makeFileNode("src/main.py")];
    expect(detectStack(nodes).has("python")).toBe(true);
  });

  it("detects typescript from .ts and .tsx files", () => {
    const nodes = [makeFileNode("src/a.ts"), makeFileNode("src/b.tsx")];
    const stack = detectStack(nodes);
    expect(stack.has("typescript")).toBe(true);
  });

  it("detects fastapi framework from class labels", () => {
    const nodes = [makeFileNode("src/main.py"), makeClassNode("FastAPIRouter")];
    const stack = detectStack(nodes);
    expect(stack.has("python")).toBe(true);
    expect(stack.has("fastapi")).toBe(true);
  });

  it("detects mixed stack", () => {
    const nodes = [
      makeFileNode("backend/main.py"),
      makeFileNode("frontend/app.ts"),
    ];
    const stack = detectStack(nodes);
    expect(stack.has("python")).toBe(true);
    expect(stack.has("typescript")).toBe(true);
  });

  it("ignores non-file non-class nodes for extension detection", () => {
    const nodes: GraphNode[] = [
      {
        id: "concept:foo",
        label: "foo.py",
        kind: "concept",
        sourceFile: "",
        sourceLocation: null,
        confidence: "EXTRACTED",
        confidenceScore: 1.0,
        lastVerified: 0,
        queryCount: 0,
        metadata: {},
      },
    ];
    expect(detectStack(nodes).has("python")).toBe(false);
  });
});
