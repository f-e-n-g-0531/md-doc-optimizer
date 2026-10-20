# Changelog

## 1.17.0 (2026-10-20)

- `duplicate-link-target` 扩展到 HTML `<a href>` 与引用式链接：同一本地目标在单文件出现 >= 3 次即报（内联/HTML/引用式合并计数），被抑制行不计。
- 新增候选类型 `link-outside-root`（B）：相对链接逃出最近的 git 仓库根（扫描子目录时仍以 `.git` 为界），避免发布后才 404。
- CI 门禁 kind 列表加入 `link-outside-root`；report 草稿 severity 映射同步（High）。
- 自测断言增至 1755，覆盖 HTML/引用式重复链接、仓库根越界链接。
- 同步更新 references/tool-configs.md、README、SKILL.md、pre-scan schema；版本号升至 1.17.0。

## 1.16.0 (2026-10-20)

- 新增候选类型 `duplicate-link-target`（A）：同一本地内联链接目标在单文件出现 >= 3 次时报告，缩小「链接冗余」盲区；锚点/外部链接与被抑制行不计。
- 新增 `--report-out <file>`：把候选转成 references/report.schema.json 兼容的报告草稿（action=annotate、severity 按 kind 映射、summary 计数），作为 P2→P3 的交接产物；CI 用 ajv 校验该草稿。
- CI 的 pre-scan 契约步骤同步增加 report-out 生成与 report.schema.json 校验；tool-configs 模板保持一致。
- 自测断言增至 1660（含逐 finding 校验报告草稿结构、重复链接目标、写入失败输出约定）。
- 同步更新 references/tool-configs.md、README、SKILL.md；版本号升至 1.16.0。

## 1.15.0 (2026-10-20)

- near-duplicate 改为精确算法：按全局行频取 prefix 的精确前缀过滤生成候选对，再做精确 Jaccard；不再依赖 MinHash+LSH 近似召回。`--exact-near-duplicates` 保留为全量两两对拍。
- 自测断言 1076：默认前缀过滤与全量精确模式在 60 文件夹具上输出完全一致。
- 同步更新 references/tool-configs.md、README、SKILL.md；版本号升至 1.15.0。

## 1.14.1 (2026-10-20)

- 修复块上下文边界：多行 HTML 注释结束后紧跟的 4 空格缩进代码现在也能识别（此前会被当成正文扫描）；补自测。
- 自测断言 1075；版本号 1.14.1。

## 1.14.0 (2026-10-20)

- srcset 改为 HTML 规范风格解析：URL 可含逗号、data URI 作为整体 URL（协议跳过），不再需要「含 data:/查询串就跳过」的启发式；HTML 属性值先解实体。
- near-duplicate 默认 MinHash 提高到 128 哈希 / 32 band（阈值 0.8 附近召回接近完整）；新增 `--exact-near-duplicates` 强制精确两两比较，需要严格结果时使用。
- 缩进代码块开始条件更贴近块语义：标题/分隔线/围栏/原始 HTML 块之后可无空行直接开始；列表续行判断保持。
- 已知限制更新：移除 srcset 启发式跳过；保留近似块上下文、超大仓分批、HTML 不覆盖 style/JS。
- 自测断言从 1069 增至 1074，覆盖 srcset data URI/逗号查询串、精确 near-duplicate 模式、标题/原始 HTML 块后缩进代码、HTML 属性实体解码。
- 同步更新 references/tool-configs.md、README、SKILL.md；版本号升至 1.14.0。

## 1.13.0 (2026-10-18)

- 支持 setext 标题（`Title` + `===`/`---`，含 blockquote/列表内与多行段落）：参与 slug、重复标题、多 H1 与锚点计算；段落去重跳过标题行。
- 支持缩进代码块（4 空格/tab，近似块上下文）：内容不再参与链接/引用/标题/标记扫描；列表续行与 blockquote 内代码按上下文处理。
- HTML 内链/图片增强：标签可跨行（属性换行），支持 `<source src>`、`<img srcset>`、`<source srcset>`；`data-*` 与属性值里的 `href=` 不误报；含 `data:`/查询串的 srcset 按启发式跳过。
- near-duplicate 从 O(n²) 全量比较改为「小仓精确 + 大仓 MinHash+LSH 候选对 + 精确 Jaccard」，超过 50 个候选文件自动启用。
- 已知限制更新：去掉 setext、缩进代码、多行属性、O(n²) 等已解决项；保留近似块上下文、超大仓分批、HTML 不覆盖 style/JS、srcset 启发式跳过。
- 自测断言从 969 增至 1069，覆盖 setext、缩进代码、跨行 HTML、srcset、LSH 路径。
- 同步更新 references/tool-configs.md、README、SKILL.md；版本号升至 1.13.0。

