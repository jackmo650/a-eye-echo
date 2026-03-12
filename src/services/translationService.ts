// ============================================================================
// Translation Service — On-device translation via ML Kit
//
// Uses @react-native-ml-kit/translate-text for offline translation.
// Each language pair requires a ~30MB model download (one-time).
// Includes LRU cache to avoid re-translating repeated phrases.
// ============================================================================

// Note: @react-native-ml-kit/translate-text provides:
//   translate(text, { sourceLanguage, targetLanguage })
//   downloadModel(language)
//   isModelDownloaded(language)
//   deleteModel(language)

let TranslateModule: {
  translate: (text: string, options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
  downloadModel: (language: string) => Promise<void>;
  isModelDownloaded: (language: string) => Promise<boolean>;
  deleteModel: (language: string) => Promise<void>;
} | null = null;

// Lazy-load to avoid crash if module not installed
async function getTranslateModule() {
  if (!TranslateModule) {
    try {
      // @ts-expect-error — dynamic import for optional dependency
      const mod = await import('@react-native-ml-kit/translate-text');
      TranslateModule = mod.default || mod;
    } catch {
      console.warn('[Translation] @react-native-ml-kit/translate-text not available');
      return null;
    }
  }
  return TranslateModule;
}

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
  private _downloadedModels = new Set<string>();

  /**
   * Translate text from source to target language.
   * Returns original text if translation module unavailable.
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string> {
    if (sourceLanguage === targetLanguage) return text;

    const cacheKey = `${sourceLanguage}:${targetLanguage}:${text}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const mod = await getTranslateModule();
    if (!mod) return text;

    try {
      const translated = await mod.translate(text, {
        sourceLanguage: this._mapLanguageCode(sourceLanguage),
        targetLanguage: this._mapLanguageCode(targetLanguage),
      });

      this._cache.set(cacheKey, translated);
      return translated;
    } catch (err) {
      console.error('[Translation] Failed:', err);
      return text;
    }
  }

  /**
   * Ensure both source and target language models are downloaded.
   * Call before starting translation to avoid delays during transcription.
   */
  async ensureLanguagePair(
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<void> {
    const mod = await getTranslateModule();
    if (!mod) return;

    const source = this._mapLanguageCode(sourceLanguage);
    const target = this._mapLanguageCode(targetLanguage);

    for (const lang of [source, target]) {
      if (this._downloadedModels.has(lang)) continue;

      const downloaded = await mod.isModelDownloaded(lang);
      if (downloaded) {
        this._downloadedModels.add(lang);
        continue;
      }

      console.log(`[Translation] Downloading model for ${lang}...`);
      await mod.downloadModel(lang);
      this._downloadedModels.add(lang);
      console.log(`[Translation] Model for ${lang} ready`);
    }
  }

  /**
   * Check if a language pair is ready for translation (models downloaded).
   */
  async isLanguagePairReady(
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<boolean> {
    const mod = await getTranslateModule();
    if (!mod) return false;

    const source = this._mapLanguageCode(sourceLanguage);
    const target = this._mapLanguageCode(targetLanguage);

    const [srcReady, tgtReady] = await Promise.all([
      mod.isModelDownloaded(source),
      mod.isModelDownloaded(target),
    ]);

    return srcReady && tgtReady;
  }

  /**
   * Delete a translation language model to free storage.
   */
  async deleteLanguageModel(language: string): Promise<void> {
    const mod = await getTranslateModule();
    if (!mod) return;

    const code = this._mapLanguageCode(language);
    await mod.deleteModel(code);
    this._downloadedModels.delete(code);
    console.log(`[Translation] Deleted model for ${code}`);
  }

  /**
   * Clear translation cache.
   */
  clearCache(): void {
    this._cache.clear();
  }

  /**
   * Map Whisper language codes to ML Kit language codes.
   * Most are identical, but a few differ.
   */
  private _mapLanguageCode(code: string): string {
    const mapping: Record<string, string> = {
      'zh': 'zh',     // Chinese (ML Kit uses zh for Simplified)
      'no': 'no',     // Norwegian
      'he': 'he',     // Hebrew
    };
    return mapping[code] || code;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: TranslationService | null = null;

export function getTranslationService(): TranslationService {
  if (!_instance) _instance = new TranslationService();
  return _instance;
}
