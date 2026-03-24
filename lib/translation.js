/**
 * Translation client with caching.
 * Primary: MyMemory API, Fallback: Lingva Translate (Google Translate frontend).
 */

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const LINGVA_URL = 'https://lingva.ml/api/v1/sv/en';

function normalize(word) {
  return word.toLowerCase().replace(/[.,!?;:"'()[\]{}]/g, '').trim();
}

async function tryMyMemory(word) {
  const params = new URLSearchParams({
    q: word,
    langpair: 'sv|en',
  });
  const resp = await fetch(`${MYMEMORY_URL}?${params}`);
  if (!resp.ok) throw new Error(`MyMemory ${resp.status}`);
  const data = await resp.json();

  if (data.responseStatus === 429) {
    throw new Error('MyMemory rate limited');
  }

  const translation = data.responseData?.translatedText;
  if (!translation || translation.toLowerCase() === word.toLowerCase()) {
    // MyMemory sometimes returns the input unchanged for unknown words
    // Check matches for alternatives
    const matches = data.matches || [];
    for (const m of matches) {
      if (m.translation && m.translation.toLowerCase() !== word.toLowerCase()) {
        return { translation: m.translation, source: 'MyMemory' };
      }
    }
  }

  if (translation) {
    return { translation, source: 'MyMemory' };
  }
  throw new Error('No translation found');
}

async function tryLingva(word) {
  const resp = await fetch(`${LINGVA_URL}/${encodeURIComponent(word)}`);
  if (!resp.ok) throw new Error(`Lingva ${resp.status}`);
  const data = await resp.json();
  if (data.translation) {
    return { translation: data.translation, source: 'Lingva' };
  }
  throw new Error('No translation from Lingva');
}

const CACHE_PREFIX = 'tr_';

async function getCached(word) {
  const key = CACHE_PREFIX + word;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

async function setCache(word, value) {
  const key = CACHE_PREFIX + word;
  await chrome.storage.local.set({ [key]: value });
}

export async function translate(rawWord) {
  const word = normalize(rawWord);
  if (!word) return null;

  // Check cache first
  const cached = await getCached(word);
  if (cached) return cached;

  // Try MyMemory first, then Lingva as fallback
  let result = null;
  try {
    result = await tryMyMemory(word);
  } catch (e) {
    console.log('MyMemory failed, trying Lingva:', e.message);
    try {
      result = await tryLingva(word);
    } catch (e2) {
      console.log('Lingva also failed:', e2.message);
      return { translation: null, error: 'Translation unavailable' };
    }
  }

  if (result) {
    await setCache(word, result);
  }
  return result;
}
