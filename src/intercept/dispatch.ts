/**
 * Hook dispatcher — the entry point called by `engram intercept` for every
 * hook invocation.
 *
 * Responsibilities:
 *   1. Parse stdin JSON payload (done by the caller, passed in here as an
 *      already-parsed object).
 *   2. Validate the payload has the minimum required shape.
 *   3. Route to the appropriate handler by (hook_event_name, tool_name).
 *   4. Run the handler through `runHandler` so error and timeout safety
 *      nets are enforced uniformly.
 *   5. Return a HandlerResult for the caller to serialize and emit.
 *
 * Unknown hook events or unsupported tools resolve to PASSTHROUGH. The
 * dispatcher is the sole place where the "list of supported handlers"
 * is enumerated, which makes adding a new handler a one-line change.
 *
 * Safety: this function itself never throws. runHandler catches handler
 * errors and converts them to PASSTHROUGH; dispatch's own error path
 * (e.g., malformed payload) also resolves to PASSTHROUGH.
 */
import {
  runHandler,
  PASSTHROUGH,
  type HandlerResult,
  type Passthrough,
} from "./safety.js";
import { handleRead, type ReadHookPayload } from "./handlers/read.js";
import {
  handleEditOrWrite,
  type EditWriteHookPayload,
} from "./handlers/edit-write.js";
import { handleBash, type BashHookPayload } from "./handlers/bash.js";
import {
  handleSessionStart,
  type SessionStartHookPayload,
} from "./handlers/session-start.js";
import {
  handleUserPromptSubmit,
  type UserPromptHookPayload,
} from "./handlers/user-prompt.js";
import {
  handlePostTool,
  type PostToolHookPayload,
} from "./handlers/post-tool.js";

/**
 * Minimum validated shape of a hook payload as delivered to `dispatchHook`.
 * The dispatcher checks these fields exist before routing; anything less
 * becomes passthrough.
 */
interface MinimalHookPayload {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
  readonly cwd?: unknown;
}

/**
 * Validate that a raw object has the minimum fields required to be a
 * hook payload. Returns the cast payload if valid, or null if the shape
 * is wrong. String coercion on required fields is deliberate — we never
 * trust unknown inputs beyond "it looks like a plain object".
 */
function validatePayload(
  raw: unknown
): MinimalHookPayload | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as MinimalHookPayload;
  if (typeof p.hook_event_name !== "string") return null;
  if (typeof p.cwd !== "string") return null;
  // tool_input may be absent for some events (SessionStart, etc.) but
  // when present it must be an object.
  if (p.tool_input !== undefined && (p.tool_input === null || typeof p.tool_input !== "object")) {
    return null;
  }
  return p;
}

/**
 * Central dispatch function. Takes a parsed hook payload, routes to the
 * appropriate handler, and returns its result wrapped in runHandler's
 * error/timeout safety net.
 *
 * Handler registry (v0.3.0 Sentinel complete):
 *
 *   | Event              | Tool  | Handler                 |
 *   |--------------------|-------|-------------------------|
 *   | PreToolUse         | Read  | handleRead              |
 *   | PreToolUse         | Edit  | handleEditOrWrite       |
 *   | PreToolUse         | Write | handleEditOrWrite       |
 *   | PreToolUse         | Bash  | handleBash              |
 *   | SessionStart       |  —    | handleSessionStart      |
 *   | UserPromptSubmit   |  —    | handleUserPromptSubmit  |
 *   | PostToolUse        |  —    | handlePostTool          |
 *
 * Unknown events and unsupported PreToolUse tools resolve to PASSTHROUGH.
 */
export async function dispatchHook(
  rawPayload: unknown
): Promise<HandlerResult | Passthrough> {
  const payload = validatePayload(rawPayload);
  if (payload === null) return PASSTHROUGH;

  const event = payload.hook_event_name;

  switch (event) {
    case "PreToolUse":
      return dispatchPreToolUse(payload);

    case "SessionStart":
      return runHandler(() =>
        handleSessionStart(payload as unknown as SessionStartHookPayload)
      );

    case "UserPromptSubmit":
      return runHandler(() =>
        handleUserPromptSubmit(payload as unknown as UserPromptHookPayload)
      );

    case "PostToolUse":
      return runHandler(() =>
        handlePostTool(payload as unknown as PostToolHookPayload)
      );

    default:
      return PASSTHROUGH;
  }
}

/**
 * PreToolUse sub-router. Routes by tool_name to the appropriate handler.
 * Factored out so the top-level switch stays readable.
 */
function dispatchPreToolUse(
  payload: MinimalHookPayload
): Promise<HandlerResult | Passthrough> {
  const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
  const handlerPayload = payload as unknown as {
    readonly tool_name: string;
    readonly tool_input: Record<string, unknown>;
    readonly cwd: string;
  };

  switch (tool) {
    case "Read":
      return runHandler(() =>
        handleRead(handlerPayload as unknown as ReadHookPayload)
      );

    case "Edit":
    case "Write":
      return runHandler(() =>
        handleEditOrWrite(handlerPayload as unknown as EditWriteHookPayload)
      );

    case "Bash":
      return runHandler(() =>
        handleBash(handlerPayload as unknown as BashHookPayload)
      );

    default:
      return Promise.resolve(PASSTHROUGH);
  }
}
