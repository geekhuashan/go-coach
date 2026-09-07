# GGG 作者反驳补充数据

`review-variations.json` 独立保存原始 SGF 中已有、但正确答案树未保留的明确失败评论。当前扫描已导入的 417 题，导出 **27 题、68 个完整落子前缀**：66 个带紧接的一手对手反驳，2 个在用户落子节点已有作者明确失败评论；其中 9 个可在用户第一手后直接命中。

## 消费接口

```json
{
  "version": 1,
  "lessons": {
    "ggg-example-id": [
      {
        "moves": [[15, 18]],
        "verdict": "author_refuted",
        "reason": "作者原始评论",
        "reason_zh": "人工中文释义",
        "pvReply": [[17, 18]],
        "source_path": "weekly-go-problems/easy/example.sgf#node=1.0"
      }
    ]
  }
}
```

坐标为零起始 `[x,y]`。`moves` 是从题目初始局面开始、含双方每手、截至本次用户落子的**完整历史**；只有历史长度和每个坐标完全相等才命中。不能将其当作任意局面坐标提示，不能用前缀匹配把后续失败倒推到更早的走法，也不能把其中某个中间用户落子单独判错。

`pvReply` 是紧接用户落子后、带明确作者失败评论的原 SGF 对手一手。为空时作者已在用户落子节点写明失败。`evidence_at` 为 `reply` 或 `move`，`evidence_moves = moves + pvReply`；`evidence_labels` 保留作者评论引用的 A/B 等棋盘标记。`source` 保留来源链接、CC BY-NC-SA-4.0 许可、作者归属及原始 SGF 节点路径。

`author_refuted` 表示原作者对此精确变化的判定；它不是引擎独立死活证明，也不是全局分数评价。显示原作者理由时应保留来源与这种范围。数据未命中仍为未知，不能自动判错。

## 保守提取规则

生成脚本 `build_review_variations.py` 使用逐条人工审阅的精确评论白名单，如 `Black's dead.`、`Black can't make two eyes.`、`This ladder doesn't work for Black.`。仅处理黑先且明确失败一方为黑棋的题；不会从分支顺序推测失败。

不采用 `can do better`、`have another go`、仅表次优/风格差异的评论、对手失误评论、无评论分支或 `This isn't wrong` 否定句。字面 `incorrect/wrong/refutation` 搜索仅找到后一条否定句，因此此文件依赖明确的作者失败描述，而非虚构 Incorrect 标签。

已达到作者 Correct 节点的后续演示不参与；当前正确答案树中的完整前缀也不参与。停一手路径不导出，本轮仅有 easy-44 的两个子树因此跳过。没有借停一手修复非法落子，没有将未标记分支补成反驳。

## 重建和验证

在项目根运行：

```sh
python3 data/gogameguru/build_review_variations.py
```

生成器只写本补充数据和 `review-variations-validation.json`，不改 raw SGF、原题库或现有导入器。读取固定本地来源并核对局面与已导入题一致，逐路径检验交替落子、提子、自杀禁着及全局同形禁着；导出后独立再次重放全部 `moves + pvReply`。验证记录包含逐手提子数、原 SGF SHA-256、节点路径和跳过原因。

## 中文说明与实际可达覆盖

生成脚本内 `REASONS_ZH` 为 30 条白名单评论逐条人工撰写中文释义；每条输出的 `reason_zh` 用于中文展示，`reason` 和 `source.comment` 始终保留作者原文。A/B/C/D 标签照原文保留，未补写作者没有解释的失败原因。

在当前只沿正确答案树进行的正常练习里，`moves[:-1]` 仍位于正确树的“第一手偏离”共有 **12 个完整前缀，覆盖 6 道题**。其余 56 项只有在产品支持继续探索答案外变化、且用户完整历史精确到达该位置时才会命中。68 项不能当作正常练习第一手偏离的覆盖数。验证记录的 `first_offbook_prefixes` 和 `first_offbook_lessons` 保存这两个指标。
