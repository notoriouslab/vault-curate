import { describe, it, expect } from 'vitest';
import { validateServerUrl, isLoopbackHost } from '../src/utils/hostGuards';

describe('validateServerUrl', () => {
    it('accepts plain local and LAN servers', () => {
        expect(() => validateServerUrl('http://localhost:11434')).not.toThrow();
        expect(() => validateServerUrl('http://192.168.1.50:8080')).not.toThrow();
        expect(() => validateServerUrl('https://api.example.com')).not.toThrow();
    });

    it('rejects non-http(s) schemes', () => {
        expect(() => validateServerUrl('file:///etc/passwd')).toThrow(/http/);
        // new URL() lowercases the scheme; javascript: URLs parse but must be refused
        expect(() => validateServerUrl('javascript:alert(1)')).toThrow();
    });

    it('rejects cloud-metadata and link-local IPv4', () => {
        expect(() => validateServerUrl('http://169.254.169.254/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://169.254.1.1:80/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://168.63.129.16/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://100.100.100.200/')).toThrow(/link-local/);
    });

    it('rejects integer/hex-encoded forms of metadata IPs (URL normalizes them)', () => {
        // 2852039166 === 169.254.169.254; Node's URL parser renders dotted-quad
        expect(() => validateServerUrl('http://2852039166/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://0xA9FEA9FE/')).toThrow(/link-local/);
    });

    it('rejects IPv6 link-local and site-local', () => {
        expect(() => validateServerUrl('http://[fe80::1]/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://[fec0::1]/')).toThrow(/link-local/);
    });

    it('rejects IPv4-mapped IPv6 forms of metadata IPs (red-team 3.6 bypass)', () => {
        // ::ffff:169.254.169.254 — both the hex form URL produces and the dotted form
        expect(() => validateServerUrl('http://[::ffff:a9fe:a9fe]/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://[::ffff:169.254.169.254]/')).toThrow(/link-local/);
        expect(() => validateServerUrl('http://[::ffff:a83f:8110]/')).toThrow(/link-local/); // 168.63.129.16
    });

    it('still allows IPv4-mapped forms of legitimate LAN addresses', () => {
        expect(() => validateServerUrl('http://[::ffff:c0a8:132]/')).not.toThrow(); // 192.168.1.50
    });
});

describe('isLoopbackHost', () => {
    it('recognizes the classic loopback shapes', () => {
        expect(isLoopbackHost('localhost')).toBe(true);
        expect(isLoopbackHost('127.0.0.1')).toBe(true);
        expect(isLoopbackHost('127.9.9.9')).toBe(true);
        expect(isLoopbackHost('::1')).toBe(true);
        expect(isLoopbackHost('[::1]')).toBe(true);
        expect(isLoopbackHost('2130706433')).toBe(true);
        expect(isLoopbackHost('::ffff:7f00:1')).toBe(true);
    });

    it('treats everything else as remote', () => {
        expect(isLoopbackHost('192.168.1.50')).toBe(false);
        expect(isLoopbackHost('example.com')).toBe(false);
        expect(isLoopbackHost('')).toBe(false);
    });
});