## 1.12.0 (2026-10-18)

- 预扫新增原始 HTML 内链/图片检查：`<a href>`、`<img src>` 的本地相对路径复用 broken-local-link/image、broken-anchor、case-mismatch-link 规则；`data-href`/`data-src` 等非真实属性不误报，外部 URL 仍交给 lychee。
- 围栏识别扩展到容器（blockquote/列表）内围栏，并识别 `<pre>`/`<script>`/`<style>`/`<textarea>` 原始 HTML 块（含 blockquote/列表内）；区域内链接、引用、标题、抑制标记一律不参与扫描（此前容器围栏内容会被误扫、标记会误抑制）。
- 抑制标记作用域收敛：顶层/容器围栏、行内代码、原始 HTML 块、外层 HTML 注释里的标记不生效；缩进代码块（4 空格）仍生效（代码示例请用围栏）。
- 文档新增「已知限制」：缩进代码块标记、setext 标题锚点、near-duplicate O(n²)、HTML 只覆盖 href/src 且不解析多行属性。
- 注意：围栏/原始 HTML 块行不再计入 near-duplicate 相似度，Jaccard 数值可能与 v1.11 不同；升级后若使用 baseline，建议重建基线。
- 自测断言从 883 增至 969，覆盖 HTML 内链/图片/锚点/大小写、data 属性不误报、容器围栏与原始 HTML 块（含容器内）忽略、围栏内标记不生效。
- 同步更新 references/tool-configs.md（候选说明、HTML/代码上下文规则、已知限制、真实仓库复跑数据）、README、SKILL.md；版本号升至 1.12.0。

## 1.11.0 (2026-10-18)

- 预扫新增行内抑制标记（HTML 注释，不渲染）：`<!-- pre-scan-ignore -->` 抑制同行、`<!-- pre-scan-ignore-next-line -->` 抑制下一行、`<!-- pre-scan-disable -->`/`<!-- pre-scan-enable -->` 抑制区间（未闭合时抑制到文件末尾）；标记后可写 `: 原因`。
- 标记只影响候选上报，不影响标题/链接/锚点解析；顶层围栏/单行行内代码/外层多行 HTML 注释里的标记字面量不生效，缩进代码块、列表/引用块围栏与 HTML `<pre>` 内的标记仍生效（不要在这些位置写标记示例）；无激活区间时 `pre-scan-enable` 是 no-op；被抑制的候选不进入 JSON、summary、baseline 与 `--fail-on` 门禁。
- 自测断言从 785 增至 883，覆盖区间开闭、同行/下一行、`: 原因`、enable no-op、外层注释内标记不生效、围栏与行内代码标记不生效、未闭合 disable。
- 同步更新 references/tool-configs.md（标记语法与语义）、README、SKILL.md 工具表；版本号升至 1.11.0。

## 1.10.0 (2026-10-18)

- 预扫新增 baseline 棘轮：`--write-baseline <file>` 把当前候选写成基线（tool/schema_version/entries，按 file/kind/evidence 排序、输出确定）；`--baseline <file>` 配合 `--fail-on` 只对新候选失败，已在基线中的候选在 stderr 说明忽略数量。
- 基线键为 file + kind + evidence；比较时只归一已知行号型 evidence（`repeat of heading/paragraph at line N`、`first H1 at line N`、`already defined at line N`），路径里的字面 `line 12` 不会误伤；`--write-baseline` 与 `--fail-on`/`--baseline` 互斥，`--baseline` 必须与 `--fail-on` 同用；基线文件缺失/坏 JSON/tool 不符/条目缺字段/未知 kind/空证据/绝对路径均按用法错误退出 2，写基线失败时不输出 stdout 契约 JSON。
- 自测断言从 744 增至 785，覆盖 baseline 写入格式与确定性、只拦新增、全量基线通过、行号漂移归一（含路径字面 line N 不误伤）、写入失败输出约定、非法基线与参数互斥。
- 同步更新 references/tool-configs.md（baseline 用法/格式/棘轮流程）、README、SKILL.md 工具表；版本号升至 1.10.0。

