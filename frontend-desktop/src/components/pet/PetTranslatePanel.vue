<script setup lang="ts">
// 问星 v1.5 — 桌宠划词翻译面板
// 头部语言方向 + 可编辑原文 + 翻译卡片；全局热键 Ctrl+Shift+T 唤起
import { ref, watch } from 'vue'
import { useTranslateStore } from '@/stores/translateStore'
import TranslationCard from '@/components/translate/TranslationCard.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useTranslateStore()

/** 原文编辑框内容（与 store.sourceText 单向同步，避免输入被打断） */
const draft = ref(store.sourceText)

watch(
  () => store.sourceText,
  (v) => { draft.value = v }
)

function retranslate() {
  void store.translate(draft.value)
}
</script>

<template>
  <div class="wx-pet-tr wx-glass-strong" data-test="pet-translate-panel">
    <header class="wx-pet-tr-head">
      <div class="wx-pet-tr-title">
        <span class="wx-pet-tr-icon">译</span>
        <div>
          <div class="wx-pet-tr-name">划词翻译</div>
          <div class="wx-pet-tr-sub">
            {{ store.result ? `${store.result.fromLang === 'zh' ? '中文' : 'English'} → ${store.result.toLang === 'zh' ? '中文' : 'English'}` : 'Ctrl+Shift+T 取词' }}
          </div>
        </div>
      </div>
      <button class="wx-pet-tr-close" @click="emit('close')" title="收起">✕</button>
    </header>

    <div class="wx-pet-tr-body">
      <textarea
        v-model="draft"
        class="wx-pet-tr-input"
        rows="3"
        placeholder="粘贴或输入要翻译的文字…"
        @keydown.enter.exact.prevent="retranslate"
      ></textarea>

      <button
        v-if="!store.loading && !store.result"
        class="wx-pet-tr-go wx-pressable"
        @click="retranslate"
      >
        翻译
      </button>

      <TranslationCard
        :result="store.result"
        :loading="store.loading"
        :error="store.error"
        @retry="retranslate"
        @swap="store.swap"
        @copy="store.copy"
      />
    </div>
  </div>
</template>

<style scoped>
.wx-pet-tr {
  position: absolute;
  inset: 0;   /* 铺满翻译态窗口（400x480），窗口右下缘锚定屏幕 */
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
  animation: wx-pet-tr-in 220ms var(--wx-ease-out-soft);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 40px color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
}

@keyframes wx-pet-tr-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.wx-pet-tr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
}
.wx-pet-tr-title { display: flex; align-items: center; gap: 8px; }
.wx-pet-tr-icon {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--wx-gradient-primary); color: var(--wx-text-on-accent); font-size: 13px;
}
.wx-pet-tr-name { font-weight: 600; font-size: 13px; }
.wx-pet-tr-sub { font-size: 10px; color: var(--wx-text-tertiary); margin-top: 1px; }
.wx-pet-tr-close {
  width: 26px; height: 26px; border-radius: 6px;
  color: var(--wx-text-tertiary); font-size: 13px;
  transition: all var(--wx-duration-fast);
}
.wx-pet-tr-close:hover { background: color-mix(in srgb, var(--wx-ink) 8%, transparent); color: var(--wx-text-on-accent); }

.wx-pet-tr-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
}

.wx-pet-tr-input {
  width: 100%;
  resize: none;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  color: var(--wx-text-primary);
  font-size: 12px;
  line-height: 1.55;
  font-family: inherit;
  outline: none;
}
.wx-pet-tr-input:focus { border-color: color-mix(in srgb, var(--wx-color-primary) 45%, transparent); }

.wx-pet-tr-go {
  padding: 7px 0;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
}
</style>
