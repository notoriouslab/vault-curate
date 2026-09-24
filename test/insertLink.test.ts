import { describe, it, expect, vi } from 'vitest';
import { insertLinkAtCursor } from '../src/ui/insertLink';

describe('insertLinkAtCursor', () => {
    it('inserts the link the file manager generates, relative to the open note', () => {
        const generateMarkdownLink = vi.fn(() => '[[Target]]');
        const replaceSelection = vi.fn();
        const app = { fileManager: { generateMarkdownLink } };
        const target = { path: 'folder/Target.md' };
        const view = { editor: { replaceSelection }, file: { path: 'notes/Draft.md' } };
        expect(insertLinkAtCursor(app as never, target as never, view as never)).toBe(true);
        expect(generateMarkdownLink).toHaveBeenCalledWith(target, 'notes/Draft.md');
        expect(replaceSelection).toHaveBeenCalledTimes(1);
        expect(replaceSelection).toHaveBeenCalledWith('[[Target]]');
    });

    it('does nothing without an editor to insert into', () => {
        const generateMarkdownLink = vi.fn();
        const app = { fileManager: { generateMarkdownLink } };
        expect(insertLinkAtCursor(app as never, { path: 'a.md' } as never, null)).toBe(false);
        expect(generateMarkdownLink).not.toHaveBeenCalled();
    });
});
