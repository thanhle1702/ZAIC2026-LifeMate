import { useEffect, useRef, useState } from 'react'
import { AudioLines, Pause, Play, Upload } from 'lucide-react'

function safeAudio(src: string | undefined) {
  if (!src) return undefined
  try { const u = new URL(src, window.location.href); return ['http:', 'https:', 'blob:'].includes(u.protocol) && u.origin === window.location.origin ? u.href : undefined } catch { return undefined }
}
export default function AudioPlayer({ src, compact, onAttach }: { src?: string; compact?: boolean; onAttach?: (file: File) => void }) {
  const ref = useRef<HTMLAudioElement>(null), input = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(false), [progress, setProgress] = useState(0), [peaks, setPeaks] = useState<number[]>([]), [error, setError] = useState('')
  const url = safeAudio(src)
  useEffect(() => {
    setError(''); setPlaying(false); setProgress(0); setPeaks([])
    if (compact || !url) return
    const abort = new AbortController()
    let context: AudioContext | undefined
    let closing = false
    const closeContext = () => { if (context && !closing && context.state !== 'closed') { closing = true; void context.close().catch(() => {}) } }
    fetch(url, { signal: abort.signal }).then(r => { if (!r.ok) throw new Error(); return r.arrayBuffer() }).then(async buffer => {
      if (abort.signal.aborted) return
      context = new AudioContext()
      const audio = await context.decodeAudioData(buffer), data = audio.getChannelData(0), n = 100
      if (!abort.signal.aborted) setPeaks(Array.from({ length: n }, (_, i) => {
        const start = Math.floor(data.length / n * i), end = Math.floor(data.length / n * (i + 1)); let max = 0
        for (let j = start; j < end; j++) max = Math.max(max, Math.abs(data[j]))
        return max
      }))
    }).catch(() => { if (!abort.signal.aborted) setPeaks([]) }).finally(closeContext)
    return () => { abort.abort(); closeContext() }
  }, [url, compact])
  function pauseOthers() { document.querySelectorAll('audio').forEach(a => { if (a !== ref.current) a.pause() }) }
  async function toggle() {
    if (!ref.current || !url) return
    if (playing) ref.current.pause()
    else { try { pauseOthers(); await ref.current.play() } catch { setError('Không phát được audio. Gắn lại file ở máy bạn.') } }
  }
  const audio = <audio ref={ref} src={url} controls={!compact} preload={compact ? "none" : "metadata"} onPlay={() => { pauseOthers(); setPlaying(true) }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError('Không tìm thấy audio; hãy gắn file.')} onTimeUpdate={() => setProgress((ref.current?.currentTime ?? 0) / (ref.current?.duration || 1))} />
  if (compact) return <span className="audio-compact" title={error || (url ? 'Nghe audio' : 'Chưa có audio')}><button className="play-small" aria-label={playing ? 'Dừng audio' : 'Nghe audio'} disabled={!url || !!error} onClick={e => { e.stopPropagation(); void toggle() }}>{playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}</button><span className="tiny muted">{url ? 'Audio' : '—'}</span>{audio}</span>
  return <div className="audio-player">
    <div className="flex items-center justify-between gap-3"><span className="eyebrow"><AudioLines size={13} /> AUDIO INPUT</span>{onAttach && <button className="text-button" onClick={() => input.current?.click()}><Upload size={13} /> Gắn audio</button>}</div>
    <div className="waveform">
      {peaks.length ? <svg viewBox="0 0 600 70" preserveAspectRatio="none" role="img" aria-label="Sóng âm được giải mã từ file audio" onClick={e => { const a = ref.current; if (a && Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(1, (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width)) * a.duration }}>
        {peaks.map((v, i) => <rect key={i} x={i * 6 + 1} y={35 - Math.max(2, v * 31)} width="3" height={Math.max(4, v * 62)} rx="1" fill={i / peaks.length < progress ? '#62d9ad' : '#3b6558'} />)}
      </svg> : <span className="muted">{url ? 'Sóng âm hiện khi file giải mã được' : 'Gắn file audio để nghe và xem sóng âm'}</span>}
    </div>
    {audio}
    <p className={`tiny ${error ? 'text-danger' : 'muted'}`}>{error || (url ? 'Audio được đọc trực tiếp trong trình duyệt.' : 'Audio chưa được đính kèm trong run.')}</p>
    <input ref={input} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a" hidden onChange={e => { const file = e.target.files?.[0]; if (file) onAttach?.(file); e.target.value = '' }} />
  </div>
}
