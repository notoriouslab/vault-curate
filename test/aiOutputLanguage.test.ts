import { describe, expect, it } from "vitest";
import { locales } from "../src/i18n";
import {
    AI_OUTPUT_LANGUAGES,
    normalizeAiOutputLanguage,
    resolvePromptSet,
    sanitizeCustomLanguage,
} from "../src/utils/aiOutputLanguage";

const table = {
    en: locales.en,
    "zh-TW": locales["zh-TW"],
    "zh-CN": locales["zh-CN"],
};
const title = "會議紀錄";
const content = "週一討論預算。";
const nb = "1. A — x";

// Copied verbatim from main's src/i18n.ts (f164c70) with the template
// arguments substituted by hand, plus the 036 D10 rule 5 inserted by hand
// into the two Chinese prompts.
// NOT produced by running the locales, so an accidental edit to an existing
// prompt fails here (036 G1 W3).
const GOLDEN: Record<"en" | "zh-TW" | "zh-CN", { desc: string; moc: string }> = {
    "en": {
        desc: "Task: Generate a description and tags for this note.\n\nRules:\n1. Description in English, 50-100 words\n2. Description must describe specific content, never repeat the title\n3. Describe only the note's subject matter — never its format or structure (tables, statistics, charts, sections)\n4. Tags in English, 3-5 tags, no # prefix, no spaces\n5. Reply only in JSON\n\n{\"description\": \"...\", \"tags\": [\"...\", \"...\", \"...\"]}\n\nNote title: T\n\nNote content:\nC",
        moc: "You are organizing a knowledge vault. Below are notes that have been grouped together because they discuss related topics. Based on the common theme, produce:\n\n- title: a concise heading (3-8 words or English characters)\n- intro: 1-2 sentences (40-80 characters) describing what ties these notes together\n\nNotes:\nN\n\nRespond with valid JSON only, in English:\n{\"title\": \"...\", \"intro\": \"...\"}",
    },
    "zh-TW": {
        desc: "任務：為筆記產生 description 和 tags。\n\n規則：\n1. description 必須使用繁體中文，50-100 字，禁止用英文或簡體中文\n2. description 必須描述具體內容，禁止重複標題\n3. 只描述筆記的內容主題，禁止描述筆記的格式或結構（如表格、統計、圖表、欄位）\n4. tags 必須使用繁體中文，3-5 個，不要 # 前綴，不能有空格\n5. description 至少寫兩句完整句子，以筆記討論的具體人、事、物當句子開頭\n6. 只回覆 JSON，不要解釋\n\n{\"description\": \"...\", \"tags\": [\"...\", \"...\", \"...\"]}\n\n筆記標題：T\n\n筆記內容：\nC",
        moc: "你正在整理一個知識庫。以下筆記因為討論相關主題而被分為一群。根據共同主題，產出：\n\n- title：精煉標題（3-8 個繁體中文字）\n- intro：1-2 句介紹（40-80 字），描述這群筆記的共通主題\n\n筆記：\nN\n\n只回覆有效的 JSON（使用繁體中文）：\n{\"title\": \"...\", \"intro\": \"...\"}",
    },
    "zh-CN": {
        desc: "任务：为笔记生成 description 和 tags。\n\n规则：\n1. description 必须使用简体中文，50-100 字，禁止使用英文或繁体中文\n2. description 必须描述具体内容，禁止重复标题\n3. 只描述笔记的内容主题，禁止描述笔记的格式或结构（如表格、统计、图表、字段）\n4. tags 必须使用简体中文，3-5 个，不要 # 前缀，不能有空格\n5. description 至少写两句完整句子，以笔记讨论的具体人、事、物当句子开头\n6. 只回复 JSON，不要解释\n\n{\"description\": \"...\", \"tags\": [\"...\", \"...\", \"...\"]}\n\n笔记标题：T\n\n笔记内容：\nC",
        moc: "你正在整理一个知识库。以下笔记因为讨论相关主题而被分为一组。根据共同主题，产出：\n\n- title：精炼标题（3-8 个简体中文字）\n- intro：1-2 句介绍（40-80 字），描述这组笔记的共同主题\n\n笔记：\nN\n\n只回复有效的 JSON（使用简体中文）：\n{\"title\": \"...\", \"intro\": \"...\"}",
    },
};

function expectSameAs(set: ReturnType<typeof resolvePromptSet>, loc: typeof locales.en) {
    expect(set.description(title, content)).toBe(loc.llmPrompt(title, content));
    expect(set.mocNaming(nb)).toBe(loc.mocClusterNamingPrompt(loc.languageLabel, nb));
}

describe("existing prompts are untouched (golden)", () => {
    for (const loc of ["en", "zh-TW", "zh-CN"] as const) {
        it(`${loc} description + MOC naming prompts match main verbatim`, () => {
            expect(table[loc].llmPrompt("T", "C")).toBe(GOLDEN[loc].desc);
            expect(table[loc].mocClusterNamingPrompt(table[loc].languageLabel, "N")).toBe(GOLDEN[loc].moc);
        });
    }
});

