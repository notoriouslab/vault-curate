import type { EmbeddingProviderType, VaultSearchSettings } from "../types";

export interface ProviderSwitchHost {
    settings: Pick<VaultSearchSettings, "embeddingProvider">;
    saveSettings(): Promise<void>;
    reload(): Promise<void>;
    refresh(): void;
    rebuild(): Promise<void>;
}

/**
 * Settings-page provider switch. The backend is rebuilt from the saved
 * settings, so save first; if the rebuild fails, put the old provider back
 * so the page never shows a provider that isn't running (042 D6, same
 * rollback as the embedding model row). Never rejects: the reload already
 * showed its Notice.
 */
export async function switchProvider(
    host: ProviderSwitchHost,
    next: EmbeddingProviderType,
    old: EmbeddingProviderType,
): Promise<void> {
    try {
        host.settings.embeddingProvider = next;
        await host.saveSettings();
        await host.reload();
    } catch {
        host.settings.embeddingProvider = old;
        try {
            await host.saveSettings();
        } catch {
            // Best-effort: the reload's Notice already told the user.
        }
        // Redraw even when the save failed: the dropdown must show the
        // provider that is running.
        host.refresh();
        return;
    }
    host.refresh();
    void host.rebuild();
}
