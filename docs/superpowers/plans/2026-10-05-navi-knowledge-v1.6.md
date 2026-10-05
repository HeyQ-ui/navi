# Navi 知识库 v1.6：七条路径内容补齐 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把七条版素材里新增的两条就业路径（本学科就业、跨学科就业）写进知识库，并把通用知识的误区扩到 7 条、两张对比表扩到七条路径。

**Architecture:** **本轮不写任何生产代码。** v1.5 已落地 `bundle.common` 字段、`guide` / `risk` / `compare` 块类型、`formatBlocks` / `formatCommon`；这轮只填内容并同步测试断言。两条就业路径的 `myth` 按用户决定移除（与新第 7 条通用误区重复），块序列随之变成 `timeline → guide → cost → risk`。

**Tech Stack:** TypeScript · pnpm workspace · vitest（仅测试改动）

**Spec:** `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`（v1.6，§6.3 块级契约、§6.1 通用知识层）

**素材：** `docs/中国本科生七条发展路径（精华版）：学期时间线、新生误区、差异、风险与局限.docx`
提取命令：
```
python -c "import docx; d=docx.Document('docs/中国本科生七条发展路径（精华版）：学期时间线、新生误区、差异、风险与局限.docx'); [print(p.text) for p in d.paragraphs]"
python -c "import docx; d=docx.Document('docs/中国本科生七条发展路径（精华版）：学期时间线、新生误区、差异、风险与局限.docx'); [print(f'--{i}--',*[' | '.join(c.text for c in r.cells) for r in t.rows],sep='\n') for i,t in enumerate(d.tables)]"
```

---

## Global Constraints

- **推荐结果必须由 `core` 的确定性算法得出**。本轮不改 `weights`、`eligibility`、题目——**黄金案例集无需同步**（硬性约束 5 的触发条件不成立）。
- **知识库内容不得编造。** 两条路径保持 `status: draft`（硬性约束 2）。
- **素材里的文献引用一律不进知识库**，但**数值保留原数**（用户已决定：对口率 56% / 11.7%、工资效应 5% / 15%、理科生低约 30%、领域错配约 40%、高能低配约 46% 等）。
- **术语统一为「本学科 / 跨学科」**，只作用于**跨度词**（`本专业` → `本学科`、`跨专业` → `跨学科`）。`专业课`、`专业基础课`、`专业名称`、`转专业政策` 属另一层含义的固定说法，**不动**——把「专业课」改成「学科课」是错的中文。
- **`@block` 注解与 `:::` 容器标记不得进入产物与模型上下文**（§6.3 第 4 条）。
- **七条路径的时间线一律只放「学期 · 节点」**，行动建议进 `guide`（v1.5 定型）。
- 提交信息用中文，Conventional Commits。每个 Task 结束 `pnpm test` 与 `pnpm lint` 都要绿。

---

## Review Focus

按「最可能先咬到人」排序，每条在对应 Task 里有测试钉住：

