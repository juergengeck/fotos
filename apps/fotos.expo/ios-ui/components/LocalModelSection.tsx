/**
 * Settings section for local model management
 */

import React, { useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useLocalModel } from '../hooks/useLocalModel';
import { useTopics } from '../hooks/useTopics';
import { useModel } from '../hooks/ModelContext';
import { useRouter } from 'expo-router';

export function LocalModelSection(): React.ReactElement {
  const model = useModel();
  const { state, availableModels, selectedModel, selectModel, download, remove, isReady } = useLocalModel();
  const { topics, createTopic } = useTopics();
  const router = useRouter();

  // Show loading state if module not ready yet
  if (!isReady) {
    return (
      <View className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
        <Text className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Local AI Model</Text>
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Initializing...</Text>
        </View>
      </View>
    );
  }

  const createDefaultAIChat = useCallback(async (modelId: string, modelName: string): Promise<string | null> => {
    // Check if there's already an AI topic
    // Topics don't have a type field exposed, so we create one if there are no topics
    // or if user explicitly downloads the model
    try {
      // Pass the model ID so ChatPlan knows which AI to use (like vger.cube does)
      const topicId = await createTopic(`Chat with ${modelName}`, true, modelId);
      console.log('[LocalModelSection] Created default AI chat:', topicId);
      return topicId;
    } catch (error) {
      console.error('[LocalModelSection] Failed to create AI chat:', error);
      return null;
    }
  }, [createTopic]);

  const formatProgress = (progress?: number): string => {
    if (typeof progress !== 'number') return '';
    return `${Math.round(progress)}%`;
  };

  const renderStatus = (): React.ReactElement => {
    switch (state.status) {
      case 'not_installed':
        return (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No model installed
          </Text>
        );
      case 'downloading':
        return (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-blue-500 dark:text-blue-400 text-sm">
              Downloading... {formatProgress(state.progress)}
            </Text>
          </View>
        );
      case 'installed':
        return (
          <Text className="text-green-500 dark:text-green-400 text-sm">
            Installed
          </Text>
        );
      case 'loading':
        return (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-blue-500 dark:text-blue-400 text-sm">Loading...</Text>
          </View>
        );
      case 'ready':
        return (
          <Text className="text-green-500 dark:text-green-400 text-sm">Ready</Text>
        );
      case 'error':
        return (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            Error: {state.error}
          </Text>
        );
    }
  };

  const handleAction = async (): Promise<void> => {
    if (!selectedModel) return;

    if (state.status === 'not_installed' || state.status === 'error') {
      console.log('[LocalModelSection] Starting download for:', selectedModel.id);
      await download(selectedModel.id);
      // Create default AI chat after successful download
      // Pass both model ID and name so ChatPlan can associate the topic with this model
      const topicId = await createDefaultAIChat(selectedModel.id, selectedModel.name);
      if (topicId) {
        // Navigate to the new chat
        router.push(`/chat?topicId=${topicId}`);
      }
    } else if (state.status === 'installed' || state.status === 'ready') {
      await remove(selectedModel.id);
    }
  };

  const getActionLabel = (): string => {
    switch (state.status) {
      case 'not_installed':
      case 'error':
        return 'Download';
      case 'installed':
      case 'ready':
        return 'Delete';
      default:
        return '';
    }
  };

  const isActionDisabled = state.status === 'downloading' || state.status === 'loading';

  return (
    <View className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
      <Text className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Local AI Model</Text>

      <View className="flex-row flex-wrap gap-2 mb-3">
        {availableModels.map((localModel) => {
          const isSelected = selectedModel?.id === localModel.id;
          return (
            <Pressable
              key={localModel.id}
              onPress={() => selectModel(localModel.id)}
              className={`px-3 py-2 rounded-lg border ${
                isSelected
                  ? 'bg-blue-500 border-blue-500'
                  : 'bg-transparent border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  isSelected
                    ? 'text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {localModel.backend.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selectedModel && (
        <View className="mb-3">
          <Text className="font-medium text-gray-900 dark:text-white">{selectedModel.name}</Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">{selectedModel.description}</Text>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">Size: {selectedModel.size}</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-shrink">
          {renderStatus()}
        </View>

        {!isActionDisabled && (
          <Pressable
            onPress={handleAction}
            className={`flex-shrink-0 px-4 py-2 rounded-lg ${
              state.status === 'installed' || state.status === 'ready'
                ? 'bg-red-100 dark:bg-red-900'
                : 'bg-blue-500'
            }`}
          >
            <Text
              className={`font-medium ${
                state.status === 'installed' || state.status === 'ready'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-white'
              }`}
            >
              {getActionLabel()}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
