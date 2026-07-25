from dotenv import load_dotenv
load_dotenv()
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Depends, Header, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from typing import Any
from pydantic import BaseModel
from supabase import create_client
import os
import glob

import yt_dlp
import openai
try:
    from groq import Groq
except ImportError:
    Groq = None
import subprocess
import uuid
import json
import stripe
import tempfile
import re
import time
import httpx
import sys
import asyncio
import traceback
import base64
import shutil
import concurrent.futures
import threading
from collections import defaultdict
from urllib.parse import urlparse
import jwt as pyjwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from contextlib import asynccontextmanager

# Set at startup if the bgutil PO token server is reachable
BGUTIL_POT_AVAILABLE = False

def extract_youtube_id(url: str) -> str | None:
    if not url:
        return None
    patterns = [
        r'(?:youtube\.com/watch\?.*v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


def get_best_yt_thumbnail(yt_id: str) -> str | None:
    urls = [
        f"https://img.youtube.com/vi/{yt_id}/maxresdefault.jpg",
        f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg",
        f"https://img.youtube.com/vi/{yt_id}/mqdefault.jpg",
        f"https://img.youtube.com/vi/{yt_id}/default.jpg",
    ]
    for url in urls:
        try:
            r = httpx.head(url, timeout=5)
            if r.status_code == 200:
                return url
        except Exception:
            continue
    return None


def fetch_youtube_metadata(url: str) -> dict | None:
    yt_id = extract_youtube_id(url)
    if not yt_id:
        return None
    meta = {
        "youtube_video_id": yt_id,
        "youtube_title": None,
        "youtube_channel": None,
        "youtube_duration": None,
        "youtube_thumbnail": None,
    }
    try:
        ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            meta["youtube_title"] = info.get("title")
            meta["youtube_channel"] = info.get("channel") or info.get("uploader")
            meta["youtube_duration"] = info.get("duration")
    except Exception:
        pass
    best_thumb = get_best_yt_thumbnail(yt_id)
    if best_thumb:
        meta["youtube_thumbnail"] = best_thumb
    return meta


# ── OAuth2 auto-refresh ───────────────────────────────────────
YOUTUBE_OAUTH_CLIENT_ID = os.environ.get("YOUTUBE_OAUTH_CLIENT_ID", "")
YOUTUBE_OAUTH_CLIENT_SECRET = os.environ.get("YOUTUBE_OAUTH_CLIENT_SECRET", "")

OAUTH_TOKEN_CACHE_DIR = os.path.expanduser('~/.cache/yt-dlp')
OAUTH_TOKEN_PATH = os.path.join(OAUTH_TOKEN_CACHE_DIR, 'youtube_oauth2.json')


def setup_oauth2_tokens() -> str | None:
    """Load tokens from YOUTUBE_OAUTH_TOKENS_B64 env var and write to disk."""
    oauth_b64 = os.environ.get('YOUTUBE_OAUTH_TOKENS_B64', '').strip()
    if not oauth_b64:
        print("OAUTH: no YOUTUBE_OAUTH_TOKENS_B64 env var — OAuth2 disabled")
        return None
    try:
        data = base64.b64decode(oauth_b64).decode('utf-8')
        os.makedirs(OAUTH_TOKEN_CACHE_DIR, exist_ok=True)
        with open(OAUTH_TOKEN_PATH, 'w', encoding='utf-8') as f:
            f.write(data)
        print(f"OAUTH: tokens written to {OAUTH_TOKEN_PATH} ({len(data)} bytes)")
        return OAUTH_TOKEN_PATH
    except Exception as e:
        print(f"OAUTH: failed to load tokens from env: {e}")
        return None


def refresh_oauth2_tokens(token_path: str | None = None) -> bool:
    """Refresh the access_token using the refresh_token.

    Returns True on success, False if a full re-auth is needed.
    """
    path = token_path or OAUTH_TOKEN_PATH
    if not path or not os.path.exists(path):
        print("OAUTH REFRESH: token file not found")
        return False
    try:
        with open(path, 'r') as f:
            tokens = json.load(f)
    except Exception as e:
        print(f"OAUTH REFRESH: failed to read tokens: {e}")
        return False

    refresh_token = tokens.get('refresh_token')
    if not refresh_token:
        print("OAUTH REFRESH: no refresh_token in file, need full re-auth")
        return False

    print("OAUTH REFRESH: requesting new access_token...")
    try:
        import urllib.request, urllib.parse
        data = urllib.parse.urlencode({
            'client_id': YOUTUBE_OAUTH_CLIENT_ID,
            'client_secret': YOUTUBE_OAUTH_CLIENT_SECRET,
            'refresh_token': refresh_token,
            'grant_type': 'refresh_token',
        }).encode()
        req = urllib.request.Request(
            'https://oauth2.googleapis.com/token',
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        resp = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    except Exception as e:
        print(f"OAUTH REFRESH: HTTP error: {e}")
        return False

    if 'access_token' not in resp:
        print(f"OAUTH REFRESH: unexpected response: {resp.get('error', 'unknown')}")
        return False

    tokens['access_token'] = resp['access_token']
    tokens['expires'] = time.time() + resp.get('expires_in', 3600)
    if 'refresh_token' in resp:
        tokens['refresh_token'] = resp['refresh_token']

    try:
        with open(path, 'w') as f:
            json.dump(tokens, f, indent=2)
        print(f"OAUTH REFRESH: access_token refreshed, expires in {resp.get('expires_in', 3600)}s")
        return True
    except Exception as e:
        print(f"OAUTH REFRESH: failed to write updated tokens: {e}")
        return False


def is_oauth_token_expired(token_path: str | None = None) -> bool:
    """Check if the access_token is expired or will expire within 5 min."""
    path = token_path or OAUTH_TOKEN_PATH
    if not path or not os.path.exists(path):
        return True
    try:
        with open(path, 'r') as f:
            tokens = json.load(f)
        expires = tokens.get('expires', 0)
        return time.time() > (expires - 300)
    except Exception:
        return True


def ensure_valid_oauth_token() -> str | None:
    """Check expiry, refresh if needed, fall back to env reload on failure.

    Returns the token file path if valid, None otherwise.
    """
    if not os.path.exists(OAUTH_TOKEN_PATH):
        setup_oauth2_tokens()

    if os.path.exists(OAUTH_TOKEN_PATH) and is_oauth_token_expired():
        print("OAUTH: token expired, attempting refresh...")
        if not refresh_oauth2_tokens():
            print("OAUTH: refresh failed, reloading from env var...")
            setup_oauth2_tokens()

    return OAUTH_TOKEN_PATH if os.path.exists(OAUTH_TOKEN_PATH) else None


async def oauth_token_monitor():
    """Background task: check OAuth2 token file every 30 minutes."""
    print("OAUTH MONITOR: started (interval=1800s)")
    while True:
        try:
            await asyncio.sleep(1800)
            if os.path.exists(OAUTH_TOKEN_PATH):
                size = os.path.getsize(OAUTH_TOKEN_PATH)
                print(f"OAUTH MONITOR: token OK ({size} bytes)")
            else:
                print("OAUTH MONITOR: no token file found")
        except Exception as e:
            print(f"OAUTH MONITOR: error: {e}")

# ────────────────────────────────────────────────────────────────

# ── Cookie support ────────────────────────────────────────────
COOKIES_PATH = '/tmp/yt-cookies.txt'

def setup_cookies() -> str | None:
    """Load cookies from YOUTUBE_COOKIES_B64 env var (Netscape format) and write to disk.

    Export cookies from your browser using a browser extension, base64-encode the
    file, and set it as the YOUTUBE_COOKIES_B64 env var on Railway.
    """
    cookies_b64 = os.environ.get('YOUTUBE_COOKIES_B64', '').strip()
    if not cookies_b64:
        return None
    try:
        data = base64.b64decode(cookies_b64).decode('utf-8')
        if 'youtube.com' not in data.lower() and '.google.com' not in data.lower():
            print(f"COOKIES: WARNING — decoded data does not appear to contain YouTube cookies")
        os.makedirs(OAUTH_TOKEN_CACHE_DIR, exist_ok=True)
        with open(COOKIES_PATH, 'w', encoding='utf-8') as f:
            f.write(data)
        print(f"COOKIES: written to {COOKIES_PATH} ({len(data)} bytes)")
        return COOKIES_PATH
    except Exception as e:
        print(f"COOKIES: failed to load from env: {e}")
        return None


def upload_with_verification(supabase, bucket, file_path, storage_path, content_type):
    """Upload a file to Supabase Storage via direct HTTP PUT and verify it."""
    try:
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        service_key = os.getenv("SUPABASE_SERVICE_KEY", "")
        print(f"UPLOAD: starting {bucket}/{storage_path} ({file_size} bytes)")
        if not supabase_url or not service_key:
            print(f"UPLOAD: missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
            return None
        # Read file
        with open(file_path, 'rb') as f:
            file_bytes = f.read()
        print(f"UPLOAD: read {len(file_bytes)} bytes")
        # Upload via direct HTTP PUT (bypasses supabase-py)
        put_url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
        headers = {
            "Authorization": f"Bearer {service_key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        }
        try:
            resp = httpx.put(put_url, content=file_bytes, headers=headers, timeout=120)
            print(f"UPLOAD: PUT {put_url} -> {resp.status_code}")
            if resp.status_code not in (200, 201):
                print(f"UPLOAD: PUT failed: {resp.text[:500]}")
                # Try with upsert=false
                headers.pop("x-upsert", None)
                resp2 = httpx.put(put_url, content=file_bytes, headers=headers, timeout=120)
                print(f"UPLOAD: PUT (no upsert) {put_url} -> {resp2.status_code}")
                if resp2.status_code not in (200, 201):
                    print(f"UPLOAD: PUT (no upsert) failed: {resp2.text[:500]}")
                    return None
        except Exception as e:
            print(f"UPLOAD: PUT exception: {type(e).__name__}: {e}")
            return None

        # Generate signed URL (bucket is private)
        try:
            signed = supabase.storage.from_(bucket).create_signed_url(storage_path, 86400)
            if signed and signed.get("signedURL"):
                print(f"UPLOAD: signed URL generated (24h)")
                return signed["signedURL"]
        except Exception as e:
            print(f"UPLOAD: signed URL error: {e}")
        # Fallback: store object path so caller can generate a signed URL on-demand
        return storage_path
    except Exception as e:
        print(f"UPLOAD: outer error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return None


def ensure_fonts():
    import httpx as _httpx
    FONT_DIR = "/usr/share/fonts/truetype"
    # Remove old broken font files (HTML error pages from broken URLs)
    for olddir in ("google-fonts",):
        oldpath = os.path.join(FONT_DIR, olddir)
        if os.path.isdir(oldpath):
            import shutil
            shutil.rmtree(oldpath, ignore_errors=True)
            print(f"[FONTS] removed broken directory: {oldpath}")
    # Static TTF from Google Fonts CDN (NOT variable fonts — libass cannot resolve
    # weight instances from variable fonts, always falling back to Regular).
    STATIC_FONTS = [
        # Montserrat
        ("Montserrat-Regular.ttf",   "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf"),
        ("Montserrat-Bold.ttf",      "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf"),
        ("Montserrat-ExtraBold.ttf", "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCvr70w-.ttf"),
        ("Montserrat-Medium.ttf",    "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCt1H6Ew-.ttf"),
        ("Montserrat-SemiBold.ttf",  "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuV76Ew-.ttf"),
        # Inter
        ("Inter-Regular.ttf",        "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf"),
        ("Inter-Bold.ttf",           "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf"),
        ("Inter-ExtraBold.ttf",      "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuDyYMZg.ttf"),
    ]
    for fname, url in STATIC_FONTS:
        dest = os.path.join(FONT_DIR, fname)
        try:
            r = _httpx.get(url, follow_redirects=True, timeout=60)
            if r.status_code == 200 and len(r.content) > 10000:
                with open(dest, 'wb') as f:
                    f.write(r.content)
                print(f"[FONTS] downloaded {fname} ({len(r.content)} bytes)")
            else:
                print(f"[FONTS] FAILED {fname}: HTTP {r.status_code}, len={len(r.content)}")
        except Exception as e:
            print(f"[FONTS] ERROR {fname}: {e}")
    try:
        subprocess.run(["fc-cache", "-f"], capture_output=True, timeout=30)
        print("[FONTS] fc-cache done")
    except Exception as e:
        print(f"[FONTS] fc-cache error: {e}")

async def lifespan(app: FastAPI):
    # Startup
    ensure_fonts()
    print(f"yt-dlp version: {yt_dlp.version.__version__}")
    # Remove stale cookies that yt-dlp auto-discovers from its cache dir.
    # We write cookies to /tmp/yt-cookies.txt instead (COOKIES_PATH),
    # and only pass them explicitly via cookiefile when needed.
    for _cf in ('cookies.txt', os.path.expanduser('~/.cache/yt-dlp/cookies.txt')):
        try:
            if os.path.exists(_cf):
                os.remove(_cf)
                print(f"COOKIES: removed stale {_cf}")
        except Exception:
            pass
    setup_cookies()

    # OAuth2 via yt-dlp is deprecated by YouTube — don't start monitor
    # if not used for downloads anymore.
    await run_migrations()
    await fetch_jwks()
    # Check if bgutil PO token server is reachable (started by Dockerfile CMD)
    global BGUTIL_POT_AVAILABLE
    try:
        import httpx
        r = httpx.get('http://127.0.0.1:4416/ping', timeout=5)
        if r.status_code == 200:
            BGUTIL_POT_AVAILABLE = True
            print(f"POT SERVER: available ({r.json()})")
        else:
            print(f"POT SERVER: unexpected status {r.status_code}")
    except Exception as e:
        print(f"POT SERVER: not available ({e})")

    # ── Log auth status clearly ──
    auth_methods = []
    if os.environ.get('YOUTUBE_PROXY'):
        auth_methods.append("Proxy (primary)")
    if os.path.exists(COOKIES_PATH):
        auth_methods.append(f"Cookies (fallback, attempt 4+)")
    if BGUTIL_POT_AVAILABLE:
        auth_methods.append("BGutil PO Token (fallback)")
    if os.environ.get('YOUTUBE_PO_TOKEN'):
        auth_methods.append("Static PO Token (fallback)")
    if auth_methods:
        print(f"AUTH: available methods: {', '.join(auth_methods)}")
        print("AUTH: download strategy: all attempts use proxy+cookies, android-first strategies")
    else:
        print("AUTH: WARNING — NO authentication methods configured!")
        print("AUTH: YouTube will likely block downloads or return 360p only.")
        print("AUTH: Configure at least one of: YOUTUBE_COOKIES_B64, YOUTUBE_PROXY")
    yield
    # Shutdown (nothing to do)

app = FastAPI(lifespan=lifespan)

async def run_migrations():
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not supabase_url or not service_key:
        print("MIGRATION SKIPPED: missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
        return
    project_ref = supabase_url.split("https://")[1].split(".")[0]

    # Check if credit_transactions table exists via REST API
    ct_exists = False
    try:
        supabase.table("credit_transactions").select("id").limit(1).execute()
        ct_exists = True
    except Exception:
        pass

    if not ct_exists:
        sql = """
            CREATE TABLE IF NOT EXISTS public.credit_transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('purchase', 'consume', 'refund')),
                job_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id
                ON public.credit_transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at
                ON public.credit_transactions(created_at DESC);

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
        """
        sql_success = False
        sql_errors = []
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": sql}, headers=headers)
                    if res.status_code == 200:
                        print(f"SQL MIGRATION OK via {url.split('/')[-1]}")
                        sql_success = True
                        break
                    sql_errors.append(f"{url.split('/')[-1]}: {res.status_code} {res.text[:100]}")
                except Exception as e:
                    sql_errors.append(f"{url.split('/')[-1]}: {e}")
        if not sql_success:
            print("⚠️ CREDIT_TRANSACTIONS TABLE MISSING — DDL not available via API")
            for err in sql_errors:
                print(f"   {err}")
            print("   To fix: open supabase dashboard > SQL editor and run peakclip-app/schema.sql")
    else:
        print("SQL MIGRATION: credit_transactions table already exists (OK)")

    # Ensure stripe_customer_id column exists on users table
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            alter_sql = "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;"
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": alter_sql}, headers=headers)
                    if res.status_code == 200:
                        print(f"COLUMN MIGRATION: stripe_customer_id added (OK)")
                        break
                except Exception:
                    pass
    except Exception as e:
        print(f"COLUMN MIGRATION error: {e}")

    # Ensure subscription columns exist on users table
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            alter_sql = """ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;"""
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": alter_sql}, headers=headers)
                    if res.status_code == 200:
                        print(f"COLUMN MIGRATION: subscription columns added (OK)")
                        break
                except Exception:
                    pass
    except Exception as e:
        print(f"COLUMN MIGRATION subscription error: {e}")

    # Add start_time / end_time / transcript / srt_url / subtitles_srt / words_json columns
    try:
        supabase.table("clips").select("start_time,end_time,transcript,srt_url,subtitles_srt,words_json").limit(1).execute()
        print("SQL MIGRATION: columns already exist (OK)")
    except Exception:
        async with httpx.AsyncClient(timeout=15) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            alter_sql = "ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS start_time NUMERIC; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS end_time NUMERIC; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS transcript JSONB; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS srt_url TEXT; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS subtitles_srt TEXT; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS words_json JSONB;"
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": alter_sql}, headers=headers)
                    if res.status_code == 200:
                        print("SQL MIGRATION: added columns (OK)")
                        # Refresh PostgREST schema cache so columns are visible immediately
                        try:
                            await client.post(url, json={"query": "NOTIFY pgrst, 'reload schema'"}, headers=headers)
                            print("SQL MIGRATION: schema cache reloaded")
                        except Exception:
                            pass
                        break
                except Exception:
                    pass

    # Ensure credit_transactions type constraint includes free_grant
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            alter_ct_sql = "ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check; ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_type_check CHECK (type IN ('purchase', 'consume', 'refund', 'free_grant'));"
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": alter_ct_sql}, headers=headers)
                    if res.status_code == 200:
                        print(f"SQL MIGRATION: credit_transactions type constraint updated (OK)")
                        break
                except Exception:
                    pass
    except Exception as e:
        print(f"SQL MIGRATION credit_transactions constraint error: {e}")

    # Add hook_score / mood / reason columns to clips table
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            alter_clips_sql = "ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS hook_score INTEGER; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS mood TEXT; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS reason TEXT; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS engagement_factors JSONB; ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS retention_prediction INTEGER;"
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": alter_clips_sql}, headers=headers)
                    if res.status_code == 200:
                        print("SQL MIGRATION: added hook_score/mood/reason columns (OK)")
                        try:
                            await client.post(url, json={"query": "NOTIFY pgrst, 'reload schema'"}, headers=headers)
                        except Exception:
                            pass
                        break
                except Exception:
                    pass
    except Exception as e:
        print(f"SQL MIGRATION hook_score/mood/reason error: {e}")

    # Create rankings table if it doesn't exist
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            }
            rankings_sql = """
CREATE TABLE IF NOT EXISTS public.rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  count INTEGER DEFAULT 5,
  video_length INTEGER DEFAULT 30,
  status TEXT DEFAULT 'processing',
  results JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rankings_user_id ON public.rankings(user_id);
CREATE INDEX IF NOT EXISTS idx_rankings_created_at ON public.rankings(created_at DESC);
"""
            for url in [
                f"https://{project_ref}.supabase.co/sql/v1/query",
                f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            ]:
                try:
                    res = await client.post(url, json={"query": rankings_sql}, headers=headers)
                    if res.status_code == 200:
                        print("SQL MIGRATION: rankings table created (OK)")
                        try:
                            await client.post(url, json={"query": "NOTIFY pgrst, 'reload schema'"}, headers=headers)
                        except Exception:
                            pass
                        break
                except Exception:
                    pass
    except Exception as e:
        print(f"SQL MIGRATION rankings table error: {e}")

    # Ensure 'clips' storage bucket exists and is private
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            update_res = await client.put(
                f"https://{project_ref}.supabase.co/storage/v1/bucket/clips",
                json={"public": False},
                headers={"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"},
            )
            if update_res.status_code in (200, 201, 204):
                print("STORAGE BUCKET 'clips' is private (OK)")
            elif update_res.status_code == 400:
                create_res = await client.post(
                    f"https://{project_ref}.supabase.co/storage/v1/bucket",
                    json={"id": "clips", "name": "clips", "public": False, "file_size_limit": 524288000, "allowed_mime_types": ["video/mp4", "video/webm", "video/quicktime", "image/jpeg", "image/png", "text/plain", "application/json"]},
                    headers={"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"},
                )
                if create_res.status_code in (200, 201):
                    print("STORAGE BUCKET 'clips' created (OK)")
                else:
                    print(f"STORAGE BUCKET create: {create_res.status_code} {create_res.text[:200]}")
            else:
                print(f"STORAGE BUCKET update: {update_res.status_code} {update_res.text[:200]}")
    except Exception as e:
        print(f"STORAGE BUCKET error: {e}")

# In-memory rate limiter
rate_store = defaultdict(list)
rate_lock = asyncio.Lock()
RATE_LIMIT = 10
RATE_WINDOW = 60

async def check_rate_limit(key: str):
    async with rate_lock:
        now = time.time()
        window_start = now - RATE_WINDOW
        rate_store[key] = [t for t in rate_store[key] if t > window_start]
        if len(rate_store[key]) >= RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")
        rate_store[key].append(now)

# In-memory job store for status tracking
jobs_store: dict = {}

FRONTEND_URL = os.getenv("FRONTEND_URL", "")
ALLOWED_ORIGINS = [o.strip() for o in FRONTEND_URL.split(",") if o.strip()] or [
    "http://localhost:3000",
    "https://peakclip-studio.vercel.app"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(openai.RateLimitError)
async def openai_rate_limit_handler(request: Request, exc: openai.RateLimitError):
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
    print(f"[ERROR] OpenAI quota exceeded: {exc}")
    return JSONResponse(
        status_code=429,
        content={"detail": "La clave de OpenAI se qued\u00f3 sin cr\u00e9dito. Av\u00edsale al admin para que la recargue."},
        headers=headers,
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
    traceback.print_exception(type(exc), exc, exc.__traceback__)
    print(f"[ERROR] {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {type(exc).__name__}: {str(exc)[:200]}"},
        headers=headers,
    )

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {request.method} {request.url.path} -> {response.status_code} ({elapsed:.2f}s)")
    return response


os.makedirs("downloads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)
os.makedirs("thumbnails", exist_ok=True)

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY")
)

client = openai.OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    timeout=300.0,
    max_retries=2
)
groq_api_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=groq_api_key) if groq_api_key and Groq else None
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_PRICE_CREATOR = os.getenv("STRIPE_PRICE_CREATOR", "price_creator")
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO", "price_pro")

# JWT verification
supabase_url = os.getenv("SUPABASE_URL")
_jwks_keys = []

async def fetch_jwks():
    global _jwks_keys
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{supabase_url}/auth/v1/.well-known/jwks.json")
            if r.status_code == 200:
                _jwks_keys = r.json().get("keys", [])
                print(f"JWKS loaded: {len(_jwks_keys)} keys")
            else:
                print(f"JWKS fetch failed: {r.status_code}")
    except Exception as e:
        print(f"JWKS fetch error: {e}")

async def get_current_user(authorization: str = Header(...)):
    import base64
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = authorization.replace("Bearer ", "").strip()
    if not token or token == "null":
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        header = pyjwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Invalid token (no kid)")
    jwk = next((k for k in _jwks_keys if k.get("kid") == kid), None)
    if not jwk:
        raise HTTPException(status_code=401, detail=f"Invalid token (unknown kid: {kid})")
    try:
        from base64 import urlsafe_b64decode
        x = urlsafe_b64decode(jwk["x"] + "==")
        y = urlsafe_b64decode(jwk["y"] + "==")
        pub_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b"\x04" + x + y)
        pem = pub_key.public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo
        )
        payload = pyjwt.decode(
            token,
            pem,
            algorithms=[jwk.get("alg", "ES256")],
            options={"verify_exp": True, "verify_aud": False}
        )
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {type(e).__name__}: {e}")


class VideoRequest(BaseModel):
    url: str


class ExportRequest(BaseModel):
    clip_id: str
    video_url: str
    trim_start: float = 0
    trim_end: float = 100
    subtitle_text: str = ""
    subtitle_style: str = "bold-yellow"
    subtitle_position: str = "bottom"
    font_size: int = 14
    subtitle_style_obj: dict = {}
    subtitle_words: list[dict[str, Any]] = []
    subtitle_mode: str = "phrase"
    watermark_text: str = ""
    watermark_position: str = "top-right"
    music_track: str = "none"
    music_volume: int = 30
    filter_style: str = "none"
    resolution: str = "1080p"
    format: str = "mp4"
    fps: int = 30


@app.get("/")
def root():
    return {"status": "PeakClip API running"}


@app.get("/health")
def health():
    return {
        "status": "PeakClip API running",
        "jwks_keys": len(_jwks_keys),
        "jwks_loaded": len(_jwks_keys) > 0,
    }


@app.get("/debug")
def debug():
    import shutil
    ffmpeg_path = shutil.which("ffmpeg")
    pot_status = "unknown"
    try:
        import httpx
        r = httpx.get('http://127.0.0.1:4416/ping', timeout=3)
        pot_status = "available" if r.status_code == 200 else f"status_{r.status_code}"
    except Exception as e:
        pot_status = f"unavailable: {e}"
    return {
        "ffmpeg": ffmpeg_path or "NOT FOUND",
        "yt_dlp": True,
        "bgutil_pot_server": pot_status,
    }


def generate_thumbnail(video_path, output_path, timestamp=5):
    subprocess.run([
        'ffmpeg', '-ss', str(timestamp), '-i', video_path,
        '-vframes', '1', '-vf', 'scale=540:960',
        output_path, '-y'
    ], capture_output=True)


def dedent_credits(user_id):
    """Decrement credits with optimistic locking to avoid race conditions."""
    for attempt in range(3):
        result = supabase.table("users").select("credits").eq("id", user_id).execute()
        if not result.data or result.data[0]["credits"] <= 0:
            return 0
        old_credits = result.data[0]["credits"]
        new_credits = old_credits - 1
        update = supabase.table("users").update({"credits": new_credits}).eq("id", user_id).eq("credits", old_credits).execute()
        if update.data:
            try:
                supabase.table("credit_transactions").insert({
                    "user_id": user_id,
                    "amount": -1,
                    "type": "consume",
                }).execute()
            except Exception as e:
                print(f"credit_transactions insert failed (non-fatal): {e}")
            return new_credits
        # Race: credits changed between read and write, retry
    return 0


def validate_video_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise HTTPException(status_code=400, detail="URL must use http or https")
    hostname = parsed.hostname or ""
    # Block private/reserved IPs and internal hostnames
    private_patterns = [
        r"^localhost$", r"^127\.", r"^10\.", r"^172\.(1[6-9]|2\d|3[01])\.",
        r"^192\.168\.", r"^0\.0\.0\.0$", r"^::1$", r"^metadata\.",
        r"^169\.254\.", r"^fc00:", r"^fd00:", r"^fe80:", r"^\[::",
        r"^0x7f", r"^0177",
    ]
    for pattern in private_patterns:
        if re.match(pattern, hostname, re.IGNORECASE):
            raise HTTPException(status_code=400, detail="URL pointing to private network not allowed")
    # Block internal DNS names commonly used for SSRF
    internal_suffixes = [".internal", ".local", ".localhost", ".lan", ".corp", ".cloud"]
    host_lower = hostname.lower()
    for suffix in internal_suffixes:
        if host_lower.endswith(suffix) or host_lower == suffix.lstrip("."):
            raise HTTPException(status_code=400, detail="URL pointing to internal hostname not allowed")
    return url


def sanitize_drawtext(text: str) -> str:
    return re.sub(r"[^\w\s@.,!?¿¡\-:;'\"()]", "", text)


# ─── Subtitle + Music helpers ───────────────────────────────

MUSIC_DIR = "music"
MOOD_TRACKS = {
    "epic": "epic.mp3",
    "hype": "hype.mp3",
    "chill": "chill.mp3",
    "funny": "funny.mp3",
    "emotional": "emotional.mp3",
    "suspense": "suspense.mp3",
}
os.makedirs(MUSIC_DIR, exist_ok=True)


def format_srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms >= 1000:
        ms -= 1000
        s += 1
        if s >= 60:
            s -= 60
            m += 1
            if m >= 60:
                m -= 60
                h += 1
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def generate_srt_subtitle(words, clip_start, clip_end, output_path):
    """Generate a valid, clip-relative SRT from words that overlap the clip."""
    clip_words = []
    for word in words:
        start = float(word.get('start', 0))
        end = float(word.get('end', start))
        if end <= clip_start or start >= clip_end:
            continue
        clip_words.append({
            **word,
            'start': max(start, clip_start),
            'end': min(end, clip_end),
        })
    if not clip_words:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("")
        return
    # Group consecutive words into phrases (gap < 1.0s, max 8 words, max 5s duration)
    phrases = []
    current = [clip_words[0]]
    for w in clip_words[1:]:
        gap = w['start'] - current[-1]['end']
        phrase_dur = current[-1]['end'] - current[0]['start']
        if gap < 1.0 and len(current) < 8 and phrase_dur < 5.0:
            current.append(w)
        else:
            phrases.append(current)
            current = [w]
    if current:
        phrases.append(current)
    lines = []
    idx = 1
    for phrase in phrases:
        first = phrase[0]
        last = phrase[-1]
        text = ' '.join(w['word'].strip() for w in phrase if w['word'].strip())
        if not text:
            continue
        rel_start = max(0.0, first['start'] - clip_start)
        rel_end = max(rel_start + 0.1, last['end'] - clip_start)
        lines.append(str(idx))
        lines.append(f"{format_srt_time(rel_start)} --> {format_srt_time(rel_end)}")
        lines.append(text)
        lines.append("")
        idx += 1
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))


