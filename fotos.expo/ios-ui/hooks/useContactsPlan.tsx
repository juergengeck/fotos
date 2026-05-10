import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';
import { createP2PTopic } from '@refinio/chat.core/services/P2PTopicService';

export interface Contact {
  id: string;
  personId?: string;
  name?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string | null;
  status?: 'owner' | 'connected' | 'connecting' | 'disconnected' | 'pending';
  trustLevel?: 'me' | 'direct' | 'indirect' | 'unknown';
  isAI?: boolean;
  isConnected?: boolean;
  lastSeen?: number;
  canSync?: boolean;
  discoverySource?: string;
  color?: string;
}

export interface UseContactsPlanReturn {
  contacts: Contact[];
  ownerContact: Contact | null;
  isLoading: boolean;
  refreshContacts: () => Promise<void>;
  getContactById: (contactId: string) => Contact | undefined;
  createAIContact: (name: string, modelId: string) => Promise<string>;
  // Topic creation for contacts
  getOrCreateTopicForContact: (contactId: string) => Promise<{ success: boolean; topicId?: string; error?: string }>;
  // Trust management
  acceptContact: (personId: string, options?: any) => Promise<{ success: boolean; error?: string }>;
  blockContact: (personId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  // Profile management
  getProfile: (personId: string) => Promise<{ success: boolean; profile?: any; error?: string }>;
  updateProfile: (request: { personId: string; name?: string }) => Promise<{ success: boolean; error?: string }>;
  hasPersonName: () => Promise<{ success: boolean; hasName: boolean; name?: string }>;
  // Invitations
  createInvitation: () => Promise<{ success: boolean; invitation?: { url: string }; error?: string }>;
}

export function useContactsPlan(): UseContactsPlanReturn {
  const model = useModel();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [ownerContact, setOwnerContact] = useState<Contact | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadContacts = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      // Use ContactsPlan from ChatModule (properly handles LeuteModel access)
      if (!model.contactsPlan) {
        console.warn('[useContactsPlan] ContactsPlan not available');
        setIsLoading(false);
        return;
      }

      // Use getContactsWithTrust for richer contact data
      const result = await model.contactsPlan.getContactsWithTrust();
      if (!result.success || !result.data) {
        console.warn('[useContactsPlan] Failed to get contacts:', result.error);
        setIsLoading(false);
        return;
      }

      // Map all contacts including owner (owner shown first in list like vger.cube)
      const allContacts = result.data;
      const owner = allContacts.find((c: any) => c.trustLevel === 'me' || c.status === 'owner');

      // Map ContactsPlan.ContactWithTrust to our Contact interface
      const mappedContacts: Contact[] = allContacts.map((contact: any) => ({
        id: contact.id,
        personId: contact.personId,
        name: contact.name,
        displayName: contact.name,
        email: contact.email || '',
        avatarUrl: contact.avatarBlobHash || null,
        status: contact.status || (contact.isConnected ? 'connected' : 'disconnected'),
        trustLevel: contact.trustLevel || 'direct',
        isAI: contact.isAI,
        isConnected: contact.isConnected,
        canSync: contact.canSync,
        discoverySource: contact.discoverySource,
        lastSeen: Date.now()
      }));

      // Map owner contact
      if (owner) {
        setOwnerContact({
          id: owner.id,
          personId: owner.personId,
          name: owner.name,
          displayName: owner.name,
          email: owner.email || '',
          avatarUrl: owner.avatarBlobHash || null,
          status: 'owner',
          trustLevel: 'me',
          isAI: false,
          isConnected: true,
          color: owner.color
        });
      } else {
        setOwnerContact(null);
      }

      setContacts(mappedContacts);
    } catch (error) {
      console.error('[useContactsPlan] Error loading contacts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [model]);

  useEffect(() => {
    loadContacts();

    // Subscribe to contact changes
    const disconnectHandler = model.onContactsChanged(async () => {
      await loadContacts();
    });

    return () => disconnectHandler();
  }, [model, loadContacts]);

  const getContactById = useCallback((contactId: string): Contact | undefined => {
    return contacts.find(c => c.id === contactId);
  }, [contacts]);

  const createAIContact = useCallback(async (name: string, modelId: string): Promise<string> => {
    if (!model.aiAssistantPlan) {
      throw new Error('AIAssistantPlan not available');
    }

    // Create AI topic and contact
    const topicId = await model.aiAssistantPlan.createAITopic(name, modelId);
    await loadContacts();
    return topicId;
  }, [model, loadContacts]);

  const acceptContact = useCallback(async (personId: string, options: any = {}): Promise<{ success: boolean; error?: string }> => {
    if (!model.contactsPlan) {
      return { success: false, error: 'ContactsPlan not available' };
    }
    const result = await model.contactsPlan.acceptContact(personId, options);
    if (result.success) {
      await loadContacts();
    }
    return result;
  }, [model, loadContacts]);

  const blockContact = useCallback(async (personId: string, reason: string = 'User blocked'): Promise<{ success: boolean; error?: string }> => {
    if (!model.contactsPlan) {
      return { success: false, error: 'ContactsPlan not available' };
    }
    const result = await model.contactsPlan.blockContact(personId, reason);
    if (result.success) {
      await loadContacts();
    }
    return result;
  }, [model, loadContacts]);

  const getProfile = useCallback(async (personId: string): Promise<{ success: boolean; profile?: any; error?: string }> => {
    if (!model.contactsPlan) {
      return { success: false, error: 'ContactsPlan not available' };
    }
    return await model.contactsPlan.getProfile({ personId });
  }, [model]);

  const updateProfile = useCallback(async (request: { personId: string; name?: string }): Promise<{ success: boolean; error?: string }> => {
    if (!model.contactsPlan) {
      return { success: false, error: 'ContactsPlan not available' };
    }
    const result = await model.contactsPlan.updateProfile(request);
    if (result.success) {
      await loadContacts();
    }
    return result;
  }, [model, loadContacts]);

  const hasPersonName = useCallback(async (): Promise<{ success: boolean; hasName: boolean; name?: string }> => {
    if (!model.contactsPlan) {
      return { success: false, hasName: false };
    }
    return await model.contactsPlan.hasPersonName();
  }, [model]);

  const createInvitation = useCallback(async (): Promise<{ success: boolean; invitation?: { url: string }; error?: string }> => {
    if (!model.contactsPlan) {
      return { success: false, error: 'ContactsPlan not available' };
    }
    return await model.contactsPlan.createInvitation();
  }, [model]);

  /**
   * Get or create a topic for a contact.
   * For AI contacts: creates via ChatPlan.createConversation with participant
   * For P2P contacts: ensures P2P channels via TopicGroupManager
   */
  const getOrCreateTopicForContact = useCallback(async (contactId: string): Promise<{ success: boolean; topicId?: string; error?: string }> => {
    console.log('[useContactsPlan] Getting or creating topic for contact:', contactId);

    if (!model.initialized) {
      return { success: false, error: 'Model not initialized' };
    }

    try {
      // Find contact to check if AI
      const contact = contacts.find(c => c.id === contactId || c.personId === contactId);
      const isAI = contact?.isAI || false;
      const contactName = contact?.displayName || contact?.name || 'Contact';

      console.log(`[useContactsPlan] Contact ${contactId.substring(0, 8)} isAI: ${isAI}`);

      // For AI contacts, use ChatPlan.createConversation to properly set up the group
      if (isAI && model.chatPlan) {
        console.log('[useContactsPlan] AI contact detected - creating conversation via ChatPlan');

        const result = await model.chatPlan.createConversation({
          type: 'group', // AI conversations are always groups
          participants: [contactId],
          name: contactName
        });

        if (!result.success || !result.data?.id) {
          throw new Error(result.error || 'Failed to create AI conversation');
        }

        console.log('[useContactsPlan] AI conversation created:', result.data.id);
        return { success: true, topicId: result.data.id };
      }

      // For non-AI P2P contacts, create a proper P2P topic
      const localPersonId = model.ownerId;
      if (!localPersonId) {
        throw new Error('Local person ID not available');
      }

      // Get the remote Person ID from the contact
      const remotePersonId = contact?.personId;
      if (!remotePersonId) {
        throw new Error(`Contact ${contactId.substring(0, 8)} has no personId - cannot create P2P topic`);
      }

      console.log(`[useContactsPlan] Creating P2P topic: local=${localPersonId.substring(0, 8)}, remote=${remotePersonId.substring(0, 8)}`);

      // Create actual P2P topic using P2PTopicService
      if (!model.topicModel) {
        throw new Error('TopicModel not available');
      }

      const { topicId, wasCreated } = await createP2PTopic(
        model.topicModel,
        localPersonId as any, // ownerId is SHA256IdHash<Person> but typed as string | undefined
        remotePersonId as any // personId from contact is string but should be SHA256IdHash<Person>
      );

      console.log(`[useContactsPlan] P2P topic ${wasCreated ? 'created' : 'exists'}: ${topicId.substring(0, 20)}...`);

      // Emit topics changed event if new topic was created so chat list refreshes
      if (wasCreated) {
        model.onTopicsChanged.emit();
      }

      return { success: true, topicId };
    } catch (error) {
      console.error('[useContactsPlan] Failed to create topic:', error);
      return { success: false, error: (error as Error).message };
    }
  }, [model, contacts]);

  return {
    contacts,
    ownerContact,
    isLoading,
    refreshContacts: loadContacts,
    getContactById,
    createAIContact,
    getOrCreateTopicForContact,
    acceptContact,
    blockContact,
    getProfile,
    updateProfile,
    hasPersonName,
    createInvitation
  };
}
