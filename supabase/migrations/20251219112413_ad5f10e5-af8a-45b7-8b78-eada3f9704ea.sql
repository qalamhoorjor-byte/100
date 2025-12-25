-- Create connected_accounts table for storing social media credentials
CREATE TABLE public.connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform_type TEXT NOT NULL CHECK (platform_type IN ('social', 'website')),
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_identifier TEXT,
  credentials JSONB NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create posts table for managing content to publish
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  short_content TEXT,
  media_urls TEXT[] DEFAULT '{}',
  target_accounts UUID[] DEFAULT '{}',
  schedule_type TEXT DEFAULT 'immediate' CHECK (schedule_type IN ('immediate', 'scheduled')),
  scheduled_for TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'publishing', 'published', 'partial', 'failed')),
  workflow_result_id UUID REFERENCES public.workflow_results(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create publish_logs table for tracking publishing attempts
CREATE TABLE public.publish_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
  published_url TEXT,
  error_message TEXT,
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for connected_accounts
CREATE POLICY "Users can view own accounts" ON public.connected_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own accounts" ON public.connected_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own accounts" ON public.connected_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own accounts" ON public.connected_accounts FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for posts
CREATE POLICY "Users can view own posts" ON public.posts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for publish_logs
CREATE POLICY "Users can view own logs" ON public.publish_logs FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.posts WHERE posts.id = publish_logs.post_id AND posts.user_id = auth.uid()));
CREATE POLICY "Users can create own logs" ON public.publish_logs FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts WHERE posts.id = publish_logs.post_id AND posts.user_id = auth.uid()));

-- Trigger for updating updated_at
CREATE TRIGGER update_connected_accounts_updated_at
  BEFORE UPDATE ON public.connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_posts_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();