1. **`cross-discipline-job` 的时间线多一行「毕业后择业期」** —— 这是首条跨出大四的时间线节点。`timeline` 块与 §9.6 的时间轴组件按 bullet 逐条渲染，多这一行不应打断解析或丢内容（Task 3）。
2. **两条就业路径移除 `myth` 后，`myth` 不再是每条路径的必备块** —— `BlockRenderer` 与 `formatBlocks` 都不能假设某个类型存在（Task 2、Task 3）。
3. **对比表从 5 列/5 行扩到 7 列/7 行** —— Markdown 表格的行列数变了，容器解析仍须把整表收进一个块的 `raw`，且不把 `|---|` 误认成容器边界（Task 1）。
4. **`common.md` 里那句「本表覆盖五条…就业未纳入对比」必须删掉** —— 留着就是一句事实错误，而 §8.3 要求模型只能依据上下文里的信息（Task 1）。
5. **新增的第 7 条误区与两条路径的 `myth` 内容重合** —— 移除 `myth` 后要确认通用版确实还在，否则这条信息就从库里消失了（Task 1 的 myth 计数断言 + Task 2/3 的块序列断言合起来覆盖）。

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/knowledge/common.md` | 误区 6→7 条；差异对比表 5→7 路径；风险对比表 5→7 行；删掉过期的覆盖范围声明 | 修改 |
| `packages/knowledge/paths/same-discipline-job/index.md` | `summary` / `timeline` / `guide` / `risk`；移除 `myth` | 修改 |
| `packages/knowledge/paths/cross-discipline-job/index.md` | 同上，时间线含「毕业后择业期」 | 修改 |
| `packages/knowledge/src/build.test.ts` | 断言同步：common 的 myth 数、对比表覆盖、两条路径块序列；删除一条已失效的 v1.5 断言 | 修改 |

**不动**：其余 5 条路径（表 0–4 与上一轮逐行一致）、`src/` 下任何生产代码、`boundaries.md`。

---

### Task 0: 建分支

- [ ] **Step 1: 从 main 切出特性分支**

```bash
git checkout -b feat/knowledge-v1.6
```

预期：`Switched to a new branch 'feat/knowledge-v1.6'`。

---

### Task 1: `common.md` 扩到七条路径

**Files:**
- Modify: `packages/knowledge/common.md`
- Modify: `packages/knowledge/src/build.test.ts`

**Interfaces:**
- Consumes: v1.5 已落地的 `parseContainers` 编译路径
- Produces: 9 个块 —— 7 个 `myth` + 2 个 `compare`

- [ ] **Step 1: 写失败的测试**

在 `build.test.ts` 的「通用知识（设计文档 §6.1 v1.5）」describe 里：

把 myth 计数从 6 改为 7：

```ts
    expect(blocks.filter(b => b.type === 'myth')).toHaveLength(7)
```

**同时删掉这一整条测试**（它断言的是 v1.5 的一项属性，v1.6 有意推翻，留着会让 Task 2 起每个 Task 都为错误的理由变红）：

```ts
  it('两条就业路径本计划不动，仍只有它们原有的块', () => { ... })
