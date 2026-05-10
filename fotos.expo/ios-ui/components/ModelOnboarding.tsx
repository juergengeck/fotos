/**
 * ModelOnboarding - Native iOS Model Selection for First-Time Setup
 *
 * Shows when user first opens the app and no default AI model is configured.
 * Allows downloading local models (llama.rn) and configures default AI.
 * Uses LocalModelPlan from the module system via getModel().
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView, SafeAreaView, StyleSheet } from 'react-native';
import { getModel } from '../index';
import {
  AVAILABLE_MODELS,
  type LocalModelInfo,
  type ModelState,
  type LocalModelPlan,
} from '../modules/LocalModelModule';

const PRIMARY_COLOR = '#1b7e50';
const PRIMARY_SURFACE = '#edf8f2';
const PRIMARY_BORDER = '#80c4a4';

export interface ModelOnboardingProps {
  /** Called when onboarding is complete, receives the model ID */
  onComplete: (modelId: string) => Promise<void>;
  /** Allow skipping model selection */
  allowSkip?: boolean;
}

export function ModelOnboarding({
  onComplete,
  allowSkip = true,
}: ModelOnboardingProps): React.ReactElement {
  const [selectedModel, setSelectedModel] = useState<LocalModelInfo | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ status: 'not_installed' });
  const [isCompleting, setIsCompleting] = useState(false);
  const [localModelPlan, setLocalModelPlan] = useState<LocalModelPlan | null>(null);

  // Get the LocalModelPlan from the global model
  useEffect(() => {
    const model = getModel();
    if (model?.localModelPlan) {
      setLocalModelPlan(model.localModelPlan);
    }
  }, []);

  // Surface broken local model dependencies instead of pretending setup completed.
  useEffect(() => {
    if (localModelPlan && !localModelPlan.isAvailable() && !isCompleting) {
      setModelState({
        status: 'error',
        error: localModelPlan.getUnavailableReason() ?? 'Local models are unavailable',
      });
    }
  }, [localModelPlan, isCompleting]);

  const formatProgress = (progress?: number): string => {
    if (typeof progress !== 'number') return '';
    return `${Math.round(progress)}%`;
  };

  const handleSelectModel = useCallback(async (model: LocalModelInfo) => {
    if (!localModelPlan) {
      console.warn('[ModelOnboarding] LocalModelPlan not available');
      return;
    }

    setSelectedModel(model);

    // Check current state
    const state = await localModelPlan.getModelState(model.id);
    setModelState(state);

    if (state.status === 'error') {
      return;
    }

    // If already installed, complete setup
    if (state.status === 'installed' || state.status === 'ready') {
      setIsCompleting(true);
      try {
        await onComplete(model.id);
      } catch (error) {
        setModelState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Model setup failed',
          modelId: model.id,
        });
      } finally {
        setIsCompleting(false);
      }
      return;
    }

    // Start download
    setModelState({ status: 'downloading', progress: 0, modelId: model.id });

    try {
      await localModelPlan.downloadModel(model, (progress) => {
        setModelState({ status: 'downloading', progress, modelId: model.id });
      });

      setModelState({ status: 'installed', modelId: model.id });

      // Complete setup with this model
      setIsCompleting(true);
      await onComplete(model.id);
    } catch (error) {
      setModelState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Download failed',
        modelId: model.id,
      });
    } finally {
      setIsCompleting(false);
    }
  }, [onComplete, localModelPlan]);

  const handleSkip = useCallback(async () => {
    setIsCompleting(true);
    try {
      await onComplete('');
    } finally {
      setIsCompleting(false);
    }
  }, [onComplete]);

  if (isCompleting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY_COLOR} />
          <Text style={styles.centeredText}>Setting up your AI assistant...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show loading if plan not ready yet
  if (!localModelPlan) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY_COLOR} />
          <Text style={styles.centeredText}>Initializing...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Welcome to VGER</Text>
          <Text style={styles.subtitle}>
            Choose a local AI model to get started. Your conversations stay private on your device.
          </Text>
        </View>

        {allowSkip && (
          <Pressable
            onPress={handleSkip}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip for now →</Text>
          </Pressable>
        )}

        {modelState.status === 'downloading' && selectedModel && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <ActivityIndicator size="small" color={PRIMARY_COLOR} />
              <Text style={styles.progressTitle}>
                Downloading {selectedModel.name}...
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${modelState.progress || 0}%` }]}
              />
            </View>
            <Text style={styles.progressPercent}>
              {formatProgress(modelState.progress)}
            </Text>
          </View>
        )}

        {modelState.status === 'error' && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Model Setup Failed</Text>
            <Text style={styles.errorText}>{modelState.error}</Text>
          </View>
        )}

        <View style={styles.modelSection}>
          <Text style={styles.sectionTitle}>
            Local AI Models
          </Text>
          <View style={styles.privacyCard}>
            <Text style={styles.privacyText}>
              🔒 Privacy: These models run entirely on your device. Your conversations never leave your phone.
            </Text>
          </View>

          {AVAILABLE_MODELS.map((model) => (
            <Pressable
              key={model.id}
              onPress={() => handleSelectModel(model)}
              disabled={modelState.status === 'downloading'}
              style={[
                styles.modelCard,
                selectedModel?.id === model.id && styles.selectedModelCard,
                modelState.status === 'downloading' && styles.disabledCard,
              ]}
            >
              <View style={styles.modelRow}>
                <View style={styles.modelText}>
                  <Text style={styles.modelName}>{model.name}</Text>
                  <Text style={styles.modelDescription}>{model.description}</Text>
                  <Text style={styles.modelSize}>Size: {model.size}</Text>
                </View>
                <View style={styles.modelAction}>
                  {selectedModel?.id === model.id && modelState.status === 'downloading' ? (
                    <ActivityIndicator size="small" color={PRIMARY_COLOR} />
                  ) : selectedModel?.id === model.id && modelState.status === 'installed' ? (
                    <View style={styles.installedBadge}>
                      <Text style={styles.installedText}>✓</Text>
                    </View>
                  ) : (
                    <View style={styles.downloadBadge}>
                      <Text style={styles.downloadText}>Download</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centeredText: {
    marginTop: 16,
    color: '#4b5563',
    fontSize: 18,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    marginBottom: 8,
    color: '#111827',
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    color: '#4b5563',
    fontSize: 18,
    lineHeight: 24,
  },
  skipButton: {
    marginBottom: 24,
    paddingVertical: 8,
  },
  skipText: {
    color: PRIMARY_COLOR,
    fontSize: 16,
  },
  progressCard: {
    marginBottom: 24,
    borderRadius: 12,
    backgroundColor: PRIMARY_SURFACE,
    padding: 16,
  },
  progressHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressTitle: {
    marginLeft: 8,
    color: PRIMARY_COLOR,
    fontWeight: '600',
  },
  progressTrack: {
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#d5efe1',
  },
  progressFill: {
    height: '100%',
    backgroundColor: PRIMARY_COLOR,
  },
  progressPercent: {
    marginTop: 4,
    color: PRIMARY_COLOR,
    textAlign: 'right',
    fontSize: 14,
  },
  errorCard: {
    marginBottom: 24,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    padding: 16,
  },
  errorTitle: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  errorText: {
    marginTop: 4,
    color: '#dc2626',
    fontSize: 14,
  },
  modelSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    marginBottom: 16,
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
  },
  privacyCard: {
    marginBottom: 16,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    padding: 12,
  },
  privacyText: {
    color: '#15803d',
    fontSize: 14,
    lineHeight: 19,
  },
  modelCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    padding: 16,
  },
  selectedModelCard: {
    borderColor: PRIMARY_BORDER,
    backgroundColor: PRIMARY_SURFACE,
  },
  disabledCard: {
    opacity: 0.5,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  modelText: {
    flex: 1,
    minWidth: 0,
  },
  modelName: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
  },
  modelDescription: {
    marginTop: 4,
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 19,
  },
  modelSize: {
    marginTop: 8,
    color: '#6b7280',
    fontSize: 12,
  },
  modelAction: {
    marginLeft: 12,
  },
  installedBadge: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#22c55e',
  },
  installedText: {
    color: '#ffffff',
    fontSize: 12,
  },
  downloadBadge: {
    borderRadius: 999,
    backgroundColor: PRIMARY_COLOR,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  downloadText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});
