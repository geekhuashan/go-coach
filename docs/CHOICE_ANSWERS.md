# 文字判断和数眼题 API 契约

本兼容层用于家庭私用、逐题核对过的书本判断题。它不包含真实书题，也不执行导入或部署。当前只实现 Cloudflare Worker 与网页；Python 本地服务及 Python 导题预校验尚未同步，不能用其旧校验器处理这类题。

## 题库 JSON

沿用已有题目的 `id/title/prompt/hint/skill/difficulty/size/stones/to_play/marks/source` 字段。新增部分如下，棋盘只是待观察的原图，不用落子代表选项：

```json
{
  "sequence": false,
  "choices": [
    {"id": "0", "label": "0"},
    {"id": "1", "label": "1"},
    {"id": "2", "label": "2"},
    {"id": "3", "label": "3"}
  ],
  "objective": {"kind": "choose_answer", "answer": "0"}
}
```

`choices` 保持录入顺序，包含 2–8 项。ID 是 1–32 字符的字母、数字、下划线或短横线字符串；标签是 1–80 字符的非空字符串。ID、标签分别唯一。正确答案必须精确匹配已有 ID 的字符串，数字 `0` 无效，字符串 `"0"` 有效。不能提供落子答案树。支持已登记技能、9/19 路棋盘及题干定位标记；初始棋块必须有气。

二选一例子：`[{"id":"real","label":"真眼"},{"id":"false","label":"假眼"}]`、`能/不能`、`活/死`。选项标签不会被当作 HTML。来源要求 `kind=book`、`usage=household_private`、`answer_verified=true`，并附书名、页码和题号。

提示、题干、来源备注和题干标记属于公开信息，录题者仍须确认它们不提前写出正确答案。兼容层不能从任意自然语言中自动辨认泄题。

## 公开接口与提交

`GET /api/lessons`、`GET /api/state` 的题目包含 `interaction: "choose_answer"` 和同序 `choices`；不返回 `objective`、`answer`、`tree`、`solution`、`solutions`。

通过现有认证、CSRF 和 revision 并发约定调用 `POST /api/action`，动作体为：

```json
{"type":"submit_answer","answer":"0","revision":42}
```

`revision` 应替换为最新状态的实际值。只接受本题选项 ID；空值、数字、未知 ID、重复提交均拒绝。选择和提交不添加落子、不改棋盘、执棋颜色、提子、历史或手数，也不启动 KataGo。`assessment.selected_answer` 只回传用户提交的 ID，错答仅给通用反馈；不会返回正确选项。

正确/错误按已有首答证据和复练逻辑记入学习记录。首次未受帮助且正确作答获得原规则的 10 XP；重复提交拒绝，重练不刷 XP；先答错再重练答对也不补发首答 XP。

`solution` 是显式查看参考答案：返回 `demo_active=true` 和 `demo_answer:{id,label}`，保持棋盘与手数不变；记录已受帮助。`restore_demo` 恢复原题状态并移除 `demo_answer`，帮助标记继续保留。之后正确作答不获得未受帮助的首答 XP。`retry` 重置当前选择/判分，保留既有学习证据。

## 网页与验证

使用按钮选择后再提交，重练、换题、换档案时清空未提交选项。判断题棋盘不接受落子。900 px 以上横屏使用棋盘左侧、答案右侧布局，其余宽度保持单列。

`npm run test:cloud`：68 项通过，包含 schema、公开字段过滤、字符串 0、非法/重复提交、棋盘不变、错答复练、参考答案恢复、辅助判分和 XP；既有落子与选择棋子题测试继续通过。

本地 Chromium 实际作答：数眼错答 2 → 重练 → 0 正确；显式参考答案显示 0，返回后隐藏；活/死题选“死”正确，moves=0。1024×768 横屏和390×844手机截图见 `output/playwright/`。未用真实 iPad Air 2 / Safari 设备实测。
