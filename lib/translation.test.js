import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalize, translate } from './translation.js';

// Mock chrome.storage.local
const mockStorage = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key) => {
        return { [key]: mockStorage[key] || null };
      }),
      set: vi.fn(async (obj) => {
        Object.assign(mockStorage, obj);
      }),
    },
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Clear mock storage
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  // Re-mock chrome
  chrome.storage.local.get.mockImplementation(async (key) => ({ [key]: mockStorage[key] || null }));
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(mockStorage, obj));
});

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize('Hej!')).toBe('hej');
    expect(normalize('"Hello"')).toBe('hello');
    expect(normalize('word.')).toBe('word');
    expect(normalize('(test)')).toBe('test');
  });

  it('trims whitespace', () => {
    expect(normalize('  word  ')).toBe('word');
  });

  it('returns empty string for punctuation-only input', () => {
    expect(normalize('...')).toBe('');
  });

  it('handles Swedish characters', () => {
    expect(normalize('Ödesmöte')).toBe('ödesmöte');
    expect(normalize('förändring,')).toBe('förändring');
  });
});

describe('translate', () => {
  it('returns null for empty input', async () => {
    expect(await translate('')).toBeNull();
    expect(await translate('  ')).toBeNull();
    expect(await translate('...')).toBeNull();
  });

  it('returns cached result without fetching', async () => {
    mockStorage['tr_hej'] = { translation: 'hello', source: 'MyMemory' };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await translate('hej');
    expect(result).toEqual({ translation: 'hello', source: 'MyMemory' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches from MyMemory and caches result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: 'dog' },
        matches: [],
      }),
    }));

    const result = await translate('hund');
    expect(result).toEqual({ translation: 'dog', source: 'MyMemory' });
    expect(mockStorage['tr_hund']).toEqual({ translation: 'dog', source: 'MyMemory' });
  });

  it('falls back to Lingva when MyMemory fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('network error')) // MyMemory fails
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ translation: 'world' }),
      }) // Lingva succeeds
    );

    const result = await translate('värld');
    expect(result).toEqual({ translation: 'world', source: 'Lingva' });
  });

  it('returns error when both services fail', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
    );

    const result = await translate('okänt');
    expect(result).toEqual({ translation: null, error: 'Translation unavailable' });
  });

  it('falls back to Lingva on MyMemory rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ responseStatus: 429, responseData: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ translation: 'many' }),
      })
    );

    const result = await translate('många');
    expect(result).toEqual({ translation: 'many', source: 'Lingva' });
  });

  it('uses matches array when translatedText equals input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: 'hej' },
        matches: [
          { translation: 'hej' },  // same as input
          { translation: 'hello' }, // different
        ],
      }),
    }));

    const result = await translate('hej');
    expect(result.translation).toBe('hello');
  });

  it('normalizes word before lookup (strips punctuation)', async () => {
    mockStorage['tr_hund'] = { translation: 'dog', source: 'cached' };
    vi.stubGlobal('fetch', vi.fn());

    const result = await translate('hund.');
    expect(result).toEqual({ translation: 'dog', source: 'cached' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
