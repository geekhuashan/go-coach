# 家庭云端围棋服务

此目录只实现 Worker 后端。静态页面和 PWA 位于项目 `static/`；部署配置、D1 binding 与秘密值由根目录部署流程管理。

- `worker.mjs`：家庭登录、设备独立档案选择、D1 状态、CAS、学习/对局历史、评级、结构化题导入、迁移、LLM 和引擎桥接。
- `rules.mjs` / `game.mjs`：9/19 路规则、全局同形禁着、基础题、连续变化题、对弈、悔棋、演示及 SGF。
- `curriculum.mjs`：新题完整合法性校验、学习证据和推荐。作者答案题只核对作者收录终点，不声称已用规则证明死活。
- `auth.mjs`：7 天签名会话、常量时间比较、AES-GCM 密钥加密。
- `builtin-lessons.json`：仅服务端导入，含来源许可；公开题目列表不包含答案树。

## 部署约定

D1 binding 为 `DB`，静态 binding 为 `ASSETS`。迁移按 `migrations/` 顺序应用。

秘密环境变量：`FAMILY_PASSWORD_HASH`（强家庭密码的 SHA-256 十六进制）、`SESSION_SECRET`（至少 32 字符的随机值）。可选 `HOUSEHOLD_ID`，默认为 `home`。不提供注册接口。

登录 cookie 为 HttpOnly、Secure、SameSite=Strict；`go_profile` 只控制该浏览器选择的档案。所有与局面有关的 POST 必須带 `revision` 和 `expected_profile_id`，后者来自刚读取的 `state.profile.id`。切档案的 `profile_id` 是目标，而 `expected_profile_id` 是当前档案。家庭 LLM 设置修改只需 revision；登录和显式连接测试不依赖棋局。

家庭所有人共享登录密码，档案用于分开记录，不是彼此隔离的个人账号权限。

## 计算服务

可选 `ENGINE_PRIMARY_URL` / `ENGINE_PRIMARY_TOKEN` 配置 fnOS 深度通道，`ENGINE_URL` / `ENGINE_TOKEN` 配置 VPS 快速通道。Worker 以 Bearer token 发送：

- `POST /analyze {state}` → 原 KataGo 分析格式（包含 revision）。
- `POST /move {state}` → `{x,y}` 或 `{pass:true}`。
- `POST /review {state}` → 同一局面的候选点与参考点成对分析。

实战 `/move` 直接优先 VPS，失败后只回退一次 fnOS；`/analyze` 和用户显式触发的 `/review` 优先 fnOS，fnOS 正忙或故障时改用 VPS。只发送棋盘、初始摆子、落子历史、尺寸和执棋方；不发送家庭名字、学习文字或密钥。两条通道都超时、离线或正忙时返回 503，不无限排队；练题和双人模式继续可用。

LLM 经用户在设置中显式启用后使用所填 OpenAI 兼容 HTTPS 服务。密钥用 SESSION_SECRET 派生的 AES-GCM 密钥加密存于 D1，读取设置不返回密钥。更换服务地址清除旧密钥，连接测试不发送棋盘。语言模型只讲解，不决定落子。

## 保存和评级

家庭 revision 在 D1 batch 事务中 CAS 更新，全部附属写入由同次唯一 op token 限定。冲突返回 409 和最新局面，不重放旧动作。档案、对局、首次证据、作答历史、想法和模型讲解分表存储；常规状态只读最近 10 次作答、最近 5 局及按知识点的首次证据。

- 每家最多 20 个学习者、2048 道自定义题；单条结构化题请求最多 256 KiB。
- 每局最多 1000 手；单份棋局序列化最多 1.5 MB，防止碰到 D1 单值大小限制。
- 本机迁移请求最多 5 MiB，只能写入未开始练习的云端家庭；事务成功前不覆盖任何进度。导入只接受结构化题和白名单记录，不接受原图或 LLM 配置。
- 历史不自动删除。`/api/history` 每页最多 50 条作答，`next_before` 用于继续读取；附最近 50 条想法和讲解。
- 练习 XP 只奖励不同题目的首次独立正确作答。辅助、悔棋、未收录变化和重做不用于刷分。
- 双停只表示对局结束，不自动判胜。认输或双方各自档案确认结果才计统计；重复确认与恢复历史不重复计分。
- 人机与双人、9 路与 19 路胜率分开。`rating.summary_size` / `summary_mode` 明确顶层摘要范围；`by_size` 展示其它范围。Elo 只用于同尺寸双人人类明确胜负，少于 5 局标暂定，不对应真实围棋段位。

## 本地测试

```sh
node --test cloud/tests/*.test.mjs
```

测试使用内存 SQLite 模拟 D1 事务，不接触生产 D1、正式家庭档案或模型服务。涵盖所有内置连续题的合法路径、9/19 规则、认证、CAS 并发、跨标签页档案校验、限速、加密、评级只计一次与原子迁移。
