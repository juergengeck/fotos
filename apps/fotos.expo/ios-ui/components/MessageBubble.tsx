/**
 * MessageBubble Component
 * Message bubble with expandable trace information for AI messages
 */

import { useState, memo, useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronDown, ChevronUp, Cpu, Clock, Hash, Globe } from 'lucide-react-native';
import { formatDistanceToNow } from 'date-fns';
import { useMessageTrace } from '../hooks/useMessageTrace';

interface MessageBubbleProps {
  id: string;
  dataHash?: string;  // Authored Message hash - use for trace lookup
  content: string;
  senderName?: string;
  timestamp: number;
  isOwn: boolean;
  topicName?: string;
  /** Callback to share message to glue.one */
  onShareGlue?: (message: { id: string; text: string; senderName: string; topicName?: string }) => Promise<void>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

export const MessageBubble = memo(function MessageBubble({ id, dataHash, content, senderName, timestamp, isOwn, topicName, onShareGlue }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const [glueShared, setGlueShared] = useState(false);

  // Handle share to glue.one
  const handleShareGlue = async () => {
    if (!onShareGlue || glueShared) return;
    await onShareGlue({ id, text: content, senderName: senderName || 'AI', topicName });
    setGlueShared(true);
  };

  // Only fetch trace for AI messages (not own messages) - use authored Message id for lookup
  const { trace, loading: traceLoading } = useMessageTrace(!isOwn && dataHash ? dataHash : null);

  // Show chevron for all AI messages (not just those with traces)
  const isAIMessage = !isOwn;

  // Memoize expensive date-fns formatting - only recompute when timestamp changes
  const formattedTime = useMemo(
    () => formatDistanceToNow(timestamp, { addSuffix: true }),
    [timestamp]
  );

  return (
    <View
      className={`mx-4 rounded-lg max-w-[80%] ${
        isOwn
          ? 'bg-blue-500'
          : 'bg-gray-200 dark:bg-gray-700'
      }`}
    >
      {/* Header with sender name and trace toggle */}
      <View className="flex-row items-center justify-between p-3 pb-1">
        {!isOwn && senderName ? (
          <Text className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex-1">
            {senderName}
          </Text>
        ) : (
          <View className="flex-1" />
        )}

        {/* Trace toggle button - show for all AI messages */}
        {isAIMessage && (
          <Pressable
            onPress={() => setExpanded(!expanded)}
            className="ml-2 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {expanded ? (
              <ChevronUp size={16} color="#9ca3af" />
            ) : (
              <ChevronDown size={16} color="#9ca3af" />
            )}
          </Pressable>
        )}
      </View>

      {/* Message content */}
      <View className="px-3 pb-1">
        <Text className={isOwn ? 'text-white' : 'text-black dark:text-white'}>
          {content}
        </Text>
      </View>

      {/* Expanded trace info */}
      {expanded && isAIMessage && (
        <View className="mx-3 my-2 p-2 rounded-md bg-black/10 dark:bg-white/10">
          {traceLoading ? (
            <Text className="text-xs text-gray-500 dark:text-gray-400">Loading trace...</Text>
          ) : !trace ? (
            <Text className="text-xs text-gray-500 dark:text-gray-400">No trace available for this message</Text>
          ) : (
            <>
              {/* LLM Info */}
              {trace.llmCall && (
                <View className="flex-row items-center mb-1">
                  <Cpu size={12} color="#6b7280" />
                  <Text className="text-xs text-gray-600 dark:text-gray-400 ml-1">
                    {trace.llmCall.model}
                    {trace.llmCall.provider && ` (${trace.llmCall.provider})`}
                  </Text>
                </View>
              )}

              {/* Tokens */}
              {trace.llmCall && (
                <View className="flex-row items-center mb-1">
                  <Hash size={12} color="#6b7280" />
                  <Text className="text-xs text-gray-600 dark:text-gray-400 ml-1">
                    {formatTokens(trace.llmCall.promptTokens)} in → {formatTokens(trace.llmCall.completionTokens)} out
                    {' '}({formatTokens(trace.llmCall.totalTokens)} total)
                  </Text>
                </View>
              )}

              {/* Timing */}
              <View className="flex-row items-center mb-1">
                <Clock size={12} color="#6b7280" />
                <Text className="text-xs text-gray-600 dark:text-gray-400 ml-1">
                  {formatDuration(trace.processingTimeMs)}
                  {trace.llmCall?.generationTimeMs && ` (${formatDuration(trace.llmCall.generationTimeMs)} generation)`}
                </Text>
              </View>

              {/* Context injection */}
              {trace.contextInjection && trace.contextInjection.subjects.length > 0 && (
                <View className="mt-2 pt-2 border-t border-gray-300/30 dark:border-gray-600/30">
                  <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    Context ({formatTokens(trace.contextInjection.tokenCount)} tokens)
                  </Text>
                  {trace.contextInjection.subjects.slice(0, 3).map((subject, i) => (
                    <View key={i} className="flex-row flex-wrap mb-1">
                      {subject.keywords.slice(0, 4).map((kw, j) => (
                        <View key={j} className="bg-blue-500/20 rounded px-1.5 py-0.5 mr-1 mb-0.5">
                          <Text className="text-xs text-blue-700 dark:text-blue-300">{kw}</Text>
                        </View>
                      ))}
                      {subject.keywords.length > 4 && (
                        <Text className="text-xs text-gray-500">+{subject.keywords.length - 4}</Text>
                      )}
                    </View>
                  ))}
                  {trace.contextInjection.subjects.length > 3 && (
                    <Text className="text-xs text-gray-500">
                      +{trace.contextInjection.subjects.length - 3} more subjects
                    </Text>
                  )}
                </View>
              )}

              {/* Subject extraction */}
              {trace.subjectExtraction && trace.subjectExtraction.extracted.length > 0 && (
                <View className="mt-2 pt-2 border-t border-gray-300/30 dark:border-gray-600/30">
                  <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    Extracted{trace.subjectExtraction.storedToMemory ? ' (saved)' : ''}
                  </Text>
                  {trace.subjectExtraction.extracted.slice(0, 2).map((item, i) => (
                    <View key={i} className="flex-row flex-wrap mb-1">
                      {item.keywords.slice(0, 4).map((kw, j) => (
                        <View key={j} className="bg-green-500/20 rounded px-1.5 py-0.5 mr-1 mb-0.5">
                          <Text className="text-xs text-green-700 dark:text-green-300">{kw}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* Timestamp */}
      <View className="px-3 pb-2">
        <Text
          className={`text-xs ${
            isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {formattedTime}
        </Text>
      </View>

      {/* Action buttons for AI messages */}
      {isAIMessage && onShareGlue && (
        <View className="flex-row px-3 pb-2 gap-2">
          <Pressable
            onPress={handleShareGlue}
            disabled={glueShared}
            className={`p-1.5 rounded-full ${glueShared ? 'bg-yellow-500/20' : 'bg-blue-500/20'}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Globe size={14} color={glueShared ? '#EAB308' : '#3B82F6'} />
          </Pressable>
        </View>
      )}
    </View>
  );
});
