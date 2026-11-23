import { describe, expect, it } from 'vitest';

import { isSecureMediaOrigin } from './secure-context';

/** Chromium trusts these as secure even over plain HTTP. */
const SECURE: readonly [string, string][] = [
  ['http:', 'localhost'],
  ['http:', 'chat.localhost'],
  ['http:', '127.0.0.1'],
  ['http:', '127.0.0.99'],
  ['http:', '[::1]'],
  ['https:', '192.168.50.222'],
  ['https:', 'displayer.lan'],
];

/** A LAN address over HTTP never gets `getUserMedia`. */
const INSECURE: readonly [string, string][] = [
  ['http:', '192.168.50.222'],
  ['http:', '192.168.1.10'],
  ['http:', 'displayer.lan'],
  ['http:', '10.0.0.5:3100'],
];

describe('isSecureMediaOrigin', () => {
  it.each(SECURE)('treats %s//%s as able to capture media', (protocol, hostname) => {
    expect(isSecureMediaOrigin({ protocol, hostname })).toBe(true);
  });

  it.each(INSECURE)('treats %s//%s as unable to capture media', (protocol, hostname) => {
    expect(isSecureMediaOrigin({ protocol, hostname })).toBe(false);
  });

  it('does not mistake a hostname that merely starts with 127 for loopback', () => {
    expect(isSecureMediaOrigin({ protocol: 'http:', hostname: '127.example.com' })).toBe(false);
    expect(isSecureMediaOrigin({ protocol: 'http:', hostname: '127.0.0.1.example.com' })).toBe(
      false,
    );
  });

  it('reports no location as unable to capture media', () => {
    expect(isSecureMediaOrigin(null)).toBe(false);
  });
});
