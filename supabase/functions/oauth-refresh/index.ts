/**
 * OAuth Token Refresh Edge Function
 * 
 * SCAFFOLDING ONLY - OAuth is disabled by default.
 * This function refreshes expired OAuth tokens.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefreshRequest {
  account_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { account_id }: RefreshRequest = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get account details
    const { data: account, error: fetchError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (fetchError || !account) {
      throw new Error('Account not found');
    }

    const credentials = account.credentials as any;

    // Check if this is an OAuth token
    if (credentials.token_type !== 'oauth2') {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Account does not use OAuth tokens',
          refreshed: false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if token is expired
    const expiresAt = credentials.expires_at || 0;
    const isExpired = Date.now() > expiresAt - 300000; // 5 min buffer

    if (!isExpired) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Token is still valid',
          refreshed: false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let newTokens: any = null;

    if (account.platform === 'twitter' && credentials.refresh_token) {
      const clientId = Deno.env.get('TWITTER_CONSUMER_KEY')!;
      const clientSecret = Deno.env.get('TWITTER_CONSUMER_SECRET')!;

      const response = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refresh_token,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh Twitter token');
      }

      newTokens = await response.json();

      // Update credentials
      await supabase
        .from('connected_accounts')
        .update({
          credentials: {
            ...credentials,
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token || credentials.refresh_token,
            expires_at: Date.now() + (newTokens.expires_in * 1000),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', account_id);
    }

    // Facebook long-lived tokens don't typically need refresh
    // Page access tokens are long-lived by default

    return new Response(
      JSON.stringify({
        success: true,
        refreshed: !!newTokens,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Token refresh error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
