// ============================================================================
// Settings Screen — Caption style, transcription, language, translation,
// sign language, vibration, camera config
// ============================================================================

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  TextInput,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import {
  WHISPER_MODELS,
  WHISPER_LANGUAGES,
  TRANSLATION_LANGUAGES,
  PRESET_THEMES,
} from '../src/types/defaults';
import type {
  WhisperModel,
  WhisperLanguage,
  CaptionFont,
  VibrationIntensity,
  SignLanguageType,
} from '../src/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const {
    settings,
    themes,
    updateCaptionStyle,
    setFontSize,
    setPosition,
    setActiveTheme,
    updateTranscriptionConfig,
    updateTranslationConfig,
    updateSignLanguageConfig,
    updateVibrationConfig,
    setCameraEnabled,
    setCameraPosition,
    setKeepScreenAwake,
  } = useSettingsStore();

  const { caption, transcription, translation, signLanguage, vibration } = settings;

  const [languageSearch, setLanguageSearch] = useState('');

  // Filter models: show English-only for English, multilingual otherwise
  const isNonEnglish = transcription.language !== 'en';
  const filteredModels = (Object.keys(WHISPER_MODELS) as WhisperModel[]).filter(id => {
    if (isNonEnglish) {
      return !id.endsWith('.en'); // Only show multilingual
    }
    return id.endsWith('.en'); // Only show English
  });

  // Filter languages for search (exclude 'auto' — not supported by Apple Speech Recognition)
  const filteredLanguages = WHISPER_LANGUAGES.filter(l =>
    l.code !== 'auto' && (
      l.label.toLowerCase().includes(languageSearch.toLowerCase()) ||
      l.nativeName.toLowerCase().includes(languageSearch.toLowerCase()) ||
      l.code.includes(languageSearch.toLowerCase())
    ),
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Caption Preview ── */}
      <View style={styles.previewBox}>
        <Text
          style={[
            styles.previewText,
            {
              fontSize: Math.min(caption.fontSize, 40),
              color: caption.color,
              textShadowColor: caption.outlineColor,
              textShadowRadius: caption.outlineWidth * 2,
            },
          ]}
        >
          Live caption preview
        </Text>
      </View>

      {/* ── Theme ── */}
      <Section title="Theme">
        <View style={styles.themeGrid}>
          {themes.map(theme => (
            <TouchableOpacity
              key={theme.id}
              style={[
                styles.themeButton,
                {
                  backgroundColor: theme.style.bgColor,
                  borderColor: settings.activeThemeId === theme.id ? '#4FC3F7' : '#333',
                },
              ]}
              onPress={() => setActiveTheme(theme.id)}
            >
              <Text style={[styles.themeLabel, { color: theme.style.color }]}>
                {theme.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      {/* ── Caption Style ── */}
      <Section title="Caption Style">
        <Row label={`Font Size: ${caption.fontSize}pt`}>
          <Slider
            style={styles.slider}
            minimumValue={24}
            maximumValue={120}
            step={2}
            value={caption.fontSize}
            onValueChange={setFontSize}
            minimumTrackTintColor="#4FC3F7"
            maximumTrackTintColor="#333"
            thumbTintColor="#4FC3F7"
          />
        </Row>

        <Row label={`Max Lines: ${caption.maxLines}`}>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={8}
            step={1}
            value={caption.maxLines}
            onValueChange={(v) => updateCaptionStyle({ maxLines: v })}
            minimumTrackTintColor="#4FC3F7"
            maximumTrackTintColor="#333"
            thumbTintColor="#4FC3F7"
          />
        </Row>

        <Row label="Position">
          <View style={styles.segmentedControl}>
            {(['top', 'center', 'bottom'] as const).map(pos => (
              <TouchableOpacity
                key={pos}
                style={[
                  styles.segmentButton,
                  caption.position === pos && styles.segmentButtonActive,
                ]}
                onPress={() => setPosition(pos)}
              >
                <Text
                  style={[
                    styles.segmentText,
                    caption.position === pos && styles.segmentTextActive,
                  ]}
                >
                  {pos.charAt(0).toUpperCase() + pos.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Row>

        <Row label="Font">
          <View style={styles.segmentedControl}>
            {(['System', 'OpenDyslexic', 'Atkinson', 'SF Mono'] as CaptionFont[]).map(font => (
              <TouchableOpacity
                key={font}
                style={[
                  styles.segmentButton,
                  caption.fontFamily === font && styles.segmentButtonActive,
                ]}
                onPress={() => updateCaptionStyle({ fontFamily: font })}
              >
                <Text
                  style={[
                    styles.segmentText,
                    caption.fontFamily === font && styles.segmentTextActive,
                    { fontSize: 11 },
                  ]}
                >
                  {font}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Row>

        <Row label={`Background Opacity: ${caption.bgOpacity}%`}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={caption.bgOpacity}
            onValueChange={(v) => updateCaptionStyle({ bgOpacity: v })}
            minimumTrackTintColor="#4FC3F7"
            maximumTrackTintColor="#333"
            thumbTintColor="#4FC3F7"
          />
        </Row>
      </Section>

      {/* ── Language ── */}
      <Section title="Language">
        <TextInput
          style={styles.searchInput}
          placeholder="Search languages..."
          placeholderTextColor="#555"
          value={languageSearch}
          onChangeText={setLanguageSearch}
        />
            <View style={styles.languageGrid}>
              {filteredLanguages.map(lang => (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.languageButton,
                    transcription.language === lang.code && styles.languageButtonActive,
                  ]}
                  onPress={() => {
                    updateTranscriptionConfig({ language: lang.code });
                    setLanguageSearch('');
                  }}
                >
                  <Text
                    style={[
                      styles.languageLabel,
                      transcription.language === lang.code && styles.languageLabelActive,
                    ]}
                  >
                    {lang.nativeName}
                  </Text>
                  <Text style={styles.languageCode}>{lang.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
      </Section>

      {/* ── Translation ── */}
      <Section title="Transcript Translation">
        <Text style={styles.infoText}>
          Translates each caption after it's finalized. Shows translated text with the original below it in the Transcript tab. Requires internet connection.
        </Text>

        <Row label="Enable translation">
          <Switch
            value={translation.enabled}
            onValueChange={(v) => updateTranslationConfig({ enabled: v })}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>

        {translation.enabled && (
          <>
            <Row label="Show original text">
              <Switch
                value={translation.showOriginal}
                onValueChange={(v) => updateTranslationConfig({ showOriginal: v })}
                trackColor={{ true: '#4FC3F7', false: '#333' }}
              />
            </Row>

            <Row label="Translate to">
              <View style={styles.languageGrid}>
                {TRANSLATION_LANGUAGES.slice(0, 15).map(lang => (
                  <TouchableOpacity
                    key={lang.code}
                    style={[
                      styles.languageButton,
                      translation.targetLanguage === lang.code && styles.languageButtonActive,
                    ]}
                    onPress={() => updateTranslationConfig({ targetLanguage: lang.code })}
                  >
                    <Text
                      style={[
                        styles.languageLabel,
                        translation.targetLanguage === lang.code && styles.languageLabelActive,
                      ]}
                    >
                      {lang.nativeName}
                    </Text>
                    <Text style={styles.languageCode}>{lang.code.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Row>
          </>
        )}
      </Section>

      {/* ── Sign Language ── */}
      <Section title="Sign Language (Beta)">
        <Row label="Enable sign language recognition">
          <Switch
            value={signLanguage.enabled}
            onValueChange={(v) => {
              updateSignLanguageConfig({ enabled: v });
              // Sign language requires camera
              if (v && !settings.cameraEnabled) {
                setCameraEnabled(true);
              }
            }}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>

        {signLanguage.enabled && (
          <>
            <Row label="Sign Language">
              <View style={styles.segmentedControl}>
                {(['asl', 'bsl'] as SignLanguageType[]).map(sl => (
                  <TouchableOpacity
                    key={sl}
                    style={[
                      styles.segmentButton,
                      signLanguage.language === sl && styles.segmentButtonActive,
                    ]}
                    onPress={() => updateSignLanguageConfig({ language: sl })}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        signLanguage.language === sl && styles.segmentTextActive,
                      ]}
                    >
                      {sl.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Row>

            <Row label="Show hand overlay">
              <Switch
                value={signLanguage.showHandPreview}
                onValueChange={(v) => updateSignLanguageConfig({ showHandPreview: v })}
                trackColor={{ true: '#4FC3F7', false: '#333' }}
              />
            </Row>

            <Text style={styles.infoText}>
              Currently supports ASL fingerspelling (A-Z) and common signs.
              Camera must be enabled and pointed at hands.
            </Text>
          </>
        )}
      </Section>

      {/* ── Transcription ── */}
      <Section title="Transcription">
        <Row label="Whisper Model">
          <View style={styles.modelList}>
            {filteredModels.map(modelId => {
              const info = WHISPER_MODELS[modelId];
              const isActive = transcription.modelSize === modelId;
              return (
                <TouchableOpacity
                  key={modelId}
                  style={[styles.modelCard, isActive && styles.modelCardActive]}
                  onPress={() => updateTranscriptionConfig({ modelSize: modelId })}
                >
                  <Text style={[styles.modelName, isActive && styles.modelNameActive]}>
                    {info.label}
                  </Text>
                  <Text style={styles.modelMeta}>{info.size} - {info.speed}</Text>
                  <Text style={styles.modelMeta}>{info.recommended}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Row>

        <Row label={`Chunk Duration: ${transcription.chunkDurationSec}s`}>
          <Slider
            style={styles.slider}
            minimumValue={3}
            maximumValue={10}
            step={1}
            value={transcription.chunkDurationSec}
            onValueChange={(v) => updateTranscriptionConfig({ chunkDurationSec: v })}
            minimumTrackTintColor="#4FC3F7"
            maximumTrackTintColor="#333"
            thumbTintColor="#4FC3F7"
          />
        </Row>
      </Section>

      {/* ── Vibration ── */}
      <Section title="Vibration Alerts">
        <Row label="Intensity">
          <View style={styles.segmentedControl}>
            {(['off', 'light', 'medium', 'strong'] as VibrationIntensity[]).map(level => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.segmentButton,
                  vibration.intensity === level && styles.segmentButtonActive,
                ]}
                onPress={() => updateVibrationConfig({ intensity: level })}
              >
                <Text
                  style={[
                    styles.segmentText,
                    vibration.intensity === level && styles.segmentTextActive,
                  ]}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Row>

        <Row label="Vibrate on speech start">
          <Switch
            value={vibration.onSpeechStart}
            onValueChange={(v) => updateVibrationConfig({ onSpeechStart: v })}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>

        <Row label="Vibrate on speech end">
          <Switch
            value={vibration.onSpeechEnd}
            onValueChange={(v) => updateVibrationConfig({ onSpeechEnd: v })}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>

        <Row label="Vibrate on speaker change">
          <Switch
            value={vibration.onSpeakerChange}
            onValueChange={(v) => updateVibrationConfig({ onSpeakerChange: v })}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>
      </Section>

      {/* ── Camera ── */}
      <Section title="Speaker Detection (Camera)">
        <Row label="Enable camera">
          <Switch
            value={settings.cameraEnabled}
            onValueChange={setCameraEnabled}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>

        {settings.cameraEnabled && (
          <Row label="Camera">
            <View style={styles.segmentedControl}>
              {(['front', 'back'] as const).map(pos => (
                <TouchableOpacity
                  key={pos}
                  style={[
                    styles.segmentButton,
                    settings.cameraPosition === pos && styles.segmentButtonActive,
                  ]}
                  onPress={() => setCameraPosition(pos)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      settings.cameraPosition === pos && styles.segmentTextActive,
                    ]}
                  >
                    {pos === 'front' ? 'Front (1:1)' : 'Back (Conference)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Row>
        )}
      </Section>

      {/* ── General ── */}
      <Section title="General">
        <Row label="Keep screen awake">
          <Switch
            value={settings.keepScreenAwake}
            onValueChange={setKeepScreenAwake}
            trackColor={{ true: '#4FC3F7', false: '#333' }}
          />
        </Row>
      </Section>

      <View style={styles.footer}>
        <Text style={styles.footerText}>A.EYE.ECHO v0.3.0</Text>
        <Text style={styles.footerText}>Built with WallSpace.Studio</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  content: {
    padding: 16,
    paddingBottom: 60,
  },
  previewBox: {
    height: 100,
    backgroundColor: '#000',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  previewText: {
    fontWeight: '600',
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  row: {
    marginBottom: 16,
  },
  rowLabel: {
    color: '#CCC',
    fontSize: 15,
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  segmentButton: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  segmentButtonActive: {
    backgroundColor: '#1A3A4A',
    borderColor: '#4FC3F7',
  },
  segmentText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: '#4FC3F7',
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    minWidth: 100,
  },
  themeLabel: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  searchInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    color: '#FFF',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  languageButton: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 80,
    alignItems: 'center',
  },
  languageButtonActive: {
    backgroundColor: '#1A3A4A',
    borderColor: '#4FC3F7',
  },
  languageLabel: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '600',
  },
  languageLabelActive: {
    color: '#4FC3F7',
  },
  languageCode: {
    color: '#666',
    fontSize: 11,
    marginTop: 1,
  },
  infoText: {
    color: '#555',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  modelList: {
    gap: 8,
  },
  modelCard: {
    backgroundColor: '#1A1A1A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  modelCardActive: {
    borderColor: '#4FC3F7',
    backgroundColor: '#1A3A4A',
  },
  modelName: {
    color: '#CCC',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  modelNameActive: {
    color: '#4FC3F7',
  },
  modelMeta: {
    color: '#666',
    fontSize: 12,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 24,
    gap: 4,
  },
  footerText: {
    color: '#444',
    fontSize: 12,
  },
});
