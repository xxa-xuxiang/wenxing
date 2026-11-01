// 问星 v1.5 — Agent 注册表（预留）
// 设计：路由与前端契约先立，后续把各子 agent 实现 play 在这里注册即可，无需再改路由或前端。
// 未注册的 agent 一律返回 501，前端按「功能未启用」处理。
const registry = new Map()

/** 注册一个 agent：{ name, description, run(input) => Promise<any> } */
export function registerAgent(agent) {
  if (!agent?.name || typeof agent.run !== 'function') throw new Error('agent 定义不合法')
  registry.set(agent.name, agent)
}

/** 已注册 agent 的公开描述（不含实现） */
export function listAgents() {
  return [...registry.values()].map(({ name, description }) => ({ name, description }))
}

/** 运行指定 agent；未注册时抛 501 语义错误 */
export async function runAgent(name, input) {
  const agent = registry.get(name)
  if (!agent) {
    const e = new Error(`agent 未启用：${name}`)
    e.status = 501
    throw e
  }
  return agent.run(input)
}
