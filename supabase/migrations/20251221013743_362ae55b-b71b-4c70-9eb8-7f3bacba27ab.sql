-- 1. Fix profiles table - restrict to only viewing own profile (already correct, but let's verify)
-- The current policy "Users can view own profile" with (auth.uid() = id) is correct
-- No changes needed for profiles table

-- 2. Fix system_settings - restrict SELECT to authenticated users only
DROP POLICY IF EXISTS "Anyone can read settings" ON public.system_settings;

CREATE POLICY "Authenticated users can read settings" 
ON public.system_settings 
FOR SELECT 
TO authenticated
USING (true);

-- 3. Add DELETE policy for workflow_results
CREATE POLICY "Users can delete own results" 
ON public.workflow_results 
FOR DELETE 
USING (auth.uid() = user_id);

-- 4. Add DELETE policy for generated_assets (also missing)
CREATE POLICY "Users can delete own generated assets" 
ON public.generated_assets 
FOR DELETE 
USING (auth.uid() = user_id);