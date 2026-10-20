# 现成工具配置（tool-configs.md）

以下配置可直接粘贴。工具一律作「预扫候选清单」，最终结论仍以读到的证据与运行结果为准。

## markdownlint —— 结构 / 去重

文件 `.markdownlint.yml`（与本仓库实际配置一致；已关闭与中文文档习惯冲突的纯风格规则）：

~~~yaml
default: true

# 行长度交给格式化工具，避免与内容去重混在一起
MD013: false

# 中文「冒号 + 列表」惯用写法，不强制标题/列表周围空行
MD022: false
MD032: false

# 重复标题：只查兄弟层级（允许不同章节下同名小节）
MD024:
  siblings_only: true

# 多一级标题在长文档中允许
MD025:
  front_matter_title: ""

# 允许内联 HTML（README 居中徽章区）
MD033: false

# 允许裸 URL（工具清单类文档）
MD034: false

# 允许用强调代替标题
MD036: false

# 允许无语言标注的围栏代码块（纯文本示例/目录树）
MD040: false

# 首行不必是顶级标题
MD041: false

# 不强制代码围栏风格
MD048: false

# 不强制表格分隔行空格一致性
MD060: false
~~~

运行：`npx markdownlint-cli2 "**/*.md"`

## Vale —— 文风 / 冗余 / 得体（主要面向英文，中文效果有限）

文件 `.vale.ini`：

~~~ini
StylesPath = styles
MinAlertLevel = suggestion
Vocab = Docs

[*.md]
BasedOnStyles = Vale, Microsoft, write-good, proselint, alex
write-good.Passive = NO
write-good.So = YES
proselint.Very = YES
~~~

前置条件：`styles/` 下需放置对应风格包（write-good、proselint、alex、Microsoft、Google）；词汇表按 Vale 3.x 放在 `<StylesPath>/config/vocabularies/Docs/accept.txt`（即 `styles/config/vocabularies/Docs/accept.txt`）。缺风格包或词汇表时 `vale` 会报错。

运行：`vale .`

## 中文文档专项（zhlint / lint-md / pangu）

中文标点、全半角、中英空格、术语一致性，用中文专用工具。完整规则见 references/cjk-doc-rules.md。

~~~bash
# 只检查，不修改
npx zhlint "**/*.md"
npx @lint-md/cli "**/*.md"

# 预览 pangu 的空格修正（输出到 stdout，不写回文件）
npx pangu -f README.md > README.pangu-preview.md
~~~

说明：zhlint 用 `--fix`、lint-md 用 `-f` 自动修复；接入 CI 前先按团队风格写 `.zhlintrc` / `.lintmdrc` 收敛规则，避免一次性大改。

### 中文 linter 配置（保留仓库风格）

`.zhlintrc` —— 保留全角括号与「」，只统一空格与标点习惯：

~~~json
{
  "preset": "default",
  "rules": {
    "halfwidthPunctuation": "",
    "unifiedPunctuation": { "default": false }
  }
}
~~~

`.lintmdrc` —— 关闭与仓库风格冲突的半角标点规则（`0` 关、`1` 警告、`2` 错误）：

~~~json
{
  "rules": {
    "no-half-width-punctuation": 0
  }
}
~~~

两者都**只跑检查、不跑自动修复**：实测 `zhlint --fix` 会把 `.github` 改成 `。github`、把代码里的 `"X"` 改成弯引号（见 references/cjk-doc-rules.md 第 7 节）。

## lychee —— 链接失效

文件 `lychee.toml`。注意 **lychee 配置里没有 `files` 键**：输入文件由命令行位置参数或 `files_from` 指定。写成 `files = [...]` 会报 `required arguments were not provided`（本仓库接入 CI 时踩过这个坑）。

~~~toml
# 接受这些状态码视为可达（403/429 常见于反爬与限流）
accept = ["200", "201", "202", "204", "301", "302", "304", "403", "429"]

# 跳过内网/本地/回环地址
exclude_all_private = true
exclude = ["localhost", "127.0.0.1", "0.0.0.0", "example.com"]

# 不检查代码块内的链接（git clone / SSH 地址等）
include_verbatim = false