## 1.9.0 (2026-10-18)

- 预扫新增 `--fail-on <kind,...>` CI 门禁：命中指定候选类型时退出码 1，匹配项写到 stderr（最多 20 条明细，其余 `... and N more`，完整列表看 stdout JSON），stdout 仍输出完整 JSON/文本；默认跳过 `context=fixture` 候选（stderr 说明跳过数，退出码仍为 0；明细中的夹具候选标 `[fixture]`），`--include-fixtures` 可显式包含；kind 逗号分隔且不允许空项，未知 kind/空项按用法错误退出 2（退出码约定 0/1/2）。
- 新增 references/pre-scan.schema.json（JSON Schema 2020-12）：固定预扫输出契约（字段、kind 枚举、kind→类别映射、summary 结构），CI 用真实输出校验。
- CI 新增「pre-scan contract & gate」步骤：生成输出 → schema 校验 → 对结构性失效类（死链/图片/锚点/大小写/空目标/未定义引用）做门禁；docs-qa 门禁从五道增至六道，release 工作流经 workflow_call 自动继承。
- scripts/check-docs.mjs 新增自洽检查：schema 的 kind 枚举只允许在 $defs.kind 定义一次，candidate.kind 与 summary.by_kind.propertyNames 必须 $ref 复用它；脚本 CATEGORY、枚举与 allOf 类别映射不一致会直接报错。
- 自测断言从 708 增至 744，新增 --fail-on 用例：命中/未命中退出码、stderr 摘要、未知 kind、缺少值、空列表/尾随逗号、`--fail-on=` 形式、与 --text 组合、重复 kind 去重、多目标提示、默认跳过 fixture 与 `--include-fixtures`。
- 同步更新 references/tool-configs.md（用法、退出码、输出契约、CI 模板）、README（目录树、六道门禁、预扫用法）、SKILL.md（工具表、深入阅读）；版本号升至 1.9.0。

## 1.8.0 (2026-10-18)

- 修复脚注误报：`[^1]: ...` 等脚注定义不再被当作本地链接目标检查（此前会把脚注正文首词当路径，报 broken-local-link）；脚注正文里的引用式链接仍会检查。
- 链接/引用扫描跳过 HTML 注释：单行与跨行注释里的链接、引用定义、显式锚点与标题都不再计入；注释里的围栏标记也不会再吞掉注释之后的正文。
- 新增本地图片检查（`broken-local-image`）：内联 `![](...)`、图片形式的引用定义、快捷图片 `![alt]`、`[![alt](img)](link)` 嵌套写法，以及链接文字/alt 内嵌一层方括号（`![alt [x]](img)`、`[see [inner][label]](url)`）都核对存在性，路径大小写一并检查。
- 新增空目标检查（`empty-link-target`）：`[]()`、`[]( "title")`、`[](<> "title")` 以及空定义 `[label]:`；同一行多个空目标分别报告。按 CommonMark，`]("title")` 的引号属于 destination，按普通链接核对。
- 新增引用式链接完整性检查：`undefined-reference-label`（引用不存在的定义）、`unused-reference-definition`（定义从未被引用）、`duplicate-reference-definition`（同一标签重复定义）。支持完整/折叠/快捷形式，标签按 CommonMark 规则归一；支持目标换行与 blockquote/列表项内的定义。undefined 检查覆盖完整/折叠形式，快捷形式只用于判定定义是否被引用。
- 新增跨平台路径检查：反斜杠分隔符（含编码后的 `%5C`）按 GitHub 行为报 broken-local-link/image，避免「Windows 本地能开、线上 404」的漏报；CommonMark 标点转义（如 `my\_file.md`）先解转义，不误报。
- 自测断言从 324 增至 708，覆盖脚注、HTML 注释、图片（内联/引用式/快捷/嵌套/大小写）、空目标、引用定义各形式（含容器与换行）、链接文字内嵌方括号、转义方括号、反斜杠路径等，并保持输出确定性。
- 同步更新 references/tool-configs.md（候选类型表、引用/图片规则）、SKILL.md 目标信号与 P2、audit-checklist、README；SKILL.md 版本号升至 1.8.0。

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
