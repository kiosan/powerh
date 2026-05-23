import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface PromptListItem {
  id: string;
  title: string;
  description: string;
  filename: string;
  variables: Array<{ name: string; description: string }>;
  notes: string;
  modified_at: string | null;
  is_default: boolean;
}

interface PromptFull extends PromptListItem {
  body: string;
  default_body: string;
}

const TUTORIAL = `## Як працюють промпти

**Промпт** — це інструкція, яку Claude (модель, що стоїть за асистентом) отримує перед кожною дією. Усе, що робить асистент — як говорить, які інструменти викликає, як інтерпретує дані, — визначається саме промптом. Це не "налаштування" в звичайному сенсі, а буквально текст, який задає поведінку моделі.

### Три промпти powerh

1. **Системна інструкція чату** — найголовніший. Її Claude отримує перед кожним твоїм повідомленням. Тут визначається роль, мова, межі, правила використання інструментів.
2. **Тижневий огляд** — інструкція для cron-задачі, що генерує щотижневий підсумок.
3. **Видобування аналізів з PDF** — інструкція, як парсити медичні PDF.

### Змінні (плейсхолдери)

У промпті чату є **змінні** — фрагменти типу \`{{today}}\` або \`{{data_summary}}\`, які підставляються динамічно перед відправкою. Це дозволяє Claude бачити актуальний контекст (сьогоднішню дату, профіль користувача, нотатки з попередніх розмов) без перезапису самого промпту.

**Важливо:** залиш плейсхолдери як є. Якщо видалиш \`{{data_summary}}\` — асистент перестане знати, скільки в тебе тренувань і аналізів збережено.

### Як експериментувати безпечно

- **Зберігай зміни поступово.** Зробив одну зміну → перевірив у чаті → побачив що покращилось/погіршилось → наступна зміна.
- **Бекап** дефолту вже зашитий у код. Кнопка **"Скинути до дефолту"** завжди поверне його.
- **Перевіряй прев'ю.** Кнопка "Показати з підставленими змінними" дасть точне фінальне формулювання — саме це бачить Claude.
- **Файли промптів — звичайні \`.md\` у теці \`~/.powerh/prompts/\`.** Можеш редагувати їх будь-яким редактором — застосунок підхопить зміни при наступному запиті.

### Ідеї для тюнінгу

- **Жорсткіший тон тренера** в чаті: додай "Будь прямим і вимогливим. Не вибачайся за критику."
- **Інша мова відповідей**: заміни блок ЯЗИК — твій асистент розмовлятиме хоч польською, хоч англійською.
- **Інша фокус-зона**: якщо ти не бігун, а наприклад скеле-лаз — додай контекст ("Користувач — скелелаз, орієнтуйся на тренування сили, гнучкості, техніки. Бігові показники — другорядні.")
- **Інша глибина відповідей**: за замовчуванням 2–6 речень. Хочеш довші розгорнуті розбори? Заміни на "Розгорнуті відповіді з прикладами, по 1–2 параграфи на пункт."
- **Нові правила**: "У понеділок завжди питай, як був вікенд", "Перед пропозицією плану — спитай про настрій і втому за тиждень".

### Що не варто чіпати

- **Назви інструментів** (\`get_activities\`, \`get_lab_results\` тощо) — це справжні функції в коді. Якщо переплутати назву, Claude не зможе викликати інструмент.
- **Плейсхолдери** \`{{...}}\` — без них Claude втратить контекст.
- **Системну інструкцію видобування аналізів** глобально — JSON-схема результату зашита в код; зміни в інструкції без зміни схеми можуть дати плутанину.

### Підказка

Чим менше "ВАЖЛИВО:" і "ОБОВ'ЯЗКОВО:" у промпті — тим краще. Модель Opus 4.7 виконує інструкції буквально; надмірно категоричні формулювання можуть призвести до переборщення (наприклад, кожна відповідь буде з нумерованим списком). Краще писати в нейтральному тоні: "Зазвичай відповідай списком, коли порівнюєш варіанти", а не "ЗАВЖДИ використовуй списки!".
`;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Prompts() {
  const [list, setList] = useState<PromptListItem[] | null>(null);
  const [selected, setSelected] = useState<PromptFull | null>(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadList = async () => {
    const r = await api<{ prompts: PromptListItem[] }>("/prompts");
    setList(r.prompts);
  };

  useEffect(() => {
    loadList().catch((e) => setMsg(String(e)));
  }, []);

  const select = async (id: string) => {
    setPreview(null);
    setMsg(null);
    try {
      const r = await api<PromptFull>(`/prompts/${id}`);
      setSelected(r);
      setDraft(r.body);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<{ body: string; modified_at: string; is_default: boolean }>(`/prompts/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({ body: draft }),
      });
      setSelected({ ...selected, body: r.body, modified_at: r.modified_at, is_default: r.is_default });
      setMsg("Збережено.");
      await loadList();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!selected) return;
    if (!confirm("Скинути цей промпт до значення за замовчуванням? Твої зміни буде втрачено.")) return;
    setSaving(true);
    try {
      const r = await api<{ body: string; is_default: boolean }>(`/prompts/${selected.id}/reset`, {
        method: "POST",
        body: "{}",
      });
      setSelected({ ...selected, body: r.body, is_default: true });
      setDraft(r.body);
      setMsg("Скинуто до дефолту.");
      await loadList();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async () => {
    if (!selected) return;
    setMsg(null);
    try {
      const r = await api<{ rendered: string }>(`/prompts/${selected.id}/preview`, {
        method: "POST",
        body: JSON.stringify({ body: draft }),
      });
      setPreview(r.rendered);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  if (!list) return <div>Завантаження…</div>;

  const hasUnsavedChanges = selected != null && draft !== selected.body;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Промпти</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Що це і як це працює?</h2>
          <button className="secondary" onClick={() => setShowTutorial((s) => !s)}>
            {showTutorial ? "Сховати інструкцію" : "Показати інструкцію"}
          </button>
        </div>
        {showTutorial && (
          <div className="markdown" style={{ marginTop: 12, lineHeight: 1.55 }}>
            {TUTORIAL.split("\n").map((line, i) => {
              if (line.startsWith("## ")) return <h2 key={i} style={{ marginTop: 18 }}>{line.slice(3)}</h2>;
              if (line.startsWith("### ")) return <h3 key={i}>{line.slice(4)}</h3>;
              if (line.startsWith("- ")) return <li key={i} style={{ marginLeft: 20 }}>{renderInline(line.slice(2))}</li>;
              if (line.trim() === "") return <br key={i} />;
              return <p key={i} style={{ margin: "6px 0" }}>{renderInline(line)}</p>;
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Промпти powerh</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Файли лежать у <code>~/.powerh/prompts/</code>. Зміни тут і там синхронні.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
          {list.map((p) => (
            <div
              key={p.id}
              onClick={() => select(p.id)}
              style={{
                border: "1px solid var(--border)",
                background: selected?.id === p.id ? "rgba(249,115,22,0.08)" : "var(--bg)",
                borderColor: selected?.id === p.id ? "var(--accent)" : "var(--border)",
                borderRadius: 8,
                padding: 12,
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{p.description}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={`badge ${p.is_default ? "ok" : "warn"}`} style={{ fontSize: 10 }}>
                  {p.is_default ? "за замовч." : "відредаговано"}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>{fmtDate(p.modified_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>
              {selected.title}
              {hasUnsavedChanges && <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>(незбережені зміни)</span>}
            </h2>
            <code className="muted" style={{ fontSize: 12 }}>{selected.filename}</code>
          </div>

          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{selected.description}</p>

          {selected.variables.length > 0 && (
            <div style={{ marginTop: 8, background: "var(--bg)", padding: 10, borderRadius: 6, fontSize: 13 }}>
              <strong>Доступні змінні:</strong>
              <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 20 }}>
                {selected.variables.map((v) => (
                  <li key={v.name}>
                    <code>{v.name}</code> — {v.description}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selected.notes && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8, fontStyle: "italic" }}>💡 {selected.notes}</p>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={28}
            style={{
              marginTop: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              lineHeight: 1.5,
            }}
            spellCheck={false}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Символів: {draft.length.toLocaleString()} / 50,000
          </div>

          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={save} disabled={saving || !hasUnsavedChanges}>
              {saving ? "Збереження…" : "Зберегти"}
            </button>
            <button className="secondary" onClick={() => setDraft(selected.body)} disabled={!hasUnsavedChanges}>
              Відкинути зміни
            </button>
            <button className="secondary" onClick={showPreview} disabled={!selected.variables.length}>
              {selected.variables.length ? "Показати з підставленими змінними" : "Прев'ю недоступне (нема змінних)"}
            </button>
            <button className="secondary" onClick={reset} disabled={selected.is_default && !hasUnsavedChanges} style={{ marginLeft: "auto" }}>
              Скинути до дефолту
            </button>
          </div>

          {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}

          {preview !== null && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 4 }}>Прев'ю — що бачить Claude</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Це фінальний текст з підставленими поточними значеннями змінних.
              </p>
              <pre style={{
                whiteSpace: "pre-wrap",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                maxHeight: 400,
                overflow: "auto",
              }}>
                {preview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Minimal inline markdown — bold, code, links — for the tutorial section
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4, fontSize: "0.92em" }}>
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    // consume one char of plain text
    const nextSpecial = remaining.search(/(\*\*|`)/);
    if (nextSpecial === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    parts.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
    remaining = remaining.slice(nextSpecial);
  }
  return parts;
}