# 网络健壮性
timeout = 20
max_retries = 3
max_concurrency = 16
~~~

运行（文件/glob 必须作为位置参数传入）：

~~~bash
lychee --config ./lychee.toml --no-progress "**/*.md"
~~~

## markdown-link-check —— 单文件链接

运行：`npx markdown-link-check README.md`
（批量：对每个 `*.md` 循环执行，或配 `config.json` 加 `ignorePatterns`）

## cspell —— 拼写 / 错词

文件 `.cspell.json`：

~~~json
{
  "version": "0.2",
  "language": "en",
  "words": ["markdownlint", "lychee", "vale", "dedupe", "docproof"],
  "ignorePaths": ["node_modules", "*.lock", "dist", "LICENSE"],
  "allowCompoundWords": true
}
~~~

运行：`npx cspell "**/*.md"`

## doctest —— 复跑示例代码（事实核对）

- mdoctest（语言无关）：`mdoctest README.md`（加 `--fix` 自动更新失效输出）
- markdown-doctest（JS 生态）：只执行 JS 示例验证不抛异常，不比对输出：`npx markdown-doctest README.md`

## 内置预扫脚本（scripts/pre-scan.mjs）

零依赖的候选生成器，用于 P2：默认只读（不访问网络、不修改目标仓库），输出确定性的 JSON 候选清单；仅显式传 `--write-baseline <file>` 时才写入用户指定的基线文件。候选必须再按 SKILL.md 的 P3 逐条核对，不能直接当结论。

~~~bash
node scripts/pre-scan.mjs <目标目录>          # 输出 JSON 候选清单
node scripts/pre-scan.mjs <目标目录> --text   # 输出人读摘要
node scripts/pre-scan.mjs <目标目录> --fail-on broken-local-link,broken-anchor  # 命中即失败
node scripts/pre-scan.mjs <目标目录> --write-baseline .pre-scan-baseline.json    # 记录当前候选为基线
node scripts/pre-scan.mjs <目标目录> --fail-on broken-local-link --baseline .pre-scan-baseline.json  # 只拦新增
node scripts/pre-scan.mjs <目标目录> --exact-near-duplicates  # near-duplicate 全量两两对拍
node scripts/pre-scan.mjs <目标目录> --report-out draft.json  # 输出报告草稿（report.schema.json）
~~~

`--text` 每行按 `file:line [类别] kind -- evidence | 原文` 输出：`evidence` 是命中的具体词或路径（例如同一行里的「目前」「最近」会分别列出），便于逐条 triage。

`--report-out <file>` 把候选转成 references/report.schema.json 兼容的报告草稿：每条 finding 的 `action=annotate`（等待 P3 triage），`severity` 按 kind 映射（死链/图片/锚点/空目标=High；大小写/未定义引用/硬编码分支/时间词/近重复=Medium；其余=Low），`summary` 中 examined/needs_human 为候选数、fixed/no_action 为 0。它只是 P2→P3 的草稿，不是已完成审计。

`--fail-on <kind,...>` 是 CI 门禁：命中指定 kind 时退出码为 1，匹配项写到 stderr（最多 20 条明细，其余以 `... and N more` 提示，完整列表看 stdout JSON）；stdout 仍输出完整 JSON/文本，便于同时存档。**默认跳过 `context=fixture` 的候选**（测试夹具里的坏链接是内容本身），需要时加 `--include-fixtures`。kind 用逗号分隔、不能有空项；未知 kind 或空项按用法错误退出 2。退出码：**0 成功、1 门禁命中、2 用法错误**。仅跳过 fixture 时也会在 stderr 写一行跳过计数（退出码仍是 0）；门禁明细里的 fixture 候选会标 `[fixture]`。

### 行内抑制标记

规则文档会引用候选词、示例会故意写坏链接；这类「内容本身」可以在 Markdown 里用 HTML 注释标记抑制（标记不会渲染）：

| 标记 | 作用 |
|---|---|
| `<!-- pre-scan-ignore -->` | 抑制同一行的候选 |
| `<!-- pre-scan-ignore-next-line -->` | 抑制下一行的候选 |
| `<!-- pre-scan-disable -->` … `<!-- pre-scan-enable -->` | 抑制区间内的候选；未闭合时抑制到文件末尾 |

