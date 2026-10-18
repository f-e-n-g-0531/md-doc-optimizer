<div align="center">

# md-doc-optimizer

**Audit & optimize Markdown documentation — remove redundancy, remove staleness, fix the facts.**

一个用于**审计并优化项目 Markdown 文档**的 Agent Skill：**去冗余 · 删过期失效 · 纠事实不符**。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Format: SKILL.md](https://img.shields.io/badge/format-SKILL.md-orange)](./SKILL.md)
[![CI](https://github.com/f-e-n-g-0531/md-doc-optimizer/actions/workflows/docs-qa.yml/badge.svg)](https://github.com/f-e-n-g-0531/md-doc-optimizer/actions/workflows/docs-qa.yml)

</div>

## 这是什么

md-doc-optimizer 是一个「文档瘦身 + 事实核对」的可复用 Agent 技能。它不写新内容，只做三件事：

1. **去冗余** —— 删除重复段落/标题/链接、口水词、跨文件重复拷贝。
2. **删过期失效** —— 删除或更新已过期的表述、失效链接、不存在的路径/脚本/命令、已完成的 TODO。
3. **纠事实不符** —— 修正与代码/配置/git 历史/实际运行结果矛盾的参数、版本、示例输出、术语、链接文本。

核心原则：**证据优先**。任何删改都必须指向可复现证据（代码、git 历史、实际运行结果、链接状态、权威来源），绝不凭记忆或语感改写；无法确证的改动显式标 NEEDS_HUMAN，不脑补。

另内置三条保护：**安全与幂等**（改动前留底、只改证据点、复验可回滚）、**判断边界**（生成物、历史记录、法律文本、有意的重复等不改）、**报告模式**（只审查不改文件，输出可直接转 issue/PR 的清单）。

语言专项规则分两份：中文文档套用 [references/cjk-doc-rules.md](./references/cjk-doc-rules.md)，英文文档套用 [references/english-docs.md](./references/english-docs.md)。机器可读报告有 [JSON Schema](./references/report.schema.json)，可在 CI 里直接校验。

另附两个真实仓库的审计案例（[docproof](./examples/case-study-docproof.md)、[zhlint](./examples/case-study-zhlint.md)）：报告模式下给出建议 diff、逐条证据，以及「判定不改」的边界说明。

## 快速开始

在 DSH 中直接说：

~~~text
用 md-doc-optimizer 清理/优化 <路径或仓库> 的文档
~~~

或描述需求，例如：

~~~text
把 README 与当前代码对齐；检查 docs 里失效的链接和命令
~~~

## 安装

### DSH

把本目录放到用户技能目录下（与 code-refactor-prompts 等同级）：

~~~text
~/.dsh/skills/md-doc-optimizer/
~~~

Windows 下为：

~~~text
C:\Users\<用户名>\.dsh\skills\md-doc-optimizer\
~~~

放入后重启 DSH 或重载会话即可被自动发现并按描述触发。

### 其他 Agent（Claude Code / 通用 SKILL.md 生态）

本技能遵循通用 SKILL.md（frontmatter + 正文）格式，可直接安装到任意支持该格式的 Agent 技能目录，例如：

~~~text
~/.claude/skills/md-doc-optimizer/
~~~

### 手动（git）

~~~bash
git clone git@github.com:f-e-n-g-0531/md-doc-optimizer.git
# 或
git clone https://github.com/f-e-n-g-0531/md-doc-optimizer.git
~~~

## 目录结构

~~~text
md-doc-optimizer/
├── SKILL.md                      # 主体：三大目标 + 证据优先 5 阶段工作流
├── README.md
├── LICENSE / CHANGELOG.md
├── .markdownlint.yml             # markdownlint 配置（CI 门禁）
├── lychee.toml                   # lychee 链接检查配置（CI 门禁）
├── .github/workflows/
│   ├── docs-qa.yml               # CI：markdownlint + 链接 + 自洽检查 + Schema 校验
│   └── release.yml               # 推送 v* 标签或手动触发时发布 Release
├── scripts/
│   ├── check-docs.mjs            # 版本号 / 引用 / README 目录树自洽检查
│   ├── pre-scan.mjs              # 候选预扫：本地链接/锚点/重复/时间词等（只报候选）
│   └── pre-scan.test.mjs         # 预扫脚本自测（CI 门禁）
├── references/
│   ├── sources.md                # 同领域项目/工具调研（含出处）
│   ├── audit-checklist.md        # 逐目标检查清单
│   ├── cjk-doc-rules.md          # 中文标点/空格/术语专项规则
│   ├── english-docs.md           # 英文文档专项规则（含 Vale/write-good 判断）
│   ├── reporting.md              # 报告字段、JSON 契约、PR/commit 模板
│   ├── report.schema.json        # 报告 JSON Schema（CI 校验）
│   ├── tool-configs.md           # markdownlint / Vale / lychee / cspell / CI 配置
│   ├── drift-playbook.md         # 文档↔代码漂移核对
│   └── prompting-templates.md    # 可复用提示词模板
└── examples/
    ├── before-after.md                   # 去/删/改三段式示例
    ├── case-study-docproof.md            # 真实仓库案例：docproof（报告模式）
    ├── case-study-docproof.report.json   # 该案例的机器可读报告（Schema 校验）
    ├── case-study-zhlint.md              # 真实仓库案例：zhlint（报告模式）
    ├── case-study-zhlint.report.json     # 该案例的机器可读报告（Schema 校验）
    └── report.sample.json                # 机器可读报告示例（Schema 校验用）
~~~

## 质量门禁（本仓库 CI）

[docs-qa 工作流](https://github.com/f-e-n-g-0531/md-doc-optimizer/actions/workflows/docs-qa.yml) 在 main 分支推送或提交 PR（改动命中 paths 过滤）时自动跑五道检查：

| 检查 | 命令 | 作用 |
| --- | --- | --- |
| 结构 lint | `npx markdownlint-cli2 "**/*.md"` | 标题层级、围栏、表格等结构问题 |
| 链接检查 | `lychee --config ./lychee.toml --no-progress "**/*.md"` | 失效链接 |
| 自洽检查 | `node scripts/check-docs.mjs` | SKILL.md 版本 == CHANGELOG 最新版本；引用的文件都存在；README 目录树与实际文件同步 |
| 预扫自测 | `node scripts/pre-scan.test.mjs` | 预扫脚本行为回归（临时夹具覆盖各类候选检测） |
| 报告契约 | `npx ajv-cli@5 validate --spec=draft2020 -s references/report.schema.json -d "examples/*.json"` | 机器可读报告（样例 + 两份真实案例）符合 JSON Schema |

推送 `v*` 标签（或手动触发 release 工作流）会先过同一套检查，再发布 GitHub Release。

仓库自带一个零依赖预扫脚本：`node scripts/pre-scan.mjs <目标目录>` 输出候选清单 JSON；`--text` 按 `文件:行 [类别] kind -- 证据 | 原文` 输出人读摘要（证据是命中的具体词或路径）。候选覆盖死链/锚点（按 GitHub 锚点规则计算）、失效图片、空目标、引用式链接与未使用/重复定义、大小写不一致的路径（跨平台一致）、硬编码分支链接、时间敏感词、占位标记、重复标题/段落与疑似生成副本，供 P2 收集候选用。**候选必须再人工核对，不是结论。**

## 实测案例（真实仓库，报告模式）

两份案例都跑在真实公开仓库的指定提交上，只读审计、未向上游提交改动；结论用「建议 diff + 证据 + 判定边界」呈现，并附带可由 Schema 校验的机器可读报告。

| 目标 | 范围 | 结果 | 看点 |
| --- | --- | --- | --- |
| [docproof](https://github.com/melbinjp/docproof) @ `35e4688` | 4 个 Markdown | 审查 11 处 → 建议改 5、待人工 2、判不改 4 | 版本号位置与发布流程矛盾；PyPI 日期与元数据不符；README 两节重复测量说明；历史快照/演示输出正确排除 |
| [zhlint](https://github.com/zhlint-project/zhlint) @ `c8678fe` | 14 个 Markdown（含生成物、翻译、测试夹具） | 审查 16 处 → 建议改 11、判不改 5 | 生成 README 被手改导致发布回归；链接错在分支名与扩展名；API 类型/模块格式与源码不符；测试夹具整类排除 |

报告：[docproof JSON](./examples/case-study-docproof.report.json)、[zhlint JSON](./examples/case-study-zhlint.report.json)。

## 工具生态

本技能整合了以下成熟工具的能力（详见 references/sources.md）：

| 目标 | 工具 |
| --- | --- |
| 结构去重 | markdownlint、remark-lint |
| 文风/冗余 | Vale + write-good / proselint / alex |
| 链接失效 | lychee、markdown-link-check |
| 拼写 | cspell、typos |
| 中文专项 | zhlint、lint-md、pangu |
| 文档↔代码一致 | docproof、mdoctest、Redocly respect |

工具只做「预扫候选清单」，最终结论仍以证据与运行结果为准。

## 来源与致谢

方法论与工具清单参考了 [CloudBase-AI-Toolkit 的 doc-freshness-review](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit)、[testthedocs/awesome-docs](https://github.com/testthedocs/awesome-docs) 以及 Google / Microsoft / Diátaxis 文档风格指南等，完整出处见 references/sources.md。

## License

[MIT](./LICENSE) © 2026 f-e-n-g-0531
