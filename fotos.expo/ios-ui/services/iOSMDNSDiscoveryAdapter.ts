/**
 * iOSMDNSDiscoveryAdapter - mDNS/Bonjour discovery for iOS
 *
 * Implements LocalDiscoveryProvider using react-native-zeroconf.
 * Matches vger.cube's MDNSDiscoveryAdapter by advertising and discovering
 * the same DNS-SD service type: _one-refinio._udp.local
 *
 * TXT records match the cube format:
 *   pubkey, deviceId, personId, email, name, deviceType, platform, capabilities
 *
 * Security comes from publicKey challenge/handshake; discovery is only reachability.
 */

import Zeroconf from 'react-native-zeroconf';
import { AppState, NativeModules } from 'react-native';
import type { NativeEventSubscription } from 'react-native';
import type { LocalDiscoveryProvider, LocalPeerInfo } from '@refinio/connection.core';
import {
    capabilitiesFromTxtRecord,
    normalizeAdvertisedCapabilities,
    serializeDiscoveryCapabilities,
} from '@refinio/connection.core/services/DiscoveryCapabilities.js';
import {
    domainClaimSuppliesFromTxtRecord,
    domainClaimSuppliesToTxtRecord,
    type DomainClaimSupply,
} from '@refinio/connection.core/types/domain-claims.js';

const SERVICE_TYPE = 'one-refinio';
const PROTOCOL = 'udp';
const DOMAIN = 'local.';
const DEFAULT_PORT = 49497;
const PEER_EXPIRATION_MS = 60_000;
const CLEANUP_INTERVAL_MS = 10_000;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

function isMeaningfulHex64(value: string | undefined): value is string {
    return !!value && HEX_64_RE.test(value) && !/^0{64}$/i.test(value);
}

