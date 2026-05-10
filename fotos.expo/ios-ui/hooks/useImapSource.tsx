import { useCallback, useEffect, useState } from 'react';
import {
  loadImapSourceSnapshot,
  type ImapSourceOperation,
  subscribeToImapProjectionUpdates,
  type ImapMailboxRecord,
  type ImapSourceQueryParams,
  type ImapThreadTopicRecord,
} from '@refinio/source.imap';
import { useModel } from './ModelContext';

type ImapSourcePlanLike = Pick<
  ImapSourceOperation,
  'listMailboxes' | 'listMailboxTopicTagMappings' | 'listThreadTopicMappings'
>;

export type UseImapSourceParams = ImapSourceQueryParams;
export type { ImapMailboxRecord, ImapThreadTopicRecord } from '@refinio/source.imap';

export interface UseImapSourceReturn {
  mailboxes: ImapMailboxRecord[];
  threadMappings: ImapThreadTopicRecord[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useImapSource(params: UseImapSourceParams = {}): UseImapSourceReturn {
  const model = useModel();
  const [mailboxes, setMailboxes] = useState<ImapMailboxRecord[]>([]);
  const [threadMappings, setThreadMappings] = useState<ImapThreadTopicRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    sourceIdHash,
    accountId,
    mailboxName,
    mailboxNamePrefix,
    topicIdHash,
    includeThreadMappings = false,
    threadKey,
    messageId,
  } = params;

  const refresh = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const imapSourcePlan = model.imapSourcePlan as unknown as ImapSourcePlanLike | undefined;
      if (!imapSourcePlan) {
        throw new Error('IMAP source plan is not initialized');
      }

      const snapshot = await loadImapSourceSnapshot(
        imapSourcePlan,
        {
          ...(sourceIdHash ? { sourceIdHash } : {}),
          ...(accountId ? { accountId } : {}),
          ...(mailboxName ? { mailboxName } : {}),
          ...(mailboxNamePrefix ? { mailboxNamePrefix } : {}),
          ...(topicIdHash ? { topicIdHash } : {}),
          ...(includeThreadMappings ? { includeThreadMappings } : {}),
          ...(threadKey ? { threadKey } : {}),
          ...(messageId ? { messageId } : {}),
        },
      );

      setMailboxes(snapshot.mailboxes);
      setThreadMappings(snapshot.threadMappings);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
      setMailboxes([]);
      setThreadMappings([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    accountId,
    includeThreadMappings,
    mailboxName,
    mailboxNamePrefix,
    messageId,
    model.imapSourcePlan,
    model.initialized,
    sourceIdHash,
    threadKey,
    topicIdHash,
  ]);

  useEffect(() => {
    void refresh();

    const disconnectReady = model.onOneModelsReady(() => {
      void refresh();
    });
    const disconnectProjectionUpdates = subscribeToImapProjectionUpdates(() => {
      void refresh();
    }, {
      description: 'useImapSource: IMAP projection updates',
    });

    return () => {
      disconnectReady();
      disconnectProjectionUpdates();
    };
  }, [model, refresh]);

  return {
    mailboxes,
    threadMappings,
    isLoading,
    error,
    refresh,
  };
}
