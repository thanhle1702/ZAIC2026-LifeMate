import type { Evaluation } from '../types'

export type LiveMeta = {
  run_id: string; name: string; path: string; state: string; phase: string;
  model: string; split: string; mode: string; total: number; processed: number; scored: number;
  current_sample: string | null; step: number | null; started_at: string; elapsed_seconds: number;
  catching_up: boolean; message?: string; evaluator_version?: string;
  local_score?: number | null; mean_f1?: number | null; score_samples?: number;
}
export type LivePacket = { instance?: string; cursor: number; reset: boolean; run: LiveMeta | null; samples: Evaluation[]; warning?: string }
