import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        include: ['test/**/*.test.ts'],
        setupFiles: ['test/setup/obsidianDom.ts'],
        globals: false,
        // The `obsidian` package ships types only (`"main": ""`), so Vite
        // cannot resolve a runtime import of it and `vi.mock("obsidian")`
        // never gets the chance to run. Point tests at the stub instead;
        // the production bundle still marks `obsidian` external.
        alias: {
            obsidian: fileURLToPath(new URL('./test/setup/obsidianSettingStub.ts', import.meta.url)),
        },
    },
});
