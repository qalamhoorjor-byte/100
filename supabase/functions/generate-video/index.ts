/**
 * Video Generation Edge Function
 * 
 * Always generates video scripts and storyboards natively.
 * Video rendering is optional and requires external provider.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  prompt: string;
  aspect_ratio?: '9:16' | '16:9';
  video_type?: string;
  workflow_id?: string;
  generate_video?: boolean; // If true and provider connected, attempt video rendering
}

interface VideoScript {
  title: string;
  duration_seconds: number;
  script: string;
  scenes: Scene[];
  music_style: string;
  target_platform: string;
}

interface Scene {
  scene_number: number;
  duration_seconds: number;
  visual_description: string;
  text_overlay?: string;
  action: string;
}

async function generateScriptWithLovableAI(
  prompt: string,
  aspect_ratio: string,
  video_type: string,
  lovableKey: string
): Promise<{ script: string; storyboard: Scene[] }> {
  const scriptPrompt = `Create a ${video_type} video script for: "${prompt}"
  
  Format your response as JSON with this structure:
  {
    "title": "Video title",
    "duration_seconds": 30,
    "script": "The narration/voiceover text",
    "scenes": [
      {
        "scene_number": 1,
        "duration_seconds": 5,
        "visual_description": "What appears on screen",
        "text_overlay": "Any text shown",
        "action": "What happens"
      }
    ],
    "music_style": "Suggested background music style",
    "target_platform": "${aspect_ratio === '9:16' ? 'TikTok/Reels' : 'YouTube'}"
  }`;

  console.log('Generating video script with Lovable AI');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are a professional video script writer. Always respond with valid JSON.' },
        { role: 'user', content: scriptPrompt }
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Lovable AI script error:', error);
    throw new Error('Script generation failed');
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  let script = '';
  let storyboard: Scene[] = [];
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: VideoScript = JSON.parse(jsonMatch[0]);
      script = parsed.script || '';
      storyboard = parsed.scenes || [];
    }
  } catch (parseError) {
    console.error('Failed to parse script JSON:', parseError);
    script = content;
  }

  return { script, storyboard };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { 
      prompt, 
      aspect_ratio = '9:16', 
      video_type = 'promotional',
      workflow_id,
      generate_video = false 
    }: GenerateRequest = await req.json();

    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableKey) {
      return new Response(
        JSON.stringify({ 
          error: 'Configuration error',
          message: 'Native video intelligence is not available. Please contact support.',
          skipped: true,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Always generate script and storyboard natively
    const { script, storyboard } = await generateScriptWithLovableAI(
      prompt, 
      aspect_ratio, 
      video_type, 
      lovableKey
    );

    // Check for video rendering provider (optional)
    const { data: providerData } = await supabase
      .from('ai_provider_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider_type', 'video')
      .eq('status', 'connected')
      .maybeSingle();

    let videoUrl: string | null = null;
    let videoSkipped = false;
    let videoSkipReason = '';
    let providerName = 'native_lovable_ai';

    // Video rendering (only if explicitly requested AND provider available)
    if (generate_video) {
      if (providerData && providerData.provider_name === 'replicate_video') {
        const credentials = providerData.encrypted_credentials as any;
        if (credentials?.api_key) {
          providerName = providerData.provider_name;
          // TODO: Implement actual Replicate video generation
          console.log('Video rendering requested - Replicate integration placeholder');
          videoSkipped = true;
          videoSkipReason = 'Video rendering requires Replicate API implementation. Script and storyboard are ready for manual video creation.';
        } else {
          videoSkipped = true;
          videoSkipReason = 'Video provider credentials not configured';
        }
      } else {
        videoSkipped = true;
        videoSkipReason = 'No video rendering provider connected. Connect a video provider in Settings to enable rendering.';
      }
    }

    // Store generated assets
    const assets = [];
    
    if (script) {
      const { data: scriptAsset } = await supabase.from('generated_assets').insert({
        user_id: user.id,
        workflow_id: workflow_id || null,
        asset_type: 'script',
        provider_name: 'native_lovable_ai',
        prompt_used: prompt,
        output_urls: [],
        aspect_ratio,
        metadata: { 
          script, 
          video_type,
          generated_at: new Date().toISOString(),
          is_native: true,
        },
      }).select().single();
      
      if (scriptAsset) assets.push(scriptAsset);
    }

    if (storyboard.length > 0) {
      const { data: storyboardAsset } = await supabase.from('generated_assets').insert({
        user_id: user.id,
        workflow_id: workflow_id || null,
        asset_type: 'storyboard',
        provider_name: 'native_lovable_ai',
        prompt_used: prompt,
        output_urls: [],
        aspect_ratio,
        metadata: { 
          storyboard, 
          video_type,
          generated_at: new Date().toISOString(),
          is_native: true,
        },
      }).select().single();
      
      if (storyboardAsset) assets.push(storyboardAsset);
    }

    if (videoUrl) {
      const { data: videoAsset } = await supabase.from('generated_assets').insert({
        user_id: user.id,
        workflow_id: workflow_id || null,
        asset_type: 'video',
        provider_name: providerName,
        prompt_used: prompt,
        output_urls: [videoUrl],
        aspect_ratio,
        metadata: { 
          video_type,
          generated_at: new Date().toISOString(),
          is_native: false,
        },
      }).select().single();
      
      if (videoAsset) assets.push(videoAsset);
    }

    return new Response(
      JSON.stringify({
        success: true,
        script,
        storyboard,
        video_url: videoUrl,
        video_skipped: generate_video && videoSkipped,
        video_skip_reason: videoSkipReason,
        provider: providerName,
        is_native: providerName === 'native_lovable_ai',
        assets,
        message: `Generated script and storyboard${videoUrl ? ' + video' : ''}${videoSkipped ? ` (Video: ${videoSkipReason})` : ''}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Video generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
