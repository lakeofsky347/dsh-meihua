# 关帝灵签清刊本校勘内容包

本目录完成 G8 的内容工作，共100签、400句、2800个诗文字；每条有签号、原诗、原刻等级、原创中文释义、三个关键词、固定版本来源、原刻页码与校勘记录。尚未实现抽签模块。

| 文件 | 用途 |
|---|---|
| `lots.json` | 唯一运行内容入口；未来模块把这份固定版本编进本地包 |
| `schema.json` | Draft 2020-12 内容契约；编号连续和来源一一对应另由测试校验 |
| `manifest.json` | 数量、许可、源文件哈希、内容包状态与素材边界 |
| `collation.json` | 100首逐条核对及34条异文；人类二次复核明确未检查 |
| `editorial.json` | 100条原创释义的独立编辑源，不含模型预测 |
| `sources/` | 古籍原PDF、固定转录、许可元数据、20张逐首图像对照页 |
| `build-content.py` | 无网络重建数据、校勘记录和哈希manifest |
| `LICENSES.md` | 公共领域原文、编辑快照CC、原创释义MIT的不同范围 |

```sh
python3 content/lot/guandi-100/build-content.py
node --import tsx --test tests/lot-content.test.ts
```

每个 `provenance.pdfPage` 是原始PDF的1-based页码，`number+2`；原PDF共104页，签诗位于3—102页。固定转录用于协助录入与记载异文，扫描用于核对签号、原刻等级和诗句。对照页标题仍展示抽取时的转录版本，以便查看差异；最终采用读法在 `lots.json` 与 `collation.json`，不由对照页标题推导。

未来模块施工规格在仓库 `docs/g8-lot-module-spec.md`。本目录不保存生日、问题或用户抽签历史；它只是公共静态内容。用户问题、AI解读、追问、背景快照必须接入现有私人加密服务。