- 只影响候选上报，不影响标题/链接/锚点等解析。**作用域边界**：顶层/容器围栏、单行行内代码、`<pre>` 等原始 HTML 块、外层多行 HTML 注释、缩进代码块里的标记都不生效（缩进代码按近似块上下文判断，极端边界可能有偏差）。没有激活区间时 `pre-scan-enable` 是 no-op。
- 标记后可用 `: 原因` 写说明（如 `<!-- pre-scan-ignore: 规则示例 -->`）；被抑制的候选不会进入 JSON、summary、baseline 与 `--fail-on` 门禁。标记本身是 HTML 注释，读者不可见。

存量仓库可用 baseline 做「只拦新增」的棘轮（ratchet）：

- `--write-baseline <file>`：把当前候选写成基线，字段为 `{tool, schema_version, entries:[{file, kind, evidence}]}`，按 file/kind/evidence 排序，输出稳定可 diff；不能与 `--fail-on`/`--baseline` 同用，退出码 0。
- `--baseline <file>`：配合 `--fail-on` 使用，只对基线之外的新候选失败；stderr 会说明忽略了多少条基线候选。基线键为 `file + kind + evidence`；比较时只归一已知行号型 evidence（`repeat of heading/paragraph at line N`、`first H1 at line N`、`already defined at line N`），路径里的字面 `line 12` 不会误伤。文档大改后若证据文本本身变化导致旧条目失配，重新生成 baseline 并 review diff。
- 基线文件缺失、坏 JSON、tool/schema_version 不符，或条目缺字段/未知 kind/空证据/非 POSIX 相对路径（绝对路径、反斜杠路径），都按用法错误退出 2。

**已知限制**（按需接受）：

- 缩进代码块/容器嵌套按近似块上下文识别，极端嵌套可能偏差；代码示例仍建议用围栏。
- `near-duplicate-files` 用精确前缀过滤生成候选对再做精确 Jaccard，结果是精确的；超大仓库仍建议分批。`--exact-near-duplicates` 仅用于对拍（全量两两比较）。v1.12 起围栏/原始 HTML 块行、v1.13 起缩进代码行不计入相似度，旧 baseline 可能需重建。
- 原始 HTML 只检查 `<a href>`、`<img src/srcset>`、`<source src/srcset>` 的本地相对路径；srcset 按 HTML 规范风格解析（URL 可含逗号、data URI 整体跳过）；不处理 `style`/JS 注入链接。

输出契约见 references/pre-scan.schema.json（JSON Schema 2020-12）；CI 会用真实输出做校验。新增或改名 kind 时必须同步 schema，`scripts/check-docs.mjs` 会比对脚本 CATEGORY、schema 枚举与类别映射。

覆盖的候选类型（kind / 类别）：

| kind | 类别 | 说明 |
|---|---|---|
| broken-local-link | B | 相对路径链接（Markdown 或 `<a href>`）指向不存在的文件 |
| broken-local-image | B | 相对路径图片（Markdown 或 `<img src>` / `srcset` / `<source>`）指向不存在的文件 |
| case-mismatch-link | B | 路径大小写与磁盘真实文件名不一致：Windows/macOS 本地能打开，Linux/CI 上 404 |
| broken-anchor | B | `#锚点` 在当前文件或目标文件中不存在（按 GitHub 锚点规则计算） |
| link-outside-root | B | 相对链接逃出 git 仓库根（扫描子目录时仍以最近的 `.git` 为界） |
| empty-link-target | B | 空链接/图片目标：`[]()`、`[]( "title")`、`[](<> "title")`、空定义 `[label]:` |
| undefined-reference-label | B | 完整/折叠引用 `[text][label]`/`[label][]` 的 label 在本文件没有定义，会渲染成字面文本 |
| default-branch-master-link | B | GitHub 链接硬编码 `/tree/master/` 或 `/blob/master/`，需核对默认分支 |
| trailing-fullwidth-after-url | C | URL 后粘连全角括号/引号，常导致 404 |
| stale-time-phrase | B | currently / recently / soon / 目前 / 最近 等时间敏感词 |
| placeholder-marker | B | TODO / TBD / 待补充 / coming soon 等占位 |
| duplicate-heading | A | 同文件内同层级同名标题 |
| duplicate-paragraph | A | 同文件内重复段落 |
| multiple-h1 | A | 一个文件多个一级标题 |
| unused-reference-definition | A | 引用定义 `[label]: url` 从未被引用 |
| duplicate-reference-definition | A | 同一引用标签重复定义，后一条会被忽略 |
| duplicate-link-target | A | 同一本地链接目标在单文件中出现 >= 3 次（内联链接；锚点/外部链接不计） |
| near-duplicate-files | A | 两个文件行集合高度相似，疑似拷贝或生成副本 |

