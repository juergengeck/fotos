/**
 * ONE.core Recipe for MessageReadStatus objects
 *
 * Tracks read/unread status of messages in conversations
 * Each MessageReadStatus is owned by a specific user and tracks read state for messages in a conversation
 */
export const MessageReadStatusRecipe = {
    $type$: 'Recipe',
    name: 'MessageReadStatus',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^MessageReadStatus$/ }
        },
        {
            itemprop: 'conversationId',
            itemtype: { type: 'string' },
            isId: true // Conversation ID is the unique identifier
        },
        {
            itemprop: 'userId',
            itemtype: { type: 'string' } // Owner's Person ID hash
        },
        {
            itemprop: 'lastReadMessageHash',
            itemtype: { type: 'string' }, // Hash of last read message
            optional: true // Optional - undefined means no messages read yet
        },
        {
            itemprop: 'lastReadTimestamp',
            itemtype: { type: 'integer' } // Unix timestamp of last read
        },
        {
            itemprop: 'unreadCount',
            itemtype: { type: 'integer' } // Cached unread count for performance
        },
        {
            itemprop: 'updatedAt',
            itemtype: { type: 'integer' } // Last update timestamp
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
