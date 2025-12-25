import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PublishRequest {
  post_id: string;
  content: string;
  short_content?: string;
  target_accounts: string[];
  target_platforms?: string[];
  link?: string;
  media_urls?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. CHECK AUTHENTICATION
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with user's auth token to verify identity
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // 2. VERIFY USER
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Publish request from authenticated user:', user.id);

    const { post_id, content, short_content, target_accounts, target_platforms, link, media_urls }: PublishRequest = await req.json();
    
    if (!post_id || !target_accounts || target_accounts.length === 0) {
      throw new Error("Missing required fields: post_id and target_accounts");
    }

    // Service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 3. VERIFY POST OWNERSHIP
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('user_id')
      .eq('id', post_id)
      .maybeSingle();

    if (postError) {
      console.error('Post fetch error:', postError);
      throw new Error(`Failed to fetch post: ${postError.message}`);
    }

    if (!post) {
      return new Response(
        JSON.stringify({ error: 'Post not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (post.user_id !== user.id) {
      console.error('User does not own post:', { userId: user.id, postUserId: post.user_id });
      return new Response(
        JSON.stringify({ error: 'Forbidden: You do not own this post' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("Publishing post:", post_id, "to", target_accounts.length, "accounts");

    // 4. VERIFY ACCOUNT OWNERSHIP - Fetch only accounts owned by the user
    const { data: accounts, error: accountsError } = await supabase
      .from('connected_accounts')
      .select('*')
      .in('id', target_accounts)
      .eq('user_id', user.id);  // CRITICAL: Only fetch accounts owned by authenticated user

    if (accountsError) {
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    // Check if all requested accounts belong to user
    if (!accounts || accounts.length !== target_accounts.length) {
      const ownedAccountIds = new Set((accounts || []).map(a => a.id));
      const unauthorizedAccounts = target_accounts.filter(id => !ownedAccountIds.has(id));
      console.error('User tried to publish to accounts they do not own:', unauthorizedAccounts);
      return new Response(
        JSON.stringify({ error: 'Forbidden: You do not own all target accounts' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate skipped platforms (requested but not connected)
    const connectedPlatforms = new Set((accounts || []).map(a => a.platform));
    const skippedPlatforms: string[] = [];
    
    if (target_platforms && target_platforms.length > 0) {
      for (const platform of target_platforms) {
        if (!connectedPlatforms.has(platform)) {
          skippedPlatforms.push(platform);
        }
      }
    }

    // Update post status to publishing
    await supabase
      .from('posts')
      .update({ status: 'publishing' })
      .eq('id', post_id);

    const results: any[] = [];
    let successCount = 0;
    let failCount = 0;

    // Publish to each connected account
    for (const account of accounts || []) {
      try {
        let result;
        // Use short content for Twitter/X (280 char limit)
        const isTwitter = account.platform === 'twitter' || account.platform === 'x';
        const publishContent = isTwitter 
          ? (short_content || content).substring(0, 280) 
          : content;

        const functionMap: Record<string, string> = {
          'twitter': 'publish-twitter',
          'x': 'publish-twitter',
          'facebook': 'publish-facebook',
          'instagram': 'publish-instagram',
          'youtube': 'publish-youtube',
          'telegram': 'publish-telegram',
          'linkedin': 'publish-linkedin',
          'wordpress': 'publish-wordpress',
          'gmail': 'publish-gmail',
        };

        const functionName = functionMap[account.platform.toLowerCase()];

        if (!functionName) {
          // Platform not yet supported - skip but don't fail
          console.log(`Platform ${account.platform} not yet implemented, skipping`);
          if (!skippedPlatforms.includes(account.platform)) {
            skippedPlatforms.push(account.platform);
          }
          continue;
        }

        // Call the appropriate publish function with media if available
        const imageUrl = media_urls?.find(url => url.match(/\.(jpg|jpeg|png|gif|webp)$/i));
        const videoUrl = media_urls?.find(url => url.match(/\.(mp4|webm|mov)$/i));

        // CRITICAL: Pass the original auth header to nested function calls
        const response = await supabase.functions.invoke(functionName, {
          headers: {
            Authorization: authHeader,
          },
          body: {
            content: publishContent,
            account_id: account.id,
            post_id,
            link,
            image_url: imageUrl,
            video_url: videoUrl,
            title: account.platform === 'wordpress' ? (content.split('\n')[0] || 'New Post') : undefined,
          },
        });
        
        // Handle null response or error from function invoke
        if (response.error) {
          console.error(`Function ${functionName} returned error:`, response.error);
          result = {
            success: false,
            error: response.error.message || 'فشل الاتصال بخدمة النشر'
          };
        } else if (!response.data) {
          console.error(`Function ${functionName} returned null data`);
          result = {
            success: false,
            error: 'لم يتم استلام رد من خدمة النشر'
          };
        } else {
          result = response.data;
        }

        // Check if platform was skipped (e.g., Instagram without image)
        if (result?.skipped) {
          console.log(`Platform ${account.platform} skipped:`, result.error);
          if (!skippedPlatforms.includes(account.platform)) {
            skippedPlatforms.push(account.platform);
          }
          continue;
        }

        // Log the result
        await supabase.from('publish_logs').insert({
          post_id,
          account_id: account.id,
          status: result?.success ? 'success' : 'failed',
          published_url: result?.published_url,
          error_message: result?.error,
          response_data: result?.response_data,
        });

        if (result?.success) {
          successCount++;
        } else {
          failCount++;
        }

        results.push({
          account_id: account.id,
          platform: account.platform,
          display_name: account.display_name,
          success: result?.success || false,
          error: result?.error,
          published_url: result?.published_url,
        });

      } catch (error: any) {
        console.error(`Error publishing to ${account.platform}:`, error);
        failCount++;

        await supabase.from('publish_logs').insert({
          post_id,
          account_id: account.id,
          status: 'failed',
          error_message: error.message,
        });

        results.push({
          account_id: account.id,
          platform: account.platform,
          display_name: account.display_name,
          success: false,
          error: error.message,
        });
      }
    }

    // Determine final status
    // Workflow must NEVER stop due to missing integrations
    let finalStatus = 'published';
    if (successCount === 0 && failCount === 0) {
      // Only skipped platforms, no actual publishing attempted
      finalStatus = 'skipped';
    } else if (failCount > 0 && successCount > 0) {
      finalStatus = 'partial';
    } else if (failCount > 0 && successCount === 0) {
      finalStatus = 'failed';
    }

    await supabase
      .from('posts')
      .update({ status: finalStatus })
      .eq('id', post_id);

    console.log(`Publishing complete. Success: ${successCount}, Failed: ${failCount}, Skipped: ${skippedPlatforms.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        post_id,
        results,
        skipped_platforms: skippedPlatforms,
        summary: {
          total: target_accounts.length,
          success: successCount,
          failed: failCount,
          skipped: skippedPlatforms.length,
          status: finalStatus,
        },
        // Notification message for the user
        notification: {
          published_to: results.filter(r => r.success).map(r => r.platform),
          skipped: skippedPlatforms,
          message: skippedPlatforms.length > 0 
            ? `Published to ${successCount} platform(s). Skipped ${skippedPlatforms.length} platform(s) (not connected).`
            : `Successfully published to ${successCount} platform(s).`,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Error in publish-content:", error);
    // Return generic error to prevent information leakage
    let safeMessage = 'Publishing failed. Please try again.';
    if (error.message?.includes('Missing required fields')) {
      safeMessage = 'Missing required fields for publishing.';
    } else if (error.message?.includes('not found')) {
      safeMessage = 'Resource not found.';
    } else if (error.message?.includes('Forbidden')) {
      safeMessage = 'You do not have permission for this action.';
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: safeMessage,
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