输出结构：`{tool, schema_version, target, files_scanned, candidates[], summary{total, by_kind, by_category}}`；candidates 按 file/line/kind 排序，便于 diff。

锚点与大小写是两类最容易误判的候选，预扫按 GitHub 的实际规则处理：

- **锚点**：保留下划线与连字符；重复标题按出现顺序追加 `-1`、`-2`；标题里的 HTML 标签按渲染文本处理、实体先解码；`<a name="x">`、`<span id="x">` 等显式 HTML 锚点同样算合法目标。
- **大小写**：不依赖本机文件系统是否区分大小写，而是逐段 `readdir` 比对真实文件名，因此 Windows 开发机与 Linux CI 上的结论一致。
- **引用式链接**：支持完整 `[text][label]`、折叠 `[label][]` 与快捷 `[label]`（含快捷图片 `![alt]`）；定义可位于行首、blockquote 或列表项内，目标可换行；脚注 `[^1]: ...` 不是链接定义、不参与检查，但脚注正文里的引用仍会扫描。
- **图片**：只检查本地相对路径（含图片形式的引用定义、`[![alt](img)](link)` 嵌套写法，以及 alt 内嵌一层方括号）；外部 URL 交给 lychee 等链接检查器。
- **HTML 注释**：注释里的链接、引用定义、标题与显式锚点都不参与检查；注释里的围栏标记也不能吞掉注释后的正文。
- **原始 HTML**：检查 `<a href>`、`<img src/srcset>`、`<source src/srcset>` 的本地相对路径（含锚点、大小写；标签可跨行；`data-*` 与属性值里的 `href=` 不误报）；外部 URL 交给 lychee。`<pre>`/`<script>`/`<style>`/`<textarea>` 块内不扫描。
- **代码上下文**：顶层与 blockquote/列表内的围栏、`<pre>` 等原始 HTML 块（含容器内）、4 空格/tab 缩进代码块都识别（缩进代码按近似块上下文判断），内容整体忽略。
- **标题**：ATX（#）与 setext（`Title` + `===`/`---`）都参与 slug、重复标题与多 H1 计算。
- **路径分隔符**：链接里的反斜杠（含编码后的 `%5C`）按 GitHub 行为报失效——线上会变成 `%5C` 404，即使 Windows 本地能打开；统一用 `/`。CommonMark 的标点转义（如 `my\_file.md`）先解转义，不算分隔符。
- **空目标**：`[]()`、`[]( "title")`、`[](<> "title")` 报空目标；按 CommonMark，`]("title")` 的引号属于 destination，按普通链接核对；`[label]:`（无目标）属启发式候选（CommonMark 会按普通段落渲染），需人工确认。

`near-duplicate-files` 用精确前缀过滤生成候选对（按全局行频取 prefix），再做精确 Jaccard；`--exact-near-duplicates` 可对拍全量两两比较。超大仓库仍可分批扫描。每个候选带 `context` 字段：`fixture`（路径含 `test/`、`tests/`、`fixtures/`、`__fixtures__/`、`__snapshots__/`，或文件名以 `example-` 开头；先按测试夹具边界排除）或 `docs`。

自测：`node scripts/pre-scan.test.mjs`（CI 会跑）。

注意：规则文档会引用候选词表本身（如本 skill 的 SKILL.md 写了「目前/最近/TODO」），因此对本仓库运行会得到一批预期内的候选噪音；这类命中应 triage 为 no action。如果希望彻底静音，可用上面的行内抑制标记，或 baseline 只拦新增。

