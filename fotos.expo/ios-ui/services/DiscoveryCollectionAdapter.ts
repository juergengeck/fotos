/**
 * DiscoveryCollectionAdapter
 *
 * Wraps DiscoveryCollectionService from connection.core for iOS React Native.
 * Provides event subscription pattern matching DevicePlatformAdapter interface.
 */

// IMPORTANT: Use direct imports to avoid bundling Node.js-only modules (MDNSDiscovery, etc.)
// that Metro can't tree-shake from connection.core barrel export.
import {
  DiscoveryCollectionService,
  type DiscoveryCollectionDependencies,
} from '@refinio/connection.core/services/DiscoveryCollectionService.js';
import type { CollectedPeer } from '@refinio/connection.core';
import type { DiscoveryService } from '@refinio/connection.core/discovery/DiscoveryService.js';
import { handshakeService } from '@refinio/trust.core/services/HandshakeService.js';
import { createTransportFactory } from './udp-transport-factory';

const HEX_64_RE = /^[0-9a-f]{64}$/i;

function isMeaningfulHex64(value: string | undefined): value is string {
  return !!value && HEX_64_RE.test(value) && !/^0{64}$/i.test(value);
}

export interface DiscoveryCollectionAdapterDeps {
  cryptoApi: any;
  leuteModel: any;
  discoveryService: DiscoveryService;
  getSettings: () => Promise<{
    autoTrustKnownPersonDevices: boolean;
    profileVisibility: 'minimal' | 'full';
  }>;
}

/**
 * Adapter that wraps DiscoveryCollectionService for iOS platform.
 * Provides callback-based event subscription matching DevicePlatformAdapter interface.
 */
export class DiscoveryCollectionAdapter {
  private service: DiscoveryCollectionService | null = null;
  private active = false;
  private initialized = false;

  // Event callback arrays (matching DevicePlatformAdapter interface)
  private peerCollectedCallbacks: ((peer: CollectedPeer) => void)[] = [];
  private knownPersonCallbacks: ((peer: CollectedPeer) => void)[] = [];
  private peerLostCallbacks: ((peerId: string) => void)[] = [];
  private handshakeFailedCallbacks: ((peerId: string, error: string) => void)[] = [];

  constructor(private deps: DiscoveryCollectionAdapterDeps) {
    console.log('[DiscoveryCollectionAdapter] Constructed');
  }

  /**
   * Initialize the DiscoveryCollectionService with dependencies.
   * Must be called after all required modules are ready.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[DiscoveryCollectionAdapter] Already initialized');
      return;
    }

    console.log('[DiscoveryCollectionAdapter] Initializing...');

    try {
      const fullDeps: DiscoveryCollectionDependencies = {
        cryptoApi: this.deps.cryptoApi,
        leuteModel: this.deps.leuteModel,
        discoveryService: this.deps.discoveryService,
        handshakeService: handshakeService as any,
        createTransport: createTransportFactory({ connectTimeout: 5000 }),
        getSettings: this.deps.getSettings,
      };

      this.service = new DiscoveryCollectionService(fullDeps);

      // Wire up event forwarding using OEvent pattern
      this.service.onPeerCollected.listen((peer: CollectedPeer) => {
        console.log('[DiscoveryCollectionAdapter] Peer collected:', peer.id.substring(0, 8));
        this.peerCollectedCallbacks.forEach(cb => cb(peer));
      });

      this.service.onKnownPersonNewDevice.listen((peer: CollectedPeer) => {
        console.log('[DiscoveryCollectionAdapter] Known person new device:', peer.id.substring(0, 8));
        this.knownPersonCallbacks.forEach(cb => cb(peer));
      });

      this.service.onPeerLost.listen((peerId: string) => {
        console.log('[DiscoveryCollectionAdapter] Peer lost:', peerId.substring(0, 8));
        this.peerLostCallbacks.forEach(cb => cb(peerId));
      });

      this.service.onHandshakeFailed.listen((peerId: string, error: string) => {
        console.log('[DiscoveryCollectionAdapter] Handshake failed:', peerId.substring(0, 8), error);
        this.handshakeFailedCallbacks.forEach(cb => cb(peerId, error));
      });

      this.initialized = true;
      console.log('[DiscoveryCollectionAdapter] Initialized successfully');
    } catch (error) {
      console.error('[DiscoveryCollectionAdapter] Initialization failed:', error);
      throw error;
    }
  }

  // ========== Public API (matches DevicePlatformAdapter) ==========

  /**
   * Get all collected peers (verified via handshake).
   */
  getCollectedPeers(): CollectedPeer[] {
    if (!this.service) {
      return [];
    }
    return this.service.getCollectedPeers();
  }

  /**
   * Check if discovery collection is currently active.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Start or stop discovery collection.
   */
  setActive(active: boolean): void {
    if (!this.service) {
      console.warn('[DiscoveryCollectionAdapter] Cannot set active - not initialized');
      return;
    }

    if (active && !this.active) {
      console.log('[DiscoveryCollectionAdapter] Starting collection');
      this.service.start();
      this.active = true;
    } else if (!active && this.active) {
      console.log('[DiscoveryCollectionAdapter] Stopping collection');
      this.service.stop();
      this.active = false;
    }
  }

  /**
   * Collect and handshake exactly one discovered peer.
   * This avoids globally activating collection for every peer on the network
   * when the user pairs with a single device.
   */
  async collectPeer(peerId: string): Promise<void> {
    if (!this.service) {
      throw new Error('DiscoveryCollectionAdapter not initialized');
    }

    const peer = this.deps.discoveryService.getDiscoveredPeers().find(p => p.id === peerId);
    if (!peer) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (!isMeaningfulHex64(peer.id) || !isMeaningfulHex64(peer.publicKey)) {
      throw new Error(`Peer is invalid for handshake: ${peerId}`);
    }

    console.log('[DiscoveryCollectionAdapter] Collecting peer:', peer.id.substring(0, 8));
    await (this.service as any).handlePeerDiscovered(peer);
  }

  /**
   * Subscribe to peer collected events.
   * Returns unsubscribe function.
   */
  onPeerCollected(callback: (peer: CollectedPeer) => void): () => void {
    this.peerCollectedCallbacks.push(callback);
    return () => {
      this.peerCollectedCallbacks = this.peerCollectedCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to known person new device events.
   * Returns unsubscribe function.
   */
  onKnownPersonNewDevice(callback: (peer: CollectedPeer) => void): () => void {
    this.knownPersonCallbacks.push(callback);
    return () => {
      this.knownPersonCallbacks = this.knownPersonCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to peer lost events.
   * Returns unsubscribe function.
   */
  onPeerLost(callback: (peerId: string) => void): () => void {
    this.peerLostCallbacks.push(callback);
    return () => {
      this.peerLostCallbacks = this.peerLostCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to handshake failed events.
   * Returns unsubscribe function.
   */
  onHandshakeFailed(callback: (peerId: string, error: string) => void): () => void {
    this.handshakeFailedCallbacks.push(callback);
    return () => {
      this.handshakeFailedCallbacks = this.handshakeFailedCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Shutdown and cleanup.
   */
  async shutdown(): Promise<void> {
    console.log('[DiscoveryCollectionAdapter] Shutting down...');

    if (this.active && this.service) {
      this.service.stop();
      this.active = false;
    }

    // Clear all callbacks
    this.peerCollectedCallbacks = [];
    this.knownPersonCallbacks = [];
    this.peerLostCallbacks = [];
    this.handshakeFailedCallbacks = [];

    this.service = null;
    this.initialized = false;

    console.log('[DiscoveryCollectionAdapter] Shutdown complete');
  }
}
