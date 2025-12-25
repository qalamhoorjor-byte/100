/**
 * Image Generation Edge Function
 * 
 * Generates images using native Lovable AI by default.
 * Falls back to user's connected provider if available.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  prompt: string;
  aspect_ratios?: ('1:1' | '9:16' | 'story')[];
  style?: string;
  workflow_id?: string;
}

const ASPECT_RATIO_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 768, height: 1344 },
  'story': { width: 1080, height: 1920 },
  '16:9': { width: 1344, height: 768 },
};

async function generateWithLovableAI(
  prompt: string, 
  ratio: string, 
  style: string | undefined, 
  lovableKey: string
): Promise<string> {
  const size = ASPECT_RATIO_SIZES[ratio] || ASPECT_RATIO_SIZES['1:1'];
  const stylePrompt = style && style !== 'auto' ? `, ${style} style` : '';
  const fullPrompt = `${prompt}${stylePrompt}. Aspect ratio ${ratio}, ${size.width}x${size.height} resolution. Ultra high quality.`;

  console.log(`Generating image with Lovable AI: ${ratio}`);

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image-preview',
      messages: [{ role: 'user', content: fullPrompt }],
      modalities: ['image', 'text'],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Lovable AI image error:', error);
    throw new Error('Native image generation failed');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.images?.[0]?.image_url?.url || '';
}

async function generateWithOpenAI(
  prompt: string, 
  ratio: string, 
  style: string | undefined, 
  apiKey: string
): Promise<string> {
  console.log(`Generating image with OpenAI DALL-E: ${ratio}`);

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: `${prompt}${style && style !== 'auto' ? `, ${style} style` : ''}`,
      n: 1,
      size: ratio === '1:1' ? '1024x1024' : ratio === '9:16' ? '1024x1536' : '1024x1536',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI image error:', error);
    throw new Error('OpenAI image generation failed');
  }

  const data = await response.json();
  return data.data?.[0]?.url || (data.data?.[0]?.b64_json 
    ? `data:image/png;base64,${data.data[0].b64_json}` 
    : '');
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

    const { prompt, aspect_ratios = ['1:1'], style, workflow_id }: GenerateRequest = await req.json();

    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    
    // Check if Lovable AI is available (native generation)
    if (!lovableKey) {
      return new Response(
        JSON.stringify({ 
          error: 'Configuration error',
          message: 'Native image generation is not available. Please contact support.',
          skipped: true,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for user's external provider (optional override)
    const { data: providerData } = await supabase
      .from('ai_provider_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider_type', 'image')
      .eq('status', 'connected')
      .maybeSingle();

    // Determine which provider to use
    let providerName = 'native_lovable_ai';
    let useExternalProvider = false;

    if (providerData && providerData.provider_name !== 'lovable_ai') {
      // User has connected an external provider - use it as override
      const credentials = providerData.encrypted_credentials as any;
      if (credentials?.api_key) {
        providerName = providerData.provider_name;
        useExternalProvider = true;
        console.log(`Using external provider: ${providerName}`);
      }
    }

    const generatedImages: { aspect_ratio: string; url: string }[] = [];

    for (const ratio of aspect_ratios) {
      let imageUrl = '';

      try {
        if (useExternalProvider && providerData) {
          const credentials = providerData.encrypted_credentials as any;
          
          if (providerData.provider_name === 'openai_dalle') {
            imageUrl = await generateWithOpenAI(prompt, ratio, style, credentials.api_key);
          } else {
            // Fallback to native for unsupported providers
            console.log(`Provider ${providerData.provider_name} not fully supported, using native`);
            imageUrl = await generateWithLovableAI(prompt, ratio, style, lovableKey);
            providerName = 'native_lovable_ai';
          }
        } else {
          // Native generation (default)
          imageUrl = await generateWithLovableAI(prompt, ratio, style, lovableKey);
        }
      } catch (genError) {
        console.error(`Generation failed for ${ratio}, trying native fallback:`, genError);
        // Fallback to native if external provider fails
        if (useExternalProvider) {
          try {
            imageUrl = await generateWithLovableAI(prompt, ratio, style, lovableKey);
            providerName = 'native_lovable_ai';
          } catch (fallbackError) {
            console.error('Native fallback also failed:', fallbackError);
          }
        }
      }

      if (imageUrl) {
        generatedImages.push({ aspect_ratio: ratio, url: imageUrl });
      }
    }

    // Store generated assets
    if (generatedImages.length > 0) {
      await supabase.from('generated_assets').insert({
        user_id: user.id,
        workflow_id: workflow_id || null,
        asset_type: 'image',
        provider_name: providerName,
        prompt_used: prompt,
        output_urls: generatedImages.map(img => img.url),
        aspect_ratio: aspect_ratios.join(','),
        metadata: { 
          style, 
          generated_at: new Date().toISOString(),
          is_native: providerName === 'native_lovable_ai',
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        images: generatedImages,
        provider: providerName,
        is_native: providerName === 'native_lovable_ai',
        message: generatedImages.length > 0 
          ? `Generated ${generatedImages.length} image(s) using ${providerName === 'native_lovable_ai' ? 'Native AI' : providerName}`
          : 'No images generated',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Image generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
