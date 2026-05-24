import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";

interface Plan {
  id: number;
  horizon: string | null;
  body_md: string;
  status: string;
  created_at: string;
}

const HORIZON_LABELS: Record<string, string> = {
  session: "тренування",
  week: "тиждень",
  month: "місяць",
  "race-block": "змагальний блок",
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "запропоновано",
  active: "активний",
  archived: "архів",
};

function fmtDate(iso: string): string {
  return new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"))
    .toLocaleString("uk-UA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Tab = "active" | "proposed" | "archived";

const TAB_LABELS: Record<Tab, string> = {
  active: "Активний",
  proposed: "Чернетки",
  archived: "Архів",
};

const TAB_ICONS: Record<Tab, string> = {
  active: "🟢",
  proposed: "📝",
  archived: "📦",
};

const EMPTY_TAB_MESSAGES: Record<Tab, string> = {
  active:
    'Немає активного плану. Попроси асистента в Чаті скласти план — наприклад "сплануй мені тиждень з акцентом на витривалість". Збережений план з\'явиться у вкладці Чернетки; звідти його можна активувати.',
  proposed: "Немає чернеток. Плани з'являються тут, коли асистент пропонує їх — їх можна активувати, відредагувати або видалити.",
  archived: "Архів порожній.",
};

export function ActivePlan() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [tab, setTab] = useState<Tab>("active");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ plans: Plan[] }>("/plans");
      setPlans(r.plans);
    } catch (e) {
      setMsg(String(e));
    }
  };
  useEffect(() => { load(); }, []);

  const setStatus = async (id: number, status: string) => {
    await api(`/plans/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
    // Helpful: when the user activates / archives a plan, jump to that tab so
    // the plan they just acted on stays in view.
    if (status === "active" || status === "proposed" || status === "archived") {
      setTab(status as Tab);
    }
  };

  const saveBody = async (id: number) => {
    if (!draft.trim()) return;
    try {
      await api(`/plans/${id}`, { method: "PATCH", body: JSON.stringify({ body_md: draft }) });
      setEditing(null);
      setMsg("Збережено.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const deletePlan = async (id: number) => {
    if (!confirm("Видалити цей план?")) return;
    await api(`/plans/${id}`, { method: "DELETE" });
    await load();
  };

  if (!plans) return <div>Завантаження…</div>;

  const counts: Record<Tab, number> = {
    active: plans.filter((p) => p.status === "active").length,
    proposed: plans.filter((p) => p.status === "proposed").length,
    archived: plans.filter((p) => p.status === "archived").length,
  };

  const visible = plans.filter((p) => p.status === tab);

  return (
    <div>
      <h1>Плани</h1>

      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          marginBottom: 16,
        }}
      >
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => {
          const isActive = t === tab;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={isActive}
              onClick={() => { setTab(t); setEditing(null); }}
              className="secondary"
              style={{
                background: "transparent",
                border: "0",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                borderRadius: 0,
                color: isActive ? "var(--accent)" : "var(--fg)",
                padding: "8px 14px",
                fontWeight: isActive ? 600 : 400,
                marginBottom: -1,
              }}
            >
              {TAB_ICONS[t]} {TAB_LABELS[t]}
              <span className="muted" style={{ marginLeft: 6, fontSize: 12, fontWeight: 400 }}>
                {counts[t]}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            {EMPTY_TAB_MESSAGES[tab]}
          </p>
        </div>
      ) : (
        visible.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            editing={editing === p.id}
            draft={draft}
            setDraft={setDraft}
            startEdit={() => { setEditing(p.id); setDraft(p.body_md); }}
            cancelEdit={() => setEditing(null)}
            saveEdit={() => saveBody(p.id)}
            setStatus={(s) => setStatus(p.id, s)}
            onDelete={() => deletePlan(p.id)}
          />
        ))
      )}

      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}

function PlanCard({
  plan, editing, draft, setDraft, startEdit, cancelEdit, saveEdit, setStatus, onDelete,
}: {
  plan: Plan;
  editing: boolean;
  draft: string;
  setDraft: (s: string) => void;
  startEdit: () => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  setStatus: (s: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{HORIZON_LABELS[plan.horizon ?? ""] ?? plan.horizon ?? "план"}</strong>{" "}
          <span className={`badge ${plan.status === "active" ? "ok" : "warn"}`}>
            {STATUS_LABELS[plan.status] ?? plan.status}
          </span>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{fmtDate(plan.created_at)}</span>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {!editing && plan.status !== "active" && <button onClick={() => setStatus("active")}>Активувати</button>}
          {!editing && plan.status === "active" && <button className="secondary" onClick={() => setStatus("archived")}>В архів</button>}
          {!editing && plan.status === "archived" && <button className="secondary" onClick={() => setStatus("active")}>Відновити</button>}
          {!editing && <button className="secondary" onClick={startEdit}>Редагувати</button>}
          {!editing && <button className="secondary" onClick={onDelete}>Видалити</button>}
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 12 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Markdown: **жирний**, *курсив*, - списки, # заголовки. {draft.length.toLocaleString()} / 20,000
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button onClick={saveEdit}>Зберегти</button>
            <button className="secondary" onClick={cancelEdit}>Скасувати</button>
          </div>
        </div>
      ) : (
        <div className="markdown" style={{ marginTop: 12, lineHeight: 1.6 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan.body_md}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
