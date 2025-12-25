-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  RETURN new;
END;
$$;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create agents table (predefined AI agents)
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_ar TEXT,
  description TEXT,
  description_ar TEXT,
  icon TEXT DEFAULT 'bot',
  agent_type TEXT NOT NULL, -- 'seo', 'trend', 'competitor', 'cbm', 'manager'
  is_manager BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Insert default agents
INSERT INTO public.agents (name, name_ar, description, description_ar, agent_type, icon, is_manager) VALUES
  ('AI General Manager', 'مدير الذكاء الاصطناعي', 'Coordinates all agents and produces execution-ready strategies', 'ينسق جميع الوكلاء وينتج استراتيجيات جاهزة للتنفيذ', 'manager', 'crown', true),
  ('AI SEO Agent', 'وكيل SEO', 'Analyzes keywords, search trends, and optimization opportunities', 'يحلل الكلمات المفتاحية واتجاهات البحث وفرص التحسين', 'seo', 'search', false),
  ('AI Trend Agent', 'وكيل الترند', 'Monitors trending topics and viral content opportunities', 'يراقب المواضيع الرائجة وفرص المحتوى الفيروسي', 'trend', 'trending-up', false),
  ('AI Competitor Agent', 'وكيل المنافسين', 'Tracks competitor strategies and market positioning', 'يتتبع استراتيجيات المنافسين ووضع السوق', 'competitor', 'users', false),
  ('AI CBM Agent', 'وكيل CBM', 'Content-based monetization recommendations and strategies', 'توصيات واستراتيجيات تحقيق الدخل القائم على المحتوى', 'cbm', 'dollar-sign', false);

-- Enable public read for agents
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view agents" ON public.agents FOR SELECT USING (true);

-- Create workflows table
CREATE TABLE public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Workflow',
  description TEXT,
  status TEXT DEFAULT 'draft', -- 'draft', 'running', 'completed', 'failed'
  agent_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  last_run_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workflows" ON public.workflows
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own workflows" ON public.workflows
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workflows" ON public.workflows
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workflows" ON public.workflows
  FOR DELETE USING (auth.uid() = user_id);

-- Create workflow results table
CREATE TABLE public.workflow_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES public.agents(id),
  result_type TEXT NOT NULL, -- 'content_plan', 'keywords', 'trends', 'competitors', 'monetization', 'summary'
  content JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.workflow_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own results" ON public.workflow_results
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own results" ON public.workflow_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();