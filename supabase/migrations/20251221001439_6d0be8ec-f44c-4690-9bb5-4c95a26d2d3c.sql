-- Create content_pages table for admin content management
CREATE TABLE public.content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'ar')),
  title text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta_title text,
  meta_description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE(slug, language)
);

-- Create content_revisions table for version history
CREATE TABLE public.content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.content_pages(id) ON DELETE CASCADE,
  title text NOT NULL,
  content jsonb NOT NULL,
  meta_title text,
  meta_description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.content_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_revisions ENABLE ROW LEVEL SECURITY;

-- Public can read published pages
CREATE POLICY "Anyone can read published content" 
ON public.content_pages 
FOR SELECT 
USING (status = 'published');

-- Admins can do everything with content_pages
CREATE POLICY "Admins can manage content pages" 
ON public.content_pages 
FOR ALL 
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Admins can read revisions
CREATE POLICY "Admins can read revisions" 
ON public.content_revisions 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'));

-- Admins can create revisions
CREATE POLICY "Admins can create revisions" 
ON public.content_revisions 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Create trigger for updated_at
CREATE TRIGGER update_content_pages_updated_at
BEFORE UPDATE ON public.content_pages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_content_pages_slug_lang ON public.content_pages(slug, language);
CREATE INDEX idx_content_revisions_page_id ON public.content_revisions(page_id);