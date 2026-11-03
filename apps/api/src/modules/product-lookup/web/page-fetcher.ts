import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const PAGE_TIMEOUT_MS = 4000;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_TYPES = ['text/html', 'application/ld+json'];

export type PageFetchErrorCode = 'blocked_url' | 'too_many_redirects' | 'http_error' | 'bad_content_type' | 'too_large' | 'unavailable';

export class PageFetchError extends Error {
  constructor(readonly code: PageFetchErrorCode) {
    super(`Page fetch: ${code}`);
    this.name = 'PageFetchError';
  }
}

export interface FetchedPage {
  readonly finalUrl: string;
  readonly domain: string;
  readonly contentType: string;
  readonly body: string;
}

export interface PageFetcherConfig {
  readonly userAgent: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Адреса имени хоста. Подменяется в тестах, чтобы не ходить в DNS. */
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

function privateIpv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Частные, локальные и служебные адреса, включая IPv4 внутри IPv6. */
export function isPrivateAddress(ip: string): boolean {
  const value = ip.toLowerCase();
  if (isIP(value) === 4) return privateIpv4(value);
  if (value === '::' || value === '::1') return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIpv4(mapped[1]!);
  // URL записывает ::ffff:127.0.0.1 в шестнадцатеричном виде.
  const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return privateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return /^f[cdf]/.test(value) || /^fe[89ab]/.test(value);
}

function blockedHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  return name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal') || !name.includes('.') && isIP(name) === 0;
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

async function defaultResolve(hostname: string): Promise<readonly string[]> {
  return (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);
}

/**
 * Чтение публичной страницы по URL из поиска. Только http(s), только публичные адреса на каждом шаге редиректа,
 * ограничения по времени, размеру и типу. Ответ не исполняется и никуда не пересылается целиком.
 * Проверка DNS и подключение разделены, поэтому от подмены DNS в этот короткий промежуток она защищает не полностью.
 */
export class PageFetcher {
  private readonly transport: typeof globalThis.fetch;
  private readonly resolve: (hostname: string) => Promise<readonly string[]>;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(private readonly config: PageFetcherConfig) {
    this.transport = config.fetch ?? globalThis.fetch;
    this.resolve = config.resolve ?? defaultResolve;
    this.timeoutMs = config.timeoutMs ?? PAGE_TIMEOUT_MS;
    this.maxBytes = config.maxBytes ?? PAGE_MAX_BYTES;
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await this.checkedUrl(current);
      let response: Response;
      try {
        response = await this.transport(target.href, { method: 'GET', redirect: 'manual', signal,
          headers: { 'User-Agent': this.config.userAgent, Accept: 'text/html,application/ld+json' } });
      } catch {
        throw new PageFetchError('unavailable');
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new PageFetchError('http_error');
        try {
          current = new URL(location, target).href;
        } catch {
          throw new PageFetchError('blocked_url');
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new PageFetchError('http_error');
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ALLOWED_TYPES.includes(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new PageFetchError('bad_content_type');
      }
      return { finalUrl: target.href, domain: bareHost(target).toLowerCase().replace(/^www\./, ''), contentType, body: await this.readLimited(response) };
    }
    throw new PageFetchError('too_many_redirects');
  }

  private async checkedUrl(value: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new PageFetchError('blocked_url');
    }
    const host = bareHost(url);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || blockedHostname(host)) throw new PageFetchError('blocked_url');
    if (isIP(host) !== 0) {
      if (isPrivateAddress(host)) throw new PageFetchError('blocked_url');
      return url;
    }
    let addresses: readonly string[];
    try {
      addresses = await this.resolve(host);
    } catch {
      throw new PageFetchError('unavailable');
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new PageFetchError('blocked_url');
    return url;
  }

  private async readLimited(response: Response): Promise<string> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new PageFetchError('too_large');
    }
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new PageFetchError('too_large');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof PageFetchError) throw error;
      throw new PageFetchError('unavailable');
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
