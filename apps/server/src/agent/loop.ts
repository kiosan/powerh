import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "./client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { runtime } from "../config/runtime.js";
import { conversations, type StoredMessage } from "../db/conversations.js";
import { TOOL_DEFS, runTool } from "./tools/index.js";

type Msg = Anthropic.MessageParam;

function toApiMessages(stored: StoredMessage[]): Msg[] {
  const out: Msg[] = [];
  for (const m of stored) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    out.push({ role: m.role, content: JSON.parse(m.content) });
  }
  return out;
}

export interface ChatChunk {
  type: "text" | "tool" | "done" | "error";
  text?: string;
  tool?: { name: string; status: "start" | "end" };
  error?: string;
  conversationId?: number;
}

const MAX_TOOL_ITERATIONS = 8;

/**
 * Streams a chat response with tool use. Persists the user turn, then runs
 * the tool-use loop: stream → on stop_reason=tool_use, execute tools → loop.
 *
 * System prompt is cached (cache_control: ephemeral) so multi-turn cost stays low.
 */
export async function* streamChat(
  conversationId: number | null,
  userText: string,
): AsyncGenerator<ChatChunk> {
  let convId: number;
  if (conversationId == null) {
    convId = conversations.create(userText.slice(0, 60)).id;
  } else {
    convId = conversationId;
  }

  conversations.addMessage(convId, "user", [{ type: "text", text: userText }]);

  let client: Anthropic;
  try {
    client = getAnthropic();
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : String(e), conversationId: convId };
    return;
  }

  const systemPrompt = buildSystemPrompt();
  const model = runtime.anthropicModel();

  // Open marker so client gets the conversation id immediately.
  yield { type: "text", text: "", conversationId: convId };

  let messages = toApiMessages(conversations.messages(convId));

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: TOOL_DEFS,
      messages,
    });

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const finalMessage = await stream.finalMessage();
      // Persist this assistant turn (full content blocks — text + tool_use)
      conversations.addMessage(convId, "assistant", finalMessage.content);
      messages.push({ role: "assistant", content: finalMessage.content });

      if (finalMessage.stop_reason !== "tool_use") {
        yield { type: "done", conversationId: convId };
        return;
      }

      const toolUses = finalMessage.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        yield { type: "tool", tool: { name: tu.name, status: "start" } };
        const result = await runTool(tu.name, (tu.input as Record<string, unknown>) ?? {});
        yield { type: "tool", tool: { name: tu.name, status: "end" } };
        const isError = typeof result === "object" && result !== null && "error" in (result as object);
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: [{ type: "text", text: JSON.stringify(result) }],
          ...(isError ? { is_error: true } : {}),
        });
      }

      // Persist the tool results as a user turn (Anthropic convention).
      conversations.addMessage(convId, "user", results);
      messages.push({ role: "user", content: results });
      // loop again to let the model respond to the tool results
    } catch (e) {
      yield { type: "error", error: e instanceof Error ? e.message : String(e), conversationId: convId };
      return;
    }
  }

  yield {
    type: "error",
    error: `Exceeded tool-use iteration limit (${MAX_TOOL_ITERATIONS}).`,
    conversationId: convId,
  };
}
