/**
 * AI Provider Test Edge Function
 * 
 * Tests connection to various AI providers.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestRequest {
  provider_type: 'image' | 'video';
  provider_name: string;
  api_key?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { provider_type, provider_name, api_key }: TestRequest = await req.json();

    console.log(`Testing ${provider_type} provider: ${provider_name}`);

    // Lovable AI - always available
    if (provider_name === 'lovable_ai') {
      const lovableKey = Deno.env.get('LOVABLE_API_KEY');
      if (!lovableKey) {
        return new Response(
          JSON.stringify({ success: false, message: 'Lovable AI not configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test with a simple request
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: 'Say "connected" in one word.' }],
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        return new Response(
          JSON.stringify({ success: true, message: 'Lovable AI connected successfully' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        const error = await response.text();
        console.error('Lovable AI test failed:', error);
        return new Response(
          JSON.stringify({ success: false, message: 'Lovable AI connection failed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // OpenAI DALL-E
    if (provider_name === 'openai_dalle') {
      if (!api_key) {
        return new Response(
          JSON.stringify({ success: false, message: 'API key required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${api_key}` },
      });

      if (response.ok) {
        return new Response(
          JSON.stringify({ success: true, message: 'OpenAI connected successfully' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, message: 'Invalid OpenAI API key' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Replicate
    if (provider_name === 'replicate_flux' || provider_name === 'replicate_video') {
      if (!api_key) {
        return new Response(
          JSON.stringify({ success: false, message: 'API key required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await fetch('https://api.replicate.com/v1/account', {
        headers: { 'Authorization': `Token ${api_key}` },
      });

      if (response.ok) {
        return new Response(
          JSON.stringify({ success: true, message: 'Replicate connected successfully' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, message: 'Invalid Replicate API key' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Hugging Face
    if (provider_name === 'huggingface') {
      if (!api_key) {
        return new Response(
          JSON.stringify({ success: false, message: 'API key required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { 'Authorization': `Bearer ${api_key}` },
      });

      if (response.ok) {
        return new Response(
          JSON.stringify({ success: true, message: 'Hugging Face connected successfully' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, message: 'Invalid Hugging Face token' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Unknown provider
    return new Response(
      JSON.stringify({ success: false, message: `Unknown provider: ${provider_name}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Provider test error:', error);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
