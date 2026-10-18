# Changelog

## 1.7.0 (2026-10-18)

- 预扫锚点识别对齐 GitHub 实际规则：保留下划线、重复标题按出现顺序追加 `-1`/`-2`、标题内 HTML 标签按渲染文本处理、HTML 实体先解码。修复 `#foo_bar`、`#notes-1`、含 `<code>` 的标题、显式 HTML 锚点等多处误报。
- 预扫支持显式 HTML 锚点（`<a name="x">`、`<span id="x">`），这类链接不再被误报为 broken-anchor。
- 预扫新增 `case-mismatch-link` 候选：逐段比对磁盘真实文件名大小写，捕捉「Windows/macOS 本地能打开、Linux/CI 上 404」的链接；不依赖本机文件系统的大小写行为，跨平台结果一致。
- `--text` 输出改为证据 + 原文双列（`file:line [类别] kind -- evidence | excerpt`），同一行多个候选词可直接区分，无需再切 JSON 查证据。
- 自测断言从 258 增至 324，覆盖下划线/重复标题/HTML 标签/实体/显式锚点、文件与目录的大小写不一致。
- 修正文档内部不一致：CI 模板补上 pre-scan 自测、workflow_call 与 **.markdown 触发路径；zhlint 案例 4.2 类别对齐 JSON（C→B）；明确 markdown-doctest 只验证不比对输出；README 触发条件改为「main 分支推送或 PR（命中 paths）」；sources.md 补 zhlint / lint-md / pangu 出处；统一「三段汇总 + Out of scope」口径。
- 同步更新 references/tool-configs.md（候选类型表、锚点与大小写规则）、audit-checklist.md（锚点规则、路径大小写）、drift-playbook.md（链接核对第 4 个陷阱）与 README；SKILL.md 版本号升至 1.7.0。

## 1.6.0 (2026-10-18)

- 新增 scripts/pre-scan.mjs：零依赖、只读的候选预扫工具，输出确定性 JSON 候选（本地死链/锚点、硬编码 master 分支链接、URL 粘连全角标点、时间敏感词、占位标记、重复标题/段落、多 H1、疑似生成副本），并标记 fixture 上下文。
- 新增 scripts/pre-scan.test.mjs 自测：临时夹具覆盖各类候选、代码围栏/内联代码不误报、排序与汇总一致性、退出码；CI 增加 pre-scan self-test 步骤。
- SKILL.md P2 增加「先跑内置预扫脚本」，工具编排表与报告模式（落地入口）同步更新。
- references/reporting.md 新增 2.2「报告落地（report → apply）」：确认后逐条应用、复验、更新 fixed/keep/annotate 计数，并说明预扫输出只是 P3 输入。
- references/tool-configs.md 新增预扫脚本章节（用法、候选类型、JSON 结构、fixture 边界）。
- references/drift-playbook.md 第 6 节补充 near-duplicate-files 候选作为生成/拷贝关系线索。
- README 目录结构、质量门禁（五道检查）与预扫用法同步更新。

## 1.5.0 (2026-10-18)

- 新增两份真实仓库审计案例：examples/case-study-docproof.md、examples/case-study-zhlint.md，均为报告模式（只读、未向上游提交），含建议 diff、逐条证据与「判定不改」的边界说明。
- 新增对应机器可读报告 examples/case-study-*.report.json；CI 现在用 references/report.schema.json 校验 examples/ 下全部报告，不再只校验样例。
- SKILL.md「判断边界」补充：生成物要先找生成脚本、改源文件后重新生成；测试夹具里的坏链接/命令/TODO 属内容本身，不改。
- references/audit-checklist.md 反误报清单补充：生成文档识别、测试夹具排除、默认分支/文件改名导致的失效链接。
- references/drift-playbook.md 新增第 6、7 节：生成文档的识别/核对/处置流程；链接核对的三个陷阱（默认分支、文件改名、可达≠语义匹配）。
- references/reporting.md 明确报告模式下 fixed=0 与建议 diff 的语义。
- README 新增「实测案例」章节，质量门禁的命令与说明同步更新。

## 1.4.0 (2026-10-18)

