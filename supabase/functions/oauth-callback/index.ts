/**
 * OAuth Callback Edge Function
 * 
 * SCAFFOLDING ONLY - OAuth is disabled by default.
 * This function handles OAuth callbacks and token exchange.
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

interface CallbackRequest {
  platform: 'twitter' | 'facebook';
  code: string;
  state: string;
  redirect_uri: string;
  code_verifier?: string; // For Twitter PKCE
  user_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CallbackRequest = await req.json();
    const { platform, code, state, redirect_uri, code_verifier, user_id } = body;

    console.log(`OAuth callback for ${platform}`);

    // Check if OAuth is enabled
    if (!isOAuthEnabled(platform)) {
      return new Response(
        JSON.stringify({
          error: 'OAuth not enabled',
          message: `OAuth for ${platform} is not yet configured.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let tokens: any = null;
    let userInfo: any = null;

    if (platform === 'twitter') {
      // Exchange code for tokens (Twitter OAuth 2.0)
      const clientId = Deno.env.get('TWITTER_CONSUMER_KEY')!;
      const clientSecret = Deno.env.get('TWITTER_CONSUMER_SECRET')!;

      const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirect_uri,
          code_verifier: code_verifier || '',
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Twitter token exchange failed: ${error}`);
      }

      tokens = await tokenResponse.json();

      // Get user info
      const userResponse = await fetch('https://api.twitter.com/2/users/me', {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        userInfo = userData.data;
      }

      // Store in database
      const { error: insertError } = await supabase
        .from('connected_accounts')
        .insert({
          user_id: user_id,
          platform: 'twitter',
          platform_type: 'social',
          display_name: userInfo?.name || 'Twitter Account',
          account_identifier: userInfo?.username || '',
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000),
            token_type: 'oauth2',
          },
          is_active: true,
        });

      if (insertError) throw insertError;

    } else if (platform === 'facebook') {
      // Exchange code for tokens (Facebook OAuth)
      const appId = Deno.env.get('FACEBOOK_APP_ID')!;
      const appSecret = Deno.env.get('FACEBOOK_APP_SECRET')!;

      const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
      tokenUrl.searchParams.set('client_id', appId);
      tokenUrl.searchParams.set('client_secret', appSecret);
      tokenUrl.searchParams.set('redirect_uri', redirect_uri);
      tokenUrl.searchParams.set('code', code);

      const tokenResponse = await fetch(tokenUrl.toString());

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Facebook token exchange failed: ${error}`);
      }

      tokens = await tokenResponse.json();

      // Get user's pages
      const pagesResponse = await fetch(
        `https://graph.facebook.com/v18.0/me/accounts?access_token=${tokens.access_token}`
      );

      if (pagesResponse.ok) {
        const pagesData = await pagesResponse.json();
        
        // Store each page as a connected account
        for (const page of pagesData.data || []) {
          await supabase
            .from('connected_accounts')
            .insert({
              user_id: user_id,
              platform: 'facebook',
              platform_type: 'social',
              display_name: page.name,
              account_identifier: page.id,
              credentials: {
                page_access_token: page.access_token,
                page_id: page.id,
                user_access_token: tokens.access_token,
                token_type: 'oauth2',
              },
              is_active: true,
            });
        }

        userInfo = { pages: pagesData.data };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        platform,
        user_info: userInfo,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
