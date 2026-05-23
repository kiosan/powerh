import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete: { id: number; firstname?: string; lastname?: string } | null;
  activities: { n: number; oldest: string | null; newest: string | null };
  callbackUrl: string;
}

export function Sources() {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      setStatus(await api<StravaStatus>("/sources/strava/status"));
    } catch (e) {
      setMsg(String(e));
    }
  };
  useEffect(() => {
    load();
  }, []);

  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { url } = await api<{ url: string }>("/sources/strava/connect");
      window.location.href = url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ fetched: number; upserted: number }>("/sources/strava/sync", {
        method: "POST",
        body: "{}",
      });
      setMsg(`Синхронізовано — отримано ${r.fetched}, оновлено ${r.upserted}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Від'єднати Strava? Збережені активності залишаться; ви зможете під'єднатися знову у будь-який час.")) return;
    setBusy(true);
    try {
      await api("/sources/strava/disconnect", { method: "POST", body: "{}" });
      setMsg("Від'єднано.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div>Завантаження…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Джерела</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          Strava
          <span style={{ marginLeft: 8 }} className={`badge ${status.connected ? "ok" : "warn"}`}>
            {status.connected ? "під'єднано" : status.configured ? "налаштовано, не під'єднано" : "не налаштовано"}
          </span>
        </h2>

        {!status.configured && (
          <p className="muted">
            Спочатку вставте <code>client_id</code> та <code>client_secret</code> у <a href="/settings" style={{ color: "var(--accent)" }}>Налаштуваннях</a>.{" "}
            Створіть особистий API додаток на <code>strava.com/settings/api</code> і у полі "Authorization Callback Domain" вкажіть <code>localhost</code>.
          </p>
        )}

        {status.configured && (
          <p className="muted">
            URL зворотного виклику (вже зареєстровано, якщо ви правильно вказали домен): <code>{status.callbackUrl}</code>
          </p>
        )}

        {status.athlete && (
          <p>
            Під'єднано як <strong>{[status.athlete.firstname, status.athlete.lastname].filter(Boolean).join(" ") || `атлет ${status.athlete.id}`}</strong>.
          </p>
        )}

        <p className="muted">
          Збережено активностей: <strong>{status.activities.n}</strong>
          {status.activities.n > 0 && (
            <>
              {" "}— з {status.activities.oldest} по {status.activities.newest}
            </>
          )}
        </p>

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          {!status.connected && (
            <button onClick={connect} disabled={busy || !status.configured}>
              {busy ? "…" : "Під'єднати Strava"}
            </button>
          )}
          {status.connected && (
            <>
              <button onClick={sync} disabled={busy}>
                {busy ? "Синхронізація…" : "Синхронізувати"}
              </button>
              <button className="secondary" onClick={disconnect} disabled={busy}>
                Від'єднати
              </button>
            </>
          )}
        </div>

        {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Інші джерела (скоро)</h2>
        <p className="muted">Garmin, Whoop, Apple Health, журнали харчування. Місце в схемі вже готове.</p>
      </div>
    </div>
  );
}