2026-10-18 在案例快照上复跑：v1.11.0 前为 docproof 0 / zhlint 30；v1.12.0 增加 HTML 内链检查与容器围栏/原始 HTML 块忽略后，docproof 0、zhlint 28（新增 1 条 `<a href>` 失效链接，减少 3 条原始 HTML `<script>` 块内占位噪音；3 个 `default-branch-master-link`、1 个 `near-duplicate-files` 仍在）——候选只是线索，最终结论仍来自逐条证据核对。

## GitHub Actions —— 组合检查（自包含版）

文件 `.github/workflows/docs-qa.yml`。下面这份可直接复制，门禁步骤与本仓库实际文件一致（额外只有说明注释和末尾可选的 Vale 段）：markdownlint、链接检查、文档自洽检查、预扫自测、预扫契约与门禁、报告 Schema 校验是必过门禁；Vale 需先备好风格包、默认注释，按需启用。

下面四步「docs consistency / pre-scan self-test / pre-scan contract & gate / validate report schema」依赖本仓库的 scripts/check-docs.mjs、scripts/pre-scan.test.mjs、scripts/pre-scan.mjs 与 references/ 下的两个 schema；复制到其他仓库时按需删改，或换成自己的自洽检查。

~~~yaml
name: docs-qa

on:
  push:
    branches: [main]
    paths:
      - "**.md"
      - "**.markdown"
      - ".markdownlint.yml"
      - "lychee.toml"
      - ".github/workflows/docs-qa.yml"
      - "scripts/**"
      - "**.json"
  pull_request:
    paths:
      - "**.md"
      - "**.markdown"
      - ".markdownlint.yml"
      - "lychee.toml"
      - ".github/workflows/docs-qa.yml"
      - "scripts/**"
      - "**.json"

  workflow_call:

permissions:
  contents: read

jobs:
  docs-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: markdownlint
        run: npx --yes markdownlint-cli2 "**/*.md"

      # 仓库自洽检查：SKILL.md 版本 / 引用文件 / README 目录树（依赖 scripts/check-docs.mjs）
      - name: docs consistency
        run: node scripts/check-docs.mjs

      - name: pre-scan self-test
        run: node scripts/pre-scan.test.mjs

      # 预扫输出契约 + 结构性门禁（依赖 references/pre-scan.schema.json 与 scripts/pre-scan.mjs）
      - name: pre-scan contract & gate
        run: |
          node scripts/pre-scan.mjs . > "$RUNNER_TEMP/pre-scan-out.json"
          npx --yes ajv-cli@5 validate --spec=draft2020 -s references/pre-scan.schema.json -d "$RUNNER_TEMP/pre-scan-out.json"
          node scripts/pre-scan.mjs . --report-out "$RUNNER_TEMP/pre-scan-report.json" > "$RUNNER_TEMP/pre-scan-report-scan.json"
          npx --yes ajv-cli@5 validate --spec=draft2020 -s references/report.schema.json -d "$RUNNER_TEMP/pre-scan-report.json"
          node scripts/pre-scan.mjs . --fail-on broken-local-link,broken-local-image,broken-anchor,link-outside-root,case-mismatch-link,empty-link-target,undefined-reference-label

      # 报告 JSON Schema 校验（依赖 references/report.schema.json 与 examples/*.json）
      - name: validate report schema
        run: npx --yes ajv-cli@5 validate --spec=draft2020 -s references/report.schema.json -d "examples/*.json"

      - name: check-links
        uses: lycheeverse/lychee-action@v2
        with:
          args: --config ./lychee.toml --no-progress '**/*.md'
          fail: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # 可选：Vale 需先准备 .vale.ini + styles/ + Vocab
      # - name: vale
      #   uses: errata-ai/vale-action@reviewdog
      #   with:
      #     files: .
~~~

提示：docproof 也有现成 GitHub Action，见 https://github.com/melbinjp/docproof 。可把它加进同一工作流，用于「文档声称是否仍对仓库成立」的硬校验（文件路径 / CLI flag / 版本号 / 文档化 import）。
