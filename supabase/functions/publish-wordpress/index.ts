/**
 * Publish to WordPress Edge Function
 * Creates posts on WordPress sites via REST API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WordPressCredentials {
  username: string;
  application_password: string;
  site_url?: string;
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
  title?: string;
  excerpt?: string;
  status?: 'publish' | 'draft' | 'pending';
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}

async function postToWordPress(
  credentials: WordPressCredentials,
  postData: {
    title: string;
    content: string;
    excerpt?: string;
    status?: string;
    categories?: number[];
    tags?: number[];
    featured_media?: number;
  }
): Promise<any> {
  const { username, application_password, site_url } = credentials;

  if (!site_url) {
    throw new Error('WordPress site URL is required');
  }

  // Ensure URL ends without trailing slash
  const baseUrl = site_url.replace(/\/$/, '');
  const apiUrl = `${baseUrl}/wp-json/wp/v2/posts`;

  // Create Basic Auth header
  const authHeader = btoa(`${username}:${application_password}`);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: postData.title,
      content: postData.content,
      excerpt: postData.excerpt,
      status: postData.status || 'publish',
      categories: postData.categories,
      tags: postData.tags,
      featured_media: postData.featured_media,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WordPress API error: ${error}`);
  }

  return response.json();
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

    const { 
      content, 
      account_id, 
      title,
      excerpt,
      status = 'publish',
      categories,
      tags,
      featured_media
    }: PublishRequest = await req.json();

    console.log('Publishing to WordPress:', { account_id, user: user.id });

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
    const credentials: WordPressCredentials = {
      username: String(decryptedCreds.username || ''),
      application_password: String(decryptedCreds.application_password || ''),
      site_url: String(decryptedCreds.site_url || account.metadata?.website_url || ''),
    };

    const result = await postToWordPress(credentials, {
      title: title || 'New Post',
      content: content,
      excerpt,
      status,
      categories,
      tags,
      featured_media,
    });

    // Update last_used_at
    await supabase
      .from('connected_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', account_id);

    console.log('WordPress post published:', result);

    return new Response(
      JSON.stringify({
        success: true,
        post_id: result.id,
        published_url: result.link,
        response_data: result,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('WordPress publish error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to publish to WordPress. Please try again.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
