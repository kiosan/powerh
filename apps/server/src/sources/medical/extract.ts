import { readFileSync } from "node:fs";
import { getAnthropic } from "../../agent/client.js";
import { runtime } from "../../config/runtime.js";
import { readPrompt } from "../../agent/prompts.js";

export interface ExtractedLabResult {
  marker: string;
  marker_canonical: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  flag: "low" | "normal" | "high" | null;
  notes: string | null;
}

export interface ExtractedLabReport {
  doc_type: "lab" | "other";
  source_lab: string | null;
  taken_at: string | null; // ISO date
  patient_age: number | null;
  patient_sex: string | null;
  notes: string | null;
  results: ExtractedLabResult[];
}

// Nullable helpers — strict JSON Schema doesn't like `enum: [..., null]`
// next to `type: ["string", "null"]`, so we express nullable union types
// with `anyOf`.
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const nullableInteger = { anyOf: [{ type: "integer" }, { type: "null" }] };

const SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["lab", "other"], description: "Document type. 'lab' for blood/urine/etc. test results." },
    source_lab: { ...nullableString, description: "Lab name or provider (e.g. 'Quest Diagnostics', 'Synlab')." },
    taken_at: { ...nullableString, description: "Date the sample was taken or test performed, ISO 8601 (YYYY-MM-DD)." },
    patient_age: { ...nullableInteger },
    patient_sex: { ...nullableString },
    notes: { ...nullableString, description: "Brief overall notes from the document, if any." },
    results: {
      type: "array",
      description: "One entry per measured marker. Include EVERY result row present in the document.",
      items: {
        type: "object",
        properties: {
          marker: { type: "string", description: "Marker name as printed in the document (e.g. 'LDL Cholesterol', 'HbA1c')." },
          marker_canonical: {
            type: "string",
            description:
              "Normalized lowercase marker key for cross-document comparison. Use widely accepted short names: 'ldl', 'hdl', 'total_cholesterol', 'triglycerides', 'hba1c', 'glucose', 'tsh', 'ft4', 'ft3', 'crp', 'ferritin', 'iron', 'transferrin', 'b12', 'vitamin_d_25oh', 'creatinine', 'urea', 'egfr', 'alt', 'ast', 'ggt', 'bilirubin_total', 'hemoglobin', 'hematocrit', 'wbc', 'rbc', 'platelets', 'mcv', 'mch', 'mchc', 'sodium', 'potassium', 'magnesium', 'calcium', 'testosterone_total', 'testosterone_free', 'shbg', 'cortisol'. If unsure, snake_case the printed name.",
          },
          value: { ...nullableNumber, description: "Numeric value if applicable. Use null for non-numeric (e.g. 'Negative', 'Detected')." },
          value_text: { ...nullableString, description: "Use only for non-numeric values; otherwise null." },
          unit: { ...nullableString, description: "Units as printed (e.g. 'mg/dL', 'mmol/L', '%', 'ng/mL')." },
          ref_low: { ...nullableNumber, description: "Lower bound of the reference range, when given." },
          ref_high: { ...nullableNumber, description: "Upper bound of the reference range, when given." },
          flag: {
            anyOf: [{ type: "string", enum: ["low", "normal", "high"] }, { type: "null" }],
            description: "Computed against the reference range when given. Null if no range or no clear flag.",
          },
          notes: { ...nullableString },
        },
        required: ["marker", "marker_canonical", "value", "value_text", "unit", "ref_low", "ref_high", "flag", "notes"],
        additionalProperties: false,
      },
    },
  },
  required: ["doc_type", "source_lab", "taken_at", "patient_age", "patient_sex", "notes", "results"],
  additionalProperties: false,
} as const;

// System prompt is loaded from disk at call time so the user can tune it
// via the Налаштування → Промпти page without restarting the server.
function getSystemPrompt(): string {
  return readPrompt("lab-extraction").body;
}

export async function extractLabResults(filePath: string, filename: string): Promise<ExtractedLabReport> {
  const client = getAnthropic();
  const buf = readFileSync(filePath);
  const dataB64 = buf.toString("base64");

  // Use streaming because 16K+ max_tokens risks SDK HTTP timeouts on non-streaming.
  // A long bloodwork panel + JSON envelope can run 10K+ tokens.
  const stream = client.messages.stream({
    model: runtime.anthropicModel(),
    max_tokens: 16000,
    system: getSystemPrompt(),
    output_config: {
      format: {
        type: "json_schema",
        schema: SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: dataB64 },
            title: filename,
          },
          {
            type: "text",
            text:
              "Extract all lab results from this document into the structured schema. " +
              "The document may be in Ukrainian, Russian, English, or another language — handle any language. " +
              "Include EVERY measured marker, with the printed marker name (in the original language) and the canonical English key per the system rules.",
          },
        ],
      },
    ],
  });

  // Drain the stream so the call doesn't time out on large outputs.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _event of stream) { /* no-op */ }
  const finalMessage = await stream.finalMessage();

  const textBlock = finalMessage.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) {
    // Log the full response for debugging when the model returns no text block.
    console.error("[lab-extract] no text in response. stop_reason:", finalMessage.stop_reason, "content_types:", finalMessage.content.map((b) => b.type));
    throw new Error(`Claude returned no text content (stop_reason: ${finalMessage.stop_reason})`);
  }

  if (finalMessage.stop_reason === "max_tokens") {
    console.warn("[lab-extract] hit max_tokens — output may be truncated");
  }

  console.log(
    "[lab-extract] response received — stop_reason:",
    finalMessage.stop_reason,
    "text_length:",
    textBlock.text.length,
    "usage:",
    finalMessage.usage,
  );

  let parsed: ExtractedLabReport;
  try {
    parsed = JSON.parse(textBlock.text) as ExtractedLabReport;
  } catch (e) {
    console.error("[lab-extract] JSON parse failed. raw response:", textBlock.text.slice(0, 2000));
    throw new Error(`Failed to parse extraction JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(
    "[lab-extract] parsed:",
    "doc_type=", parsed.doc_type,
    "source_lab=", parsed.source_lab,
    "taken_at=", parsed.taken_at,
    "results_count=", parsed.results?.length ?? 0,
  );

  return parsed;
}

// type-only import to keep the file shape clean
import type Anthropic from "@anthropic-ai/sdk";
