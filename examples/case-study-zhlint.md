# 真实仓库审计案例：zhlint（报告模式）

> 审计对象：[zhlint-project/zhlint](https://github.com/zhlint-project/zhlint) @ `c8678fe`（2025-07-12）
> 审计日期：2026-10-18；模式：报告模式（外部仓库只读审计，未向上游提交改动，`fixed` 计 0）
> 方法：md-doc-optimizer 的 P1–P3 + P2 预扫（markdownlint-cli2、链接探测、npm pack 产物核对、git 历史）
> 结果：审查 16 处 → 建议改 11 处（High 3 / Medium 7 / Low 1），判定不改 5 处

## 1. 为什么选这个仓库

- 它是本 skill 中文规则里实际使用的 lint 工具，文档与代码都在一个仓库，适合核对「文档是否仍对代码成立」；
- 14 个 Markdown 文件里既有对外 README，也有**生成的** README、**手写翻译**、**测试夹具**和**设计草稿**，是练习「判断边界」的理想样本；
- 有发布脚本（`package.json` 的 `docs:readme` / `prepublish`），可以验证「生成物不能手改」这条规则。

## 2. 事实来源清单

| 事实来源 | 用途 | 位置 |
| --- | --- | --- |
| src/run.ts | API 返回结构 | `Result` 类型 |
| vite.config.ts + package.json | 构建产物文件名 | `fileName`、`unpkg`/`jsdelivr` |
| npm 已发布产物 | 实际 dist 文件 | `npm pack zhlint@0.8.2` |
| scripts/gen-readme.mjs | README 生成关系 | 读 `docs/index.md` 写 `README.md` |
| git 历史 | 生成物是否被手改 | `git show 0ebe7ea --stat` |
| 远程仓库默认分支 | 链接目标是否存在 | `origin/HEAD → main`，文件为 `.ts` |

## 3. P2 预扫（候选清单，不是结论）

~~~bash
npx --yes markdownlint-cli2 "**/*.md"
# 14 files → 198 issues in 13 files：大量来自 test/ 夹具与默认风格规则（MD041/MD047/MD013 等）

# 外链：docs/index.md + README.md + README.zh-CN.md 共 11 个唯一外部链接
# 逐个探测：8 个 200，3 个 404（均指向 github.com/.../tree/master/src/hypers/*.js）

grep -n "TODO" docs/design.md test/*.md   # 命中设计草稿注释与测试夹具
~~~

198 条候选里，最终只有 11 处被证据确认；其余是测试夹具、设计草稿与默认风格规则噪声。

## 4. 逐条核对

### 4.1 三个失效链接：master 分支 + .js 扩展名（High，Category B）

- 位置：docs/index.md:186（生成物 README.md:174、手写翻译 README.zh-CN.md:174 同源）
- 原文：`[ignored cases parser](https://github.com/zhlint-project/zhlint/tree/master/src/hypers/ignore.js)`（另两个为 `md.js`、`hexo.js`）
- 证据：三个 URL 实测均 404；仓库默认分支为 `main`（`origin/HEAD → main`），对应文件为 `src/hypers/ignore.ts`、`md.ts`、`hexo.ts`；改为 `blob/main/.../*.ts` 后实测均 200。
- 影响：读者点开「默认解析器」的实现链接会 404，共 3 个 URL、3 个文件里合计 9 处。
- 建议改法：改 `docs/index.md` 源文件，再 `pnpm docs:readme` 重新生成 README；README.zh-CN.md 需手工同步。

### 4.2 独立版文件名写错：dist/zhlint.js 不存在（High，Category C）

- 位置：docs/index.md:153（README.md:141、README.zh-CN.md:141 同源）
- 原文：``You could find a JavaScript file `dist/zhlint.js` as a standalone version.``
- 证据：
  - `vite.config.ts:14` 的 `fileName` 为 `` `zhlint.${format}.js` ``，构建格式为 es/umd；
  - package.json:10-11 的 `unpkg`/`jsdelivr` 均指向 `./dist/zhlint.umd.js`；
  - `npm pack zhlint@0.8.2` 的 `dist/` 只有 `zhlint.es.js`、`zhlint.umd.js`（含 sourcemap），**没有** `dist/zhlint.js`。
- 影响：按文档去引用 `dist/zhlint.js` 会 404。
- 建议改法：改为 `dist/zhlint.umd.js`（浏览器 `<script>` 场景）。

### 4.3 API 返回字段名写成 value，实际是 result（Medium，Category C）

- 位置：docs/index.md:164、:241（README.md:152、:229；README.zh-CN.md:152、:229 同源）
- 原文：``It contains fixed text content as `value` ...``
- 证据：src/run.ts 的 `Result` 类型字段为 `result: string`；同一文档 Output 一节（docs/index.md:224）自己写的是 `result`: the finally fixed text content；Node.js 示例也用 `output.result`。
- 影响：使用者会去找不存在的 `value` 属性。
- 建议改法：把 `value` 改为 `result`；顺带修正同句 typo `infor`。

### 4.4 生成的 README 被手改，下次发布会被覆盖（High，Category C）

- 位置：README.md:27、:30（与源文件 docs/index.md:31、:34 不一致）
- 证据：
  - `scripts/gen-readme.mjs:27,33`：读 `docs/index.md`，写 `README.md`；
  - `package.json:40` 的 `docs:readme` 与 `:44` 的 `prepublish`（`pnpm run docs:readme`）会在发布前重新生成 README；
  - `git show 0ebe7ea --stat`：该提交只改了 `README.md`、`README.zh-CN.md`、`bin/index.js`，**没有改** `docs/index.md`；两份 README 已加入 `[, ...]` 新语法（README.md:27,30），而源文件仍是旧语法（docs/index.md:31,34）。
- 影响：下游用户现在看到的是新语法；但下次执行 `prepublish`/手动 `docs:readme` 时，README 会被源文件覆盖回旧语法——文档改进会静默丢失。
- 建议改法：把 `[, ...]` 两行同步进 `docs/index.md`，然后重新生成 README，并手工同步 README.zh-CN.md；不要只手改生成物。

### 4.5 预处理器清单漏了 vuepress（Medium，Category B）

- 位置：docs/index.md:285-289（README.md:267-271 生成同源）
- 原文：「Supported preproccessors」只列 `ignore`、`hexo`、`markdown`。
- 证据：src/options.ts:31-35 注册了 `ignore`、`hexo`、`vuepress`、`markdown` 四个预处理器，:108 默认全部启用；docs/index.md:186 的默认解析器描述同样漏了 vuepress。
- 建议改法：列表补 `vuepress`（链接指向 `blob/main/src/hypers/vuepress.ts`），并在 hyperParse 段同步。

### 4.6 ignoredCases 示例传了对象而非数组（Medium，Category C）

- 位置：docs/index.md:276（README.md 生成同源）
- 原文：`run(str, { ignoredCases: { textStart: '( ', textEnd: ' )' } })`
- 证据：src/options.ts:11 类型为 `ignoredCases?: IgnoredCase[]`；src/ignore.ts:27 直接 `ignoredCases.forEach(...)`，传对象会在运行时抛错。
- 建议改法：`run(str, { ignoredCases: [{ textStart: '( ', textEnd: ' )' }] })`。

### 4.7 Output 类型定义与代码不符（Medium，Category C）

- 位置：docs/index.md:202-218（README.md 生成同源）
- 证据：文档的 `Result` 没有 `result: string`，并把 `disabled` 写成必填；`Validation` 缺 `name`、`target`。实际类型见 src/run.ts:32-39（`result: string`、`disabled?: boolean`）与 src/report.ts:63-74（`name`、`target`）。
- 建议改法：按源码同步类型块（并把 4.3 的字段名统一为 `result`）。

### 4.8 CommonJS 示例与 ESM 包不符（Medium，Category C）

- 位置：docs/index.md:96、:134（README.md 生成同源）
- 原文：`const { run, report } = require('zhlint')`、`const { readRc, runWithConfig } = require('zhlint')`
- 证据：package.json:8 `"type": "module"`；tsconfig-build.json:6 `module: NodeNext`；已发布的 lib/index.js 为 ESM `export`。ESM 包用 CommonJS 示例只在较新 Node（require(esm)）下可用，包未声明 engines。
- 建议改法：示例改为 `import { run, report } from 'zhlint'`（并同步 4.9 的模块格式描述）。

### 4.9 贡献文档的命令清单过时（Medium，Category B）

- 位置：docs/contribute.md:17-40
- 证据：清单列出的 `build:js`、`build:type`、`format`、`docs` 在 package.json:22-43 中不存在；实际有 `build:node`、`build:browser`、`lint:fix`、`lint:eslint`、`test:tsc`、`test:vitest`、`docs:runtime`、`docs:readme` 等，清单缺失。
- 建议改法：按 package.json 的实际 scripts 重写命令树。

### 4.10 贡献文档的产物格式与配置路径过时（Medium，Category C）

- 位置：docs/contribute.md:44-47、:99
- 证据：`bin`/`lib` 标为 CJS，但 package.json:8 为 `"type": "module"`；`Type defs: ./dist/zhlint.d.ts` 与 package.json:12 `types: ./lib/index.d.ts`、tsconfig-build.json:10,12（`declaration` + `outDir: lib`）不符；`vite.config.js` 实际是 `vite.config.ts`。
- 建议改法：改为 ESM、`./lib/index.d.ts`、`vite.config.ts`。

### 4.11 默认配置值与代码不符（Low，Category C）

- 位置：docs/index.md:308、:368（README.md 生成同源）
- 证据：`halfwidthPunctuation` 注释写默认 `()`，实际 src/rules/index.ts:50 为 `()[]{}`；`skipAbbrs` 写 `'a.k.a'`，实际 :80 为 `'a.k.a.'`。
- 建议改法：按源码修正注释中的默认值。

## 5. 判定不改（边界）

| 位置 | 判定 | 理由（边界） |
| --- | --- | --- |
| test/example-units.md:3 | 不改（测试夹具） | `(x)`/`(y)` 与 `TODO: should be ...` 是测试输入，测试断言依赖这些「错误」 |
| test/example-units-fixed.md:3 | 不改（测试夹具） | 同上，是「修复后」的期望输出 |
| test/example-article.md:11 等 | 不改（测试夹具） | 引自 Vue 文档的测试文章，相对链接在夹具语境中无意义 |
| docs/design.md:48 等 | 不改（设计草稿） | `<!-- TODO: an example -->` 等是设计文档中的 WIP 注释，属计划内容 |
| README.md:119 | 不改（有意的结构） | 两处同名的 `#### Advanced usage` 分属 CLI 与 Node.js 两个不同父节点，不是重复标题 |

## 6. 机器可读报告

汇总：`files_audited=14, examined=16, fixed=0, needs_human=0, no_action=5`。完整 findings 见 [case-study-zhlint.report.json](./case-study-zhlint.report.json)，由 CI 用 references/report.schema.json 校验。

> 报告模式下 `fixed=0` 表示未落地改动；11 条 `action=replace` 是建议 diff，不是已实施。

## 7. 复验

- 修正后的 3 个链接逐个探测 200；`npm pack zhlint@0.8.2` 产物清单再次确认无 `dist/zhlint.js`；
- 重复执行 P2 预扫：候选清单一致，无新增证据点；
- 报告 JSON 通过 schema 校验；被审计仓库全程只读。

## 8. 对 skill 的反馈

- **生成物要先找生成器**：只看 README 会以为语法已更新，看 `gen-readme.mjs` + `prepublish` + git 历史才发现「改在生成物上」的漂移。已在 drift-playbook 增加「生成文档识别与核对」步骤。
- **测试夹具必须整类排除**：夹具里的坏链接/TODO 是内容本身，逐条修会破坏测试；已在 SKILL.md 判断边界与 audit-checklist 反误报清单中显式列出「测试夹具/示例数据」。
- **链接要验目标存在性，不只看跳转**：3 个 404 同时暴露「分支名 + 扩展名」两个错误，需以仓库默认分支与当前文件列表为准。
- **源码类型与模块格式能批量证伪 API 文档**：`run()` 返回字段、Output 类型块、CJS/ESM 示例三处都能用类型定义直接核对，不需要运行。
- **贡献/开发文档是最容易过时的部分**：命令清单、产物路径、配置文件名都要对着 `package.json` 与 `tsconfig` 复核，建议列为 P2 重点。
