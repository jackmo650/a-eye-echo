// ============================================================================
// Translation Service — Web-based translation via MyMemory API
//
// Uses the free MyMemory translation API (no API key, no native module).
// Translates finalized transcript segments — shown as sub-rows in transcript.
// Includes LRU cache to avoid re-translating repeated phrases.
// ============================================================================

// ── LRU Translation Cache ───────────────────────────────────────────────────

class TranslationCache {
  private _cache = new Map<string, string>();
  private _maxSize = 200;

  get(key: string): string | undefined {
    const val = this._cache.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this._cache.delete(key);
      this._cache.set(key, val);
    }
    return val;
  }

  set(key: string, value: string): void {
    if (this._cache.size >= this._maxSize) {
      // Delete oldest entry
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) this._cache.delete(firstKey);
    }
    this._cache.set(key, value);
  }

  clear(): void {
    this._cache.clear();
  }
}

// ── Translation Service ─────────────────────────────────────────────────────

export class TranslationService {
  private _cache = new TranslationCache();

  /**
   * Translate text from source to target language using MyMemory API.
   * Free tier: 5000 chars/day without key, 50000 with free key.
   * Returns original text on any failure.
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string> {
    if (sourceLanguage === targetLanguage) return text;
    if (!text.trim()) return text;

    const cacheKey = `${sourceLanguage}:${targetLanguage}:${text}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    try {
      const langPair = `${sourceLanguage}|${targetLanguage}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[Translation] HTTP ${response.status}`);
        return text;
      }

      const data = await response.json();
      const translated = data?.responseData?.translatedText;

      if (!translated || translated === text) {
        return text;
      }

      // MyMemory returns uppercase "MYMEMORY WARNING" on limit — detect and skip
      if (translated.includes('MYMEMORY WARNING') || translated.includes('PLEASE CONTACT')) {
        console.warn('[Translation] MyMemory rate limit hit');
        return text;
      }

      this._cache.set(cacheKey, translated);
      console.log(`[Translation] ${sourceLanguage}→${targetLanguage}: "${text}" → "${translated}"`);
      return translated;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        console.warn('[Translation] Request timed out');
      } else {
        console.error('[Translation] Failed:', err);
      }
      return text;
    }
  }

  /**
   * Clear translation cache.
   */
  clearCache(): void {
    this._cache.clear();
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: TranslationService | null = null;

export function getTranslationService(): TranslationService {
  if (!_instance) _instance = new TranslationService();
  return _instance;
}
