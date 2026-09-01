-- docs/PRIVACY_DATA_FLOW.md documented, as a known gap: "disabling
-- consent doesn't retroactively delete existing captions in this
-- build — deleting the clip does... a known, documented gap for a
-- future 'delete all my captions' affordance." A user revoking AI-
-- caption consent has a real privacy expectation that their existing
-- transcripts go away with it, not just that future captioning stops.
--
-- transcription_consents is directly client-writable (no RPC wrapper —
-- see mobile/src/services/account.ts#updateTranscriptionConsent, a
-- plain upsert), so a trigger is the fix that works regardless of how
-- consent gets toggled, rather than adding a new RPC the client would
-- have to be changed to call.
--
-- caption_status already had a 'disabled' value defined in its CHECK
-- constraint since the column was first added, unused anywhere in the
-- codebase — this is what it was for: distinct from 'none' (never
-- requested), so a future UI can tell "never captioned" apart from
-- "was captioned, cleared when consent was revoked."
create or replace function clear_captions_on_consent_revoke() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update clips set caption = null, caption_status = 'disabled'
  where user_id = new.user_id and caption is not null;
  return new;
end;
$$;

drop trigger if exists transcription_consent_revoked on transcription_consents;
create trigger transcription_consent_revoked
after insert or update on transcription_consents
for each row when (new.consented = false)
execute function clear_captions_on_consent_revoke();
