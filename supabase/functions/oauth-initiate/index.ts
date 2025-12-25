/**
 * OAuth Initiation Edge Function
 * 
 * SCAFFOLDING ONLY - OAuth is disabled by default.
 * This function will initiate OAuth flow when enabled.
 * 
 * Required secrets (to be added when enabling):
 * - TWITTER_CONSUMER_KEY
 * - TWITTER_CONSUMER_SECRET
 * - FACEBOOK_APP_ID
 * - FACEBOOK_APP_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// OAuth is enabled when credentials are present
function isOAuthEnabled(platform: string): boolean {
  if (platform === 'twitter') {
    return !!(Deno.env.get('TWITTER_CONSUMER_KEY') && Deno.env.get('TWITTER_CONSUMER_SECRET'));
  }
  if (platform === 'facebook') {
    return !!(Deno.env.get('FACEBOOK_APP_ID') && Deno.env.get('FACEBOOK_APP_SECRET'));
  }
  return false;
}

interface OAuthRequest {
  platform: 'twitter' | 'facebook';
  redirect_uri: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { platform, redirect_uri }: OAuthRequest = await req.json();

    console.log(`OAuth initiate request for ${platform}`);

    // Check if OAuth is enabled for this platform (credentials exist)
    if (!isOAuthEnabled(platform)) {
      console.log(`OAuth not enabled for ${platform} - credentials missing`);
      return new Response(
        JSON.stringify({
          error: 'OAuth not enabled',
          message: `OAuth for ${platform} is not yet configured. Please add API credentials or use manual token entry.`,
          oauth_enabled: false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Generate state for CSRF protection
    const state = crypto.randomUUID();

    // Store state in database for verification (placeholder)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let authUrl = '';

    if (platform === 'twitter') {
      // Twitter OAuth 2.0 PKCE flow (placeholder)
      const clientId = Deno.env.get('TWITTER_CONSUMER_KEY');
      
      if (!clientId) {
        return new Response(
          JSON.stringify({
            error: 'Configuration missing',
            message: 'Twitter API credentials not configured.',
            oauth_enabled: false,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Generate PKCE code verifier and challenge
      const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect_uri,
        scope: 'tweet.read tweet.write users.read offline.access',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

    } else if (platform === 'facebook') {
      // Facebook OAuth flow (placeholder)
      const appId = Deno.env.get('FACEBOOK_APP_ID');
      
      if (!appId) {
        return new Response(
          JSON.stringify({
            error: 'Configuration missing',
            message: 'Facebook API credentials not configured.',
            oauth_enabled: false,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirect_uri,
        scope: 'pages_show_list,pages_read_engagement,pages_manage_posts',
        state: state,
        response_type: 'code',
      });

      authUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
    }

    return new Response(
      JSON.stringify({
        auth_url: authUrl,
        state: state,
        oauth_enabled: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('OAuth initiate error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        oauth_enabled: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
