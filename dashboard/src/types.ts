export type ErrorCategory = 'asr' | 'sequence' | 'schema' | 'missing_info' | 'state' | 'unknown'
export type ToolCall = { name: string; arguments: Record<string, unknown> }
export type TraceStep = ToolCall & { observation?: unknown; validationError?: string; guardError?: string; step?: number; outcome?: string; blockReason?: string }
export type Diagnosis = { category: ErrorCategory; summary: string; evidence: string; confidence: 'observed' | 'heuristic' }
export interface Evaluation {
  id: string
  accent: string
  synthetic: boolean
  domains: string[]
  intent: string
  referenceText: string | null
  asrText: string | null
  audioFile: string | null
  audioUrl?: string
  predictedCalls: ToolCall[]
  expectedCalls: ToolCall[] | null
  predictedHash: string | null
  expectedHash: string | null
  sequenceMatch: boolean | null
  hashMatch: boolean | null
  taskSuccess: boolean | null
  isOos: boolean | null
  predictedOos: boolean | null
  latencyMs: number | null
  timings: Record<string, number>
  context: Record<string, unknown> | null
  history: unknown[]
  steps: TraceStep[]
  expectedState: unknown | null
  actualState: unknown | null
  diagnosis: Diagnosis | null
  status: string
  stopReason?: string | null
  operationIssues?: unknown[]
  blockCounts?: Record<string, number>
  evaluatorMs?: number
  localScore?: number | null
  engine?: string
  taskState?: Record<string, unknown> | null
  modelRequests?: number | null
  rawAsrText?: string | null
  usage?: Record<string, number>
  toolF1?: number | null
  toolPrecision?: number | null
  toolRecall?: number | null
  planningTrace?: { step: number; action: string; rawResponse: string; toolName: string | null; arguments: Record<string, unknown>; usage: Record<string, number>; promptSha256?: string; promptCharacters?: number; rawResponseAvailable?: boolean; finishReason?: string | null; errorKind?: string; responseError?: string | null; responseFormat?: string | null; schemaSha256?: string | null; httpStatus?: number | null; requestAttempted?: boolean; responseSource?: string; goalId?: string; operationId?: string }[]
}
export interface Dataset {
  name: string
  source: 'empty' | 'import' | 'live'
  model: string
  split: string
  samples: Evaluation[]
  files: string[]
  run?: { id?: string; startedAt?: string; mode?: string; expectedTotal?: number; evaluatorVersion?: string }
}
export const categories: { id: ErrorCategory; label: string; description: string; color: string }[] = [
  { id: 'asr', label: 'ASR / thực thể', description: 'Sai nội dung nhận dạng hoặc thực thể', color: '#71a7f5' },
  { id: 'sequence', label: 'Thứ tự tool', description: 'Sai tool, thiếu bước hoặc dependency', color: '#ad98e6' },
  { id: 'schema', label: 'Schema / arguments', description: 'Tham số không đáp ứng schema', color: '#e7b969' },
  { id: 'missing_info', label: 'Thông tin còn thiếu', description: 'Hỏi thiếu, hỏi thừa hoặc tự điền dữ liệu', color: '#e68e75' },
  { id: 'state', label: 'Trạng thái cuối', description: 'State hash không khớp', color: '#d77890' },
  { id: 'unknown', label: 'Chưa xác định', description: 'Cần người đánh giá kiểm tra trace', color: '#8b96a6' },
]
export const domainLabels: Record<string, string> = {
  smart_home: 'Smart home', banking: 'Banking', ride_hailing: 'Ride', food_delivery: 'Food',
  email: 'Email', alarm: 'Alarm', contacts: 'Contacts', sms: 'SMS', unsupported: 'Out of scope',
}
