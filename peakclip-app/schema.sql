-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor)
-- This is the DEFINITIVE schema for PeakClip

-- Users table: mirrors auth.users with app-level fields
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  credits INTEGER NOT NULL DEFAULT 3,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  subscription_id TEXT,
  subscription_status TEXT DEFAULT 'inactive',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Credit transactions table: tracks all credit movements
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'consume', 'refund', 'free_grant')),
  job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);

-- Clips table: stores generated clips per user
CREATE TABLE IF NOT EXISTS public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  video_url TEXT,
  thumbnail_url TEXT,
  duration NUMERIC,
  start_time NUMERIC,
  end_time NUMERIC,
  transcript JSONB,
  srt_url TEXT,
  subtitles_srt TEXT,
  words_json JSONB,
  subtitle_style JSONB,
  brand_settings JSONB,
  youtube_video_id TEXT,
  youtube_thumbnail TEXT,
  youtube_title TEXT,
  youtube_channel TEXT,
  youtube_duration NUMERIC,
  hook_score INTEGER,
  mood TEXT,
  reason TEXT,
  engagement_factors JSONB,
  retention_prediction INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add YouTube metadata columns
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS youtube_thumbnail TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS youtube_title TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS youtube_channel TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS youtube_duration NUMERIC;

-- Add missing columns if table already existed without them
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS duration NUMERIC;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS start_time NUMERIC;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS end_time NUMERIC;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS transcript JSONB;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS srt_url TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS subtitles_srt TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS words_json JSONB;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS subtitle_style JSONB;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS brand_settings JSONB;

-- Add viral scoring columns
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS hook_score INTEGER;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS mood TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS engagement_factors JSONB;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS retention_prediction INTEGER;

-- Index for fast user-scoped queries
CREATE INDEX IF NOT EXISTS idx_clips_user_id ON public.clips(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_created_at ON public.clips(created_at DESC);

-- Helper: create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, credits, plan)
  VALUES (NEW.id, NEW.email, 3, 'free');

  INSERT INTO public.credit_transactions (user_id, amount, type)
  VALUES (NEW.id, 3, 'free_grant');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: automatically create user profile on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rankings ENABLE ROW LEVEL SECURITY;

-- RLS: users can read their own row, update only safe fields
DROP POLICY IF EXISTS user_read_own ON public.users;
CREATE POLICY user_read_own ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Only password, email, or profile fields can be updated directly — billing fields are server-only
DROP POLICY IF EXISTS user_update_own ON public.users;
CREATE POLICY user_update_own ON public.users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS: credit_transactions — users can only read their own, no client writes
DROP POLICY IF EXISTS ct_select_own ON public.credit_transactions;
CREATE POLICY ct_select_own ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- RLS: clips are scoped to the owning user
DROP POLICY IF EXISTS clips_select_own ON public.clips;
CREATE POLICY clips_select_own ON public.clips
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS clips_insert_own ON public.clips;
CREATE POLICY clips_insert_own ON public.clips
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS clips_update_own ON public.clips;
CREATE POLICY clips_update_own ON public.clips
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS clips_delete_own ON public.clips;
CREATE POLICY clips_delete_own ON public.clips
  FOR DELETE USING (auth.uid() = user_id);

-- RLS: rankings are scoped to the owning user
DROP POLICY IF EXISTS rankings_select_own ON public.rankings;
CREATE POLICY rankings_select_own ON public.rankings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS rankings_insert_own ON public.rankings;
CREATE POLICY rankings_insert_own ON public.rankings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS rankings_update_own ON public.rankings;
CREATE POLICY rankings_update_own ON public.rankings
  FOR UPDATE USING (auth.uid() = user_id);

-- Storage RLS: clips bucket — owner-only access via object path prefix
DROP POLICY IF EXISTS "Users can read their own clips" ON storage.objects;
CREATE POLICY "Users can read their own clips" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'clips' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Users can upload their own clips" ON storage.objects;
CREATE POLICY "Users can upload their own clips" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'clips' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Users can update their own clips" ON storage.objects;
CREATE POLICY "Users can update their own clips" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'clips' AND auth.role() = 'authenticated'
  );
