<div align="center">

# Vault Curate

[![網站](https://img.shields.io/badge/網站-notoriouslab.github.io-7C3AED?style=flat-square)](https://notoriouslab.github.io/vault-curate/index.zh-TW.html)
[![Release](https://img.shields.io/github/v/release/notoriouslab/vault-curate?style=flat-square)](https://github.com/notoriouslab/vault-curate/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?style=flat-square&logo=obsidian&color=7C3AED&label=downloads&query=%24%5B%22vault-curate%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=vault-curate)
[![License](https://img.shields.io/github/license/notoriouslab/vault-curate?style=flat-square)](LICENSE)
[![Obsidian Desktop + Mobile](https://img.shields.io/badge/Obsidian-Desktop%20%2B%20Mobile-7C3AED?style=flat-square&logo=obsidian)](https://obsidian.md/)
[![WebGPU 加速](https://img.shields.io/badge/WebGPU-加速-FF6A00?style=flat-square)]()
[![Ollama 可選](https://img.shields.io/badge/Ollama-可選-000?style=flat-square)](https://ollama.com/)
[![Last Commit](https://img.shields.io/github/last-commit/notoriouslab/vault-curate?style=flat-square)](https://github.com/notoriouslab/vault-curate)

**找得到、看得見關聯、不遺忘。**

Obsidian 的本地第二大腦。語意搜尋 · 關聯圖 · 語意路徑 · Hot/Cold 遺忘再發現 · 中文/CJK 特強 · 桌機建索引、手機直接搜 · 不上傳資料

[English](./README.md)

![Vault Curate](./docs/vault-curate.png)

</div>

---

## 為什麼選 Vault Curate？

找到一則筆記只是第一步。更難的在後面：*看見*筆記之間的關聯（包括你從沒手動連過的），以及別讓好筆記默默沉沒。Obsidian 內建搜尋只認字面（想到「禱告」找不到「靈修」），內建關聯圖只顯示你手動建的連結，舊筆記則悄悄淡出視線。

[Andrej Karpathy 分享了](https://venturebeat.com/data/karpathy-shares-llm-knowledge-base-architecture-that-bypasses-rag-with-an/)他讓 AI 維護知識庫的願景：由 AI「編譯」你的筆記成結構化 wiki。願景很吸引人，但前提是把編輯權完全交給 AI。**Vault Curate 走另一條路：AI 應該幫你「看見」，不是替你思考。**

### 四大差異化特色

| 特色 | 如何做到 |
|---|---|
| **找到 → 看見 → 不遺忘的閉環** | 語意搜尋（關鍵字、語意、模糊標題三路並用）幫你找到；關聯圖與語意路徑浮現你從沒連過的相關筆記；Hot/Cold 分級把你遺忘的舊筆記重新撈回眼前。而你的判定會收攏這個閉環：說要的建議變成真連結（wikilink），說不要的永遠不再出現。這些事在別處都是各自獨立的外掛，閉環才讓它是「第二大腦」而不只是搜尋框。 |
| **幫你看見，不替你思考** | 不在背景偷跑 AI，不自動改你的筆記，不用聊天機器人「代替你」回答。它給你看的每條關聯都是等你點頭或搖頭的建議：沒有你的明確動作，一個字都不寫、一筆都不藏。AI 整理（寫摘要、生成主題目錄）一律手動開啟。你始終是自己筆記庫的編輯者。 |
| **本地優先，中文/CJK 特強** | 全程在你的電腦上運算（模型約 110 MB 只下載一次，顯示卡加速；五千段筆記約 1 分 23 秒建完索引），免 API key、資料不出門。內建中文模型讓人名、宗教、口語詞的搜尋命中率勝過通用多語模型；其他語言可切換 Ollama 或 OpenAI。 |
| **一份索引，每台裝置** | 桌機建好的索引放在 vault 裡，隨你原本的同步（iCloud、Obsidian Sync、Syncthing）到達手機和平板，那裡以**唯讀**方式直接用：搜尋、發掘、關聯圖隨身可用，零設定。只有桌機一個寫入者，所以永遠不會有同步衝突；手機也不用重算、不用下載模型。 |

---

## 運作方式：找到 → 看見 → 不遺忘

四個層次串成一個閉環。前三層零設定、隨裝隨用；第四層（整理）預設關閉，要你明確開啟。

**而這個閉環聽你的。**它浮現的每一條關聯都是建議，不是決定，而你的兩種回答它都記住：說**要**，建議變成真 wikilink（從此不再是建議，是事實）；滑過按 **✕** 說**不要**，這對配對從所有建議面消失，改名、刪除、重建索引都動不了這個判定。連 Hot/Cold 也是同一套邏輯：*編輯*一篇筆記是判定、會回溫，只是打開看看不算。用得越久，這個閉環反映的越是你對自己筆記庫的認知，而不是演算法的猜測。

![語意關聯總覽](./docs/concept-graph.png)

### 🔍 找到：語意搜尋

換句話說也找得到，不只字面比對。三種找法同時進行、合併排序：

| 找法 | 抓什麼 |
|---|---|
| **關鍵字比對** | 精確片語、關鍵字組合 |
| **語意理解** | 換句話說、同義詞 |
| **模糊標題** | 錯字、拼寫變體 |

- Cmd/Ctrl+P 開 `Vault Curate: 語意搜尋（彈窗）` 快速跳轉；側邊欄 **搜尋** 分頁做持久結果。
- **尋找相似筆記**：對任一 `.md` 右鍵選 **VC: 尋找相似筆記**，結果進側邊欄、可直接拖到 Canvas。相似度比的是**內容**，不是模板：比對前會剝除 markdown 結構符號，並把筆記屬性裡的 `description` 摘要納入排序。就算幾十篇筆記都用同一套模板建立，浮上來的仍是主題真正相關的那幾篇，而不是一排長得一樣的模板筆記。繁體筆記庫底層會先轉成簡體再理解語意（你看到的儲存文字、搜尋結果與摘要全程保持繁體），排名更準。
- 排序也認關鍵字：尋找相似、關聯圖、當前筆記發掘會把筆記屬性裡的 **tags** 與語意相似度融合，「只是文體像」的筆記不再擠掉「主題真的相關」的筆記。沒有 tags 就是純語意排序。

![搜尋結果 + Canvas 拖曳](./docs/search-canvas.png)

### 🕸 看見關聯：關聯圖 / 語意路徑 / 原地展開

搜尋幫你找到單篇，這一層幫你看見筆記之間的關係，包括你從沒手動連過的。

**關聯圖（Canvas）**：以任一筆記為中心，生成可編輯的 Obsidian Canvas，語意上最相近的一圈筆記放射排列、每條邊標相似度分數。

- **紫邊**：語意相近但**你還沒建立連結**的配對，這種隱形關聯在 Obsidian 內建的關聯圖譜裡看不到
- **灰邊**（帶箭頭）：已有 wikilink
- **青框**：Cold 筆記

入口有命令面板、右鍵 **VC: 生成關聯圖**、Discover 側欄的**關聯圖**按鈕。每次生成都是帶時間戳的新 `.canvas`（位置在「進階 → 關聯圖資料夾」，預設 `Vault Curate Canvases`），你編輯過的圖永遠不會被覆寫。

![關聯圖（語意鄰域 Canvas）](./docs/relation-graph.png)

**語意路徑（Canvas）**：選任意兩篇筆記，找出連接它們的**中繼筆記鏈**。整條鏈以*最弱的一跳*評分，牽強的環節藏不進強環節裡；若不存在全程夠強的鏈，會誠實告知「不連通」並附實際數字，這是資訊，不是錯誤。底層的語意地圖在**背景**建一次（有進度、可取消、不卡介面），之後跟著你的編輯即時更新，筆記庫再大查詢照樣秒回。

**在此圖展開**：對 canvas 內任一節點右鍵選 **VC: 在此圖展開**，讓圖原地生長，鄰域落到空位、已在圖上的筆記補連線而不重複、被兩條以上邊指到的筆記變**橙色**（多次展開匯聚到它，通常代表它重要）。你拖過的布局與手動上的顏色一律不動。

**每對配對都等你判定**：圖負責建議，你負責決定，兩種答案都是一鍵。

- **要 → 套用紫邊為 wikilink。**對生成的 `.canvas` 右鍵（或跑命令）→ 勾選視窗按來源筆記分組列出所有紫邊，Cmd/Ctrl+滑過筆記名可預覽內文。勾選的配對會以真 wikilink 寫進兩篇筆記的「相關筆記」小節（可在「進階 → 雙向寫入」切成只寫來源），該邊當場轉灰帶方向箭頭。沒勾的一個字都不會寫；已採納的配對不再是建議，它是真連結了。小節標題可自訂（進階 → 相關筆記小節標題）。
- **不要 → 不再建議這對。**同一個視窗每列都有「不再建議」按鈕，側邊欄的每列建議（尋找相似、發掘）滑過也有 **✕**。說不要的配對從所有建議面消失，空出的名額由下一名候選補上：拒絕不會讓結果變少。反悔了？到「**設定 → 進階 → 已隱藏的建議**」逐項檢視與恢復，每項可直接開啟筆記或複製路徑。

### ♻️ 不遺忘：Hot/Cold 分級加發掘（Discover）

好筆記不該因為你忘了它就等於不存在。筆記依**內部連結加近期活躍度**自動分級：**Hot**（有連結、或近期建立/編輯過；任何編輯都算主動判定，只是打開不算）、**Cold**（孤立且一段時間沒動）。界線在「進階 → Hot 期間（天）」調整，改了立即生效：分級在查詢當下即時計算。

Discover 作用在**筆記**上而非查詢字串，主動浮現你最近沒碰、但語意相關的 Cold 筆記：

- **當前筆記**：打開某篇時自動出現相關筆記（純相關度排序），Cold 視覺標示（「你還沒讀過這篇」）
- **全域**：與你**近期關注**最相關、但已被遺忘的筆記。它從你近期編輯或建立的筆記與其主題 tags 描出「關注剖繪」，結果按頂層資料夾分組，讓筆記庫每個角落最好的遺忘筆記都露臉。這是刻意的盲點挖掘
- 結果可透過 **生成 MOC** 匯出成主題分群的 Map of Content
- 每列建議滑過都有 **✕**，判定規則同上方「每對配對都等你判定」

![Discover 側邊欄（當前筆記）](./docs/discover-current-note.png)

### ✨ 整理（選配，預設關閉）

在「**設定 → AI 整理 → 啟用 AI 整理**」開啟後解鎖三件事，全部手動觸發，不在背景自動跑：

- 為單篇筆記寫一段摘要（`description`）加 tags，存進筆記屬性
- 對側邊欄的搜尋或發掘結果**批次**寫摘要
- 生成**主題分群 MOC**：自動把結果按主題分組、由 AI 為每組命名，產出一份主題式目錄筆記

AI 模型在「**設定 → AI 整理**」獨立指定（本機 Ollama，或任何 OpenAI 相容服務）。

### 📱 一個 vault，每台裝置

四個層次在桌機全部可用。手機和平板（1.5.0 起）則是桌機索引的**唯讀使用者**，各功能在哪裡可用，一張表說清楚：

| 功能 | 桌機 | 手機／平板 |
|---|---|---|
| 搜尋：關鍵字＋模糊標題 | ✅ | ✅ 隨時可用 |
| 搜尋：語意排序 | ✅ 內建模型 | ✅ 把語意引擎指向遠端伺服器即可（手機連不到 `localhost`）；沒設就用關鍵字模式 |
| 尋找相似／Discover 兩種模式 | ✅ | ✅ 全功能（吃桌機算好的索引，手機不需要模型） |
| 隱藏建議（✕）與管理 | ✅ | ✅ 你的判定隨 vault 同步 |
| 關聯圖／語意路徑／原地展開 | ✅ | ✅ 生成可用（canvas 編輯在平板上體驗最好） |
| 紫邊升級 wikilink | ✅ | 桌機限定 |
| 建立／更新索引 | ✅ | 桌機限定：索引透過 vault 同步到達手機 |
| AI 整理（摘要、主題分群 MOC）與生成 MOC | ✅ | 桌機限定 |

手機端啟動時不做任何重活：索引在你**第一次打開搜尋面板時**才載入（有載入中提示）。設定頁顯示索引最後建立時間，桌機重建後按「**重新載入索引**」換新；手機上新寫的筆記，等桌機索引過就搜得到。索引太大（超過 300 MB，約萬篇筆記）會禮貌拒載，不會讓 app 閃退。

---

## 開始使用

**系統需求**：[Obsidian](https://obsidian.md/) v1.7.2+，建索引在桌面版；1.5.0 起手機/平板可以直接搜尋。進階路徑才需要本機 [Ollama](https://ollama.com/) 或任何 OpenAI-compatible server。

### 安裝

**從社群外掛（推薦）**
1. 開啟「**設定 → 社群外掛**」，確認「限制模式」已關，點「**瀏覽**」
2. 搜尋 **Vault Curate**，依序點「**安裝**」「**啟用**」

**用 BRAT（可選，追 GitHub release）**
1. 從社群外掛安裝並啟用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Cmd/Ctrl+P 開 `BRAT: Add a beta plugin for testing`，輸入 `notoriouslab/vault-curate` 後啟用
3. 新版本 BRAT 自動抓取（或用 `BRAT: Check for updates to all beta plugins` 手動更新）

**手動安裝**
1. 從 [Releases](https://github.com/notoriouslab/vault-curate/releases) 下載 `main.js`、`manifest.json`、`styles.css`（兩個 `.wasm` 首次啟動自動下載）
2. 複製到 vault 的 `.obsidian/plugins/vault-curate/`，在社群外掛啟用

> **提示**：筆記庫有用 Git 追蹤的話，把 `.obsidian/plugins/*/data.json` 和 `.obsidian/plugins/*/index.sqlite` 加進 `.gitignore`。

### 首次啟動

啟用後會自動跳出「**歡迎使用 Vault Curate**」視窗：**Embedding 提供者**選「**內建（裝置端、WebGPU）**」，再點「**現在開始建立索引**」。模型約 110 MB、只下載一次；建完索引，點側邊欄羅盤 icon 就能開始。

### 在手機或平板上

手機端一樣從社群外掛安裝。兩個前提備齊，上面「一個 vault，每台裝置」表裡的功能就全部就位：桌機至少建過一次索引、同步已把 vault（含索引）帶到這台裝置。打開側邊欄搜尋面板，索引當場載入。

---

## 參考

### 命令

從 Command Palette（Cmd/Ctrl+P）輸入 `Vault Curate:` 可看到全部。

| 命令 | 說明 | 啟用條件 |
|---|---|---|
| `語意搜尋（彈窗）` | 彈窗式語意搜尋加跳轉 | 永遠可用 |
| `開啟搜尋面板` | 開啟側邊欄面板 | 永遠可用 |
| `尋找相似筆記` | 對當前 `.md` 找語意相似筆記 | 永遠可用 |
| `重建索引` | 砍掉現有索引、全部重新建立 | 桌機限定 |
| `更新索引` | 增量更新（只重建改動過的筆記） | 桌機限定 |
| `發掘相關的 Cold 筆記` | 全域發掘：與近期關注最相關的遺忘筆記，按資料夾分組 | 永遠可用 |
| `生成關聯圖（Canvas）` | 對當前筆記生成語意鄰域 Canvas | 永遠可用 |
| `生成語意路徑（Canvas）` | 當前筆記到指定終點的中繼筆記鏈 | 永遠可用 |
| `套用紫邊為 wikilink` | 勾選視窗把 canvas 上的紫邊（未連結配對）寫成真連結 | canvas 開啟時；桌機限定 |
| `為當前筆記生成 description` | 由 AI 為當前筆記寫摘要加 tags，存進筆記屬性 | 需啟用 AI 整理；桌機限定 |
| `為目前結果生成 description` | 對側邊欄結果批次寫摘要 | 需啟用 AI 整理；桌機限定 |
| `生成 MOC（主題分群）` | 自動按主題分組、AI 命名，產出目錄筆記 | 需啟用 AI 整理；桌機限定 |

筆記右鍵選單：**VC: 尋找相似筆記**、**VC: 生成關聯圖**、**VC: 生成語意路徑**、**VC: 在此圖展開**（canvas 開啟時）、**VC: 生成 description**（需啟用 AI 整理）。對 `.canvas` 檔右鍵另有 **VC: 套用紫邊為 wikilink**。

### 腳本與 AI agent（Obsidian CLI）

Obsidian 1.12 起內建官方 CLI，Vault Curate 可以直接被它腳本化：搜尋面板跑的那套搜尋，從終端機、shell 腳本或 AI agent 都呼叫得到：

```bash
# 從終端機做語意搜尋（回傳排序後的 JSON 結果）
obsidian vault="你的vault" eval code="app.plugins.plugins['vault-curate'].search('嵌入模型').then(r => JSON.stringify(r))"

# 只搜被遺忘的（Cold）筆記
obsidian vault="你的vault" eval code="app.plugins.plugins['vault-curate'].search('嵌入模型', { scope: 'cold' }).then(r => JSON.stringify(r))"
```

`search(query, { scope? })` 預設搜整個 vault（`scope: "all"`），傳 `"hot"` 或 `"cold"` 可縮小範圍。參數不合法、或索引後端還沒就緒時，它會直接拋錯而不是回空陣列：所以拿到 `[]` 一定代表「真的沒有結果」（CLI 的 exit code 永遠是 0，能不能從輸出分辨錯誤很重要）。

上表每個命令也都能用 id 觸發：

```bash
obsidian vault="你的vault" command id="vault-curate:update-index"
obsidian commands filter=vault-curate   # 列出全部 id
```

### 設定

| 區塊 | 設定 | 預設 |
|---|---|---|
| **快速設定** | Embedding 提供者，即語意引擎（內建 / Ollama / OpenAI 相容）；排除資料夾 | 內建；空 |
| **AI 整理** | 啟用開關；LLM 提供者；LLM 模型 | 關；Ollama；qwen3:1.7b |
| **進階** | 結果數量、最低分數、關聯圖資料夾、相關筆記小節標題、雙向寫入、已隱藏的建議（計數加管理/恢復）、Hot 期間、搜尋範圍、分段大小、同義詞表、自動索引、重建加更新、索引統計 | 見面板 |

切換語意引擎（Embedding 提供者）或模型會跳確認視窗，索引清空重建。

### 疑難排解

- **系統大版本更新後的第一次全量重建可能比平常慢很多**：更新後作業系統自己也在背景忙（重建 Spotlight 索引、iCloud 重新同步），跟建索引搶資源。過一陣子自然恢復，不用做任何處理。

---

## 隱私與安全

語意引擎有三種跑法，從「快速設定 → Embedding 提供者」選：

| 模式 | 語意運算在哪跑 | 筆記文字去哪 |
|---|---|---|
| **內建** | 你的電腦上（顯示卡加速） | 留在你的裝置 |
| **Ollama（本機服務）** | 你電腦上的 Ollama | 留在你的裝置 |
| **OpenAI 相容 API** | 你指定的任何服務，本機（LM Studio、llama.cpp 等）或遠端（OpenAI 等） | 取決於你指定的服務，可能離開裝置 |

AI 整理（寫摘要、MOC 命名）也一樣，用「AI 整理」裡獨立設定的服務。

**無遙測。無使用追蹤。除非你自己設定遠端服務，否則不送任何東西到任何伺服器。**

### 稽核揭露

Obsidian Developer Dashboard 的自動稽核可能對本 plugin 標記以下項目。它們都是刻意設計，在此透明揭露：

- **Vault 列舉**（`vault.getMarkdownFiles()`）：索引器需要走過 vault 全部 markdown 檔清單來建語意索引。「排除資料夾」設定（設定 → 進階）可縮限範圍，例如排除 `_templates/`、`.trash/` 或任何你不想索引的資料夾。檔案在進入包含集合前不會被讀取。
- **動態程式碼執行**（bundled `@huggingface/transformers` 裡的 `new Function`）：Hugging Face Transformers 函式庫內部用 `new Function` 建立型別安全的方法分派器。Vault Curate 自己的原始碼含 **零** `eval()` 或 `new Function()`。我們原樣打包上游函式庫以避免分歧；動態分派只發生在 embedding 模型的 tokenizer/inference 設定，不碰任何 vault 內容。
- **直接檔案系統存取**：bundled `sql.js` 附帶 Emscripten 輸出，含 Node.js fallback 路徑會 import `node:fs` / `node:crypto`。這些分支在 Obsidian 的 renderer process 是死碼（由 `process.type !== "renderer"` 把關）。從 v1.0.3 起，esbuild 設定會從發布 bundle 剝除那些 `require()` 字串，稽核不再看到。

### 🔒 關於 API key 儲存

Vault Curate 和所有 Obsidian plugin 一樣，把設定（含任何 OpenAI API key）以純文字存在 `<vault>/.obsidian/plugins/vault-curate/data.json`。這是 Obsidian 的 plugin 儲存機制，不是 vault-curate 特有的設計。

若你的筆記庫同步到雲端（iCloud / Dropbox / Google Drive）或推到公開 Git repo，你應該：

1. 把 `.obsidian/plugins/vault-curate/data.json` 加進同步排除清單或 `.gitignore`
2. 或改用 **內建** 模型或 **Ollama** 路徑，兩者都不需 API key

---

## 技術架構

| 層 | 用什麼 |
|---|---|
| **儲存** | `sql.js`（SQLite via WASM），取代 v0.x 的 `data.json` / `index.json` |
| **關鍵字搜尋** | 純 TS BM25+（`src/storage/bm25.ts`），CJK 友善、不依賴原生 FTS5 |
| **語意 embedding** | `@huggingface/transformers` 加 `bge-small-zh-v1.5` q8（約 110 MB，WebGPU/WASM，裝置端） |
| **融合** | Reciprocal Rank Fusion（k=60）串 BM25、語意、模糊 |
| **分群** | `hdbscan-ts`（主題分群 MOC） |
| **建置** | TypeScript 加 esbuild（worker 與 main 兩段式 bundle） |
| **可選** | [Ollama](https://ollama.com/) 或 OpenAI-compatible endpoint 換更高階 embedding 或 LLM |

---

## 開發

```bash
git clone https://github.com/notoriouslab/vault-curate.git
cd vault-curate
npm install
npm run dev    # watch 模式
npm run build  # production build
npm test       # vitest 單元測試
```

---

## 授權

[MIT](./LICENSE)
