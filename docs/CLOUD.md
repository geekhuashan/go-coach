# 家庭云端版本

云端使用 Cloudflare Workers 静态资源、Worker API 和 D1。网页与学习数据不依赖 Mac 开机；KataGo 是独立的计算服务，只有 AI 落子与分析依赖它在线。

## 部署

需要 Node.js、Cloudflare 账户、D1 和账户内的域名。执行 `npm ci` 后使用 `npx wrangler login` 登录。复制并调整仓库 `wrangler.jsonc` 的 account_id、数据库 ID 和域名，不要覆盖其他项目资源。

1. `npx wrangler d1 create go-coach`，把返回的数据库 ID 写入配置。
2. `npm run db:remote` 应用数据库表结构。
3. 生成高强度随机家庭密码以及至少 32 字符的随机会话密钥。将家庭密码的 SHA-256 十六进制摘要设置为 Worker secret `FAMILY_PASSWORD_HASH`，会话密钥设置为 `SESSION_SECRET`。不要把原密码、摘要或密钥放进 Git。
4. 如果有计算服务，设置主力 secrets `ENGINE_PRIMARY_URL`、`ENGINE_PRIMARY_TOKEN`，后备 `ENGINE_URL`、`ENGINE_TOKEN`。URL 是 HTTPS 服务地址，Token 与各自桥接服务的私有令牌文件相同。
5. `npm run deploy`，验证未登录 API 返回 401，登录后可以读写自己的家庭数据。

本地云端开发：私有 `.dev.vars` 中设置同名 secrets，运行 `npm run db:local` 和 `npm run dev:cloud`。该文件已被 Git 忽略。实际部署前应在隔离数据上验收，避免向家庭生产库写测试成绩。

## 数据与登录

家庭共用一个登录密码；每台设备独立选择学习者。学习者不是独立安全账户，家人可切换并查看各自记录。登录会话使用 HttpOnly、Secure、SameSite=Strict Cookie，默认 7 天；API 响应不缓存，退出或 401 会清理界面私密内容。

D1 按学习者、对局、作答、掌握证据、想法和讲解分别保存。原始书题照片仍在 Mac，上传的是人工核对并经过规则验证的题目结构。原始个人资料、模型 API Key 不进入静态文件。

云端 LLM 密钥通过 `SESSION_SECRET` 派生的 AES-GCM 密钥加密保存；会话密钥变更会使旧 LLM 密钥无法解密，应先安排重新配置。不要把单纯的会话密钥轮换当成无状态操作。

## Mac 整理题目与迁移学习档案

`python3 scripts/publish_lesson.py --help` 查看题目校验和发布参数。默认只校验；确认题目后使用 `--reviewed` 发布，密码由私有文件读取。`--dry-run` 不联网。

`python3 scripts/import_local_progress.py --help` 查看本地档案迁移参数。默认 dry-run；`--apply` 才写入。迁移保留本地原文件，剔除模型密钥与照片等非学习数据，拒绝覆盖已经使用的云端家庭库。迁移完成后要回读角色与记录数量。

## KataGo 服务

两条计算通道按任务分工：

- 实战 `/move` 优先直接请求 VPS b10 低延迟通道，不额外做健康往返；默认等待 6 秒、配置上限 8 秒。网络、超时或服务故障时只尝试一次 fnOS b18，默认等待 8 秒、配置上限 10 秒。
- `/analyze` 与用户显式触发的 `/review` 仍优先 fnOS b18 深度通道；先做 1.5 秒健康检查，若报告 `busy=true` 或请求失败，再尝试 VPS，单通道最多 15 秒。

两条通道都忙或超时时明确失败，不无限排队；引擎自身最多等待计算锁 2 秒，单次普通查询最多等待 8 秒。下一次请求仍重新尝试该任务的优先通道，不形成永久降级。`ENGINE_PRIMARY_*` 和 `ENGINE_*` 是兼容现有部署的配置名，不表示所有请求都使用同一主备顺序。页面标记实际使用的后端；两端均只计算棋盘，最终落子仍由云端 revision 校验后写入一次。

