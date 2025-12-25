import { createHmac } from "node:crypto";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TwitterCredentials {
  consumer_key: string;
  consumer_secret: string;
  access_token: string;
  access_token_secret: string;
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
  // If already an object (legacy plaintext JSON)
  if (typeof credentialsData === 'object' && credentialsData !== null) {
    return credentialsData as Record<string, unknown>;
  }

  const encryptedData = String(credentialsData);
  
  // Check if data is encrypted (has ENC: prefix)
  if (!encryptedData.startsWith('ENC:')) {
    // Legacy unencrypted string data
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
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  const signatureBaseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(
    Object.entries(params)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("&")
  )}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  const hmacSha1 = createHmac("sha1", signingKey);
  const signature = hmacSha1.update(signatureBaseString).digest("base64");
  return signature;
}

function generateOAuthHeader(
  method: string,
  url: string,
  credentials: TwitterCredentials
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumer_key,
    oauth_nonce: Math.random().toString(36).substring(2),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.access_token,
    oauth_version: "1.0",
  };

  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    credentials.consumer_secret,
    credentials.access_token_secret
  );

  const signedOAuthParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const entries = Object.entries(signedOAuthParams).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    "OAuth " +
    entries
      .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
      .join(", ")
  );
}

async function sendTweet(tweetText: string, credentials: TwitterCredentials): Promise<any> {
  const url = "https://api.x.com/2/tweets";
  const method = "POST";

  const oauthHeader = generateOAuthHeader(method, url, credentials);
  console.log("Sending tweet with OAuth header generated");

  const response = await fetch(url, {
    method: method,
    headers: {
      Authorization: oauthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: tweetText }),
  });

  const responseText = await response.text();
  console.log("Twitter API Response status:", response.status);

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} - ${responseText}`);
  }

  return JSON.parse(responseText);
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

    // Create user client to verify identity
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

    const { content, account_id, post_id } = await req.json();
    
    if (!content || !account_id) {
      throw new Error("Missing required fields: content and account_id");
    }

    console.log("Publishing tweet for account:", account_id, "user:", user.id);

    // Initialize service client for database operations
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
    const credentials: TwitterCredentials = {
      consumer_key: String(decryptedCreds.consumer_key || ''),
      consumer_secret: String(decryptedCreds.consumer_secret || ''),
      access_token: String(decryptedCreds.access_token || ''),
      access_token_secret: String(decryptedCreds.access_token_secret || ''),
    };
    
    if (!credentials.consumer_key || !credentials.access_token) {
      throw new Error("Invalid Twitter credentials");
    }

    // Send the tweet
    const result = await sendTweet(content, credentials);
    const tweetId = result.data?.id;
    const publishedUrl = tweetId ? `https://twitter.com/i/status/${tweetId}` : null;

    console.log("Tweet published successfully:", tweetId);

    return new Response(
      JSON.stringify({
        success: true,
        platform: 'twitter',
        published_url: publishedUrl,
        response_data: result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Error publishing to Twitter:", error);
    return new Response(
      JSON.stringify({
        success: false,
        platform: 'twitter',
        error: 'Failed to publish to Twitter. Please try again.',
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
