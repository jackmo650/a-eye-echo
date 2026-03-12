// ============================================================================
// Error Boundary — Catches React render errors and shows recovery UI
// Prevents full-app crashes from killing the captioning experience.
// ============================================================================

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            A.EYE.ECHO encountered an error. Your saved sessions are safe.
          </Text>
          {this.state.error && (
            <Text style={styles.errorDetail} numberOfLines={3}>
              {this.state.error.message}
            </Text>
          )}
          <TouchableOpacity
            style={styles.resetButton}
            onPress={this.handleReset}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.resetText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  title: {
    color: '#E53935',
    fontSize: 22,
    fontWeight: '700',
  },
  message: {
    color: '#CCC',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorDetail: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    fontFamily: 'SF Mono',
    backgroundColor: '#1A1A1A',
    padding: 12,
    borderRadius: 8,
    width: '100%',
    overflow: 'hidden',
  },
  resetButton: {
    backgroundColor: '#4FC3F7',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  resetText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});
