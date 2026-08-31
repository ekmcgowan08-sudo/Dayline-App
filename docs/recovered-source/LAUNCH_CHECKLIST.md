# Launch checklist

Not legal advice - have a lawyer review anything user-facing before public launch.

- [ ] Privacy Policy (data collected: email, video/audio, optional location, device/notification tokens, analytics events)
- [ ] Terms of Service
- [ ] Community Guidelines (private-by-default product, but group content moderation still matters)
- [ ] Copyright/DMCA policy for background music and any user-uploaded audio
- [ ] Music licensing for suggested soundtrack library (need a licensed catalog, e.g. Epidemic Sound/Artlist, or user-provided audio only)
- [ ] Account deletion flow that actually removes/anonymizes data (schema supports cascading deletes via `on delete cascade`)
- [ ] App Store privacy "nutrition label" disclosures (camera, microphone, location if used, notifications)
- [ ] Google Play Data Safety form
- [ ] Subscription disclosures (auto-renewal terms, cancellation instructions) if using RevenueCat/App Store/Play Billing
- [ ] Minimum age requirement (likely 13+ with COPPA considerations, or 16+/17+ given user-generated video of real people)
- [ ] User-generated content: reporting/blocking flow (schema present in `reports`/`blocks` tables) and a moderation response process
- [ ] Apple Developer Program enrollment ($99/yr) for TestFlight/App Store
- [ ] Google Play Developer account ($25 one-time) for internal testing/Play Store

## Launch path
Development build -> internal testing (Expo Go / TestFlight internal) -> TestFlight/Android closed testing -> invite-only beta -> single-campus pilot -> public release.
