"use client";

import { offlineDraftSchema, type OfflineDraft } from "@/lib/validation/phase10";

const DATABASE_NAME = "zombeans-offline";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";

export type DraftEvent =
  | { type: "queue" }
  | { type: "sync_start" }
  | { type: "review"; reference: string; message: string }
  | { type: "sync_success"; reference: string }
  | { type: "sync_error"; message: string }
  | { type: "edit" };

export function applyDraftEvent(draft: OfflineDraft, event: DraftEvent): OfflineDraft {
  const now = new Date().toISOString();
  switch (event.type) {
    case "queue":
      return { ...draft, state: "queued", lastError: null, updatedAt: now };
    case "sync_start":
      return { ...draft, state: "syncing", lastError: null, updatedAt: now };
    case "review":
      return {
        ...draft,
        state: "review_required",
        serverReference: event.reference,
        lastError: event.message,
        updatedAt: now,
      };
    case "sync_success":
      return {
        ...draft,
        state: "synced",
        serverReference: event.reference,
        lastError: null,
        updatedAt: now,
      };
    case "sync_error":
      return { ...draft, state: "error", lastError: event.message, updatedAt: now };
    case "edit":
      return { ...draft, state: "draft", lastError: null, updatedAt: now };
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline draft storage is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("state", "state");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline draft database failed."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Offline draft operation failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Offline draft transaction aborted."));
    });
  } finally {
    database.close();
  }
}

export async function listDrafts(): Promise<OfflineDraft[]> {
  const records = await withStore<unknown[]>("readonly", (store) => store.getAll());
  return records
    .map((record) => offlineDraftSchema.safeParse(record))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveDraft(draft: OfflineDraft): Promise<OfflineDraft> {
  const parsed = offlineDraftSchema.parse(draft);
  await withStore<IDBValidKey>("readwrite", (store) => store.put(parsed));
  return parsed;
}

export async function removeDraft(id: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(id));
}

export async function transitionDraft(id: string, event: DraftEvent): Promise<OfflineDraft> {
  const current = await withStore<unknown>("readonly", (store) => store.get(id));
  const parsed = offlineDraftSchema.parse(current);
  const next = applyDraftEvent(parsed, event);
  await saveDraft(next);
  return next;
}

export function createDraftIdentity(
  snapshot: { id: string; capturedAt: string },
  draftId = crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  return {
    id: draftId,
    idempotencyKey: crypto.randomUUID(),
    snapshotId: snapshot.id,
    snapshotAt: snapshot.capturedAt,
    clientCreatedAt: now,
    createdAt: now,
    updatedAt: now,
    state: "draft" as const,
    serverReference: null,
    lastError: null,
  };
}
