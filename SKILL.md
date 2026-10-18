---
name: md-doc-optimizer
description: Audit and optimize project Markdown documents — remove redundant or duplicated content, delete stale or invalid statements, and correct text that contradicts the code, commands, links, versions, or facts. Use when the user asks to clean up, prune, de-duplicate, refresh, or fact-check README, docs, or any .md files. Always verify against real evidence (code, git history, run commands) before rewriting; never beautify or invent content without proof.
license: MIT
metadata:
  author: f-e-n-g-0531
  version: "1.8.0"
---

# Markdown 文档优化器

审计并优化项目 Markdown 文档，专注三件事：**去冗余**、**删过期/失效**、**纠事实不符**。产出「最小 diff + 可核对报告」；没有问题时明确输出 NO_ISSUES，绝不为了显得做了事而改写。

## 何时使用 / 何时不使用

**使用**（满足其一）：
- 用户要求清理、瘦身、去重、刷新、清理过时内容、核对文档。
- 目标对象是 README、docs/ 目录、*.md 文件或某个文档集。
- 需要把文档与当前代码/命令/链接/版本对齐。

**不使用**：
- 纯润色但无内容问题、营销文案打磨。
- 要求从零重写某篇长文。
- 需要产品决策的问题（如「某功能是否应废弃」）——这类只报 issue，不改文。

## 核心原则

1. **证据优先**：每处删改都能指向可复现证据——代码文件与 git 历史、实际执行的命令输出、可解析的链接、官方/权威来源。禁止凭记忆或语感判「过时/错误」。
2. **只减不增、只纠不改义**：默认做减法（删冗余/删失效）与纠错（错字/错命令/错链接/错版本），不扩写、不润色、不重排结构，除非用户明确要求。
3. **语义保真**：不删除仍有效、仍被引用、或有决策价值的信息。「冗余」= 同一信息多处重复；「过时」= 有证据证明已失效。
4. **机械可修 vs 人工确认**：能机械证明的（链接 404、文件不存在、命令跑不通、拼写/格式错误）直接改；语义模糊的（功能是否已废弃、数字是否更新）标 NEEDS_HUMAN 并附证据。
5. **Guard Clauses**：无 .md 文件 → NO_DOCS；无可优化项 → NO_ISSUES；信息不足以判定 → 先提问或标 NEEDS_HUMAN，不脑补。

## 安全与幂等（先保护，再优化）

- **改动前留底**：确认 `git status` 干净，或先建分支/提交；大仓库分批处理，维护「已处理文件」清单，避免重复或漏审。
- **只改证据点**：每次 edit 只针对已核实的行；改完用 `git diff --stat` 复核改动面，确认没有夹带无关改动。
- **幂等验收**：完成后重跑同一套检查（lint / 链接 / 示例），应无新增问题；再跑一遍审计应得到 NO_ISSUES。
- **可回滚**：整节/整文件删除前，先确认没有入链引用（全仓库 grep 标题与文件名）。

## 判断边界：什么不该改

「证据优先」也意味着：证据不足或不该动的地方，保持原样。

- **生成物**：docs 由代码/脚本/schema 生成时（找 `docs:*` / `prepublish` 等生成脚本、Makefile、CI 生成步骤），改源文件后重新生成，不改产物；生成物与源文件不一致，按漂移报告。
- **测试夹具与示例数据**：test/、fixtures/ 等位置被测试引用的 Markdown，里面故意写坏的链接、命令、TODO 是测试内容本身，不修。
- **有意的重复**：多平台安装命令、不同场景的示例、CLI help 与文档的同步内容，重复但各自必要，不算冗余。
- **历史与变更记录**：CHANGELOG、迁移指南、旧版本文档、deprecation 说明——「过时」是它们的职责，不删。
- **法律/合规文本**：LICENSE、隐私政策、安全声明、许可证声明，只报不改。
- **演示性「错误」**：示例里故意写错的命令或输出（用来对比正误）是内容本身，不是待修错误。
- **外部权威来源**：文档与代码冲突但文档对齐官方规范/产品决策时，标 DUBIOUS 说明分歧，不强行改成代码的样子。
- **计划中的内容**：明确标注为规划、路线图、预览的内容，按「计划」而非「过期」处理。
- **无法复核的断言**：无法用代码/运行/权威来源证明的结论，标 NEEDS_HUMAN，不凭语感删。