```

再追加两条：

```ts
  it('对比表覆盖全部七条路径，不再声明「就业未纳入对比」', () => {
    const [diff] = buildKnowledge().common.filter(b => b.type === 'compare')
    for (const title of [
      '本学科保研', '本学科考研', '跨学科保研', '跨学科考研', '考公考编', '本学科就业', '跨学科就业',
    ]) {
      expect(diff!.raw, title).toContain(title)
    }
    expect(diff!.raw).not.toContain('未纳入对比')
  })

  it('第 7 条误区是「就业准备误区」，与两条路径移除的 myth 内容对应', () => {
    const myths = buildKnowledge().common.filter(b => b.type === 'myth')
    expect(myths.map(b => b.title)).toContain('就业准备误区')
    const block = myths.find(b => b.title === '就业准备误区')!
    expect(block.raw).toContain('找工作是大四的事')
    expect(block.raw).toContain('专业不对口')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
预期：FAIL —— myth 数为 6；`就业准备误区` 不存在。

- [ ] **Step 3: 追加第 7 条误区**

`common.md` 里「外部动机过早主导」块之后追加：

```markdown
:::myth 就业准备误区
以为「找工作是大四的事」，忽视大二大三实习与可转正实习的前置价值；或把「专业不对口」
简单等同于「无法就业」，忽视可迁移能力的培养。
:::
```

- [ ] **Step 4: 差异对比表扩到 7 列**

标题行与分隔行改为：

```markdown
| 对比维度 | 本学科保研 | 本学科考研 | 跨学科保研 | 跨学科考研 | 考公考编 | 本学科就业 | 跨学科就业 |
|---|---|---|---|---|---|---|---|
```

五行数据各**在行尾追加两格**（原有五格逐字不动）：

```markdown
| 竞争性质 | 申请考核、名额制 | 开放统考、分数线 | 申请考核、证据门槛高 | 开放统考、复试加试 | 多场次，选调为封闭赛道 | 开放校招、双向选择 | 开放校招、跨行业筛选 |
| 准备周期 | 前三年长期积分 | 约 10–12 个月 | 前三年 + 跨学科证据 | 约 10–12 个月，专业课更重 | 数月至一年，可滚动 | 数月至一年、实习前置 | 一年以上、补技能加实习 |
| 核心能力信号 | 绩点排名、科研、英语 | 初试分数、复试表现 | 本学科绩点 + 目标学科证据 | 初试分数、跨学科能力证明 | 行测申论、政治面貌、岗位匹配 | 专业技能、实习、项目 | 可迁移能力、目标行业实习/证书 |
| 决战时点 | 大三暑假夏令营 | 大四上 12 月初试 | 大三暑假夏令营 | 大四上 12 月初试 | 大四上 11 月底起多批次 | 大四上 9-12 月秋招 | 大四上秋招、准备更早 |
| 结果确定性 | 获优秀营员后较高 | 初试后仍需复试 | 受跨学科证据影响 | 复试调剂不确定性高 | 单次命中率低、可再战 | 签约后即确定、出结果最早 | 不确定性高、可春招再战 |
```

- [ ] **Step 5: 删掉过期的覆盖范围声明**

删掉这两行（它现在是事实错误）：

```markdown
本表覆盖五条升学与体制内路径。本科就业的两条路径（本学科就业、跨学科就业）暂无同源材料，
未纳入对比——不补，也不推测。
```

保留它上面的「几条路径的核心差异可以这样看：……」（素材该段未改，已是跨学科口径）。

- [ ] **Step 6: 风险对比表扩到 7 行**

标题「五条路径风险对比」改为「七条路径风险对比」，并在末尾追加两行：

```markdown
| 本学科就业 | 对口率有限、起薪落差、校招与升学冲突 | 秋招 11-12 月出结果，春招 2-5 月补录 |
| 跨学科就业 | 转行成本、高能低配、证据不足 | 可滚动求职，利用 2 年（部分 3 年）择业期 |
```

同时把「五条路径差异对比」标题改为「七条路径差异对比」。

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
预期：PASS。

- [ ] **Step 8: 提交**

```bash
git add packages/knowledge/common.md packages/knowledge/src/build.test.ts
git commit -m "feat(knowledge): 通用知识扩到七条路径，补就业准备误区"
```

---

### Task 2: `same-discipline-job` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/same-discipline-job/index.md`
- Modify: `packages/knowledge/src/build.test.ts`

**素材来源：** docx「（六）本专业本科就业」第二段（→ `summary`）、风险段（→ `risk`）、表 5（→ `timeline` + `guide`）、表 8 第 6 行。

**块序为 `timeline → guide → cost → risk`** —— 该路径的 `myth` 按用户决定移除。`cost` 正文逐字保留。

- [ ] **Step 1: 写失败的测试**

在 `build.test.ts` 的「路径文档的块结构」describe 里追加：

```ts
  it('本学科就业：timeline / guide / cost / risk，且已无 myth（v1.6）', () => {
    const blocks = buildKnowledge().blocks['same-discipline-job']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'cost', 'risk'])
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
预期：FAIL —— 实际为 `['timeline', 'myth', 'cost']`。

- [ ] **Step 3: 换 `summary`**

```yaml
summary: >
  本学科就业走的是校园招聘，秋招是主战场，春招只做补录，决战就在大四上学期。但准备
  要往前放很多：大二、大三的实习，尤其是大三暑假那段有机会转正的实习，往往决定最后
  能不能拿到 offer。生涯规划研究大多主张分阶段来，大一先做职业意识启蒙，大二大三侧重
  职业探索和定向，大四再集中择业。
```

- [ ] **Step 4: 换 `timeline`，新增 `guide`**

```markdown
<!-- @block type="timeline" -->
## 本学科就业时间线

- **大一上** 入学；职业意识启蒙
- **大一下** 职业测评、行业认知
- **大二上** 第一份实践或实习
- **大二下** 专业技能、项目作品
- **大三上** 暑期实习招聘提前启动
- **大三下 · 3-8月** 暑期实习投递与实习（关键）
- **大四上 · 8-12月** 秋招：网申、金九银十、签约（决战）
- **大四下 · 2-5月** 春招；三方与劳动合同

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一上** 了解本学科就业方向与典型岗位；过四级；参加职业规划课
- **大一下** 做职业兴趣测评；参加行业讲座或企业开放日；初步探索兴趣
- **大二上** 争取寒假短期实习或社会实践，了解真实职场与岗位要求
- **大二下** 学好核心专业课；积累课程项目或作品集；暑假争取专业相关实习
- **大三上** 完善简历、明确目标岗位；为大三下 3-5 月投递暑期实习做准备
- **大三下** 3-5 月投递暑期实习；6-8 月实习并争取转正 offer；关注提前批（6-8 月）
- **大四上** 8-12 月密集网申、笔试、面试；多渠道投递；11-12 月争取并确认 offer
- **大四下** 未落实者参加春招（春节后启动、3-5 月攻坚）；签订三方与劳动合同，办理档案户口
:::
```

- [ ] **Step 5: 移除 `myth`，在 `cost` 后追加 `risk`**

删掉整个 `myth` 块（含 `<!-- @block type="myth" -->` 注解与 `:::myth … :::` 容器）。`cost` 块原样保留。之后追加：

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **对口率有限**：专业对口率约 56%，其中约三分之一属于专业不匹配、11.7% 毫不相关；对口就业对工作满意度有稳定的正向作用
- **起薪差异大**：对口就业的起薪工资效应约 5%，经济学类能到 15%，效应在不同学科与行业之间差别很大
- **与升学正面撞车**：校招不断提前，秋招与考研（12 月）、考公（11 月底）在大四上学期撞上
- **三方协议不等于劳动合同**：它只是就业意向，违约时可能要付违约金
- **择业期口径不一**：本科择业期通常 2 年、部分省份放宽到 3 年，但考公、事业单位与企业校招对社保的认定口径并不一致
- **心态准备**：可能遇到高能低配（约 46%）与起薪落差
- **时间窗口**：秋招 11-12 月出结果，春招 2-5 月补录
:::
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
预期：PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/knowledge/paths/same-discipline-job/index.md packages/knowledge/src/build.test.ts
git commit -m "feat(knowledge): 本学科就业补齐摘要、时间线、行动指南与风险"
```

---

### Task 3: `cross-discipline-job` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/cross-discipline-job/index.md`
- Modify: `packages/knowledge/src/build.test.ts`

**素材来源：** docx「（七）跨专业本科就业」第二段（→ `summary`）、风险段（→ `risk`）、表 6（→ `timeline` + `guide`）、表 8 第 7 行。

- [ ] **Step 1: 写失败的测试**

```ts
  it('跨学科就业：timeline / guide / cost / risk，且已无 myth（v1.6）', () => {
    const blocks = buildKnowledge().blocks['cross-discipline-job']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'cost', 'risk'])
  })

  it('跨学科就业的时间线延伸到择业期，多这一行不丢内容（Review Focus 1）', () => {
    const timeline = buildKnowledge().blocks['cross-discipline-job']!
      .find(b => b.type === 'timeline')!
    expect(timeline.raw).toContain('毕业后')
    expect(timeline.raw).toContain('择业期')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
预期：FAIL —— 实际为 `['timeline', 'myth', 'cost']`；timeline 里没有「择业期」。

- [ ] **Step 3: 换 `summary`**

```yaml
summary: >
  跨学科就业，也就是常说的「转行」，指不读研、毕业后直接进入和本学科不相关的行业或
  岗位。跨国证据显示，约 40% 的劳动者在自身资格层级上存在领域错配。能不能转成功，
  主要看技能能否迁移、目标领域是否已经饱和，光有转行的意愿并不够。
```

- [ ] **Step 4: 换 `timeline`，新增 `guide`**

```markdown
<!-- @block type="timeline" -->
## 跨学科就业时间线

- **大一** 广泛探索、通识
- **大二** 锁定目标行业、补技能
- **大二暑假** 第一份目标行业实习
- **大三上** 技能证书、项目作品
- **大三下 · 3-8月** 暑期实习投递与实习（关键）
- **大四上 · 6-12月** 提前批与秋招（决战）
- **大四下 · 2-5月** 春招补录
- **毕业后** 择业期（2 年，部分 3 年）

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一** 广泛了解行业与岗位；保持高绩点；过四级；用通识或选修课试探方向
- **大二** 确定意向转行方向；系统自学或选修目标领域核心课程，考取入门证书
- **大二暑假** 争取目标行业实习（构建跨学科证据最关键的一步）
- **大三上** 考取目标行业认可的证书；积累可展示的项目或作品，形成证据链
- **大三下** 3-5 月投递、6-8 月实习并争取转正；简历突出可迁移能力
- **大四上** 跨行业密集网申、笔试、面试；用实习与项目证明能力，争取 offer
- **大四下** 参加春招；必要时以实习或项目缓冲后再求职，避免盲目签约
- **毕业后** 利用择业期应届身份继续求职或参加考公考编；注意社保对应届身份的影响
:::
```

- [ ] **Step 5: 移除 `myth`，在 `cost` 后追加 `risk`**

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **工资惩罚要看情况**：理科生从事不相关的工作，工资大约低 30%；但单纯的领域错配、不伴随过度教育时惩罚有限，错配再叠加资格过剩才会明显受损
- **证据不足会被直接筛掉**：跨学科证据不够，网申很容易在第一轮就被刷
- **落实工作更慢**：自己摸索着找实习的人，往往要到毕业 3-6 个月后才落实全职工作
- **一次性成本**：转行要付技能与信息成本，高能低配的风险也更高
- **手续问题**：三方协议、应届身份与社保的认定，要提前弄清楚
- **时间窗口**：可滚动求职，利用 2 年（部分 3 年）择业期——但考公、事业单位与企业校招对社保的口径并不一致
:::
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
预期：PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/knowledge/paths/cross-discipline-job/index.md packages/knowledge/src/build.test.ts
git commit -m "feat(knowledge): 跨学科就业补齐摘要、时间线、行动指南与风险"
```

---

### Task 4: 全量验收

**Files:** 无（只跑验证）

- [ ] **Step 1: 跑三条命令**

Run: `pnpm build && pnpm lint && pnpm test`
预期：三条全 0，全部测试通过。

- [ ] **Step 2: 目视检查产物**

```bash
node -e "
const b=require('./packages/knowledge/dist/knowledge.json');
console.log('common:', b.common.length, '| myth:', b.common.filter(x=>x.type==='myth').length);
for (const [id, bl] of Object.entries(b.blocks)) console.log(id.padEnd(24), bl.map(x=>x.type).join(','));
const leak=[...b.common,...b.boundaries,...Object.values(b.blocks).flat()].filter(x=>x.raw.includes(':::')||x.html.includes(':::'));
console.log('::: 泄漏:', leak.length);
"
```

预期：

```
common: 9 | myth: 7
civil-service            timeline,guide,myth,cost,risk
cross-discipline-baoyan  timeline,guide,myth,myth,risk
cross-discipline-job     timeline,guide,cost,risk
cross-discipline-kaoyan  timeline,guide,myth,cost,risk
same-discipline-baoyan   timeline,guide,myth,cost,risk
same-discipline-job      timeline,guide,cost,risk
same-discipline-kaoyan   timeline,guide,myth,cost,risk
::: 泄漏: 0
```

- [ ] **Step 3: 确认对比表覆盖七条路径**

```bash
node -e "
const b=require('./packages/knowledge/dist/knowledge.json');
for (const t of b.common.filter(x=>x.type==='compare')) {
  console.log(t.title, '→', (t.raw.match(/^\|/gm)||[]).length, '行');
}
"
```

预期：以 `|` 开头的行数，差异对比表为 **7**（表头 + 分隔行 + 5 个维度行），风险对比表为 **9**（表头 + 分隔行 + 7 条路径行）。人工确认差异对比表的表头含七个路径名，且 `raw` 里不含「未纳入对比」。

---

## Self-Review

**Spec 覆盖**

| Spec 要求 | 落点 |
|---|---|
| §6.1 `common.md` 承载通用知识（含多路径对比） | Task 1 |
| §6.3 块类型开放、`guide` / `risk` 语义 | Task 2、Task 3 |
| §6.3 第 2 条「不强制字段」——某条路径可以没有 `myth` | Task 2、Task 3 的块序列断言 |
| §6.3 第 4 条标记不外泄 | Task 4 的产物检查 |
| v1.6 摘要「两条就业路径的 `myth` 移除」 | Task 2、Task 3 Step 5 |
| §8.3 模型只能依据上下文——过期的覆盖声明必须删 | Task 1 Step 5 |

**类型一致性**

- 块类型字符串全程为 `timeline` / `guide` / `myth` / `cost` / `risk` / `compare`，无别名
- 无新增函数或字段，`KnowledgeBundle` 不变

**已知取舍**

- 第 7 条通用误区与两条路径移除的 `myth` 内容对应：删掉路径版后，通用版是这条信息在库里唯一的落点。Task 1 的「就业准备误区」断言与 Task 2/3 的块序列断言合起来把这个不变量钉住。
- 就业路径的风险段数值来自单一文献、无法核实，按用户决定保留原数并去掉引用；文件保持 `status: draft`。
