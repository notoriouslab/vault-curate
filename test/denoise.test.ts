import { describe, it, expect } from 'vitest';
import { denoiseForEmbed, hasDenoisableContent, DENOISE_VERSION } from '../src/indexer/denoise';

describe('denoiseForEmbed — R1-R4 正例', () => {
    it('R1: 表格分隔列整列刪除', () => {
        const input = '| 項目 | 數值 |\n|------|------|\n| 訊息總數 | 4213 |';
        const out = denoiseForEmbed(input);
        expect(out).not.toMatch(/---/);
        expect(out).toContain('項目');
        expect(out).toContain('訊息總數');
        expect(out).toContain('4213');
    });

    it('R2: pipe 換空格、cell 內容詞保留', () => {
        const out = denoiseForEmbed('| 已讀不回率 | 8% | 2 |');
        expect(out).not.toContain('|');
        expect(out).toContain('已讀不回率');
        expect(out).toContain('8%');
    });

    it('R3: block/box 字元連段收成單一空格', () => {
        const out = denoiseForEmbed('一月 ···█▃▅▁·▂▃  二月 ·▂▃█▅▁···▃');
        expect(out).not.toMatch(/[█▅▃▂▁]/);
        expect(out).toContain('一月');
        expect(out).toContain('二月');
    });

    it('R3: box drawing 框線剝除', () => {
        const out = denoiseForEmbed('┌────┐\n│ 統計 │\n└────┘');
        expect(out).not.toMatch(/[┌┐└┘─│]/);
        expect(out).toContain('統計');
    });

    it('R4: 中點連發（≥2）剝除', () => {
        const out = denoiseForEmbed('節奏 ···· 起伏');
        expect(out).not.toContain('··');
        expect(out).toContain('節奏');
        expect(out).toContain('起伏');
    });
});

describe('denoiseForEmbed — 反例（不可誤傷）', () => {
    it('單一中點保留（人名間隔號：關·羽）', () => {
        expect(denoiseForEmbed('關·羽 字雲長')).toContain('關·羽');
    });

    it('全形間隔號 U+30FB 保留', () => {
        expect(denoiseForEmbed('史蒂夫・賈伯斯')).toContain('史蒂夫・賈伯斯');
    });

    it('單一 - 列表符號保留', () => {
        const out = denoiseForEmbed('- 第一項\n- 第二項');
        expect(out).toContain('- 第一項');
        expect(out).toContain('- 第二項');
    });

    it('heading 與 hr 列不動（R5/R6 已剔除規則集）', () => {
        const input = '## 互動統計\n---\n內文';
        const out = denoiseForEmbed(input);
        expect(out).toContain('## 互動統計');
        expect(out).toContain('---');
        expect(out).toContain('內文');
    });

    it('code fence 標記與內容不動（R7 已剔除規則集）', () => {
        const input = '```python\nprint("hello")\n```';
        const out = denoiseForEmbed(input);
        expect(out).toContain('```python');
        expect(out).toContain('print("hello")');
    });
});

describe('denoiseForEmbed — 邊界', () => {
    it('title prefix 行保留（模擬 chunker 輸出）', () => {
        const chunk = '林曉芙\n| 項目 | 數值 |\n|---|---|\n| 訊息 | 42 |';
        const out = denoiseForEmbed(chunk);
        expect(out.split('\n')[0]).toBe('林曉芙');
    });

    it('純模板 chunk 淨化後非空（title 在）', () => {
        const chunk = '林曉芙\n|---|---|\n···█▃▅▁·';
        const out = denoiseForEmbed(chunk);
        expect(out.trim().length).toBeGreaterThan(0);
        expect(out).toContain('林曉芙');
    });

    it('空字串入 → 空字串出，不 throw', () => {
        expect(denoiseForEmbed('')).toBe('');
    });

    it('無符號多行文本：內容詞零損失', () => {
        const input = '今天面試完了\n\n新加坡那間主管人感覺不錯\n韌體那個缺';
        const out = denoiseForEmbed(input);
        for (const word of ['今天面試完了', '新加坡那間主管人感覺不錯', '韌體那個缺']) {
            expect(out).toContain(word);
        }
    });

    it('連續空行摺疊為至多一行', () => {
        const out = denoiseForEmbed('甲\n\n\n\n乙');
        expect(out).toBe('甲\n\n乙');
    });
});

describe('hasDenoisableContent — D2 跳過判準', () => {
    it('含符號筆記 → true（表格 / bar / 中點連發）', () => {
        expect(hasDenoisableContent('| a | b |')).toBe(true);
        expect(hasDenoisableContent('進度 █▃▅')).toBe(true);
        expect(hasDenoisableContent('節奏 ···')).toBe(true);
    });

    it('純文字多空行筆記 → false（空白摺疊不觸發掃描）', () => {
        expect(hasDenoisableContent('文字\n\n\n\n\n更多文字')).toBe(false);
    });

    it('heading / hr / code fence / 單一中點 → false（規則集外）', () => {
        expect(hasDenoisableContent('## 標題\n---\n```js\ncode\n```\n趙·雲')).toBe(false);
    });

    it('與 denoiseForEmbed 對 R1-R4 fixture 判定一致', () => {
        const fixtures = [
            '| 項目 | 數值 |\n|---|---|',
            '一月 ···█▃▅▁·▂▃',
            '┌──┐\n│甲│\n└──┘',
            '節奏 ····',
        ];
        for (const f of fixtures) {
            expect(hasDenoisableContent(f)).toBe(true);
            expect(denoiseForEmbed(f)).not.toBe(f);
        }
    });

    it('stateful regex 防護：連續呼叫結果一致', () => {
        const text = '| a | b |';
        expect(hasDenoisableContent(text)).toBe(true);
        expect(hasDenoisableContent(text)).toBe(true);
        expect(hasDenoisableContent(text)).toBe(true);
    });
});

describe('先導對齊（evidence/symbol_strip_pilot.py 合成卡）', () => {
    const syntheticCard = [
        '# 林曉芙 人物卡',
        '',
        '## 互動統計',
        '| 項目 | 數值 | 排名 |',
        '|------|------|------|',
        '| 訊息總數 | 4,213 | 3 |',
        '| 平均回覆時間 | 12 分鐘 | 5 |',
        '',
        '## 年度節奏',
        '一月 ···█▃▅▁·▂▃  二月 ·▂▃█▅▁···▃',
        '',
        '## 誰先開口',
        '你先：62%  對方先：38%',
        '',
        '## 印象',
        '曉芙是研究所同學，現在在竹科做韌體。',
    ].join('\n');

    it('R3 字元集與表格分隔列全數消失、語意內容全保留', () => {
        const out = denoiseForEmbed(syntheticCard);
        expect(out).not.toMatch(/[─-╿▀-▟]/);
        expect(out).not.toMatch(/^\s*\|[\s\-:|]+\|\s*$/m);
        expect(out).not.toContain('|');
        for (const word of ['訊息總數', '4,213', '誰先開口', '竹科做韌體']) {
            expect(out).toContain(word);
        }
        expect(hasDenoisableContent(syntheticCard)).toBe(true);
    });
});

describe('DENOISE_VERSION', () => {
    it('與規則集綁定的版本常數存在且非空', () => {
        expect(DENOISE_VERSION).toBe('1');
    });
});
