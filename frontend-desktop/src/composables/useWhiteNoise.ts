// 问星 — 白噪音实时合成 composable（纯 Web Audio API，不引入任何音频文件）
// 用法：const { playing, kind, volume, start, stop, setVolume, setKind } = useWhiteNoise()
// 约束：不主动出声；仅当用户调用 start(kind) 后才播放；onBeforeUnmount 自动停止并释放 AudioContext。
// 链路：循环 AudioBuffer(≈2s 随机噪声) → BufferSource(loop) → BiquadFilter 调色 → GainNode → destination
import { onBeforeUnmount, ref, type Ref } from 'vue'

/** 音色：白噪声 / 雨声 / 海浪 / 咖啡馆 */
export type NoiseKind = 'white' | 'rain' | 'wave' | 'cafe'

interface FilterSpec {
  type: BiquadFilterType
  freq: number
  q?: number
}

interface LayerSpec {
  /** 相对基准的播放速率（用于「失谐叠层」打散相关性，近似人群低频嗡鸣） */
  playbackRate?: number
  filters: FilterSpec[]
}

interface LfoSpec {
  /** LFO 频率（Hz） */
  freq: number
  /** 调制深度（0-1，相对主增益） */
  depth: number
}

interface NoiseSpec {
  layers: LayerSpec[]
  lfo: LfoSpec | null
}

/** 四种音色的滤波 / 调制配置 */
const NOISE_SPECS: Record<NoiseKind, NoiseSpec> = {
  // 白噪声：低通 ~12kHz，削掉刺耳超高频
  white: {
    layers: [{ filters: [{ type: 'lowpass', freq: 12000 }] }],
    lfo: null
  },
  // 雨声：高通 + 低通组成窄带（中心偏高），叠加轻微幅度抖动
  rain: {
    layers: [
      {
        filters: [
          { type: 'highpass', freq: 900, q: 0.7 },
          { type: 'lowpass', freq: 9000, q: 0.7 }
        ]
      }
    ],
    lfo: { freq: 6, depth: 0.06 }
  },
  // 海浪：低通 + 0.1Hz 缓慢 LFO 模拟潮汐起伏
  wave: {
    layers: [{ filters: [{ type: 'lowpass', freq: 700, q: 0.8 }] }],
    lfo: { freq: 0.1, depth: 0.6 }
  },
  // 咖啡馆：低通 + 轻微失谐噪声叠层（低频嗡鸣）
  cafe: {
    layers: [
      { filters: [{ type: 'lowpass', freq: 1000, q: 0.6 }] },
      { playbackRate: 0.97, filters: [{ type: 'lowpass', freq: 760, q: 0.6 }] }
    ],
    lfo: { freq: 0.6, depth: 0.1 }
  }
}

type AudioCtor = typeof AudioContext

/** 取可用构造器（优先 window.AudioContext，兼容 webkit 前缀） */
function getAudioCtor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export interface UseWhiteNoiseReturn {
  /** 是否正在出声 */
  playing: Ref<boolean>
  /** 当前音色 */
  kind: Ref<NoiseKind>
  /** 音量 0-1 */
  volume: Ref<number>
  /** 开始播放（若 context 未创建则创建；浏览器要求用户手势后才能 resume） */
  start: (kind: NoiseKind) => void
  /** 停止音源但保留 AudioContext */
  stop: () => void
  /** 设置音量 0-1 */
  setVolume: (v: number) => void
  /** 切换音色（播放中则热切换，复用同一 context） */
  setKind: (kind: NoiseKind) => void
}

export function useWhiteNoise(): UseWhiteNoiseReturn {
  const playing = ref(false)
  const kind = ref<NoiseKind>('white')
  const volume = ref(0.5)

  let ctx: AudioContext | null = null
  let noiseBuffer: AudioBuffer | null = null
  let master: GainNode | null = null
  let lfoNode: OscillatorNode | null = null
  let lfoGain: GainNode | null = null
  let lfoDepth = 0
  let liveNodes: AudioNode[] = []
  let liveSources: AudioBufferSourceNode[] = []

  /** 生成约 2 秒的循环噪声缓冲（双声道各自独立随机，获得自然立体宽度） */
  function createNoiseBuffer(c: AudioContext): AudioBuffer {
    const len = Math.max(1, Math.floor(c.sampleRate * 2))
    const buf = c.createBuffer(2, len, c.sampleRate)
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    return buf
  }

  function ensureContext(): AudioContext | null {
    if (ctx) return ctx
    const Ctor = getAudioCtor()
    if (!Ctor) return null
    ctx = new Ctor()
    noiseBuffer = createNoiseBuffer(ctx)
    return ctx
  }

  /** 拆掉当前音源与滤波链（保留 AudioContext 供复用） */
  function teardownGraph() {
    for (const s of liveSources) {
      try { s.stop() } catch { /* 未 start 时忽略 */ }
    }
    if (lfoNode) {
      try { lfoNode.stop() } catch { /* noop */ }
    }
    for (const n of liveNodes) {
      try { n.disconnect() } catch { /* noop */ }
    }
    liveSources = []
    liveNodes = []
    master = null
    lfoNode = null
    lfoGain = null
    lfoDepth = 0
  }

  function start(k: NoiseKind) {
    kind.value = k
    const c = ensureContext()
    const buf = noiseBuffer
    if (!c || !buf) return
    void c.resume() // 浏览器要求用户手势后恢复
    teardownGraph()

    const m = c.createGain()
    m.gain.value = volume.value

    const spec = NOISE_SPECS[k]
    // 叠层：每层一个 BufferSource + 滤波链，全部汇入主增益
    for (const layer of spec.layers) {
      const src = c.createBufferSource()
      src.buffer = buf
      src.loop = true
      if (layer.playbackRate !== undefined) src.playbackRate.value = layer.playbackRate
      let tail: AudioNode = src
      liveNodes.push(src)
      for (const f of layer.filters) {
        const bq = c.createBiquadFilter()
        bq.type = f.type
        bq.frequency.value = f.freq
        if (f.q !== undefined) bq.Q.value = f.q
        tail.connect(bq)
        tail = bq
        liveNodes.push(bq)
      }
      tail.connect(m)
      liveSources.push(src)
    }

    // LFO：正弦振荡 → 增益(深度×主增益) → 调制主增益（潮汐 / 抖动起伏）
    if (spec.lfo) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = spec.lfo.freq
      const lg = c.createGain()
      lfoDepth = spec.lfo.depth
      lg.gain.value = lfoDepth * m.gain.value
      osc.connect(lg)
      lg.connect(m.gain)
      osc.start()
      lfoNode = osc
      lfoGain = lg
      liveNodes.push(osc, lg)
    }

    m.connect(c.destination)
    master = m
    liveNodes.push(m)

    for (const s of liveSources) s.start()
    playing.value = true
  }

  function stop() {
    teardownGraph()
    playing.value = false
  }

  function setVolume(v: number) {
    const clamped = Math.min(1, Math.max(0, v))
    volume.value = clamped
    if (master) master.gain.value = clamped
    if (lfoGain) lfoGain.gain.value = lfoDepth * clamped
  }

  function setKind(k: NoiseKind) {
    const changed = kind.value !== k
    kind.value = k
    if (playing.value && changed) start(k)
  }

  onBeforeUnmount(() => {
    teardownGraph()
    playing.value = false
    if (ctx) {
      void ctx.close()
      ctx = null
      noiseBuffer = null
    }
  })

  return { playing, kind, volume, start, stop, setVolume, setKind }
}
