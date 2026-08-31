// Optional, consent-gated, feature-flagged caption generation for a clip.
// Provider abstraction: TRANSCRIPTION_PROVIDER env selects the
// implementation. Only 'mock' (deterministic, no network call, no data
// leaves Supabase) is wired to a working provider in this build — no
// production transcription credentials are available (see
// docs/OWNER_ACTIONS_REQUIRED.md). The 'openai' branch is a real,
// reviewed implementation shape, not a stub, but is untested without a
// live OPENAI_API_KEY; it is not selected by default.
//
// Never called from the client with a provider secret — the mobile app
// only ever calls this Edge Function, which holds OPENAI_API_KEY (if set)
// server-side.
//
// Deploy: supabase functions deploy transcribe
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Env optional: TRANSCRIPTION_PROVIDER=mock|openai, OPENAI_API_KEY
import { adminClient, authenticate, json, CORS_HEADERS } from '../_shared/client.ts';

interface TranscriptionProvider {
  transcribe(audioUrl: string): Promise<{ text: string }>;
}

/** Deterministic, offline, zero-network mock — proves the consent →
 * request → caption_status lifecycle end-to-end without any external
 * dependency or the privacy implications of shipping real audio anywhere. */
class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribe(_audioUrl: string): Promise<{ text: string }> {
    return { text: '[Caption unavailable in this environment — using local test adapter]' };
  }
}

/** Real provider shape (OpenAI Whisper-style transcription API). Not
 * exercised in this build — no API key is configured, and this file's
 * network call has not been run against a live endpoint here. Reviewed
 * for the right shape (server-side-only key, downloads the clip via the
 * service role rather than trusting a client-supplied URL, minimal
 * payload) but treat as unverified until tested with real credentials. */
class OpenAiTranscriptionProvider implements TranscriptionProvider {
  constructor(private apiKey: string) {}

  async transcribe(audioUrl: string): Promise<{ text: string }> {
    const audioResponse = await fetch(audioUrl);
    const audioBlob = await audioResponse.blob();
    const form = new FormData();
    form.append('file', audioBlob, 'clip.mp4');
    form.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) throw new Error(`transcription provider error: ${response.status}`);
    const data = (await response.json()) as { text?: string };
    return { text: data.text ?? '' };
  }
}

function getProvider(): TranscriptionProvider {
  const kind = Deno.env.get('TRANSCRIPTION_PROVIDER') ?? 'mock';
  if (kind === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('OPENAI_API_KEY not configured');
    return new OpenAiTranscriptionProvider(key);
  }
  return new MockTranscriptionProvider();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  const { userId } = auth;

  const admin = adminClient();

  const { data: allowed } = await admin.rpc('check_rate_limit', {
    p_bucket: 'transcribe',
    p_subject: userId,
    p_max_events: 30,
    p_window_seconds: 3600,
  });
  if (!allowed) return json({ error: 'rate_limited' }, 429);

  const { data: consent } = await admin.from('transcription_consents').select('consented').eq('user_id', userId).maybeSingle();
  if (!consent?.consented) return json({ error: 'consent_required' }, 403);

  let body: { clipId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.clipId) return json({ error: 'clip_id_required' }, 400);

  const { data: clip } = await admin.from('clips').select('*').eq('id', body.clipId).eq('user_id', userId).maybeSingle();
  if (!clip) return json({ error: 'not_found_or_not_yours' }, 404);

  await admin.from('clips').update({ caption_status: 'pending' }).eq('id', clip.id);

  try {
    const { data: signed, error: signError } = await admin.storage.from('clips').createSignedUrl(clip.storage_path, 300);
    if (signError || !signed) throw new Error('could_not_sign_source_clip');

    const provider = getProvider();
    const { text } = await provider.transcribe(signed.signedUrl);

    await admin.from('clips').update({ caption: text, caption_status: 'ready' }).eq('id', clip.id);
    return json({ ok: true, caption: text });
  } catch (e) {
    await admin.from('clips').update({ caption_status: 'failed' }).eq('id', clip.id);
    return json({ error: 'transcription_failed', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
