import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Supabase Storage helpers (M4). Replaces Totalum's declarative FILE fields.
 *
 * SECURITY: object paths always start with the caller's organization_id (and,
 * for partner files, their partner_id). The path is built SERVER-SIDE from the
 * authenticated context — never from client input — and RLS on storage.objects
 * (migration 0016) enforces the same prefix, so a tenant/partner can neither
 * read nor write another's files even if they craft a path.
 */

export const BUCKETS = {
  public: "public-assets",
  private: "private-docs",
} as const;
export type BucketKey = keyof typeof BUCKETS;

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf",
  "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Sanitises a filename to a safe, path-segment-free token. */
export function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

/** Org-wide object path: {org}/{entity}/{id}/{filename}. */
export function objectPath(orgId: string, entity: string, id: string, filename: string): string {
  return `${orgId}/${entity}/${id}/${safeName(filename)}`;
}

/** Partner-owned object path: {org}/partners/{partner}/{entity}/{filename}. */
export function partnerObjectPath(
  orgId: string, partnerId: string, entity: string, filename: string
): string {
  return `${orgId}/partners/${partnerId}/${entity}/${safeName(filename)}`;
}

export function assertUploadable(file: { size: number; type: string }): void {
  if (file.size > MAX_FILE_BYTES) {
    throw Object.assign(new Error(`El archivo supera el máximo de ${MAX_FILE_BYTES / 1024 / 1024} MB`), { status: 413 });
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw Object.assign(new Error(`Tipo de archivo no permitido: ${file.type}`), { status: 415 });
  }
}

/** Uploads a file under the given (server-built) path. Returns the stored path. */
export async function uploadObject(
  bucket: BucketKey,
  path: string,
  body: ArrayBuffer | Blob,
  contentType?: string
): Promise<string> {
  const sb = await supabaseServer();
  const { error } = await sb.storage.from(BUCKETS[bucket]).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Signed URL for a private object (short-lived). */
export async function signedUrl(bucket: BucketKey, path: string, expiresInSec = 300): Promise<string> {
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from(BUCKETS[bucket]).createSignedUrl(path, expiresInSec);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Public URL for a public-bucket object. */
export async function publicUrl(bucket: BucketKey, path: string): Promise<string> {
  const sb = await supabaseServer();
  return sb.storage.from(BUCKETS[bucket]).getPublicUrl(path).data.publicUrl;
}

export async function removeObject(bucket: BucketKey, path: string): Promise<void> {
  const sb = await supabaseServer();
  const { error } = await sb.storage.from(BUCKETS[bucket]).remove([path]);
  if (error) throw new Error(error.message);
}
