// ============================================================
// MOC 2.0 — topic-grouped Map of Content
// Flow: cluster embeddings → name clusters via LLM → render markdown
// ============================================================

import type {
    Cluster,
    NamedCluster,
    MocGroupedResult,
    VaultSearchSettings,
} from "./types";
import { clusterEmbeddings, shouldFallbackToFlat } from "./clustering";
import { formatLocalDateTime, requestLlmJson, toWikilink } from "./utils";
import { resolveLlmUrl } from "./utils/resolveLlmUrl";
import { stripDangerousInvisibles } from "./description-generator";
import { t } from "./i18n";

const LLM_NAMING_TIMEOUT_MS = 30000;
const NOTE_DESCRIPTION_CAP = 200;
const MIN_NAMING_TITLE_CHARS = 2;
const MAX_NAMING_TITLE_CHARS = 60;
const MIN_NAMING_INTRO_CHARS = 10;
const MAX_NAMING_INTRO_CHARS = 300;

/** Thrown when clustering is too degenerate to benefit from MOC 2.0. */
export class FallbackToFlatError extends Error {
    constructor() {
        super("Clustering degenerate, fallback to flat MOC");
        this.name = "FallbackToFlatError";
    }
}

/** Input shape the caller must assemble (wraps SearchResult + embedding + description). */
export interface NoteForMoc {
    path: string;
    title: string;
    description: string;
    score: number;
    embedding: number[];
    tier: "hot" | "cold";
    tags: string[];
}

export interface GenerateMocParams {
    notes: NoteForMoc[];
    query: string;
    settings: VaultSearchSettings;
    onStage?: (stage: "clustering" | "naming", current: number, total: number) => void;
    cancelled?: { value: boolean };
}

/**
 * Main MOC 2.0 flow. Callers should catch `FallbackToFlatError` and
 * route to the v0.3.0 flat MOC path when thrown.
 */
export async function generateMocGrouped(params: GenerateMocParams): Promise<MocGroupedResult> {
    const { notes, query, settings, onStage, cancelled } = params;

    onStage?.("clustering", 0, notes.length);
    const embeddings = notes.map(n => n.embedding);
    const clusters = clusterEmbeddings(embeddings);
    onStage?.("clustering", notes.length, notes.length);

    if (shouldFallbackToFlat(clusters)) {
        throw new FallbackToFlatError();
    }

    // Sort each cluster's note indices by original score, descending
    for (const cluster of clusters) {
        cluster.noteIndices.sort((a, b) => notes[b].score - notes[a].score);
    }

    const nonNoise = clusters.filter(c => c.label !== -1);
    const noiseCluster = clusters.find(c => c.label === -1) ?? null;

    const named: NamedCluster[] = [];
    for (let i = 0; i < nonNoise.length; i++) {
        if (cancelled?.value) {
            // Fill remaining clusters with fallback names and stop
            for (let j = i; j < nonNoise.length; j++) {
                named.push(fallbackNamedCluster(nonNoise[j], notes, j));
            }
            break;
        }
        onStage?.("naming", i, nonNoise.length);
        try {
            const result = await nameCluster(nonNoise[i], notes, settings);
            named.push({ ...nonNoise[i], ...result, isFallback: false });
        } catch (err) {
            console.warn("Vault Curate: cluster naming failed, using fallback", err);
            named.push(fallbackNamedCluster(nonNoise[i], notes, i));
        }
    }
    onStage?.("naming", nonNoise.length, nonNoise.length);

    const miscellaneous = noiseCluster ? createMiscellaneousCluster(noiseCluster) : null;

    return {
        clusters: named,
        miscellaneous,
        totalNotes: notes.length,
        query,
    };
}

// ============================================================
// Cluster naming (LLM + fallback)
// ============================================================

