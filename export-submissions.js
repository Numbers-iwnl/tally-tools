#!/usr/bin/env node
// Exports all submissions for a Tally form to a CSV file, including UTM
// hidden fields, via the Tally API (works regardless of Tally plan).
// Usage: node export-submissions.js <formId> [output.csv]

const fs = require("fs");
const path = require("path");

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

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchAllSubmissions(formId, apiKey) {
  const submissions = [];
  let page = 1;
  let questions = null;
  for (;;) {
    const res = await fetch(
      `https://api.tally.so/forms/${formId}/submissions?filter=all&page=${page}&limit=100`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(`Tally API error (${res.status}): ${JSON.stringify(json)}`);
    questions = questions || json.questions;
    submissions.push(...json.submissions);
    if (!json.hasMore) break;
    page += 1;
  }
  return { questions, submissions };
}

async function main() {
  const formId = process.argv[2];
  if (!formId) {
    console.error("Usage: node export-submissions.js <formId> [output.csv]");
    process.exit(1);
  }
  const outPath = process.argv[3] || `submissions-${formId}.csv`;
  const apiKey = loadApiKey();

  const { questions, submissions } = await fetchAllSubmissions(formId, apiKey);

  // One column per question; the hidden-fields "question" expands into one
  // column per hidden field name (e.g. each UTM param), since Tally reports
  // all hidden fields on a submission as a single grouped answer.
  const columns = []; // { header, questionId, hiddenName? }
  for (const q of questions) {
    if (q.type === "HIDDEN_FIELDS") {
      for (const f of q.fields) columns.push({ header: f.title, questionId: q.id, hiddenName: f.title });
    } else {
      columns.push({ header: q.title || q.id, questionId: q.id });
    }
  }

  const headers = ["Submission ID", "Submitted At", ...columns.map((c) => c.header)];
  const rows = [headers];

  for (const s of submissions) {
    const byQuestionId = Object.fromEntries(s.responses.map((r) => [r.questionId, r]));
    const row = [s.id, s.submittedAt];
    for (const col of columns) {
      const r = byQuestionId[col.questionId];
      let value = "";
      if (r) {
        if (col.hiddenName) {
          value = r.answer && typeof r.answer === "object" ? r.answer[col.hiddenName] ?? "" : "";
        } else if (Array.isArray(r.answer)) {
          value = r.answer.join("; ");
        } else if (r.answer && typeof r.answer === "object") {
          value = JSON.stringify(r.answer);
        } else {
          value = r.answer ?? "";
        }
      }
      row.push(value);
    }
    rows.push(row);
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  fs.writeFileSync(outPath, "﻿" + csv, "utf8"); // BOM for Excel

  console.log(`Exported ${submissions.length} submission(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
