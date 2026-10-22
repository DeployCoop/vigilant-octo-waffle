import { describe, it, expect, vi, afterEach } from 'vitest';
import { postArgoWebhook, WEBHOOK_TOKEN_STORAGE_KEY } from './webhook';

/**
 * postArgoWebhook talks to three browser globals — fetch, localStorage,
 * and window.prompt (401 retry path only). The vitest environment is
 * 'node', so each test stubs exactly the globals it exercises.
 */

interface StorageFake {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function makeStorage(
  initial: Record<string, string> = {},
  faults: { throwOnGet?: boolean; throwOnSet?: boolean } = {}
): StorageFake & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (key) => {
      if (faults.throwOnGet) throw new Error('storage unavailable');
      return map.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (faults.throwOnSet) throw new Error('storage unavailable');
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

type FetchMock = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<{ status: number }>>>;

function makeFetch(statuses: number[]): FetchMock {
  const queue = [...statuses];
  return vi.fn(async () => ({ status: queue.length > 1 ? (queue.shift() as number) : (queue[0] as number) }));
}

function callInit(fetchMock: FetchMock, call = 0): [string, RequestInit] {
  return fetchMock.mock.calls[call] as unknown as [string, RequestInit];
}

function headersOf(fetchMock: FetchMock, call = 0): Record<string, string> {
  return callInit(fetchMock, call)[1].headers as Record<string, string>;
}

const BODY = { appId: 'nextcloud', namespace: 'apps' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postArgoWebhook', () => {
  it('pins the storage key the dashboard and docs agree on', () => {
    expect(WEBHOOK_TOKEN_STORAGE_KEY).toBe('vow_webhook_token');
  });

  it('posts the JSON body to the webhook route with no token when none is stored', async () => {
    vi.stubGlobal('localStorage', makeStorage());
    const fetchMock = makeFetch([200]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = callInit(fetchMock);
    expect(url).toBe('/api/argo/webhook');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(BODY));
    expect(headersOf(fetchMock)).toEqual({ 'Content-Type': 'application/json' });
  });

  it('sends the stored token as the x-vow-webhook-token header', async () => {
    vi.stubGlobal('localStorage', makeStorage({ [WEBHOOK_TOKEN_STORAGE_KEY]: 'vow_whk_123' }));
    const fetchMock = makeFetch([200]);
    vi.stubGlobal('fetch', fetchMock);

    await postArgoWebhook(BODY);

    expect(headersOf(fetchMock)).toEqual({
      'Content-Type': 'application/json',
      'x-vow-webhook-token': 'vow_whk_123',
    });
  });

  it('still sends (without a token) when localStorage reads throw', async () => {
    vi.stubGlobal('localStorage', makeStorage({}, { throwOnGet: true }));
    const fetchMock = makeFetch([200]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(200);
    expect(headersOf(fetchMock)).toEqual({ 'Content-Type': 'application/json' });
  });

  it('returns non-401 responses as-is and never prompts', async () => {
    vi.stubGlobal('localStorage', makeStorage());
    const fetchMock = makeFetch([500]);
    vi.stubGlobal('fetch', fetchMock);
    const prompt = vi.fn(() => 'unused');
    vi.stubGlobal('window', { prompt });

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('returns a 401 without retrying when there is no window (non-browser caller)', async () => {
    vi.stubGlobal('localStorage', makeStorage());
    const fetchMock = makeFetch([401]);
    vi.stubGlobal('fetch', fetchMock);
    // Deliberately no `window` stub: typeof window === 'undefined'.

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on 401 prompts once, stores the entered token, and retries with it', async () => {
    const storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
    const fetchMock = makeFetch([401, 200]);
    vi.stubGlobal('fetch', fetchMock);
    const promptMessages: string[] = [];
    const prompt = vi.fn((message: string) => {
      promptMessages.push(message);
      return 'vow_whk_entered';
    });
    vi.stubGlobal('window', { prompt });

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(200);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(promptMessages[0]).toContain('VOW_WEBHOOK_TOKEN');
    expect(storage.map.get(WEBHOOK_TOKEN_STORAGE_KEY)).toBe('vow_whk_entered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock, 1)).toEqual({
      'Content-Type': 'application/json',
      'x-vow-webhook-token': 'vow_whk_entered',
    });
    expect(callInit(fetchMock, 1)[1].body).toBe(JSON.stringify(BODY));
  });

  it('on 401 with a dismissed prompt returns the 401 and does not retry or store', async () => {
    const storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
    const fetchMock = makeFetch([401]);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { prompt: vi.fn(() => null) });

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.map.size).toBe(0);
  });

  it('treats an empty prompt entry like a dismissal', async () => {
    const storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
    const fetchMock = makeFetch([401]);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { prompt: vi.fn(() => '') });

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.map.size).toBe(0);
  });

  it('retries with the entered token even when storing it fails', async () => {
    vi.stubGlobal('localStorage', makeStorage({}, { throwOnSet: true }));
    const fetchMock = makeFetch([401, 200]);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { prompt: vi.fn(() => 'vow_whk_fresh') });

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock, 1)['x-vow-webhook-token']).toBe('vow_whk_fresh');
  });

  it('prompts at most once — a second 401 is returned, not retried again', async () => {
    vi.stubGlobal('localStorage', makeStorage());
    const fetchMock = makeFetch([401, 401]);
    vi.stubGlobal('fetch', fetchMock);
    const prompt = vi.fn(() => 'vow_whk_wrong');
    vi.stubGlobal('window', { prompt });

    const res = await postArgoWebhook(BODY);

    expect(res.status).toBe(401);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
