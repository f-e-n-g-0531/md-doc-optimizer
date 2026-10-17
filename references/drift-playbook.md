# 文档 vs 代码漂移核对手册（drift-playbook.md）

「事实不符」多数来自文档落后于代码。本手册给出可复现的核对顺序；每一步都要落到具体文件与行号，禁止凭印象。

## 1. 建立事实来源清单

在动文档前，先列出本文档声称描述的「真相源」：
- 代码文件（对应 CLI 参数、默认值、返回结构、路径、常量）
- 配置文件（默认配置、开关、环境变量）
- 清单文件版本（package.json / pyproject / requirements / go.mod / Cargo.toml）
- 发布记录（CHANGELOG / release notes / tags / git tag）
- 生成物（schema、接口定义、构建输出）

## 2. 逐条比对（按 SKILL.md 的目标 C 信号）

- 文档中有名字/参数/取值 → 在代码里搜同一标识符，看是否存在、是否改了名、默认值是否变化。
- 文档声称「某命令可运行」 → 实际执行，记录 stdout/退出码；跑不通即 run-failed 证据。
- 文档有版本号/日期 → 与清单文件、git tag、CHANGELOG 比对。
- 文档引用路径/脚本 → 用文件系统核对存在性；用 git log --oneline -- 路径 看是否被删/改名/移动。

## 3. 用 git 定位漂移时间

- git log -p -- 文档路径 ：看文档最后实质更新时间。
- git blame 文档相关行 ：看某句是谁/何时写入。
- 对「文档写 X，代码已改 Y」的条目：git log -S "X" --oneline 定位代码侧变更提交，确认是代码先变、文档未跟上。

## 4. 自动化复跑（优先用工具，而非肉眼）

- 链接：lychee / markdown-link-check 出死链清单。
- 示例代码：mdoctest / markdown-doctest 复跑并核对输出。
- 硬校验：docproof 解析「路径 / flag / 版本 / import」并对照代码与 git 历史。
- OpenAPI 文档：Redocly respect 跑行为/安全回归，确保文档与 API 一致。

## 5. 处置边界

- 证据确凿 → 改文档到与代码一致。
- 证据表明「代码本身可能不对」或「到底是废弃还是 bug 说不清」 → 出报告/issue，标 NEEDS_HUMAN，不改。
- 文档另有权威上级来源（官方文档/产品决策） → 不回改成与代码相反，而是标 DUBIOUS 并说明分歧。

## 6. 生成文档：先找源文件，再谈修改

被生成出来的 README/docs 只能改生成器和源文件，改产物会被下一次生成覆盖（或掩盖真正的漂移）。

识别生成关系的线索：

- 脚本与发布钩子：package.json 的 `docs:*` / `prepublish`、Makefile、CI 的 docs 任务、`scripts/gen-*.mjs`；
- 结构特征：README 与 `docs/index.md` 高度相似但略有差异；文件头有 "generated" 标记；
- git 历史：`git log --stat` 显示某次提交只改生成物、没改源文件 → 有人手改了生成物。
- 预扫脚本的 `near-duplicate-files` 候选：两个文件行集合高度相似时，优先怀疑「生成副本/复制粘贴」关系，再按生成关系核对。

核对与处置：

1. 在**临时副本**里执行生成命令，再 diff 生成物；能复现的差异就是待修漂移。
2. 修源文件 → 重新生成 → 复验 diff 只含目标改动。
3. 手写翻译/多语言副本若不由同一脚本生成，单独同步，别假设会被重新生成。

案例：zhlint 的 README 由 `scripts/gen-readme.mjs` 从 `docs/index.md` 生成，某次提交只改 README 和中文 README、没改源文件；下次 `prepublish` 会把这次改进覆盖掉（见 examples/case-study-zhlint.md）。

## 7. 链接核对的三个陷阱

1. **默认分支改名**：`tree/master/...` 在默认分支为 `main` 的仓库上直接 404；以仓库默认分支为准。
2. **文件改名/迁移**：`.js` → `.ts`、目录重组都会让旧链接失效；404 后到仓库树里找当前路径，不靠猜。
3. **可达 ≠ 语义匹配**：链接检查工具只证明 HTTP 200；链接文本是否指向声称的内容，要另开目标页核对。本机网络失败的链接标 UNREACHABLE，不等于失效。
