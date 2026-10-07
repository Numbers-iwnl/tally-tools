#!/usr/bin/env node
// Creates a Tally.so form from a simple JSON spec via the Tally API.
// Usage: node create-form.js <spec.json> [--publish]

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadApiKey() {
  if (process.env.TALLY_API_KEY) return process.env.TALLY_API_KEY;
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const line = fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.startsWith("TALLY_API_KEY="));
    if (line) return line.split("=").slice(1).join("=").trim();
  }
  throw new Error("TALLY_API_KEY not found in environment or .env file");
}

function uuid() {
  return crypto.randomUUID();
}

function titleBlock(title) {
  const id = uuid();
  return {
    uuid: id,
    type: "FORM_TITLE",
    groupUuid: id,
    groupType: "TEXT",
    payload: { title, html: title },
  };
}

// Non-question content blocks (intro copy above the questions).
function headingBlock(text, level) {
  const id = uuid();
  const type = `HEADING_${level || 2}`;
  return {
    uuid: id,
    type,
    groupUuid: id,
    groupType: type,
    payload: { html: `<p>${text}</p>` },
  };
}

function textBlock(text) {
  const id = uuid();
  return {
    uuid: id,
    type: "TEXT",
    groupUuid: id,
    groupType: "TEXT",
    payload: { html: `<p>${text}</p>` },
  };
}

function pageBreakBlock() {
  const id = uuid();
  return {
    uuid: id,
    type: "PAGE_BREAK",
    groupUuid: id,
    groupType: "PAGE_BREAK",
    payload: {},
  };
}

// A question label is always its own TITLE/QUESTION block, separate from
// the input block(s) that follow it (Tally rejects a title sharing a
// groupUuid with an input, and rejects "html" inside input payloads).
function questionTitle(label, helper) {
  const id = uuid();
  const html = helper ? `<p>${label}</p><p><i>${helper}</i></p>` : `<p>${label}</p>`;
  return {
    uuid: id,
    type: "TITLE",
    groupUuid: id,
    groupType: "QUESTION",
    payload: { html },
  };
}

// Hidden fields (e.g. UTM params) auto-captured from the form URL's query
// string and stored with every submission.
function hiddenFieldsBlock(names) {
  const id = uuid();
  return {
    uuid: id,
    type: "HIDDEN_FIELDS",
    groupUuid: id,
    groupType: "HIDDEN_FIELDS",
    payload: {
      hiddenFields: names.map((name) => ({ uuid: uuid(), name })),
    },
  };
}

// Builds a "redirect on completion" value that appends live hidden-field
// values (e.g. UTM params) as query params on the destination URL.
//
// Tally's public POST/PATCH schema docs claim `redirectOnCompletion.html`
// takes a plain string with literal "@fieldname" text, but that is NOT
// what the respond page actually reads: it's cosmetic editor-doc text,
// unrelated to the real wire format. The real field is `safeHTMLSchema`,
// an array alternating plain-text segments `[text]` with mention segments
// `["​", [["mention", mentionInstanceUuid]]]`; each mention instance
// is resolved via a parallel `mentions` array entry that points at the
// hidden field by its block groupUuid + field uuid. Confirmed by live
// round-trip testing (submit -> inspect final redirect URL), since a
// literal "@utm_source"-style string is passed through unresolved.
function redirectWithHiddenFields(url, hiddenBlock, paramNames) {
  const schema = [];
  const mentions = [];
  const byName = Object.fromEntries(hiddenBlock.payload.hiddenFields.map((f) => [f.name, f.uuid]));

  let base = url;
  paramNames.forEach((name, i) => {
    const fieldUuid = byName[name];
    if (!fieldUuid) throw new Error(`redirect references unknown hidden field: ${name}`);
    schema.push([i === 0 ? `${base}?${name}=` : `&${name}=`]);
    const mentionUuid = uuid();
    schema.push(["​", [["mention", mentionUuid]]]);
    mentions.push({
      uuid: mentionUuid,
      field: {
        uuid: fieldUuid,
        type: "HIDDEN_FIELD",
        questionType: "HIDDEN_FIELDS",
        blockGroupUuid: hiddenBlock.groupUuid,
        title: name,
      },
      defaultValue: null,
    });
  });

  return { safeHTMLSchema: schema, mentions };
}

