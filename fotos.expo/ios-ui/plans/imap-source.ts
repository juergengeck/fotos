import { operationRegistry } from '@refinio/api/registry';
import { ImapSourceHandlers } from '@refinio/source.imap/handlers';

export function registerExpoImapSourceOperation(): ImapSourceHandlers {
    const imapSourceHandlers = new ImapSourceHandlers();

    operationRegistry.register('imapSource', imapSourceHandlers as any, {
        category: 'data',
        description: 'Read synced IMAP mailbox and topic mapping data',
    });

    return imapSourceHandlers;
}