def compact_analysis_transcript(text, max_lines=140):
    """Keep the full timeline represented while staying below AI token limits."""
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) <= max_lines:
        return text
    indexes = [round(i * (len(lines) - 1) / (max_lines - 1)) for i in range(max_lines)]
    return "\n".join(lines[index] for index in indexes)


def format_ass_time(seconds: float) -> str:
    """Convert seconds to ASS time format H:MM:SS.cc (centiseconds)."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs -= 100
        s += 1
        if s >= 60:
            s -= 60
            m += 1
            if m >= 60:
                m -= 60
                h += 1
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def cleanup_old_exports():
    """Remove all temp files from previous exports to ensure clean render."""
    temp_dir = tempfile.gettempdir()
    for pattern in ['*_subs.ass', '*_export.*', '*_source.mp4', '*_music.mp3']:
        for f in glob.glob(os.path.join(temp_dir, pattern)):
            try:
                os.unlink(f)
            except OSError:
                pass
    for d in ['downloads', 'outputs']:
        if os.path.exists(d):
            for f in os.listdir(d):
                try:
                    os.unlink(os.path.join(d, f))
                except OSError:
                    pass


def _group_words_into_lines(words, max_words=4):
    """Match frontend groupWordsIntoLines: split into lines of max N words."""
    lines = []
    for i in range(0, len(words), max_words):
        lines.append(words[i:i + max_words])
    return lines


def _measure_text_width(text, font_family, font_size, font_weight, font_style, letter_spacing, scale):
    """Estimate text width for ASS positioning (rough approximation)."""
    # ASS doesn't have real text measurement, use character estimate
    # Average char width ≈ 0.55 * font_size for typical fonts
    base_width = len(text) * font_size * 0.55
    # Adjust for weight
    if font_weight in ('700', '800', '900'):
        base_width *= 1.15
    # Adjust for letter spacing
    base_width += (len(text) - 1) * letter_spacing * scale
    return base_width


def group_words_into_phrases(words):
    """Match frontend groupWordsIntoPhrases exactly."""
    active = sorted(words, key=lambda w: w['start'])
    phrases = []
    current = []
    for w in active:
        if not current:
            current.append(w)
        else:
            last = current[-1]
            gap = w['start'] - last['end']
            current_duration = last['end'] - current[0]['start']
            if gap < 0.8 and current_duration < 3.5 and len(current) < 3:
                current.append(w)
            else:
                phrases.append(current)
                current = [w]
    if current:
        phrases.append(current)
    return phrases


def generate_ass_karaoke(words, clip_start, clip_end, output_path, style=None, target_w=1080, target_h=1920, mode='word'):
    """
    Generate ASS subtitle file that EXACTLY matches the editor timeline.
    
    RULE: The editor is the single source of truth — no defaults, no re-grouping,
    no re-interpretation. The exported ASS must be a visual clone of the editor preview.
    
    mode='word':   Each word is its own Dialogue line (no grouping).
                   Word-by-word presets: karaoke, typewriter, bounce, vhs, neon, focus, viral.
    mode='phrase': Group words into phrases matching the editor's phrase logic.
    """
    clip_words = [
        w for w in words
        if not w.get('deleted', False)
        and w.get('start', 0) < clip_end
        and w.get('end', 0) > clip_start
    ]
    if not clip_words:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("[Script Info]\nScriptType: v4.00+\n")
        return

    s = style or {}

    # ─── WYSIWYG VALIDATION: log all received keys ───
    KNOWN_KEYS = {
        'fontFamily','fontSize','fontWeight','fontStyle',
        'color','highlightColor',
        'backgroundColor','backgroundOpacity','backgroundPadding','backgroundBorderRadius',
        'stroke','strokeColor','strokeWidth',
        'shadow','shadowColor','shadowBlur','shadowOffsetX','shadowOffsetY',
        'textAlign','textTransform','letterSpacing','lineHeight',
        'positionY','maxWidth','maxWords',
        'karaokeHighlight','entryAnimation','entryDuration',
        'ascentRatio',
    }
    received = set(s.keys())
    unused = received - KNOWN_KEYS
    missing_known = KNOWN_KEYS - received
    if unused:
        print(f"[WYSIWYG] ⚠️ IGNORED style keys (not read by ASS generator): {sorted(unused)}")
    if missing_known:
        print(f"[WYSIWYG] ⚠️ MISSING expected style keys (editor may not include them): {sorted(missing_known)}")
    print(f"[WYSIWYG] 📦 ALL received style values: {json.dumps({k: s[k] for k in sorted(received)}, default=str)}")

    # ─── Style: ALL values MUST come from the editor. NO defaults. ───
    def _req(key):
        val = s.get(key)
        if val is None:
            raise ValueError(f"[generate_ass_karaoke] editor did not send '{key}' — refusing to use a default")
        return val

    font_family = str(_req('fontFamily'))
    font_fn = f"'{font_family}'" if ' ' in font_family else font_family
    font_sz = float(_req('fontSize'))
    color = str(_req('color'))
    highlight_color = str(_req('highlightColor'))
    bg_color = str(_req('backgroundColor'))
    bg_opacity = float(_req('backgroundOpacity'))
    text_transform = str(_req('textTransform'))
    letter_spacing = float(_req('letterSpacing'))
    line_height = float(_req('lineHeight'))
    position_y = float(_req('positionY'))
    max_width = float(_req('maxWidth'))
    stroke = bool(_req('stroke'))
    stroke_c = str(_req('strokeColor'))
    stroke_w = float(_req('strokeWidth'))
    shadow = bool(_req('shadow'))
    shadow_c = str(_req('shadowColor'))
    shadow_blur = float(_req('shadowBlur'))
    shadow_offset_x = float(_req('shadowOffsetX'))
    shadow_offset_y = float(_req('shadowOffsetY'))
    text_align = str(_req('textAlign'))
    font_weight = str(_req('fontWeight'))
    font_style = str(_req('fontStyle'))
    karaoke = bool(_req('karaokeHighlight'))
    ascent_ratio = float(s.get('ascentRatio', 0.85))

    bold = -1 if font_weight in ('700', '800', '900') else 0
    italic = -1 if font_style == 'italic' else 0

    scale = target_w / 360.0
    eff_font_sz = font_sz * scale
    eff_font_sz = max(8, min(200, eff_font_sz))

    # Use frontend-measured ascent ratio for exact baseline→top conversion
    base_y = int(target_h * position_y / 100 - eff_font_sz * ascent_ratio)
    base_y = max(0, base_y)
    # ASS shadow depth = magnitude of (shadowOffsetX, shadowOffsetY), not blur
    shadow_mag = int((shadow_offset_x**2 + shadow_offset_y**2)**0.5) if shadow else 0

    def rgb_to_ass(rgb, alpha=0):
        h = rgb.lstrip('#')
        if len(h) == 3:
            h = ''.join(c*2 for c in h)
        h = h[:6].zfill(6)
        return f"&H{alpha:02X}{h[4:6]}{h[2:4]}{h[0:2]}&"

    pc = rgb_to_ass(color)
    hc = rgb_to_ass(highlight_color)
    oc = rgb_to_ass(stroke_c)

    if bg_color != 'transparent' and bg_opacity > 0:
        bg_alpha = int(255 * (1 - bg_opacity / 100))
        bgc = rgb_to_ass(bg_color, bg_alpha)
    else:
        bgc = "&H00000000&"

    # ─── Style overrides to match editor EXACTLY ───
    # Editor word-by-word mode ALWAYS forces: color=highlightColor, stroke=true, strokeWidth=3
    ass_stroke_w = 3.0 if mode == 'word' else stroke_w

    play_res_w = target_w
    play_res_h = target_h
    margin_x = int(play_res_w * (100 - max_width) / 200)
    margin_x = max(10, margin_x)

    lines_out = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "Collisions: Normal",
        f"PlayResX: {play_res_w}",
        f"PlayResY: {play_res_h}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,{font_fn},{int(eff_font_sz)},{pc},{hc},{oc},{bgc},{bold},{italic},0,0,100,100,{int(letter_spacing * scale * 10)},0,1,{int(ass_stroke_w)},{shadow_mag},8,{margin_x},{margin_x},0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    align_map = {'left': 7, 'center': 8, 'right': 9}
    align = align_map.get(text_align, 8)

    def _format_word(w, karaoke_active):
        txt = w.get('word', '').strip()
        if not txt:
            return None
        if text_transform == 'uppercase':
            txt = txt.upper()
        elif text_transform == 'lowercase':
            txt = txt.lower()
        # karaoke_active = True → phrase mode with karaoke (add \k for standard karaoke progression)
        if karaoke_active and w.get('end', 0) > w.get('start', 0):
            dur_cs = max(1, int(round((w['end'] - w['start']) * 100)))
            txt = '{\\k' + str(dur_cs) + '}' + txt
        return txt

    def _word_position(w):
        if w.get('x') is not None and w.get('y') is not None:
            wx = int(w['x'] * scale)
            wy = int(w['y'] * scale - eff_font_sz * 0.85)
        else:
            wx = play_res_w // 2
            wy = base_y
        return wx, max(0, wy)

    def _dialogue(start_sec, end_sec, text):
        s_str = format_ass_time(start_sec)
        e_str = format_ass_time(end_sec)
        return f"Dialogue: 0,{s_str},{e_str},Default,,0,0,0,,{text}"

    # ─── Dialogue generation by mode ───
    if mode == 'word':
        # Word-by-word: editor shows ALL words in highlightColor with stroke 3, NO progression
        hc_ass = rgb_to_ass(highlight_color)
        oc_ass = rgb_to_ass(stroke_c)
        for w in clip_words:
            txt = _format_word(w, False)
            if txt is None:
                continue
            w_start = max(0.0, w['start'] - clip_start)
            w_end = max(w_start + 0.1, w['end'] - clip_start)
            wx, wy = _word_position(w)
            # Editor forces: color=highlightColor, strokeColor=#000000, strokeWidth=3 for wbw
            tag = '{\\an' + str(align) + '\\pos(' + str(wx) + ',' + str(wy) + ')\\c' + hc_ass + '\\3c&H00000000&}'
            lines_out.append(_dialogue(w_start, w_end, tag + txt))

    elif mode == 'phrase':
        # Phrase mode: group words into phrases matching frontend logic
        phrases = group_words_into_phrases(clip_words)
        for phrase in phrases:
            p_start = max(0.0, phrase[0]['start'] - clip_start)
            p_end = max(p_start + 0.1, phrase[-1]['end'] - clip_start)
            parts = []
            for w in phrase:
                txt = _format_word(w, karaoke)
                if txt:
                    parts.append(txt)
            if not parts:
                continue
            text_str = ' '.join(parts)
            wx, wy = _word_position(phrase[0])
            tag = '{\\an' + str(align) + '\\pos(' + str(wx) + ',' + str(wy) + ')}'
            lines_out.append(_dialogue(p_start, p_end, tag + text_str))

    else:
        raise ValueError(f"[generate_ass_karaoke] unknown mode: {mode}")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines_out))


def resolve_music_path(mood: str) -> str | None:
    filename = MOOD_TRACKS.get(mood)
    if not filename:
        return None
    path = os.path.join(MUSIC_DIR, filename)
    return path if os.path.isfile(path) else None


def extract_youtube_video_id(url: str) -> str | None:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def run_async_in_sync(coro, timeout: float = 120):
    """Run an async coroutine from a sync context in a dedicated thread.

    This avoids RuntimeError when asyncio.run() is called from a thread that
    already has a running event loop (e.g. FastAPI/ASGI worker threads).
    """
    def runner():
        new_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(new_loop)
        try:
            return new_loop.run_until_complete(coro)
        finally:
            new_loop.close()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(runner)
        return future.result(timeout=timeout)


def _stream_download(client: httpx.Client, url: str, output_path: str, timeout: int = 120) -> bool:
    """Download a URL to disk with streaming and size validation."""
    try:
        with client.stream("GET", url, timeout=timeout) as stream:
            stream.raise_for_status()
            with open(output_path, "wb") as f:
                for chunk in stream.iter_bytes(chunk_size=8192):
                    f.write(chunk)
        return os.path.exists(output_path) and os.path.getsize(output_path) >= 1024
    except Exception as e:
        print(f"stream download failed for {url[:80]}: {e}")
        return False


def download_with_invidious(url: str, output_path: str) -> bool:
    """Fallback downloader using public Invidious instances for YouTube."""
    video_id = extract_youtube_video_id(url)
    if not video_id:
        return False
    invidious_instances = [
        "https://iv.nboeck.de", "https://iv.datura.network", "https://iv.melmac.space",
        "https://yt.artemislena.eu", "https://iv.nowhere.moe", "https://iv.drgns.space",
        "https://iv.nhc.no", "https://yt.owo.si", "https://iv.nboeck.de",
        "https://invidious.perennialte.ch", "https://iv.melmac.space",
        "https://iv.drgns.space", "https://iv.nboeck.de",
    ]
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for base in invidious_instances:
            try:
                r = client.get(f"{base}/api/v1/videos/{video_id}", timeout=15)
                if r.status_code != 200:
                    continue
                data = r.json()
                formats = data.get("adaptiveFormats", []) + data.get("formatStreams", [])
                download_url = None
                # Prefer muxed (video+audio) formats
                for fmt in formats:
                    fmt_type = fmt.get("type", "")
                    if fmt_type.startswith("video") and "audio" in fmt_type:
                        download_url = fmt.get("url")
                        if download_url:
                            break
                # Fallback to any format
                if not download_url:
                    for fmt in formats:
                        download_url = fmt.get("url")
                        if download_url:
                            break
                if not download_url:
                    continue
                if _stream_download(client, download_url, output_path, timeout=120):
                    print(f"Invidious download success from {base}")
                    return True
            except Exception as e:
                print(f"Invidious {base} failed: {e}")
                continue
    return False


def download_with_piped(url: str, output_path: str) -> bool:
    """Fallback downloader using public Piped instances for YouTube."""
    video_id = extract_youtube_video_id(url)
    if not video_id:
        return False
    piped_instances = [
        "https://pipedapi.kavin.rocks", "https://api.piped.projecthipbone.dev",
        "https://pipedapi.moomoo.me", "https://api.piped.privacydev.net",
        "https://pipedapi.adminforge.de", "https://api.piped.projecthipbone.dev",
        "https://pipedapi.moomoo.me", "https://pipedapi.adminforge.de",
    ]
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for base in piped_instances:
            try:
                r = client.get(f"{base}/streams/{video_id}", timeout=15)
                if r.status_code != 200:
                    continue
                data = r.json()
                streams = data.get("videoStreams", []) + data.get("audioStreams", [])
                download_url = None
                for s in streams:
                    if s.get("videoOnly"):
                        continue
                    url_candidate = s.get("url") or s.get("playbackUrl")
                    if url_candidate and (download_url is None or s.get("quality") == "720p"):
                        download_url = url_candidate
                if not download_url and streams:
                    download_url = streams[0].get("url") or streams[0].get("playbackUrl")
                if not download_url:
                    continue
                if _stream_download(client, download_url, output_path, timeout=120):
                    print(f"Piped download success from {base}")
                    return True
            except Exception as e:
                print(f"Piped {base} failed: {e}")
                continue
    return False


def download_with_realdebrid(url: str, output_path: str) -> bool:
    """Premium fallback using Real-Debrid (requires REALDEBRID_API_KEY env var)."""
    token = os.environ.get("REALDEBRID_API_KEY")
    if not token:
        return False
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            # Add link to Real-Debrid
            r = client.post(
                "https://api.real-debrid.com/rest/1.0/unrestrict/link",
                headers={"Authorization": f"Bearer {token}"},
                data={"link": url},
                timeout=30,
            )
            if r.status_code != 200:
                print(f"Real-Debrid add link failed: {r.status_code} {r.text[:200]}")
                return False
            data = r.json()
            download_url = data.get("download")
            if not download_url:
                print(f"Real-Debrid no download URL: {data}")
                return False
            if _stream_download(client, download_url, output_path, timeout=300):
                print("Real-Debrid download success")
                return True
    except Exception as e:
        print(f"Real-Debrid fallback failed: {e}")
    return False


def download_with_alldebrid(url: str, output_path: str) -> bool:
    """Premium fallback using AllDebrid (requires ALLDEBRID_API_KEY env var)."""
    token = os.environ.get("ALLDEBRID_API_KEY")
    if not token:
        return False
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            r = client.get(
                "https://api.alldebrid.com/v4/link/unlock",
                headers={"Authorization": f"Bearer {token}"},
                params={"link": url, "agent": "peakclip"},
                timeout=30,
            )
            if r.status_code != 200:
                print(f"AllDebrid unlock failed: {r.status_code} {r.text[:200]}")
                return False
            data = r.json()
            if data.get("status") != "success":
                print(f"AllDebrid error: {data}")
                return False
            download_url = data.get("data", {}).get("link")
            if not download_url:
                print(f"AllDebrid no link: {data}")
                return False
            if _stream_download(client, download_url, output_path, timeout=300):
                print("AllDebrid download success")
                return True
    except Exception as e:
        print(f"AllDebrid fallback failed: {e}")
    return False


def download_with_cobalt(url: str, output_path: str) -> bool:
    """Download YouTube video via cobalt.tools API v10.

    Cobalt has its own servers that are NOT blocked by YouTube.
    This is the primary download method when yt-dlp fails.
    """
    cobalt_url = os.environ.get("COBALT_API_URL", "https://api.cobalt.tools/")
    api_key = os.environ.get("COBALT_API_KEY")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Api-Key {api_key}"
    try:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            r = client.post(
                cobalt_url,
                headers=headers,
                json={
                    "url": url,
                    "videoQuality": "1080",
                    "filenameStyle": "basic",
                    "youtubeVideoCodec": "h264",
                },
                timeout=30,
            )
            if r.status_code != 200:
                print(f"cobalt v10 API status {r.status_code}: {r.text[:300]}")
                return False
            data = r.json()
            print(f"cobalt v10 response: status={data.get('status')}")
            if data.get("status") == "error":
                err = data.get("error", {})
                print(f"cobalt v10 error: {err}")
                return False
            status = data.get("status")
            urls = []
            if status == "tunnel":
                urls = [data.get("url")]
            elif status == "redirect":
                urls = [data.get("url")]
            elif status == "local-processing":
                urls = data.get("tunnel", [])
            if not urls or not urls[0]:
                print(f"cobalt v10: no download URL in response: {data}")
                return False
            for u in urls:
                if u and _stream_download(client, u, output_path, timeout=300):
                    print(f"cobalt v10 download success: {output_path}")
                    return True
    except Exception as e:
        print(f"cobalt v10 fallback failed: {e}")
    return False


async def download_with_playwright(url: str, output_path: str) -> bool:
    """Fallback downloader using Playwright browser automation for YouTube."""
    video_id = extract_youtube_video_id(url)
    if not video_id:
        return False
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled', '--disable-web-security',
                ]
            )
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080},
                locale='en-US',
            )
            page = await context.new_page()
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                window.chrome = { runtime: {} };
            """)
            video_url = None
            async def handle_route(route, request):
                nonlocal video_url
                req_url = request.url
                if 'googlevideo.com' in req_url and ('videoplayback' in req_url or 'itag' in req_url):
                    if video_url is None or 'range=' not in req_url:
                        video_url = req_url
                await route.continue_()
            await page.route("**/*", handle_route)
            try:
                await page.goto(f"https://www.youtube.com/embed/{video_id}", wait_until="networkidle", timeout=60000)
            except Exception:
                try:
                    await page.goto(f"https://m.youtube.com/watch?v={video_id}", wait_until="domcontentloaded", timeout=60000)
                except Exception:
                    await page.goto(f"https://www.youtube.com/watch?v={video_id}", wait_until="domcontentloaded", timeout=60000)
            try:
                consent_button = await page.wait_for_selector('button[aria-label*="Accept"], form[action*="consent"] button', timeout=8000)
                if consent_button:
                    await consent_button.click()
                    await page.wait_for_timeout(3000)
            except Exception:
                pass
            try:
                await page.click('button.ytp-large-play-button, .ytp-button[aria-label="Play"]', timeout=8000)
                await page.wait_for_timeout(5000)
            except Exception:
                await page.wait_for_timeout(12000)
            await browser.close()
            if not video_url:
                return False
            with httpx.Client(timeout=300, follow_redirects=True) as client:
                with client.stream("GET", video_url, timeout=300) as stream:
                    stream.raise_for_status()
                    with open(output_path, "wb") as f:
                        for chunk in stream.iter_bytes(chunk_size=8192):
                            f.write(chunk)
            if os.path.getsize(output_path) >= 1024:
                print("Playwright download success")
                return True
    except Exception as e:
        print(f"Playwright fallback failed: {e}")
    return False


