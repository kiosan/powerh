import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { writeFile, chmod } from "node:fs/promises";
import { join, basename } from "node:path";
import { env } from "../config/env.js";
import { createDocument, applyExtraction, listDocuments, getDocumentWithResults, updateLabResult, deleteDocument, markerSummaries } from "../db/medical.js";
import { extractLabResults } from "../sources/medical/extract.js";
import { runtime } from "../config/runtime.js";

export async function medicalRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  });

  app.get("/api/medical/documents", async () => ({ documents: listDocuments() }));

  app.get("/api/medical/markers", async () => ({ markers: markerSummaries() }));

  app.get<{ Params: { id: string } }>("/api/medical/documents/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { error: "invalid id" };
    }
    const { document, results } = getDocumentWithResults(id);
    if (!document) {
      reply.code(404);
      return { error: "not found" };
    }
    return { document, results };
  });

  app.post("/api/medical/upload", async (req, reply) => {
    if (!runtime.isAnthropicConfigured()) {
      reply.code(400);
      return { error: "Anthropic API key not configured. Set it in Settings." };
    }
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "no file uploaded" };
    }
    // basename strips any path components, then sanitize the remainder to
    // alphanumerics + dot/dash/underscore — keeps the filename readable
    // for the UI while neutralizing newlines, shell metacharacters, etc.
    const rawName = basename(file.filename || "upload.pdf");
    const cleanName = rawName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "upload.pdf";
    if (!/\.pdf$/i.test(cleanName)) {
      reply.code(400);
      return { error: "only PDF files supported in v1" };
    }
    const buf = await file.toBuffer();
    // Magic-byte check: real PDFs start with "%PDF-". This catches a file
    // that's just a renamed .docx, an HTML page, or random garbage —
    // none of which Claude can do anything useful with, and which would
    // otherwise burn API tokens before failing.
    if (buf.length < 5 || buf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      reply.code(400);
      return { error: "Файл не схожий на PDF (відсутній підпис %PDF-)." };
    }
    const storedName = `${Date.now()}-${randomUUID()}-${cleanName}`;
    const fullPath = join(env.uploadsDir, storedName);
    await writeFile(fullPath, buf, { mode: 0o600 });
    try {
      await chmod(fullPath, 0o600);
    } catch {
      // Best effort on platforms where chmod is a no-op.
    }

    const doc = createDocument(cleanName, fullPath);

    try {
      const extracted = await extractLabResults(fullPath, cleanName);
      const { inserted } = applyExtraction(doc.id, extracted);
      const full = getDocumentWithResults(doc.id);
      return { documentId: doc.id, inserted, document: full.document, results: full.results };
    } catch (e) {
      reply.code(500);
      return {
        documentId: doc.id,
        error: `Extraction failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/medical/results/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { error: "invalid id" };
    }
    const updated = updateLabResult(id, req.body);
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return { result: updated };
  });

  app.delete<{ Params: { id: string } }>("/api/medical/documents/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { error: "invalid id" };
    }
    deleteDocument(id);
    return { ok: true };
  });
}
