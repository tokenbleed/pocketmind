# Privacy Policy

PocketMind runs language models on your device. This policy describes
what leaves the device and when.

## What stays on your device

- Chats, pals, settings, and chat history are stored locally and never
  uploaded by the app.
- Model inference happens on device. Messages sent to a loaded local
  model do not leave the device.
- Files you grant through the agent file-access feature stay inside the
  folder you picked and are read only by the pals you run.
- API keys you enter (search providers, the local API server) are kept
  in device storage and are never sent anywhere except the service they
  belong to.

## What can leave your device

- Model downloads and model catalog lookups contact
  huggingface.co directly. Requests carry a versioned User-Agent
  (`PocketMind/<version>`) so the host can serve compatible files.
- If you enable an internet search provider, your search queries (and,
  when a provider lacks a native reader, page URLs) are sent to that
  provider under the API key you configured.
- Device compatibility rules (advisory model recommendations) are
  fetched from this project's repository on GitHub. No identifiers are
  sent with that request.
- The About screen's feedback form opens a prefilled issue on this
  project's GitHub repository. You see and submit it yourself.
- Content and model-error reporting, if you use it, sends only what the
  report screen shows you before you confirm.

## What we do not do

- No analytics, no advertising, no tracking SDKs, no crash reporting to
  third parties.
- No account, no sign-in, no device identifiers collected.

## Changes

This policy lives at
https://github.com/tokenbleed/pocketmind/blob/main/PRIVACY.md;
material changes ship with a release note.
