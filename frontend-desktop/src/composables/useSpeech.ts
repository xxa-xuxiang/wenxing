// 问星 v0.10 — Web Speech API 封装（STT 语音识别 + TTS 语音合成）
// 用浏览器原生能力，无需额外 API key（Chrome / Edge / WebView2 支持）
import { ref } from 'vue'

// ===== 语音识别（STT） =====
type SpeechRecognitionCtor = new () => any

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export interface UseSpeechRecognitionOptions {
  /** 静音多久后自动触发 onFinal（毫秒），默认 1500 */
  silenceTimeout?: number
  /** 识别到最终文本的回调 */
  onFinal?: (text: string) => void
  /** 检测到用户开始说话的回调（用于打断 AI 朗读） */
  onSpeechStart?: () => void
}

export function useSpeechRecognition(opts: UseSpeechRecognitionOptions = {}) {
  const supported = ref(!!getRecognitionCtor())
  const listening = ref(false)
  const transcript = ref('')
  const finalText = ref('')
  const error = ref<string | null>(null)

  let recognition: any = null
  let silenceTimer: number | null = null
  const silenceMs = opts.silenceTimeout ?? 1500

  function resetSilenceTimer() {
    if (silenceTimer !== null) clearTimeout(silenceTimer)
    silenceTimer = window.setTimeout(() => {
      // 静音超时：如果有累积的 finalText，触发回调
      if (finalText.value.trim()) {
        opts.onFinal?.(finalText.value.trim())
        finalText.value = ''
        transcript.value = ''
      }
    }, silenceMs)
  }

  function start(lang = 'zh-CN') {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      error.value = '当前浏览器不支持语音识别，请用 Chrome / Edge'
      return
    }
    stop()
    recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true   // 连续识别，不自动停
    recognition.interimResults = true

    recognition.onresult = (e: any) => {
      let interim = ''
      let hasFinal = false
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          finalText.value += r[0].transcript
          hasFinal = true
        } else {
          interim += r[0].transcript
        }
      }
      transcript.value = interim
      // 检测到说话 → 通知外部（可用于打断 AI）
      if (interim || hasFinal) opts.onSpeechStart?.()
      // 有新结果就重置静音定时器
      if (interim || hasFinal) resetSilenceTimer()
    }
    recognition.onerror = (e: any) => {
      if (e.error === 'no-speech') {
        // 静音：不报错，等定时器触发
        return
      }
      if (e.error === 'aborted') return
      error.value = `语音识别错误：${e.error}`
      listening.value = false
    }
    recognition.onend = () => {
      // continuous 模式下浏览器仍可能结束，自动重启保持连续
      if (listening.value) {
        try { recognition.start() } catch { listening.value = false }
      }
    }

    transcript.value = ''
    finalText.value = ''
    error.value = null
    try {
      recognition.start()
      listening.value = true
    } catch (e) {
      error.value = '启动语音识别失败'
    }
  }

  function stop() {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
    if (recognition) {
      try { recognition.stop() } catch { /* noop */ }
      recognition = null
    }
    listening.value = false
  }

  /** 手动触发当前累积文本的发送（用于打断场景） */
  function flush() {
    if (finalText.value.trim()) {
      opts.onFinal?.(finalText.value.trim())
      finalText.value = ''
      transcript.value = ''
    }
  }

  return { supported, listening, transcript, finalText, error, start, stop, flush }
}

// ===== 语音合成（TTS） =====
export function useSpeechSynthesis() {
  const supported = ref('speechSynthesis' in window)
  const speaking = ref(false)

  // 缓存最优中文语音（异步加载）
  let preferredVoice: SpeechSynthesisVoice | null = null

  function pickBestVoice() {
    if (!supported.value) return
    const voices = window.speechSynthesis.getVoices()
    // 优先选 zh-CN 中文普通话
    const zhCN = voices.filter((v) => v.lang.toLowerCase().startsWith('zh-cn'))
    // 次选任意中文
    const zh = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'))
    const pool = zhCN.length ? zhCN : zh
    if (pool.length) {
      // 优先选非默认的高质量语音（系统默认语音通常是 Microsoft Huihui 等）
      // 经验：Microsoft 系列语音质量优于 Google 翻译语音
      preferredVoice =
        pool.find((v) => /microsoft|xiaoxiao|yunxi|huihui/i.test(v.name)) ??
        pool[0]
    }
  }

  // voices 在某些浏览器上异步加载
  if (supported.value) {
    pickBestVoice()
    window.speechSynthesis.onvoiceschanged = pickBestVoice
  }

  function speak(text: string, lang = 'zh-CN') {
    if (!supported.value || !text.trim()) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = lang
    utter.rate = 1.0   // 正常语速，语音通话不宜过快
    utter.pitch = 1.0  // 正常音调
    utter.volume = 1.0
    if (preferredVoice) utter.voice = preferredVoice
    utter.onstart = () => { speaking.value = true }
    utter.onend = () => { speaking.value = false }
    utter.onerror = () => { speaking.value = false }
    window.speechSynthesis.speak(utter)
  }

  function cancel() {
    window.speechSynthesis.cancel()
    speaking.value = false
  }

  return { supported, speaking, speak, cancel }
}
