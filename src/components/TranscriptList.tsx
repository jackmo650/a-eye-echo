// ============================================================================
// Transcript List — Scrolling transcript view with speaker labels + timestamps
// Supports:
//   - Auto-scroll with "pull to pause" behavior
//   - Speaker color coding + avatar thumbnails
//   - Tap segment to highlight (future: seek to timestamp)
//   - Search within transcript
// ============================================================================

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  type ListRenderItem,
} from 'react-native';
import type { TranscriptSegment, Speaker } from '../types';

interface TranscriptListProps {
  segments: TranscriptSegment[];
  speakers: Speaker[];
  /** Called when user taps a segment (for seek-to-timestamp feature) */
  onSegmentPress?: (segment: TranscriptSegment) => void;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function TranscriptList({
  segments,
  speakers,
  onSegmentPress,
}: TranscriptListProps) {
  const flatListRef = useRef<FlatList>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const speakerMap = new Map(speakers.map(s => [s.id, s]));

  // Auto-scroll to bottom when new segments arrive
  const onContentSizeChange = useCallback(() => {
    if (autoScroll && flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [autoScroll]);

  // Pause auto-scroll when user scrolls up
  const onScrollBeginDrag = useCallback(() => {
    setAutoScroll(false);
  }, []);

  // Resume auto-scroll when user scrolls to bottom
  const onMomentumScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const isAtBottom = contentOffset.y >= contentSize.height - layoutMeasurement.height - 50;
      if (isAtBottom) setAutoScroll(true);
    },
    [],
  );

  const renderItem: ListRenderItem<TranscriptSegment> = useCallback(
    ({ item, index }) => {
      const speaker = item.speakerId ? speakerMap.get(item.speakerId) : null;
      const prevSegment = index > 0 ? segments[index - 1] : null;
      const showSpeaker = !prevSegment || prevSegment.speakerId !== item.speakerId;

      // Visual paragraph break on long pauses (>3s)
      const showBreak = prevSegment && (item.startMs - prevSegment.endMs > 3000);

      return (
        <TouchableOpacity
          style={[styles.segmentRow, showBreak && styles.segmentBreak]}
          onPress={() => onSegmentPress?.(item)}
          activeOpacity={0.6}
          accessible
          accessibilityLabel={`${speaker?.label || 'Unknown'} at ${formatTime(item.startMs)}: ${item.translatedText || item.text}`}
        >
          <Text style={styles.timestamp}>{formatTime(item.startMs)}</Text>
          <View style={styles.segmentContent}>
            <View style={styles.segmentHeader}>
              {showSpeaker && speaker && (
                <Text style={[styles.speakerName, { color: speaker.color }]}>
                  {speaker.label}
                </Text>
              )}
              {item.source === 'sign-language' && (
                <Text style={styles.sourceTag}>ASL</Text>
              )}
            </View>
            {item.translatedText ? (
              <>
                <Text style={styles.segmentText}>{item.translatedText}</Text>
                <Text style={styles.originalText}>{item.text}</Text>
              </>
            ) : (
              <Text style={styles.segmentText}>{item.text}</Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [segments, speakerMap, onSegmentPress],
  );

  if (segments.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          Transcript will appear here as speech is detected...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!autoScroll && (
        <TouchableOpacity
          style={styles.scrollToBottomButton}
          onPress={() => {
            setAutoScroll(true);
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.scrollToBottomText}>Scroll to latest</Text>
        </TouchableOpacity>
      )}
      <FlatList
        ref={flatListRef}
        data={segments}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        onContentSizeChange={onContentSizeChange}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={true}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0A0A0A',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    textAlign: 'center',
  },
  segmentRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    gap: 12,
  },
  segmentBreak: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  timestamp: {
    color: '#555',
    fontSize: 12,
    fontFamily: 'SF Mono',
    fontVariant: ['tabular-nums'],
    width: 44,
    paddingTop: 2,
  },
  segmentContent: {
    flex: 1,
  },
  segmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speakerName: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  sourceTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4FC3F7',
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 2,
  },
  segmentText: {
    color: '#E0E0E0',
    fontSize: 16,
    lineHeight: 22,
  },
  originalText: {
    color: '#4FC3F7',
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    opacity: 0.7,
    marginTop: 2,
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  scrollToBottomText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
