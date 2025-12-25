const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PostResultsInput = {
  content: {
    title?: string;
    body: string;
  };
  platforms: {
    telegram?: {
      botToken: string;
      chatId: string;
    };
    discord?: {
      webhookUrl: string;
    };
  };
  metadata?: {
    workflowId?: string;
    source?: string;
  };
};

function buildMessage(content: { title?: string; body: string }) {
  return content.title
    ? `🧠 ${content.title}\n\n${content.body}`
    : content.body;
}

async function sendTelegram(text: string, cfg: { botToken: string; chatId: string }) {
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      text
    })
  });
}

async function sendDiscord(text: string, webhookUrl: string) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: text
    })
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("post-results invoked");
    const input: PostResultsInput = await req.json();

    if (!input?.content?.body) {
      return new Response(
        JSON.stringify({ status: "error", error: "No content to post" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const message = buildMessage(input.content);
    console.log("post-results platforms:", Object.keys(input.platforms || {}));

    const tasks: Promise<unknown>[] = [];

    if (input.platforms?.telegram) {
      tasks.push(sendTelegram(message, input.platforms.telegram));
    }

    if (input.platforms?.discord) {
      tasks.push(sendDiscord(message, input.platforms.discord.webhookUrl));
    }

    await Promise.allSettled(tasks);

    return new Response(
      JSON.stringify({
        status: "ok",
        posted: true,
        platforms: Object.keys(input.platforms || {})
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("Error in post-results:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
