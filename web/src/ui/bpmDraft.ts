export function parseBpmDraft(draft: string): number | null {
  if (draft.trim() === '') return null
  const n = Number(draft)
  return Number.isFinite(n) ? n : null
}
