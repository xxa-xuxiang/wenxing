// 问星 — 受控极简 YAML 解析器（无第三方依赖）
// 仅支持文档中心目录格式：
//   key: value          标量（可被单/双引号包裹）
//   key:                空值（下一层为 map 或 seq）
//   - key: value        序列项（项为 map，后续键与 '- ' 后内容同缩进）
// 缩进必须用空格；# 开头为注释
// 输出普通 JS 对象；格式非法时抛错
function toScalar(raw) {
  let v = String(raw).trim()
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    return v.slice(1, -1)
  }
  if (/^-?\d+$/.test(v)) return Number(v)
  return v
}

export function parseYaml(text) {
  // 统一换行（兼容 Windows CRLF，否则 \r 会破坏行正则）
  const normalized = String(text).replace(/\r\n?/g, '\n')
  // 预处理：序列行拆成「列表标记 + 同内容的 kv 行」
  // mark: 列表项边界，indent = dash 缩进
  // kv: indent = dash 缩进 + 2（'- ' 两列）
  const tokens = []
  for (const raw of normalized.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const dash = /^(\s*)-\s+(.*)$/.exec(raw)
    if (dash) {
      const d = dash[1].length
      tokens.push({ kind: 'mark', indent: d })
      tokens.push(makeKv(d + 2, dash[2]))
      continue
    }
    const d = raw.length - raw.trimStart().length
    tokens.push(makeKv(d, raw.trim()))
  }

  function makeKv(indent, line) {
    const idx = line.indexOf(':')
    if (idx < 0) throw new Error(`无法解析的 YAML 行：${line}`)
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    return { kind: 'kv', indent, key, value: val === '' ? null : toScalar(val) }
  }

  const root = {}
  // 栈帧：
  //   map:         { indent, node, type:'map' }
  //   seq:         { indent, node, type:'seq' }
  //   placeholder: { indent, owner, ownerKey, type:'ph' }（key: 待下一层填充）
  const stack = [{ indent: -1, node: root, type: 'map' }]

  for (const tok of tokens) {
    // 通用回退：缩进 >= 当前行 的 map/seq 帧弹出（ph 帧留给下面显式处理）
    while (stack.length > 1) {
      const top = stack[stack.length - 1]
      if (top.type === 'ph') break
      if (top.indent > tok.indent) stack.pop()
      else break
    }

    // 空值 key 等待填充：placeholder 帧
    if (stack[stack.length - 1].type === 'ph') {
      const ph = stack[stack.length - 1]
      if (ph.indent >= tok.indent) throw new Error('YAML 缩进层级错误')
      stack.pop()
      if (tok.kind === 'mark') {
        const arr = []
        ph.owner[ph.ownerKey] = arr
        stack.push({ indent: tok.indent, node: arr, type: 'seq' })
      } else {
        const obj = {}
        ph.owner[ph.ownerKey] = obj
        stack.push({ indent: tok.indent, node: obj, type: 'map' })
      }
    }

    if (tok.kind === 'mark') {
      const seqFrame = stack[stack.length - 1]
      if (seqFrame.type !== 'seq' || seqFrame.indent !== tok.indent) {
        throw new Error('YAML 列表标记位置非法')
      }
      const item = {}
      seqFrame.node.push(item)
      stack.push({ indent: tok.indent + 2, node: item, type: 'map' })
      continue
    }

    // kv
    const frame = stack[stack.length - 1]
    if (frame.type !== 'map') throw new Error(`YAML 键值出现在非映射位置：${tok.key}`)
    if (tok.value === null) {
      // 占位，等待下一层
      stack.push({ indent: tok.indent, owner: frame.node, ownerKey: tok.key, type: 'ph' })
    } else {
      frame.node[tok.key] = tok.value
    }
  }

  return root
}
