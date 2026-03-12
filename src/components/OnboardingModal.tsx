// ============================================================================
// Onboarding Modal — First-launch welcome + permission setup
// Shows once on first install, walks user through key features.
// ============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  useWindowDimensions,
} from 'react-native';

interface OnboardingModalProps {
  visible: boolean;
  onComplete: () => void;
}

const PAGES = [
  {
    title: 'Welcome to A.EYE.ECHO',
    body: 'Real-time speech-to-text captioning designed for deaf and hard-of-hearing users. Everything runs on your device — no internet required after setup.',
    accent: '#4FC3F7',
  },
  {
    title: 'Live Captions',
    body: 'Large, readable captions in real-time. Choose from high-contrast themes, adjustable fonts (including OpenDyslexic), and customize everything to your needs.',
    accent: '#81C784',
  },
  {
    title: 'Multiple Languages',
    body: 'Transcribe speech in 30+ languages with auto-detection. Enable auto-translation to read captions in your preferred language.',
    accent: '#FFB74D',
  },
  {
    title: 'Sign Language (Beta)',
    body: 'Point the camera at signing hands for ASL fingerspelling recognition. Letters and common signs are converted to text alongside speech captions.',
    accent: '#BA68C8',
  },
  {
    title: 'Vibration Alerts',
    body: 'Feel when someone starts speaking, stops, or when a new speaker joins. Configurable haptic patterns keep you connected even without looking at the screen.',
    accent: '#F06292',
  },
  {
    title: 'Getting Started',
    body: 'Tap the big Start button on the Live tab.\n\nFirst time? A small language model (~142 MB) will download. After that, everything works offline.\n\nGo to Settings to customize your experience.',
    accent: '#4FC3F7',
  },
];

export function OnboardingModal({ visible, onComplete }: OnboardingModalProps) {
  const [page, setPage] = useState(0);
  const { width } = useWindowDimensions();
  const currentPage = PAGES[page];
  const isLast = page === PAGES.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { maxWidth: Math.min(380, width - 48) }]}>
          {/* Page indicator dots */}
          <View style={styles.dots}>
            {PAGES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === page && { backgroundColor: currentPage.accent },
                ]}
              />
            ))}
          </View>

          {/* Content */}
          <Text style={[styles.title, { color: currentPage.accent }]}>
            {currentPage.title}
          </Text>
          <Text style={styles.body}>
            {currentPage.body}
          </Text>

          {/* Navigation */}
          <View style={styles.nav}>
            {page > 0 ? (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setPage(page - 1)}
              >
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.backButton} />
            )}

            <TouchableOpacity
              style={[styles.nextButton, { backgroundColor: currentPage.accent }]}
              onPress={() => {
                if (isLast) {
                  onComplete();
                } else {
                  setPage(page + 1);
                }
              }}
              accessible
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Get started' : 'Next page'}
            >
              <Text style={styles.nextText}>
                {isLast ? 'Get Started' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Skip */}
          {!isLast && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={onComplete}
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: '#CCC',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 70,
  },
  backText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '500',
  },
  nextButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  nextText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  skipText: {
    color: '#555',
    fontSize: 14,
  },
});