# ──────────────────────────────────────────────────────────────


@app.post("/process")
async def process_video(req: VideoRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    await check_rate_limit(f"process:{user['sub']}")
    user_id = user["sub"]
    job_id = str(uuid.uuid4())

    validate_video_url(req.url)

    user_result = supabase.table("users").select("credits,plan").eq("id", user_id).execute()
    if not user_result.data:
        supabase.table("users").insert({"id": user_id, "credits": 3, "plan": "free"}).execute()
        supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
        user_data = {"plan": "free", "credits": 3}
    else:
        user_data = user_result.data[0]
        if user_data["plan"] != "pro" and user_data["credits"] <= 0:
            tx_result = supabase.table("credit_transactions").select("id").eq("user_id", user_id).eq("type", "free_grant").limit(1).execute()
            if not tx_result.data:
                supabase.table("users").update({"credits": 3}).eq("id", user_id).execute()
                supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
                user_data["credits"] = 3
            else:
                raise HTTPException(status_code=402, detail="No credits remaining")

    if user_data["plan"] != "pro":
        dedent_credits(user_id)

    jobs_store[job_id] = {"status": "processing", "message": "Starting download...", "user_id": user_id}
    background_tasks.add_task(process_video_background, job_id, user_id, req.url)
    return {"status": "processing", "job_id": job_id}


def process_video_background(job_id: str, user_id: str, url: str):
    try:
        yt_meta = fetch_youtube_metadata(url)

        video_path = f"downloads/{job_id}.mp4"
        audio_path = f"downloads/{job_id}.mp3"
        local_files = [video_path, audio_path]

        # Global deadline so the frontend is never left polling forever
        deadline = time.time() + 600

        def check_deadline(label=""):
            if time.time() > deadline:
                raise TimeoutError(f"Processing deadline exceeded ({label})")

        # Retry download with different strategies
        # ── PHASE 0: Try cobalt.tools first (fastest, uses their servers) ──
        jobs_store[job_id] = {"status": "processing", "message": "Downloading video..."}
        print(f"Job {job_id}: trying cobalt.tools first")
        try:
            if download_with_cobalt(url, video_path):
                last_err = None
                print(f"Job {job_id}: cobalt download succeeded")
        except Exception as e:
            print(f"Job {job_id}: cobalt attempt failed: {e}")

        # Strategies ordered by success rate from Railway behind Oxylabs proxy.
        # The android+skip combo is the only one that succeeded (360p).
        strategies = [
            {'player_client': ['android'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {'player_client': ['android'], 'player_skip': ['webpage', 'configs']},
            {'player_client': ['android_vr'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {'player_client': ['ios'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {'player_client': ['android'], 'player_skip': ['webpage']},
            {'player_client': ['android']},
            {'player_client': ['tv_embedded'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {'player_client': ['web_embedded'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {'player_client': ['mweb'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {'player_client': ['web_creator'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True},
            {},
            {'player_client': ['web']},
            {'player_client': ['ios']},
            {'player_client': ['tv_embedded'], 'player_skip': ['webpage', 'configs']},
            {'player_client': ['web_embedded']},
            {'player_client': ['web'], 'include_incomplete_formats': True},
        ]
        user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
            'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/128.0.0.0 TV Safari/537.36',
        ]
        format_fallbacks = [
            # Best possible with DASH (separate video+audio)
            'bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio',
            # 1080p DASH
            'bestvideo[height<=1080]+bestaudio/bestvideo[height<=1080]+bestaudio',
            # Any DASH with audio
            'bestvideo+bestaudio',
            # 4K progressive (combined)
            'best[height<=2160][ext=mp4]/best[height<=2160]',
            # 1080p progressive
            'best[height<=1080][ext=mp4]/best[height<=1080]',
            # 720p progressive (minimum acceptable)
            'best[height<=720][ext=mp4]/best[height<=720]',
            # H.264 + AAC (safest codec combo)
            'bv[ext=mp4][vcodec^=avc1]+ba[ext=m4a]',
        ]
        impersonate_profiles = [None, 'chrome', 'safari', 'chrome-120', 'chrome-119', 'safari-17']

        # Auth: residential proxy + POT server + extractor strategies
        proxy_url = os.environ.get('YOUTUBE_PROXY')
        po_token = os.environ.get('YOUTUBE_PO_TOKEN')
        visitor_data = os.environ.get('YOUTUBE_VISITOR_DATA')
        has_cookies = os.path.exists(COOKIES_PATH)

        last_err = None
        max_attempts = 16
        proxy_disabled = False
        bot_detection_count = 0
        # Skip yt-dlp loop if cobalt already downloaded successfully
        cobalt_ok = os.path.exists(video_path) and os.path.getsize(video_path) > 1024
        if cobalt_ok:
            print(f"Job {job_id}: video already downloaded by cobalt, skipping yt-dlp")
        for attempt in range(max_attempts if not cobalt_ok else 0):
            check_deadline("download")
            cfg = strategies[attempt % len(strategies)]
            jobs_store[job_id] = {"status": "processing", "message": f"Downloading video (attempt {attempt+1}/{max_attempts})..."}
            ua = user_agents[attempt % len(user_agents)]
            fmt = format_fallbacks[attempt % len(format_fallbacks)]
            imp = impersonate_profiles[attempt % len(impersonate_profiles)]
            try:
                # Clean partial file from previous timed-out attempt
                if os.path.exists(video_path):
                    try:
                        os.remove(video_path)
                    except OSError:
                        pass
                ydl_opts = {
                    'format': fmt,
                    'outtmpl': video_path,
                    'quiet': True,
                    'verbose': True if attempt == 0 else False,
                    'no_warnings': True,
                    'extract_flat': False,
                    'noplaylist': True,
                    'sleep_interval': 1,
                    'sleep_interval_requests': 1,
                    'extractor_retries': 3,
                    'file_access_retries': 3,
                    'ignore_no_formats_error': True,
                    'allow_unplayable_formats': True,
                    'no_check_certificate': True,
                    'socket_timeout': 60,
                    'overwrites': True,
                    'http_headers': {
                        'User-Agent': ua,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                    },
                    'youtube_include_dash_manifest': True,
                    'youtube_include_hls_manifest': True,
                    'source_address': '0.0.0.0',
                    'legacy_server_connect': True,
                    'geo_bypass': True,
                }
                if imp:
                    ydl_opts['impersonate'] = imp
                use_proxy = proxy_url and not proxy_disabled
                if use_proxy:
                    ydl_opts['proxy'] = proxy_url
                # Always use cookies from attempt 0 — proxy-only never works from Railway
                if has_cookies:
                    ydl_opts['cookiefile'] = COOKIES_PATH
                extractor_args = {'youtube': cfg} if cfg else {'youtube': {}}
                # Always enable PO token and bgutil as fallback
                if po_token:
                    extractor_args['youtube']['po_token'] = po_token
                if visitor_data:
                    extractor_args['youtube']['visitor_data'] = visitor_data
                if BGUTIL_POT_AVAILABLE:
                    extractor_args['youtubepot-bgutilhttp'] = {}
                if extractor_args['youtube'] or 'youtubepot-bgutilhttp' in extractor_args:
                    ydl_opts['extractor_args'] = extractor_args
                print(f"yt-dlp attempt {attempt+1}/{max_attempts} strategy={cfg} format={fmt} imp={imp} proxy={'yes' if use_proxy else 'no'} cookies={'yes' if has_cookies else 'no'}")
                # Run yt-dlp in a subprocess so we can hard-kill it on timeout
                ytdlp_script = os.path.join(os.path.dirname(__file__), 'ytdlp_download.py')
                sub_opts = dict(ydl_opts)
                sub_opts['url'] = url
                try:
                    sub_timeout = 45 if attempt < 4 else 90 if attempt < 8 else 180
                    result = subprocess.run(
                        [sys.executable, ytdlp_script, json.dumps(sub_opts)],
                        capture_output=True,
                        text=True,
                        timeout=sub_timeout,
                    )
                    if result.returncode != 0:
                        stderr_tail = (result.stderr or '')[-1000:]
                        stdout_tail = (result.stdout or '')[-500:]
                        combined_output = (stderr_tail + stdout_tail).lower()
                        print(f"yt-dlp attempt {attempt+1} exit={result.returncode}")
                        if stderr_tail:
                            print(f"  stderr[-1000]: {stderr_tail}")
                        if stdout_tail:
                            print(f"  stdout[-500]: {stdout_tail}")
                        # Detect YouTube bot detection specifically
                        if any(x in combined_output for x in ['sign in to confirm', 'not a bot', 'no video formats found', 'confirm you']):
                            bot_detection_count += 1
                            print(f"  >>> YOUTUBE BOT DETECTION detected ({bot_detection_count} times). "
                                  f"Authentication needed for high-quality downloads.")
                            if bot_detection_count >= 2:
                                print(f"  >>> PERSISTENT BOT DETECTION — YouTube is actively blocking this IP.")
                                print(f"  >>> Configure YOUTUBE_OAUTH_TOKENS_B64, YOUTUBE_COOKIES_B64, or YOUTUBE_PROXY to fix.")
                        raise Exception(f"yt-dlp exited {result.returncode}: {stderr_tail[:200]}")
                except subprocess.TimeoutExpired as e:
                    stderr_tail = (e.stderr or '')[-300:] if hasattr(e, 'stderr') else ''
                    print(f"yt-dlp attempt {attempt+1} timed out. stderr: {stderr_tail}")
                    raise TimeoutError(f"Download attempt {attempt+1} timed out")
                if not os.path.exists(video_path) or os.path.getsize(video_path) < 1024:
                    if os.path.exists(video_path):
                        with open(video_path, 'rb') as _f:
                            _head = _f.read(500)
                        print(f"yt-dlp output too small ({os.path.getsize(video_path)} bytes): {_head[:200]}")
                    raise Exception("File not downloaded or too small")
                last_err = None
                break
            except TimeoutError:
                last_err = TimeoutError(f"Download attempt {attempt+1} timed out")
                print(f"Download attempt {attempt+1}/{max_attempts} timed out")
                if attempt < max_attempts - 1:
                    time.sleep(min(2 + attempt, 10))
            except Exception as e:
                last_err = e
                err_lower = str(e).lower()
                # If proxy fails (auth, DNS, tunnel), disable it and retry without proxy
                if any(x in err_lower for x in ["407", "proxy authentication", "name or service not known", "tunnel connection failed", "unable to connect to proxy"]):
                    if proxy_url and not proxy_disabled:
                        print(f"Proxy failed ({err_lower[:80]}). Disabling proxy for remaining attempts.")
                        proxy_disabled = True
                        if attempt < max_attempts - 1:
                            time.sleep(2)
                            continue
                if any(x in err_lower for x in ["rate-limited", "no video formats", "format not available", "requested format"]):
                    # These are YouTube-side blocks, NOT proxy failures.
                    # Keep proxy enabled — disabling it would make things worse.
                    if attempt < max_attempts - 1:
                        wait = min(3 + attempt, 15)
                        print(f"YouTube issue (attempt {attempt+1}/{max_attempts}): {err_lower[:80]}, waiting {wait}s...")
                        time.sleep(wait)
                        continue
        # If yt-dlp completely failed, try public fallback services
        if last_err is not None or not os.path.exists(video_path) or os.path.getsize(video_path) < 1024:
            check_deadline("fallbacks")
            jobs_store[job_id] = {"status": "processing", "message": "Trying alternative download methods..."}
            print(f"Job {job_id}: starting fallback downloaders")
            fallback_success = False
            for name, fn in [
                ("invidious", lambda: download_with_invidious(url, video_path)),
                ("piped", lambda: download_with_piped(url, video_path)),
                ("real-debrid", lambda: download_with_realdebrid(url, video_path)),
                ("alldebrid", lambda: download_with_alldebrid(url, video_path)),
                ("cobalt", lambda: download_with_cobalt(url, video_path)),
                ("playwright", lambda: run_async_in_sync(download_with_playwright(url, video_path), timeout=30)),
            ]:
                try:
                    print(f"Job {job_id}: trying fallback {name}")
                    if fn():
                        fallback_success = True
                        print(f"Job {job_id}: fallback {name} succeeded")
                        break
                except Exception as e:
                    print(f"Job {job_id}: fallback {name} error: {e}")
            if not fallback_success or not os.path.exists(video_path) or os.path.getsize(video_path) < 1024:
                print(f"Job {job_id}: all fallback downloaders failed")
                ytdlp_err = str(last_err)[:200] if last_err else "unknown"
                jobs_store[job_id] = {
                    "status": "error",
                    "message": (
                        "Download failed after all attempts. YouTube is blocking this server. "
                        "Check YOUTUBE_PROXY env var is set correctly on Railway. "
                        "Proxy is the primary method — cookies/PO token are fallbacks."
                    ),
                }
                return

        # Verify resolution — warn if below 720p (will be upscaled during render)
        probe_res = subprocess.run([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0', video_path
        ], capture_output=True, text=True, timeout=30)
        src_w, src_h = 0, 0
        if probe_res.stdout.strip():
            parts = probe_res.stdout.strip().split(',')
            if len(parts) == 2:
                try:
                    src_w, src_h = int(parts[0]), int(parts[1])
                    src_res = min(src_w, src_h)
                    print(f"Job {job_id}: source resolution {src_w}x{src_h}")
                    if src_res < 720:
                        msg = (
                            f"LOW QUALITY DOWNLOAD: {src_w}x{src_h} ({src_res}p). "
                            f"YouTube likely blocked high-quality formats (bot detection). "
                            f"This WILL degrade: auto-reframe accuracy, face tracking, smart zoom, final clip quality. "
                            f"Configure authentication (YOUTUBE_OAUTH_TOKENS_B64, YOUTUBE_COOKIES_B64, or YOUTUBE_PROXY) "
                            f"to get 1080p+ downloads."
                        )
                        print(f"Job {job_id}: {msg}")
                        jobs_store[job_id] = {
                            "status": "processing",
                            "message": f"Warning: downloaded at {src_res}p (low quality). Configure auth for 1080p+.",
                            "source_resolution": f"{src_w}x{src_h}",
                        }
                except ValueError:
                    pass

        jobs_store[job_id] = {"status": "processing", "message": "Extracting audio...", "user_id": user_id}
        # Extract audio at low bitrate to stay under Whisper's 25MB limit
        ffmpeg_result = subprocess.run([
            'ffmpeg', '-i', video_path, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '24k', audio_path, '-y'
        ], capture_output=True, timeout=300)
        if ffmpeg_result.returncode != 0:
            stderr = (ffmpeg_result.stderr or b'').decode('utf-8', 'ignore')[-500:]
            raise Exception(f"ffmpeg audio extraction failed: {stderr}")
        if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1024:
            raise Exception("Extracted audio file is missing or empty")
        print(f"Job {job_id}: audio extracted ({os.path.getsize(audio_path)} bytes)")

        # Generate a thumbnail for the source video
        thumb_path = f"thumbnails/{job_id}.jpg"
        generate_thumbnail(video_path, thumb_path)
        local_files.append(thumb_path)

        check_deadline("transcription")
        audio_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        jobs_store[job_id] = {"status": "processing", "message": f"Transcribing {audio_size_mb:.0f}MB audio..."}
        print(f"TRANSCRIBE: starting, audio={audio_size_mb:.1f}MB path={audio_path}")

        # Compress large audio to speed up Whisper
        transcribe_path = audio_path
        if audio_size_mb > 15:
            compressed = audio_path.replace('.mp3', '_compressed.mp3')
            print(f"TRANSCRIBE: compressing large audio ({audio_size_mb:.1f}MB)...")
            subprocess.run([
                'ffmpeg', '-y', '-i', audio_path,
                '-ar', '16000', '-ac', '1', '-b:a', '32k', compressed
            ], capture_output=True, timeout=120)
            if os.path.exists(compressed) and os.path.getsize(compressed) > 1024:
                comp_mb = os.path.getsize(compressed) / (1024 * 1024)
                print(f"TRANSCRIBE: compressed to {comp_mb:.1f}MB")
                transcribe_path = compressed
                local_files.append(compressed)

        # ── Attempt transcription with OpenAI, fallback to Groq ──
        transcript = None

        # Helper: transcribe with a given client and model
        def _do_transcribe(client_obj, model):
            with open(transcribe_path, 'rb') as f:
                return client_obj.audio.transcriptions.create(
                    model=model, file=f,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                )

        # Try OpenAI
        import threading
        openai_result = []
        openai_error = []
        def _openai_thread():
            try:
                print(f"TRANSCRIBE: OpenAI Whisper starting...")
                t0 = time.time()
                r = _do_transcribe(client, "whisper-1")
                elapsed = time.time() - t0
                print(f"TRANSCRIBE: OpenAI Whisper OK in {elapsed:.1f}s")
                openai_result.append(r)
            except Exception as e:
                openai_error.append(e)

        t = threading.Thread(target=_openai_thread, daemon=True)
        t.start()
        t.join(timeout=360)
        if t.is_alive():
            print(f"TRANSCRIBE: OpenAI Whisper did not finish within 360s, trying Groq...")
            if groq_client:
                try:
                    jobs_store[job_id] = {"status": "processing", "message": "Transcribing with Groq (OpenAI timed out)..."}
                    # Run Groq in a thread with 300s timeout
                    groq_result = []
                    def _groq_thread():
                        try:
                            groq_result.append(_do_transcribe(groq_client, "whisper-large-v3-turbo"))
                        except Exception as e:
                            groq_result.append(e)
                    gt = threading.Thread(target=_groq_thread, daemon=True)
                    gt.start()
                    gt.join(timeout=300)
                    if gt.is_alive():
                        print(f"TRANSCRIBE: Groq also timed out after 300s")
                    elif groq_result:
                        r = groq_result[0]
                        if isinstance(r, Exception):
                            print(f"TRANSCRIBE: Groq also failed: {r}")
                        else:
                            transcript = r
                except Exception as groq_err:
                    print(f"TRANSCRIBE: Groq also failed: {groq_err}")
        elif openai_result:
            transcript = openai_result[0]
        elif openai_error:
            print(f"TRANSCRIBE: OpenAI Whisper error: {openai_error[0]}")
            # Try Groq fallback with timeout
            if groq_client:
                jobs_store[job_id] = {"status": "processing", "message": "Transcribing with Groq..."}
                print(f"TRANSCRIBE: Groq Whisper starting...")
                t0 = time.time()
                groq_result = []
                def _groq_thread2():
                    try:
                        groq_result.append(_do_transcribe(groq_client, "whisper-large-v3-turbo"))
                    except Exception as e:
                        groq_result.append(e)
                gt = threading.Thread(target=_groq_thread2, daemon=True)
                gt.start()
                gt.join(timeout=300)
                if gt.is_alive():
                    print(f"TRANSCRIBE: Groq also timed out after 300s")
                elif groq_result:
                    r = groq_result[0]
                    if isinstance(r, Exception):
                        print(f"TRANSCRIBE: Groq also failed: {r}")
                    else:
                        transcript = r
                        print(f"TRANSCRIBE: Groq Whisper OK in {time.time()-t0:.1f}s")
        else:
            print(f"TRANSCRIBE: OpenAI thread finished without result or error (timeout?)")

        if transcript is None:
            print(f"TRANSCRIBE: all services failed, continuing without subtitles")
            words_data = []
            segments_text = "Transcript not available."
            jobs_store[job_id] = {"status": "processing", "message": "Transcription unavailable, generating clips without subtitles..."}
        else:
            words_data = []
            # Handle both object-attribute and dict access for Groq/OpenAI responses
            def _get(obj, key, default=None):
                try:
                    return getattr(obj, key, None) or (obj[key] if isinstance(obj, dict) else None) or default
                except Exception:
                    return default
            raw_words = getattr(transcript, 'words', None) or (transcript.get('words') if isinstance(transcript, dict) else None) or []
            for w in raw_words:
                word_text = _get(w, 'word', '')
                w_start = _get(w, 'start', None)
                w_end = _get(w, 'end', None)
                if w_start is not None and w_end is not None and word_text.strip():
                    words_data.append({"word": word_text, "start": w_start, "end": w_end})

            raw_segments = getattr(transcript, 'segments', None) or (transcript.get('segments') if isinstance(transcript, dict) else None) or []
            segments_lines = []
            for s in raw_segments:
                s_start = _get(s, 'start', 0)
                s_end = _get(s, 'end', 0)
                s_text = _get(s, 'text', '')
                segments_lines.append(f"[{s_start:.1f}s - {s_end:.1f}s]: {s_text}")
            segments_text = "\n".join(segments_lines)
            print(f"TRANSCRIBE: done, {len(words_data)} words")

        check_deadline("ai-analysis")
        jobs_store[job_id] = {"status": "processing", "message": "Analyzing viral moments with AI..."}
        analysis_transcript = compact_analysis_transcript(segments_text)
        analysis_body = [{
            "role": "system",
            "content": "You are a viral clip analyzer. Return ONLY valid JSON, no markdown, no code fences.",
        }, {
            "role": "user",
            "content": f"""Analyze this transcript and return the 2 best viral moments for YouTube Shorts/TikTok.

Transcript:
 {analysis_transcript}

RULES:
- Return exactly 2 clips.
- Each clip should be at least 10 seconds long — capture enough context for the viral moment.
- Prioritize: strong hooks, emotional peaks, surprising twists, humor, high-energy moments, or controversy.
- Distribute clips across the video timeline — don't cluster them together.
- Classify mood as: epic, hype, chill, funny, emotional, suspense.
- Include a hook_score from 1-10 ranking virality potential.
- Include engagement_factors: an array of strings identifying what makes it viral (e.g. "strong_hook", "emotional_peak", "surprise", "humor", "controversy", "high_energy", "relatable", "shock_value").
- Include retention_prediction: estimated percentage of viewers who'd watch the full clip (1-100).

Return JSON with this exact format:
{{"clips": [
  {{"start": 10.5, "end": 40.2, "title": "Clip title", "reason": "Why viral", "mood": "hype", "hook_score": 9, "engagement_factors": ["strong_hook", "emotional_peak"], "retention_prediction": 82}},
  {{"start": 120.0, "end": 150.5, "title": "Clip title 2", "reason": "Why viral", "mood": "funny", "hook_score": 8, "engagement_factors": ["humor", "relatable"], "retention_prediction": 75}}
]}}"""
        }]
        response = None
        try:
            response = client.chat.completions.create(
                model="gpt-4o", response_format={"type": "json_object"},
                timeout=120, messages=analysis_body,
            )
        except Exception as e:
            err_msg = str(e).lower()
            if ("insufficient_quota" in err_msg or "429" in err_msg or "exceeded" in err_msg or "incorrect api key" in err_msg or "401" in err_msg or "invalid_api_key" in err_msg) and groq_client:
                print(f"Job {job_id}: OpenAI quota exceeded for analysis, using Groq...")
                try:
                    response = groq_client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        response_format={"type": "json_object"},
                        timeout=60, messages=analysis_body,
                    )
                except Exception as groq_ai_err:
                    print(f"Job {job_id}: Groq analysis also failed: {groq_ai_err}")
                    response = None
            else:
                print(f"Job {job_id}: AI analysis error: {e}")
                # Fallback: return preview generated viral moments
                response = None
        if response and response.choices:
            raw = response.choices[0].message.content.strip()
        else:
            raw = None
        # Strip markdown code fences if present
        if raw:
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1].rsplit("\n", 1)[0]
                if raw.endswith("```"):
                    raw = raw[:-3]
        if raw:
            try:
                clips_data = json.loads(raw)
            except json.JSONDecodeError:
                clips_data = {"clips": []}
        else:
            clips_data = {"clips": []}

        # Sort clips by hook_score descending (best viral moment first)
        clips_data["clips"].sort(key=lambda c: c.get("hook_score", 5), reverse=True)

        # Pad to exactly 2 clips if AI returned fewer
        if len(clips_data.get("clips", [])) < 2:
            existing = clips_data.get("clips", [])[:]
            last_end = max((c.get("end", 0) for c in existing), default=0)
            total_duration = words_data[-1].get('end', 0) if words_data else 600
            total_duration = max(total_duration, 60)
            step = (total_duration - last_end) / max(1, 2 - len(existing))
            for j in range(len(existing), 2):
                pad_start = last_end + (j - len(existing) + 1) * step
                pad_end = min(pad_start + 45, total_duration)
                clips_data["clips"].append({
                    "start": pad_start, "end": pad_end,
                    "title": f"Highlight {j+1}", "reason": "Auto-selected highlight",
                    "mood": "chill", "hook_score": 5,
                    "engagement_factors": ["auto_selected"], "retention_prediction": 50
                })

        output_clips = []
        temp_files_extra = []

        def _ffmpeg(cmd, label, timeout=300):
            print(f"FFMPEG {label}: {' '.join(cmd)}")
            t0 = time.time()
            try:
                r = subprocess.run(cmd, capture_output=True, timeout=timeout)
                elapsed = time.time() - t0
                sz = os.path.getsize(cmd[-1]) if os.path.exists(cmd[-1]) else 0
                print(f"FFMPEG {label}: done {elapsed:.1f}s rc={r.returncode} size={sz}")
                if r.returncode != 0:
                    print(f"FFMPEG {label}: stderr={r.stderr[-2000:]}")
                return r
            except subprocess.TimeoutExpired:
                elapsed = time.time() - t0
                print(f"FFMPEG {label}: TIMEOUT after {elapsed:.1f}s")
                raise

        try:
            for i, clip in enumerate(clips_data["clips"]):
                check_deadline(f"clip-{i+1}")
                jobs_store[job_id] = {"status": "processing", "message": f"Generating clip {i+1}..."}
                output_path = f"outputs/{job_id}_clip{i+1}.mp4"
                clip_start = clip["start"]
                raw_duration = clip["end"] - clip["start"]
                # Minimum 15s for a usable Shorts clip
                duration = max(15, raw_duration)
                clip_mood = clip.get("mood", "chill")

                # ── Generate SRT subtitles (word-by-word, relative to clip start) ──
                srt_path = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}.srt")
                generate_srt_subtitle(words_data, clip_start, clip["end"], srt_path)
                temp_files_extra.append(srt_path)
                srt_has_data = os.path.exists(srt_path) and os.path.getsize(srt_path) > 0

                # ── Resolve music track (silently skip if missing) ──
                music_path = resolve_music_path(clip_mood)

                # -ss before -i seeks to keyframe, then decodes to exact clip_start (frame-accurate)
                local_files.append(output_path)

                # ── Step 1: Extract raw clip segment (video + audio) ──
                raw_clip = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}_raw.mp4")
                extract_cmd = [
                    'ffmpeg', '-y', '-ss', str(clip_start),
                    '-i', video_path, '-t', str(duration),
                    '-c', 'copy', raw_clip
                ]
                _ffmpeg(extract_cmd, f"clip{i+1}_extract", timeout=120)
                if not os.path.exists(raw_clip) or os.path.getsize(raw_clip) < 1024:
                    print(f"CLIP {i+1}: raw extraction failed, skipping")
                    continue

                # ── Step 2: Smart reframe (face tracking + dynamic crop) ──
                reframed = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}_reframed.mp4")
                try:
                    from smart_reframe import smart_reframe
                    smart_reframe(raw_clip, reframed, target_w=720, target_h=1280)
                except Exception as e:
                    print(f"CLIP {i+1}: smart_reframe failed ({e}), falling back to static crop")
                    fallback_cmd = [
                        'ffmpeg', '-y', '-i', raw_clip,
                        '-vf', 'scale=720:1280:force_original_aspect_ratio=increase:flags=lanczos,crop=720:1280,setsar=1,format=yuv420p',
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
                        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                        '-threads', '2', '-x264-params', 'threads=2:bframes=0:ref=1',
                        reframed
                    ]
                    _ffmpeg(fallback_cmd, f"clip{i+1}_fallback_crop", timeout=300)

                if not os.path.exists(reframed) or os.path.getsize(reframed) < 1024:
                    print(f"CLIP {i+1}: reframing failed, skipping")
                    continue

                # ── Step 3: Burn-in subtitles + mix music ──
                # Generate ASS karaoke subtitles for burn-in
                ass_path = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}.ass")
                if srt_has_data:
                    try:
                        generate_ass_karaoke(
                            words_data, clip_start, clip["end"], ass_path,
                            target_w=720, target_h=1280, mode='word'
                        )
                    except Exception as e:
                        print(f"CLIP {i+1}: ASS generation failed ({e}), falling back to SRT")
                        ass_path = None
                else:
                    ass_path = None

                # Build ffmpeg: burn-in subs (requires re-encode) + mix audio
                vf_parts = []
                if ass_path and os.path.exists(ass_path) and os.path.getsize(ass_path) > 100:
                    safe_ass = ass_path.replace('\\', '/').replace(':', '\\:')
                    vf_parts.append(f"subtitles={safe_ass}:fontsdir=/usr/share/fonts/truetype")

                cmd = ['ffmpeg', '-y', '-i', reframed]
                if music_path:
                    music_path_ff = music_path.replace('\\', '/')
                    cmd += ['-stream_loop', '-1', '-i', music_path_ff]

                input_idx = 1
                if music_path:
                    cmd += ['-filter_complex',
                            '[0:a]volume=1.0[a_main];[1:a]volume=0.15[a_music];[a_main][a_music]amix=inputs=2:duration=first:dropout_transition=2[a]']
                    cmd += ['-map', '[a]']
                else:
                    cmd += ['-map', '0:a']

                cmd += ['-map', '0:v']

                if vf_parts:
                    cmd += ['-vf', ','.join(vf_parts)]
                    cmd += ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
                            '-pix_fmt', 'yuv420p', '-threads', '2',
                            '-x264-params', 'threads=2:bframes=0:ref=1']
                else:
                    cmd += ['-c:v', 'copy']

                cmd += ['-c:a', 'aac', '-b:a', '256k', '-shortest']
                cmd += ['-movflags', '+faststart', '-y', output_path]
                _ffmpeg(cmd, f"clip{i+1}_final", timeout=300)

                if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
                    print(f"CLIP {i+1}: final render failed, skipping")
                    continue

                jobs_store[job_id] = {"status": "processing", "message": f"Uploading clip {i+1}..."}

                # 1. Upload video (with burned-in subs) to Supabase Storage
                storage_path = f"{job_id}/{job_id}_clip{i+1}.mp4"
                local_files.append(output_path)
                clip_storage_url = upload_with_verification(
                    supabase, "clips", output_path, storage_path, "video/mp4"
                ) or ""

                # 2. Upload SRT subtitles as a separate file
                srt_storage_url = ""
                srt_content = ""
                if os.path.exists(srt_path) and os.path.getsize(srt_path) > 0:
                    srt_storage_path = f"{job_id}/{job_id}_clip{i+1}.srt"
                    srt_storage_url = upload_with_verification(
                        supabase, "clips", srt_path, srt_storage_path, "text/plain"
                    ) or ""
                    try:
                        with open(srt_path, 'r', encoding='utf-8') as _sf:
                            srt_content = _sf.read()
                    except Exception:
                        srt_content = ""

                # 3. Upload thumbnail
                thumb_storage_path = f"thumbnails/{job_id}.jpg"
                thumb_storage_url = upload_with_verification(
                    supabase, "clips", thumb_path, thumb_storage_path, "image/jpeg"
                ) or ""

                clip_id = str(uuid.uuid4())
                words_json_value = json.dumps(words_data) if words_data else None
                clip_row = {
                    "id": clip_id,
                    "user_id": user_id,
                    "title": clip["title"],
                    "status": "done" if clip_storage_url else "render_failed",
                    "video_url": clip_storage_url or "",
                    "srt_url": srt_storage_url or None,
                    "subtitles_srt": srt_content or None,
                    "words_json": words_json_value,
                    "thumbnail_url": yt_meta["youtube_thumbnail"] if yt_meta and yt_meta["youtube_thumbnail"] else thumb_storage_url,
                    "duration": round(duration, 1),
                    "start_time": clip_start,
                    "end_time": clip["end"],
                    "hook_score": clip.get("hook_score"),
                    "mood": clip.get("mood"),
                    "reason": clip.get("reason"),
                    "engagement_factors": clip.get("engagement_factors"),
                    "retention_prediction": clip.get("retention_prediction"),
                    "youtube_video_id": yt_meta["youtube_video_id"] if yt_meta else None,
                    "youtube_thumbnail": yt_meta["youtube_thumbnail"] if yt_meta else None,
                    "youtube_title": yt_meta["youtube_title"] if yt_meta else None,
                    "youtube_channel": yt_meta["youtube_channel"] if yt_meta else None,
                    "youtube_duration": yt_meta["youtube_duration"] if yt_meta else None
                }
                try:
                    supabase.table("clips").insert(clip_row).execute()
                except Exception as _db_err:
                    msg = str(_db_err)
                    if "words_json" in msg or "Could not find" in msg or "hook_score" in msg or "mood" in msg or "reason" in msg:
                        print(f"CLIP {i+1}: schema cache lag, inserting without new columns...")
                        row_fallback = {k: v for k, v in clip_row.items() if k not in ("words_json", "hook_score", "mood", "reason", "engagement_factors", "retention_prediction")}
                        supabase.table("clips").insert(row_fallback).execute()
                        print(f"CLIP {i+1}: inserted (frontend will load from subtitles_srt fallback)")
                    else:
                        raise

                if not clip_storage_url:
                    print(f"CLIP {i+1}: SKIP — clip_storage_url is empty (transcript stored anyway)")
                    continue

                output_clips.append({
                    "clip": i + 1,
                    "title": clip["title"],
                    "reason": clip["reason"],
                    "mood": clip_mood,
                    "start": clip["start"],
                    "end": clip["end"],
                    "hook_score": clip.get("hook_score", 5),
                    "file": clip_storage_url,
                    "srt_url": srt_storage_url or "",
                    "thumbnail_url": yt_meta["youtube_thumbnail"] if yt_meta and yt_meta["youtube_thumbnail"] else thumb_storage_url,
                    "youtube_video_id": yt_meta["youtube_video_id"] if yt_meta else None,
                    "youtube_thumbnail": yt_meta["youtube_thumbnail"] if yt_meta else None,
                    "youtube_title": yt_meta["youtube_title"] if yt_meta else None,
                    "youtube_channel": yt_meta["youtube_channel"] if yt_meta else None,
                    "youtube_duration": yt_meta["youtube_duration"] if yt_meta else None
                })
        finally:
            for f in local_files:
                try: os.unlink(f)
                except OSError: pass
            for f in temp_files_extra:
                try: os.unlink(f)
                except OSError: pass

        if not output_clips:
            jobs_store[job_id] = {"status": "error", "message": "All clip uploads failed. Check Supabase Storage permissions/bucket."}
            raise Exception("All clip uploads failed")

        jobs_store[job_id] = {"status": "done", "message": f"{len(output_clips)} clips ready", "clips": output_clips}
        return {
            "job_id": job_id,
            "clips": output_clips,
            "total": len(output_clips)
        }



    except Exception as e:
        print(f"PROCESS ERROR: {e}")
        traceback.print_exc()
        jobs_store[job_id] = {"status": "error", "message": str(e)[:200]}

@app.post("/export")
async def export_clip(req: ExportRequest, user: dict = Depends(get_current_user)):
    await check_rate_limit(f"export:{user['sub']}")
    user_id = user["sub"]

    # Check credits
    user_result = supabase.table("users").select("credits,plan").eq("id", user_id).execute()
    if not user_result.data:
        supabase.table("users").insert({"id": user_id, "credits": 3, "plan": "free"}).execute()
        supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
        user_data = {"plan": "free", "credits": 3}
    else:
        user_data = user_result.data[0]
    if user_data["plan"] != "pro" and user_data["credits"] <= 0:
        raise HTTPException(status_code=402, detail="No credits remaining")
    dedent_credits(user_id)

    job_id = str(uuid.uuid4())
    output_ext = req.format if req.format in ("mov", "webm") else "mp4"
    output_filename = f"{job_id}_export.{output_ext}"
    output_path = f"outputs/{output_filename}"
    local_files = []

    validate_video_url(req.video_url)

    cleanup_old_exports()

    source_path = f"downloads/{job_id}_source.mp4"
    subprocess.run([
        'ffmpeg', '-i', req.video_url, '-c', 'copy', source_path, '-y'
    ], capture_output=True, timeout=120)

    if not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Could not download source video")
    local_files.append(source_path)

    probe = subprocess.run([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', source_path
    ], capture_output=True, text=True, timeout=30)

    total_duration = float(probe.stdout.strip() or 30)
    trim_s = req.trim_start / 100 * total_duration
    trim_d = (req.trim_end - req.trim_start) / 100 * total_duration
    trim_d = max(trim_d, 2)

    # Resolution mapping
    res_map = {"720p": "720:1280", "1080p": "1080:1920", "4k": "2160:3840"}
    target_res = res_map.get(req.resolution, "1080:1920")

    temp_files = []

    try:

        target_w, target_h = (int(x) for x in target_res.split(':'))

        vf = f"scale={target_res}:force_original_aspect_ratio=increase,crop={target_res}"

        if req.filter_style == "vivid":
            vf = f"{vf},eq=saturation=1.5:contrast=1.1"
        elif req.filter_style == "cinema":
            vf = f"{vf},eq=contrast=1.2:brightness=-0.1,colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3"
        elif req.filter_style == "bw":
            vf = f"{vf},hue=s=0"
        elif req.filter_style == "warm":
            vf = f"{vf},colorbalance=rs=.3:gs=.1:bs=-.2"
        elif req.filter_style == "cool":
            vf = f"{vf},colorbalance=rs=-.2:gs=.1:bs=.3"

        ass_path = None
        if req.subtitle_style != "none" and req.subtitle_words:
            ass_path = os.path.join(tempfile.gettempdir(), f"{job_id}_subs.ass")
            print(f"[PEAKCLIP] subtitle_style_obj received: {json.dumps(req.subtitle_style_obj, default=str)}")
            print(f"[PEAKCLIP] subtitle_mode: {req.subtitle_mode}")
            generate_ass_karaoke(
                req.subtitle_words, trim_s, trim_s + trim_d, ass_path,
                style=req.subtitle_style_obj,
                target_w=target_w, target_h=target_h,
                mode=req.subtitle_mode
            )
            temp_files.append(ass_path)
            if os.path.exists(ass_path):
                with open(ass_path) as f:
                    ass_content = f.read()
                    print(f"ASS file ({ass_path}) content:\n{ass_content[:2000]}")
            vf = f"{vf},subtitles={ass_path}:fontsdir=/usr/share/fonts/truetype"

        if req.watermark_text:
            pos_map_wm = {
                "top-right": "x=w-tw-20:y=20",
                "top-left": "x=20:y=20",
                "bottom-right": "x=w-tw-20:y=h-th-20",
                "bottom-left": "x=20:y=h-th-20",
            }
            wm_pos = pos_map_wm.get(req.watermark_position, pos_map_wm["top-right"])
            safe_wm = sanitize_drawtext(req.watermark_text)
            wm_textfile = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
            wm_textfile.write(safe_wm)
            wm_textfile.close()
            temp_files.append(wm_textfile.name)
            wm_sub_path = wm_textfile.name.replace("\\", "/")
            wm_filter = f"drawtext=textfile='{wm_sub_path}':fontsize=h/28:fontcolor=white@0.8:borderw=2:bordercolor=black@0.5:{wm_pos}:enable='between(t,0,{trim_d})'"
            vf = f"{vf},{wm_filter}"

        af_parts = []

        music_path = None
        if req.music_track not in ("none", "", 0, "0", None):
            music_path = f"downloads/{job_id}_music.mp3"
            try:
                track_map = {
                    "epic": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                    "hype": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                    "chill": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
                    "gaming": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
                    "viral": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
                }
                music_url = track_map.get(str(req.music_track))
                if music_url:
                    subprocess.run([
                        'ffmpeg', '-i', music_url, '-t', str(trim_d + 1),
                        '-q:a', '0', music_path, '-y'
                    ], capture_output=True)
                    if os.path.exists(music_path):
                        local_files.append(music_path)
                        vol = max(0, min(req.music_volume, 100)) / 100.0
                        af_parts.append(f"[1:a]volume={vol}[music]")
                        af_parts.append("[0:a][music]amix=inputs=2:duration=first:dropout_transition=2")
            except Exception as e:
                print(f"Music mixing failed: {e}")

        af_filter = None
        if af_parts:
            af_filter = ";".join(af_parts)

        vcodec = "libx264"
        acodec = "aac"
        if output_ext == "webm":
            vcodec = "libvpx-vp9"
            acodec = "libopus"
        elif output_ext == "mov":
            vcodec = "libx264"
            acodec = "aac"

        cmd = [
            'ffmpeg',
            '-i', source_path,
            '-ss', str(trim_s),
        ]
        if music_path and os.path.exists(music_path):
            cmd.extend(['-i', music_path])

        crf_map = {"720p": "19", "1080p": "18", "4k": "17"}
        maxrate_map = {"720p": "8M", "1080p": "16M", "4k": "40M"}
        bufsize_map = {"720p": "16M", "1080p": "32M", "4k": "80M"}
        target_crf = crf_map.get(req.resolution, "18")
        target_maxrate = maxrate_map.get(req.resolution, "16M")
        target_bufsize = bufsize_map.get(req.resolution, "32M")

        cmd.extend([
            '-t', str(trim_d),
            '-vf', vf,
            '-r', str(req.fps),
            '-threads', '2',
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', vcodec,
        ])
        if vcodec == 'libx264':
            cmd.extend(['-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart'])
            cmd.extend([
                '-preset', 'veryfast',
                '-crf', target_crf,
                '-maxrate', target_maxrate,
                '-bufsize', target_bufsize,
                '-c:a', acodec,
            ])
        elif vcodec == 'libvpx-vp9':
            cmd.extend([
                '-crf', target_crf,
                '-b:v', '0',
                '-deadline', 'good',
                '-c:a', acodec,
            ])
        else:
            cmd.extend([
                '-preset', 'medium',
                '-crf', target_crf,
                '-c:a', acodec,
            ])
        if acodec == 'aac':
            cmd.extend(['-b:a', '256k'])
        elif acodec == 'libopus':
            cmd.extend(['-b:a', '160k'])
        if af_filter:
            cmd.extend(['-filter_complex', af_filter])
        cmd.extend(['-y', output_path])

        print(f"FFMPEG CMD: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            full_stderr = result.stderr or ""
            full_stdout = result.stdout or ""
            print(f"Export ffmpeg failed (rc={result.returncode}). FULL stderr:\n{full_stderr}")
            if full_stdout:
                print(f"stdout:\n{full_stdout}")
            full_err = full_stderr[:3000] or full_stdout[:1000]
            if result.returncode == -9 or 'signal 9' in full_err.lower() or 'oom' in full_err.lower():
                detail = "Server ran out of memory during export. Try: (1) lower resolution to 720p, (2) shorter duration, (3) fewer filters."
            else:
                detail = f"Export error (rc={result.returncode}): {full_err}"
            raise HTTPException(status_code=400, detail=detail)
        stderr_last = (result.stderr or "")[-2000:]
        if stderr_last.strip():
            print(f"FFMPEG OK - stderr tail:\n{stderr_last}")
        local_files.append(output_path)

        # Upload to Supabase Storage
        storage_path = f"exports/{output_filename}"
        public_url = upload_with_verification(
            supabase, "clips", output_path, storage_path, f"video/{output_ext}"
        ) or ""

        # Generate signed URL (works whether bucket is public or not)
        signed_url = public_url
        if supabase and storage_path:
            try:
                signed = supabase.storage.from_("clips").create_signed_url(storage_path, 3600)
                if signed and isinstance(signed, dict) and signed.get("signedURL"):
                    signed_url = signed["signedURL"]
            except Exception as e:
                print(f"Export: signed URL fallback to public: {e}")

        # NOTE: Do NOT update clip.video_url — the project must keep the original video.
        # The exported file is returned as a download URL only, never replacing the project source.

        return {
            "success": True,
            "video_url": signed_url,
            "message": "Clip exported successfully"
        }
    finally:
        for f in local_files:
            try: os.unlink(f)
            except OSError: pass
        for f in temp_files:
            try: os.unlink(f)
            except OSError: pass


@app.post("/create-checkout-session")
async def create_checkout_session(data: dict, user: dict = Depends(get_current_user)):
    await check_rate_limit(f"checkout:{user['sub']}")
    user_id = user["sub"]
    price_id = data.get("price_id")
    return_url = data.get("return_url", f"{FRONTEND_URL}/dashboard")

    if not price_id:
        raise HTTPException(status_code=400, detail="Missing price_id")

    # Only allow known price IDs — reject arbitrary prices
    allowed_prices = {os.getenv("STRIPE_PRICE_CREATOR", "price_creator"), os.getenv("STRIPE_PRICE_PRO", "price_pro")}
    if price_id not in allowed_prices:
        raise HTTPException(status_code=400, detail="Invalid price_id")

    try:
        # Find or create Stripe Customer
        user_result = supabase.table("users").select("email,stripe_customer_id").eq("id", user_id).execute()
        user_email = user_result.data[0]["email"] if user_result.data else None
        customer_id = user_result.data[0].get("stripe_customer_id") if user_result.data else None

        if not customer_id:
            customer = stripe.Customer.create(
                email=user_email,
                metadata={"user_id": user_id},
            )
            customer_id = customer.id
            supabase.table("users").update({"stripe_customer_id": customer_id}).eq("id", user_id).execute()

        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=return_url + "?plan=success",
            cancel_url=return_url + "?plan=cancelled",
            metadata={"user_id": user_id, "price_id": price_id},
        )
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/stripe-webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, os.getenv("STRIPE_WEBHOOK_SECRET")
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type")
    session = event["data"]["object"]

    plan_map = {
        STRIPE_PRICE_CREATOR: "creator",
        STRIPE_PRICE_PRO: "pro",
    }

    if event_type == "checkout.session.completed":
        user_id = session["metadata"]["user_id"]
        price_id = session["metadata"].get("price_id", "")
        plan = plan_map.get(price_id, "creator")
        credit_amount = 999 if plan == "pro" else 200
        subscription_id = session.get("subscription")
        period_end = None
        if subscription_id:
            try:
                subscription = stripe.Subscription.retrieve(subscription_id)
                period_end = datetime.fromtimestamp(subscription.current_period_end, tz=timezone.utc).isoformat()
            except Exception:
                pass
        supabase.table("users").update({
            "plan": plan,
            "credits": credit_amount,
            "subscription_id": subscription_id,
            "subscription_status": "active",
            "current_period_end": period_end,
        }).eq("id", user_id).execute()
        try:
            supabase.table("credit_transactions").insert({
                "user_id": user_id,
                "amount": credit_amount,
                "type": "purchase",
            }).execute()
        except Exception as e:
            print(f"credit_transactions insert failed (non-fatal): {e}")

    elif event_type == "customer.subscription.deleted":
        sub_id = session.get("id")
        user_result = supabase.table("users").select("id").eq("subscription_id", sub_id).execute()
        if user_result.data:
            user_id = user_result.data[0]["id"]
            supabase.table("users").update({
                "plan": "free",
                "credits": 0,
                "subscription_status": "canceled",
                "subscription_id": None,
            }).eq("id", user_id).execute()

    elif event_type == "invoice.paid":
        sub_id = session.get("subscription")
        period_end = None
        if session.get("period_end"):
            period_end = datetime.fromtimestamp(session["period_end"], tz=timezone.utc).isoformat()
        if sub_id:
            user_result = supabase.table("users").select("id,plan").eq("subscription_id", sub_id).execute()
            if user_result.data:
                user_id = user_result.data[0]["id"]
                plan = user_result.data[0].get("plan", "creator")
                credit_amount = 999 if plan == "pro" else 200
                supabase.table("users").update({
                    "subscription_status": "active",
                    "credits": credit_amount,
                    "current_period_end": period_end,
                }).eq("id", user_id).execute()
                try:
                    supabase.table("credit_transactions").insert({
                        "user_id": user_id,
                        "amount": credit_amount,
                        "type": "purchase",
                    }).execute()
                except Exception as e:
                    print(f"credit_transactions insert failed (non-fatal): {e}")

    elif event_type == "invoice.payment_failed":
        sub_id = session.get("subscription")
        if sub_id:
            user_result = supabase.table("users").select("id").eq("subscription_id", sub_id).execute()
            if user_result.data:
                supabase.table("users").update({
                    "subscription_status": "past_due",
                }).eq("id", user_result.data[0]["id"]).execute()

    return {"received": True}


@app.get("/clips")
def get_user_clips(user: dict = Depends(get_current_user)):
    user_id = user["sub"]
    result = supabase.table("clips").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    return {"clips": result.data}


@app.get("/status/{job_id}")
async def get_job_status(job_id: str, user: dict = Depends(get_current_user)):
    job = jobs_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("user_id") and job["user_id"] != user["sub"]:
        raise HTTPException(status_code=403, detail="Job does not belong to this user")
    return job


@app.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    url: str = Form(""),
    user: dict = Depends(get_current_user),
):
    await check_rate_limit(f"upload:{user['sub']}")
    user_id = user["sub"]
    job_id = str(uuid.uuid4())

    yt_meta = fetch_youtube_metadata(url)

    user_result = supabase.table("users").select("credits,plan").eq("id", user_id).execute()
    if not user_result.data:
        supabase.table("users").insert({"id": user_id, "credits": 3, "plan": "free"}).execute()
        supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
        user_data = {"plan": "free", "credits": 3}
    else:
        user_data = user_result.data[0]
        if user_data["plan"] != "pro" and user_data["credits"] <= 0:
            tx_result = supabase.table("credit_transactions").select("id").eq("user_id", user_id).eq("type", "free_grant").limit(1).execute()
            if not tx_result.data:
                supabase.table("users").update({"credits": 3}).eq("id", user_id).execute()
                supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
                user_data["credits"] = 3
            else:
                raise HTTPException(status_code=402, detail="No credits remaining")

    if user_data["plan"] != "pro":
        dedent_credits(user_id)

    video_path = f"downloads/{job_id}.mp4"
    audio_path = f"downloads/{job_id}.mp3"
    local_files = [video_path, audio_path]

    # Save uploaded file
    content = await file.read()
    with open(video_path, "wb") as f:
        f.write(content)
    print(f"UPLOAD: saved {len(content)} bytes to {video_path}")

    jobs_store[job_id] = {"status": "processing", "message": "Extracting audio..."}

    ffmpeg_result = subprocess.run([
        'ffmpeg', '-i', video_path, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '24k', audio_path, '-y'
    ], capture_output=True, timeout=300)
    if ffmpeg_result.returncode != 0:
        stderr = (ffmpeg_result.stderr or b'').decode('utf-8', 'ignore')[-500:]
        raise Exception(f"ffmpeg audio extraction failed: {stderr}")
    if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1024:
        raise Exception("Extracted audio file is missing or empty")
    print(f"UPLOAD {job_id}: audio extracted ({os.path.getsize(audio_path)} bytes)")

    thumb_path = f"thumbnails/{job_id}.jpg"
    generate_thumbnail(video_path, thumb_path)
    local_files.append(thumb_path)

    jobs_store[job_id] = {"status": "processing", "message": "Transcribing audio..."}

    try:
        with open(audio_path, 'rb') as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
                timeout=300,
            )
    except Exception as e:
        print(f"UPLOAD {job_id}: Whisper transcription failed: {e}")
        # Try Groq fallback
        if groq_client:
            try:
                with open(audio_path, 'rb') as f:
                    transcript = groq_client.audio.transcriptions.create(
                        model="whisper-large-v3-turbo",
                        file=f,
                        response_format="verbose_json",
                        timestamp_granularities=["word", "segment"],
                        timeout=120,
                    )
                print(f"UPLOAD {job_id}: Groq Whisper OK")
            except Exception as groq_e:
                print(f"UPLOAD {job_id}: Groq transcription also failed: {groq_e}")
                raise Exception(f"Transcription failed: {e}")
        else:
            raise Exception(f"Transcription failed: {e}")

    words_data = []
    if hasattr(transcript, 'words') and transcript.words:
        for w in transcript.words:
            word_text = getattr(w, 'word', '') or ''
            w_start = getattr(w, 'start', None)
            w_end = getattr(w, 'end', None)
            if w_start is not None and w_end is not None and word_text.strip():
                words_data.append({"word": word_text, "start": w_start, "end": w_end})

    segments_text = "\n".join([
        f"[{s.start:.1f}s - {s.end:.1f}s]: {s.text}"
        for s in transcript.segments
    ])

    jobs_store[job_id] = {"status": "processing", "message": "Analyzing viral moments with AI..."}

    response = None
    analysis_transcript = compact_analysis_transcript(segments_text)
    analysis_body = [{
        "role": "system",
        "content": "You are a viral clip analyzer. Return ONLY valid JSON, no markdown, no code fences.",
    }, {
        "role": "user",
        "content": f"""Analyze this transcript and return the 2 best viral moments for YouTube Shorts/TikTok.

Transcript:
 {analysis_transcript}

RULES:
- Return exactly 2 clips.
- Each clip should be at least 10 seconds long — capture enough context for the viral moment.
- Prioritize: strong hooks, emotional peaks, surprising twists, humor, high-energy moments, or controversy.
- Distribute clips across the video timeline — don't cluster them together.
- Classify mood as: epic, hype, chill, funny, emotional, suspense.
- Include a hook_score from 1-10 ranking virality potential.
- Include engagement_factors: an array of strings identifying what makes it viral (e.g. "strong_hook", "emotional_peak", "surprise", "humor", "controversy", "high_energy", "relatable", "shock_value").
- Include retention_prediction: estimated percentage of viewers who'd watch the full clip (1-100).

Return JSON with this exact format:
{{"clips": [
  {{"start": 10.5, "end": 40.2, "title": "Clip title", "reason": "Why viral", "mood": "hype", "hook_score": 9, "engagement_factors": ["strong_hook", "emotional_peak"], "retention_prediction": 82}},
  {{"start": 120.0, "end": 150.5, "title": "Clip title 2", "reason": "Why viral", "mood": "funny", "hook_score": 8, "engagement_factors": ["humor", "relatable"], "retention_prediction": 75}}
]}}"""
    }]
    try:
        response = client.chat.completions.create(
            model="gpt-4o", response_format={"type": "json_object"},
            timeout=120, messages=analysis_body,
        )
    except Exception as e:
        err_msg = str(e).lower()
        if ("insufficient_quota" in err_msg or "429" in err_msg or "exceeded" in err_msg or "incorrect api key" in err_msg or "401" in err_msg or "invalid_api_key" in err_msg) and groq_client:
            print(f"UPLOAD {job_id}: OpenAI quota/key error for analysis, using Groq...")
            try:
                response = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    response_format={"type": "json_object"},
                    timeout=60, messages=analysis_body,
                )
            except Exception as groq_ai_err:
                print(f"UPLOAD {job_id}: Groq analysis also failed: {groq_ai_err}")
                response = None
        else:
            print(f"UPLOAD {job_id}: AI analysis error: {e}")
            response = None

    if response and response.choices:
        raw = response.choices[0].message.content.strip()
    else:
        raw = None
    if raw:
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("\n", 1)[0]
            if raw.endswith("```"):
                raw = raw[:-3]
        try:
            clips_data = json.loads(raw)
        except json.JSONDecodeError:
            clips_data = {"clips": []}
    else:
        clips_data = {"clips": []}
    clips_data["clips"].sort(key=lambda c: c.get("hook_score", 5), reverse=True)

    # Pad to exactly 2 clips if AI returned fewer
    if len(clips_data["clips"]) < 2:
        existing = clips_data["clips"][:]
        last_end = max((c["end"] for c in existing), default=0)
        total_duration = words_data[-1].get('end', 0) if words_data else 600
        total_duration = max(total_duration, 60)
        step = (total_duration - last_end) / max(1, 2 - len(existing))
        for j in range(len(existing), 2):
            pad_start = last_end + (j - len(existing) + 1) * step
            pad_end = min(pad_start + 45, total_duration)
            clips_data["clips"].append({
                "start": pad_start, "end": pad_end,
                "title": f"Highlight {j+1}", "reason": "Auto-selected highlight",
                "mood": "chill", "hook_score": 5,
                "engagement_factors": ["auto_selected"], "retention_prediction": 50
            })

    output_clips = []
    temp_files_extra = []

    try:
        for i, clip in enumerate(clips_data["clips"]):
            output_path = f"outputs/{job_id}_clip{i+1}.mp4"
            clip_start = clip["start"]
            raw_duration = clip["end"] - clip["start"]
            duration = max(15, raw_duration)
            clip["end"] = clip_start + duration
            clip_mood = clip.get("mood", "chill")

            srt_path = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}.srt")
            generate_srt_subtitle(words_data, clip_start, clip["end"], srt_path)
            temp_files_extra.append(srt_path)

            music_path = resolve_music_path(clip_mood)
            
            no_subs = f"outputs/{job_id}_clip{i+1}_nosubs.mp4"
            local_files.append(no_subs)

            # ── Step 1: Extract raw clip segment ──
            raw_clip = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}_raw.mp4")
            extract_cmd = [
                'ffmpeg', '-y', '-ss', str(clip_start),
                '-i', video_path, '-t', str(duration),
                '-c', 'copy', raw_clip
            ]
            subprocess.run(extract_cmd, capture_output=True, timeout=120)

            # ── Step 2: Smart reframe ──
            reframed = os.path.join(tempfile.gettempdir(), f"{job_id}_clip{i+1}_reframed.mp4")
            try:
                from smart_reframe import smart_reframe
                smart_reframe(raw_clip, reframed, target_w=1080, target_h=1920)
            except Exception as e:
                print(f"CLIP {i+1}: smart_reframe failed ({e}), falling back to static crop")
                fallback_cmd = [
                    'ffmpeg', '-y', '-i', raw_clip,
                    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    reframed
                ]
                subprocess.run(fallback_cmd, capture_output=True, timeout=300)

            if not (os.path.exists(reframed) and os.path.getsize(reframed) >= 1024):
                print(f"CLIP {i+1}: reframing failed, skipping")
                continue

            # ── Step 3: Mix audio + attach SRT metadata ──
            cmd = ['ffmpeg', '-y', '-i', reframed]
            if music_path:
                music_path_ff = music_path.replace('\\', '/')
                cmd += ['-stream_loop', '-1', '-i', music_path_ff]
                cmd += ['-filter_complex',
                        '[0:a]volume=1.0[a_main];[1:a]volume=0.15[a_music];[a_main][a_music]amix=inputs=2:duration=first:dropout_transition=2[a]']
                cmd += ['-map', '[a]']
            else:
                cmd += ['-map', '0:a']

            cmd += ['-map', '0:v',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest',
                    '-movflags', '+faststart', '-y', no_subs]
            print(f"CLIP {i+1}: muxing...")
            subprocess.run(cmd, capture_output=True, timeout=180)

            # Upload video (no subs burned)
            storage_path = f"{job_id}/{job_id}_clip{i+1}.mp4"
            clip_storage_url = upload_with_verification(
                supabase, "clips", no_subs, storage_path, "video/mp4"
            ) or ""

            # Upload SRT separately
            srt_storage_url = ""
            srt_content = ""
            if os.path.exists(srt_path) and os.path.getsize(srt_path) > 0:
                srt_storage_path = f"{job_id}/{job_id}_clip{i+1}.srt"
                srt_storage_url = upload_with_verification(
                    supabase, "clips", srt_path, srt_storage_path, "text/plain"
                ) or ""
                try:
                    with open(srt_path, 'r', encoding='utf-8') as _sf:
                        srt_content = _sf.read()
                except Exception:
                    srt_content = ""

            thumb_storage_path = f"thumbnails/{job_id}.jpg"
            thumb_storage_url = upload_with_verification(
                supabase, "clips", thumb_path, thumb_storage_path, "image/jpeg"
            ) or ""

            if not clip_storage_url:
                print(f"Skipping clip {i+1} insert because upload verification failed.")
                continue

            clip_id = str(uuid.uuid4())
            words_json_value = json.dumps(words_data) if words_data else None
            clip_row = {
                "id": clip_id,
                "user_id": user_id,
                "title": clip["title"],
                "status": "done",
                "video_url": clip_storage_url,
                "srt_url": srt_storage_url or None,
                "subtitles_srt": srt_content or None,
                "words_json": words_json_value,
                "thumbnail_url": yt_meta["youtube_thumbnail"] if yt_meta and yt_meta["youtube_thumbnail"] else thumb_storage_url,
                "duration": round(duration, 1),
                "start_time": clip_start,
                "end_time": clip["end"],
                "hook_score": clip.get("hook_score"),
                "mood": clip.get("mood"),
                "reason": clip.get("reason"),
                "engagement_factors": clip.get("engagement_factors"),
                "retention_prediction": clip.get("retention_prediction"),
                "youtube_video_id": yt_meta["youtube_video_id"] if yt_meta else None,
                "youtube_thumbnail": yt_meta["youtube_thumbnail"] if yt_meta else None,
                "youtube_title": yt_meta["youtube_title"] if yt_meta else None,
                "youtube_channel": yt_meta["youtube_channel"] if yt_meta else None,
                "youtube_duration": yt_meta["youtube_duration"] if yt_meta else None
            }
            try:
                supabase.table("clips").insert(clip_row).execute()
            except Exception as _db_err:
                msg = str(_db_err)
                if "words_json" in msg or "Could not find" in msg or "hook_score" in msg or "mood" in msg or "reason" in msg:
                    print(f"CLIP {i+1}: schema cache lag, inserting without new columns...")
                    row_fallback = {k: v for k, v in clip_row.items() if k not in ("words_json", "hook_score", "mood", "reason", "engagement_factors", "retention_prediction")}
                    supabase.table("clips").insert(row_fallback).execute()
                    print(f"CLIP {i+1}: inserted (frontend will load from subtitles_srt fallback)")
                else:
                    raise

            output_clips.append({
                "clip": i + 1,
                "title": clip["title"],
                "reason": clip["reason"],
                "mood": clip_mood,
                "start": clip["start"],
                "end": clip["end"],
                "hook_score": clip.get("hook_score", 5),
                "file": clip_storage_url,
                "srt_url": srt_storage_url or "",
                "thumbnail_url": yt_meta["youtube_thumbnail"] if yt_meta and yt_meta["youtube_thumbnail"] else thumb_storage_url,
                "youtube_video_id": yt_meta["youtube_video_id"] if yt_meta else None,
                "youtube_thumbnail": yt_meta["youtube_thumbnail"] if yt_meta else None,
                "youtube_title": yt_meta["youtube_title"] if yt_meta else None,
                "youtube_channel": yt_meta["youtube_channel"] if yt_meta else None,
                "youtube_duration": yt_meta["youtube_duration"] if yt_meta else None
            })

        if not output_clips:
            jobs_store[job_id] = {"status": "error", "message": "All clip uploads failed. Check Supabase Storage permissions/bucket."}
            raise Exception("All clip uploads failed")

        jobs_store[job_id] = {"status": "done", "message": f"{len(output_clips)} clips ready"}
    except Exception as e:
        jobs_store[job_id] = {"status": "error", "message": str(e)[:200]}
        raise
    finally:
        for f in local_files:
            try: os.unlink(f)
            except OSError: pass
        for f in temp_files_extra:
            try: os.unlink(f)
            except OSError: pass

    return {
        "job_id": job_id,
        "clips": output_clips,
        "total": len(output_clips)
    }


# ── AI RANKING: search YouTube, analyze viral moments, rank across videos ──

class RankingRequest(BaseModel):
    topic: str
    count: int = 5
    video_length: int = 30
    language: str = "English"


ranking_jobs: dict = {}


@app.post("/api/ranking")
async def start_ranking(req: RankingRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    await check_rate_limit(f"ranking:{user['sub']}")
    user_id = user["sub"]

    user_result = supabase.table("users").select("credits,plan").eq("id", user_id).execute()
    if not user_result.data:
        supabase.table("users").insert({"id": user_id, "credits": 3, "plan": "free"}).execute()
        supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
        user_data = {"plan": "free", "credits": 3}
    else:
        user_data = user_result.data[0]
        if user_data["plan"] != "pro" and user_data["credits"] <= 0:
            tx_result = supabase.table("credit_transactions").select("id").eq("user_id", user_id).eq("type", "free_grant").limit(1).execute()
            if not tx_result.data:
                supabase.table("users").update({"credits": 3}).eq("id", user_id).execute()
                supabase.table("credit_transactions").insert({"user_id": user_id, "amount": 3, "type": "free_grant"}).execute()
                user_data["credits"] = 3
            else:
                raise HTTPException(status_code=402, detail="No credits remaining")

    ranking_id = str(uuid.uuid4())
    ranking_jobs[ranking_id] = {"status": "processing", "user_id": user_id, "step": "searching", "progress": 0, "results": None}

    supabase.table("rankings").insert({
        "id": ranking_id,
        "user_id": user_id,
        "topic": req.topic,
        "count": req.count,
        "video_length": req.video_length,
        "status": "processing",
    }).execute()

    background_tasks.add_task(run_ranking_background, ranking_id, user_id, req.topic, req.count, req.video_length, req.language)
    return {"ranking_id": ranking_id, "status": "processing"}


@app.get("/api/ranking/{ranking_id}")
async def get_ranking(ranking_id: str, user: dict = Depends(get_current_user)):
    job = ranking_jobs.get(ranking_id)
    if not job:
        raise HTTPException(status_code=404, detail="Ranking not found")
    if job.get("user_id") != user["sub"]:
        raise HTTPException(status_code=403, detail="Not your ranking")
    return job


def run_ranking_background(ranking_id: str, user_id: str, topic: str, count: int, video_length: int, language: str):
    search_count = min(count * 4, 20)
    candidate_videos = []
    all_moments = []
    local_files = []

    try:
        # ── STEP 1: Search YouTube ──
        ranking_jobs[ranking_id] = {"status": "processing", "user_id": user_id, "step": "searching", "progress": 5, "message": f"Searching YouTube for '{topic}'...", "results": None}
        print(f"RANKING {ranking_id}: searching YouTube for '{topic}' ({search_count} results)")

        proxy_url = os.environ.get('YOUTUBE_PROXY')
        has_cookies = os.path.exists(COOKIES_PATH)

        search_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
            'noplaylist': True,
            'default_search': 'ytsearch',
            'socket_timeout': 30,
            'geo_bypass': True,
            'no_check_certificate': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            },
        }
        if proxy_url:
            search_opts['proxy'] = proxy_url
        if has_cookies:
            search_opts['cookiefile'] = COOKIES_PATH

        search_url = f"ytsearch{search_count}:{topic}"
        ytdlp_script = os.path.join(os.path.dirname(__file__), 'ytdlp_download.py')
        sub_opts = dict(search_opts)
        sub_opts['url'] = search_url
        try:
            result = subprocess.run(
                [sys.executable, ytdlp_script, json.dumps(sub_opts)],
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode == 0 and result.stdout.strip():
                entries = json.loads(result.stdout.strip())
                if isinstance(entries, list):
                    candidate_videos = [e for e in entries if e.get('url') or e.get('id')]
                    print(f"RANKING {ranking_id}: found {len(candidate_videos)} videos")
        except Exception as e:
            print(f"RANKING {ranking_id}: search failed: {e}")

        if not candidate_videos:
            ranking_jobs[ranking_id] = {"status": "error", "user_id": user_id, "message": "No videos found for this topic"}
            supabase.table("rankings").update({"status": "error", "error": "No videos found"}).eq("id", ranking_id).execute()
            return

        # ── STEP 2: Download + Transcribe + Analyze each video ──
        for vi, entry in enumerate(candidate_videos):
            if len(all_moments) >= count * 3:
                break

            video_url = entry.get('url') or f"https://www.youtube.com/watch?v={entry.get('id', '')}"
            video_title = entry.get('title', f'Video {vi+1}')
            video_id = entry.get('id', '')
            progress = 10 + int(60 * vi / len(candidate_videos))
            ranking_jobs[ranking_id] = {"status": "processing", "user_id": user_id, "step": "analyzing", "progress": progress, "message": f"Analyzing video {vi+1}/{min(len(candidate_videos), count*4)}: {video_title[:50]}...", "results": None}

            try:
                video_path = f"downloads/ranking_{ranking_id}_{vi}.mp4"
                audio_path = f"downloads/ranking_{ranking_id}_{vi}.mp3"
                local_files.extend([video_path, audio_path])

                # Download with best available strategy
                dl_opts = {
                    'format': 'best[height<=720][ext=mp4]/best[height<=720]/best',
                    'outtmpl': video_path,
                    'quiet': True,
                    'no_warnings': True,
                    'noplaylist': True,
                    'socket_timeout': 45,
                    'geo_bypass': True,
                    'no_check_certificate': True,
                    'http_headers': {
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
                    },
                }
                if proxy_url:
                    dl_opts['proxy'] = proxy_url
                if has_cookies:
                    dl_opts['cookiefile'] = COOKIES_PATH
                dl_opts['extractor_args'] = {'youtube': {'player_client': ['android'], 'player_skip': ['webpage', 'configs'], 'include_incomplete_formats': True}}
                if BGUTIL_POT_AVAILABLE:
                    dl_opts['extractor_args']['youtubepot-bgutilhttp'] = {}

                dl_sub_opts = dict(dl_opts)
                dl_sub_opts['url'] = video_url
                dl_result = subprocess.run(
                    [sys.executable, ytdlp_script, json.dumps(dl_sub_opts)],
                    capture_output=True, text=True, timeout=120,
                )
                if dl_result.returncode != 0 or not os.path.exists(video_path) or os.path.getsize(video_path) < 1024:
                    print(f"RANKING {ranking_id}: video {vi+1} download failed, skipping")
                    continue

                # Extract audio
                subprocess.run([
                    'ffmpeg', '-y', '-i', video_path,
                    '-vn', '-ar', '16000', '-ac', '1', '-b:a', '32k', audio_path
                ], capture_output=True, timeout=120)

                if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1024:
                    print(f"RANKING {ranking_id}: video {vi+1} audio extraction failed, skipping")
                    continue

                # Transcribe
                transcript = None
                try:
                    with open(audio_path, 'rb') as f:
                        transcript = client.audio.transcriptions.create(
                            model="whisper-1", file=f,
                            response_format="verbose_json",
                            timestamp_granularities=["word", "segment"],
                        )
                except Exception as e:
                    print(f"RANKING {ranking_id}: video {vi+1} OpenAI transcription failed: {e}")
                    if groq_client:
                        try:
                            with open(audio_path, 'rb') as f:
                                transcript = groq_client.audio.transcriptions.create(
                                    model="whisper-large-v3-turbo", file=f,
                                    response_format="verbose_json",
                                    timestamp_granularities=["word", "segment"],
                                )
                        except Exception as ge:
                            print(f"RANKING {ranking_id}: video {vi+1} Groq transcription also failed: {ge}")

                if not transcript or not hasattr(transcript, 'segments') or not transcript.segments:
                    print(f"RANKING {ranking_id}: video {vi+1} no transcript, skipping")
                    continue

                segments_text = "\n".join([
                    f"[{s.start:.1f}s - {s.end:.1f}s]: {s.text}"
                    for s in transcript.segments
                ])
                analysis_transcript = compact_analysis_transcript(segments_text)

                # AI analysis
                analysis_body = [{
                    "role": "system",
                    "content": "You are a viral clip analyzer. Return ONLY valid JSON, no markdown, no code fences.",
                }, {
                    "role": "user",
                    "content": f"""Analyze this transcript and return the 2 best viral moments for YouTube Shorts/TikTok.

Transcript:
 {analysis_transcript}

RULES:
- Return exactly 2 clips.
- Each clip should be at least 10 seconds long.
- Prioritize: strong hooks, emotional peaks, surprising twists, humor, high-energy moments, or controversy.
- Classify mood as: epic, hype, chill, funny, emotional, suspense.
- Include a hook_score from 1-10 ranking virality potential.
- Include engagement_factors: array of strings (e.g. "strong_hook", "emotional_peak", "surprise", "humor", "controversy", "high_energy", "relatable", "shock_value").
- Include retention_prediction: estimated % of viewers who'd watch the full clip (1-100).

Return JSON: {{"clips": [
  {{"start": 10.5, "end": 40.2, "title": "Clip title", "reason": "Why viral", "mood": "hype", "hook_score": 9, "engagement_factors": ["strong_hook"], "retention_prediction": 82}}
]}}"""
                }]

                ai_response = None
                try:
                    ai_response = client.chat.completions.create(
                        model="gpt-4o", response_format={"type": "json_object"},
                        timeout=90, messages=analysis_body,
                    )
                except Exception as e:
                    if groq_client:
                        try:
                            ai_response = groq_client.chat.completions.create(
                                model="llama-3.3-70b-versatile",
                                response_format={"type": "json_object"},
                                timeout=60, messages=analysis_body,
                            )
                        except Exception:
                            pass

                if ai_response and ai_response.choices:
                    raw = ai_response.choices[0].message.content.strip()
                    if raw.startswith("```"):
                        raw = raw.split("\n", 1)[-1].rsplit("\n", 1)[0]
                        if raw.endswith("```"):
                            raw = raw[:-3]
                    try:
                        clips_data = json.loads(raw)
                        for c in clips_data.get("clips", []):
                            all_moments.append({
                                "video_url": video_url,
                                "video_id": video_id,
                                "video_title": video_title,
                                "video_thumbnail": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg" if video_id else "",
                                "start": c.get("start", 0),
                                "end": c.get("end", 0),
                                "title": c.get("title", ""),
                                "reason": c.get("reason", ""),
                                "mood": c.get("mood", "chill"),
                                "hook_score": c.get("hook_score", 5),
                                "engagement_factors": c.get("engagement_factors", []),
                                "retention_prediction": c.get("retention_prediction", 50),
                            })
                    except json.JSONDecodeError:
                        pass

            except Exception as e:
                print(f"RANKING {ranking_id}: video {vi+1} error: {e}")
                continue

        # ── STEP 3: Rank all moments ──
        ranking_jobs[ranking_id] = {"status": "processing", "user_id": user_id, "step": "ranking", "progress": 85, "message": "Ranking viral moments across all videos...", "results": None}

        all_moments.sort(key=lambda m: (m.get("hook_score", 5) * 10 + m.get("retention_prediction", 50) / 10), reverse=True)
        top_moments = all_moments[:count]

        for rank, moment in enumerate(top_moments):
            moment["rank"] = rank + 1

        ranking_jobs[ranking_id] = {"status": "done", "user_id": user_id, "step": "done", "progress": 100, "results": top_moments, "total_analyzed": len(candidate_videos), "total_moments": len(all_moments)}

        supabase.table("rankings").update({
            "status": "done",
            "results": json.dumps(top_moments),
        }).eq("id", ranking_id).execute()

        print(f"RANKING {ranking_id}: done — {len(top_moments)} ranked moments from {len(candidate_videos)} videos, {len(all_moments)} total moments")

    except Exception as e:
        print(f"RANKING {ranking_id}: fatal error: {e}")
        traceback.print_exc()
        ranking_jobs[ranking_id] = {"status": "error", "user_id": user_id, "message": str(e)[:200]}
        supabase.table("rankings").update({"status": "error", "error": str(e)[:200]}).eq("id", ranking_id).execute()
    finally:
        for f in local_files:
            try:
                os.unlink(f)
            except OSError:
                pass


@app.get("/admin/oauth-status")
async def admin_oauth_status(request: Request):
    auth = request.headers.get('X-Admin-Key', '')
    admin_key = os.environ.get('ADMIN_KEY')
    if not admin_key or auth != admin_key:
        raise HTTPException(403, "Unauthorized")
    if not os.path.exists(OAUTH_TOKEN_PATH):
        return {"status": "no_tokens", "message": "No OAuth2 tokens configured. Set YOUTUBE_OAUTH_TOKENS_B64"}
    try:
        with open(OAUTH_TOKEN_PATH, 'r') as f:
            tokens = json.load(f)
        expires = tokens.get('expires', 0)
        expires_in = int(expires - time.time())
        return {
            "status": "expired" if expires_in <= 0 else "valid",
            "expires_in_seconds": max(0, expires_in),
            "has_refresh_token": bool(tokens.get('refresh_token')),
            "has_access_token": bool(tokens.get('access_token')),
            "can_auto_refresh": bool(tokens.get('refresh_token')),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/admin/refresh-oauth")
async def admin_refresh_oauth(request: Request):
    auth = request.headers.get('X-Admin-Key', '')
    admin_key = os.environ.get('ADMIN_KEY')
    if not admin_key or auth != admin_key:
        raise HTTPException(403, "Unauthorized")
    setup_oauth2_tokens()
    if not os.path.exists(OAUTH_TOKEN_PATH):
        raise HTTPException(400, "No OAuth2 tokens configured. Set YOUTUBE_OAUTH_TOKENS_B64")
    success = refresh_oauth2_tokens()
    if success:
        with open(OAUTH_TOKEN_PATH, 'r') as f:
            tokens = json.load(f)
        expires_in = max(0, int(tokens.get('expires', 0) - time.time()))
        return {"success": True, "message": "OAuth2 token refreshed", "expires_in_seconds": expires_in}
    raise HTTPException(500, "Token refresh failed. Re-run oauth_setup.py and update YOUTUBE_OAUTH_TOKENS_B64")


@app.get("/create-portal-session")
async def create_portal_session(user: dict = Depends(get_current_user)):
    from fastapi.responses import RedirectResponse
    user_id = user["sub"]
    user_result = supabase.table("users").select("email,stripe_customer_id").eq("id", user_id).execute()
    if not user_result.data:
        return RedirectResponse(url=f"{FRONTEND_URL}/dashboard?tab=settings&error=user_not_found")

    customer_id = user_result.data[0].get("stripe_customer_id")
    if not customer_id:
        return RedirectResponse(url=f"{FRONTEND_URL}/dashboard?tab=settings&error=no_customer")

    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_URL}/dashboard?tab=settings",
        )
        return RedirectResponse(url=session.url)
    except Exception as e:
        return RedirectResponse(url=f"{FRONTEND_URL}/dashboard?tab=settings&error={str(e)[:50]}")


