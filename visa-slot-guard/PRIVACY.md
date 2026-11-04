# Privacy Policy — Visa Slot Guard

**Effective date:** 2026-11-05

Visa Slot Guard is a Chrome extension that monitors usvisascheduling.com for available visa appointment slots and, if you opt in, automates parts of the sign-in and booking flow on that site. This page describes what data the extension handles and how.

## What data the extension handles

- **Account credentials**, if you opt in to Quick Login: your usvisascheduling.com username, password, and up to 3 saved security-question answers.
- **Your preferences**: consulate/post selection, date range, check interval, burst-check windows, and similar settings.
- **A local activity log** of the extension's own monitoring events (e.g. "rate limited," "session expired," "match found") for display in the popup.
- **Your browser's public IP address**, fetched from `api.ipify.org` and shown to you in the extension's popup/panel, for your own information only.

## Where this data goes

- All settings, credentials, and logs are stored **only in `chrome.storage.local`, on your own device**. This data is never transmitted to the developer of this extension or to any third party, and it is never synced to any remote server.
- The extension makes outbound network requests only to:
  - **usvisascheduling.com** and **atlasauth.b2clogin.com** — to read the appointment page/session state and, only if you opt in, to submit sign-in or booking actions on your behalf.
  - **api.ipify.org** — a single request to learn your current public IP address so it can be displayed to you in the extension UI. No extension data is sent in this request.
- The extension does not use analytics, tracking, or advertising services of any kind.

## Why each permission is needed

- `storage` — save your settings and (if provided) credentials locally.
- `cookies` — detect your usvisascheduling.com session state and, only if you opt in to "auto reset session," clear that site's session cookies so you can sign in again.
- `tabs`, `scripting` — read and interact with the usvisascheduling.com tab (detect page state, fill in forms, click buttons), limited to the domains listed in the extension's host permissions.
- `alarms` — schedule periodic slot checks even if the browser has put the extension to sleep.
- `notifications` — show you a local desktop notification when a matching slot is found or when the extension needs your attention.

## Data retention and your control over it

- Everything the extension stores stays on your device until you remove it yourself — via the extension's own settings, by clearing the extension's site data in Chrome, or by uninstalling the extension.
- Uninstalling the extension deletes all data it stored locally.

## Security

Quick Login credentials are stored unencrypted in `chrome.storage.local`, which is accessible to anyone with access to your Chrome profile. Only enable Quick Login on a device you trust.

## Children's privacy

This extension is not directed at children and does not knowingly collect data from children.

## Changes to this policy

Any future changes to this policy will be posted on this same page with an updated effective date.

## Contact

Questions about this policy can be filed as an issue on the project's GitHub repository: https://github.com/Kanhaiya3011/visa-slot-automation/issues
