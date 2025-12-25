/**
 * Migrate Legacy Plaintext Credentials to Encrypted Format
 * 
 * This function migrates all plaintext credentials to AES-256-GCM encrypted format.
 * Should be run once by an admin to complete the security migration.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Derive encryption key using PBKDF2
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

// Encrypt credentials to ENC: format
async function encryptCredentials(
  credentials: Record<string, unknown>,
  encryptionKey: string
): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(credentials));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Combine IV and ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Return with ENC: prefix
  return 'ENC:' + btoa(String.fromCharCode(...combined));
}

// Check if credentials are already encrypted
function isEncrypted(credentials: unknown): boolean {
  if (typeof credentials === 'string') {
    return credentials.startsWith('ENC:');
  }
  return false;
}

// Extract plaintext credentials from various formats
function getPlaintextCredentials(credentials: unknown): Record<string, unknown> | null {
  // Already encrypted
  if (typeof credentials === 'string' && credentials.startsWith('ENC:')) {
    return null;
  }

  // Plain object
  if (typeof credentials === 'object' && credentials !== null) {
    return credentials as Record<string, unknown>;
  }

  // JSON string
  if (typeof credentials === 'string') {
    try {
      return JSON.parse(credentials);
    } catch {
      return null;
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');

    if (!encryptionKey) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY not configured');
    }

    // Verify user is admin
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin
    const { data: roleData } = await userSupabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting credential migration by admin:', user.id);

    // Use service role for migration
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all connected accounts
    const { data: accounts, error: fetchError } = await supabase
      .from('connected_accounts')
      .select('id, credentials, platform, user_id');

    if (fetchError) {
      throw new Error(`Failed to fetch accounts: ${fetchError.message}`);
    }

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const account of accounts || []) {
      try {
        const plaintextCreds = getPlaintextCredentials(account.credentials);

        if (!plaintextCreds) {
          // Already encrypted or invalid
          skippedCount++;
          continue;
        }

        // Check if credentials object has any data
        if (Object.keys(plaintextCreds).length === 0) {
          skippedCount++;
          continue;
        }

        // Encrypt the credentials
        const encryptedCreds = await encryptCredentials(plaintextCreds, encryptionKey);

        // Update the account
        const { error: updateError } = await supabase
          .from('connected_accounts')
          .update({ credentials: encryptedCreds })
          .eq('id', account.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        migratedCount++;
        console.log(`Migrated account ${account.id} (${account.platform})`);

      } catch (err: any) {
        errorCount++;
        errors.push(`Account ${account.id}: ${err.message}`);
        console.error(`Error migrating account ${account.id}:`, err);
      }
    }

    // Also migrate AI provider connections
    const { data: providers, error: providerError } = await supabase
      .from('ai_provider_connections')
      .select('id, encrypted_credentials, provider_name, user_id');

    if (!providerError && providers) {
      for (const provider of providers) {
        try {
          const plaintextCreds = getPlaintextCredentials(provider.encrypted_credentials);

          if (!plaintextCreds) {
            skippedCount++;
            continue;
          }

          if (Object.keys(plaintextCreds).length === 0) {
            skippedCount++;
            continue;
          }

          const encryptedCreds = await encryptCredentials(plaintextCreds, encryptionKey);

          const { error: updateError } = await supabase
            .from('ai_provider_connections')
            .update({ encrypted_credentials: encryptedCreds })
            .eq('id', provider.id);

          if (updateError) {
            throw new Error(updateError.message);
          }

          migratedCount++;
          console.log(`Migrated AI provider ${provider.id} (${provider.provider_name})`);

        } catch (err: any) {
          errorCount++;
          errors.push(`AI Provider ${provider.id}: ${err.message}`);
        }
      }
    }

    const summary = {
      success: true,
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errorCount,
      errorDetails: errors.length > 0 ? errors : undefined,
      message: `Migration complete. ${migratedCount} credentials encrypted, ${skippedCount} already encrypted/skipped, ${errorCount} errors.`,
    };

    console.log('Migration summary:', summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Migration error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
