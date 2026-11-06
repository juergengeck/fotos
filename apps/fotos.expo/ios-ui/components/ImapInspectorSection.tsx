import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Database, Mail, RefreshCw } from 'lucide-react-native';
import { useImapSource } from '../hooks/useImapSource';

function formatUpdatedAt(timestamp: number | undefined): string {
    if (timestamp === undefined) {
        return 'Unknown';
    }

    return new Date(timestamp).toLocaleString();
}

function shortenHash(value: string | undefined): string | null {
    if (!value) {
        return null;
    }

    if (value.length <= 18) {
        return value;
    }

    return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function ImapInspectorSection() {
    const router = useRouter();
    const { mailboxes, threadMappings, isLoading, error, refresh } = useImapSource({
        includeThreadMappings: true,
    });

    const mappedMailboxCount = mailboxes.filter(mailbox => mailbox.topicIdHash).length;

    return (
        <View className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
            <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center">
                    <Database size={16} color="#6b7280" />
                    <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">
                        IMAP Sync
                    </Text>
                </View>
                <Pressable
                    onPress={() => { void refresh(); }}
                    className="flex-row items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2"
                >
                    <RefreshCw size={14} color="#6b7280" />
                    <Text className="ml-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                        Refresh
                    </Text>
                </Pressable>
            </View>

            <Text className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                {isLoading
                    ? 'Loading synced IMAP state...'
                    : `${mailboxes.length} mailboxes, ${mappedMailboxCount} mapped, ${threadMappings.length} thread bindings`}
            </Text>

            {error ? (
                <View className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 px-3 py-2 mb-3">
                    <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
                </View>
            ) : null}

            {mailboxes.length === 0 && !isLoading ? (
                <View className="rounded-md border border-dashed border-gray-300 dark:border-gray-600 px-3 py-4">
                    <Text className="text-sm text-gray-500 dark:text-gray-400">
                        No synced IMAP mailbox projections are stored on this client yet.
                    </Text>
                </View>
            ) : (
                <View className="space-y-0">
                    {mailboxes.map((mailbox) => (
                        <View
                            key={mailbox.mailboxEntryIdHash}
                            className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-3 mb-3"
                        >
                            <View className="flex-row items-start justify-between">
                                <View className="flex-1 pr-3">
                                    <View className="flex-row items-center mb-1">
                                        <Mail size={14} color="#6b7280" />
                                        <Text className="ml-2 text-sm font-semibold text-gray-900 dark:text-white">
                                            {mailbox.mailboxName}
                                        </Text>
                                    </View>
                                    <Text className="text-xs text-gray-500 dark:text-gray-400">
                                        {mailbox.sourceTitle} · account {mailbox.accountId}
                                    </Text>
                                </View>
                                <View className="items-end">
                                    <Text className="text-xs text-gray-500 dark:text-gray-400">
                                        {mailbox.messageCount ?? 0} messages
                                    </Text>
                                    <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {formatUpdatedAt(mailbox.updatedAt)}
                                    </Text>
                                </View>
                            </View>

                            <View className="mt-3">
                                <Text className="text-xs text-gray-600 dark:text-gray-300">
                                    Folder: {mailbox.folderPathSegments.join(' / ')}
                                </Text>
                                <Text className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                    UID validity {mailbox.uidValidity}
                                    {mailbox.highestSeenUid !== undefined ? `, seen ${mailbox.highestSeenUid}` : ''}
                                    {mailbox.uidNext !== undefined ? `, next ${mailbox.uidNext}` : ''}
                                </Text>
                                <Text className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                    Topic: {shortenHash(mailbox.topicIdHash) ?? 'Unmapped'} · Tags: {mailbox.topicTagIds.length}
                                </Text>
                            </View>

                            {mailbox.topicIdHash ? (
                                <Pressable
                                    onPress={() => router.push({ pathname: '/chat', params: { topicId: mailbox.topicIdHash! } })}
                                    className="mt-3 self-start rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2"
                                >
                                    <Text className="text-xs font-medium text-gray-700 dark:text-gray-200">
                                        Open Topic
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ))}
                </View>
            )}

            <View className="mt-2">
                <Text className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    Recent Thread Bindings
                </Text>
                {threadMappings.length === 0 ? (
                    <View className="rounded-md border border-dashed border-gray-300 dark:border-gray-600 px-3 py-4">
                        <Text className="text-sm text-gray-500 dark:text-gray-400">
                            No synced thread-to-topic mappings found on this client.
                        </Text>
                    </View>
                ) : (
                    threadMappings.slice(0, 8).map((mapping) => (
                        <View
                            key={mapping.mappingIdHash}
                            className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-3 mb-2"
                        >
                            <Text className="text-sm font-medium text-gray-900 dark:text-white">
                                {mapping.subject ?? mapping.messageId ?? mapping.threadKey}
                            </Text>
                            <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {mapping.mailboxName ?? 'Unknown mailbox'} · {mapping.threadIdentityKind} · topic {shortenHash(mapping.topicIdHash)}
                            </Text>
                            <Pressable
                                onPress={() => router.push({ pathname: '/chat', params: { topicId: mapping.topicIdHash } })}
                                className="mt-3 self-start rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2"
                            >
                                <Text className="text-xs font-medium text-gray-700 dark:text-gray-200">
                                    Open Topic
                                </Text>
                            </Pressable>
                        </View>
                    ))
                )}
            </View>
        </View>
    );
}
