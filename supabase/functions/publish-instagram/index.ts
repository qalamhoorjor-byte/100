/**
 * Publish to Instagram Edge Function
 * Posts content to Instagram via Facebook Graph API (Business Account)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InstagramCredentials {
  access_token: string;
  instagram_account_id?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(encryptionKey), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: encoder.encode('lovable-credential-salt'), iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function decryptCredentials(credentialsData: unknown): Promise<Record<string, unknown>> {
  if (typeof credentialsData === 'object' && credentialsData !== null) return credentialsData as Record<string, unknown>;
  const encryptedData = String(credentialsData);
  if (!encryptedData.startsWith('ENC:')) { try { return JSON.parse(encryptedData); } catch { return {}; } }
  const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY not set');
  const key = await deriveKey(encryptionKey);
  const combined = Uint8Array.from(atob(encryptedData.slice(4)), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
  return JSON.parse(decoder.decode(plaintext));
}

interface PublishRequest {
  content: string;
  account_id: string;
  image_url?: string;
  post_id?: string;
}

async function postToInstagram(
  caption: string,
  credentials: InstagramCredentials,
  imageUrl?: string
): Promise<any> {
  const { access_token, instagram_account_id } = credentials;

  if (!instagram_account_id) {
    throw new Error('Instagram account ID is required');
  }

  // Instagram requires a media (image or video) for posts
  if (!imageUrl) {
    throw new Error('Instagram requires an image or video URL for posts');
  }

  // Step 1: Create media container
  const containerUrl = `https://graph.facebook.com/v18.0/${instagram_account_id}/media`;
  const containerParams = new URLSearchParams({
    image_url: imageUrl,
    caption: caption,
    access_token: access_token,
  });

  const containerResponse = await fetch(`${containerUrl}?${containerParams}`, {
    method: 'POST',
  });

  if (!containerResponse.ok) {
    const error = await containerResponse.json();
    throw new Error(`Failed to create media container: ${JSON.stringify(error)}`);
  }

  const containerData = await containerResponse.json();
  const creationId = containerData.id;

  // Step 2: Publish the container
  const publishUrl = `https://graph.facebook.com/v18.0/${instagram_account_id}/media_publish`;
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: access_token,
  });

  const publishResponse = await fetch(`${publishUrl}?${publishParams}`, {
    method: 'POST',
  });

  if (!publishResponse.ok) {
    const error = await publishResponse.json();
    throw new Error(`Failed to publish to Instagram: ${JSON.stringify(error)}`);
  }

  return publishResponse.json();
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

    const { content, account_id, image_url, post_id }: PublishRequest = await req.json();

    console.log('Publishing to Instagram:', { account_id, hasImage: !!image_url, user: user.id });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Verify account ownership
    const { data: account, error: fetchError } = await supabase
      .from('connected_accounts')
      .select('credentials, metadata, user_id')
      .eq('id', account_id)
      .single();

    if (fetchError || !account) {
      throw new Error('Account not found');
    }

    if (account.user_id !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not own this account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt credentials
    const decryptedCreds = await decryptCredentials(account.credentials);
    const credentials: InstagramCredentials = {
      access_token: String(decryptedCreds.access_token || ''),
      instagram_account_id: String(decryptedCreds.instagram_account_id || account.metadata?.instagram_account_id || ''),
    };

    if (!image_url) {
      console.log('Instagram post skipped - no image provided');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Instagram requires an image or video for posts. Content-only posts are not supported.',
          skipped: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await postToInstagram(content, credentials, image_url);

    // Update last_used_at
    await supabase
      .from('connected_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', account_id);

    console.log('Instagram post published:', result);

    return new Response(
      JSON.stringify({
        success: true,
        post_id: result.id,
        published_url: `https://instagram.com/p/${result.id}`,
        response_data: result,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Instagram publish error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to publish to Instagram. Please try again.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
