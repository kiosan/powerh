import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

interface DocumentRow {
  id: number;
  filename: string;
  doc_type: string | null;
  source_lab: string | null;
  taken_at: string | null;
  uploaded_at: string;
  notes: string | null;
}

interface LabResultRow {
  id: number;
  document_id: number;
  marker: string;
  marker_canonical: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  flag: string | null;
  taken_at: string | null;
  notes: string | null;
}

interface DocumentWithResults {
  document: DocumentRow;
  results: LabResultRow[];
}

interface MarkerSummary {
  marker_canonical: string;
  marker: string;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  measurements: number;
  latest_value: number | null;
  latest_value_text: string | null;
  latest_flag: string | null;
  latest_taken_at: string | null;
  earliest_taken_at: string | null;
  history: Array<{
    document_id: number;
    taken_at: string | null;
    value: number | null;
    value_text: string | null;
    flag: string | null;
  }>;
}

const FLAG_LABELS: Record<string, string> = {
  low: "низький",
  normal: "норма",
  high: "високий",
};

function flagColor(flag: string | null): string {
  if (flag === "low") return "#60a5fa";
  if (flag === "high") return "#f97316";
  if (flag === "normal") return "#3fb950";
  return "var(--muted)";
}

// Tiny SVG sparkline for one marker's history.
interface SparkPoint {
  taken_at: string | null;
  value: number | null;
  flag?: string | null;
}

