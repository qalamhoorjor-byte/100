-- Create user_onboarding table for storing onboarding progress
CREATE TABLE public.user_onboarding (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  business_type TEXT,
  business_name TEXT,
  website_url TEXT,
  target_keywords TEXT[],
  goals TEXT[],
  industry TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own onboarding" 
ON public.user_onboarding 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own onboarding" 
ON public.user_onboarding 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding" 
ON public.user_onboarding 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create scheduled_workflows table for workflow scheduling
CREATE TABLE public.scheduled_workflows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  schedule_time TIME NOT NULL DEFAULT '09:00',
  schedule_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_workflows ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own schedules" 
ON public.scheduled_workflows 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own schedules" 
ON public.scheduled_workflows 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own schedules" 
ON public.scheduled_workflows 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own schedules" 
ON public.scheduled_workflows 
FOR DELETE 
USING (auth.uid() = user_id);

-- Add business_context column to workflows table
ALTER TABLE public.workflows 
ADD COLUMN IF NOT EXISTS business_context JSONB DEFAULT '{}'::jsonb;

-- Create workflow_templates table
CREATE TABLE public.workflow_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  description TEXT,
  description_ar TEXT,
  category TEXT NOT NULL,
  agent_ids UUID[] DEFAULT '{}',
  business_context JSONB DEFAULT '{}',
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view templates
CREATE POLICY "Anyone can view templates" 
ON public.workflow_templates 
FOR SELECT 
USING (true);

-- Insert default templates
INSERT INTO public.workflow_templates (name, name_ar, description, description_ar, category, is_featured) VALUES
('E-commerce Growth', 'نمو التجارة الإلكترونية', 'Optimize your online store with SEO, trends, and competitor analysis', 'حسّن متجرك الإلكتروني مع SEO والترندات وتحليل المنافسين', 'ecommerce', true),
('Content Creator', 'صانع المحتوى', 'Generate viral content ideas with trend analysis and monetization', 'أنشئ أفكار محتوى فيروسي مع تحليل الترندات والربح', 'content', true),
('SaaS Marketing', 'تسويق SaaS', 'Grow your software business with targeted SEO and competitor insights', 'نمّي شركتك البرمجية مع SEO موجه ورؤى المنافسين', 'saas', true),
('Local Business', 'الأعمال المحلية', 'Boost local visibility with SEO and competitive positioning', 'عزز ظهورك المحلي مع SEO والتموضع التنافسي', 'local', false),
('Blog & Media', 'المدونات والإعلام', 'Create engaging content strategy with trend and SEO focus', 'أنشئ استراتيجية محتوى جذابة مع تركيز على الترندات وSEO', 'media', false);

-- Create trigger for updated_at on new tables
CREATE TRIGGER update_user_onboarding_updated_at
BEFORE UPDATE ON public.user_onboarding
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scheduled_workflows_updated_at
BEFORE UPDATE ON public.scheduled_workflows
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();