## 三大优化目标

### 目标 A —— 去冗余（Deduplicate）

信号：
- 同义段落/说明在文档内多处重复；多篇文档互相拷贝同样内容（README 与 docs 重复）。
- 重复标题（同层级同名，对应 markdownlint MD024）。
- 同一链接多次出现且无必要（合并或集中到一处/页脚）。
- 未使用的引用定义（`[label]: url`）或重复定义的引用标签。
- 口水词、套话、无信息量修饰（「非常简单」「只需轻松几步」「众所周知」）。
- 冗余限定：「可能」「大概」「基本上」叠加；重复加粗+斜体；同一语义的长短两版并存。

处理：保留最准确/最权威的一处，其余删除，或在重复处指回唯一出处。

### 目标 B —— 删除过期 / 失效（Stale）

信号：
- 时间敏感表述已过期：「目前/最近/近期」「将于 X 上线」「过去三年」「自 2023 年起」，需按当前日期核对。
- 指向不存在的文件/目录/脚本/工作流/命令/flag/env；链接 404 或跳到无关页。
- 本地图片失效、空链接目标（`[]()`）、引用标签未定义（`[text][label]` 渲染成字面文本）。
- 引用的版本、依赖、API 端点、配置键已改名或删除。
- TODO/FIXME/占位残留：「待补充」「coming soon」「TBD」且早已发布。
- 描述的行为与当前工具/代码实际输出不一致（示例命令跑不通）。

处理：删除，或改为当前真实值；无法确认现状时标 NEEDS_HUMAN。

### 目标 C —— 修正与事实不符（Factual mismatch）

信号：
- 文档陈述与代码/配置/git 历史矛盾（参数名、默认值、返回结构、路径、版本号）。
- 示例代码/输出与可运行结果不一致（mdoctest 复跑并核对输出；markdown-doctest 只验证 JS 示例不抛异常）。
- 数字、时区、日期、拼写、术语、产品名、链接文本与链接目标不匹配。
- 断言性结论缺乏依据或与权威来源冲突。

处理：改成与证据一致；证据不足时标 DUBIOUS 并说明，不臆断。

## 语言专项规则（中文 / 英文）

英文工具（Vale / write-good / cspell）抓不到中文特有的标点、全半角、中英空格与译名问题。审计中文文档时额外套用 references/cjk-doc-rules.md：标点与空格、冗余套话、时间敏感表述、术语一致性、排版与链接细节。

审计英文文档时套用 references/english-docs.md：英文冗余套话、相对时间表述、术语与大小写一致性、示例输出核对，以及 Vale / write-good / alex 的结果如何判断（只当候选清单，不盲改）。

## 工作流（5 阶段）

### P1 范围与清单
1. 确定对象：单文件 / 目录 / 全仓库；列出相关「事实来源」——代码、配置、脚本、CI、生成物。
2. 盘点文档列表与彼此引用关系（哪个 README 引哪个 docs、是否有重复内容）。

### P2 收集证据（并行做，别靠记忆）
- 读代码/配置/git 历史（git log -p、git blame）。
- 逐条解析链接并探测（lychee / markdown-link-check / 直接请求）。
- 实际运行命令/示例（能跑则跑；跑不了的记录 run-failed 作为证据）。
- 核对版本与日期（package.json / requirements / CHANGELOG / 发布记录）。
- 先跑内置预扫脚本生成候选清单：`node scripts/pre-scan.mjs <目标目录>`（本地死链/锚点、失效图片、空目标、引用式链接与未使用/重复定义、跨平台大小写路径、疑似默认分支链接、时间敏感词、占位标记、重复标题/段落、疑似生成副本等）；输出是候选，不是结论。
- 再用 markdownlint、Vale、mdoctest 补充结构/文风/示例候选；所有预扫输出都当作「待核对清单」，不作为最终结论。

### P3 逐条核对与分级
每处疑似问题标注：文件路径 + 行号 → 类别(A/B/C) → 严重度 → 处置。

严重度：
- **Critical**：误导用户做错误操作、安全/金钱相关事实错误、失效主链接、不可跑的核心命令。
- **High**：事实矛盾、过时版本/命令、关键段落重复。
- **Medium**：冗余表达、失效次要链接、陈旧示例。
- **Low**：口水词、风格性重复、格式不一致。

处置：Critical/High 直接改；Medium 改或标注；Low 仅在用户要求「彻底」时处理。

