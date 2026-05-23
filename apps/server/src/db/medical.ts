import { db } from "./index.js";
import type { ExtractedLabReport } from "../sources/medical/extract.js";

export interface MedicalDocumentRow {
  id: number;
  filename: string;
  file_path: string;
  doc_type: string | null;
  source_lab: string | null;
  taken_at: string | null;
  raw_text: string | null;
  notes: string | null;
  uploaded_at: string;
}

export interface LabResultRow {
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

export function createDocument(filename: string, filePath: string): MedicalDocumentRow {
  const info = db
    .prepare("INSERT INTO medical_documents (filename, file_path) VALUES (?, ?)")
    .run(filename, filePath);
  return db.prepare("SELECT * FROM medical_documents WHERE id = ?").get(info.lastInsertRowid) as MedicalDocumentRow;
}

export function applyExtraction(documentId: number, extracted: ExtractedLabReport): { inserted: number } {
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE medical_documents
       SET doc_type = ?, source_lab = ?, taken_at = ?, notes = ?
       WHERE id = ?`,
    ).run(extracted.doc_type, extracted.source_lab, extracted.taken_at, extracted.notes, documentId);

    const insert = db.prepare(
      `INSERT INTO lab_results (document_id, marker, marker_canonical, value, value_text, unit, ref_low, ref_high, flag, taken_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let n = 0;
    for (const r of extracted.results) {
      insert.run(
        documentId,
        r.marker,
        r.marker_canonical ?? null,
        r.value,
        r.value_text,
        r.unit,
        r.ref_low,
        r.ref_high,
        r.flag,
        extracted.taken_at,
        r.notes,
      );
      n++;
    }
    return n;
  });
  return { inserted: tx() };
}

export function listDocuments(): MedicalDocumentRow[] {
  return db.prepare("SELECT * FROM medical_documents ORDER BY uploaded_at DESC").all() as MedicalDocumentRow[];
}

export function getDocumentWithResults(documentId: number): {
  document: MedicalDocumentRow | null;
  results: LabResultRow[];
} {
  const document =
    (db.prepare("SELECT * FROM medical_documents WHERE id = ?").get(documentId) as MedicalDocumentRow | undefined) ??
    null;
  const results = db
    .prepare("SELECT * FROM lab_results WHERE document_id = ? ORDER BY id")
    .all(documentId) as LabResultRow[];
  return { document, results };
}

export interface LabQuery {
  marker?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function queryLabResults(q: LabQuery): LabResultRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.marker) {
    where.push("(LOWER(marker_canonical) = ? OR LOWER(marker) LIKE ?)");
    params.push(q.marker.toLowerCase(), `%${q.marker.toLowerCase()}%`);
  }
  if (q.from) {
    where.push("taken_at >= ?");
    params.push(q.from);
  }
  if (q.to) {
    where.push("taken_at <= ?");
    params.push(q.to);
  }
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 1000);
  const sql = `
    SELECT * FROM lab_results
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY taken_at DESC NULLS LAST, marker_canonical, id
    LIMIT ${limit}
  `;
  return db.prepare(sql).all(...params) as LabResultRow[];
}

export function updateLabResult(id: number, patch: Partial<LabResultRow>): LabResultRow | null {
  const allowed = ["marker", "marker_canonical", "value", "value_text", "unit", "ref_low", "ref_high", "flag", "taken_at", "notes"] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k} = ?`);
      params.push((patch as Record<string, unknown>)[k]);
    }
  }
  if (sets.length === 0) return (db.prepare("SELECT * FROM lab_results WHERE id = ?").get(id) as LabResultRow | undefined) ?? null;
  params.push(id);
  db.prepare(`UPDATE lab_results SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return (db.prepare("SELECT * FROM lab_results WHERE id = ?").get(id) as LabResultRow | undefined) ?? null;
}

export function deleteDocument(id: number): void {
  // Cascade in schema removes lab_results too.
  db.prepare("DELETE FROM medical_documents WHERE id = ?").run(id);
}

export interface MarkerSummary {
  marker_canonical: string;
  marker: string; // most recent printed name for this canonical key
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

/**
 * Aggregate lab results by marker_canonical to expose historical trends:
 * one row per distinct marker, with the full history (newest first) inline.
 * Markers with NULL marker_canonical are bucketed by their printed name.
 */
export function markerSummaries(): MarkerSummary[] {
  const rows = db
    .prepare(
      `SELECT id, document_id, marker, marker_canonical, value, value_text, unit, ref_low, ref_high, flag, taken_at
       FROM lab_results
       ORDER BY taken_at DESC NULLS LAST, id DESC`,
    )
    .all() as Array<{
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
  }>;

  const buckets = new Map<string, MarkerSummary>();
  for (const r of rows) {
    const key = r.marker_canonical ?? `_unnorm_${r.marker.toLowerCase()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        marker_canonical: r.marker_canonical ?? r.marker,
        marker: r.marker,
        unit: r.unit,
        ref_low: r.ref_low,
        ref_high: r.ref_high,
        measurements: 0,
        latest_value: r.value,
        latest_value_text: r.value_text,
        latest_flag: r.flag,
        latest_taken_at: r.taken_at,
        earliest_taken_at: r.taken_at,
        history: [],
      };
      buckets.set(key, bucket);
    }
    bucket.measurements += 1;
    // earliest_taken_at = min, latest already set from first row (sorted DESC)
    if (r.taken_at && (!bucket.earliest_taken_at || r.taken_at < bucket.earliest_taken_at)) {
      bucket.earliest_taken_at = r.taken_at;
    }
    bucket.history.push({
      document_id: r.document_id,
      taken_at: r.taken_at,
      value: r.value,
      value_text: r.value_text,
      flag: r.flag,
    });
  }

  return [...buckets.values()].sort((a, b) => {
    // Markers with more measurements first (trends are more interesting),
    // then by latest_taken_at desc.
    if (b.measurements !== a.measurements) return b.measurements - a.measurements;
    return (b.latest_taken_at ?? "").localeCompare(a.latest_taken_at ?? "");
  });
}
