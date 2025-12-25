/**
 * Publish to LinkedIn Edge Function
 * Posts content to LinkedIn via API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LinkedInCredentials {
  access_token: string;
  person_urn?: string;
  organization_urn?: string;
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
  link?: string;
  image_url?: string;
}

async function postToLinkedIn(
  text: string,
  credentials: LinkedInCredentials,
  options: { link?: string; image_url?: string } = {}
): Promise<any> {
  const { access_token, person_urn, organization_urn } = credentials;
  const author = organization_urn || person_urn;

  if (!author) {
    throw new Error('LinkedIn author URN (person or organization) is required');
  }

  const postData: any = {
    author: author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: text,
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  // Add link if provided
  if (options.link) {
    postData.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'ARTICLE';
    postData.specificContent['com.linkedin.ugc.ShareContent'].media = [
      {
        status: 'READY',
        originalUrl: options.link,
      },
    ];
  }

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LinkedIn API error: ${error}`);
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

    const { content, account_id, link, image_url }: PublishRequest = await req.json();

    console.log('Publishing to LinkedIn:', { account_id, user: user.id });

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
    const credentials: LinkedInCredentials = {
      access_token: String(decryptedCreds.access_token || ''),
      person_urn: String(decryptedCreds.person_urn || account.metadata?.person_urn || ''),
      organization_urn: String(decryptedCreds.organization_urn || account.metadata?.organization_urn || ''),
    };

    const result = await postToLinkedIn(content, credentials, { link, image_url });

    // Update last_used_at
    await supabase
      .from('connected_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', account_id);

    console.log('LinkedIn post published:', result);

    const postId = result.id?.replace('urn:li:share:', '') || result.id;

    return new Response(
      JSON.stringify({
        success: true,
        post_id: postId,
        published_url: postId ? `https://www.linkedin.com/feed/update/${result.id}` : null,
        response_data: result,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('LinkedIn publish error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to publish to LinkedIn. Please try again.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
