import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";

interface Activity {
  id: number;
  kind: string | null;
  name: string | null;
  started_at: string;
  duration_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
}

interface Note {
  id: number;
  kind: string;
  body: string;
  created_at: string;
}

interface Plan {
  id: number;
  horizon: string | null;
  body_md: string;
  status: string;
  created_at: string;
}

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} год ${m} хв` : `${m} хв`;
}
function fmtDistance(m: number | null): string {
  if (m == null) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const NOTE_KIND_LABELS: Record<string, string> = {
  observation: "спостереження",
  preference: "уподобання",
  goal: "ціль",
  digest: "тижневий огляд",
};

const PLAN_HORIZON_LABELS: Record<string, string> = {
  session: "тренування",
  week: "тиждень",
  month: "місяць",
  "race-block": "змагальний блок",
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  proposed: "запропоновано",
  active: "активний",
  archived: "архів",
};

export function Dashboard() {
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const [a, n, p] = await Promise.all([
        api<{ activities: Activity[] }>("/activities?limit=15"),
        api<{ notes: Note[] }>("/notes?limit=10"),
        api<{ plans: Plan[] }>("/plans"),
      ]);
      setActivities(a.activities);
      setNotes(n.notes);
      setPlans(p.plans);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const runDigest = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; note_id?: number; reason?: string }>("/digest/run", {
        method: "POST",
        body: "{}",
      });
      setMsg(r.ok ? `Огляд створено (нотатка #${r.note_id}).` : `Пропущено: ${r.reason}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const deleteNote = async (id: number) => {
    await api(`/notes/${id}`, { method: "DELETE" });
    await load();
  };
  const setPlanStatus = async (id: number, status: string) => {
    await api(`/plans/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
  };
  const deletePlan = async (id: number) => {
    if (!confirm("Видалити цей план?")) return;
    await api(`/plans/${id}`, { method: "DELETE" });
    await load();
  };

  if (err) return <div className="card">Помилка: {err}</div>;
  if (!activities || !notes || !plans) return <div>Завантаження…</div>;

  return (
    <div>
      <h1>Огляд</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Тижневий огляд</h2>
        <p className="muted">
          Короткий підсумок тижня. Запускається автоматично кожного понеділка о 07:00 за вашим часом, або вручну будь-коли.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={runDigest} disabled={running}>
            {running ? "Генерується…" : "Згенерувати огляд зараз"}
          </button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Активні плани</h2>
        {plans.filter((p) => p.status !== "archived").length === 0 && (
          <p className="muted">Планів ще немає. Попросіть асистента ("сплануй наступний тиждень") — план збережеться сюди.</p>
        )}
        {plans.filter((p) => p.status !== "archived").map((p) => (
          <div key={p.id} style={{ paddingTop: 8, borderTop: "1px solid var(--border)", marginTop: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{PLAN_HORIZON_LABELS[p.horizon ?? ""] ?? p.horizon ?? "план"}</strong>{" "}
                <span className={`badge ${p.status === "active" ? "ok" : "warn"}`}>
                  {PLAN_STATUS_LABELS[p.status] ?? p.status}
                </span>
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{p.created_at}</span>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {p.status !== "active" && <button onClick={() => setPlanStatus(p.id, "active")}>Активувати</button>}
                {p.status === "active" && <button className="secondary" onClick={() => setPlanStatus(p.id, "archived")}>В архів</button>}
                <button className="secondary" onClick={() => deletePlan(p.id)}>Видалити</button>
              </div>
            </div>
            <div className="markdown" style={{
              background: "var(--bg)", padding: 12, borderRadius: 6, marginTop: 8, lineHeight: 1.55,
            }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.body_md}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Нотатки асистента</h2>
        {notes.length === 0 && <p className="muted">Ще немає. Асистент зберігатиме нотатки про важливі факти (уподобання, цілі, тренди).</p>}
        {notes.map((n) => (
          <div key={n.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span className="badge warn" style={{ marginRight: 8 }}>
                  {NOTE_KIND_LABELS[n.kind] ?? n.kind}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{n.created_at}</span>
                <div className="markdown" style={{ marginTop: 4, lineHeight: 1.55 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.body}</ReactMarkdown>
                </div>
              </div>
              <button className="secondary" onClick={() => deleteNote(n.id)}>Видалити</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Нещодавні активності</h2>
        {activities.length === 0 && (
          <p className="muted">
            Активностей ще немає. Підключіть Strava у <a href="/sources" style={{ color: "var(--accent)" }}>Джерелах</a> та натисніть Синхронізувати.
          </p>
        )}
        {activities.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>Коли</th>
                <th style={{ padding: "6px 8px" }}>Тип</th>
                <th style={{ padding: "6px 8px" }}>Назва</th>
                <th style={{ padding: "6px 8px" }}>Відстань</th>
                <th style={{ padding: "6px 8px" }}>Тривалість</th>
                <th style={{ padding: "6px 8px" }}>Сер. пульс</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px" }}>{fmtDate(a.started_at)}</td>
                  <td style={{ padding: "8px" }}>{a.kind ?? "—"}</td>
                  <td style={{ padding: "8px" }}>{a.name ?? "—"}</td>
                  <td style={{ padding: "8px" }}>{fmtDistance(a.distance_m)}</td>
                  <td style={{ padding: "8px" }}>{fmtDuration(a.duration_s)}</td>
                  <td style={{ padding: "8px" }}>{a.avg_hr ? Math.round(a.avg_hr) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
