import { describe, it, expect } from "vitest";
import { scoreRelevance } from "../src/miners/plugin-miner.js";

describe("scoreRelevance", () => {
  it("returns INFERRED 0.6 when stack is empty", () => {
    const result = scoreRelevance("python-tdd", "Python TDD workflow", new Set());
    expect(result.confidence).toBe("INFERRED");
    expect(result.score).toBe(0.6);
  });

  it("returns EXTRACTED 1.0 when skill name matches stack language", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("python-tdd", "Python TDD workflow", stack);
    expect(result.confidence).toBe("EXTRACTED");
    expect(result.score).toBe(1.0);
  });

  it("returns EXTRACTED 1.0 when skill matches stack framework", () => {
    const stack = new Set(["python", "fastapi"]);
    const result = scoreRelevance("fastapi-patterns", "FastAPI patterns", stack);
    expect(result.confidence).toBe("EXTRACTED");
  });

  it("returns AMBIGUOUS 0.2 when skill mentions non-matching language", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("kotlin-review", "Kotlin code review", stack);
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.score).toBe(0.2);
  });

  it("returns INFERRED 0.6 for universal keywords when no language mention", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("security-review", "Security audit", stack);
    expect(result.confidence).toBe("INFERRED");
    expect(result.score).toBe(0.6);
  });

  it("returns AMBIGUOUS 0.2 when nothing matches", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("random-thing", "unrelated content", stack);
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.score).toBe(0.2);
  });
});
