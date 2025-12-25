/**
 * Publish to YouTube Edge Function
 * Creates YouTube videos/shorts via YouTube Data API v3
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface YouTubeCredentials {
  access_token: string;
  refresh_token?: string;
  api_key?: string;
}

interface PublishRequest {
  content: string;
  account_id: string;
  video_url?: string;
  title?: string;
  description?: string;
  tags?: string[];
  privacy_status?: 'public' | 'private' | 'unlisted';
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
      video_url, 
      title,
      description,
      tags = [],
      privacy_status = 'public'
    }: PublishRequest = await req.json();

    console.log('Publishing to YouTube:', { account_id, hasVideo: !!video_url, user: user.id });

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

    const credentials = account.credentials as YouTubeCredentials;

    if (!video_url) {
      console.log('YouTube post skipped - no video provided');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'YouTube requires a video URL for publishing. Text-only posts are not supported.',
          skipped: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('YouTube video publishing requires OAuth flow and resumable upload');

    // Update last_used_at
    await supabase
      .from('connected_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', account_id);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'YouTube video upload requires OAuth authentication with YouTube Data API. Use YouTube Studio for direct upload.',
        skipped: true,
        note: 'YouTube requires: 1) OAuth consent screen setup, 2) YouTube Data API enabled, 3) Video upload scope authorization',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('YouTube publish error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to publish to YouTube. Please try again.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