async function nameCluster(
    cluster: Cluster,
    notes: NoteForMoc[],
    settings: VaultSearchSettings,
): Promise<{ title: string; intro: string }> {
    const notesBlock = cluster.noteIndices
        .map((idx, i) => {
            const n = notes[idx];
            const desc = (n.description || "")
                .slice(0, NOTE_DESCRIPTION_CAP)
                .replace(/\s+/g, " ")
                .trim();
            return `${i + 1}. ${n.title}${desc ? " — " + desc : ""}`;
        })
        .join("\n");

    const prompt = t.mocClusterNamingPrompt(t.languageLabel, notesBlock);

    return requestLlmJson(
        {
            ollamaUrl: resolveLlmUrl(settings.llmUrl, settings.ollamaUrl),
            llmModel: settings.llmModel,
            apiFormat: settings.apiFormat,
            apiKey: settings.apiKey,
        },
        prompt,
        parseClusterNamingResponse,
        { timeoutMs: LLM_NAMING_TIMEOUT_MS },
    );
}

function parseClusterNamingResponse(raw: string): { title: string; intro: string } {
    const attempt = (text: string): { title: string; intro: string } | null => {
        try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) return null;
            const obj = parsed as { title?: unknown; intro?: unknown };
            const titleRaw = typeof obj.title === "string" ? obj.title : "";
            const introRaw = typeof obj.intro === "string" ? obj.intro : "";
            const title = stripDangerousInvisibles(titleRaw).trim();
            const intro = stripDangerousInvisibles(introRaw, " ").trim();
            if (title.length < MIN_NAMING_TITLE_CHARS || title.length > MAX_NAMING_TITLE_CHARS) return null;
            if (intro.length < MIN_NAMING_INTRO_CHARS || intro.length > MAX_NAMING_INTRO_CHARS) return null;
            // Reject literal newlines + leading frontmatter / fence sequences
            // a malicious LLM could use to break out of the MOC body.
            if (/[\n\r]/.test(title) || /[\n\r]/.test(intro)) return null;
            if (/^(---|```)/.test(title) || /^(---|```)/.test(intro)) return null;
            return { title, intro };
        } catch {
            return null;
        }
    };

    const parsed =
        attempt(raw) ??
        attempt(raw.replace(/```json\n?|\n?```/g, "").trim());

    if (!parsed) throw new Error("Invalid cluster naming JSON");
    return parsed;
}

function fallbackNamedCluster(
    cluster: Cluster,
    notes: NoteForMoc[],
    index: number,
): NamedCluster {
    const firstNote = notes[cluster.noteIndices[0]];
    const base = t.mocFallbackGroup(index + 1);
    return {
        ...cluster,
        title: firstNote?.title ? `${base}: ${firstNote.title}` : base,
        intro: t.mocMiscIntro,
        isFallback: true,
    };
}

function createMiscellaneousCluster(noise: Cluster): NamedCluster {
    return {
        ...noise,
        title: t.mocMiscellaneous,
        intro: t.mocMiscIntro,
        isFallback: false,
    };
}

// ============================================================
// Rendering
// ============================================================

/**
 * Render a `MocGroupedResult` into a complete markdown document.
 * The `notes` array must be the same one passed to `generateMocGrouped`
 * (cluster `noteIndices` reference into it).
 */
export function renderMocGrouped(result: MocGroupedResult, notes: NoteForMoc[]): string {
    const { clusters, miscellaneous, totalNotes, query } = result;
    const clusterCount = clusters.length + (miscellaneous && miscellaneous.noteIndices.length > 0 ? 1 : 0);

    const lines: string[] = [
        "---",
        `pubDate: "${formatLocalDateTime(new Date())}"`,
        `description: ${JSON.stringify(t.mocGroupedDescription(query))}`,
        `source_query: ${JSON.stringify(query)}`,
        "moc_version: 2",
        `cluster_count: ${clusterCount}`,
        `total_notes: ${totalNotes}`,
        "---",
        "",
        `# ${t.mocTitleSearch(query)}`,
        "",
    ];

    const renderCluster = (c: NamedCluster) => {
        lines.push(`## ${c.title}`);
        if (c.intro) {
            lines.push(c.intro);
            lines.push("");
        }
        for (const idx of c.noteIndices) {
            const n = notes[idx];
            if (!n) continue;
            lines.push(`- ${toWikilink(n.path, n.title)}`);
        }
        lines.push("");
    };

    for (const c of clusters) renderCluster(c);

    if (miscellaneous && miscellaneous.noteIndices.length > 0) {
        lines.push("---");
        lines.push("");
        renderCluster(miscellaneous);
    }

    return lines.join("\n");
}
