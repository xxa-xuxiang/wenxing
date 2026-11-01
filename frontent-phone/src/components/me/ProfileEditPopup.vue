<!-- 学习档案编辑弹层：身份 / 阶段单选 + 已学领域多选；保存动作由父级二次确认后提交 -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import type { UserProfile } from '@/services/authService'
import { domains } from '@/data/domains'

const props = defineProps<{
  show: boolean
  profile: UserProfile | null
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'save', p: UserProfile): void
}>()

const IDENTITIES = ['在校大学生', '研究生', '职场新人', '在职提升', '转行求职', '其他']
const STAGES = ['大一', '大二', '大三', '大四', '研究生', '0-1 年经验', '1-3 年经验', '3 年以上经验']

/** 行业领域名（单层列表，多选；为空 = 零基础起步） */
const DOMAIN_NAMES = domains.map((d) => d.name)

const identity = ref('')
const stage = ref('')
const pickedDomains = ref<string[]>([])

// 每次打开时从当前档案回填（本地回填，不发请求）
watch(
  () => props.show,
  (v) => {
    if (!v) return
    identity.value = props.profile?.identity ?? ''
    stage.value = props.profile?.stage ?? ''
    pickedDomains.value = [...(props.profile?.domains ?? [])]
  }
)

function toggleDomain(name: string) {
  pickedDomains.value = pickedDomains.value.includes(name)
    ? pickedDomains.value.filter((d) => d !== name)
    : [...pickedDomains.value, name]
}

function close() {
  emit('update:show', false)
}

function submit() {
  if (!identity.value) {
    showToast('请选择当前身份')
    return
  }
  if (!stage.value) {
    showToast('请选择学习阶段')
    return
  }
  // 头像 / 认证信息原样保留，避免档案编辑覆盖
  emit('save', {
    identity: identity.value,
    stage: stage.value,
    domains: [...pickedDomains.value],
    avatar: props.profile?.avatar,
    verification: props.profile?.verification ?? null
  })
}
</script>

<template>
  <van-popup :show="show" position="bottom" round closeable class="pe-popup" @update:show="emit('update:show', $event)">
    <h3 class="pe-title">编辑学习档案</h3>
    <div class="pe-body">
      <div class="pe-field">
        <span class="pe-label">当前身份</span>
        <div class="pe-chips">
          <button
            v-for="v in IDENTITIES"
            :key="v"
            type="button"
            class="pe-chip"
            :class="{ active: identity === v }"
            @click="identity = v"
          >
            {{ v }}
          </button>
        </div>
      </div>

      <div class="pe-field">
        <span class="pe-label">学习阶段</span>
        <div class="pe-chips">
          <button
            v-for="v in STAGES"
            :key="v"
            type="button"
            class="pe-chip"
            :class="{ active: stage === v }"
            @click="stage = v"
          >
            {{ v }}
          </button>
        </div>
      </div>

      <div class="pe-field">
        <span class="pe-label">以前学过的领域（可多选，留空 = 零基础起步）</span>
        <div class="pe-chips">
          <button
            v-for="d in DOMAIN_NAMES"
            :key="d"
            type="button"
            class="pe-chip"
            :class="{ active: pickedDomains.includes(d) }"
            @click="toggleDomain(d)"
          >
            {{ d }}
          </button>
        </div>
      </div>

      <div class="pe-actions">
        <van-button round block @click="close">取消</van-button>
        <van-button round block type="primary" @click="submit">保存</van-button>
      </div>
      <p class="pe-tip">点击保存后将弹出确认框，确认后写入云端账号</p>
    </div>
  </van-popup>
</template>

<style scoped>
.pe-popup {
  padding-top: 20px;
}

.pe-title {
  margin: 0 0 12px;
  padding: 0 16px;
  font-size: 16px;
  color: #323233;
}

.pe-body {
  max-height: 68vh;
  overflow-y: auto;
  padding: 0 16px calc(16px + env(safe-area-inset-bottom));
}

.pe-field {
  margin-bottom: 16px;
}

.pe-label {
  display: block;
  font-size: 12px;
  color: #969799;
  margin-bottom: 8px;
}

.pe-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pe-chip {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
  color: #323233;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
}

.pe-chip.active {
  border-color: #1989fa;
  background: rgba(25, 137, 250, 0.08);
  color: #1989fa;
  font-weight: 600;
}

.pe-actions {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.pe-tip {
  margin: 10px 0 0;
  font-size: 11px;
  color: #c8c9cc;
  text-align: center;
}
</style>
