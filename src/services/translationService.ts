// ============================================================================
// Translation Service — DeepL (primary) + LibreTranslate (fallback)
//
// DeepL Free API: 500K chars/month, high quality.
// LibreTranslate: unlimited fallback if DeepL quota exceeded.
// Includes LRU cache to avoid re-translating repeated phrases.
// ============================================================================

// Try local secrets first, fall back to defaults for CI/EAS builds
let DEEPL_API_KEY = '';
try {
  DEEPL_API_KEY = require('../config/secrets').DEEPL_API_KEY || '';
} catch {
  try {
    DEEPL_API_KEY = require('../config/secrets.default').DEEPL_API_KEY || '';
  } catch {
    // No secrets available — translation will use LibreTranslate fallback
  }
}

// ── LRU Translation Cache ───────────────────────────────────────────────────

class TranslationCache {
  private _cache = new Map<string, string>();
  private _maxSize = 200;

  get(key: string): string | undefined {
    const val = this._cache.get(key);
    if (val !== undefined) {
      this._cache.delete(key);
      this._cache.set(key, val);
    }
    return val;
  }

  set(key: string, value: string): void {
    if (this._cache.size >= this._maxSize) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) this._cache.delete(firstKey);
    }
    this._cache.set(key, value);
  }

  clear(): void {
    this._cache.clear();
  }
}

// ── DeepL language code mapping ─────────────────────────────────────────────

function toDeepLSource(lang: string): string {
  const map: Record<string, string> = {
    en: 'EN', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT',
    nl: 'NL', pl: 'PL', ru: 'RU', ja: 'JA', zh: 'ZH', ko: 'KO',
    ar: 'AR', cs: 'CS', da: 'DA', el: 'EL', fi: 'FI', hu: 'HU',
    id: 'ID', nb: 'NB', ro: 'RO', sk: 'SK', sv: 'SV', tr: 'TR',
    uk: 'UK', bg: 'BG', et: 'ET', lv: 'LV', lt: 'LT', sl: 'SL',
  };
  return map[lang.toLowerCase()] || lang.toUpperCase();
}

function toDeepLTarget(lang: string): string {
  const map: Record<string, string> = { en: 'EN-US', pt: 'PT-BR' };
  return map[lang.toLowerCase()] || toDeepLSource(lang);
}

// ── Translation Service ─────────────────────────────────────────────────────

export class TranslationService {
  private _cache = new TranslationCache();
  private _apiKey: string = DEEPL_API_KEY || '';
  private _deeplQuotaExceeded = false;

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

    // Try DeepL first
    if (this._apiKey && !this._deeplQuotaExceeded) {
      const result = await this._translateDeepL(text, sourceLanguage, targetLanguage);
      if (result) {
        this._cache.set(cacheKey, result);
        return result;
      }
    }

    // Fallback to LibreTranslate
    const result = await this._translateLibre(text, sourceLanguage, targetLanguage);
    if (result) {
      this._cache.set(cacheKey, result);
      return result;
    }

    return text;
  }

  private async _translateDeepL(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string | null> {
    try {
      const host = this._apiKey.endsWith(':fx')
        ? 'api-free.deepl.com'
        : 'api.deepl.com';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`https://${host}/v2/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this._apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text],
          source_lang: toDeepLSource(sourceLanguage),
          target_lang: toDeepLTarget(targetLanguage),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 456) {
        console.warn('[Translation] DeepL quota exceeded → falling back to LibreTranslate');
        this._deeplQuotaExceeded = true;
        return null;
      }
      if (response.status === 403) {
        console.warn('[Translation] DeepL API key invalid');
        return null;
      }
      if (!response.ok) {
        console.warn(`[Translation] DeepL HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      const translated = data?.translations?.[0]?.text;
      if (!translated || translated === text) return null;

      console.log(`[Translation] DeepL ${sourceLanguage}→${targetLanguage}: "${text}" → "${translated}"`);
      return translated;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        console.warn('[Translation] DeepL timed out');
      } else {
        console.warn('[Translation] DeepL failed:', err);
      }
      return null;
    }
  }

  private async _translateLibre(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch('https://libretranslate.com/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: sourceLanguage,
          target: targetLanguage,
          format: 'text',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[Translation] LibreTranslate HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      const translated = data?.translatedText;
      if (!translated || translated === text) return null;

      console.log(`[Translation] Libre ${sourceLanguage}→${targetLanguage}: "${text}" → "${translated}"`);
      return translated;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        console.warn('[Translation] LibreTranslate timed out');
      } else {
        console.warn('[Translation] LibreTranslate failed:', err);
      }
      return null;
    }
  }

  clearCache(): void {
    this._cache.clear();
    this._deeplQuotaExceeded = false;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: TranslationService | null = null;

export function getTranslationService(): TranslationService {
  if (!_instance) _instance = new TranslationService();
  return _instance;
}
