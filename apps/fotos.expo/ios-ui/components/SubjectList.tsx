/**
 * SubjectList Component (React Native)
 * Displays list of subjects identified in a conversation
 */

import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import type { ChatSubject } from '../hooks/useChatSubjects';

interface SubjectListProps {
  subjects: ChatSubject[];
  loading?: boolean;
  error?: string | null;
  onSubjectPress?: (subject: ChatSubject) => void;
  onMergeSubjects?: (subject1Id: string, subject2Id: string) => Promise<void>;
  showArchived?: boolean;
  compact?: boolean;
}

export function SubjectList({
  subjects,
  loading = false,
  error = null,
  onSubjectPress,
  onMergeSubjects,
  showArchived = false,
  compact = false
}: SubjectListProps) {
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());

  const filteredSubjects = useMemo(() => {
    return showArchived ? subjects : subjects.filter(s => !s.archived);
  }, [subjects, showArchived]);

  const activeCount = useMemo(() => {
    return subjects.filter(s => !s.archived).length;
  }, [subjects]);

  const archivedCount = useMemo(() => {
    return subjects.filter(s => s.archived).length;
  }, [subjects]);

  const handleSubjectPress = (subject: ChatSubject) => {
    if (mergeMode) {
      toggleMergeSelection(subject.id);
    } else if (onSubjectPress) {
      onSubjectPress(subject);
    }
  };

  const toggleMergeSelection = (subjectId: string) => {
    const newSelection = new Set(selectedForMerge);
    if (newSelection.has(subjectId)) {
      newSelection.delete(subjectId);
    } else if (newSelection.size < 2) {
      newSelection.add(subjectId);
    }
    setSelectedForMerge(newSelection);
  };

  const handleMerge = async () => {
    const ids = Array.from(selectedForMerge);
    if (ids.length === 2 && onMergeSubjects) {
      await onMergeSubjects(ids[0], ids[1]);
      setSelectedForMerge(new Set());
      setMergeMode(false);
    }
  };

  const toggleMergeMode = () => {
    setMergeMode(!mergeMode);
    setSelectedForMerge(new Set());
  };

  if (loading) {
    return (
      <View className="p-4 items-center justify-center">
        <ActivityIndicator size="small" color="#3b82f6" />
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-2">
          Loading subjects...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <Text className="text-red-600 dark:text-red-400 text-sm">
          Error: {error}
        </Text>
      </View>
    );
  }

  if (filteredSubjects.length === 0) {
    return (
      <View className="p-4 items-center">
        <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
          No subjects identified yet
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-xs text-center mt-1">
          Subjects will appear as the conversation develops
        </Text>
      </View>
    );
  }

  if (compact) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 p-2">
          {filteredSubjects.slice(0, 5).map((subject) => (
            <Pressable
              key={subject.id}
              onPress={() => handleSubjectPress(subject)}
              className="bg-white dark:bg-gray-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <Text
                className="text-sm font-medium text-gray-800 dark:text-gray-200"
                numberOfLines={1}
              >
                {subject.name}
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {subject.messageCount} messages
              </Text>
            </Pressable>
          ))}
          {filteredSubjects.length > 5 && (
            <View className="bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg items-center justify-center">
              <Text className="text-sm text-gray-500 dark:text-gray-400">
                +{filteredSubjects.length - 5} more
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="bg-white dark:bg-gray-800 rounded-lg">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Conversation Topics
        </Text>
        {subjects.length > 1 && onMergeSubjects && (
          <Pressable
            onPress={toggleMergeMode}
            className={`px-3 py-1.5 rounded-full ${
              mergeMode
                ? 'bg-blue-500'
                : 'bg-gray-100 dark:bg-gray-700'
            }`}
          >
            <Text className={`text-sm font-medium ${
              mergeMode ? 'text-white' : 'text-gray-700 dark:text-gray-300'
            }`}>
              {mergeMode ? 'Cancel' : 'Merge'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Subject List */}
      <View className="p-2">
        {filteredSubjects.map((subject) => {
          const isSelected = selectedForMerge.has(subject.id);

          return (
            <Pressable
              key={subject.id}
              onPress={() => handleSubjectPress(subject)}
              className={`p-3 rounded-lg mb-2 border ${
                mergeMode && isSelected
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50'
              } ${subject.archived ? 'opacity-60' : ''}`}

            >
              {/* Keywords */}
              <View className="flex-row flex-wrap gap-1 mb-2">
                {subject.keywords.slice(0, 5).map((keyword, idx) => (
                  <View
                    key={idx}
                    className="bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded"
                  >
                    <Text className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                      {keyword}
                    </Text>
                  </View>
                ))}
                {subject.keywords.length > 5 && (
                  <View className="bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">
                    <Text className="text-xs text-gray-600 dark:text-gray-300">
                      +{subject.keywords.length - 5}
                    </Text>
                  </View>
                )}
                {subject.archived && (
                  <View className="bg-gray-300 dark:bg-gray-500 px-2 py-0.5 rounded ml-auto">
                    <Text className="text-xs text-gray-600 dark:text-gray-300">
                      archived
                    </Text>
                  </View>
                )}
              </View>

              {/* Description if available */}
              {subject.description && (
                <Text
                  className="text-sm text-gray-600 dark:text-gray-400 mb-2"
                  numberOfLines={2}
                >
                  {subject.description}
                </Text>
              )}

              {/* Metadata */}
              <View className="flex-row items-center gap-4">
                <View className="flex-row items-center gap-1">
                  <Text className="text-xs text-gray-500 dark:text-gray-400">
                    {subject.messageCount} messages
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Text className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDistanceToNow(subject.timestamp, { addSuffix: true })}
                  </Text>
                </View>
              </View>

              {/* Merge selection indicator */}
              {mergeMode && (
                <View className="mt-2">
                  <Text className={`text-xs ${
                    isSelected
                      ? 'text-blue-600 dark:text-blue-400 font-medium'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {isSelected ? 'Selected for merge' : 'Tap to select'}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Merge Button */}
      {mergeMode && selectedForMerge.size === 2 && (
        <View className="px-4 pb-4">
          <Pressable
            onPress={handleMerge}
            className="bg-blue-500 py-3 rounded-lg items-center"

          >
            <Text className="text-white font-semibold">
              Merge Selected Topics
            </Text>
          </Pressable>
        </View>
      )}

      {/* Footer Stats */}
      <View className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <View className="flex-row justify-between">
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {activeCount} active topics
          </Text>
          {archivedCount > 0 && (
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {archivedCount} archived
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
