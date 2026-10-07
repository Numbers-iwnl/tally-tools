# tally-tools

Two small Node.js CLIs for [Tally.so](https://tally.so), written as research (not used in production):

- **`create-form.js`** — builds a complete Tally form from a short JSON spec: questions, intro text, page breaks, hidden UTM fields and a completion redirect.
- **`export-submissions.js`** — exports every submission of a form to CSV, **including hidden fields like UTMs**, through the API — so it works regardless of the Tally plan.

Zero dependencies (Node 18+ `fetch`).

| | |
|---|---|
| **Status** | Research. Built to explore the Tally API; not used in production |
| **Build time** | A few hours |

## Why

Building long forms by hand in Tally's editor is slow and easy to get wrong, and signup forms tend to be rebuilt again and again with small changes (one per event or campaign). This was an experiment in whether that could be automated. Describing a form as JSON makes it reviewable, reusable and versionable. The export closes the loop: every lead comes out with the campaign it came from.

## Usage

```bash
cp .env.example .env          # add your Tally API key
node create-form.js examples/course-application.json             # creates a draft
node create-form.js examples/course-application.json --publish   # creates and publishes
node export-submissions.js <formId> leads.csv
```

### Spec format

```json
{
  "title": "Inscrição — Curso de Extensão",
  "intro": [{ "type": "heading", "level": 2, "text": "Garanta sua vaga" }],
  "hiddenFields": ["utm_source", "utm_medium", "utm_campaign"],
  "settings": {
    "language": "pt-BR",
    "redirectOnCompletion": {
      "url": "https://example.com/obrigado/",
      "passHiddenFields": ["utm_source", "utm_medium", "utm_campaign"]
    }
  },
  "questions": [
    { "type": "text", "name": "nome", "label": "Qual é o seu nome?", "required": true },
    { "type": "phone", "name": "whatsapp", "label": "Seu WhatsApp", "defaultCountryCode": "BR" },
    { "type": "choice", "name": "formato", "label": "Formato preferido", "options": ["Presencial", "Online"] },
    { "type": "textarea", "name": "objetivo", "label": "O que você espera?", "pageBreak": true }
  ]
}
```

Question types: `text`, `textarea`, `email`, `phone`, `choice`, `checkboxes`, `rating`. Full examples in [`examples/`](examples/).

## The interesting part: UTMs that survive the redirect

The goal was for the thank-you page to receive the same UTMs the visitor arrived with, so ad platforms can attribute the conversion. Tally's API docs suggest referencing hidden fields in the redirect URL by name, but a literal `@utm_source` is passed through unresolved. By submitting test entries and inspecting the final redirect URL, it turned out the redirect has to reference each hidden field by its **block group UUID + field UUID** — which `create-form.js` now generates automatically (`redirectWithHiddenFields`).

Two smaller quirks are handled too:

- Tally's submissions API names a choice question after its **first option block**, so `create-form.js` gives every option in a group the same clean name — the export then gets a readable column header instead of the first answer's text.
- The API returns all hidden fields as **one grouped answer**; `export-submissions.js` splits it into one column per hidden field (one per UTM), paginates through every submission, and writes a UTF-8 BOM so Excel opens accents correctly.

## How it was built

Built with AI coding agents (Claude Code and OpenAI Codex) writing the code. My part was the investigation itself: testing the API, finding the redirect behaviour described above and deciding what the scripts should do.

---

Built by [João Barbosa](https://joaobarbosa.pages.dev) at his employer and published here **with the employer's permission**. The original forms were replaced with fictional examples.

**© João Barbosa. All rights reserved.** No open-source license is granted — you're welcome to read the code, but please don't reuse it without permission.
