import { describe, it, expect } from 'vitest';
import { classifyInitError, modelHostLabel, resolveModelHost } from '../src/embedding/modelSource';

describe('resolveModelHost（039 D2）', () => {
    it('Hugging Face keeps the transformers default', () => {
        expect(resolveModelHost('huggingface', 'https://x.test')).toBeUndefined();
    });

    it('custom returns the trimmed URL when it passes the host guard', () => {
        expect(resolveModelHost('custom', ' https://mirror.test/ ')).toBe('https://mirror.test/');
    });

    it('custom falls back to Hugging Face for empty, non-http, metadata or malformed URLs', () => {
        expect(resolveModelHost('custom', '')).toBeUndefined();
        expect(resolveModelHost('custom', 'ftp://x.test')).toBeUndefined();
        expect(resolveModelHost('custom', 'http://169.254.169.254/')).toBeUndefined();
        expect(resolveModelHost('custom', 'not a url')).toBeUndefined();
    });

    it('unknown source values fall back to Hugging Face', () => {
        expect(resolveModelHost('hf-mirror', '')).toBeUndefined();
    });
});

describe('modelHostLabel（039 D4）', () => {
    it('names huggingface.co when no host is set, else the hostname', () => {
        expect(modelHostLabel(undefined)).toBe('huggingface.co');
        expect(modelHostLabel('http://127.0.0.1:8765')).toBe('127.0.0.1');
    });
});

describe('classifyInitError（039 D4）', () => {
    it('network-level fetch failures are "unreachable"', () => {
        expect(classifyInitError('Failed to fetch', undefined)).toBe('unreachable');
        expect(classifyInitError('NetworkError when attempting to fetch resource.', 'http://x.test')).toBe('unreachable');
    });

    it('HTTP errors naming the host are "http"', () => {
        expect(classifyInitError(
            'Could not locate file: "https://mirror.test/Xenova/m/resolve/main/config.json".',
            'https://mirror.test/',
        )).toBe('http');
        expect(classifyInitError(
            'Forbidden access to file: "https://huggingface.co/Xenova/m/resolve/main/config.json".',
            undefined,
        )).toBe('http');
    });

    it('anything else (e.g. ORT backend errors) is not a download error', () => {
        expect(classifyInitError('no available backend found', undefined)).toBeNull();
        // A short custom host must not match unrelated text (G3 F2).
        expect(classifyInitError('no available backend found', 'http://a/')).toBeNull();
    });
});
