import { supabase, isConfigured } from "./supabaseClient.js";

// A small key/value layer backed by a single Supabase table `kv`:
//   key text primary key, value text, updated_at timestamptz
//
// It deliberately mirrors the shape of the old Claude Artifacts
// `window.storage` API the component was written against, so the UI code can
// stay almost identical:
//   await storage.get(key)    -> { value: string | null }
//   await storage.set(key, value)
//   await storage.list(prefix) -> { keys: string[] }
//   await storage.delete(key)
//
// If Supabase env vars are missing we fall back to localStorage so the app
// still runs locally (per-device, NOT shared) and surfaces a clear warning in
// the UI via `isConfigured`.

const TABLE = "kv";

function lsKey(key) {
  return "wcpool:" + key;
}

const localFallback = {
  async get(key) {
    return { value: localStorage.getItem(lsKey(key)) };
  },
  async set(key, value) {
    localStorage.setItem(lsKey(key), value);
  },
  async list(prefix) {
    const full = lsKey(prefix);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) keys.push(k.slice("wcpool:".length));
    }
    return { keys };
  },
  async delete(key) {
    localStorage.removeItem(lsKey(key));
  },
};

const supabaseStorage = {
  async get(key) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return { value: data ? data.value : null };
  },
  async set(key, value) {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async list(prefix) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("key")
      .like("key", prefix + "%");
    if (error) throw error;
    return { keys: (data || []).map((r) => r.key) };
  },
  async delete(key) {
    const { error } = await supabase.from(TABLE).delete().eq("key", key);
    if (error) throw error;
  },
};

export const storage = isConfigured ? supabaseStorage : localFallback;
