import type { InspectionFrequency } from "./schemas.js";

/**
 * Given lot size and a dimension's inspection frequency, return the
 * 0-based sample indices (piece numbers) that must be measured.
 */
export function generateSampleIndices(
  lotSize: number,
  frequency: InspectionFrequency,
): number[] {
  if (lotSize <= 0) return [];

  if (frequency.type === "sample_size_per_lot") {
    const count = Math.min(frequency.n, lotSize);
    if (count === lotSize) {
      return Array.from({ length: lotSize }, (_, i) => i);
    }
    // Evenly spaced samples across the lot
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      indices.push(Math.floor((i * lotSize) / count));
    }
    return [...new Set(indices)].sort((a, b) => a - b);
  }

  // every_n_parts: measure piece 0, n, 2n, ...
  const indices: number[] = [];
  for (let i = 0; i < lotSize; i += frequency.n) {
    indices.push(i);
  }
  return indices;
}

export function requiredSampleCount(
  lotSize: number,
  frequency: InspectionFrequency,
): number {
  return generateSampleIndices(lotSize, frequency).length;
}

export interface PiecePlanDimension {
  id: string;
  frequencyType: InspectionFrequency["type"];
  frequencyN: number;
}

export interface PiecePlanEntry {
  /** 0-based piece index within the lot */
  pieceIndex: number;
  /** Dimension ids due for inspection on this piece, in display order */
  dimensionIds: string[];
}

/**
 * Piece-major inspection plan: for each piece that requires at least one
 * measurement, list the dimensions due on that piece. Frequencies are
 * aligned so operators can walk piece-by-piece (all dims for piece 1, then
 * piece 2, …) instead of dimension-by-dimension.
 */
export function buildPiecePlan(
  lotSize: number,
  dims: PiecePlanDimension[],
): PiecePlanEntry[] {
  if (lotSize <= 0 || dims.length === 0) return [];

  const dueByPiece = new Map<number, string[]>();

  for (const dim of dims) {
    const indices = generateSampleIndices(lotSize, {
      type: dim.frequencyType,
      n: dim.frequencyN,
    });
    for (const pieceIndex of indices) {
      const list = dueByPiece.get(pieceIndex) ?? [];
      list.push(dim.id);
      dueByPiece.set(pieceIndex, list);
    }
  }

  return [...dueByPiece.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pieceIndex, dimensionIds]) => ({ pieceIndex, dimensionIds }));
}

/** Flat walk order for piece-first entry: (piece, dimension) pairs. */
export function flattenPiecePlan(
  plan: PiecePlanEntry[],
): Array<{ pieceIndex: number; dimensionId: string }> {
  const cells: Array<{ pieceIndex: number; dimensionId: string }> = [];
  for (const entry of plan) {
    for (const dimensionId of entry.dimensionIds) {
      cells.push({ pieceIndex: entry.pieceIndex, dimensionId });
    }
  }
  return cells;
}
