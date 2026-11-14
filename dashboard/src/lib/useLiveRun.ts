import { useEffect, useRef, useState } from 'react'
import type { Dataset, Evaluation } from '../types'
import type { LiveMeta, LivePacket } from './liveTypes'

export function useLiveRun(enabled: boolean) {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [run, setRun] = useState<LiveMeta | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [warning, setWarning] = useState('')
  const cache = useRef({ id: '', instance: '', cursor: 0, samples: new Map<string, Evaluation>() })
  useEffect(() => {
    if (!enabled) return
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function poll() {
      try {
        const { id, cursor, instance } = cache.current
        const response = await fetch(`/_lifemate/live?run=${id}&cursor=${cursor}&instance=${instance}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Live bridge không phản hồi. Kiểm tra npm run dev.')
        const packet: LivePacket = await response.json()
        if (!packet || !Array.isArray(packet.samples) || !Number.isSafeInteger(packet.cursor)) throw new Error('Live bridge trả dữ liệu không hợp lệ.')
        if (stopped) return
        setConnection('connected'); setWarning(packet.warning ?? ''); setRun(packet.run)
        if (packet.run) {
          const fresh = packet.reset || packet.run.run_id !== cache.current.id
          if (fresh) cache.current.samples.clear()
          packet.samples.forEach(row => cache.current.samples.set(row.id, row))
          cache.current.id = packet.run.run_id; cache.current.cursor = packet.cursor
          cache.current.instance = packet.instance ?? ''
          if (fresh || packet.samples.length) setDataset({ name: packet.run.name, source: 'live',
            model: packet.run.model, split: packet.run.split, run: { id: packet.run.run_id, startedAt: packet.run.started_at, mode: packet.run.mode },
            samples: [...cache.current.samples.values()], files: ['live.json', 'live-inputs.json', 'trace.jsonl'] })
        } else {
          cache.current = { id: '', instance: packet.instance ?? '', cursor: 0, samples: new Map() }
          setDataset(null)
        }
      } catch (error) {
        if (!stopped) { setConnection('error'); setWarning(error instanceof Error ? error.message : 'Mất kết nối live bridge.') }
      } finally { if (!stopped) timer = setTimeout(() => void poll(), 1000) }
    }
    void poll()
    return () => { stopped = true; controller.abort(); clearTimeout(timer) }
  }, [enabled])
  return { dataset, run, connection, warning }
}