- 新增 references/english-docs.md：英文文档专项规则（冗余套话、相对时间表述、事实核对、术语一致性、Vale/write-good/alex 结果判断、审计清单与前后对照示例）。
- 修复 SKILL.md 与 references/reporting.md 的 JSON 报告契约不一致：SKILL.md 的机器可读示例改为与 references/report.schema.json 一致的 summary + findings 结构。
- 新增 references/report.schema.json（JSON Schema 2020-12）与 examples/report.sample.json；CI 用 ajv-cli 校验报告格式。
- 新增 scripts/check-docs.mjs 与对应 CI 步骤：校验 SKILL.md 版本与 CHANGELOG 最新版本一致、文档引用的文件存在、README 目录树与实际文件同步。
- 修复 release 工作流手动触发的版本解析缺陷：workflow_dispatch 且未填版本时回退到最新 tag（原先会把分支名当版本号），并校验版本号形如 v*。
- 依据外部事实核验（docproof / mdoctest / pangu / cspell / lychee / lint-md / markdownlint / 33 个仓库与 47 个链接）修正 4 处描述：markdown-doctest 不比对输出、markdownlint 规则编号更新到 MD060、Harper 定位、docsync 定位。
- README 新增「质量门禁」章节并更新目录结构；docs-qa 工作流的路径过滤覆盖 scripts/ 与 JSON 变更。

## 1.3.0 (2026-10-18)

- 新增「判断边界：什么不该改」章节：生成物、有意的重复、历史记录、法律文本、演示性错误、权威来源、计划内容、无法复核的断言。
- 新增「报告模式（只报告不改）」：只做 P1–P3、输出建议 diff、可直接转 issue/PR。
- 新增 references/reporting.md：报告字段、JSON 契约、NEEDS_HUMAN 四段式、严重度动作矩阵、PR/commit 模板与示例。
- references/cjk-doc-rules.md 新增第 7 节「工具使用边界（本仓库实测）」：默认 zhlint 801 处，`--fix` 会让 lint-md 从 17 涨到 313（v1.2.0 内容快照实测）；调优后 `--fix` 仍会改坏 `.github` → `。github`、`无 .md` → `无。md`、代码引号变弯引号——结论是只做 check-only，不自动修技术文档。
- references/tool-configs.md 新增 `.zhlintrc` / `.lintmdrc` 调优配置示例（保留全角括号与「」）。
- references/audit-checklist.md 新增「反误报检查」清单。
- 修正 README 中已不存在的 serenity-skill 引用（当前技能目录只剩 code-refactor-prompts）。
- README 补充报告模式与判断边界说明，目录结构加入 reporting.md。

## 1.2.0 (2026-10-18)

- 新增 references/cjk-doc-rules.md：中文标点/全半角、中英文空格、套话、时间敏感表述、术语一致性、排版与链接细节，附 zhlint / lint-md / pangu / textlint 用法。
- 新增「安全与幂等」章节：改动前留底、只改证据点、diff 复核、幂等验收、可回滚。
- 输出格式新增机器可读 JSON 块，便于 CI/脚本消费。
- 修正 references/tool-configs.md 的 lychee 配置：移除不存在的 `files` 键（lychee 输入须走位置参数或 `files_from`）。
- CI 示例改为自包含可跑通版本：lychee 加 `fail: true`，Vale 标注前置条件并设为可选。
- markdownlint 示例配置与本仓库 `.markdownlint.yml` 对齐；README 代码围栏补语言标注，结构表与工具表补充中文专项。

## 1.1.0 (2026-10-18)

- 新增 GitHub Actions CI：markdownlint + lychee 自动检查（.github/workflows/docs-qa.yml）。
- 新增 CI 徽章与 .markdownlint.yml / lychee.toml 配置。
- 新增发布工作流（.github/workflows/release.yml）：推送 v* 标签或手动触发即可发布正式版本。
- 修复 references/sources.md 中 Vale 仓库链接被全角括号粘连导致的 404。

## 1.0.0 (2026-10-18)

- 首次发布：md-doc-optimizer Skill。
- 三大目标（去冗余 / 删过期失效 / 纠事实不符）+ 证据优先的 5 阶段工作流。
- 整合同领域开源工具的调研目录（references/sources.md）。
- 逐目标检查清单（references/audit-checklist.md）。
- 可直接粘贴的工具配置：markdownlint / Vale / lychee / cspell / CI 工作流（references/tool-configs.md）。
- 文档与代码漂移核对手册（references/drift-playbook.md）。
- 可复用提示词模板（references/prompting-templates.md）。
- 去/删/改三段式前后对照示例（examples/before-after.md）。