describe("Chinese descriptions open with the subject (036 D10)", () => {
    it("zh-TW / zh-CN carry rule 5 and move JSON to rule 6; en and custom stay as before", () => {
        expect(locales["zh-TW"].llmPrompt(title, content)).toContain("5. description 至少寫兩句完整句子");
        expect(locales["zh-TW"].llmPrompt(title, content)).toContain("\n6. 只回覆 JSON");
        expect(locales["zh-CN"].llmPrompt(title, content)).toContain("5. description 至少写两句完整句子");
        expect(locales["zh-CN"].llmPrompt(title, content)).toContain("\n6. 只回复 JSON");
        // English phrasings of the rule made qwen3:1.7b open with "This note"
        // more often, not less (T5 pilot), so en and custom keep rule 5 = JSON.
        const custom = resolvePromptSet(
            { aiOutputLanguage: "custom", aiOutputLanguageCustom: "Français" }, locales.en, table);
        for (const prompt of [locales.en.llmPrompt(title, content), custom.description(title, content)]) {
            expect(prompt).toContain("\n5. Reply only in JSON");
            expect(prompt).not.toContain("\n6. ");
        }
    });
});

describe("resolvePromptSet", () => {
    it("auto follows the interface locale (en)", () => {
        expectSameAs(resolvePromptSet({ aiOutputLanguage: "auto" }, locales.en, table), locales.en);
    });

    it("auto follows the interface locale (zh-TW)", () => {
        expectSameAs(resolvePromptSet({ aiOutputLanguage: "auto" }, locales["zh-TW"], table), locales["zh-TW"]);
    });

    it("missing fields behave as auto", () => {
        expectSameAs(resolvePromptSet({}, locales.en, table), locales.en);
    });

    it("a listed language swaps in that locale's whole prompt", () => {
        const tw = resolvePromptSet({ aiOutputLanguage: "zh-TW" }, locales.en, table);
        expectSameAs(tw, locales["zh-TW"]);
        expect(tw.description(title, content)).toContain("禁止用英文或簡體中文");
        expectSameAs(resolvePromptSet({ aiOutputLanguage: "en" }, locales["zh-TW"], table), locales.en);
        expectSameAs(resolvePromptSet({ aiOutputLanguage: "zh-CN" }, locales.en, table), locales["zh-CN"]);
    });

    it("custom writes the language name into the English template", () => {
        const set = resolvePromptSet(
            { aiOutputLanguage: "custom", aiOutputLanguageCustom: "Français" }, locales.en, table);
        const desc = set.description(title, content);
        expect(desc).toContain("Description in Français, 50-100 words or equivalent length");
        expect(desc).toContain("Tags in Français, 3-5 tags");
        expect(desc).not.toContain("in English");
        expect(desc).toContain("Note title: 會議紀錄");
        const moc = set.mocNaming(nb);
        expect(moc).toContain("in Français:");
        expect(moc).toContain("(3-8 words or equivalent length)");
        expect(moc).toContain(nb);
    });

    it("custom with an empty / non-string / missing name falls back to auto", () => {
        for (const aiOutputLanguageCustom of ["   ", 42, undefined]) {
            expectSameAs(
                resolvePromptSet({ aiOutputLanguage: "custom", aiOutputLanguageCustom }, locales.en, table),
                locales.en,
            );
        }
    });
});

describe("normalizeAiOutputLanguage", () => {
    it("maps anything outside the list to auto (case-sensitive)", () => {
        for (const raw of ["fr", null, 3, "EN", undefined]) {
            expect(normalizeAiOutputLanguage(raw)).toBe("auto");
        }
    });

    it("keeps every listed value", () => {
        for (const v of AI_OUTPUT_LANGUAGES) expect(normalizeAiOutputLanguage(v)).toBe(v);
    });
});

describe("sanitizeCustomLanguage", () => {
    it("flattens line breaks, tabs and invisibles into single spaces", () => {
        expect(sanitizeCustomLanguage("Fran\nçais")).toBe("Fran çais");
        expect(sanitizeCustomLanguage("a\t\tb")).toBe("a b");
        expect(sanitizeCustomLanguage("繁\u200B體")).toBe("繁 體");
        expect(sanitizeCustomLanguage("  x  ")).toBe("x");
    });

    it("caps at 40 code points without splitting a surrogate pair", () => {
        expect([...sanitizeCustomLanguage("字".repeat(50))].length).toBe(40);
        const r = sanitizeCustomLanguage("😀".repeat(50));
        expect([...r].length).toBe(40);
        const last = r.charCodeAt(r.length - 1);
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    });

    it("returns empty for non-strings", () => {
        expect(sanitizeCustomLanguage(42)).toBe("");
        expect(sanitizeCustomLanguage(null)).toBe("");
    });
});
