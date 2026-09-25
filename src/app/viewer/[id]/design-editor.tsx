"use client";

// The design editor. LivingBlueprint stays a renderer — it reports which
// plant was clicked and draws the selection and the ghosts; all the edit
// state lives here.
//
// Edits are a list, not a mutated design: it keeps undo trivial, lets a
// delete stay visible as a ghost until it's published, and makes the draft
// one derived value rather than a pile of in-place mutations.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LivingBlueprint, type LivingBlueprintProps } from "@/lib/viewer/LivingBlueprint";
import { createClient } from "@/lib/supabase/client";
import {
  PLANTS,
  applyEdits,
  closestSize,
  currentSize,
  plantForModel,
  plantsSubtotal,
  thumbnailURL,
  type CatalogPlant,
  type DesignEdit,
} from "@/lib/design-edit";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";
import { publishRevision } from "./actions";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

type Props = Omit<LivingBlueprintProps, "editing" | "selectedId" | "deletedIds" | "onSelectInstance" | "onToggleEditing" | "editorPanel"> & {
  projectId: string;
  canEdit: boolean;
  /** A draft left open from a previous visit, if there is one. */
  draftDesign: ProjectFileJSON | null;
};

export function DesignEditor({ projectId, canEdit, draftDesign, ...viewer }: Props) {
  // A reopened draft is already-applied work: it becomes the base, and the
  // edit list starts empty again. Ghosted deletes are a within-session
  // affordance — after a reload those plants are simply gone from the draft,
  // and Discard is what brings them back.
  const base = draftDesign ?? viewer.project;

  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<DesignEdit[]>([]);
  // The Changes list records what has been SAVED, not what is being fiddled
  // with. Autosave deliberately doesn't touch this — only pressing Save
  // changes commits an edit to the record.
  const [savedEdits, setSavedEdits] = useState<DesignEdit[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drafts autosave, but silently — which read as "there's no way to save".
  // The state is now visible and there's a button that flushes it now.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [publishing, startPublish] = useTransition();
  const router = useRouter();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deletedIds = useMemo(
    () => new Set(edits.filter((e) => e.kind === "delete").map((e) => e.id)),
    [edits]
  );

  // What the canvas draws: swaps and resizes applied, deletes still present
  // so they can be drawn as outlines.
  const shown = useMemo(
    () => applyEdits(base, edits.filter((e) => e.kind !== "delete")),
    [base, edits]
  );
  // What would actually be published.
  const staged = useMemo(() => applyEdits(base, edits), [base, edits]);

  const before = useMemo(
    () => plantsSubtotal(base, viewer.priceOverrides ?? {}),
    [base, viewer.priceOverrides]
  );
  const after = useMemo(
    () => plantsSubtotal(staged, viewer.priceOverrides ?? {}),
    [staged, viewer.priceOverrides]
  );

  // ONE row per plant, describing its NET effect — not one row per
  // keystroke. Swapping to a 5 gal and then picking 15 gal is one decision
  // about one plant, saved once; listing the 5 gal step describes how you
  // got there, which nobody needs. A plant changed and changed back
  // produces no row at all, for the same reason.
  const changes = useMemo<ChangeRow[]>(() => {
    const before = new Map((base.placements ?? []).map((p) => [p.id, p]));
    const saved = applyEdits(base, savedEdits);
    const after = new Map((saved.placements ?? []).map((p) => [p.id, p]));

    const describe = (p: PlacedPlantJSON) => {
      const plant = plantForModel(p.plantModelName);
      if (!plant) return p.containerType ?? "Plant";
      const size = currentSize(plant, p);
      return size ? `${size.size} ${plant.name}` : plant.name;
    };

    const touched: string[] = [];
    for (const e of savedEdits) if (!touched.includes(e.id)) touched.push(e.id);

    return touched.flatMap((id): ChangeRow[] => {
      const was = before.get(id);
      if (!was) return [];
      const now = after.get(id);
      if (!now) {
        return [{ key: id, id, kind: "delete", from: describe(was), to: "removed" }];
      }
      const wasKey = plantForModel(was.plantModelName)?.key;
      const nowKey = plantForModel(now.plantModelName)?.key;
      const speciesChanged = wasKey !== nowKey;
      const sizeChanged = (was.containerType ?? null) !== (now.containerType ?? null);
      if (!speciesChanged && !sizeChanged) return [];
      return [
        {
          key: id,
          id,
          kind: speciesChanged ? "swap" : "resize",
          from: describe(was),
          to: speciesChanged ? describe(now) : (now.containerType ?? describe(now)),
        },
      ];
    });
  }, [savedEdits, base]);

  // Undo still walks the live stack — otherwise an unsaved mistake would
  // have no way back at all.
  const last = edits.at(-1) ?? null;
  const undoLabel = last
    ? last.kind === "delete"
      ? "Undo remove"
      : last.kind === "swap"
        ? "Undo replace"
        : "Undo size change"
    : null;


  // What's recorded, as a design — the thing "unsaved" is measured against.
  const savedDesign = useMemo(
    () => applyEdits(base, savedEdits),
    [base, savedEdits]
  );

  // There is something to save only when the design actually DIFFERS.
  // Counting edit entries said yes to a size changed and changed straight
  // back, leaving Save lit with nothing behind it.
  const hasUnsaved = useMemo(
    () => designsDiffer(staged, savedDesign),
    [staged, savedDesign]
  );

  // Counted in PLANTS, not operations, so the bar agrees with the change
  // list: swapping a plant and then picking a different size for it is one
  // changed plant, however many taps it took.
  const changedPlantCount = useMemo(() => {
    const before = new Map((base.placements ?? []).map((p) => [p.id, p]));
    const after = new Map((staged.placements ?? []).map((p) => [p.id, p]));
    let n = 0;
    for (const [id, was] of before) {
      const now = after.get(id);
      if (!now) {
        n++;
        continue;
      }
      if (
        now.plantModelName !== was.plantModelName ||
        (now.containerType ?? null) !== (was.containerType ?? null)
      ) {
        n++;
      }
    }
    return n;
  }, [base, staged]);

  const selected = useMemo(
    () => shown.placements?.find((p) => p.id === selectedId) ?? null,
    [shown, selectedId]
  );

  const writeDraft = useCallback(
    async (design: ProjectFileJSON) => {
        setSaveState("saving");
        const supabase = createClient();
        const { data: existing } = await supabase
          .from("project_versions")
          .select("id")
          .eq("project_id", projectId)
          .eq("status", "draft")
          .maybeSingle();

        if (existing) {
          await supabase
            .from("project_versions")
            .update({ project_json: design })
            .eq("id", existing.id);
          setSaveState("saved");
          return;
        }
        const { data: latest } = await supabase
          .from("project_versions")
          .select("revision")
          .eq("project_id", projectId)
          .order("revision", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { error: insertError } = await supabase
          .from("project_versions")
          .insert({
            project_id: projectId,
            // Provisional. publishRevision() renumbers at publish time, so a
            // headset sync landing meanwhile can't strand this behind it.
            revision: (latest?.revision ?? 0) + 1,
            source: "dashboard",
            status: "draft",
            project_json: design,
          });
        if (insertError) {
          setSaveState("idle");
          setError(
            insertError.code === "42P01"
              ? "Run migration-015 — changes can't be saved yet."
              : "Couldn't save the draft."
          );
          return;
        }
        setSaveState("saved");
    },
    [projectId]
  );

  // Debounced so a run of size taps is one write, not five.
  const saveDraft = useCallback(
    (design: ProjectFileJSON) => {
      setSaveState("idle");
      // The dev fixture is a sample scene with no row behind it; editing it
      // is for looking at the UI, not for persisting anything.
      if (projectId === "fixture") return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void writeDraft(design), 800);
    },
    [projectId, writeDraft]
  );

  /** Skip the debounce — the designer asked for it now. */
  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSavedEdits(edits);
    // Saving finishes with that plant, so the panel goes back to the list —
    // which puts the row you just recorded in front of you. A greyed-out
    // button was weak confirmation; the record itself is the strong one.
    // Same shape as Publish, which also leaves the context it commits.
    setSelectedId(null);
    setPicking(false);
    if (projectId === "fixture") {
      setSaveState("saved");
      return;
    }
    void writeDraft(staged);
  }, [projectId, writeDraft, staged, edits]);

  const edit = useCallback(
    (next: DesignEdit) => {
      setError(null);
      setEdits((prev) => {
        // One edit per plant per kind: tapping three sizes leaves one resize,
        // not three. A swap also clears an earlier resize of the same plant —
        // the swap rewrites size and scale anyway, so the resize is dead
        // weight that would otherwise inflate the change count.
        const kept = prev.filter((e) => {
          if (e.id !== next.id) return true;
          if (e.kind === next.kind) return false;
          return !(next.kind === "swap" && e.kind === "resize");
        });
        const list = [...kept, next];
        saveDraft(applyEdits(base, list));
        return list;
      });
    },
    [base, saveDraft]
  );

  const undoLast = useCallback(() => {
    setEdits((prev) => {
      if (prev.length === 0) return prev;
      const dropped = prev[prev.length - 1];
      const list = prev.slice(0, -1);
      saveDraft(applyEdits(base, list));
      // If the undone edit had already been recorded, it leaves the list
      // too — a row you can't get back to isn't a record, it's a lie.
      setSavedEdits((saved) =>
        saved.filter(
          (e) => !(e.id === dropped.id && e.kind === dropped.kind)
        )
      );
      return list;
    });
  }, [base, saveDraft]);

  /** Drops one operation. "Undo remove" must not also revert a swap that
   *  was made before it. */
  const undoEdit = useCallback(
    (id: string, kind: DesignEdit["kind"]) => {
      setSavedEdits((saved) =>
        saved.filter((e) => !(e.id === id && e.kind === kind))
      );
      setEdits((prev) => {
        const list = prev.filter((e) => !(e.id === id && e.kind === kind));
        saveDraft(applyEdits(base, list));
        return list;
      });
    },
    [base, saveDraft]
  );

  /** Reverts a plant entirely — what the change list's ✕ means, since a row
   *  is the plant's whole change. */
  const undoPlant = useCallback(
    (id: string) => {
      setSavedEdits((saved) => saved.filter((e) => e.id !== id));
      setEdits((prev) => {
        const list = prev.filter((e) => e.id !== id);
        saveDraft(applyEdits(base, list));
        return list;
      });
    },
    [base, saveDraft]
  );

  // ⌘Z / Ctrl+Z. No redo, matching the deliberate call made for the
  // headset's own undo: a session-scoped stack and nothing to walk forward
  // into.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const el = e.target as HTMLElement | null;
        if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
        e.preventDefault();
        undoLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undoLast]);

  function discard() {
    setEdits([]);
    setSavedEdits([]);
    setSelectedId(null);
    setPicking(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void createClient()
      .from("project_versions")
      .delete()
      .eq("project_id", projectId)
      .eq("status", "draft")
      .then(() => router.refresh());
  }

  function publish() {
    setError(null);
    startPublish(async () => {
      // The dev fixture has no row and no session, so the real action would
      // only ever answer "Not signed in". Walk the same path so the flow
      // can be reviewed.
      if (projectId === "fixture") {
        router.push("/dashboard/projects/fixture?published=1");
        return;
      }
      let result;
      try {
        result = await publishRevision(projectId, staged);
      } catch (err) {
        // A server action that THROWS rather than returning left the button
        // stuck on "Publishing…" with nothing said — indistinguishable from
        // a button that does nothing.
        console.error("[publish] server action threw", err);
        setError(
          err instanceof Error
            ? `Publish failed: ${err.message}`
            : "Publish failed — check the server logs."
        );
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEdits([]);
      setSavedEdits([]);
      setSelectedId(null);
      setEditing(false);
      // Land on the project record rather than sitting in the editor with
      // nothing to say. Publishing is the end of a sitting; the page it
      // lands on shows the new estimate total and the updated plan, which
      // is the confirmation that actually means something.
      router.push(`/dashboard/projects/${projectId}?published=${result.revision}`);
    });
  }

  // Net, not per-operation: reverting everything leaves nothing to publish
  // or discard, so the bar goes back to its hint.
  const dirty = changedPlantCount > 0 || draftDesign != null;

  return (
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1">
        <LivingBlueprint
          {...viewer}
          project={shown}
          editing={editing}
          selectedId={selectedId}
          deletedIds={deletedIds}
          onSelectInstance={(id) => {
            setSelectedId(id);
            setPicking(false);
          }}
          onToggleEditing={
            canEdit
              ? () => {
                  setEditing((e) => !e);
                  setSelectedId(null);
                  setPicking(false);
                }
              : undefined
          }
          editorPanel={
            <EditorPanel
              selected={selected}
              staged={deletedIds.has(selectedId ?? "")}
              changes={changes}
              selectedId={selectedId}
              undoLabel={undoLabel}
              unsavedCount={hasUnsaved ? 1 : 0}
              onUndoPlant={undoPlant}
              onSelectChange={(id) => {
                setSelectedId(id);
                setPicking(false);
              }}
              dirty={hasUnsaved}
              saveState={saveState}
              onSave={saveNow}
              picking={picking}
              onPick={() => setPicking(true)}
              onCancelPick={() => setPicking(false)}
              onBack={() => {
                setSelectedId(null);
                setPicking(false);
              }}
              onSwap={(plant, size) => {
                if (!selectedId) return;
                edit({ kind: "swap", id: selectedId, plantKey: plant.key, size });
                setPicking(false);
              }}
              onResize={(size) => {
                if (!selectedId) return;
                edit({ kind: "resize", id: selectedId, size });
              }}
              onDelete={() => {
                if (!selectedId) return;
                edit({ kind: "delete", id: selectedId });
              }}
              onUndelete={() => {
                if (!selectedId) return;
                undoEdit(selectedId, "delete");
              }}
            />
          }
        />
      </div>

      {editing && error && (
        <div className="flex items-start gap-3 border-t border-clay/40 bg-clay/[0.08] px-4 py-3">
          <span className="mt-0.5 text-sm font-semibold text-clay">
            Couldn&apos;t publish
          </span>
          <span className="flex-1 text-sm text-clay">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-sm text-clay/70 transition hover:text-clay"
          >
            ✕
          </button>
        </div>
      )}
      {editing && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-card px-4 py-2.5">
          {dirty ? (
            <>
              <span
                className={`h-[7px] w-[7px] rounded-full ${
                  saveState === "saved" ? "bg-accent" : "bg-gold"
                }`}
              />
              <span className="text-sm text-ink">
                {changedPlantCount > 0
                  ? `${changedPlantCount} plant${changedPlantCount === 1 ? "" : "s"} changed`
                  : "Draft in progress"}
              </span>
              <span className="text-xs text-faint">
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Draft saved"
                    : "Not saved yet"}
              </span>
              {after !== before && (
                <span className="text-sm text-muted">
                  Plants{" "}
                  <span className="text-faint line-through">
                    {currency.format(before)}
                  </span>{" "}
                  →{" "}
                  <span className="font-semibold text-accent">
                    {currency.format(after)}
                  </span>
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted">
              Click a plant to replace it, change its size, or remove it.
            </span>
          )}
          <span className="flex-1" />
          {dirty && !publishing && (
            <>
              <button
                type="button"
                onClick={discard}
                disabled={publishing}
                className="text-sm text-muted transition hover:text-clay disabled:opacity-50"
              >
                Discard
              </button>
            </>
          )}
          {dirty && (
              <button
                type="button"
                onClick={publish}
                disabled={publishing}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-[#f5eeda] transition hover:bg-accent-bright disabled:opacity-60"
              >
                {publishing ? "Publishing…" : "Publish revision"}
              </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Do two designs differ in any way an editor can change?
 *
 * Model and container only: scale follows from the container, and position
 * isn't editable here yet.
 */
function designsDiffer(a: ProjectFileJSON, b: ProjectFileJSON): boolean {
  const left = a.placements ?? [];
  const right = b.placements ?? [];
  if (left.length !== right.length) return true;
  const byId = new Map(right.map((p) => [p.id, p]));
  for (const p of left) {
    const q = byId.get(p.id);
    if (!q) return true;
    if (q.plantModelName !== p.plantModelName) return true;
    if ((q.containerType ?? null) !== (p.containerType ?? null)) return true;
  }
  return false;
}

// One button shape for the panel's actions.
const ACTION =
  "w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition";

/* ── The panel that replaces the rail ─────────────────────────────────── */

type ChangeRow = {
  key: string;
  id: string;
  kind: DesignEdit["kind"];
  /** What it was, size first: "15g Agave Americana". */
  from: string;
  /** What it became: "5g Aloe Vera", a bare size, or "removed". */
  to: string;
};

function EditorPanel({
  selected,
  staged,
  changes,
  selectedId,
  undoLabel,
  unsavedCount,
  onUndoPlant,
  onSelectChange,
  dirty,
  saveState,
  onSave,
  picking,
  onPick,
  onCancelPick,
  onBack,
  onSwap,
  onResize,
  onDelete,
  onUndelete,
}: {
  selected: PlacedPlantJSON | null;
  staged: boolean;
  changes: ChangeRow[];
  selectedId: string | null;
  undoLabel: string | null;
  unsavedCount: number;
  onUndoPlant: (id: string) => void;
  onSelectChange: (id: string) => void;
  dirty: boolean;
  saveState: "idle" | "saving" | "saved";
  onSave: () => void;
  picking: boolean;
  onPick: () => void;
  onCancelPick: () => void;
  onBack: () => void;
  onSwap: (plant: CatalogPlant, size: string) => void;
  onResize: (size: string) => void;
  onDelete: () => void;
  onUndelete: () => void;
}) {
  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="px-4 py-5 text-center text-sm text-muted">
          Click a plant on the plan to replace it, change its size, or remove
          it.
        </p>
        <ChangeList
          changes={changes}
          selectedId={selectedId}
          undoLabel={undoLabel}
          unsavedCount={unsavedCount}
          onUndoPlant={onUndoPlant}
          onSelect={onSelectChange}
        />
      </div>
    );
  }

  const plant = plantForModel(selected.plantModelName);
  if (!plant) {
    return (
      <div className="px-4 py-3">
        <p className="text-sm text-muted">
          This plant isn&apos;t in the catalog, so it can&apos;t be edited
          here. Run{" "}
          <code className="font-mono text-[0.78rem]">npm run sync:catalog</code>{" "}
          if it was added to the app recently.
        </p>
      </div>
    );
  }

  const size = currentSize(plant, selected);

  if (picking) {
    return (
      <Picker
        current={plant}
        currentSizeName={size?.size ?? null}
        onCancel={onCancelPick}
        onPick={onSwap}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Thumb plant={plant} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {plant.name}
          </span>
          {plant.botanicalName && (
            <span className="block truncate text-xs italic text-muted">
              {plant.botanicalName}
            </span>
          )}
        </span>
        {staged && (
          <span className="shrink-0 rounded-full border border-clay/40 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-clay">
            removing
          </span>
        )}
        <button
          type="button"
          onClick={onBack}
          aria-label="Clear selection"
          className="shrink-0 px-1 text-sm text-faint transition hover:text-ink"
        >
          ✕
        </button>
      </div>

      {/* Staging a removal does NOT change the panel's shape. Replace and
          resize leave you in the same place doing the same kind of work;
          delete used to swap the whole panel for a paragraph and a single
          button — no size chips, no Replace, and no Save, so there was no
          way to record the removal from where you stood. It reads as a
          different screen because it was one. */}
      <div className="border-b border-rule px-4 py-3">
        <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
          Size
        </p>
        <div className="flex flex-wrap gap-1.5">
          {plant.sizes.map((sz) => {
            const on = sz.size === size?.size;
            return (
              <button
                key={sz.size}
                type="button"
                onClick={() => onResize(sz.size)}
                disabled={staged}
                aria-pressed={on}
                className={`rounded-lg border px-2 py-1 text-left text-xs transition disabled:opacity-40 ${
                  on
                    ? "border-accent bg-card-hover font-semibold text-accent-dim"
                    : "border-rule bg-card-hover text-muted enabled:hover:border-accent/50"
                }`}
              >
                {sz.size}
                <span className="mt-0.5 block font-mono text-[0.68rem] tabular-nums">
                  {currency.format(sz.price)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* One shape for all three — same height, same radius, same width —
          with colour carrying the meaning instead of the box. Before this
          it went boxed, bare text, boxed, which read as three unrelated
          things rather than two actions and a commit. */}
      <div className="p-4">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onPick}
            disabled={staged}
            className={`${ACTION} border border-rule-strong bg-card-hover text-ink enabled:hover:border-accent/60 enabled:hover:bg-card disabled:opacity-40`}
          >
            Replace plant
          </button>
          {/* One slot, one action, and its own way back — which is why the
              separate "Keep this plant" screen is gone. */}
          <button
            type="button"
            onClick={staged ? onUndelete : onDelete}
            className={`${ACTION} ${
              staged
                ? "border border-rule-strong bg-card-hover text-ink hover:border-accent/60 hover:bg-card"
                : "border border-clay/35 text-clay hover:border-clay/60 hover:bg-clay/[0.06]"
            }`}
          >
            {staged ? "Undo remove" : "Remove from design"}
          </button>
        </div>

        {/* The commit sits apart from the two plant actions. Saves the whole
            draft, not just this plant — but this is where the designer's
            hands already are. Present in every state: a removal you can't
            save from is a dead end. */}
        <div className="mt-3 border-t border-rule pt-3">
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saveState === "saving"}
            className={`${ACTION} w-full ${
              dirty && saveState !== "saving"
                ? "border border-transparent bg-accent text-[#f5eeda] hover:bg-accent-bright"
                : "border border-rule bg-transparent text-faint"
            }`}
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved" && !dirty
                ? "Saved"
                : "Save changes"}
          </button>
        </div>
      </div>

      <ChangeList
        changes={changes}
        selectedId={selectedId}
        undoLabel={undoLabel}
        unsavedCount={unsavedCount}
        onUndoPlant={onUndoPlant}
        onSelect={onSelectChange}
      />
    </div>
  );
}

/* ── What you've changed, and how to take any of it back ──────────────── */

function ChangeList({
  changes,
  selectedId,
  undoLabel,
  unsavedCount,
  onUndoPlant,
  onSelect,
}: {
  changes: ChangeRow[];
  selectedId: string | null;
  /** Non-null when there's something ⌘Z would take back. */
  undoLabel: string | null;
  unsavedCount: number;
  onUndoPlant: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  // Still render for unsaved work — otherwise Undo would vanish exactly
  // when a mistake has just been made and nothing recorded yet.
  if (changes.length === 0 && unsavedCount === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-rule">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
          Changes
        </span>
        {undoLabel && (
          <span className="font-mono text-[0.68rem] text-faint">⌘Z to undo</span>
        )}
      </div>
      {unsavedCount > 0 && (
        <p className="border-t border-rule/60 px-4 py-2 text-xs text-muted">
          Unsaved changes — press Save changes to record them here.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {changes.map((c) => {
          // Gold is the selection colour on the plan, so the row of the
          // plant you're working on wears it too — the two views name the
          // same plant the same way.
          const on = c.id === selectedId;
          return (
          <div
            key={c.key}
            className={`flex items-center gap-2 border-t px-4 py-2 transition ${
              on
                ? "border-l-[3px] border-l-gold border-t-gold/30 bg-gold/[0.14] pl-[13px]"
                : "border-rule/60"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={on ? "true" : undefined}
              className="min-w-0 flex-1 text-left"
            >
              <span
                className={`block truncate text-[13px] ${
                  on ? "text-gold" : "text-muted"
                }`}
              >
                {c.from}
              </span>
              <span
                className={`block truncate text-[13px] font-medium ${
                  c.kind === "delete" ? "text-clay" : "text-ink"
                }`}
              >
                {c.kind === "delete" ? "removed" : `→ ${c.to}`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onUndoPlant(c.id)}
              aria-label={`Undo ${c.from} ${c.to}`}
              title="Undo this change"
              className={`shrink-0 px-1 text-xs transition ${
                on ? "text-gold hover:text-ink" : "text-faint hover:text-ink"
              }`}
            >
              ✕
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Replace picker ───────────────────────────────────────────────────── */

function Picker({
  current,
  currentSizeName,
  onCancel,
  onPick,
}: {
  current: CatalogPlant;
  onCancel: () => void;
  onPick: (plant: CatalogPlant, size: string) => void;
  /** The size the plant is on now — used to suggest one on the new plant. */
  currentSizeName: string | null;
}) {
  const [query, setQuery] = useState("");
  // Choosing a plant opens its sizes rather than swapping straight away:
  // 5 gal and 36" Box are the same species and a $500 difference.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q
    ? PLANTS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.botanicalName ?? "").toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      )
    : PLANTS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={onCancel}
        className="border-b border-rule px-4 py-2.5 text-left text-xs text-muted transition hover:text-ink"
      >
        ← Back to {current.name}
      </button>
      <div className="border-b border-rule px-4 py-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library…"
          aria-label="Search plants"
          autoFocus
          className="w-full rounded-lg border border-rule bg-card-hover px-2.5 py-1.5 text-sm text-body outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((p) => (
          <div key={p.key} className="border-b border-rule">
            <button
              type="button"
              onClick={() => setOpenKey((k) => (k === p.key ? null : p.key))}
              disabled={p.key === current.key}
              aria-expanded={openKey === p.key}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink/[0.04] disabled:opacity-40"
            >
              <Thumb plant={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{p.name}</span>
                <span className="block truncate text-xs text-muted">
                  {p.sizes.length} size{p.sizes.length === 1 ? "" : "s"}
                  {p.sizes.length > 0 &&
                    ` · from ${currency.format(
                      Math.min(...p.sizes.map((z) => z.price))
                    )}`}
                  {p.key === current.key && " · current"}
                </span>
              </span>
              <span className="shrink-0 text-xs text-faint">
                {openKey === p.key ? "▾" : "▸"}
              </span>
            </button>

            {openKey === p.key && (
              <div className="flex flex-wrap gap-1.5 bg-paper-deep/40 px-4 pb-3 pt-1">
                {p.sizes.map((z) => {
                  // Where the plant would land if nobody chose — worth
                  // marking so the obvious pick is one glance away.
                  const suggested =
                    closestSize(p, currentSizeName)?.size === z.size;
                  return (
                    <button
                      key={z.size}
                      type="button"
                      onClick={() => onPick(p, z.size)}
                      className={`rounded-lg border px-2 py-1 text-left text-xs transition hover:border-accent ${
                        suggested
                          ? "border-accent/60 bg-card"
                          : "border-rule bg-card-hover text-muted"
                      }`}
                    >
                      <span className="block text-ink">{z.size}</span>
                      <span className="mt-0.5 block font-mono text-[0.68rem] tabular-nums">
                        {currency.format(z.price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted">
            Nothing matches “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}

function Thumb({ plant }: { plant: CatalogPlant }) {
  const src = thumbnailURL(plant);
  if (!src) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/40 font-mono text-[10px] text-accent">
        {plant.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // A plain <img>: these are local files under public/, sized 36px, and
    // next/image buys nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-9 w-9 shrink-0 rounded-full border border-rule object-cover"
    />
  );
}
