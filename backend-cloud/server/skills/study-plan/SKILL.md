---
name: study-plan
description: Generate a professional end-to-end study plan covering needs, resources, scheduling, visualization, and follow-up. Use when the user asks for a study plan, learning roadmap, exam-prep schedule, or progress-tracking design. Do not use for one-off Q&A or unrelated writing.
---

# Study Plan Generator

Produce a professional, executable study plan that a learner can run week by week.

The process spec is `references/学习全流程规划大纲.md`. Follow its five phases and reuse its quantitative thresholds — do not invent numbers that contradict it. Every phase must produce a concrete, reviewable artifact; skip a phase only when the user explicitly says so.

## Inputs

Collect before planning. Ask once for anything missing.

- 学习目标与核心诉求 — 兴趣拓展 / 职业技能 / 应试通过.
- 最终可交付成果 — 证书 / 作品 / 能力认证.
- 现有基础 — 学前测评得分率、相关经验、熟练度等级.
- 可支配学习时间 — 周均固定时长 + 碎片化时长.
- 约束 — 截止日期、预算上限、资源与人脉可得性.
- 学习偏好 — 高效时段、输入形式、记忆习惯.

## Procedure

### Phase 1 · 学习需求确认

1. 量化最终目标并拆成阶段目标；判定核心诉求类型并给出对应证据要求（见大纲「学习方向与最终成果定义」）。
2. 拆分 3–5 个无重叠能力模块，按「急需程度 × 前置依赖 × 投入产出」1–5 分评分，落 S(≥12) / A(8–11) / B(≤7) 级。
3. 用学前测试、经验复盘、能力对标三种方式识别薄弱项（≥2 个），设定达标阈值。
4. 制定验收标准与周测/月考/终期节点，写明未达标的补学规则。

### Phase 2 · 学习资源准备

1. 选定 1 本核心主教材 + 2–3 本辅助资料，核对版本时效与勘误。
2. 配齐练习题：每知识点 ≥10 题（基础:进阶:综合 = 5:3:2），应试类收近 5 年真题，技能类收 ≥15 个实操任务；建立错题本规范。
3. 汇总课程/笔记/案例库拓展资源，标注讲师资质与场景覆盖度。
4. 盘点平台工具（专注计时、任务管理、进度追踪、笔记、思维导图）与学习环境（硬件、免打扰、固定地点）。

### Phase 3 · 学习计划制定

1. 完成目标—现状评估：总/阶段目标量化，短板排序，盘点固定与碎片化时间。
2. 搭建计划框架：按 S/A/B 级分配时间占比（S 30–40% / A 20–30% / B 10–20%），基础时间分新学 40% · 练习 30% · 复习 20% · 模考 10%。
3. 设复习与考核节点：按艾宾浩斯设当日/次日/周/月复习；周测/月考/模块考/模拟考四级，写明达标线（周测 ≥70%、月考 ≥75%）与未达标补学（1.5 倍专项）。

### Phase 4 · 学习计划可视化展示

1. 周期日程：月拆周、周拆日，任务量偏差 ≤10%；高难任务排精力高峰，低难排低谷；每周留 1 天休息 + 2–3 小时弹性。
2. 日时段与碎片化：黄金时段深度学，次优时段练题，低精力时段刷题/听音频；碎片化按 10 分钟内 / 10–30 分钟 / 30 分钟以上配任务。
3. 生成甘特图核心内容（全局进度 + 里程碑 + 偏差预警）与辅助视图（日历、数据看板）。
4. 写清弹性调整机制：临时任务优先级、进度滞后补学（分级）、休息与调整周期。

### Phase 5 · 学习跟进计划

1. 打卡机制：4 要素（时长/完成任务/未完成及原因/收获），当日 10 分钟内完成，设阶梯激励与中断约束。
2. 进度追踪：周复盘 4 维度 + 方法迭代，月度成果总结（完成率分级、原因三维分析）。
3. 薄弱项专项突破：四步法（重学+专项练+错题复盘+同类题），≥20 题、≥2 小时、专项测试 ≥85%。
4. 动态调整规则：写明触发条件、调整优先级与幅度、效果验证标准。

## Output Shape

Use `assets/plan-template.md`. Deliver all five artifacts:

1. 需求确认表 — 目标/诉求/成果/基础/时间/约束.
2. 资源清单 — 教材、题库、拓展、工具、环境.
3. 计划框架表 — 模块优先级与时间占比、阶段目标、复习考核节点.
4. 可视化说明 — 甘特图全局视图 + 里程碑 + 日历/看板 要素.
5. 跟进机制 — 打卡、复盘、专项突破、动态调整规则.

## Constraints

- 所有量化阈值（85% / 80% / 艾宾浩斯节点 / 优先级评分 / 时间占比）须取自 `references/学习全流程规划大纲.md`。
- 指标须满足 SMART，禁止「掌握/熟悉」等模糊表述。
- 每个阶段目标须可追溯到具体模块与时间分配；技能类目标须给可量化实操判据。
- 输出用中文，结构清晰，可直接执行。

## References

- `references/学习全流程规划大纲.md` — 五阶段完整流程规范与全部量化阈值（权威来源）.
- `references/taxonomy-guide.md` — 可选：本仓 `技能分类/` 技能图谱，用于把目标映射到具体技能节点（族/项）.
- `scripts/validate-plan.js` — 可选：校验计划是否覆盖五个阶段及引用是否可追溯.
