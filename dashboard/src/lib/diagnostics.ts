import type { Evaluation, ToolCall, TraceStep } from '../types'
import { editDistance, equal, normalizeWords } from './metrics'
export function executedCallIndex(steps: TraceStep[], index: number, inferredCalls = false): number | null {
  const step = steps[index]
  if (!step || step.guardError || step.validationError) return null
  if (inferredCalls) return index
  if (step.observation === undefined) return null
  return steps.slice(0, index).filter(s => s.observation !== undefined && !s.guardError && !s.validationError).length
}
export function wilson(success: number, n: number) {
  if (!n) return null
  const z = 1.96, p = success / n, d = 1 + z * z / n
  const middle = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return [Math.max(0, middle - half), Math.min(1, middle + half)]
}
export function diagnostics(rows: Evaluation[]) {
  const statuses: Record<string, number> = {}, confusions: Record<string, number> = {}, reasons: Record<string, { count: number; ids: string[] }> = {}
  let chars = 0, edits = 0, badArgs = 0, schema = 0, noEffect = 0, missingTp = 0, missingFp = 0, missingFn = 0, missingN = 0
  const add = (key: string, id: string) => { reasons[key] ??= { count: 0, ids: [] }; reasons[key].count++; reasons[key].ids.push(id) }
  for (const r of rows) {
    statuses[r.status] = (statuses[r.status] ?? 0) + 1
    if (r.referenceText !== null && r.asrText !== null) {
      const a = normalizeWords(r.referenceText).join(' '), b = normalizeWords(r.asrText).join(' ')
      if (a.length && a.length <= 2000 && b.length <= 2000) { chars += a.length; edits += editDistance([...a], [...b]) }
    }
    schema += r.steps.filter(s => s.validationError).length
    noEffect += r.steps.filter(s => s.observation && typeof s.observation === 'object' && (s.observation as any).done === false).length
    if (r.expectedCalls !== null && r.status !== 'running') {
      const goldAsk = r.expectedCalls.some(c => c.name === 'sys.ask_missing_info'), predAsk = r.predictedCalls.some(c => c.name === 'sys.ask_missing_info')
      missingN++; if (goldAsk && predAsk) missingTp++; if (!goldAsk && predAsk) missingFp++; if (goldAsk && !predAsk) missingFn++
      for (let i = 0; i < Math.max(r.expectedCalls.length, r.predictedCalls.length); i++) {
        const gold: ToolCall | undefined = r.expectedCalls[i], pred: ToolCall | undefined = r.predictedCalls[i]
        if (gold?.name !== pred?.name) { const k = `${gold?.name ?? '∅'} → ${pred?.name ?? '∅'}`; confusions[k] = (confusions[k] ?? 0) + 1 }
        else if (gold && pred && !equal(gold.arguments, pred.arguments)) badArgs++
      }
    }
    if (r.status !== 'completed' && r.status !== 'unknown' && r.status !== 'running') add(`Lỗi thực thi: ${r.status}`, r.id)
    else if (r.taskSuccess === false) add(r.diagnosis?.summary ?? 'Task fail — chưa đủ bằng chứng nguyên nhân', r.id)
  }
  const mean = (key: 'toolF1' | 'toolPrecision' | 'toolRecall') => { const values = rows.flatMap(r => typeof r[key] === 'number' ? [r[key]!] : []); return { n: values.length, value: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null } }
  const tokens = rows.filter(r => typeof r.usage?.total_tokens === 'number')
  return { statuses, confusions, reasons, cer: chars ? edits / chars : null, charN: chars, schema, noEffect, badArgs,
    f1: mean('toolF1'), precision: mean('toolPrecision'), recall: mean('toolRecall'),
    missingPrecision: missingTp + missingFp ? missingTp / (missingTp + missingFp) : null,
    missingRecall: missingTp + missingFn ? missingTp / (missingTp + missingFn) : null, missingN,
    tokens: tokens.length ? tokens.reduce((sum, r) => sum + r.usage!.total_tokens, 0) : null, tokenN: tokens.length }
}
