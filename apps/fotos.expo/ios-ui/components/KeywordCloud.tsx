/**
 * KeywordCloud Component (React Native)
 * Displays keywords as touchable badges
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import type { ChatKeyword } from '../hooks/useChatKeywords';

interface KeywordCloudProps {
  keywords: ChatKeyword[] | string[];
  maxDisplay?: number;
  onKeywordPress?: (keyword: string) => void;
  compact?: boolean;
}

interface CloudKeyword {
  text: string;
  size: number;
  frequency?: number;
}

function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function getSizeStyles(size: number) {
  if (size >= 9) return { fontSize: 16, fontWeight: '700' as const };
  if (size >= 7) return { fontSize: 14, fontWeight: '600' as const };
  if (size >= 5) return { fontSize: 13, fontWeight: '500' as const };
  if (size >= 3) return { fontSize: 12, fontWeight: '400' as const };
  return { fontSize: 11, fontWeight: '400' as const };
}

function getColorClass(size: number): string {
  if (size >= 9) return 'bg-blue-500';
  if (size >= 7) return 'bg-blue-400';
  if (size >= 5) return 'bg-sky-400';
  if (size >= 3) return 'bg-slate-400';
  return 'bg-gray-400';
}

export function KeywordCloud({
  keywords,
  maxDisplay = 15,
  onKeywordPress,
  compact = false
}: KeywordCloudProps) {
  const cloudData = useMemo(() => {
    if (keywords.length === 0) return [];

    let cloudKeywords: CloudKeyword[];

    if (typeof keywords[0] === 'string') {
      // Simple string array
      cloudKeywords = (keywords as string[]).slice(0, maxDisplay).map((text, index) => ({
        text,
        size: Math.max(1, 10 - Math.floor(index / 3))
      }));
    } else {
      // ChatKeyword objects
      const keywordObjects = keywords as ChatKeyword[];
      const maxFreq = Math.max(...keywordObjects.map(k => k.frequency || 1));

      cloudKeywords = keywordObjects.slice(0, maxDisplay).map(keyword => ({
        text: keyword.term,
        size: Math.ceil(((keyword.frequency || 1) / maxFreq) * 10),
        frequency: keyword.frequency
      }));
    }

    // Shuffle for visual variety
    return shuffleArray(cloudKeywords);
  }, [keywords, maxDisplay]);

  if (cloudData.length === 0) {
    return (
      <View className="items-center justify-center p-4">
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          No keywords yet
        </Text>
      </View>
    );
  }

  if (compact) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-1 p-2">
          {cloudData.slice(0, 8).map((keyword, index) => (
            <Pressable
              key={`${keyword.text}-${index}`}
              onPress={() => onKeywordPress?.(keyword.text)}
              className={`${getColorClass(keyword.size)} px-2 py-1 rounded-full`}
            >
              <Text className="text-white text-xs font-medium">
                {keyword.text}
              </Text>
            </Pressable>
          ))}
          {cloudData.length > 8 && (
            <View className="bg-gray-300 dark:bg-gray-600 px-2 py-1 rounded-full">
              <Text className="text-gray-600 dark:text-gray-300 text-xs">
                +{cloudData.length - 8}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="p-4">
      <View className="flex-row flex-wrap justify-center items-center gap-2">
        {cloudData.map((keyword, index) => {
          const sizeStyles = getSizeStyles(keyword.size);

          return (
            <Pressable
              key={`${keyword.text}-${index}`}
              onPress={() => onKeywordPress?.(keyword.text)}
              className={`${getColorClass(keyword.size)} px-3 py-1.5 rounded-full`}

            >
              <Text
                className="text-white"
                style={sizeStyles}
              >
                {keyword.text}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Legend */}
      <View className="flex-row justify-center items-center gap-4 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <View className="flex-row items-center gap-1">
          <View className="w-3 h-3 rounded-full bg-blue-500" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">High</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2.5 h-2.5 rounded-full bg-sky-400" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">Medium</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2 h-2 rounded-full bg-gray-400" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">Low</Text>
        </View>
      </View>
    </View>
  );
}
