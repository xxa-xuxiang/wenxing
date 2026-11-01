<!-- 登录/注册页：Vant 表单布局，对齐桌面端的预校验、错误文案与离线提示 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const password2 = ref('')
const nickname = ref('')
const inviteCode = ref('')
const agreed = ref(false)
const errorText = ref('')
const submitting = ref(false)

const isLogin = computed(() => mode.value === 'login')
const submitText = computed(() => (isLogin.value ? '登录' : '注册并开始学习'))

function switchMode(m: 'login' | 'register') {
  mode.value = m
  errorText.value = ''
}

/** 前端预校验（与后端规则一致：用户名 1-24 位中文/字母/数字/下划线，密码 ≥6 位） */
function validate(): string {
  const name = username.value.trim()
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{1,24}$/.test(name)) {
    return '用户名需为 1-24 位中文、字母、数字或下划线'
  }
  if (password.value.length < 6) return '密码至少 6 位'
  if (!isLogin.value && password.value !== password2.value) return '两次输入的密码不一致'
  if (!agreed.value) return '请先阅读并同意《用户协议》与《隐私政策》'
  return ''
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return
  errorText.value = validate()
  if (errorText.value) return
  submitting.value = true
  try {
    if (isLogin.value) {
      await auth.login(username.value.trim(), password.value)
      showToast('欢迎回来')
    } else {
      await auth.register(username.value.trim(), password.value, nickname.value.trim(), inviteCode.value.trim())
      showToast('注册成功')
    }
    await router.replace('/learn')
  } catch (e) {
    errorText.value = e instanceof Error && e.message
      ? e.message
      : '请求失败，请检查后端是否启动'
  } finally {
    submitting.value = false
  }
}

// ===== 协议弹层 =====
const agreementOpen = ref(false)
const docType = ref<'user' | 'privacy'>('user')
const docTitle = computed(() => (docType.value === 'user' ? '用户协议' : '隐私政策'))
const docBody = computed(() =>
  docType.value === 'user'
    ? '问星提供行业知识学习、题库练习与学习进度记录服务。请勿上传违法内容，请妥善保管账号密码；题库与解析仅用于学习参考。'
    : '问星仅收集登录账号、学习进度与答题记录，用于多端同步与掌握度统计；不会向第三方出售你的个人信息，反馈内容仅用于产品改进。'
)
function openDoc(t: 'user' | 'privacy') {
  docType.value = t
  agreementOpen.value = true
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-brand">
      <div class="auth-logo">🌌</div>
      <h1 class="auth-title">问星</h1>
      <p class="auth-slogan">以星为图，以问为径</p>
    </div>

    <div v-if="auth.offline" class="auth-offline">
      <span>⚠ 后端暂不可达 · 当前为本地模式，已有学习数据可继续使用</span>
      <button class="auth-offline-btn" @click="router.replace('/learn')">本地继续</button>
    </div>

    <div class="auth-card">
      <van-tabs v-model:active="mode" shrink background="transparent" @change="errorText = ''">
        <van-tab title="登录" name="login" />
        <van-tab title="注册" name="register" />
      </van-tabs>

      <van-form @submit="onSubmit">
        <van-cell-group inset>
          <van-field
            v-model="username"
            name="username"
            label="账号"
            placeholder="1-24 位中文、字母、数字或下划线"
            maxlength="24"
            autocomplete="username"
            clearable
          />
          <van-field
            v-if="!isLogin"
            v-model="nickname"
            name="nickname"
            label="昵称"
            placeholder="展示在个人中心的名字（可选）"
            maxlength="24"
            clearable
          />
          <van-field
            v-model="password"
            type="password"
            name="password"
            label="密码"
            placeholder="至少 6 位"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
            clearable
          />
          <van-field
            v-if="!isLogin"
            v-model="password2"
            type="password"
            name="password2"
            label="确认密码"
            placeholder="再次输入密码"
            autocomplete="new-password"
            clearable
          />
          <van-field
            v-if="!isLogin"
            v-model="inviteCode"
            name="inviteCode"
            label="邀请码"
            placeholder="选填，填写好友的邀请码"
            maxlength="16"
            autocomplete="off"
            clearable
          />
        </van-cell-group>

        <div class="auth-agree">
          <van-checkbox v-model="agreed" shape="square" icon-size="15px">
            我已阅读并同意
            <span class="auth-link" @click.stop="openDoc('user')">《用户协议》</span>
            与
            <span class="auth-link" @click.stop="openDoc('privacy')">《隐私政策》</span>
          </van-checkbox>
        </div>

        <div v-if="errorText" class="auth-error">⚠ {{ errorText }}</div>

        <div class="auth-submit">
          <van-button
            round
            block
            type="primary"
            native-type="submit"
            :loading="submitting"
            loading-text="请稍候…"
          >
            {{ submitText }}
          </van-button>
        </div>
      </van-form>
    </div>

    <p class="auth-foot">登录后学习数据云端同步 · 手机 / 桌面数据一致</p>

    <van-popup v-model:show="agreementOpen" position="bottom" round :style="{ maxHeight: '70vh' }">
      <div class="auth-doc">
        <h3 class="auth-doc-title">{{ docTitle }}</h3>
        <p class="auth-doc-body">{{ docBody }}</p>
        <van-button round block type="primary" @click="agreementOpen = false">我知道了</van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40px 0 calc(24px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, #e8f1ff 0%, #f7f8fa 55%);
}

.auth-brand {
  text-align: center;
  margin-bottom: 24px;
}

.auth-logo {
  font-size: 56px;
  line-height: 1;
}

.auth-title {
  margin: 12px 0 4px;
  font-size: 26px;
  letter-spacing: 6px;
  color: #323233;
}

.auth-slogan {
  margin: 0;
  font-size: 13px;
  color: #969799;
  letter-spacing: 2px;
}

.auth-offline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 20px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff7e8;
  border: 1px solid #ffe1a8;
  font-size: 11.5px;
  color: #ad6800;
}

.auth-offline-btn {
  flex-shrink: 0;
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #ffd591;
  background: #fff;
  font-size: 11px;
  color: #ad6800;
}

.auth-card {
  margin: 0 20px;
  background: #fff;
  border-radius: 16px;
  padding: 8px 0 4px;
  box-shadow: 0 8px 24px rgba(25, 137, 250, 0.08);
}

.auth-agree {
  padding: 12px 28px 0;
  font-size: 11.5px;
  color: #969799;
}

.auth-link {
  color: #1989fa;
}

.auth-error {
  margin: 10px 28px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  font-size: 12px;
  color: #ee0a24;
  line-height: 1.5;
}

.auth-submit {
  margin: 16px 16px 8px;
}

.auth-foot {
  text-align: center;
  font-size: 12px;
  color: #c8c9cc;
  margin-top: 24px;
}

.auth-doc {
  padding: 20px 20px calc(20px + env(safe-area-inset-bottom));
}

.auth-doc-title {
  margin: 0 0 10px;
  font-size: 16px;
  color: #323233;
  text-align: center;
}

.auth-doc-body {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.8;
  color: #646566;
}
</style>
