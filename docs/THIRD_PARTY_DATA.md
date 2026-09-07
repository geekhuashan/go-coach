# 第三方围棋题目数据

## Go Game Guru

本项目包含 Go Game Guru 的 Weekly Go Problems 数据，作者为 **David Ormerod 与 An Younggil**。原仓库：[gogameguru/go-problems](https://github.com/gogameguru/go-problems)。固定来源提交为 [`eee12b2e39d59dbe81a8b9eaa7d4f103978d9224`](https://github.com/gogameguru/go-problems/tree/eee12b2e39d59dbe81a8b9eaa7d4f103978d9224)，不会随上游分支自动更新。

原题、原英文讲解及由它们转换出的结构化题目遵循 **Creative Commons Attribution–NonCommercial–ShareAlike 4.0 International（CC BY-NC-SA 4.0，署名—非商业性使用—相同方式共享）**。完整许可保存在 [UPSTREAM_LICENSE](../data/gogameguru/UPSTREAM_LICENSE)，原项目说明保存在 [UPSTREAM_README.md](../data/gogameguru/UPSTREAM_README.md)。亦可核对[该提交的原许可](https://github.com/gogameguru/go-problems/blob/eee12b2e39d59dbe81a8b9eaa7d4f103978d9224/LICENSE)与[许可说明](https://creativecommons.org/licenses/by-nc-sa/4.0/)。

使用、展示或再分发这些数据时须保留作者署名、来源与许可证说明，注明做过的转换；仅限许可允许的非商业用途，分发改编题目时须按相同方式共享。题目数据的许可与应用代码许可分开；此数据导入没有为本项目代码添加或更换许可证，也不表示作者为本应用背书。

## 转换范围与验证结果

已保存原仓库 easy / intermediate / hard 各 140 道，共 **420 道**原始题，另保留该快照的 2 个 other 文件及 1 个 template 文件作为来源内容；后 3 个文件不计入题库。所有原题均为 **19 路**，保持原坐标、棋盘边界和初始棋子，没有裁成 9 路。

目前 **417 道进入结构化可练题库**，三个级别各 139 道。源分类只是作者的相对难度，应用显示为 3 / 4 / 5，不推断段位。来源原文件、逐文件 SHA-256、启用状态与原因见 [manifest.json](../data/gogameguru/manifest.json)；供云端导入的结果见 [lessons.json](../data/gogameguru/lessons.json)。

本次自写 SGF 解析器，没有复制其他项目的转换器。保留作者英文注释，增加中文通用操作提示、许可来源字段，并提取通向作者明确成功标记的变化。没有自动翻译作者判断或用模型补写答案。

- SGF 的 `C` 是节点注释；原集合没有 `TE` / `BM` 属性。仅将以 `Correct`、`Also correct` 或 `This is also correct` 开头的作者注释视作明确成功标记。`Almost correct` 不算成功。
- 正确标记可能出现在先行方落子后，也可能出现在对手应手后，例如明确写明形成劫。到达该节点表示**完成作者收录的变化**，不等于本程序独立证明死活、无条件吃净或唯一最佳着。
- 只激活能够到达明确成功标记的路径。其他未标明结果的变化保留在原始 SGF，未擅自标为错误；用户走到未收录的合法变化时应显示“未收录，暂不判错”。
- 每道启用题的原始整棵变化树均经过合法初局、交替落子、提子、自杀及全局同形禁着回放；提取后的成功变化又独立回放一次。作者 SGF 标的是日本规则，本程序采用全局同形禁着，因此来源合法性与本应用规则兼容性分别对待。
- 激活树限 31 手、256 个节点、每节点 16 个变化；没有激活含停一手的路径。没有把未标注叶子、主变化排序、引擎胜率或推测当作正确答案。

以下 **3 道只归档，未激活**：

| 原题 | 原因 |
| --- | --- |
| `ggg-easy-102` | 原始变化第 7 手还原已出现局面，不符合本应用全局同形禁着规则。 |
| `ggg-intermediate-50` | 原始 SGF 末尾多出一个右括号；未擅自修复并当作原作者版本。 |
| `ggg-hard-80` | 提取出的答案变化超过当前 31 手限制。 |

## 重现

从已有原文件重建，并执行解析器与成功标记自检：

```sh
python3 scripts/import_gogameguru.py --self-test
```

重新下载**同一个固定提交**再转换：

```sh
python3 scripts/import_gogameguru.py --download --self-test
```

命令只在本机写入 `data/gogameguru/`；不会发布到 GitHub、登录家庭站点或上传照片。云题库发布由应用的独立发布流程完成，并继续携带来源、署名与许可字段。
