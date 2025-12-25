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

    // Check if user is admin
    const { data: isAdmin, error: roleError } = await supabase
      .rpc('has_role', { _user_id: user.id, _role: 'admin' });

    if (roleError || !isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, targetUserId, role, search, page = 1, limit = 20 } = await req.json();

    // Input validation helper for ILIKE search
    const sanitizeIlikeSearch = (input: string): string | null => {
      if (!input || typeof input !== 'string') return null;
      if (input.length > 100) return null; // Length limit
      // Escape ILIKE special characters
      return input.replace(/[%_\\]/g, '\\$&');
    };

    if (action === 'list') {
      // List all users with their roles and stats
      let query = supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (search) {
        const sanitizedSearch = sanitizeIlikeSearch(search);
        if (sanitizedSearch) {
          query = query.or(`email.ilike.%${sanitizedSearch}%,full_name.ilike.%${sanitizedSearch}%`);
        }
      }

      const { data: profiles, count, error } = await query;

      if (error) throw error;

      // Get roles for each user
      const userIds = profiles?.map(p => p.id) || [];
      const { data: allRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds);

      // Get workflow counts per user
      const { data: workflowCounts } = await supabase
        .from('workflows')
        .select('user_id')
        .in('user_id', userIds);

      const workflowCountMap: Record<string, number> = {};
      workflowCounts?.forEach(w => {
        workflowCountMap[w.user_id] = (workflowCountMap[w.user_id] || 0) + 1;
      });

      const usersWithData = profiles?.map(profile => ({
        ...profile,
        roles: allRoles?.filter(r => r.user_id === profile.id).map(r => r.role) || [],
        workflowCount: workflowCountMap[profile.id] || 0,
      }));

      return new Response(JSON.stringify({ users: usersWithData, total: count }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'assignRole') {
      if (!targetUserId || !role) {
        return new Response(JSON.stringify({ error: 'Missing targetUserId or role' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if role already exists
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', targetUserId)
        .eq('role', role)
        .maybeSingle();

      if (existingRole) {
        return new Response(JSON.stringify({ message: 'Role already assigned' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: targetUserId, role });

      if (error) throw error;

      // Log the action
      await supabase.from('activity_logs').insert({
        user_id: user.id,
        action: 'assign_role',
        entity_type: 'user',
        entity_id: targetUserId,
        details: { role, assigned_by: user.id },
      });

      console.log(`Role ${role} assigned to user ${targetUserId}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'removeRole') {
      if (!targetUserId || !role) {
        return new Response(JSON.stringify({ error: 'Missing targetUserId or role' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', targetUserId)
        .eq('role', role);

      if (error) throw error;

      // Log the action
      await supabase.from('activity_logs').insert({
        user_id: user.id,
        action: 'remove_role',
        entity_type: 'user',
        entity_id: targetUserId,
        details: { role, removed_by: user.id },
      });

      console.log(`Role ${role} removed from user ${targetUserId}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'getUserDetails') {
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'Missing targetUserId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .maybeSingle();

      if (profileError) throw profileError;

      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', targetUserId);

      const { data: workflows } = await supabase
        .from('workflows')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: posts } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: connectedAccounts } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('user_id', targetUserId);

      return new Response(JSON.stringify({
        profile,
        roles: roles?.map(r => r.role) || [],
        workflows,
        posts,
        connectedAccounts,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin-users:', error);
    // Return generic error message to prevent information leakage
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
