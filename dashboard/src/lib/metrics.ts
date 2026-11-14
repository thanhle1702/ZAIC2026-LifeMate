import type { Evaluation } from '../types'

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export const equal = (a: unknown, b: unknown) => stable(a) === stable(b)
export const normalizeWords = (s: string) => s.normalize('NFC').toLocaleLowerCase('vi').replace(/[\p{P}\p{S}]/gu, ' ').trim().split(/\s+/u).filter(Boolean)
export function editDistance(a: string[], b: string[]) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1]
    for (let j = 0; j < b.length; j++) current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j])))
    previous = current
  }
  return previous[b.length]
}
export function wordError(sample: Evaluation) {
  if (sample.referenceText === null || sample.asrText === null) return null
  const reference = normalizeWords(sample.referenceText)
  if (!reference.length) return null
  const hypothesis = normalizeWords(sample.asrText)
  if (reference.length > 1000 || hypothesis.length > 1000) return null
  return { errors: editDistance(reference, hypothesis), words: reference.length }
}
export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const fraction = (rows: Evaluation[], get: (r: Evaluation) => boolean | null) => {
  const values = rows.map(get).filter((v): v is boolean => v !== null)
  return { value: values.length ? values.filter(Boolean).length / values.length : null, n: values.length }
}
export function summarize(rows: Evaluation[]) {
  const wordCounts = rows.map(wordError).filter((v): v is NonNullable<ReturnType<typeof wordError>> => v !== null)
  const referenceWords = wordCounts.reduce((s, r) => s + r.words, 0)
  const oosRows = rows.filter(r => r.isOos !== null && r.predictedOos !== null)
  const tp = oosRows.filter(r => r.isOos && r.predictedOos).length
  const predicted = oosRows.filter(r => r.predictedOos).length
  const positive = oosRows.filter(r => r.isOos).length
  const latency = rows.flatMap(r => r.latencyMs === null ? [] : [r.latencyMs]).sort((a, b) => a - b)
  return {
    total: rows.length,
    passed: rows.filter(r => r.taskSuccess === true).length,
    failed: rows.filter(r => r.taskSuccess === false).length,
    unscored: rows.filter(r => r.taskSuccess === null).length,
    sequence: fraction(rows, r => r.sequenceMatch), hash: fraction(rows, r => r.hashMatch),
    wer: referenceWords ? wordCounts.reduce((s, r) => s + r.errors, 0) / referenceWords : null,
    werSamples: wordCounts.length,
    oosPrecision: predicted ? tp / predicted : null,
    oosRecall: positive ? tp / positive : null,
    oosN: oosRows.length,
    medianLatency: median(latency),
    p95Latency: latency.length ? latency[Math.min(latency.length - 1, Math.ceil(latency.length * .95) - 1)] : null,
  }
}
export function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value && typeof value === 'object' && Object.keys(value).length) {
    return Object.assign({}, ...Object.entries(value).map(([key, v]) => flatten(v, prefix ? `${prefix}.${key}` : key)))
  }
  return { [prefix || '$']: value }
}
export function diffFields(expected: unknown, actual: unknown) {
  const a = flatten(expected), b = flatten(actual)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => ({
    key, expected: a[key], actual: b[key], changed: !Object.hasOwn(a, key) || !Object.hasOwn(b, key) || !equal(a[key], b[key]),
  }))
}
export function wordDiff(reference: string, hypothesis: string) {
  const a = reference.split(/\s+/).filter(Boolean).slice(0, 1000), b = hypothesis.split(/\s+/).filter(Boolean).slice(0, 1000)
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + Number(!equal(normalizeWords(a[i - 1]), normalizeWords(b[j - 1]))))
  const parts: { text: string; type: 'same' | 'removed' | 'added' }[] = []
  let i = a.length, j = b.length
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + Number(!equal(normalizeWords(a[i - 1]), normalizeWords(b[j - 1])))) {
      const same = equal(normalizeWords(a[i - 1]), normalizeWords(b[j - 1]))
      if (same) parts.unshift({ text: b[j - 1], type: 'same' })
      else parts.unshift({ text: a[i - 1], type: 'removed' }, { text: b[j - 1], type: 'added' })
      i--; j--
    } else if (j && dp[i][j] === dp[i][j - 1] + 1) { parts.unshift({ text: b[--j], type: 'added' }) }
    else { parts.unshift({ text: a[--i], type: 'removed' }) }
  }
  return parts
}
export const percent = (n: number | null) => n === null ? '—' : `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
export const duration = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(2)}s`
