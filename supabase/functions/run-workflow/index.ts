import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WorkflowRequest {
  workflowId: string;
  workflowName: string;
  agentTypes: string[];
  language?: 'en' | 'ar';
  generateImages?: boolean;
  generateVideo?: boolean;
}

interface AssetGenerationResult {
  type: 'image' | 'video';
  success: boolean;
  provider: string;
  isNative: boolean;
  data?: any;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { 
      workflowId, 
      workflowName, 
      agentTypes,
      language = 'en',
      generateImages = true,
      generateVideo = true,
    }: WorkflowRequest = await req.json();
    
    console.log("Running workflow:", workflowId, "with agents:", agentTypes, "language:", language);

    // Update workflow status to running
    await supabase
      .from("workflows")
      .update({ status: "running", last_run_at: new Date().toISOString() })
      .eq("id", workflowId);

    const results: Record<string, any> = {};
    const resultIds: string[] = [];
    const assetResults: AssetGenerationResult[] = [];

    // Separate content agents from asset agents
    const contentAgents = agentTypes.filter(a => !['image', 'video'].includes(a));
    const hasImageAgent = agentTypes.includes('image');
    const hasVideoAgent = agentTypes.includes('video');

    // Generate content for each content agent type
    for (const agentType of contentAgents) {
      const prompt = getPromptForAgent(agentType, workflowName, language);
      
      console.log(`Generating content for agent: ${agentType}`);
      
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: getSystemPrompt(agentType, language) },
            { role: "user", content: prompt },
          ],
          tools: [getToolForAgent(agentType)],
          tool_choice: { type: "function", function: { name: getToolName(agentType) } },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again later.");
        }
        if (response.status === 402) {
          throw new Error("AI credits exhausted. Please add more credits.");
        }
        const errorText = await response.text();
        console.error(`AI error for ${agentType}:`, errorText);
        throw new Error(`AI request failed: ${response.status}`);
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      
      if (toolCall?.function?.arguments) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          results[agentType] = parsed;

          // Save result to database and capture the ID
          const { data: insertedResult, error: insertError } = await supabase
            .from("workflow_results")
            .insert({
              workflow_id: workflowId,
              user_id: user.id,
              result_type: agentType,
              content: parsed,
            })
            .select("id")
            .single();

          if (!insertError && insertedResult) {
            resultIds.push(insertedResult.id);
          }
        } catch (e) {
          console.error(`Failed to parse ${agentType} response:`, e);
        }
      }
    }

    // Override generation flags based on agent selection
    const shouldGenerateImages = generateImages && hasImageAgent;
    const shouldGenerateVideo = generateVideo && hasVideoAgent;

    // Generate images if requested (native by default)
    if (shouldGenerateImages) {
      console.log("Generating images for workflow...");
      try {
        const imagePrompt = `Professional marketing visual for: ${workflowName}. Modern, clean, engaging design suitable for social media.`;
        
        const imageResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: imagePrompt,
            aspect_ratios: ['1:1', '9:16'],
            style: 'auto',
            workflow_id: workflowId,
          }),
        });

        const imageData = await imageResponse.json();
        
        if (imageData.success) {
          assetResults.push({
            type: 'image',
            success: true,
            provider: imageData.provider,
            isNative: imageData.is_native,
            data: imageData.images,
          });
          console.log(`Images generated: ${imageData.images?.length || 0} using ${imageData.provider}`);
        } else if (imageData.skipped) {
          assetResults.push({
            type: 'image',
            success: false,
            provider: 'none',
            isNative: false,
            skipped: true,
            skipReason: imageData.message,
          });
        }
      } catch (imgError) {
        console.error("Image generation error:", imgError);
        assetResults.push({
          type: 'image',
          success: false,
          provider: 'none',
          isNative: false,
          error: imgError instanceof Error ? imgError.message : 'Unknown error',
        });
      }
    }

    // Generate video scripts if requested (always native)
    if (shouldGenerateVideo) {
      console.log("Generating video script for workflow...");
      try {
        const videoPrompt = `Create a promotional video script for: ${workflowName}. Focus on value proposition and call to action.`;
        
        const videoResponse = await fetch(`${supabaseUrl}/functions/v1/generate-video`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: videoPrompt,
            aspect_ratio: '9:16',
            video_type: 'promotional',
            workflow_id: workflowId,
            generate_video: false, // Only scripts by default
          }),
        });

        const videoData = await videoResponse.json();
        
        if (videoData.success) {
          assetResults.push({
            type: 'video',
            success: true,
            provider: videoData.provider,
            isNative: videoData.is_native,
            data: {
              script: videoData.script,
              storyboard: videoData.storyboard,
              video_url: videoData.video_url,
            },
            skipped: videoData.video_skipped,
            skipReason: videoData.video_skip_reason,
          });
          console.log(`Video script generated using ${videoData.provider}`);
        }
      } catch (vidError) {
        console.error("Video generation error:", vidError);
        assetResults.push({
          type: 'video',
          success: false,
          provider: 'none',
          isNative: false,
          error: vidError instanceof Error ? vidError.message : 'Unknown error',
        });
      }
    }

    // Update workflow status to completed
    await supabase
      .from("workflows")
      .update({ status: "completed" })
      .eq("id", workflowId);

    // Create notification for workflow completion
    const assetSummary = assetResults.map(a => {
      if (a.success) {
        return `${a.type === 'image' ? '🖼️' : '🎬'} ${a.type} (${a.isNative ? 'Native AI' : a.provider})`;
      }
      return `${a.type} skipped`;
    }).join(', ');

    try {
      await fetch(`${supabaseUrl}/functions/v1/create-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          type: 'workflow_completed',
          title: 'Workflow Completed',
          message: `"${workflowName}" finished successfully. Generated: ${assetSummary}`,
          metadata: { workflowId, assetResults },
        }),
      });
    } catch (notifError) {
      console.error("Notification error:", notifError);
    }

    console.log("Workflow completed successfully with result IDs:", resultIds);

    return new Response(
      JSON.stringify({ 
        success: true, 
        workflowId,
        resultIds,
        results,
        assets: assetResults,
        summary: {
          agentsRun: agentTypes.length,
          imagesGenerated: assetResults.find(a => a.type === 'image' && a.success)?.data?.length || 0,
          videoScriptGenerated: assetResults.some(a => a.type === 'video' && a.success),
          allNative: assetResults.every(a => a.isNative),
        },
      }), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Workflow execution error:", error);
    // Map known errors to safe messages, sanitize unknown errors
    let safeMessage = 'Workflow execution failed. Please try again.';
    if (error instanceof Error) {
      if (error.message.includes('Rate limit')) {
        safeMessage = 'Rate limit exceeded. Please try again later.';
      } else if (error.message.includes('credits')) {
        safeMessage = 'AI credits exhausted. Please add more credits.';
      } else if (error.message.includes('LOVABLE_API_KEY')) {
        safeMessage = 'AI service configuration error. Please contact support.';
      }
    }
    return new Response(
      JSON.stringify({ error: safeMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getSystemPrompt(agentType: string, language: string = 'en'): string {
  const langInstruction = language === 'ar' 
    ? "IMPORTANT: You MUST respond entirely in Arabic. All text, analysis, and recommendations must be in Arabic language."
    : "Respond in English.";
  
  const prompts: Record<string, string> = {
    seo: `You are an expert SEO analyst. Provide detailed keyword research and SEO recommendations based on current best practices. ${langInstruction}`,
    trend: `You are a trends analyst specializing in digital marketing. Identify trending topics and viral content opportunities. ${langInstruction}`,
    competitor: `You are a competitive intelligence analyst. Analyze competitor strategies and identify market opportunities. ${langInstruction}`,
    cbm: `You are a content monetization expert. Provide actionable recommendations for content-based revenue generation. ${langInstruction}`,
    manager: `You are an AI General Manager. Synthesize insights from all agents and create a comprehensive execution strategy. ${langInstruction}`,
  };
  return prompts[agentType] || prompts.manager;
}

function getPromptForAgent(agentType: string, workflowName: string, language: string = 'en'): string {
  const langNote = language === 'ar' 
    ? "تأكد من أن جميع المحتوى باللغة العربية." 
    : "";
    
  const prompts: Record<string, string> = {
    seo: `Analyze keyword opportunities and SEO strategy for a business focused on "${workflowName}". Provide specific, actionable keyword recommendations with search volumes and difficulty estimates. ${langNote}`,
    trend: `Identify current trending topics and viral content opportunities relevant to "${workflowName}". Focus on trends from the past week with growth metrics. ${langNote}`,
    competitor: `Analyze the competitive landscape for "${workflowName}". Identify key competitors, their strengths, and gaps we can exploit. ${langNote}`,
    cbm: `Provide content monetization recommendations for "${workflowName}". Include specific strategies for revenue generation through content. ${langNote}`,
    manager: `Create a comprehensive daily content and marketing strategy for "${workflowName}". Synthesize SEO, trends, competitive insights, and monetization opportunities into an actionable plan. ${langNote}`,
  };
  return prompts[agentType] || prompts.manager;
}

function getToolName(agentType: string): string {
  const names: Record<string, string> = {
    seo: "generate_seo_analysis",
    trend: "generate_trend_analysis",
    competitor: "generate_competitor_analysis",
    cbm: "generate_monetization_plan",
    manager: "generate_content_plan",
  };
  return names[agentType] || "generate_content_plan";
}

function getToolForAgent(agentType: string) {
  const tools: Record<string, any> = {
    seo: {
      type: "function",
      function: {
        name: "generate_seo_analysis",
        description: "Generate SEO keyword analysis and recommendations",
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  keyword: { type: "string" },
                  volume: { type: "number" },
                  difficulty: { type: "string", enum: ["Low", "Medium", "High"] },
                  intent: { type: "string" },
                },
                required: ["keyword", "volume", "difficulty"],
              },
            },
            recommendations: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["keywords", "recommendations"],
        },
      },
    },
    trend: {
      type: "function",
      function: {
        name: "generate_trend_analysis",
        description: "Generate trending topics analysis",
        parameters: {
          type: "object",
          properties: {
            trends: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  growth: { type: "string" },
                  relevance: { type: "string" },
                  action: { type: "string" },
                },
                required: ["topic", "growth", "relevance"],
              },
            },
          },
          required: ["trends"],
        },
      },
    },
    competitor: {
      type: "function",
      function: {
        name: "generate_competitor_analysis",
        description: "Generate competitive analysis",
        parameters: {
          type: "object",
          properties: {
            competitors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  strength: { type: "string" },
                  weakness: { type: "string" },
                  opportunity: { type: "string" },
                },
                required: ["name", "strength", "weakness"],
              },
            },
            marketGaps: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["competitors"],
        },
      },
    },
    cbm: {
      type: "function",
      function: {
        name: "generate_monetization_plan",
        description: "Generate content monetization recommendations",
        parameters: {
          type: "object",
          properties: {
            strategies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  strategy: { type: "string" },
                  potential: { type: "string", enum: ["Low", "Medium", "High"] },
                  implementation: { type: "string" },
                  timeline: { type: "string" },
                },
                required: ["strategy", "potential", "implementation"],
              },
            },
          },
          required: ["strategies"],
        },
      },
    },
    manager: {
      type: "function",
      function: {
        name: "generate_content_plan",
        description: "Generate comprehensive content strategy plan",
        parameters: {
          type: "object",
          properties: {
            contentPlan: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  type: { type: "string" },
                  priority: { type: "string", enum: ["Low", "Medium", "High"] },
                  deadline: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "type", "priority"],
              },
            },
            summary: { type: "string" },
          },
          required: ["contentPlan", "summary"],
        },
      },
    },
  };
  return tools[agentType] || tools.manager;
}
