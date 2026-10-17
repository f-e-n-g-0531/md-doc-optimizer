# 真实仓库审计案例：docproof（报告模式）

> 审计对象：[melbinjp/docproof](https://github.com/melbinjp/docproof) @ `35e4688`（2026-08-31）
> 审计日期：2026-10-18；模式：报告模式（外部仓库只读审计，未向上游提交改动，`fixed` 计 0）
> 方法：md-doc-optimizer 的 P1–P3 + P2 预扫（markdownlint-cli2、链接探测、git 历史与 PyPI 元数据核对）
> 结果：审查 11 处 → 建议改 5 处（High 1 / Medium 4），留待人工 2 处，判定不改 4 处

## 1. 为什么选这个仓库

- docproof 本身就是「文档事实核查」工具，对它的文档做审计，误报会立刻暴露方法问题；
- 只有 4 个 Markdown 文件，规模可控，可以逐条读到代码与发布流程；
- 有 RELEASING.md 这类「文档描述流程、流程又由代码实现」的内容，最容易出现文档与实现脱节。

结论先行：**它整体写得很严谨，多数「看着可疑」的段落都有边界或历史说明；真正可证伪的只有 4 处。** 这比找出一堆问题更能说明「证据优先」的价值。

## 2. 事实来源清单

| 事实来源 | 用途 | 位置 |
| --- | --- | --- |
| pyproject.toml | 版本号声明方式 | `dynamic = ["version"]`、`[tool.hatch.version]` |
| `src/docproof/__init__.py` | 版本号唯一字面量 | `__version__ = "0.2.4"` |
| .github/workflows/release.yml | 发布门禁实际读取逻辑 | `The tag names the version...` 步骤 |
| PyPI JSON API | 首发版本与上传时间 | `https://pypi.org/pypi/docproof/json` |
| git 历史 | 文档改动时间线 | `git log -S "going up on PyPI"` 等 |

## 3. P2 预扫（候选清单，不是结论）

~~~bash
npx --yes markdownlint-cli2 "**/*.md"
# 4 files → 308 issues：几乎全部是默认规则下的 MD013 行宽与 MD060 表格风格

# 外链：README.md + RELEASING.md 的 Markdown 链接 + 引用定义 + 裸 URL，去重 8 个
# 2026-10-18 逐个探测：8/8 返回 200（审计过程中两个博客链接曾两次不可达，复测恢复）
~~~

308 条预扫结果里没有一条被直接当成结论；本案例的 5 处建议改动全部来自「代码/工作流/元数据」证据。这正是 SKILL.md 要求的「预扫只产出候选清单」。

## 4. 逐条核对

### 4.1 发布流程把版本号位置写错（High，Category C）

- 位置：RELEASING.md:43、:52、:122
- 原文（:43）：``# `version` in pyproject.toml must already be the new number, and the commit must be on main``
- 证据：
  - pyproject.toml:13 为 `dynamic = ["version"]`，没有 `project.version` 键；
  - pyproject.toml:43-44 指定 `[tool.hatch.version]` 的 `path = "src/docproof/__init__.py"`；
  - `src/docproof/__init__.py:3` 是唯一版本字面量 `__version__ = "0.2.4"`；
  - .github/workflows/release.yml:56-76 的发布门禁正是从 hatch 路径读 `__version__`，而不是读 pyproject 的 `project.version`（工作流注释还记录了历史上读错位置导致 KeyError 的经过）。
- 影响：维护者按文档去改一个不存在的键，改不到版本；同时文档与工作流对「版本唯一来源」的描述互相矛盾。
- 建议改法：

~~~diff
-# `version` in pyproject.toml must already be the new number, and the commit must be on main
+# `__version__` in src/docproof/__init__.py must already be the new number, and the commit must be on main
~~~

  :52 的表格行与 :122 的流程描述同源，建议一并改为「读取 pyproject 中 hatch 指定的版本文件」。

### 4.2 PyPI 首发日期与元数据不一致（Medium，Category C）

- 位置：README.md:293
- 原文：`... neither survived docproof actually going up on PyPI on 24 August 2026.`
- 证据：
  - PyPI JSON：`0.2.1` 上传时间 2026-08-21T18:48Z（+08 为 8 月 22 日），`0.2.3` 为 2026-08-24T15:53Z，`0.2.4` 为 2026-08-31T08:19Z；
  - git 历史：`d3c10bc`（2026-08-22）标题为 `0.2.1, which exists so that pip install docproof resolves`；
  - 同一仓库 RELEASING.md:71-75 写的是「0.2.1、0.2.2、0.2.3 发布时 README 仍写着 Not on PyPI yet，0.2.4 修好」——与「24 August 才上 PyPI」不一致。
- 影响：一篇以「文档必须可核对」为主旨的 README，自己带了一个可被 PyPI 元数据证伪的日期。
- 建议改法：改为首发版本与日期，例如 `docproof actually going up on PyPI with 0.2.1 on 22 August 2026`；若原意是 0.2.3（8 月 24 日），则写明是哪个版本。

### 4.3 同一段测量说明在 README 中出现两次（Medium，Category A）

- 位置：README.md:126-132 与 README.md:284-289
- 证据：两处都写「full clone reports `1 broken` and exits 1 / `--depth 1` reports "Nothing contradicted" and exits **0**」以及「permanently green gate that had judged nothing」；126-132 已用 `[Requirements](#requirements) has the rest.` 指向专节，专节（284-289）又完整复述同一测量。
- 影响：同一信息两处维护，改一处忘另一处就会自相矛盾。
- 建议改法：保留 Requirements 专节的完整说明；把 126-132 收敛为指针：

~~~diff
-**Both lines are load-bearing, and the action refuses to run without the first.**
-`actions/checkout` gives you depth 1 unless you ask otherwise, and a clone with its history
-cut off cannot tell a deleted file from one that never existed. Measured on `pallets/click`:
-a full clone reports `1 broken` and exits 1, and the same repository at `--depth 1` reports
-"Nothing contradicted" and exits **0**. A silent version of this check would hand you a
-permanently green gate that had judged nothing, so it fails with the one-line fix in the
-message instead. [Requirements](#requirements) has the rest.
+**Both lines are load-bearing.**
+`actions/checkout` gives you depth 1 unless you ask otherwise, and a shallow clone cannot
+tell a deleted file from one that never existed. [Requirements](#requirements) has the
+measurement, the failure mode, and the rest.
~~~

## 5. 判定不改 / 留待人工

| 位置 | 判定 | 理由（边界） |
| --- | --- | --- |
| README.md:37-45 | 不改（演示性内容） | 作者明确说明这是真实运行输出、刻意不修正；改它反而变成 mock-up |
| FINDINGS.md:77 | 不改（历史记录） | 带日期（2026-08-31）的快照，且文中已声明 watcher 停止、数字会失效 |
| RELEASING.md:97 | 不改（仍成立） | 「Marketplace URL 返回 404」为 2026-08-18 的检查；2026-10-18 复测仍 404 |
| RELEASING.md:81 | NEEDS_HUMAN（版本指代歧义） | 现在版本是 0.2.4（`__version__`、tag、README pin 一致），文中「`0.1.0` … meant literally」是沿用 0.1.0 时期的成熟度声明还是漏更新，属语义决策；默认建议 `0.1.0` → `0.x`，不静默改 |
| README.md:344 | 不改（复测可达） | 审计期间本机两次 fetch 失败；2026-10-18 复测（含同域根路径）均 200，链接有效。保留「不可达≠失效」的保守判定 |
| README.md:178-180 | NEEDS_HUMAN（无法复核的测量） | 「16 个知名项目只发现 1 个问题」依赖当时外部仓库快照，仓库内无复现脚本与日期 |

## 6. 机器可读报告

汇总：`files_audited=4, examined=11, fixed=0, needs_human=2, no_action=4`。完整 findings 见 [case-study-docproof.report.json](./case-study-docproof.report.json)，由 CI 用 references/report.schema.json 校验。

> 报告模式下 `fixed=0` 表示未落地改动；5 条 `action=replace` 是建议 diff，不是已实施。

## 7. 复验

- 重复执行 P2 预扫：候选清单一致（308 条），无新增证据点；
- 报告 JSON 通过 `references/report.schema.json` 校验；
- 全程未修改被审计仓库：审计前后 `git status` 均干净（只在临时克隆内读取与运行）。

## 8. 对 skill 的反馈

- **「不改」也要有证据**：本仓库最容易误伤的是历史快照与刻意保留的运行输出，需要「判断边界 + 反误报清单」而不是更激进的删除规则。
- **跨源核对是 Category C 的关键**：版本位置靠「配置 + 工作流 + 源码」三方对齐，日期靠「PyPI 元数据 + git 历史 + 同仓库另一文档」互证；单看一处会漏。
- **A 类（去冗余）在真实仓库里也存在**：同一测量说明在 README 两节重复，靠「同一句 grep 两次命中 + 指向专节的指针」即可证明，不需要语感。
- 已在 v1.5.0 的 SKILL.md / audit-checklist / drift-playbook 中补充对应检查项。
