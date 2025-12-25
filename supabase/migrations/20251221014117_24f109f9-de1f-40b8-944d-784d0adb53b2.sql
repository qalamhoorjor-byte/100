-- Fix notifications INSERT policy to only allow service role (edge functions)
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;

-- Only service role can insert notifications (edge functions use service role key)
-- This prevents any authenticated user from spoofing notifications
CREATE POLICY "Only service role can insert notifications" 
ON public.notifications 
FOR INSERT 
TO service_role
WITH CHECK (true);