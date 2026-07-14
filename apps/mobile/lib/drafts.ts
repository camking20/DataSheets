import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local, unsubmitted measurement values for one data sheet, keyed by
 * dimension then sample index. Written on every keystroke so a dropped
 * connection (or a killed app) on the shop floor never loses a typed value —
 * entries are flushed to the API on submit/blur and marked `synced` once the
 * server has confirmed them.
 */
export interface DraftEntry {
  value: number;
  updatedAt: number;
  synced: boolean;
}

export type DimensionDraft = Record<number, DraftEntry>;
export type SheetDraft = Record<string, DimensionDraft>;

const draftKey = (sheetId: string) => `ds_draft_${sheetId}`;

export async function loadDraft(sheetId: string): Promise<SheetDraft> {
  try {
    const raw = await AsyncStorage.getItem(draftKey(sheetId));
    return raw ? (JSON.parse(raw) as SheetDraft) : {};
  } catch {
    return {};
  }
}

async function persistDraft(sheetId: string, draft: SheetDraft): Promise<void> {
  await AsyncStorage.setItem(draftKey(sheetId), JSON.stringify(draft));
}

export async function saveDraftValue(
  sheetId: string,
  dimensionId: string,
  sampleIndex: number,
  value: number,
  synced = false,
): Promise<SheetDraft> {
  const draft = await loadDraft(sheetId);
  const dimensionDraft = { ...(draft[dimensionId] ?? {}) };
  dimensionDraft[sampleIndex] = { value, updatedAt: Date.now(), synced };
  const next: SheetDraft = { ...draft, [dimensionId]: dimensionDraft };
  await persistDraft(sheetId, next);
  return next;
}

export async function markSynced(
  sheetId: string,
  dimensionId: string,
  sampleIndex: number,
): Promise<SheetDraft> {
  const draft = await loadDraft(sheetId);
  const entry = draft[dimensionId]?.[sampleIndex];
  if (!entry) return draft;
  const dimensionDraft = { ...draft[dimensionId], [sampleIndex]: { ...entry, synced: true } };
  const next: SheetDraft = { ...draft, [dimensionId]: dimensionDraft };
  await persistDraft(sheetId, next);
  return next;
}

export async function clearDraft(sheetId: string): Promise<void> {
  await AsyncStorage.removeItem(draftKey(sheetId));
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
