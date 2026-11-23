/**
 * Whether this origin can open the camera or microphone at all.
 *
 * Chrome exposes `navigator.mediaDevices` only in a secure context: HTTPS or a
 * potentially trustworthy origin (loopback names and addresses). A LAN address
 * such as `http://192.168.50.222:3100` is neither, and clicking through a
 * certificate warning does not change that, so the UI has to say so instead of
 * letting "Record audio" fail with no explanation.
 *
 * The check is a pure function on purpose: jsdom cannot reassign
 * `window.location`, so tests exercise real origin strings here and mock only
 * the one call that reads the live window.
 */
export interface MediaLocationLike {
  readonly protocol: string;
  readonly hostname: string;
  readonly origin: string;
}

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** True when the browser will expose media capture on this origin. */
export function isSecureMediaOrigin(
  location: Pick<MediaLocationLike, 'protocol' | 'hostname'> | null | undefined,
): boolean {
  if (!location) return false;
  if (location.protocol === 'https:') return true;
  // The app is only ever served over http or https, so anything else is
  // treated as unusable rather than guessed at.
  if (location.protocol !== 'http:') return false;
  const host = location.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '[::1]' ||
    LOOPBACK_IPV4.test(host)
  );
}

/** The current origin when it cannot capture media, otherwise null. */
export function readInsecureOrigin(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const { location } = window;
  return isSecureMediaOrigin(location) ? null : location.origin;
}
