import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local, unsubmitted measurement values for one data sheet, keyed by
 * dimension then sample index. Written on every keystroke so a dropped
 * connection (or a killed app) on the shop floor never loses a typed value —
 * entries are flushed to the API on submit/blur and marked `synced` once the
 * server has confirmed them.
 *
 * An in-memory Map is the source of truth for the process lifetime so overlapping
 * `saveDraftValue` / `markSynced` calls cannot clobber each other. Writes are
 * serialized through a per-sheet promise chain; AsyncStorage persistence is
 * debounced so rapid keystrokes don't thrash disk.
 */
export interface DraftEntry {
  value: number;
  updatedAt: number;
  synced: boolean;
}

export type DimensionDraft = Record<number, DraftEntry>;
export type SheetDraft = Record<string, DimensionDraft>;

const draftKey = (sheetId: string) => `ds_draft_${sheetId}`;

/** In-memory source of truth; AsyncStorage is a durable mirror. */
const memoryDrafts = new Map<string, SheetDraft>();

/** Per-sheet serial write queue so concurrent saves cannot drop entries. */
const writeChains = new Map<string, Promise<unknown>>();

/** Debounced persist handles keyed by sheet id. */
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PERSIST_DEBOUNCE_MS = 150;

function cloneDraft(draft: SheetDraft): SheetDraft {
  return JSON.parse(JSON.stringify(draft)) as SheetDraft;
}

function enqueueSheet<T>(sheetId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(sheetId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeChains.set(
    sheetId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function readFromStorage(sheetId: string): Promise<SheetDraft> {
  try {
    const raw = await AsyncStorage.getItem(draftKey(sheetId));
    return raw ? (JSON.parse(raw) as SheetDraft) : {};
  } catch {
    return {};
  }
}

async function flushPersist(sheetId: string): Promise<void> {
  const draft = memoryDrafts.get(sheetId);
  if (draft === undefined) return;
  await AsyncStorage.setItem(draftKey(sheetId), JSON.stringify(draft));
}

function schedulePersist(sheetId: string): void {
  const existing = persistTimers.get(sheetId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    sheetId,
    setTimeout(() => {
      persistTimers.delete(sheetId);
      void flushPersist(sheetId);
    }, PERSIST_DEBOUNCE_MS),
  );
}

async function ensureLoaded(sheetId: string): Promise<SheetDraft> {
  const cached = memoryDrafts.get(sheetId);
  if (cached) return cached;
  const fromDisk = await readFromStorage(sheetId);
  memoryDrafts.set(sheetId, fromDisk);
  return fromDisk;
}

export async function loadDraft(sheetId: string): Promise<SheetDraft> {
  return enqueueSheet(sheetId, async () => {
    const draft = await ensureLoaded(sheetId);
    return cloneDraft(draft);
  });
}

export async function saveDraftValue(
  sheetId: string,
  dimensionId: string,
  sampleIndex: number,
  value: number,
  synced = false,
): Promise<SheetDraft> {
  return enqueueSheet(sheetId, async () => {
    const draft = await ensureLoaded(sheetId);
    const dimensionDraft = { ...(draft[dimensionId] ?? {}) };
    dimensionDraft[sampleIndex] = { value, updatedAt: Date.now(), synced };
    const next: SheetDraft = { ...draft, [dimensionId]: dimensionDraft };
    memoryDrafts.set(sheetId, next);
    schedulePersist(sheetId);
    return cloneDraft(next);
  });
}

export async function markSynced(
  sheetId: string,
  dimensionId: string,
  sampleIndex: number,
): Promise<SheetDraft> {
  return enqueueSheet(sheetId, async () => {
    const draft = await ensureLoaded(sheetId);
    const entry = draft[dimensionId]?.[sampleIndex];
    if (!entry) return cloneDraft(draft);
    const dimensionDraft = { ...draft[dimensionId], [sampleIndex]: { ...entry, synced: true } };
    const next: SheetDraft = { ...draft, [dimensionId]: dimensionDraft };
    memoryDrafts.set(sheetId, next);
    schedulePersist(sheetId);
    return cloneDraft(next);
  });
}

export async function clearDraft(sheetId: string): Promise<void> {
  return enqueueSheet(sheetId, async () => {
    const timer = persistTimers.get(sheetId);
    if (timer) {
      clearTimeout(timer);
      persistTimers.delete(sheetId);
    }
    memoryDrafts.delete(sheetId);
    await AsyncStorage.removeItem(draftKey(sheetId));
  });
}

export function getDraftValue(
  draft: SheetDraft,
  dimensionId: string,
  sampleIndex: number,
): DraftEntry | undefined {
  return draft[dimensionId]?.[sampleIndex];
}

export interface UnsyncedEntry {
  dimensionId: string;
  sampleIndex: number;
  value: number;
}

export function getUnsyncedEntries(draft: SheetDraft): UnsyncedEntry[] {
  const out: UnsyncedEntry[] = [];
  for (const [dimensionId, samples] of Object.entries(draft)) {
    for (const [sampleIndexKey, entry] of Object.entries(samples)) {
      if (!entry.synced) {
        out.push({ dimensionId, sampleIndex: Number(sampleIndexKey), value: entry.value });
      }
    }
  }
  return out;
}
