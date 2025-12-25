/**
 * Publish to Telegram Edge Function
 * Sends messages to Telegram channels/groups via Bot API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelegramCredentials {
  bot_token: string;
  chat_id?: string;
  channel_username?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(encryptionKey),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode('lovable-credential-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptCredentials(credentialsData: unknown): Promise<Record<string, unknown>> {
  if (typeof credentialsData === 'object' && credentialsData !== null) {
    return credentialsData as Record<string, unknown>;
  }
  const encryptedData = String(credentialsData);
  if (!encryptedData.startsWith('ENC:')) {
    try { return JSON.parse(encryptedData); } catch { return {}; }
  }
  const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY not set');
  const key = await deriveKey(encryptionKey);
  const combined = Uint8Array.from(atob(encryptedData.slice(4)), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
  return JSON.parse(decoder.decode(plaintext));
}

interface PublishRequest {
  content: string;
  account_id: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disable_notification?: boolean;
  photo_url?: string;
}

async function sendTelegramMessage(
  text: string,
  credentials: TelegramCredentials,
  options: {
    parse_mode?: string;
    disable_notification?: boolean;
    photo_url?: string;
  } = {}
): Promise<any> {
  const { bot_token, chat_id, channel_username } = credentials;
  const target = chat_id || channel_username;

  if (!target) {
    throw new Error('Either chat_id or channel_username is required');
  }

  const baseUrl = `https://api.telegram.org/bot${bot_token}`;

  if (options.photo_url) {
    // Send photo with caption
    const response = await fetch(`${baseUrl}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target,
        photo: options.photo_url,
        caption: text,
        parse_mode: options.parse_mode || 'HTML',
        disable_notification: options.disable_notification || false,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
    }

    return response.json();
  } else {
    // Send text message
    const response = await fetch(`${baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target,
        text: text,
        parse_mode: options.parse_mode || 'HTML',
        disable_notification: options.disable_notification || false,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
    }

    return response.json();
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { 
      content, 
      account_id, 
      parse_mode,
      disable_notification,
      photo_url,
      image_url, // Support both photo_url and image_url
    }: PublishRequest & { image_url?: string } = await req.json();

    // Use image_url if photo_url is not provided (for compatibility with publish-content)
    const finalPhotoUrl = photo_url || image_url;

    console.log('Publishing to Telegram:', { account_id, user: user.id });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Verify account ownership
    const { data: account, error: fetchError } = await supabase
      .from('connected_accounts')
      .select('credentials, metadata, user_id')
      .eq('id', account_id)
      .single();

    if (fetchError || !account) {
      throw new Error('Account not found');
    }

    if (account.user_id !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not own this account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt credentials
    const decryptedCreds = await decryptCredentials(account.credentials);
    console.log('Decrypted credentials keys:', Object.keys(decryptedCreds));
    console.log('Account metadata:', account.metadata);
    
    // Get chat_id from credentials first, then metadata
    let chatId = String(decryptedCreds.chat_id || account.metadata?.chat_id || '').trim();
    let channelUsername = String(decryptedCreds.channel_username || account.metadata?.channel_username || '').trim();
    
    // Also check if the display_name looks like a chat_id (common user mistake)
    const { data: accountDetails } = await supabase
      .from('connected_accounts')
      .select('display_name')
      .eq('id', account_id)
      .single();
    
    // If no chat_id found, try to use display_name if it looks like a chat ID
    if (!chatId && !channelUsername && accountDetails?.display_name) {
      const displayName = accountDetails.display_name;
      if (displayName.startsWith('@') || displayName.startsWith('-100') || /^-?\d+$/.test(displayName)) {
        console.log('Using display_name as chat_id fallback:', displayName);
        if (displayName.startsWith('@')) {
          channelUsername = displayName;
        } else {
          chatId = displayName;
        }
      }
    }
    
    if (!chatId && !channelUsername) {
      console.error('Missing chat_id or channel_username for Telegram account:', account_id);
      console.error('Credentials available:', JSON.stringify(Object.keys(decryptedCreds)));
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'لم يتم العثور على معرف القناة. يرجى حذف الحساب وإعادة ربطه مع إدخال معرف القناة/الدردشة (@mychannel أو -1001234567890)' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Using chat_id:', chatId, 'channel_username:', channelUsername);
    
    const credentials: TelegramCredentials = {
      bot_token: String(decryptedCreds.bot_token || ''),
      chat_id: chatId,
      channel_username: channelUsername,
    };

    const result = await sendTelegramMessage(content, credentials, {
      parse_mode,
      disable_notification,
      photo_url: finalPhotoUrl,
    });

    // Update last_used_at
    await supabase
      .from('connected_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', account_id);

    console.log('Telegram message sent:', result);

    const messageId = result.result?.message_id;

    return new Response(
      JSON.stringify({
        success: true,
        message_id: messageId,
        published_url: credentials.channel_username 
          ? `https://t.me/${credentials.channel_username.replace('@', '')}/${messageId}`
          : null,
        response_data: result,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Telegram publish error:', error);
    
    let errorMessage = 'فشل النشر على Telegram';
    const errorStr = error.message || String(error);
    
    if (errorStr.includes('chat not found')) {
      errorMessage = 'القناة/المجموعة غير موجودة. تأكد من صحة معرف القناة';
    } else if (errorStr.includes('bot is not a member')) {
      errorMessage = 'البوت ليس عضواً في القناة. أضف البوت كمسؤول';
    } else if (errorStr.includes('not enough rights')) {
      errorMessage = 'البوت لا يملك صلاحيات كافية. تأكد من أنه مسؤول';
    } else if (errorStr.includes('CHAT_WRITE_FORBIDDEN')) {
      errorMessage = 'البوت لا يستطيع الكتابة في هذه القناة';
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        error_details: errorStr,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
