# 家庭云端版本

云端使用 Cloudflare Workers 静态资源、Worker API 和 D1。网页与学习数据不依赖 Mac 开机；KataGo 主力跑在同一账号的 Cloudflare Containers，RackNerd VPS 作后备；只有 AI 落子与分析依赖它们在线。

## 部署

需要 Node.js、Cloudflare 账户、D1 和账户内的域名。执行 `npm ci` 后使用 `npx wrangler login` 登录。复制并调整仓库 `wrangler.jsonc` 的 account_id、数据库 ID 和域名，不要覆盖其他项目资源。

1. `npx wrangler d1 create go-coach`，把返回的数据库 ID 写入配置。
2. `npm run db:remote` 应用数据库表结构。
3. 生成高强度随机家庭密码以及至少 32 字符的随机会话密钥。将家庭密码的 SHA-256 十六进制摘要设置为 Worker secret `FAMILY_PASSWORD_HASH`，会话密钥设置为 `SESSION_SECRET`。不要把原密码、摘要或密钥放进 Git。
4. KataGo 用 `wrangler.jsonc` 里的 `containers` 和 `ENGINE` 绑定，需要 Workers 付费版，镜像准备见“可复现的计算服务配置”。VPS 后备另设 secrets `ENGINE_URL`、`ENGINE_TOKEN`：URL 是 HTTPS 服务地址，Token 与 VPS 桥接服务的私有令牌文件相同。
5. `npm run deploy`，验证未登录 API 返回 401，登录后可以读写自己的家庭数据。

已有生产站点更新时，从隔离发布目录构建，并记录来源文件清单、SHA-256 和线上版本。旧临时发布目录可能早于主仓库已上线功能，不能仅凭目录名或 Git HEAD 判断它是完整基线；要核对现网静态资源及最近验证记录，并保留横屏布局、异步换题、棋型回看、视频目录和题型兼容。发布前运行该目录的 Cloud 测试及已导入题型回放；发布后回读静态资源，并核对 D1 题库、棋盘、练习记录和 XP 不变。书题原件和题库中间数据不复制进发布树。

本地云端开发：私有 `.dev.vars` 中设置同名 secrets，运行 `npm run db:local` 和 `npm run dev:cloud`。该文件已被 Git 忽略。实际部署前应在隔离数据上验收，避免向家庭生产库写测试成绩。

## 数据与登录

家庭共用一个登录密码；每台设备独立选择学习者。学习者不是独立安全账户，家人可切换并查看各自记录。登录会话使用 HttpOnly、Secure、SameSite=Strict Cookie，默认 7 天；API 响应不缓存，退出或 401 会清理界面私密内容。

D1 按学习者、对局、作答、掌握证据、想法和讲解分别保存。原始书题照片仍在 Mac，上传的是人工核对并经过规则验证的题目结构。原始个人资料、模型 API Key 不进入静态文件。

数据库位置决定每步棋的等待：一次落子或应手要串行查询 D1 十余次，Worker 与数据库跨洋时每次多一两百毫秒。2026-10-19 起生产库为美西 `go-coach-wnam`，与家庭网关 Worker 的就近部署位置、学习服务 D1、R2 和两条 KataGo 隧道（均接入洛杉矶）同区；原亚太库 `go-coach` 在新库承接真实写入、确认稳定后，于同日按所有者决定删除；迁移前的整库导出只留在本地私密备份。迁移用整库导出导入，超过 D1 单句 100KB 的对局行改用参数写入，新旧两库导出逐字节一致；证据在 `.local/d1-wnam-migration-20261019/`。新建库时用 `--location wnam`，迁移脚本按绑定名 `DB` 调用。

云端 LLM 密钥通过 `SESSION_SECRET` 派生的 AES-GCM 密钥加密保存；会话密钥变更会使旧 LLM 密钥无法解密，应先安排重新配置。不要把单纯的会话密钥轮换当成无状态操作。

## Mac 整理题目与迁移学习档案

`python3 scripts/publish_lesson.py --help` 查看题目校验和发布参数。默认只校验；确认题目后使用 `--reviewed` 发布，密码由私有文件读取。`--dry-run` 不联网。

`python3 scripts/import_local_progress.py --help` 查看本地档案迁移参数。默认 dry-run；`--apply` 才写入。迁移保留本地原文件，剔除模型密钥与照片等非学习数据，拒绝覆盖已经使用的云端家庭库。迁移完成后要回读角色与记录数量。

