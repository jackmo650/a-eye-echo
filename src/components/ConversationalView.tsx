// ============================================================================
// Conversational View — Chat-bubble layout for transcripts
// Matt's feedback: "Use chat layout A: <blah> B: <blah> — much easier to read."
//
// Speaker A's messages align left, Speaker B's align right.
// Each speaker gets their own color. Timestamps shown subtly.
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

interface ConversationalViewProps {
  segments: TranscriptSegment[];
  speakers: Speaker[];
  onSegmentPress?: (segment: TranscriptSegment) => void;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Default colors for speakers without camera detection
const FALLBACK_COLORS = ['#4FC3F7', '#FFB74D', '#81C784', '#E57373', '#BA68C8', '#FFD54F'];

export function ConversationalView({
  segments,
  speakers,
  onSegmentPress,
}: ConversationalViewProps) {
  const flatListRef = useRef<FlatList>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const speakerMap = new Map(speakers.map(s => [s.id, s]));

  // Track unique speaker IDs for left/right alignment
  const speakerOrder: string[] = [];
  for (const seg of segments) {
    if (seg.speakerId && !speakerOrder.includes(seg.speakerId)) {
      speakerOrder.push(seg.speakerId);
    }
  }

  const onContentSizeChange = useCallback(() => {
    if (autoScroll && flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [autoScroll]);

  const onScrollBeginDrag = useCallback(() => setAutoScroll(false), []);

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
      const speakerIndex = item.speakerId ? speakerOrder.indexOf(item.speakerId) : -1;

      // First speaker = left, second+ = right. No speaker = left.
      const isRight = speakerIndex > 0;
      const color = speaker?.color || FALLBACK_COLORS[Math.max(0, speakerIndex) % FALLBACK_COLORS.length];
      const bgColor = color + '18'; // Very subtle tint

      // Show speaker name when speaker changes
      const prevSegment = index > 0 ? segments[index - 1] : null;
      const showName = !prevSegment || prevSegment.speakerId !== item.speakerId;

      // Group consecutive segments from same speaker with tighter spacing
      const isContinuation = prevSegment && prevSegment.speakerId === item.speakerId;

      return (
        <TouchableOpacity
          style={[
            styles.bubbleRow,
            isRight ? styles.bubbleRowRight : styles.bubbleRowLeft,
            isContinuation && styles.bubbleContinuation,
          ]}
          onPress={() => onSegmentPress?.(item)}
          activeOpacity={0.7}
        >
          <View style={[
            styles.bubble,
            isRight ? styles.bubbleRight : styles.bubbleLeft,
            { backgroundColor: bgColor, borderColor: color + '30' },
          ]}>
            {showName && speaker && (
              <Text style={[styles.bubbleSpeaker, { color }]}>
                {speaker.label}
              </Text>
            )}
            {item.translatedText ? (
              <>
                <Text style={styles.bubbleText}>{item.translatedText}</Text>
                <Text style={styles.bubbleOriginal}>{item.text}</Text>
              </>
            ) : (
              <Text style={styles.bubbleText}>{item.text}</Text>
            )}
            <Text style={styles.bubbleTime}>{formatTime(item.startMs)}</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [segments, speakerMap, speakerOrder, onSegmentPress],
  );

  if (segments.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          Conversation will appear here as speech is detected...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!autoScroll && (
        <TouchableOpacity
          style={styles.scrollBtn}
          onPress={() => {
            setAutoScroll(true);
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.scrollBtnText}>Scroll to latest</Text>
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
    padding: 12,
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
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
    paddingRight: 48,
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
    paddingLeft: 48,
  },
  bubbleContinuation: {
    marginBottom: 3,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    maxWidth: '100%',
  },
  bubbleLeft: {
    borderTopLeftRadius: 4,
  },
  bubbleRight: {
    borderTopRightRadius: 4,
  },
  bubbleSpeaker: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  bubbleText: {
    color: '#E0E0E0',
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleOriginal: {
    color: '#4FC3F7',
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    opacity: 0.7,
    marginTop: 3,
  },
  bubbleTime: {
    color: '#555',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
  scrollBtn: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  scrollBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
