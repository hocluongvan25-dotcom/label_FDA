import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApiSnapshotResponse,
  KnowledgeSnapshot,
  ParsedRegulatoryChunk,
  ParsedSection,
  ParserValidation,
} from "@/lib/knowledge-types";
import { verifySnapshotRegression } from "./regression";
import { rpc, dbError } from "../context";
import {
  RegulatoryApiError,
  type ApiDocument,
  type RegulatoryHttpStore,
  type RegulatoryRequestEvent,
} from "./clients";
export class SupabaseRegulatoryRepository implements RegulatoryHttpStore {
  constructor(readonly db: SupabaseClient) {}
  async get(cacheKey: string): Promise<ApiDocument | null> {
    const { data, error } = await this.db
      .from("regulatory_api_responses")
      .select("*")
      .eq("cache_key", cacheKey)
      .eq("validated", true)
      .gt("expires_at", new Date().toISOString())
      .order("retrieved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw dbError(error);
    if (!data) return null;
    await rpc(this.db, "vexim_log_regulatory_response_access", {
      rid: data.id,
      purpose: "cache_read",
    });
    const { data: blob, error: downloadError } = await this.db.storage
      .from("regulatory-raw")
      .download(data.raw_storage_key);
    if (downloadError || !blob)
      throw new RegulatoryApiError(
        "CACHE_BODY_MISSING",
        "Cached raw response is missing.",
        false,
      );
    const body = new Uint8Array(await blob.arrayBuffer());
    if (body.length !== data.byte_size || body.length > 20 * 1024 * 1024)
      throw new RegulatoryApiError(
        "CACHE_SIZE_MISMATCH",
        "Cached raw response size mismatch.",
        false,
      );
    if (createHash("sha256").update(body).digest("hex") !== data.content_hash)
      throw new RegulatoryApiError(
        "CACHE_HASH_MISMATCH",
        "Cached raw response hash mismatch.",
        false,
      );
    return { meta: data as ApiSnapshotResponse, body, cache_hit: true };
  }
  async save(doc: ApiDocument) {
    const contentType = doc.meta.content_type
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const mime = !doc.meta.validated
      ? "application/octet-stream"
      : doc.meta.family === "fda_guidance"
        ? contentType === "text/html" ||
          contentType === "application/xhtml+xml" ||
          contentType === "application/pdf"
          ? contentType
          : "application/octet-stream"
        : doc.meta.family === "ecfr" && /xml/i.test(doc.meta.content_type)
          ? "application/xml"
          : "application/json";
    const result = await this.db.storage
      .from("regulatory-raw")
      .upload(doc.meta.raw_storage_key, doc.body, {
        upsert: false,
        contentType: mime,
      });
    if (result.error)
      throw new RegulatoryApiError(
        "RAW_STORE_FAILED",
        "Unable to persist immutable raw API bytes.",
        true,
      );
    const { error } = await this.db
      .from("regulatory_api_responses")
      .insert(doc.meta);
    if (error)
      throw new RegulatoryApiError(
        "RAW_METADATA_FAILED",
        "Unable to persist raw provenance; body remains private for reconciliation.",
        true,
      );
  }
  async recordAttempt(event: RegulatoryRequestEvent) {
    const { error } = await this.db
      .from("regulatory_request_events")
      .insert(event);
    if (error)
      throw new RegulatoryApiError(
        "MONITORING_STORE_FAILED",
        "Cannot persist regulatory request monitoring.",
        true,
      );
  }
  reserve(family: string) {
    return rpc<number>(this.db, "vexim_regulatory_rate_limit", {
      source_family: family,
    });
  }
  async active(key: string) {
    const { data, error } = await this.db
      .from("regulatory_snapshots")
      .select("*")
      .eq("source_key", key)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw dbError(error);
    return data as KnowledgeSnapshot | null;
  }
  async knownDocument(number: string) {
    const { data, error } = await this.db
      .from("regulatory_snapshots")
      .select("id")
      .eq("source_family", "federal_register")
      .eq("document_number", number)
      .limit(1)
      .maybeSingle();
    if (error) throw dbError(error);
    return !!data;
  }
  record(jid: string, worker: string, p: Record<string, unknown>) {
    return rpc<KnowledgeSnapshot>(this.db, "vexim_record_regulatory_snapshot", {
      jid,
      worker_id: worker,
      p,
    });
  }
  async stage(
    jid: string,
    worker: string,
    snapshotId: string,
    sections: ParsedSection[],
    chunks: ParsedRegulatoryChunk[],
    validation: ParserValidation,
  ) {
    await rpc(this.db, "vexim_stage_regulatory_chunks", {
      jid,
      worker_id: worker,
      snapshot_id: snapshotId,
      section_data: sections,
      chunk_data: chunks,
      validation,
    });
    const { data, error } = await this.db
      .from("regulatory_snapshots")
      .select("content_hash")
      .eq("id", snapshotId)
      .single();
    if (error) throw dbError(error);
    return verifySnapshotRegression(
      this.db,
      snapshotId,
      data.content_hash,
      null,
    );
  }
  async stageFdaGuidance(
    jid: string,
    worker: string,
    snapshotId: string,
    sections: ParsedSection[],
    chunks: ParsedRegulatoryChunk[],
    validation: ParserValidation,
  ) {
    return rpc(this.db, "vexim_stage_fda_guidance", {
      jid,
      worker_id: worker,
      snapshot_id: snapshotId,
      section_data: sections,
      chunk_data: chunks,
      validation,
    });
  }
  parseFailed(jid: string, worker: string, snapshotId: string, error: string) {
    return rpc(this.db, "vexim_mark_regulatory_parse_failed", {
      jid,
      worker_id: worker,
      snapshot_id: snapshotId,
      validation: { error_code: "PARSE_FAILED", message: error },
    });
  }
  federalDraft(jid: string, worker: string, snapshotId: string) {
    return rpc(this.db, "vexim_stage_federal_register", {
      jid,
      worker_id: worker,
      snapshot_id: snapshotId,
    });
  }
}