function getTxtString(txt: Record<string, unknown>, key: string): string | undefined {
    const value = txt[key];
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export interface iOSMDNSConfig {
    deviceId: string;
    pubKey: string;
    /** Owner's personId. Prefer this when available; email remains compatibility metadata. */
    personId?: string;
    /** Owner's email - receivers derive personId from this */
    email?: string;
    displayName: string;
    deviceType: string;
    quicvcPort?: number;
    capabilities?: readonly string[];
    domainClaimSupplies?: readonly DomainClaimSupply[];
    webPort?: number;
}

export class iOSMDNSDiscoveryAdapter implements LocalDiscoveryProvider {
    private zeroconf: Zeroconf | null = null;
    private config: iOSMDNSConfig;
    private peers = new Map<string, LocalPeerInfo & { serviceName: string }>();
    private discoveredCallbacks: ((peer: LocalPeerInfo) => void)[] = [];
    private updatedCallbacks: ((peer: LocalPeerInfo) => void)[] = [];
    private lostCallbacks: ((peerId: string) => void)[] = [];
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;
    private listening = false;
    private appStateSubscription: NativeEventSubscription | null = null;
    private wasListening = false;
    private publishedServiceName: string | null = null;

    constructor(config: iOSMDNSConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.zeroconf) return;

        if (!NativeModules.RNZeroconf) {
            throw new Error('[iOSMDNS] Native module not available - run pod install and rebuild');
        }

        this.zeroconf = new Zeroconf();

        // Wire resolved event — this fires when a service's TXT/address is fully resolved
        this.zeroconf.on('resolved', (service: any) => {
            this.handleResolved(service);
        });

        // Wire remove event — fires when a service disappears from the network
        this.zeroconf.on('remove', (name: string) => {
            this.handleRemoved(name);
        });

        this.zeroconf.on('error', (err: any) => {
            const errStr = String(err);
            // -72004 = NSNetServicesNotFoundError: service doesn't exist (e.g., unpublish of non-existent)
            // -72007 = NSNetServicesCollisionError: service name already registered
            // Both are non-fatal and expected during normal operation
            if (errStr.includes('-72004')) {
                // Silently ignore "not found" errors from cleanup attempts
                return;
            }
            if (errStr.includes('-72007')) {
                console.warn('[iOSMDNS] Service name collision (will use existing registration)');
                return;
            }
            console.error('[iOSMDNS] Zeroconf error:', err);
        });

        // Restart mDNS scan on foreground resume — iOS suspends the native
        // NSNetServiceBrowser when the app is backgrounded.
        // Only cycle the *scan*, not the publish: the Bonjour service registration
        // survives suspension, and re-publishing causes NSNetServicesCollisionError (-72007)
        // because unpublishService called during suspension doesn't complete natively.
        this.appStateSubscription = AppState.addEventListener('change', (state) => {
            if (state === 'active' && this.wasListening) {
                console.log('[iOSMDNS] App foregrounded — restarting scan');
                this.wasListening = false;
                this.zeroconf!.stop();
                this.zeroconf!.scan(SERVICE_TYPE, PROTOCOL, DOMAIN);
                this.cleanupTimer = setInterval(() => this.expireStale(), CLEANUP_INTERVAL_MS);
                this.listening = true;
            } else if (state === 'background' && this.listening) {
                console.log('[iOSMDNS] App backgrounded — pausing scan');
                this.wasListening = true;
                this.zeroconf!.stop();
                if (this.cleanupTimer) {
                    clearInterval(this.cleanupTimer);
                    this.cleanupTimer = null;
                }
                this.listening = false;
            }
        });

        console.log('[iOSMDNS] Initialized');
    }

    async startListening(): Promise<void> {
        if (this.listening) return;
        if (!this.zeroconf) {
            throw new Error('[iOSMDNS] Cannot start before initialize() completes');
        }

        const port = this.config.quicvcPort ?? DEFAULT_PORT;

        // Match connection.core's Node mDNS adapter: stable instance name,
        // human display name in TXT.
        this.publishedServiceName = this.config.deviceId.substring(0, 16);

        const txt: Record<string, string> = {
            pubkey: this.config.pubKey,
            deviceId: this.config.deviceId,
            name: this.config.displayName,
            deviceType: this.config.deviceType,
            platform: 'one',
            capabilities: serializeDiscoveryCapabilities(
                normalizeAdvertisedCapabilities(this.config.capabilities, {
                    webPort: this.config.webPort,
                }),
            ),
        };
        if (this.config.personId) {
            txt.personId = this.config.personId;
        }
        if (this.config.email) {
            txt.email = this.config.email;
        }
        if (this.config.webPort) {
            txt.webPort = String(this.config.webPort);
        }
        Object.assign(txt, domainClaimSuppliesToTxtRecord(this.config.domainClaimSupplies));

        console.log('[iOSMDNS] Publishing service:', this.publishedServiceName, 'port:', port);
        this.zeroconf.publishService(
            SERVICE_TYPE,
            PROTOCOL,
            DOMAIN,
            this.publishedServiceName,
            port,
            txt
        );

        // Start scanning for other services
        console.log('[iOSMDNS] Starting scan for', SERVICE_TYPE);
        this.zeroconf.scan(SERVICE_TYPE, PROTOCOL, DOMAIN);

        // Start peer expiration cleanup
        this.cleanupTimer = setInterval(() => this.expireStale(), CLEANUP_INTERVAL_MS);

        this.listening = true;
        console.log('[iOSMDNS] Listening started');
    }

    stopListening(): void {
        if (!this.listening || !this.zeroconf) return;

        if (this.publishedServiceName) {
            this.zeroconf.unpublishService(this.publishedServiceName);
            this.publishedServiceName = null;
        }
        this.zeroconf.stop();

        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        this.listening = false;
        console.log('[iOSMDNS] Listening stopped');
    }

    async scan(_timeout: number): Promise<LocalPeerInfo[]> {
        // mDNS discovery is continuous — return currently known peers
        return Array.from(this.peers.values()).map(({ serviceName: _, ...peer }) => peer);
    }

    onPeerDiscovered(callback: (peer: LocalPeerInfo) => void): void {
        this.discoveredCallbacks.push(callback);
    }

    onPeerUpdated(callback: (peer: LocalPeerInfo) => void): void {
        this.updatedCallbacks.push(callback);
    }

    onPeerLost(callback: (peerId: string) => void): void {
        this.lostCallbacks.push(callback);
    }

    async shutdown(): Promise<void> {
        this.stopListening();

        if (this.appStateSubscription) {
            this.appStateSubscription.remove();
            this.appStateSubscription = null;
        }

        if (this.zeroconf) {
            this.zeroconf.removeDeviceListeners();
            this.zeroconf = null;
        }

        // Notify lost for all remaining peers
        for (const peerId of this.peers.keys()) {
            this.lostCallbacks.forEach(cb => cb(peerId));
        }
        this.peers.clear();
        this.discoveredCallbacks = [];
        this.updatedCallbacks = [];
        this.lostCallbacks = [];

        console.log('[iOSMDNS] Shutdown complete');
    }

    // ==================== Internal ====================

    private handleResolved(service: any): void {
        const txt = (service.txt ?? {}) as Record<string, unknown>;
        const deviceId = getTxtString(txt, 'deviceId');

        if (!deviceId) {
            console.log('[iOSMDNS] Ignoring service without deviceId:', service.name);
            return;
        }

        if (!isMeaningfulHex64(deviceId)) {
            console.log('[iOSMDNS] Ignoring service with invalid deviceId:', service.name, deviceId);
            return;
        }

        // Filter out our own device
        if (deviceId === this.config.deviceId) {
            return;
        }

        const publicKey = getTxtString(txt, 'pubkey');
        if (!isMeaningfulHex64(publicKey)) {
            console.log('[iOSMDNS] Ignoring service with invalid pubkey:', service.name, publicKey);
            return;
        }

        // Pick the first IPv4 address (prefer non-link-local)
        const addresses: string[] = service.addresses ?? [];
        const ipv4 = addresses.find((a: string) => !a.includes(':') && !a.startsWith('169.254')) ||
                      addresses.find((a: string) => !a.includes(':')) ||
                      addresses[0];
        if (!ipv4) {
            console.log('[iOSMDNS] No usable address for service:', service.name);
            return;
        }

        const displayName = getTxtString(txt, 'name') ??
            (typeof service.name === 'string' && service.name.trim().length > 0
                ? service.name.trim()
                : undefined);
        if (!displayName) {
            console.log('[iOSMDNS] Ignoring service without display name:', service.name);
            return;
        }

        const capabilities = capabilitiesFromTxtRecord(txt, ipv4);
        let domainClaimSupplies: DomainClaimSupply[] = [];
        try {
            domainClaimSupplies = domainClaimSuppliesFromTxtRecord(txt);
        } catch (error) {
            console.warn('[iOSMDNS] Ignoring service with invalid domain claim supplies:', service.name, error);
            return;
        }

        const now = Date.now();
        const port: number = service.port ?? DEFAULT_PORT;
        const existing = this.peers.get(deviceId);
        const serviceName = typeof service.name === 'string' ? service.name : deviceId.substring(0, 16);

        if (existing) {
            existing.lastSeenAt = now;
            existing.address = `${ipv4}:${port}`;
            existing.name = displayName;
            existing.publicKey = publicKey;
            existing.email = getTxtString(txt, 'email');
            existing.personId = getTxtString(txt, 'personId');
            existing.deviceType = getTxtString(txt, 'deviceType');
            existing.capabilities = capabilities;
            existing.domainClaimSupplies = domainClaimSupplies.length > 0 ? domainClaimSupplies : undefined;
            existing.serviceName = serviceName;
            this.emitPeerUpdated(existing);
            return;
        }

        const peer: LocalPeerInfo = {
            id: deviceId,
            name: displayName,
            address: `${ipv4}:${port}`,
            publicKey,
            email: getTxtString(txt, 'email'),
            personId: getTxtString(txt, 'personId'),
            deviceType: getTxtString(txt, 'deviceType'),
            capabilities,
            domainClaimSupplies: domainClaimSupplies.length > 0 ? domainClaimSupplies : undefined,
            discoveredAt: now,
            lastSeenAt: now,
        };

        this.peers.set(deviceId, { ...peer, serviceName });
        console.log('[iOSMDNS] Peer discovered:', peer.name, peer.address);

        for (const cb of this.discoveredCallbacks) {
            try {
                cb(peer);
            } catch (e) {
                console.error('[iOSMDNS] Callback error:', e);
            }
        }
    }

    private handleRemoved(name: string): void {
        // Find peer by service name — the name from zeroconf is the service instance name
        // We need to find which deviceId corresponds to this service name
        for (const [deviceId, peer] of this.peers) {
            if (peer.serviceName === name || deviceId === name || deviceId.substring(0, 16) === name) {
                this.peers.delete(deviceId);
                console.log('[iOSMDNS] Peer removed:', deviceId);
                this.lostCallbacks.forEach(cb => cb(deviceId));
                return;
            }
        }
    }

    private expireStale(): void {
        const now = Date.now();
        const expired: string[] = [];

        for (const [deviceId, peer] of this.peers) {
            if (now - peer.lastSeenAt > PEER_EXPIRATION_MS) {
                expired.push(deviceId);
            }
        }

        for (const deviceId of expired) {
            this.peers.delete(deviceId);
            console.log('[iOSMDNS] Peer expired:', deviceId);
            this.lostCallbacks.forEach(cb => cb(deviceId));
        }
    }

    private emitPeerUpdated(peer: LocalPeerInfo): void {
        for (const cb of this.updatedCallbacks) {
            try {
                cb(peer);
            } catch (e) {
                console.error('[iOSMDNS] Update callback error:', e);
            }
        }
    }

    updateDisplayName(newName: string): void {
        const displayName = newName.trim();
        if (!displayName) {
            throw new Error('[iOSMDNS] Display name must not be empty');
        }
        if (this.config.displayName === displayName) {
            return;
        }

        this.config = {
            ...this.config,
            displayName,
        };

        if (this.listening) {
            this.stopListening();
            void this.startListening();
        }
    }
}
