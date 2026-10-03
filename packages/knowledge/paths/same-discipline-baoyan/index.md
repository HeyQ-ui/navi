---
id: same-discipline-baoyan
title: 本学科保研
category: academic
span: same-discipline
status: draft
updated: 2026-10
summary: >
  保研的实质是用前五学期的绩点排名换取免试攻读研究生的资格。它是一条时间窗口最紧、
  可逆性最差的路：一旦进入大四上学期的正式推免流程，几乎没有回头余地。绩点排名只是
  入场券，科研、英语、竞赛加分项在很多学校能直接改写最终结果。
weights:
  - { indicator: academic-interest, weight: 0.25, ideal: 85 }
  - { indicator: grad-intention-baoyan, weight: 0.35, ideal: 100 }
  - { indicator: discipline-identity, weight: 0.15, ideal: 80 }
  - { indicator: cost-tolerance, weight: 0.15, ideal: 60 }
  - { indicator: risk-preference, weight: 0.10, ideal: 75 }
eligibility:
  - id: has-tuimian-quota
    questionId: eligibility-tuimian-quota
    severity: hard
    failMessage: 你的学校没有推免资格，这条路对你当前不成立
    passWhen: [0, 3]
---

<!-- @block type="timeline" -->
## 保研时间线

- **大三上 · 9月** 前 5 学期绩点排名公示
- **大三下 · 6-7月** 夏令营投递，黄金窗口，多数人在此阶段定局
- **大四上 · 9月** 推免系统开放、预推免、正式推免

<!-- @block type="myth" -->
:::myth 排名前 10% 就稳了
绩点只是入场券。科研经历、英语、竞赛加分项在很多学校能直接改写排名结果。
:::

<!-- @block type="cost" -->
:::cost 选择保研，需要放弃
- 大三暑期无法参加实习，那是秋招的关键积累期
- 考研备选窗口极短，10 月才决定风险很高
:::
