// packages/vger.expo/ios-ui/hooks/useDevices.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useModel } from './ModelContext';
import type { PeerIdentity, CollectedPeer } from '@refinio/connection.core';
import type { TrustLevel } from '@refinio/trust.core/types/trust-types.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { setCollectedPeerTrustLevelForDiscoveredPeer } from '@vger/vger.core/services/discovery-trust-flow.js';
import { setPersistedDiscoveryEnabled } from '../services/discovery-settings';

export type { TrustLevel } from '@refinio/trust.core/types/trust-types.js';

// Re-export CollectedPeer for convenience
export type { CollectedPeer } from '@refinio/connection.core';

/**
 * DiscoveredDevice - UI-facing device representation
 * Maps from PeerIdentity for display in the devices screen
 */
export interface DiscoveredDevice {
  deviceId: string;
  name: string;
  address: string;
  port: number;
  pubKey: string;
  transports: string[];
  discoveredAt: number;
  lastSeen: number;
  discoveryMethod: 'local';
}

export interface RegisteredDevice {
  id: string;
  name: string;
  platform: string;
  status: 'connected' | 'disconnected' | 'pending';
  trustLevel: TrustLevel;
  registeredAt: number;
  lastSeen: number;
}

const HEX_64_RE = /^[0-9a-f]{64}$/i;

function isMeaningfulHex64(value: string | undefined): value is string {
  return !!value && HEX_64_RE.test(value) && !/^0{64}$/i.test(value);
}

function isValidPeerIdentity(peer: Pick<PeerIdentity, 'id' | 'publicKey'>): boolean {
  return isMeaningfulHex64(peer.id) && isMeaningfulHex64(peer.publicKey);
}

/**
 * Convert PeerIdentity to DiscoveredDevice for UI compatibility
 */
function peerIdentityToDevice(peer: PeerIdentity): DiscoveredDevice {
  const [host, portStr] = peer.address.split(':');
  const port = portStr ? parseInt(portStr, 10) : 0;

  return {
    deviceId: peer.id,
    name: peer.name,
    address: host || peer.address,
    port,
    pubKey: peer.publicKey,
    transports: peer.capabilities,
    discoveredAt: peer.discoveredAt,
    lastSeen: peer.lastSeenAt,
    discoveryMethod: 'local',
  };
}