## KataGo 服务

KataGo 主力跑在 Cloudflare Containers：`cloud/engine-container.mjs` 的 Durable Object `KataGoContainer`（绑定 `ENGINE`）按需启动一个容器（2 vCPU、6 GiB 内存，b10 模型，与 VPS 同一文件）。容器没有公网端口、不能主动连外网，只有这个 Durable Object 能访问；桥接令牌由它第一次启动时随机生成、存在自己的存储里，启动容器时作为环境变量传进去，不需要另设 secret。最后一次请求后闲置 10 分钟自动停机，CPU 按实际用量计费（需要 Workers 付费版）。RackNerd VPS 上的 b10 通道（`ENGINE_URL`、`ENGINE_TOKEN`）作后备。

- 实战 `/move` 和显式 `/review` 先问 Cloudflare，但不等冷启动：容器在休眠或模型还没载入时立即回答“预热中”，这一手改由 VPS 应手，同时在后台载入模型，下一手起由 Cloudflare 应手。容器预算 `/move` 默认 8 秒、`/review` 默认 10 秒，上限 10 秒（`ENGINE_CONTAINER_TIMEOUT_MS`）；VPS `/move` 默认 6 秒、`/review` 默认 8 秒，上限 8 秒（`ENGINE_FALLBACK_TIMEOUT_MS`）。两段相加在网页 22 秒的应手等待之内。成对比较的 128 visits／每点 3 秒预算、最少 24 visits 证据门槛不变，结果注明实际后端；模型意见仍不计对错或通关。
- `/analyze` 允许等 Cloudflare 冷启动，最多 15 秒；失败或正忙再试 VPS，最多 15 秒。

两条通道都忙或超时时明确失败，不无限排队；引擎自身最多等待计算锁 2 秒，单次普通查询最多等待 8 秒。下一次请求仍先试 Cloudflare，不形成永久降级。页面标记实际使用的后端；两端都只计算棋盘，最终落子仍由云端 revision 校验后写入一次。

桥接进程 `engine_bridge.py` 的 `/health`、`/warm`、`/analyze`、`/move`、`/review` 都要 Bearer Token，网络调用不传学习者姓名或家庭密码。VPS 上它只监听回环地址，由 Cloudflare Tunnel 转发；容器里用 `--host 0.0.0.0 --token-env GO_COACH_ENGINE_TOKEN`。

```sh
python3 engine_bridge.py --port 8874 --token-file /absolute/private/engine-token
```

引擎路径通过 `GO_COACH_KATAGO`、`GO_COACH_MODEL` 指定。只开放带鉴权的桥接入口；不要把本地 Python 完整学习接口直接暴露到公网。CPU 服务器需根据实测选择模型与并发限制，不应把能启动等同于落子速度合适。

## 手机与平板

在 HTTPS 页面登录后，可通过浏览器的“添加到主屏幕”安装。触屏点击先预览，再确认落子；棋局或角色变化会取消旧预览。PWA 仅缓存公开静态资源，离线时不能提交对局或练习记录，也不会排队重放旧动作。 带 `?v=` 版本号的静态文件经家庭网关允许浏览器私有缓存一年；改动 static 下被引用的文件必须同时升级引用处的 `?v=`，再运行 `npm run assets:versions` 更新 `cloud/tests/asset-versions.json`。Cloud 测试会拦下内容变了却没升版本的改动，更新命令也不会替它改记录。

棋盘状态读取约 10–12 秒超时，普通棋盘动作 15 秒，落子与 AI 应手 22 秒（覆盖两条计算通道的最坏回退窗口及网络往返），显式复核 30 秒。网页落子带 `reply:true`：若下一手轮到电脑，Worker 在同一次请求里请求实战 `/move`，两手一起提交，revision 只加 1，省掉一次网页往返；等待期间先半透明显示学习者的棋子。引擎失败时仍保存学习者这一手并返回 `ai_error`，网页显示重试按钮，不自动重发。不带该字段的旧页面仍按落子、`ai_move` 两次请求。暂时断线、响应不完整或 5xx 后，网页会主动读取最新 revision；第一次仍失败时约 2 秒后再同步一次。Safari 从后台或锁屏恢复时立即同步，不再等待下一轮定时请求。单次失败显示“网络波动，正在重连”，连续失败或系统明确离线才显示连接中断。棋步始终通过 revision/CAS 落库；响应丢失后先对账，不离线排队，不盲目重放。