function Sparkline({ points, refLow, refHigh, width = 160, height = 36 }: {
  points: SparkPoint[];
  refLow: number | null;
  refHigh: number | null;
  width?: number;
  height?: number;
}) {
  const valid = points.filter((p): p is { taken_at: string; value: number; flag?: string | null } =>
    p.taken_at != null && p.value != null,
  );
  if (valid.length < 2) {
    return <div className="muted" style={{ fontSize: 11 }}>замало точок</div>;
  }
  // oldest → newest
  const sorted = [...valid].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const vals = sorted.map((p) => p.value);
  const min = Math.min(...vals, refLow ?? Infinity);
  const max = Math.max(...vals, refHigh ?? -Infinity);
  const span = max - min || 1;
  const pad = 4;
  const W = width - pad * 2;
  const H = height - pad * 2;
  const x = (i: number) => pad + (i / (sorted.length - 1)) * W;
  const y = (v: number) => pad + H - ((v - min) / span) * H;
  const path = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {refLow != null && refHigh != null && (
        <rect
          x={pad}
          y={y(refHigh)}
          width={W}
          height={Math.max(1, y(refLow) - y(refHigh))}
          fill="rgba(63,185,80,0.10)"
        />
      )}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {sorted.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={2} fill={flagColor(p.flag ?? null)} />
      ))}
    </svg>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  // taken_at is YYYY-MM-DD; uploaded_at is "YYYY-MM-DD HH:MM:SS"
  const d = new Date((iso.length === 10 ? iso + "T00:00:00Z" : iso.replace(" ", "T") + "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("uk-UA", { year: "numeric", month: "short", day: "numeric" });
}

function trendArrow(history: MarkerSummary["history"]): string {
  const nums = history.filter((h) => h.value != null) as Array<{ value: number }>;
  if (nums.length < 2) return "";
  // history is newest first
  const latest = nums[0].value;
  const earlier = nums[nums.length - 1].value;
  const delta = latest - earlier;
  const pct = earlier !== 0 ? Math.abs(delta / earlier) : 0;
  if (pct < 0.05) return "→";
  return delta > 0 ? "↑" : "↓";
}

export function Medical() {
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [markers, setMarkers] = useState<MarkerSummary[] | null>(null);
  const [selected, setSelected] = useState<DocumentWithResults | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFilename, setUploadFilename] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Tick a timer while uploading so user sees progress is alive
  useEffect(() => {
    if (!uploading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(interval);
  }, [uploading]);

  // Warn the user if they try to close the tab during upload
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  const loadAll = async () => {
    const [docs, mks] = await Promise.all([
      api<{ documents: DocumentRow[] }>("/medical/documents"),
      api<{ markers: MarkerSummary[] }>("/medical/markers"),
    ]);
    setDocuments(docs.documents);
    setMarkers(mks.markers);
  };

  useEffect(() => {
    loadAll().catch((e) => setMsg(String(e)));
  }, []);

  const loadDoc = async (id: number) => {
    const r = await api<DocumentWithResults>(`/medical/documents/${id}`);
    setSelected(r);
  };

  const upload = async (file: File) => {
    setUploading(true);
    setUploadFilename(file.name);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/medical/upload", { method: "POST", body: form });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status}: ${t}`);
      }
      const data = (await res.json()) as { documentId?: number; inserted?: number; error?: string };
      if (data.error) {
        setMsg(`Помилка: ${data.error}`);
      } else {
        setMsg(`Готово. Видобуто маркерів: ${data.inserted ?? 0}.`);
        await loadAll();
        if (data.documentId) await loadDoc(data.documentId);
      }
    } catch (e) {
      setMsg(`Помилка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      setUploadFilename(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeDoc = async (id: number) => {
    if (!confirm("Видалити цей документ та всі видобуті результати?")) return;
    await api(`/medical/documents/${id}`, { method: "DELETE" });
    if (selected?.document.id === id) setSelected(null);
    await loadAll();
  };

  const saveResult = async (id: number, patch: Partial<LabResultRow>) => {
    const r = await api<{ result: LabResultRow }>(`/medical/results/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!selected) return;
    setSelected({
      ...selected,
      results: selected.results.map((x) => (x.id === id ? r.result : x)),
    });
    // refresh trends since values may have changed
    await loadAll();
  };

  if (!documents || !markers) return <div>Завантаження…</div>;

  const filteredMarkers = filter.trim()
    ? markers.filter(
        (m) =>
          m.marker.toLowerCase().includes(filter.toLowerCase()) ||
          m.marker_canonical.toLowerCase().includes(filter.toLowerCase()),
      )
    : markers;

  const trended = markers.filter((m) => m.measurements >= 2).length;

  return (
    <div>
      <h1>Медичні дані</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Завантажити PDF аналізів</h2>
        <p className="muted">
          Завантажуй стільки PDF, скільки маєш — старі й нові. powerh співставить однакові маркери (LDL, гемоглобін, феритин тощо) між документами й покаже, як значення змінювалися з часом. Що більше історії — то корисніший асистент.
        </p>

        {!uploading && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
                style={{ width: "auto" }}
              />
            </div>
            {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
          </>
        )}

        {uploading && (
          <div
            style={{
              background: "rgba(249,115,22,0.08)",
              border: "1px solid rgba(249,115,22,0.3)",
              borderRadius: 8,
              padding: 16,
              marginTop: 8,
            }}
          >
            <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  border: "2px solid var(--accent)",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Обробляю {uploadFilename}…</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Минуло {elapsed} с — зазвичай це займає 20–60 секунд для типового аналізу.
                </div>
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div>📄 Передаю PDF до Claude…</div>
              <div>🔍 Шукаю маркери, значення, одиниці, межі норми…</div>
              <div>💾 Зберігаю у твою локальну базу…</div>
            </div>
            <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
              <strong>Не закривай цю вкладку</strong>, поки обробка не завершиться — інакше доведеться завантажувати знову.
            </p>
          </div>
        )}
      </div>

      {markers.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>
              Маркери та тренди{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                ({markers.length} унікальних, {trended} з історією)
              </span>
            </h2>
            <input
              placeholder="Фільтр (LDL, HbA1c, ferritin…)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 220 }}
            />
          </div>

          {trended === 0 && (
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              Поки лише один документ. Завантаж ще один — і тут з'являться тренди.
            </p>
          )}

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>Маркер</th>
                <th style={{ padding: "6px 8px" }}>Останнє</th>
                <th style={{ padding: "6px 8px" }}>Норма</th>
                <th style={{ padding: "6px 8px" }}>Вимірів</th>
                <th style={{ padding: "6px 8px" }}>Тренд</th>
              </tr>
            </thead>
            <tbody>
              {filteredMarkers.map((m) => (
                <tr key={m.marker_canonical} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px" }}>
                    <div>{m.marker}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{m.marker_canonical}</div>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ color: flagColor(m.latest_flag), fontWeight: 600 }}>
                      {m.latest_value != null ? m.latest_value : (m.latest_value_text ?? "—")}
                    </span>{" "}
                    <span className="muted" style={{ fontSize: 12 }}>{m.unit ?? ""}</span>
                    <div className="muted" style={{ fontSize: 11 }}>{fmtDate(m.latest_taken_at)}</div>
                  </td>
                  <td style={{ padding: "8px" }}>
                    {m.ref_low != null || m.ref_high != null
                      ? `${m.ref_low ?? "?"} – ${m.ref_high ?? "?"}`
                      : "—"}
                  </td>
                  <td style={{ padding: "8px" }}>
                    {m.measurements}
                    {m.measurements >= 2 && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {fmtDate(m.earliest_taken_at)} → {fmtDate(m.latest_taken_at)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px", minWidth: 180 }}>
                    {m.measurements >= 2 ? (
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <Sparkline points={m.history} refLow={m.ref_low} refHigh={m.ref_high} />
                        <span style={{ fontSize: 18, color: "var(--muted)" }}>{trendArrow(m.history)}</span>
                      </div>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Документи ({documents.length})</h2>
        {documents.length === 0 && <p className="muted">Поки нічого. Завантажте PDF вище.</p>}
        {documents.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>Завантажено</th>
                <th style={{ padding: "6px 8px" }}>Файл</th>
                <th style={{ padding: "6px 8px" }}>Тип</th>
                <th style={{ padding: "6px 8px" }}>Лабораторія</th>
                <th style={{ padding: "6px 8px" }}>Дата аналізу</th>
                <th style={{ padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px" }}>{d.uploaded_at}</td>
                  <td style={{ padding: "8px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); loadDoc(d.id); }}
                      style={{ color: "var(--accent)" }}
                      title={d.filename}
                    >
                      {d.filename}
                    </a>
                  </td>
                  <td style={{ padding: "8px" }}>{d.doc_type ?? "—"}</td>
                  <td style={{ padding: "8px" }}>{d.source_lab ?? "—"}</td>
                  <td style={{ padding: "8px" }}>{fmtDate(d.taken_at)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>
                    <button className="secondary" onClick={() => removeDoc(d.id)}>Видалити</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            {selected.document.filename}
            <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
              (маркерів: {selected.results.length})
            </span>
          </h2>
          {selected.results.length === 0 && <p className="muted">Маркерів не видобуто.</p>}
          {selected.results.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "6px 8px" }}>Маркер</th>
                  <th style={{ padding: "6px 8px" }}>Значення</th>
                  <th style={{ padding: "6px 8px" }}>Одиниці</th>
                  <th style={{ padding: "6px 8px" }}>Норма</th>
                  <th style={{ padding: "6px 8px" }}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {selected.results.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px" }}>
                      <div>{r.marker}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{r.marker_canonical ?? ""}</div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span style={{ color: flagColor(r.flag), fontWeight: 500 }}>
                        {r.value != null ? r.value : (r.value_text ?? "—")}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>{r.unit ?? "—"}</td>
                    <td style={{ padding: "8px" }}>
                      {r.ref_low != null || r.ref_high != null
                        ? `${r.ref_low ?? "?"} – ${r.ref_high ?? "?"}`
                        : "—"}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <select
                        value={r.flag ?? ""}
                        onChange={(e) => saveResult(r.id, { flag: (e.target.value || null) as LabResultRow["flag"] })}
                        style={{ width: "auto" }}
                      >
                        <option value="">—</option>
                        <option value="low">{FLAG_LABELS.low}</option>
                        <option value="normal">{FLAG_LABELS.normal}</option>
                        <option value="high">{FLAG_LABELS.high}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
