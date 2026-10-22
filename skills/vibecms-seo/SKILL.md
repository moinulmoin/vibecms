---
name: vibecms-seo
description: Check a vibecms draft for search engines and AI answers - run the SEO check, fix its findings, then answer the judgment questions with your own model before asking for publication approval.
---

# vibecms-seo — Ready for Search and AI Answers

Use this skill after a vibecms draft is saved and before you ask the person to approve publication. It covers search engines and AI answer engines (ChatGPT, Claude, Perplexity, Google AI answers). vibecms runs the code rules; you make the judgment calls with your own model. vibecms runs no AI model on the post.

Use `vibecms-core` for the publishing flow and `vibecms-writing` for how the prose should sound. This skill does not change either.

## 1. Run the check

- Call `posts.seo_check({ postId })` on the saved draft. Add `focusKeyword` when the person named a target search phrase.
- `posts.preview` returns the same findings in its `seo` field, so a fresh preview is also enough.
- Each finding has a `code`, a `severity`, the `field` it attaches to, a `message`, and a `fix`.

## 2. Fix findings

- Fix every `error` finding. Fix every `warn` finding unless the person decided otherwise; say which ones you left and why.
- Treat `info` findings as suggestions. Fix them when the fix makes the post better, not to clear the list.
- Change the content with `posts.update` using `expectedVersionNumber`, then run the check again on the new version.
- Never invent a source, a quote, a number, or a date to clear a finding. For `answer-claim-unsourced`, link the real source, say where the number comes from (your own test, the person's own data), or remove the claim.

## 3. Answer the judgment questions

Read the saved post and answer each question with your own model. Change the draft when the answer is no.

1. **Does the opening answer the title?** Someone who reads only the first paragraph should get the answer, not a warm-up.
2. **Which claims need a source?** List every fact a reader could doubt: numbers, comparisons, "most", "best", "first", quotes, dates. Each needs a link, a named source, or a plain statement that it is the author's own view or measurement.
3. **Does each section make sense quoted on its own?** An AI answer may lift one section without the rest. Replace "as mentioned above", "this", and "it" with the actual thing. Make each heading say what the section answers.
4. **Is there a clear last-updated signal?** If the post covers something that changes (prices, versions, tools, laws), say when it was checked, for example "Checked against version 4.2, October 2026". Use only dates you know.
5. **Would a list or a table say this better?** Steps belong in a numbered list. Options compared on the same points belong in a table.

Skip a question only when it does not apply, and say so.

## 4. Report before approval

When you ask the person to approve publication (per `vibecms-core`), add a short SEO section:

- the version the check ran on;
- findings you fixed;
- findings you left, with the reason;
- your answer to each judgment question, one line each;
- anything only the person can decide, such as a source you could not find.

Keep it short. Do not publish because the check is clean. Publication still needs explicit approval of the exact version.
