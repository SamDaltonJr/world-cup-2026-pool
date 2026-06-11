import { createClient } from "@supabase/supabase-js";

// These come from Vite env vars. In a client-side app the anon key is meant
// to be public — access is controlled by Row-Level Security in Supabase, not
// by hiding the key. See SETUP.md.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured ? createClient(url, anonKey) : null;
