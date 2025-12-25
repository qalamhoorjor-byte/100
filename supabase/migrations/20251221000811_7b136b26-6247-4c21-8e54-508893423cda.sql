-- Create storage bucket for media uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-media',
  'post-media',
  true,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
);

-- Create RLS policies for post-media bucket
CREATE POLICY "Users can upload their own media"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'post-media' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own media"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'post-media' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own media"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'post-media' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Public can view post media"
ON storage.objects
FOR SELECT
USING (bucket_id = 'post-media');

-- Add scheduled_posts table for scheduling
CREATE TABLE public.scheduled_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  short_content TEXT,
  media_urls TEXT[] DEFAULT '{}',
  target_accounts UUID[] DEFAULT '{}',
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'published', 'failed', 'cancelled')),
  publish_result JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on scheduled_posts
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

-- RLS policies for scheduled_posts
CREATE POLICY "Users can view own scheduled posts"
ON public.scheduled_posts
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own scheduled posts"
ON public.scheduled_posts
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scheduled posts"
ON public.scheduled_posts
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scheduled posts"
ON public.scheduled_posts
FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_scheduled_posts_updated_at
BEFORE UPDATE ON public.scheduled_posts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();