import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
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
    const safeName = basename(file.filename || "upload.pdf");
    if (!/\.pdf$/i.test(safeName)) {
      reply.code(400);
      return { error: "only PDF files supported in v1" };
    }
    const storedName = `${Date.now()}-${randomUUID()}-${safeName}`;
    const fullPath = join(env.uploadsDir, storedName);
    const buf = await file.toBuffer();
    await writeFile(fullPath, buf);

    const doc = createDocument(safeName, fullPath);

    try {
      const extracted = await extractLabResults(fullPath, safeName);
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