// Simple field builders keyed by shorthand "type" in the spec.
const builders = {
  text: (q) => simpleInput(q, "INPUT_TEXT", { placeholder: q.placeholder }),
  textarea: (q) => simpleInput(q, "TEXTAREA", { placeholder: q.placeholder }),
  number: (q) => simpleInput(q, "INPUT_NUMBER", { placeholder: q.placeholder }),
  email: (q) => simpleInput(q, "INPUT_EMAIL", { placeholder: q.placeholder }),
  phone: (q) =>
    simpleInput(q, "INPUT_PHONE_NUMBER", {
      internationalFormat: true,
      defaultCountryCode: q.defaultCountryCode || "US",
    }),
  date: (q) =>
    simpleInput(q, "INPUT_DATE", { format: q.format || "yyyy-MM-dd" }),
  rating: (q) => simpleInput(q, "RATING", { stars: q.stars || 5 }),
  fileupload: (q) =>
    simpleInput(q, "FILE_UPLOAD", {
      hasMultipleFiles: !!q.multiple,
      allowedFiles: q.allowedFiles,
    }),
  choice: (q) => optionGroup(q, "MULTIPLE_CHOICE_OPTION", "MULTIPLE_CHOICE"),
  checkboxes: (q) => optionGroup(q, "CHECKBOX", "CHECKBOXES"),
  dropdown: (q) => optionGroup(q, "DROPDOWN_OPTION", "DROPDOWN"),
};

function simpleInput(q, type, extra) {
  const id = uuid();
  const payload = {
    isRequired: !!q.required,
    name: q.name || slug(q.label),
    ...extra,
  };
  const blocks = [questionTitle(q.label, q.helper)];
  if (q.pageBreak) blocks.unshift(pageBreakBlock());
  blocks.push({ uuid: id, type, groupUuid: id, groupType: type, payload });
  return blocks;
}

// Options may be plain strings, or { text, other: true } for an "Other
// (please specify)" choice that reveals a free-text field.
function optionGroup(q, blockType, groupType) {
  const groupUuid = uuid();
  const opts = q.options.map((o) => (typeof o === "string" ? { text: o } : o));
  // Tally's submissions API surfaces only the *first* option block's name
  // as the question's exported title/CSV column header, so every option
  // in the group shares one clean name derived from the question label.
  const groupName = q.name || slug(q.label);
  const options = opts.map((opt, i) => ({
    uuid: uuid(),
    type: blockType,
    groupUuid,
    groupType,
    payload: {
      isRequired: i === 0 ? !!q.required : undefined,
      index: i,
      isFirst: i === 0,
      isLast: i === opts.length - 1,
      hasOtherOption: i === 0 ? opts.some((o) => o.other) : undefined,
      isOtherOption: opt.other || undefined,
      text: opt.text,
      name: groupName,
    },
  }));
  const blocks = [questionTitle(q.label, q.helper), ...options];
  if (q.pageBreak) blocks.unshift(pageBreakBlock());
  return blocks;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function buildIntro(intro) {
  return (intro || []).map((block) =>
    block.type === "heading" ? headingBlock(block.text, block.level) : textBlock(block.text)
  );
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("Usage: node create-form.js <spec.json> [--publish]");
    process.exit(1);
  }
  const publish = process.argv.includes("--publish");

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const apiKey = loadApiKey();

  const blocks = [titleBlock(spec.title), ...buildIntro(spec.intro)];
  let hiddenBlock = null;
  if (spec.hiddenFields && spec.hiddenFields.length) {
    hiddenBlock = hiddenFieldsBlock(spec.hiddenFields);
    blocks.push(hiddenBlock);
  }
  for (const q of spec.questions) {
    const builder = builders[q.type];
    if (!builder) throw new Error(`Unknown question type: ${q.type}`);
    blocks.push(...builder(q));
  }

  const settings = { ...(spec.settings || {}) };
  const redirect = settings.redirectOnCompletion;
  if (redirect && redirect.passHiddenFields) {
    if (!hiddenBlock) throw new Error("redirectOnCompletion.passHiddenFields set but spec has no hiddenFields");
    settings.redirectOnCompletion = redirectWithHiddenFields(redirect.url, hiddenBlock, redirect.passHiddenFields);
  }

  const body = {
    status: publish ? "PUBLISHED" : "DRAFT",
    blocks,
    settings,
  };

  const res = await fetch("https://api.tally.so/forms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error(`Tally API error (${res.status}):`, JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log(`Created form: ${json.name || spec.title} (id: ${json.id})`);
  console.log(`Status: ${json.status}`);
  console.log(`Edit:   https://tally.so/forms/${json.id}/edit`);
  if (json.status === "PUBLISHED") {
    console.log(`Public: https://tally.so/r/${json.id}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