### P4 最小 diff 改写
- 用 edit 做针对性替换，不做整篇重写；保留原信息顺序与结构。
- 删除前先在报告列出证据；改正给出「原句 → 新句 → 依据」。
- 不确定的标 NEEDS_HUMAN，绝不静默改成自己猜的值。

### P5 验收与复验
- diff 只含删除/修正，不夹带无关改动。
- 复跑链接检查与代码块执行，确认没引入新失效。
- 就地自检（见「最小自检清单」）。

## 输出格式（报告模板）

每处改动一行/一表：
| 文件:行 | 类别(A/B/C) | 严重度 | 原内容摘要 | 动作(删/改/标注) | 证据 |

外加三段汇总：Fixed（已改）、Needs review（已标 NEEDS_HUMAN）、No action（判定无需改）。
最后一句结论：共审查 N 处，改 M 处，留待人工 K 处。

无问题时只返回：NO_ISSUES + 一句说明。

需要被 CI 或脚本消费时，追加一个机器可读 JSON 块（与 references/report.schema.json 一致）：

~~~json
{"summary": {"files_audited": 0, "examined": 0, "fixed": 0, "needs_human": 0, "no_action": 0}, "findings": []}
~~~

字段定义、JSON Schema、校验命令与 PR/commit 模板见 references/reporting.md。

## 报告模式（只报告不改）

用户说「先出报告 / 不要改文件 / 只审查」时：

- 只做 P1–P3，输出完整问题清单与建议 diff，不执行任何写操作。
- 每条给「文件:行 + 类别 + 严重度 + 建议动作 + 证据」，可直接转为 issue 或 PR。
- 结尾同样给汇总与结论；无问题时返回 NO_ISSUES。
- 用户确认建议 diff 后，按 references/reporting.md「报告落地」流程逐条应用并复验。

## 工具编排（详见 references/tool-configs.md）

| 目标 | 工具 | 作用 |
|---|---|---|
| 候选预扫 | scripts/pre-scan.mjs | 本地死链/图片/锚点、空目标、引用式链接与未使用/重复定义、跨平台大小写路径、硬编码 master 链接、时间词、占位标记、重复标题/段落、疑似生成副本；只报候选 |
| 结构去重 | markdownlint / remark-lint | MD024 重复标题、MD025 多 H1、未使用定义等 |
| 文风/冗余 | Vale + write-good/proselint/alex | 口水词、被动语态、客套、歧视用语 |
| 链接失效 | lychee、markdown-link-check | 找 404/死链/锚点失效 |
| 拼写 | cspell / typos | 拼写与错词 |
| 中文专项 | zhlint / lint-md / pangu | 中文标点全半角、中英空格、术语 |
| 文档↔代码一致 | docproof / mdoctest / Redocly respect | 核对路径/命令/版本、复跑示例 |

这些是可选自动化预扫；结论永远以「读到的证据 + 运行结果」为准。

## 触发判定（Evaluation prompts）

应触发：清理仓库 MD 里过时和重复的内容；把 README 与当前代码对齐；检查 docs 里失效的链接和命令；优化项目文档去冗余。

不应触发：润色这篇文案；写一篇新教程；这个函数有没有 bug。

## 最小自检清单

- 每处删改都有可复现证据，没有「我觉得/可能」式结论？
- 只动了冗余/失效/错误三类，没有顺手扩写或重排？
- 需要人工确认的都已显式标 NEEDS_HUMAN，而非静默猜测？
- 复验过链接与示例代码？
- 无问题时是否如实返回 NO_ISSUES？

## 深入阅读
- references/audit-checklist.md —— 逐目标打勾清单
- references/cjk-doc-rules.md —— 中文标点/空格/术语专项规则
- references/english-docs.md —— 英文文档专项规则（含 Vale/write-good 结果判断）
- references/reporting.md —— 报告字段、JSON 契约、PR/commit 模板
- references/report.schema.json —— 报告 JSON Schema（CI 校验用）
- references/sources.md —— 同领域项目/工具与出处
- references/tool-configs.md —— 现成工具配置
- references/drift-playbook.md —— 文档 vs 代码漂移核对
- references/prompting-templates.md —— 可复用提示词
- examples/case-study-docproof.md、examples/case-study-zhlint.md —— 真实仓库审计实测（报告模式，含建议 diff 与判定边界）
