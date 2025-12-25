-- Create enum for provider types
CREATE TYPE public.ai_provider_type AS ENUM ('image', 'video');

-- Create enum for auth types
CREATE TYPE public.ai_auth_type AS ENUM ('api_key', 'oauth');

-- Create enum for connection status
CREATE TYPE public.ai_connection_status AS ENUM ('connected', 'disconnected', 'error');

-- Create enum for asset types
CREATE TYPE public.ai_asset_type AS ENUM ('image', 'video', 'script', 'storyboard');

-- Create ai_provider_connections table
CREATE TABLE public.ai_provider_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider_type ai_provider_type NOT NULL,
  provider_name TEXT NOT NULL,
  auth_type ai_auth_type NOT NULL DEFAULT 'api_key',
  encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  status ai_connection_status NOT NULL DEFAULT 'disconnected',
  default_style TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider_type)
);

-- Enable RLS
ALTER TABLE public.ai_provider_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_provider_connections
CREATE POLICY "Users can view own provider connections"
ON public.ai_provider_connections
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own provider connections"
ON public.ai_provider_connections
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own provider connections"
ON public.ai_provider_connections
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own provider connections"
ON public.ai_provider_connections
FOR DELETE
USING (auth.uid() = user_id);

-- Create generated_assets table
CREATE TABLE public.generated_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  asset_type ai_asset_type NOT NULL,
  provider_name TEXT NOT NULL,
  prompt_used TEXT,
  output_urls TEXT[] DEFAULT '{}',
  aspect_ratio TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generated_assets ENABLE ROW LEVEL SECURITY;

-- RLS policies for generated_assets
CREATE POLICY "Users can view own generated assets"
ON public.generated_assets
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own generated assets"
ON public.generated_assets
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_ai_provider_connections_updated_at
BEFORE UPDATE ON public.ai_provider_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert Image Specialist agent
INSERT INTO public.agents (agent_type, name, name_ar, description, description_ar, icon, is_manager)
VALUES (
  'image',
  'AI Image Specialist',
  'أخصائي الصور الذكي',
  'Generates image assets for posts in multiple formats (1:1, 9:16, Story). Uses your connected Image Provider.',
  'ينشئ أصول الصور للمنشورات بتنسيقات متعددة (1:1، 9:16، ستوري). يستخدم مزود الصور المتصل الخاص بك.',
  'image',
  false
);

-- Insert Video Specialist agent
INSERT INTO public.agents (agent_type, name, name_ar, description, description_ar, icon, is_manager)
VALUES (
  'video',
  'AI Video Specialist',
  'أخصائي الفيديو الذكي',
  'Generates video scripts, storyboards, and short-form videos (9:16 Reels, 16:9 YouTube). Uses your connected Video Provider.',
  'ينشئ نصوص الفيديو والقصص المصورة ومقاطع الفيديو القصيرة (9:16 ريلز، 16:9 يوتيوب). يستخدم مزود الفيديو المتصل الخاص بك.',
  'video',
  false
);