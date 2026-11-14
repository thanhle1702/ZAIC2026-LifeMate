import type { Evaluation } from '../types'

const failures = new Set(['incomplete', 'execution_error', 'output_error', 'connection_error', 'http_error',
  'deadline', 'asr_error', 'model_error', 'context_overflow', 'step_limit', 'schema_error', 'tool_error', 'duplicate_loop',
  'unresolved_tool_error', 'retry_budget_exhausted', 'search_constraint_change', 'search_unresolved', 'output_truncated', 'invalid_protocol'])
export const executionFailed = (row: Pick<Evaluation, 'status' | 'stopReason'>) =>
  failures.has(row.status) || failures.has(row.stopReason ?? '')
export const observedFailure = (row: Evaluation) => executionFailed(row) || row.taskSuccess === false || row.hashMatch === false || row.sequenceMatch === false
export type ExecutionHealth = {
  completed: number; failed: number; reasons: Record<string, number>;
  recovered: number;
  failedSamples: { id: string; status: string; reason: string; mode: string }[]
}
export function executionHealth(rows: Pick<Evaluation, 'id' | 'status' | 'stopReason'>[], mode = ''): ExecutionHealth {
  const result: ExecutionHealth = { completed: 0, failed: 0, recovered: 0, reasons: {}, failedSamples: [] }
  for (const row of rows) {
    if (row.stopReason === 'recovered_with_errors') result.recovered++
    if (executionFailed(row)) {
      const reason = row.stopReason || row.status
      result.failed++; result.reasons[reason] = (result.reasons[reason] ?? 0) + 1
      result.failedSamples.push({ id: row.id, status: row.status, reason, mode })
    } else if (row.status === 'completed') result.completed++
  }
  return result
}
