import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dataset } from '../types'
import type { LiveMeta } from './liveTypes'
import { HISTORY_KEY, readHistory, summarizeRun, upsertRun, type RunSummary } from './runHistory'

export function useRunHistory(data: Dataset | null, run: LiveMeta | null) {
  const [initial] = useState(() => {
    try { return { rows: readHistory(localStorage.getItem(HISTORY_KEY)), error: '' } }
    catch { return { rows: [] as RunSummary[], error: 'Không đọc được lịch sử đã lưu. Hãy kiểm tra bộ nhớ trình duyệt.' } }
  })
  const [history, setHistory] = useState(initial.rows), [warning, setWarning] = useState(initial.error)
  const records = useRef(initial.rows), lastLive = useRef('')
  const save = useCallback(async (dataset: Dataset, metadata?: LiveMeta) => {
    try {
      const point = await summarizeRun(dataset, metadata)
      if (!point) return
      const next = upsertRun(records.current, point)
      if (next === records.current) return
      records.current = next; setHistory(next)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setWarning('') }
      catch { setWarning('Không lưu được lịch sử vào trình duyệt. Hãy xuất lịch sử JSON trước khi đóng trang.') }
    } catch { setWarning('Không tổng hợp được điểm của run. Artifact gốc vẫn được giữ nguyên.') }
  }, [])
  useEffect(() => {
    if (!data || !run || run.state !== 'completed' || run.catching_up) return
    const signature = JSON.stringify([run.run_id, run.processed, run.scored, run.local_score, run.score_samples, data.samples])
    if (lastLive.current === signature) return
    lastLive.current = signature
    void save(data, run)
  }, [data, run, save])
  return { history, warning, save }
}