@app.get("/debug/fonts")
async def debug_fonts():
    import subprocess, glob
    try:
        r = subprocess.run(["fc-list", ":lang=en"], capture_output=True, text=True, timeout=15)
        fc_out = r.stdout
    except Exception as e:
        fc_out = f"fc-list error: {e}"
    try:
        r = subprocess.run(["fc-list", "--format=%{family}\n"], capture_output=True, text=True, timeout=15)
        fc_families = sorted(set(r.stdout.strip().splitlines()))
    except Exception:
        fc_families = []
    ttf_files = glob.glob("/usr/share/fonts/**/*.ttf", recursive=True)
    fc_matches = {}
    for name in ("Montserrat", "Inter", "FreeSans", "Noto Sans"):
        try:
            r = subprocess.run(["fc-match", "-v", name], capture_output=True, text=True, timeout=10)
            fc_matches[name] = r.stdout[:500]
        except Exception as e:
            fc_matches[name] = str(e)
    # Also test weight-specific lookups (what libass would request)
    for query in ("Montserrat:weight=bold", "Montserrat:weight=extra bold", "Inter:weight=bold"):
        try:
            r = subprocess.run(["fc-match", "-v", query], capture_output=True, text=True, timeout=10)
            # Extract just family, style, weight, file
            lines = r.stdout.splitlines()
            key = query.replace(":weight=", " w")
            fc_matches[key] = [l.strip() for l in lines if any(x in l for x in ("family:", "style:", "weight:", "file:"))][:8]
        except Exception as e:
            fc_matches[query] = str(e)
    return {
        "families": fc_families,
        "fc_matches": fc_matches,
        "ttf_files": ttf_files,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
