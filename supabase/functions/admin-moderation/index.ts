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

    // Check if user is admin or moderator
    const { data: isAdmin } = await supabase
      .rpc('has_role', { _user_id: user.id, _role: 'admin' });
    const { data: isModerator } = await supabase
      .rpc('has_role', { _user_id: user.id, _role: 'moderator' });

    if (!isAdmin && !isModerator) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin/Moderator access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, reportId, status, notes, page = 1, limit = 20, filterStatus } = await req.json();

    if (action === 'list') {
      let query = supabase
        .from('content_reports')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (filterStatus && filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data: reports, count, error } = await query;

      if (error) throw error;

      // Get reporter profiles
      const reporterIds = [...new Set(reports?.map(r => r.reported_by).filter(Boolean))];
      const { data: reporters } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', reporterIds);

      const reportsWithReporters = reports?.map(report => ({
        ...report,
        reporter: reporters?.find(r => r.id === report.reported_by),
      }));

      return new Response(JSON.stringify({ reports: reportsWithReporters, total: count }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'updateStatus') {
      if (!reportId || !status) {
        return new Response(JSON.stringify({ error: 'Missing reportId or status' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
      if (!validStatuses.includes(status)) {
        return new Response(JSON.stringify({ error: 'Invalid status' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('content_reports')
        .update({
          status,
          notes: notes || null,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) throw error;

      // Log the action
      await supabase.from('activity_logs').insert({
        user_id: user.id,
        action: 'update_report_status',
        entity_type: 'content_report',
        entity_id: reportId,
        details: { status, notes },
      });

      console.log(`Report ${reportId} status updated to ${status}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'getContent') {
      const { contentType, contentId } = await req.json();

      if (!contentType || !contentId) {
        return new Response(JSON.stringify({ error: 'Missing contentType or contentId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let content = null;
      let owner = null;

      if (contentType === 'post') {
        const { data } = await supabase
          .from('posts')
          .select('*')
          .eq('id', contentId)
          .maybeSingle();
        content = data;
        
        if (data?.user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user_id)
            .maybeSingle();
          owner = profile;
        }
      } else if (contentType === 'workflow') {
        const { data } = await supabase
          .from('workflows')
          .select('*')
          .eq('id', contentId)
          .maybeSingle();
        content = data;
        
        if (data?.user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user_id)
            .maybeSingle();
          owner = profile;
        }
      } else if (contentType === 'result') {
        const { data } = await supabase
          .from('workflow_results')
          .select('*')
          .eq('id', contentId)
          .maybeSingle();
        content = data;
        
        if (data?.user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user_id)
            .maybeSingle();
          owner = profile;
        }
      }

      return new Response(JSON.stringify({ content, owner }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'deleteContent') {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Only admins can delete content' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { contentType, contentId } = await req.json();

      if (!contentType || !contentId) {
        return new Response(JSON.stringify({ error: 'Missing contentType or contentId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let error = null;

      if (contentType === 'post') {
        ({ error } = await supabase.from('posts').delete().eq('id', contentId));
      } else if (contentType === 'workflow') {
        ({ error } = await supabase.from('workflows').delete().eq('id', contentId));
      } else if (contentType === 'result') {
        ({ error } = await supabase.from('workflow_results').delete().eq('id', contentId));
      }

      if (error) throw error;

      // Log the action
      await supabase.from('activity_logs').insert({
        user_id: user.id,
        action: 'delete_content',
        entity_type: contentType,
        entity_id: contentId,
        details: { deleted_by: user.id },
      });

      console.log(`Content ${contentType}:${contentId} deleted`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin-moderation:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
