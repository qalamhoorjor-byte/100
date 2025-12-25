import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FacebookCredentials {
  page_access_token: string;
  page_id: string;
}

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

// Decrypt credentials - handles both encrypted and legacy plaintext
async function decryptCredentials(credentialsData: unknown): Promise<Record<string, unknown>> {
  if (typeof credentialsData === 'object' && credentialsData !== null) {
    return credentialsData as Record<string, unknown>;
  }

  const encryptedData = String(credentialsData);
  
  if (!encryptedData.startsWith('ENC:')) {
    try {
      return JSON.parse(encryptedData);
    } catch {
      return {};
    }
  }

  const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!encryptionKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY not set - cannot decrypt credentials');
  }

  const key = await deriveKey(encryptionKey);
  const combined = Uint8Array.from(atob(encryptedData.slice(4)), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return JSON.parse(decoder.decode(plaintext));
}

async function postToFacebook(
  message: string, 
  credentials: FacebookCredentials,
  link?: string
): Promise<any> {
  const url = `https://graph.facebook.com/v18.0/${credentials.page_id}/feed`;
  
  const body: Record<string, string> = {
    message,
    access_token: credentials.page_access_token,
  };

  if (link) {
    body.link = link;
  }

  console.log("Posting to Facebook page:", credentials.page_id);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  const responseData = await response.json();
  console.log("Facebook API Response:", response.status);

  if (!response.ok) {
    throw new Error(`Facebook API error: ${responseData.error?.message || 'Unknown error'}`);
  }

  return responseData;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { content, account_id, link } = await req.json();
    
    if (!content || !account_id) {
      throw new Error("Missing required fields: content and account_id");
    }

    console.log("Publishing to Facebook for account:", account_id, "user:", user.id);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('credentials, user_id')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      throw new Error('Account not found');
    }

    if (account.user_id !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not own this account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt credentials (handles both encrypted and legacy plaintext)
    const decryptedCreds = await decryptCredentials(account.credentials);
    const credentials: FacebookCredentials = {
      page_access_token: String(decryptedCreds.page_access_token || ''),
      page_id: String(decryptedCreds.page_id || ''),
    };
    
    if (!credentials.page_access_token || !credentials.page_id) {
      throw new Error("Invalid Facebook credentials");
    }

    // Post to Facebook
    const result = await postToFacebook(content, credentials, link);
    const postId = result.id;
    const publishedUrl = postId ? `https://facebook.com/${postId}` : null;

    console.log("Facebook post published successfully:", postId);

    return new Response(
      JSON.stringify({
        success: true,
        platform: 'facebook',
        published_url: publishedUrl,
        response_data: result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Error publishing to Facebook:", error);
    return new Response(
      JSON.stringify({
        success: false,
        platform: 'facebook',
        error: 'Failed to publish to Facebook. Please try again.',
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