export function useDevices() {
  const model = useModel();
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [registeredDevices, setRegisteredDevices] = useState<RegisteredDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  // Discovery collection state (verified peers via handshake)
  const [collectedPeers, setCollectedPeers] = useState<CollectedPeer[]>([]);
  const [isCollectionActive, setIsCollectionActive] = useState(false);

  // Pending trust levels: deviceId → TrustLevel (applied after handshake yields personId)
  const pendingTrustLevels = useRef<Map<string, TrustLevel>>(new Map());

  const applyDiscoveryTrust = useCallback(async (peerId: string, level: TrustLevel): Promise<boolean> => {
    if (!model?.trustModel) {
      console.warn('[useDevices] No trustModel available for discovery trust');
      return false;
    }

    const currentCollectedPeers = model.discoveryCollection?.getCollectedPeers() || [];
    const peers = [
      ...currentCollectedPeers,
      ...(model.discoveryService?.getDiscoveredPeers() || []),
    ];

    const result = await setCollectedPeerTrustLevelForDiscoveredPeer(
      { peerId, trustLevel: level },
      {
        trustModel: model.trustModel,
        discoveredPeers: peers,
        resolvePersonId: async (peer) => {
          if (peer.personId) {
            return peer.personId;
          }
          return await calculateIdHashOfObj({ $type$: 'Person', email: peer.email! });
        },
        ensureContactForPerson: async (personId: string, displayName: string) => {
          await model.contactsPlan?.ensureContactForPerson(personId, displayName);
        },
        reportDiscoveredDevice: (device) => {
          model.connectionPlan?.reportDiscoveredDevice(device);
        },
        logger: console,
      }
    );

    if (!result.success) {
      console.warn('[useDevices] Failed to apply discovery trust immediately:', result.error);
    }

    return result.success;
  }, [model?.connectionPlan, model?.contactsPlan, model?.discoveryCollection, model?.discoveryService, model?.trustModel]);

  const applyDiscoveryTrustRef = useRef(applyDiscoveryTrust);

  useEffect(() => {
    applyDiscoveryTrustRef.current = applyDiscoveryTrust;
  }, [applyDiscoveryTrust]);

  // Set up discovery service event listeners using OEvent pattern
  useEffect(() => {
    if (!model?.discoveryService) return;

    const discoveryService = model.discoveryService;
    const disconnects: (() => void)[] = [];

    // Listen for peer discovered events (OEvent pattern)
    disconnects.push(
      discoveryService.onPeerDiscovered.listen((peer: PeerIdentity) => {
        try {
          if (!isValidPeerIdentity(peer)) {
            console.log('[useDevices] Ignoring invalid discovered peer:', peer.id, peer.publicKey);
            return;
          }
          console.log('[useDevices] peerDiscovered:', peer.id.substring(0, 8), peer.name);
          setDiscoveredDevices(prev => {
            const device = peerIdentityToDevice(peer);
            const existing = prev.findIndex(d => d.deviceId === device.deviceId);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = device;
              return updated;
            }
            return [...prev, device];
          });
        } catch (error) {
          console.error('[useDevices] Error in peerDiscovered handler:', error);
        }
      })
    );

    // Listen for peer lost events (OEvent pattern)
    disconnects.push(
      discoveryService.onPeerLost.listen((peer: PeerIdentity) => {
        setDiscoveredDevices(prev => prev.filter(d => d.deviceId !== peer.id));
      })
    );

    // Seed initial state from already-discovered peers (fixes race condition)
    const existingPeers = discoveryService.getDiscoveredPeers();
    if (existingPeers.length > 0) {
      const validPeers = existingPeers.filter(isValidPeerIdentity);
      console.log('[useDevices] Seeding', validPeers.length, 'already-discovered peers');
      setDiscoveredDevices(validPeers.map(peerIdentityToDevice));
    }

    return () => {
      disconnects.forEach(disconnect => disconnect());
    };
  }, [model?.discoveryService]);

  // Set up discovery collection event listeners (verified peers)
  useEffect(() => {
    if (!model?.discoveryCollection) return;

    const collection = model.discoveryCollection;

    // Subscribe to peer collected events
    const unsubPeerCollected = collection.onPeerCollected(async (peer: CollectedPeer) => {
      setCollectedPeers(prev => {
        const existing = prev.findIndex(p => p.id === peer.id);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = peer;
          return updated;
        }
        return [...prev, peer];
      });

      // Apply pending trust level if we now have a personId
      if (peer.personId && pendingTrustLevels.current.has(peer.id)) {
        const level = pendingTrustLevels.current.get(peer.id)!;
        pendingTrustLevels.current.delete(peer.id);
        console.log('[useDevices] Applying pending trust level for collected peer:', peer.id, level);

        const applied = await applyDiscoveryTrustRef.current(peer.id, level);
        if (applied) {
          console.log('[useDevices] Trust level applied for person:', level);
        } else {
          console.error('[useDevices] Failed to apply trust level for collected peer:', peer.id);
        }
      }
    });

    // Subscribe to known person new device events
    const unsubKnownPerson = collection.onKnownPersonNewDevice((peer: CollectedPeer) => {
      setCollectedPeers(prev => {
        const existing = prev.findIndex(p => p.id === peer.id);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = peer;
          return updated;
        }
        return [...prev, peer];
      });
    });

    // Subscribe to peer lost events
    const unsubPeerLost = collection.onPeerLost((peerId: string) => {
      setCollectedPeers(prev => prev.filter(p => p.id !== peerId));
    });

    // Initialize state from current collection
    setIsCollectionActive(collection.isActive());
    setCollectedPeers(collection.getCollectedPeers());

    return () => {
      unsubPeerCollected();
      unsubKnownPerson();
      unsubPeerLost();
    };
  }, [model?.discoveryCollection]);

  useEffect(() => {
    if (!model?.discoveryService) return;
    setIsScanning(model.discoveryService.isRunning());
  }, [model?.discoveryService]);

  // mDNS runtime follows settings.core device.discoveryEnabled.
  // These callbacks provide manual start/stop for UI controls.
  const startDiscovery = useCallback(async () => {
    if (!model?.platformCapabilities.supportsLocalNetworkDiscovery) {
      console.warn('[useDevices] Local discovery is gated on this platform');
      return;
    }
    if (!model?.discoveryService || !model.settingsPlan) {
      throw new Error('[useDevices] DiscoveryService and SettingsPlan are required to start discovery');
    }
    console.log('[useDevices] Starting discovery...');
    await setPersistedDiscoveryEnabled({ settingsPlan: model.settingsPlan }, true);
    setIsScanning(true);
  }, [model?.discoveryService, model?.platformCapabilities.supportsLocalNetworkDiscovery, model?.settingsPlan]);

  const stopDiscovery = useCallback(async () => {
    if (!model?.platformCapabilities.supportsLocalNetworkDiscovery) {
      console.warn('[useDevices] Local discovery is gated on this platform');
      return;
    }
    if (!model?.discoveryService || !model.settingsPlan) {
      throw new Error('[useDevices] DiscoveryService and SettingsPlan are required to stop discovery');
    }
    await setPersistedDiscoveryEnabled({ settingsPlan: model.settingsPlan }, false);
    setIsScanning(false);
    setDiscoveredDevices([]);
  }, [model?.discoveryService, model?.platformCapabilities.supportsLocalNetworkDiscovery, model?.settingsPlan]);

  const setTrustLevel = useCallback(async (deviceId: string, level: TrustLevel) => {
    console.log('[useDevices] Setting trust level:', deviceId, level);

    const applied = await applyDiscoveryTrust(deviceId, level);
    if (applied) {
      console.log('[useDevices] Trust level applied for peer:', level);
      return;
    }

    // Apply after peerCollected fires with personId.
    pendingTrustLevels.current.set(deviceId, level);
    console.log('[useDevices] Trust level pending until handshake yields personId');
  }, [applyDiscoveryTrust]);

  const pairWithDevice = useCallback(async (deviceId: string, trustLevel: TrustLevel) => {
    if (!model?.platformCapabilities.supportsPeerPairing) {
      console.warn('[useDevices] Peer pairing is gated on this platform');
      return;
    }
    console.log('[useDevices] Pairing with device:', deviceId, 'trust level:', trustLevel);

    // Get the discovered device info
    const device = discoveredDevices.find(d => d.deviceId === deviceId);
    if (!device) {
      console.warn('[useDevices] Device not found for pairing:', deviceId);
      return;
    }

    if (!isMeaningfulHex64(device.deviceId) || !isMeaningfulHex64(device.pubKey)) {
      console.warn('[useDevices] Refusing to pair with invalid device:', device.deviceId, device.pubKey);
      setDiscoveredDevices(prev => prev.filter(d => d.deviceId !== device.deviceId));
      return;
    }

    await setTrustLevel(deviceId, trustLevel);

    if (model?.discoveryCollection && typeof (model.discoveryCollection as any).collectPeer === 'function') {
      console.log('[useDevices] Collecting selected peer only');
      await (model.discoveryCollection as any).collectPeer(deviceId);
    } else if (!isCollectionActive && model?.discoveryCollection) {
      console.log('[useDevices] Activating global discovery collection');
      model.discoveryCollection.setActive(true);
      setIsCollectionActive(true);
    }

    console.log('[useDevices] Waiting for handshake with', device.name, 'at', device.address);
  }, [discoveredDevices, isCollectionActive, model?.discoveryCollection, model?.platformCapabilities.supportsPeerPairing, setTrustLevel]);

  const ignoreDevice = useCallback(async (deviceId: string) => {
    await setTrustLevel(deviceId, 'ignore');
    setDiscoveredDevices(prev => prev.filter(d => d.deviceId !== deviceId));
  }, [setTrustLevel]);

  /**
   * Perform a one-time scan and return results
   */
  const scanDevices = useCallback(async (timeout: number = 5000): Promise<DiscoveredDevice[]> => {
    if (!model?.platformCapabilities.supportsLocalNetworkDiscovery) return [];
    if (!model?.discoveryService) return [];

    const peers = await model.discoveryService.scan({ timeout });
    return peers.filter(isValidPeerIdentity).map(peerIdentityToDevice);
  }, [model?.discoveryService, model?.platformCapabilities.supportsLocalNetworkDiscovery]);

  /**
   * Get currently discovered peers without starting continuous discovery
   */
  const getDiscoveredPeers = useCallback((): DiscoveredDevice[] => {
    if (!model?.platformCapabilities.supportsLocalNetworkDiscovery) return [];
    if (!model?.discoveryService) return [];

    const peers = model.discoveryService.getDiscoveredPeers();
    return peers.filter(isValidPeerIdentity).map(peerIdentityToDevice);
  }, [model?.discoveryService, model?.platformCapabilities.supportsLocalNetworkDiscovery]);

  // ==================== Discovery Collection (Verified Peers) ====================

  /**
   * Start or stop discovery collection (verified peer discovery)
   */
  const setDiscoveryCollectionActive = useCallback((active: boolean) => {
    if (!model?.platformCapabilities.supportsVerifiedPeerCollection) {
      console.warn('[useDevices] Discovery collection is gated on this platform');
      return;
    }
    if (!model?.discoveryCollection) {
      console.warn('[useDevices] DiscoveryCollection not available');
      return;
    }

    model.discoveryCollection.setActive(active);
    setIsCollectionActive(active);

    if (!active) {
      setCollectedPeers([]);
    }
  }, [model?.discoveryCollection, model?.platformCapabilities.supportsVerifiedPeerCollection]);

  /**
   * Get currently collected peers (verified via handshake)
   */
  const getCollectedPeers = useCallback((): CollectedPeer[] => {
    if (!model?.discoveryCollection) return [];
    return model.discoveryCollection.getCollectedPeers();
  }, [model?.discoveryCollection]);

  return {
    // Discovery (mDNS-discovered devices)
    discoveredDevices,
    registeredDevices,
    isScanning,
    startDiscovery,
    stopDiscovery,
    pairWithDevice,
    setTrustLevel,
    ignoreDevice,
    scanDevices,
    getDiscoveredPeers,

    // Discovery collection (verified peers)
    collectedPeers,
    isCollectionActive,
    setDiscoveryCollectionActive,
    getCollectedPeers,
  };
}
