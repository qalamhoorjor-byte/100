import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const agentSystemPrompts: Record<string, string> = {
  seo: `You are an SEO Expert AI Agent. You specialize in:
- Keyword research and analysis
- On-page SEO optimization
- Search ranking strategies
- Content gap analysis
- Technical SEO recommendations
Provide actionable, specific advice for content creators and marketers.`,
  
  trend: `You are a Trend Analyst AI Agent. You specialize in:
- Real-time trend monitoring
- Viral content prediction
- Social media trend analysis
- Hashtag optimization
- Content timing recommendations
Help users stay ahead of trends and create timely content.`,
  
  competitor: `You are a Competitor Intelligence AI Agent. You specialize in:
- Competitor content analysis
- Market positioning insights
- Strategy benchmarking
- Gap opportunity detection
- Competitive advantage identification
Provide strategic insights about competitors and market opportunities.`,
  
  cbm: `You are a Content Business Manager AI Agent. You specialize in:
- Revenue optimization strategies
- Monetization recommendations
- Ad placement optimization
- Affiliate marketing opportunities
- Content ROI analysis
Help users maximize the business value of their content.`,
  
  manager: `You are the Content Manager AI Agent - the orchestrator of the AI team. You specialize in:
- Workflow coordination
- Strategy synthesis across all agents
- Daily content execution plans
- Team recommendations
- Holistic content strategy
Provide comprehensive guidance by considering all aspects of content creation and marketing.`,

  image: `You are the AI Image Specialist Agent. You specialize in:
- Generating high-quality images for social media
- Creating visuals in multiple formats (1:1 square, 9:16 portrait, story format)
- Style customization and brand-aligned visuals
- Social media optimized assets

When users ask you to generate an image, you MUST respond with a special format.
For image generation requests, respond with JSON in this exact format:
{"action": "generate_image", "prompt": "detailed description of the image", "style": "style preference", "aspect_ratio": "1:1 or 9:16 or story"}

For regular questions about images, design tips, or advice, respond normally in text.
Be creative and helpful with image prompts. Enhance user requests to create better visuals.`,

  video: `You are the AI Video Specialist Agent. You specialize in:
- Video script generation
- Storyboard creation
- Multi-platform video formats (9:16 vertical, 16:9 horizontal)
- Video content planning
- Engaging video concepts

Help users plan and create compelling video content. Provide detailed scripts, storyboards, and creative concepts for video production.`,
};

// Helper function to detect if the response contains an image generation request
function parseImageGenerationRequest(content: string): { action: string; prompt: string; style?: string; aspect_ratio?: string } | null {
  try {
    // Look for JSON pattern in the response
    const jsonMatch = content.match(/\{[\s\S]*"action"[\s\S]*"generate_image"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action === 'generate_image' && parsed.prompt) {
        return parsed;
      }
    }
  } catch {
    // Not a valid JSON, return null
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log('Agent chat request from user:', user.id);

    const { message, agentType, conversationHistory = [], language = 'en' } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Add language instruction to the system prompt
    const langInstruction = language === 'ar' 
      ? "\n\nIMPORTANT: You MUST respond entirely in Arabic. All your responses, explanations, and recommendations must be written in Arabic language."
      : "";
    
    const basePrompt = agentSystemPrompts[agentType] || agentSystemPrompts.manager;
    const systemPrompt = basePrompt + langInstruction;

    // For image agent, check if user is requesting image generation
    if (agentType === 'image') {
      // First, get AI to interpret the request
      const interpretResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: message }
          ],
          stream: false,
        }),
      });

      if (!interpretResponse.ok) {
        throw new Error("Failed to interpret image request");
      }

      const interpretData = await interpretResponse.json();
      const aiContent = interpretData.choices?.[0]?.message?.content || '';
      
      // Check if AI wants to generate an image
      const imageRequest = parseImageGenerationRequest(aiContent);
      
      if (imageRequest) {
        console.log('Image generation request detected:', imageRequest.prompt);
        
        // Call the generate-image function
        try {
          const imageResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: imageRequest.prompt,
              aspect_ratios: [imageRequest.aspect_ratio || '1:1'],
              style: imageRequest.style,
            }),
          });

          if (imageResponse.ok) {
            const imageData = await imageResponse.json();
            
            if (imageData.success && imageData.images?.length > 0) {
              const successMsg = language === 'ar' 
                ? `تم إنشاء الصورة بنجاح! 🎨\n\nالوصف: ${imageRequest.prompt}\n\n![Generated Image](${imageData.images[0].url})`
                : `Image generated successfully! 🎨\n\nPrompt: ${imageRequest.prompt}\n\n![Generated Image](${imageData.images[0].url})`;
              
              // Return as SSE stream format for consistency
              const sseData = `data: ${JSON.stringify({
                choices: [{ delta: { content: successMsg } }]
              })}\n\ndata: [DONE]\n\n`;
              
              return new Response(sseData, {
                headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
              });
            }
          }
          
          // If image generation failed, inform the user
          const errorMsg = language === 'ar'
            ? 'عذراً، حدث خطأ أثناء إنشاء الصورة. يرجى المحاولة مرة أخرى.'
            : 'Sorry, there was an error generating the image. Please try again.';
          
          const sseData = `data: ${JSON.stringify({
            choices: [{ delta: { content: errorMsg } }]
          })}\n\ndata: [DONE]\n\n`;
          
          return new Response(sseData, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
          
        } catch (imageError) {
          console.error('Image generation error:', imageError);
        }
      }
      
      // If not an image generation request, stream the regular response
      const sseData = `data: ${JSON.stringify({
        choices: [{ delta: { content: aiContent } }]
      })}\n\ndata: [DONE]\n\n`;
      
      return new Response(sseData, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }
    
    // For other agents, use streaming as before
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: message }
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Agent chat error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
