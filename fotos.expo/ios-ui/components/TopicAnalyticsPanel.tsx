/**
 * TopicAnalyticsPanel Component (React Native)
 * Combines KeywordCloud and SubjectList with collapsible sections
 * Can be used as a drawer/sheet or inline panel
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager
} from 'react-native';
import { KeywordCloud } from './KeywordCloud';
import { SubjectList } from './SubjectList';
import { useChatKeywords } from '../hooks/useChatKeywords';
import { useChatSubjects } from '../hooks/useChatSubjects';
import { useImapSource } from '../hooks/useImapSource';
import { useTopicSummary } from '../hooks/useTopicSummary';
import { useModel } from '../hooks/ModelContext';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const dateFormatter = new Intl.DateTimeFormat();

function formatUpdatedAt(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return 'Unavailable';
  }

  return new Date(timestamp).toLocaleString();
}

interface TopicAnalyticsPanelProps {
  topicId: string | null;
  onKeywordPress?: (keyword: string) => void;
  onSubjectPress?: (subject: any) => void;
  variant?: 'full' | 'compact' | 'inline';
  showSummary?: boolean;
  showKeywords?: boolean;
  showSubjects?: boolean;
}

type SectionId = 'summary' | 'keywords' | 'subjects' | 'imap';

export function TopicAnalyticsPanel({
  topicId,
  onKeywordPress,
  onSubjectPress,
  variant = 'full',
  showSummary = true,
  showKeywords = true,
  showSubjects = true
}: TopicAnalyticsPanelProps) {
  const model = useModel();

  // Use the analytics hooks
  const {
    keywords,
    loading: keywordsLoading,
    error: keywordsError,
    keywordsJustAppeared
  } = useChatKeywords(topicId);

  const {
    subjects,
    loading: subjectsLoading,
    error: subjectsError,
    subjectsJustAppeared
  } = useChatSubjects(topicId);

  const {
    summary,
    loading: summaryLoading,
    generateSummary
  } = useTopicSummary(topicId);

  const {
    mailboxes: imapMailboxes,
    threadMappings: imapThreadMappings,
    isLoading: imapLoading,
    error: imapError,
    refresh: refreshImap,
  } = useImapSource({
    ...(topicId ? { topicIdHash: topicId } : {}),
    includeThreadMappings: true,
  });

  // Collapsible section state
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(
    new Set(['keywords', 'subjects', 'imap'])
  );

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const toggleSection = useCallback((section: SectionId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!topicId || !model.topicAnalysisPlan || isAnalyzing) return;

    setIsAnalyzing(true);
    try {
      // This will trigger analysis which updates keywords and subjects
      await model.topicAnalysisPlan.analyzeMessages({ topicId });
    } catch (error) {
      console.error('[TopicAnalyticsPanel] Analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [topicId, model, isAnalyzing]);

  const handleGenerateSummary = useCallback(async () => {
    if (!topicId) return;
    await generateSummary();
  }, [topicId, generateSummary]);

  const hasImapContext = imapLoading || Boolean(imapError) || imapMailboxes.length > 0 || imapThreadMappings.length > 0;

  if (!topicId) {
    return (
      <View className="p-4 items-center">
        <Text className="text-gray-500 dark:text-gray-400">
          Select a conversation to view analytics
        </Text>
      </View>
    );
  }

  const isLoading = keywordsLoading || subjectsLoading;
  const hasContent = keywords.length > 0 || subjects.length > 0 || summary || hasImapContext;

  // Compact variant for inline use
  if (variant === 'compact') {
    return (
      <View className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
        {keywords.length > 0 && showKeywords && (
          <KeywordCloud
            keywords={keywords}
            maxDisplay={8}
            onKeywordPress={onKeywordPress}
            compact
          />
        )}
        {subjects.length > 0 && showSubjects && (
          <SubjectList
            subjects={subjects}
            onSubjectPress={onSubjectPress}
            compact
          />
        )}
        {!hasContent && !isLoading && (
          <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
            No analytics data yet
          </Text>
        )}
      </View>
    );
  }

  // Inline variant for embedding in other views
  if (variant === 'inline') {
    return (
      <View>
        {showKeywords && keywords.length > 0 && (
          <View className="mb-4">
            <KeywordCloud
              keywords={keywords}
              maxDisplay={10}
              onKeywordPress={onKeywordPress}
            />
          </View>
        )}
        {showSubjects && subjects.length > 0 && (
          <SubjectList
            subjects={subjects}
            onSubjectPress={onSubjectPress}
          />
        )}
      </View>
    );
  }

  // Full variant with collapsible sections
  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <View className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Analytics
          </Text>
          <Pressable
            onPress={handleAnalyze}
            disabled={isAnalyzing}
            className={`px-4 py-2 rounded-full ${
              isAnalyzing
                ? 'bg-gray-200 dark:bg-gray-700'
                : 'bg-blue-500'
            }`}

          >
            {isAnalyzing ? (
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color="#6b7280" />
                <Text className="text-gray-500 dark:text-gray-400 ml-2 text-sm">
                  Analyzing...
                </Text>
              </View>
            ) : (
              <Text className="text-white text-sm font-medium">
                Analyze
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Summary Section */}
      {showSummary && (
        <CollapsibleSection
          title="Summary"
          isExpanded={expandedSections.has('summary')}
          onToggle={() => toggleSection('summary')}
          badge={summary ? '1' : undefined}
        >
          {summaryLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color="#3b82f6" />
            </View>
          ) : summary ? (
            <View className="p-4">
              <Text className="text-gray-700 dark:text-gray-300">
                {summary.prose || summary.content}
              </Text>
              {summary.updatedAt && (
                <Text className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Updated {dateFormatter.format(new Date(summary.updatedAt))}
                </Text>
              )}
            </View>
          ) : (
            <View className="p-4 items-center">
              <Text className="text-gray-500 dark:text-gray-400 text-sm mb-3">
                No summary yet
              </Text>
              <Pressable
                onPress={handleGenerateSummary}
                className="bg-blue-100 dark:bg-blue-900/40 px-4 py-2 rounded-lg"
    
              >
                <Text className="text-blue-600 dark:text-blue-400 text-sm font-medium">
                  Generate Summary
                </Text>
              </Pressable>
            </View>
          )}
        </CollapsibleSection>
      )}

      {/* Keywords Section */}
      {showKeywords && (
        <CollapsibleSection
          title="Keywords"
          isExpanded={expandedSections.has('keywords')}
          onToggle={() => toggleSection('keywords')}
          badge={keywords.length > 0 ? String(keywords.length) : undefined}
          highlight={keywordsJustAppeared}
        >
          {keywordsLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color="#3b82f6" />
            </View>
          ) : keywordsError ? (
            <View className="p-4">
              <Text className="text-red-500 text-sm">{keywordsError}</Text>
            </View>
          ) : (
            <KeywordCloud
              keywords={keywords}
              maxDisplay={15}
              onKeywordPress={onKeywordPress}
            />
          )}
        </CollapsibleSection>
      )}

      {/* Subjects Section */}
      {showSubjects && (
        <CollapsibleSection
          title="Discussion Topics"
          isExpanded={expandedSections.has('subjects')}
          onToggle={() => toggleSection('subjects')}
          badge={subjects.length > 0 ? String(subjects.length) : undefined}
          highlight={subjectsJustAppeared}
        >
          {subjectsLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color="#3b82f6" />
            </View>
          ) : subjectsError ? (
            <View className="p-4">
              <Text className="text-red-500 text-sm">{subjectsError}</Text>
            </View>
          ) : (
            <SubjectList
              subjects={subjects}
              onSubjectPress={onSubjectPress}
            />
          )}
        </CollapsibleSection>
      )}

      {/* IMAP Context Section */}
      {hasImapContext && (
        <CollapsibleSection
          title="Mail Source Context"
          isExpanded={expandedSections.has('imap')}
          onToggle={() => toggleSection('imap')}
          badge={String(imapMailboxes.length + imapThreadMappings.length)}
        >
          {imapLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color="#3b82f6" />
            </View>
          ) : imapError ? (
            <View className="p-4">
              <Text className="text-red-500 text-sm">{imapError}</Text>
            </View>
          ) : (
            <View className="p-4">
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 pr-3 text-sm text-gray-600 dark:text-gray-300">
                  {imapMailboxes.length} mapped mailboxes and {imapThreadMappings.length} thread bindings for this topic.
                </Text>
                <Pressable
                  onPress={() => { void refreshImap(); }}
                  className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-3 py-2"
                >
                  <Text className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    Refresh
                  </Text>
                </Pressable>
              </View>

              <View className="mt-4">
                <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Mailboxes
                </Text>
                {imapMailboxes.length === 0 ? (
                  <Text className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    No mailbox mappings stored for this topic yet.
                  </Text>
                ) : (
                  <View className="mt-2">
                    {imapMailboxes.map((mailbox) => (
                      <View
                        key={mailbox.mailboxEntryIdHash}
                        className="mb-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3"
                      >
                        <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {mailbox.mailboxName}
                        </Text>
                        <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {mailbox.sourceTitle} · {mailbox.messageCount ?? 0} messages
                        </Text>
                        <Text className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          Folder path: {mailbox.folderPathSegments.join(' / ')}
                        </Text>
                        <Text className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          Updated {formatUpdatedAt(mailbox.updatedAt)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View className="mt-2">
                <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Thread Bindings
                </Text>
                {imapThreadMappings.length === 0 ? (
                  <Text className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    No thread bindings stored for this topic yet.
                  </Text>
                ) : (
                  <View className="mt-2">
                    {imapThreadMappings.slice(0, 6).map((mapping) => (
                      <View
                        key={mapping.mappingIdHash}
                        className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3"
                      >
                        <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {mapping.subject ?? mapping.messageId ?? mapping.threadKey}
                        </Text>
                        <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {(mapping.mailboxName ?? mapping.threadKey)} · {mapping.threadIdentityKind}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}
        </CollapsibleSection>
      )}

      {/* Empty State */}
      {!hasContent && !isLoading && (
        <View className="p-8 items-center">
          <Text className="text-gray-500 dark:text-gray-400 text-center mb-4">
            No analytics data yet.{'\n'}
            Start a conversation or tap Analyze.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// Collapsible Section Component
interface CollapsibleSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  badge?: string;
  highlight?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  isExpanded,
  onToggle,
  badge,
  highlight = false,
  children
}: CollapsibleSectionProps) {
  return (
    <View className={`bg-white dark:bg-gray-800 mt-2 mx-2 rounded-lg overflow-hidden ${
      highlight ? 'border-2 border-blue-400' : ''
    }`}>
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700"

      >
        <View className="flex-row items-center">
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </Text>
          {badge && (
            <View className="bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full ml-2">
              <Text className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                {badge}
              </Text>
            </View>
          )}
          {highlight && (
            <View className="bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full ml-2">
              <Text className="text-xs text-green-600 dark:text-green-400 font-medium">
                New
              </Text>
            </View>
          )}
        </View>
        <Text className="text-gray-400 text-lg">
          {isExpanded ? '−' : '+'}
        </Text>
      </Pressable>

      {isExpanded && (
        <View>
          {children}
        </View>
      )}
    </View>
  );
}

export default TopicAnalyticsPanel;
