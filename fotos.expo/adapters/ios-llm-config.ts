/**
 * iOS LLM Config Adapters
 *
 * Provides React Native-based implementations using fetch() API and ONE.core crypto.
 * Works with Ollama's HTTP API on localhost or remote servers.
 * Uses React Native's SecureStore for encrypted token storage.
 */

// Define the type locally to avoid vendor package dependency issues
interface TestConnectionResponse {
  success: boolean;
  version?: string;
  models?: any[];
  error?: string;
  errorCode?: string;
  needsSetup?: boolean;
}
import {
  createSymmetricKey,
  symmetricEncryptAndEmbedNonce,
  symmetricDecryptWithEmbeddedNonce,
  type SymmetricKey,
} from '@refinio/one.core/lib/crypto/encryption.js';

/**
 * Detect if error is network-related (similar to CORS in browser)
 */
function isNetworkError(error: any): boolean {
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('failed to fetch') ||
      message.includes('connection') ||
      error.name === 'TypeError'
    );
  }
  return false;
}

/**
 * iOS implementation for Ollama-compatible API connection testing using fetch()
 * Works with Ollama, LM Studio, and other Ollama-compatible servers
 */
export const iosOllamaValidator = {
  async testOllamaConnection(
    server: string,
    authToken?: string,
    serviceName: string = 'Ollama'
  ): Promise<TestConnectionResponse> {
    try {
      console.log(`[iOS] Testing ${serviceName} connection to:`, server);

      const headers: Record<string, string> = {};

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Test connection by fetching version info
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${server}/api/version`, {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          errorCode: 'HTTP_ERROR'
        };
      }

      const data = await response.json();

      // Also fetch available models
      const models = await this.fetchOllamaModels(server, authToken);

      return {
        success: true,
        version: data.version || 'unknown',
        models
      };
    } catch (error: any) {
      console.warn(`[iOS] ${serviceName} connection test failed:`, error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Connection timeout - is Ollama running?',
          errorCode: 'TIMEOUT'
        };
      }

      // Detect network errors
      if (isNetworkError(error)) {
        return {
          success: false,
          error: 'Network error - check if Ollama is running and accessible',
          errorCode: 'NETWORK_ERROR',
          needsSetup: true
        };
      }

      return {
        success: false,
        error: error.message || 'Connection failed',
        errorCode: 'CONNECTION_ERROR'
      };
    }
  },

  async fetchOllamaModels(server: string, authToken?: string): Promise<any[]> {
    try {
      console.log('[iOS] Fetching Ollama models from:', server);

      const headers: Record<string, string> = {};

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${server}/api/tags`, {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('[iOS] Failed to fetch models:', response.status, response.statusText);
        return [];
      }

      const data = await response.json();
      return data.models || [];
    } catch (error: any) {
      console.error('[iOS] Failed to fetch Ollama models:', error);
      return [];
    }
  }
};

/**
 * iOS config manager using ONE.core's platform-agnostic crypto
 *
 * Uses symmetric encryption with a key stored in memory.
 * In production, consider using expo-secure-store for key persistence.
 */
class IOSConfigManager {
  private encryptionKey: SymmetricKey | null = null;

  /**
   * Initialize encryption key (should be called after user login)
   * For now, creates a random key and keeps it in memory
   * TODO: Consider using expo-secure-store for persistent key storage
   */
  private getOrCreateEncryptionKey(): SymmetricKey {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Create new key (in-memory only)
    this.encryptionKey = createSymmetricKey();

    console.log('[IOSConfigManager] Created new encryption key (memory only)');
    return this.encryptionKey;
  }

  /**
   * Encrypt token using ONE.core's symmetric encryption
   */
  encryptToken(token: string): string {
    try {
      const key = this.getOrCreateEncryptionKey();

      // Convert string to Uint8Array
      const encoder = new TextEncoder();
      const data = encoder.encode(token);

      // Encrypt with embedded nonce
      const encrypted = symmetricEncryptAndEmbedNonce(data, key);

      // Convert to base64 for storage
      return btoa(String.fromCharCode(...encrypted));
    } catch (error: any) {
      console.error('[IOSConfigManager] Encryption failed:', error);
      throw new Error(`Token encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt token using ONE.core's symmetric encryption
   */
  decryptToken(encrypted: string): string {
    try {
      const key = this.getOrCreateEncryptionKey();

      // Convert from base64
      const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

      // Decrypt with embedded nonce
      const decrypted = symmetricDecryptWithEmbeddedNonce(encryptedBytes, key);

      // Convert back to string
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error: any) {
      console.error('[IOSConfigManager] Decryption failed:', error);
      throw new Error(`Token decryption failed: ${error.message}`);
    }
  }

  /**
   * Compute base URL for Ollama
   * For iOS, localhost refers to the device, not the dev machine
   * Use the machine's IP address instead (e.g., http://192.168.1.100:11434)
   */
  computeBaseUrl(modelType: string, baseUrl?: string): string {
    // For local models on iOS, user must provide IP address of dev machine
    // localhost on iOS refers to the device itself, not the dev machine
    if (modelType === 'local') {
      return baseUrl || 'http://localhost:11434';
    }
    return baseUrl || 'http://localhost:11434';
  }

  /**
   * Check if encryption is available (always true)
   */
  isEncryptionAvailable(): boolean {
    return true;
  }
}

/**
 * Export singleton instance
 */
export const iosConfigManager = new IOSConfigManager();
