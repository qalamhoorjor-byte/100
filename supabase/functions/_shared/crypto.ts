// Encryption utilities for credential storage
// Uses AES-256-GCM for authenticated encryption

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Derive a key from the encryption key string
async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(encryptionKey),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('lovable-credential-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt credentials - returns base64 encoded string
export async function encryptCredentials(credentials: Record<string, unknown>): Promise<string> {
  const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.warn('CREDENTIAL_ENCRYPTION_KEY not set - storing credentials unencrypted');
    return JSON.stringify(credentials);
  }

  try {
    const key = await deriveKey(encryptionKey);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const plaintext = encoder.encode(JSON.stringify(credentials));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );

    // Combine IV + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    // Return with prefix to identify encrypted data
    return 'ENC:' + btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Failed to encrypt credentials');
  }
}

// Decrypt credentials - returns parsed JSON object
export async function decryptCredentials(encryptedData: string): Promise<Record<string, unknown>> {
  // Check if data is encrypted (has ENC: prefix)
  if (!encryptedData.startsWith('ENC:')) {
    // Legacy unencrypted data - return as-is
    try {
      return JSON.parse(encryptedData);
    } catch {
      // If it's already an object that was stringified incorrectly
      return encryptedData as unknown as Record<string, unknown>;
    }
  }

  const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!encryptionKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY not set - cannot decrypt credentials');
  }

  try {
    const key = await deriveKey(encryptionKey);
    
    // Remove prefix and decode base64
    const combined = Uint8Array.from(atob(encryptedData.slice(4)), c => c.charCodeAt(0));
    
    // Extract IV (first 12 bytes) and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return JSON.parse(decoder.decode(plaintext));
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt credentials');
  }
}

// Helper to check if credentials are encrypted
export function isEncrypted(data: string | Record<string, unknown>): boolean {
  if (typeof data === 'string') {
    return data.startsWith('ENC:');
  }
  return false;
}

// Helper to safely get credentials (handles both encrypted and legacy)
export async function getDecryptedCredentials(credentials: unknown): Promise<Record<string, unknown>> {
  if (typeof credentials === 'string') {
    return decryptCredentials(credentials);
  }
  // Already a plain object (legacy data)
  return credentials as Record<string, unknown>;
}
