import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type SetupStatus } from "../lib/api";

interface UiMessage {
  role: "user" | "assistant";
  text: string;
}

interface ConversationSummary {
  id: number;
  title: string | null;
  started_at: string;
  updated_at: string;
}

interface StoredMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: unknown; // content blocks
  created_at: string;
}

// Extract the user-visible text from a stored message's content blocks.
// User turns are normally [{type:"text",...}]; assistant turns may contain a
// mix of text + tool_use blocks — we only display the text.
function messageToUiText(role: string, content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === "object" && b !== null && "type" in b)
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .join("");
  }
  return "";
}

function fmtRelative(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год тому`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн тому`;
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
}

export function Chat() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    try {
      const r = await api<{ conversations: ConversationSummary[] }>("/conversations");
      setConversations(r.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    api<SetupStatus>("/setup")
      .then((s) => setConfigured(s.configured.anthropic))
      .catch(() => setConfigured(false));
    loadConversations();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const loadConversation = async (id: number) => {
    setLoadingConv(true);
    setError(null);
    try {
      const r = await api<{ conversation: ConversationSummary; messages: StoredMessage[] }>(
        `/conversations/${id}`,
      );
      // Only show user + assistant turns with displayable text; skip tool_result entries
      // and turns whose text content is empty (pure tool_use turns).
      const ui: UiMessage[] = [];
      for (const m of r.messages) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        // Skip tool_result user turns (their content is a tool_result block, not text)
        if (
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.length > 0 &&
          (m.content[0] as { type?: string }).type === "tool_result"
        ) {
          continue;
        }
        const text = messageToUiText(m.role, m.content);
        if (!text && m.role === "assistant") continue; // pure tool_use, no text
        ui.push({ role: m.role, text });
      }
      setMessages(ui);
      setConversationId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingConv(false);
    }
  };

  const newChat = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    setActiveTools([]);
  };

  const renameConversation = async (id: number, currentTitle: string | null) => {
    const next = prompt("Нова назва розмови:", currentTitle ?? "");
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try {
      await api(`/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: trimmed }),
      });
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteConversation = async (id: number) => {
    if (!confirm("Видалити цю розмову? Усі повідомлення буде втрачено.")) return;
    try {
      await api(`/conversations/${id}`, { method: "DELETE" });
      if (conversationId === id) newChat();
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          if (!block.trim() || block.startsWith(":")) continue;
          const lines = block.split("\n");
          let event = "message";
          let dataLine = "";
          for (const ln of lines) {
            if (ln.startsWith("event: ")) event = ln.slice(7).trim();
            else if (ln.startsWith("data: ")) dataLine = ln.slice(6);
          }
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (event === "delta") {
            if (data.conversationId != null) setConversationId(data.conversationId);
            if (data.text) {
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const lastIdx = prev.length - 1;
                const last = prev[lastIdx];
                if (!last || last.role !== "assistant") return prev;
                const next = prev.slice();
                next[lastIdx] = { ...last, text: last.text + data.text };
                return next;
              });
            }
          } else if (event === "tool") {
            if (data.status === "start") {
              setActiveTools((prev) => [...prev, data.name]);
            } else {
              setActiveTools((prev) => {
                const i = prev.indexOf(data.name);
                if (i < 0) return prev;
                const next = [...prev];
                next.splice(i, 1);
                return next;
              });
            }
          } else if (event === "error") {
            setError(data.error ?? "Unknown error");
          } else if (event === "done") {
            if (data.conversationId != null) setConversationId(data.conversationId);
          }
        }
      }
      // Refresh the sidebar (new conversation appears or existing one bumps to top)
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      setActiveTools([]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (configured === null) return <div>Завантаження…</div>;
  if (!configured) {
    return (
      <div className="chat">
        <h1>Чат</h1>
        <div className="card">
          <p>Задайте ваш Anthropic API ключ у <a href="/settings" style={{ color: "var(--accent)" }}>Налаштуваннях</a>, щоб почати спілкування.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <button onClick={newChat} style={{ marginBottom: 8 }}>+ Нова розмова</button>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8, padding: "0 4px" }}>
          Збережено розмов: {conversations.length}
        </div>
        <div style={{ overflowY: "auto", flex: 1, marginRight: -8, paddingRight: 8 }}>
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => c.id !== conversationId && loadConversation(c.id)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                cursor: c.id === conversationId ? "default" : "pointer",
                background: c.id === conversationId ? "rgba(249,115,22,0.12)" : "transparent",
                marginBottom: 2,
              }}
              onMouseEnter={(e) => {
                if (c.id !== conversationId) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                if (c.id !== conversationId) e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: c.id === conversationId ? "var(--accent)" : "var(--fg)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={c.title ?? "(без назви)"}
              >
                {c.title ?? "(без назви)"}
              </div>
              <div className="muted" style={{ fontSize: 11, display: "flex", justifyContent: "space-between" }}>
                <span>{fmtRelative(c.updated_at)}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); renameConversation(c.id, c.title); }}
                    style={{ color: "var(--muted)" }}
                  >
                    ред.
                  </a>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteConversation(c.id); }}
                    style={{ color: "var(--muted)" }}
                  >
                    видал.
                  </a>
                </span>
              </div>
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: "8px 4px" }}>
              Поки немає збережених розмов.
            </div>
          )}
        </div>
      </aside>

      <div className="chat" style={{ flex: 1, maxWidth: "none", margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>
            {conversationId
              ? conversations.find((c) => c.id === conversationId)?.title ?? "Чат"
              : "Нова розмова"}
          </h1>
          {loadingConv && <span className="muted">Завантаження…</span>}
        </div>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && !loadingConv && (
            <div className="muted" style={{ padding: 12 }}>
              Запитайте про ваші тренування, результати аналізів або плани на сьогодні. Підключіть Strava у розділі Джерела для глибших відповідей.
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`msg ${m.role}`}
              style={{ display: "flex", flexDirection: "column" }}
            >
              {m.role === "assistant" ? (
                m.text ? (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  </div>
                ) : sending && i === messages.length - 1 ? (
                  "…"
                ) : (
                  ""
                )
              ) : (
                m.text
              )}
            </div>
          ))}
        </div>
        {activeTools.length > 0 && (
          <div className="muted" style={{ padding: "4px 12px", fontSize: 12 }}>
            Виконується: {activeTools.join(", ")}…
          </div>
        )}
        {error && (
          <div className="card" style={{ borderColor: "var(--accent)", marginTop: 8 }}>
            <span className="muted">Помилка:</span> {error}
          </div>
        )}
        <div className="composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Запитайте що завгодно… (Enter — відправити, Shift+Enter — новий рядок)"
            rows={2}
            disabled={sending}
          />
          <button onClick={send} disabled={sending || !input.trim()}>
            {sending ? "…" : "Надіслати"}
          </button>
        </div>
      </div>
    </div>
  );
}
