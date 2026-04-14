/**
 * Project stack detection.
 *
 * Reads a snapshot of graph nodes (typically fresh AST output) and returns
 * a set of lowercase tokens describing the project's languages and
 * frameworks (e.g. "python", "fastapi", "docker"). Used by ecosystem
 * miners to score plugin-provided skills and agents against the current
 * project context.
 *
 * Pure function. No I/O. No store access. Caller provides the nodes.
 */
import type { GraphNode } from "./schema.js";

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".pl": "perl",
  ".pm": "perl",
};

const FRAMEWORK_MARKERS: Record<string, string> = {
  fastapi: "fastapi",
  django: "django",
  flask: "flask",
  pytest: "pytest",
  streamlit: "streamlit",
  pydantic: "pydantic",
  express: "express",
  react: "react",
  nextjs: "nextjs",
  "next.js": "nextjs",
  vue: "vue",
  angular: "angular",
  playwright: "playwright",
  gin: "gin",
  echo: "echo",
  fiber: "fiber",
  actix: "actix",
  tokio: "tokio",
  axum: "axum",
  spring: "spring",
  springboot: "springboot",
  junit: "junit",
  docker: "docker",
  postgres: "postgres",
  postgresql: "postgres",
  redis: "redis",
  graphql: "graphql",
  grpc: "grpc",
  duckdb: "duckdb",
};

export function detectStack(nodes: readonly GraphNode[]): Set<string> {
  const tokens = new Set<string>();

  for (const node of nodes) {
    if (node.kind === "file" && node.sourceFile) {
      const ext = node.sourceFile.match(/\.[a-z]+$/i)?.[0]?.toLowerCase();
      if (ext && EXT_TO_LANGUAGE[ext]) {
        tokens.add(EXT_TO_LANGUAGE[ext]);
      }
    }

    if (node.kind === "file" || node.kind === "class" || node.kind === "function") {
      const label = node.label.toLowerCase();
      for (const [marker, framework] of Object.entries(FRAMEWORK_MARKERS)) {
        if (label.includes(marker)) {
          tokens.add(framework);
        }
      }
    }
  }

  return tokens;
}
