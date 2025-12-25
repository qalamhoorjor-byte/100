import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const encoder = new TextEncoder();

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
async function encryptCredentials(credentials: Record<string, unknown>): Promise<string> {
  const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.warn('CREDENTIAL_ENCRYPTION_KEY not set - storing credentials unencrypted');
    return JSON.stringify(credentials);
  }

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
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { credentials, account_id } = await req.json();

    if (!credentials || typeof credentials !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Encrypt the credentials
    const encryptedCredentials = await encryptCredentials(credentials);
    console.log('Credentials encrypted successfully');

    // If account_id provided, update the account with encrypted credentials
    if (account_id) {
      const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Verify ownership
      const { data: account, error: accountError } = await serviceSupabase
        .from('connected_accounts')
        .select('user_id')
        .eq('id', account_id)
        .single();

      if (accountError || !account) {
        return new Response(
          JSON.stringify({ error: 'Account not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (account.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: You do not own this account' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update with encrypted credentials
      const { error: updateError } = await serviceSupabase
        .from('connected_accounts')
        .update({ credentials: encryptedCredentials })
        .eq('id', account_id);

      if (updateError) {
        throw updateError;
      }

      console.log('Account credentials updated with encryption for account:', account_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        encrypted_credentials: encryptedCredentials,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Encryption error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
