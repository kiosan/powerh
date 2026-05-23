import { useEffect, useState } from "react";
import { api, type SetupStatus } from "../lib/api";

export function Settings() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [stravaClientId, setStravaClientId] = useState("");
  const [stravaClientSecret, setStravaClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const s = await api<SetupStatus>("/setup");
    setStatus(s);
    setAnthropicModel(s.model);
  };

  useEffect(() => {
    load().catch((e) => setMsg(String(e)));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { anthropicModel };
      if (anthropicApiKey) body.anthropicApiKey = anthropicApiKey;
      if (stravaClientId) body.stravaClientId = stravaClientId;
      if (stravaClientSecret) body.stravaClientSecret = stravaClientSecret;
      await api("/setup", { method: "POST", body: JSON.stringify(body) });
      setAnthropicApiKey("");
      setStravaClientId("");
      setStravaClientSecret("");
      await load();
      setMsg("Збережено.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!status) return <div>Завантаження…</div>;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Налаштування</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          Anthropic (Claude)
          <span style={{ marginLeft: 8 }} className={`badge ${status.configured.anthropic ? "ok" : "warn"}`}>
            {status.configured.anthropic ? "налаштовано" : "не задано"}
          </span>
        </h2>
        <p className="muted">
          Отримайте ключ на <code>console.anthropic.com</code>. Зберігається локально у вашій базі SQLite.
        </p>
        <div className="field">
          <label>API ключ {status.hasAnthropicKey && <span className="muted">(встановлено — залиште порожнім, щоб не змінювати)</span>}</label>
          <input
            type="password"
            value={anthropicApiKey}
            onChange={(e) => setAnthropicApiKey(e.target.value)}
            placeholder="sk-ant-..."
          />
        </div>
        <div className="field">
          <label>Модель</label>
          <select value={anthropicModel} onChange={(e) => setAnthropicModel(e.target.value)}>
            <optgroup label="Opus — найпотужніші">
              <option value="claude-opus-4-7">claude-opus-4-7 — найкраща (1M контексту, $5/$25 за 1M токенів)</option>
              <option value="claude-opus-4-6">claude-opus-4-6 — попереднє покоління Opus</option>
              <option value="claude-opus-4-5">claude-opus-4-5 — давніший Opus</option>
            </optgroup>
            <optgroup label="Sonnet — баланс">
              <option value="claude-sonnet-4-6">claude-sonnet-4-6 — швидкість + якість ($3/$15)</option>
              <option value="claude-sonnet-4-5">claude-sonnet-4-5 — попередній Sonnet</option>
            </optgroup>
            <optgroup label="Haiku — найшвидші та найдешевші">
              <option value="claude-haiku-4-5">claude-haiku-4-5 — найдешевша ($1/$5)</option>
            </optgroup>
          </select>
          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Для серйозних запитань (планування, інтерпретація аналізів) рекомендую <code>claude-opus-4-7</code>.
            Для звичайного чату підійде <code>claude-sonnet-4-6</code>.
          </p>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          Strava
          <span style={{ marginLeft: 8 }} className={`badge ${status.configured.strava ? "ok" : "warn"}`}>
            {status.configured.strava ? "налаштовано" : "не задано"}
          </span>
        </h2>
        <p className="muted">
          Створіть особистий API додаток на <code>strava.com/settings/api</code>. У полі "Authorization Callback Domain" вкажіть{" "}
          <code>localhost</code>. Потім вставте Client ID та Client Secret нижче.
        </p>
        <div className="field">
          <label>Client ID {status.hasStravaClientId && <span className="muted">(встановлено — залиште порожнім, щоб не змінювати)</span>}</label>
          <input value={stravaClientId} onChange={(e) => setStravaClientId(e.target.value)} placeholder="123456" />
        </div>
        <div className="field">
          <label>Client Secret {status.hasStravaClientSecret && <span className="muted">(встановлено — залиште порожнім, щоб не змінювати)</span>}</label>
          <input
            type="password"
            value={stravaClientSecret}
            onChange={(e) => setStravaClientSecret(e.target.value)}
          />
        </div>
      </div>

      <div className="row">
        <button onClick={save} disabled={saving}>
          {saving ? "Збереження…" : "Зберегти"}
        </button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  );
}
