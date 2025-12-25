import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create user client to check permissions
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin using the has_role function
    const { data: isAdmin, error: roleError } = await supabase
      .rpc('has_role', { _user_id: user.id, _role: 'admin' });

    if (roleError || !isAdmin) {
      console.log('Role check failed:', roleError, isAdmin);
      return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all statistics
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0)).toISOString();
    const weekStart = new Date(now.setDate(now.getDate() - 7)).toISOString();
    const monthStart = new Date(now.setMonth(now.getMonth() - 1)).toISOString();

    // Get user counts from profiles table
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: newUsersToday } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    const { count: newUsersWeek } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    const { count: newUsersMonth } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStart);

    // Get workflow stats
    const { count: totalWorkflows } = await supabase
      .from('workflows')
      .select('*', { count: 'exact', head: true });

    const { count: activeWorkflows } = await supabase
      .from('workflows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Get post stats
    const { count: totalPosts } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true });

    const { count: publishedPosts } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');

    // Get connected accounts by platform
    const { data: accountsByPlatform } = await supabase
      .from('connected_accounts')
      .select('platform');

    const platformCounts: Record<string, number> = {};
    accountsByPlatform?.forEach((acc) => {
      platformCounts[acc.platform] = (platformCounts[acc.platform] || 0) + 1;
    });

    // Get pending content reports
    const { count: pendingReports } = await supabase
      .from('content_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Get recent activity logs
    const { data: recentActivity } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    // Get user growth data for the last 30 days
    const { data: userGrowth } = await supabase
      .from('profiles')
      .select('created_at')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });

    const stats = {
      users: {
        total: totalUsers || 0,
        newToday: newUsersToday || 0,
        newThisWeek: newUsersWeek || 0,
        newThisMonth: newUsersMonth || 0,
        growth: userGrowth || [],
      },
      workflows: {
        total: totalWorkflows || 0,
        active: activeWorkflows || 0,
      },
      posts: {
        total: totalPosts || 0,
        published: publishedPosts || 0,
        successRate: totalPosts ? ((publishedPosts || 0) / totalPosts * 100).toFixed(1) : 0,
      },
      connectedAccounts: platformCounts,
      moderation: {
        pendingReports: pendingReports || 0,
      },
      recentActivity: recentActivity || [],
    };

    console.log('Admin stats fetched successfully');

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin-stats:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
