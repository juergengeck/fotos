import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface Subject {
  id: string;
  name: string;
  description?: string;
  keywords: string[];
  relatedTopics: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Keyword {
  id: string;
  text: string;
  frequency: number;
  subjects: string[];
}

export interface UseMemoryReturn {
  subjects: Subject[];
  keywords: Keyword[];
  isLoading: boolean;
  getSubjectById: (subjectId: string) => Subject | undefined;
  searchSubjects: (query: string) => Subject[];
  refreshMemory: () => Promise<void>;
}

export function useMemory(): UseMemoryReturn {
  const model = useModel();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadMemory = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      // Check if subjectsPlan exists
      if (!model.subjectsPlan) {
        console.warn('[useMemory] SubjectsPlan not available');
        setIsLoading(false);
        return;
      }

      // Use getAllSubjects() which returns all subjects across all topics
      const response = await model.subjectsPlan.getAllSubjects();

      if (!response.success || !response.subjects) {
        console.warn('[useMemory] Failed to get subjects:', response.error);
        setSubjects([]);
        setKeywords([]);
        setIsLoading(false);
        return;
      }

      // Transform ONE.core Subject objects to our interface
      const transformedSubjects: Subject[] = response.subjects.map((s: any) => ({
        id: s.keywords?.join('-') || String(Date.now()),
        name: s.keywords?.slice(0, 3).join(', ') || 'Untitled',
        description: s.description,
        keywords: s.keywords || [],
        relatedTopics: s.topics || [],
        createdAt: s.createdAt || Date.now(),
        updatedAt: s.lastSeenAt || s.createdAt || Date.now()
      }));

      // Extract unique keywords from all subjects
      const keywordMap = new Map<string, { text: string; frequency: number; subjects: string[] }>();

      for (const subject of transformedSubjects) {
        for (const kw of subject.keywords) {
          const existing = keywordMap.get(kw);
          if (existing) {
            existing.frequency += 1;
            existing.subjects.push(subject.id);
          } else {
            keywordMap.set(kw, {
              text: kw,
              frequency: 1,
              subjects: [subject.id]
            });
          }
        }
      }

      const transformedKeywords: Keyword[] = Array.from(keywordMap.entries()).map(([id, data]) => ({
        id,
        text: data.text,
        frequency: data.frequency,
        subjects: data.subjects
      }));

      setSubjects(transformedSubjects);
      setKeywords(transformedKeywords);
    } catch (error) {
      console.error('[useMemory] Error loading memory:', error);
      setSubjects([]);
      setKeywords([]);
    } finally {
      setIsLoading(false);
    }
  }, [model]);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  const getSubjectById = useCallback((subjectId: string): Subject | undefined => {
    return subjects.find(s => s.id === subjectId);
  }, [subjects]);

  const searchSubjects = useCallback((query: string): Subject[] => {
    const lowercaseQuery = query.toLowerCase();
    return subjects.filter(s =>
      s.name.toLowerCase().includes(lowercaseQuery) ||
      s.description?.toLowerCase().includes(lowercaseQuery) ||
      s.keywords.some(k => k.toLowerCase().includes(lowercaseQuery))
    );
  }, [subjects]);

  return {
    subjects,
    keywords,
    isLoading,
    getSubjectById,
    searchSubjects,
    refreshMemory: loadMemory
  };
}
