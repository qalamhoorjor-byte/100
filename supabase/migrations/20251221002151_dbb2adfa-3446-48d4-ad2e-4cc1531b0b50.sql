-- Create storage bucket for intro video
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('intro-video', 'intro-video', true, 104857600)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for intro video bucket
CREATE POLICY "Anyone can view intro video"
ON storage.objects FOR SELECT
USING (bucket_id = 'intro-video');

CREATE POLICY "Admins can upload intro video"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'intro-video' AND has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update intro video"
ON storage.objects FOR UPDATE
USING (bucket_id = 'intro-video' AND has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete intro video"
ON storage.objects FOR DELETE
USING (bucket_id = 'intro-video' AND has_role(auth.uid(), 'admin'));