## 等级口径

练习等级按独立完成的不同题目积累经验；重复刷同一道题、用过提示的完成不应增加独立掌握证据。对局胜率只使用已明确记录结果的对局，未定胜负单列；双人结果需双方确认，认输需要明确操作。实力分是站内暂定评分，按棋盘尺寸区分，不宣称对应正式段位，也不根据未校准的 KataGo 胜率推算段位。

第三方题库许可和未激活题目的原因见 [第三方数据说明](THIRD_PARTY_DATA.md)。

## 可复现的计算服务配置

Cloudflare 容器镜像由 `deploy/cloudflare/Dockerfile` 构建，构建目录是仓库根；`Dockerfile.dockerignore` 只放进桥接代码、`deploy/cloudflare/analysis.cfg` 和 `.local/cloudflare-engine/` 里的 KataGo 与模型（这两样不进 Git）。部署前把官方 AppImage 解包出的 `squashfs-root/` 和 b10 模型放进 `.local/cloudflare-engine/`，按下文核对 SHA-256，启动本机 Docker（OrbStack），再 `npx wrangler deploy`：wrangler 会构建 linux/amd64 镜像并推到 Cloudflare 的镜像仓库。用隔离目录发布时，这个目录也要一起复制过去。首次部署后容器要几分钟才能就绪，期间由 VPS 应手。

`deploy/go-coach-engine.service` 和 `deploy/go-coach-tunnel.service` 用 systemd 运行 VPS 后备通道。Linux 官方 Eigen AVX2 二进制是 AppImage，先用 `--appimage-extract` 解包，再运行 `squashfs-root/AppRun`，使非特权服务不依赖 FUSE 挂载。VPS 服务启用 systemd 开机启动；服务重启验证与整机重启验证应分开记录。

fnOS 深度通道已于 2026-11-07 停用：Worker 不再读取 `ENGINE_PRIMARY_*`，这两个 secret 已于 2026-11-08 删除，fnOS 上的两个容器已停止，`compose-fnos.yaml` 和对应配置从仓库删除（见 Git 历史）。

## 当前计算模型的来源

- Cloudflare 主力与 VPS 后备通道（同一文件）：`g170e-b10c128-s1141046784-d204142634.bin.gz`，SHA-256 `1a8e05a4ea3fca20dab79410cbb566c760767fcdd2fa0b701cfe259a84cc8b04`，取自 [Pachi 保存的 KataGo 模型发布](https://github.com/pasky/pachi/releases/tag/katago_models)。该哈希用于校验本次下载与传输一致，不冒称发布方签名。
- 两端使用 [KataGo v1.18.1 官方 Eigen AVX2 发布](https://github.com/lightvector/KataGo/releases/tag/v1.18.1)，压缩包 SHA-256 `33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79`，已比对 GitHub 资产摘要。

原 fnOS 通道用的 b18（`kata1-b18c384nbt-s9996604416-d4316597426.bin.gz`）在 Cloudflare 2 vCPU 上实测 3 秒只搜 10–13 步，复核每点 9–14 步，低于 24 步证据门槛，所以 Cloudflare 也用 b10。两端同一模型，对手强度一致。性能测试不是棋力标定；模型不标成业余或职业段位。


## 题库版本与轻量同步

`0003_catalog_sync.sql`新增派生题库摘要/版本和讲解版本，原lessons及成绩行不重写。触发器覆盖题目INSERT/UPDATE/DELETE、同长度改题、跨家庭迁移及讲解/辅助记录变化。无变化的GET /api/sync只读版本，返回家族revision、实际profile、题库与讲解版本；旧schema回退完整读取，缺表不伪装无变化。完整题目按ID加载，活动棋盘仍使用保存时的题目快照。

先执行并核验增量迁移，再发布新版；若回滚应用，保留新增派生表/触发器即可，不恢复覆盖用户成绩。通过d1 execute --file手动执行迁移后，应仅在实际成功并回读后登记d1_migrations，避免未来重复回填。

AI讲解POST必须明确trigger=manual；旧缓存页面的自动请求在读取棋盘/调用模型前拒绝。前端后台仅轻同步，失败退避；未确认的写操作先对账，不自动重发。私有API仍不缓存到Service Worker。