桥接进程只监听回环地址，Cloudflare Tunnel 将指定域名转发到它。`/health`、`/analyze`、`/move` 与 `/review` 必须带独立 Bearer Token，网络调用不传学习者姓名或家庭密码。

```sh
python3 engine_bridge.py --port 8874 --token-file /absolute/private/engine-token
```

引擎路径通过 `GO_COACH_KATAGO`、`GO_COACH_MODEL` 指定。只开放带鉴权的桥接入口；不要把本地 Python 完整学习接口直接暴露到公网。CPU 服务器需根据实测选择模型与并发限制，不应把能启动等同于落子速度合适。

## 手机与平板

在 HTTPS 页面登录后，可通过浏览器的“添加到主屏幕”安装。触屏点击先预览，再确认落子；棋局或角色变化会取消旧预览。PWA 仅缓存公开静态资源，离线时不能提交对局或练习记录，也不会排队重放旧动作。

棋盘状态读取约 10–12 秒超时，普通棋盘动作 15 秒，AI 应手 22 秒（覆盖两条计算通道的最坏回退窗口及网络往返），显式复核 30 秒。暂时断线、响应不完整或 5xx 后，网页会主动读取最新 revision；第一次仍失败时约 2 秒后再同步一次。Safari 从后台或锁屏恢复时立即同步，不再等待下一轮定时请求。单次失败显示“网络波动，正在重连”，连续失败或系统明确离线才显示连接中断。棋步始终通过 revision/CAS 落库；响应丢失后先对账，不离线排队，不盲目重放。

## 等级口径

练习等级按独立完成的不同题目积累经验；重复刷同一道题、用过提示的完成不应增加独立掌握证据。对局胜率只使用已明确记录结果的对局，未定胜负单列；双人结果需双方确认，认输需要明确操作。实力分是站内暂定评分，按棋盘尺寸区分，不宣称对应正式段位，也不根据未校准的 KataGo 胜率推算段位。

第三方题库许可和未激活题目的原因见 [第三方数据说明](THIRD_PARTY_DATA.md)。

## 可复现的计算服务配置

`deploy/compose-fnos.yaml` 用 Docker 运行 fnOS 深度通道与独立隧道，`deploy/go-coach-engine.service` 和 `deploy/go-coach-tunnel.service` 用 systemd 运行 VPS 快速通道。模型与引擎二进制不进入仓库。Linux 官方 Eigen AVX2 二进制是 AppImage，先用 `--appimage-extract` 解包，再运行 `squashfs-root/AppRun`，使非特权服务不依赖 FUSE 挂载。

CPU、内存限额和只读文件系统已写在部署模板中。fnOS 采用 Docker `unless-stopped`，VPS 服务启用 systemd 开机启动；服务重启验证与整机重启验证应分开记录。

## 当前计算模型的来源

- fnOS 深度通道：`kata1-b18c384nbt-s9996604416-d4316597426.bin.gz`，SHA-256 `9d7a6afed8ff5b74894727e156f04f0cd36060a24824892008fbb6e0cba51f1d`。模型来自已有 KataGo 安装，来源项目为 [KataGo Training](https://katagotraining.org/)。
- VPS 快速通道：`g170e-b10c128-s1141046784-d204142634.bin.gz`，SHA-256 `1a8e05a4ea3fca20dab79410cbb566c760767fcdd2fa0b701cfe259a84cc8b04`，取自 [Pachi 保存的 KataGo 模型发布](https://github.com/pasky/pachi/releases/tag/katago_models)。该哈希用于校验本次下载与传输一致，不冒称发布方签名。
- 两端使用 [KataGo v1.18.1 官方 Eigen AVX2 发布](https://github.com/lightvector/KataGo/releases/tag/v1.18.1)，压缩包 SHA-256 `33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79`，已比对 GitHub 资产摘要。

参数选择有搜索时间上限：b18 在 CPU 上常先到 3 秒而未到 64 visits。性能测试不是棋力标定；模型不标成业余或职业段位。b10 比 b18 弱，页面显示实际来源，站内评级不把两种 AI 混成同一已校准对手。
