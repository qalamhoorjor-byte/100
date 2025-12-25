-- Add connection status tracking columns to connected_accounts
ALTER TABLE public.connected_accounts 
ADD COLUMN IF NOT EXISTS connection_status text DEFAULT 'pending' CHECK (connection_status IN ('pending', 'verified', 'failed', 'expired')),
ADD COLUMN IF NOT EXISTS last_verified_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS verification_error text;

-- Add index for faster status queries
CREATE INDEX IF NOT EXISTS idx_connected_accounts_status ON public.connected_accounts(connection_status);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform ON public.connected_accounts(user_id, platform);