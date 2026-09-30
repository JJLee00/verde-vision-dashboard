#!/usr/bin/env node
// Deletes the stale blueprint and estimate PDFs left in the `blueprints`
// bucket by the old timestamped upload path.
//
// Until Sep 29 2026 every export uploaded {Date.now()}-blueprint.pdf and
// pointed projects.blueprint_path at the newest one. Nothing ever deleted
// the previous copies, so a project exported eight times holds eight PDFs,
// seven of them wrong. The route now writes one file per project and
// overwrites it; this clears what that left behind.
//
//   node scripts/prune-blueprint-orphans.mjs           # dry run, lists only
//   node scripts/prune-blueprint-orphans.mjs --apply   # actually deletes
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the bucket
// is private and this reads every project's folder). Reads .env.local if
// they are not already in the environment.
//
// Conservative by design: a file is deleted only when it is BOTH shaped like
// a timestamped export AND not referenced by any project row. Anything it
// does not recognise is left alone and reported.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");

// .env.local, only for keys the environment does not already provide.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  // Not there; fall through to the check below.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "The service role key is in Supabase → Project Settings → API."
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Every path a project row still points at. These are never touched, whatever
// they are named — including the timestamped one a project has not re-exported
// since the change.
const { data: projects, error } = await supabase
  .from("projects")
  .select("id, client_id, blueprint_path, estimate_path");
if (error) {
  console.error(`Could not read projects: ${error.message}`);
  process.exit(1);
}
const referenced = new Set(
  projects.flatMap((p) => [p.blueprint_path, p.estimate_path]).filter(Boolean)
);

// Only files the old code could have written. Anything else in these folders
// was put there by something this script does not know about.
const TIMESTAMPED = /^\d{10,}-(blueprint|estimate)\.pdf$/;

let deleted = 0;
let kept = 0;
const unrecognised = [];

for (const project of projects) {
  const folder = `${project.client_id}/${project.id}`;
  const { data: files, error: listError } = await supabase.storage
    .from("blueprints")
    .list(folder, { limit: 1000 });
  if (listError) {
    console.error(`  ! ${folder}: ${listError.message}`);
    continue;
  }

  const doomed = [];
  for (const file of files ?? []) {
    const path = `${folder}/${file.name}`;
    if (referenced.has(path)) { kept += 1; continue; }
    if (TIMESTAMPED.test(file.name)) { doomed.push(path); continue; }
    if (file.name === "blueprint.pdf" || file.name === "estimate.pdf") { kept += 1; continue; }
    unrecognised.push(path);
  }

  if (doomed.length === 0) continue;
  console.log(`${folder}: ${doomed.length} stale`);
  for (const path of doomed) console.log(`    ${path.split("/").pop()}`);

  if (apply) {
    const { error: rmError } = await supabase.storage.from("blueprints").remove(doomed);
    if (rmError) {
      console.error(`  ! could not delete in ${folder}: ${rmError.message}`);
      continue;
    }
  }
  deleted += doomed.length;
}

console.log(
  apply
    ? `\nDeleted ${deleted} stale PDF(s); kept ${kept} in use.`
    : `\n${deleted} stale PDF(s) would be deleted; ${kept} in use would be kept.` +
      `\nRe-run with --apply to delete them.`
);
if (unrecognised.length > 0) {
  console.log(`\nLeft alone (not recognised): ${unrecognised.length}`);
  for (const path of unrecognised) console.log(`    ${path}`);
}
