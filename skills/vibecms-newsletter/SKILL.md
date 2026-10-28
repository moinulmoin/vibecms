---
name: vibecms-newsletter
description: Connect a blog signup form to the owner's newsletter tool and guide safe RSS-to-email and subscriber migration.
---

# Connect a newsletter tool

Use this skill when the owner wants blog signups sent to an external newsletter tool or wants to turn published posts into newsletter drafts. Follow `vibecms-core` for approval, scope, and error handling. If `skills.get` is available, read the latest version of this skill at the start of the session.

## Connect the signup form

1. Ask which newsletter tool and specific newsletter or audience the owner wants to use; confirm the selection. Call `sites.get` and record `url`, `updatedAt`, and `signupForm`, including `enabled`, `heading`, `description`, `button`, and `externalForm`.
2. Get the tool's **HTML form embed**, not a hosted page URL, iframe, or JavaScript-only embed. Copy the `<form>`'s complete `action`, including any query parameters, and the email input's `name`. For Buttondown, its documented basic form uses `https://buttondown.com/api/emails/embed-subscribe/<username>` and `email`; replace `<username>` with the owner's actual Buttondown username and confirm against their embed. [Buttondown example](https://buttondown.com/features/integrations/daisyui).
   - Kit offers raw HTML under **Grow → Landing Pages & Forms → select the form → Embed → HTML**. Copy the values from that specific form; do not guess its field name. [Kit instructions](https://help.kit.com/en/articles/4009572-form-embedding-basics).
   - Mailchimp provides an embedded form code for the chosen audience. Copy the actual values from that code; do not assume a universal email field or endpoint. [Mailchimp instructions](https://mailchimp.com/help/add-a-signup-form-to-your-website/).
3. Check that this is a standard POST form that can work with **only** the email field and the complete action URL. vibecms cannot send additional hidden inputs, custom fields, consent checkboxes, or provider JavaScript. If the embed needs any of those, stop and explain the limitation; do not silently drop them. For example, Mailchimp documents a hosted-form variant requiring hidden user and audience IDs, which this integration cannot submit. [Mailchimp form fields](https://mailchimp.com/help/host-your-own-signup-forms/). The action must be an HTTPS URL no longer than 500 characters, with no userinfo and a hostname containing a dot; `emailField` must match `^[A-Za-z0-9_\-\[\].:]{1,64}$`. Do not modify the provider's endpoint or discard query parameters to make it fit.
4. Show the owner the destination, exact action and email field, and explain that this changes the live form: new signups go directly to the newsletter tool, not vibecms; the provider controls confirmation. Existing vibecms signups are not moved automatically. Ask for explicit approval of this specific change. A disabled form stays disabled unless the owner separately asks to enable it.
5. After approval, call `sites.signup_form.update` with only `expectedUpdatedAt` from `sites.get` and `externalForm: { action, emailField }`. Omit `enabled`, `heading`, `description`, and `button` to preserve them. If another setting is explicitly approved, send only that requested change as well. If there is a `CONFLICT`, re-read `sites.get`, show the current and proposed state, and obtain fresh approval before retrying. Do not bypass validation or request broader access automatically; changing the form requires `site:write`.
6. Call `sites.get` again and confirm the saved `externalForm` and unchanged form settings. Ask the owner to submit a real test signup using an address they control, complete any provider confirmation or CAPTCHA, and check the intended list. The form opens the provider in a new tab. Do not claim delivery or confirmation until the owner verifies it. If the test fails, report what is known and do not claim the connection works.
7. Review any customized heading, description, and button copy with the owner. Waitlist wording such as “when new-post emails start” may no longer be accurate; offer suitable replacements and change them only with explicit approval through `sites.signup_form.update`, using a fresh `expectedUpdatedAt`. With no custom fields, external mode uses the subtext “New posts straight to your inbox. Unsubscribe anytime.”, button “Subscribe”, and note “Signing up sends your email to <host>.”

To return to vibecms storage, obtain explicit approval, re-read `sites.get`, and call `sites.signup_form.update` with that `updatedAt` as `expectedUpdatedAt` and `externalForm: null`. Preserve the other fields, then verify with `sites.get`.

## Turn posts into email drafts

Use the public blog URL returned by `sites.get` (or the active location URL from `sites.location.get`). Append `/feed.xml` to the blog URL without its trailing slash, preserving any base path: `https://example.com/blog` becomes `https://example.com/blog/feed.xml`. If no public URL is available, stop rather than inventing one.

For Buttondown, RSS-to-email is a paid feature; let the owner decide whether to enable it. In [Settings → Basic → RSS-to-email](https://buttondown.com/feeds), create an automation for the feed URL, choose the desired cadence, choose the behavior that **creates a draft** rather than sends automatically, and enable **skip old items**. Buttondown documents that this setting skips items whose publish date is more than one day old when discovered; it is not a guarantee that every existing item is skipped. Have the owner review the automation and resulting drafts before sending. Do not enable paid features or send email on the owner's behalf without explicit approval. [Buttondown RSS documentation](https://docs.buttondown.com/rss-to-email); [pricing](https://buttondown.com/pricing).

For another provider, use only that provider's current documented RSS-to-email instructions. Do not promise that it offers draft creation, old-item skipping, or a particular price without verifying its documentation. If those safeguards cannot be established, explain the uncertainty and let the owner decide; do not switch on automatic sending as a substitute.

## Earlier vibecms signups

The owner can use **Subscribers → People → Export CSV** in the dashboard; agents cannot export the list. vibecms signups collected in its own storage are pending interest, not verified subscriptions. Keep the CSV and subscriber addresses with the owner; do not ask them to paste it into chat.

The owner should import only through a provider-supported process that keeps those people unconfirmed and sends a confirmation request, then check the provider's result. Do not assume that a CSV import sends confirmation: Buttondown says imported subscribers generally are not asked to reconfirm and are not automatically emailed by default. If the provider cannot document an unconfirmed import and confirmation path, stop and have the owner ask the provider for a suitable opt-in process rather than importing pending contacts as subscribed. [Buttondown import documentation](https://docs.buttondown.com/importing-your-data).

## Report

State the confirmed provider and destination, whether the vibecms setting was saved, whether the owner completed a real signup and confirmation test, the feed URL and draft/old-item settings if configured, and any remaining provider or migration blockers. Distinguish instructions given to the owner from actions actually completed.
