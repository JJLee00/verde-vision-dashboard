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
  currentSize,
  changeSize,
  plantForKey,
  plantForModel,
  plantsSubtotal,
  swapSpecies,
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

  // Every staged edit as an exact before → after: "15g Agave Americana"
  // becoming "5g Aloe Vera" is the row a designer can actually check,
  // because the size is what moves the price.
  //
  // Walked in order against a running copy of the design rather than read
  // off `base`, so a plant edited twice describes each step from where that
  // step actually started.
  const changes = useMemo<ChangeRow[]>(() => {
    const state = new Map((base.placements ?? []).map((p) => [p.id, p]));

    const describe = (p: PlacedPlantJSON | undefined) => {
      if (!p) return "Plant";
      const plant = plantForModel(p.plantModelName);
      if (!plant) return p.containerType ?? "Plant";
      const size = currentSize(plant, p);
      return size ? `${size.size} ${plant.name}` : plant.name;
    };

    return edits.flatMap((e): ChangeRow[] => {
      const was = state.get(e.id);
      const from = describe(was);

      if (e.kind === "delete") {
        return [{ key: `${e.id}:delete`, id: e.id, kind: e.kind, from, to: "removed" }];
      }
      if (!was) return [];

      if (e.kind === "swap") {
        const to = plantForKey(e.plantKey);
        const next = to ? swapSpecies(was, to) : null;
        if (next) state.set(e.id, next);
        return [
          {
            key: `${e.id}:swap`,
            id: e.id,
            kind: e.kind,
            from,
            to: describe(next ?? undefined),
          },
        ];
      }

      const plant = plantForModel(was.plantModelName);
      const size = plant?.sizes.find((sz) => sz.size === e.size);
      if (size) state.set(e.id, changeSize(was, size));
      // Same plant, so the size alone says it: "15g → 24\" Box".
      return [
        {
          key: `${e.id}:resize`,
          id: e.id,
          kind: e.kind,
          from,
          to: e.size,
        },
      ];
    });
  }, [edits, base]);

  const last = changes.at(-1) ?? null;
  const undoLabel = last
    ? last.kind === "delete"
      ? "Undo remove"
      : last.kind === "swap"
        ? "Undo replace"
        : "Undo size change"
    : null;

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
    if (projectId === "fixture") {
      setSaveState("saved");
      return;
    }
    void writeDraft(staged);
  }, [projectId, writeDraft, staged]);

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
      const list = prev.slice(0, -1);
      saveDraft(applyEdits(base, list));
      return list;
    });
  }, [base, saveDraft]);

  const undoOne = useCallback(
    (id: string, kind: DesignEdit["kind"]) => {
      setEdits((prev) => {
        const list = prev.filter((e) => !(e.id === id && e.kind === kind));
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
      const result = await publishRevision(projectId, staged);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEdits([]);
      setSelectedId(null);
      setEditing(false);
      router.refresh();
    });
  }

  const dirty = edits.length > 0 || draftDesign != null;

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
              onUndoLast={undoLast}
              onUndoOne={undoOne}
              onSelectChange={(id) => {
                setSelectedId(id);
                setPicking(false);
              }}
              dirty={dirty && saveState !== "saved"}
              saveState={saveState}
              onSave={saveNow}
              picking={picking}
              onPick={() => setPicking(true)}
              onCancelPick={() => setPicking(false)}
              onBack={() => {
                setSelectedId(null);
                setPicking(false);
              }}
              onSwap={(plant) => {
                if (!selectedId) return;
                edit({ kind: "swap", id: selectedId, plantKey: plant.key });
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
                undoOne(selectedId, "delete");
              }}
            />
          }
        />
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-card px-4 py-2.5">
          {error ? (
            <span className="text-sm text-clay">{error}</span>
          ) : dirty ? (
            <>
              <span
                className={`h-[7px] w-[7px] rounded-full ${
                  saveState === "saved" ? "bg-accent" : "bg-gold"
                }`}
              />
              <span className="text-sm text-ink">
                {edits.length > 0
                  ? `${edits.length} unpublished change${edits.length === 1 ? "" : "s"}`
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
          {dirty && (
            <>
              <button
                type="button"
                onClick={discard}
                disabled={publishing}
                className="text-sm text-muted transition hover:text-clay disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={publishing}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-[#f5eeda] transition hover:bg-accent-bright disabled:opacity-60"
              >
                {publishing ? "Publishing…" : "Publish revision"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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
  onUndoLast,
  onUndoOne,
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
  onUndoLast: () => void;
  onUndoOne: (id: string, kind: DesignEdit["kind"]) => void;
  onSelectChange: (id: string) => void;
  dirty: boolean;
  saveState: "idle" | "saving" | "saved";
  onSave: () => void;
  picking: boolean;
  onPick: () => void;
  onCancelPick: () => void;
  onBack: () => void;
  onSwap: (plant: CatalogPlant) => void;
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
          onUndoLast={onUndoLast}
          onUndoOne={onUndoOne}
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

  if (picking) {
    return <Picker current={plant} onCancel={onCancelPick} onPick={onSwap} />;
  }

  const size = currentSize(plant, selected);

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
        <button
          type="button"
          onClick={onBack}
          aria-label="Clear selection"
          className="shrink-0 px-1 text-sm text-faint transition hover:text-ink"
        >
          ✕
        </button>
      </div>

      {staged ? (
        <div className="flex flex-1 flex-col justify-between gap-3 p-4">
          <p className="text-sm text-clay">
            Staged for removal. It stays on the plan as an outline until you
            publish.
          </p>
          <button
            type="button"
            onClick={onUndelete}
            className="rounded-lg border border-rule-strong bg-paper-deep px-3 py-2 text-[13px] font-semibold text-ink transition hover:bg-card-hover"
          >
            Keep this plant
          </button>
        </div>
      ) : (
        <>
          <div className="border-b border-rule px-4 py-3">
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
              Size
            </p>
            <div className="flex flex-wrap gap-1.5">
              {plant.sizes.map((s) => {
                const on = s.size === size?.size;
                return (
                  <button
                    key={s.size}
                    type="button"
                    onClick={() => onResize(s.size)}
                    aria-pressed={on}
                    className={`rounded-lg border px-2 py-1 text-left text-xs transition ${
                      on
                        ? "border-accent bg-card-hover font-semibold text-accent-dim"
                        : "border-rule bg-card-hover text-muted hover:border-accent/50"
                    }`}
                  >
                    {s.size}
                    <span className="mt-0.5 block font-mono text-[0.68rem] tabular-nums">
                      {currency.format(s.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 p-4">
            <button
              type="button"
              onClick={onPick}
              className="rounded-lg border border-rule-strong bg-paper-deep px-3 py-2 text-[13px] font-semibold text-ink transition hover:bg-card-hover"
            >
              Replace plant
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg px-3 py-2 text-[13px] font-semibold text-clay transition hover:bg-clay/[0.08]"
            >
              Remove from design
            </button>
            {/* Saves the whole draft, not just this plant — but this is
                where the designer's hands already are. */}
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saveState === "saving"}
              className="mt-1 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-[#f5eeda] transition hover:bg-accent-bright disabled:bg-paper-deep disabled:text-faint"
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved" && !dirty
                  ? "Saved"
                  : "Save changes"}
            </button>
          </div>
        </>
      )}
      <ChangeList
        changes={changes}
        selectedId={selectedId}
        undoLabel={undoLabel}
        onUndoLast={onUndoLast}
        onUndoOne={onUndoOne}
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
  onUndoLast,
  onUndoOne,
  onSelect,
}: {
  changes: ChangeRow[];
  selectedId: string | null;
  undoLabel: string | null;
  onUndoLast: () => void;
  onUndoOne: (id: string, kind: DesignEdit["kind"]) => void;
  onSelect: (id: string) => void;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-rule">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
          Changes
        </span>
        {undoLabel && (
          <button
            type="button"
            onClick={onUndoLast}
            // Named rather than a bare arrow: knowing it's the remove you're
            // about to take back is the difference between using it and not.
            title="⌘Z"
            className="text-xs font-semibold text-accent transition hover:text-accent-bright"
          >
            ↩ {undoLabel}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {changes.map((c) => (
          <div
            key={c.key}
            className={`flex items-center gap-2 border-t border-rule/60 px-4 py-2 ${
              c.id === selectedId ? "bg-gold/10" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[13px] text-muted">
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
              onClick={() => onUndoOne(c.id, c.kind)}
              aria-label={`Undo ${c.from} ${c.to}`}
              title="Undo this change"
              className="shrink-0 px-1 text-xs text-faint transition hover:text-ink"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Replace picker ───────────────────────────────────────────────────── */

function Picker({
  current,
  onCancel,
  onPick,
}: {
  current: CatalogPlant;
  onCancel: () => void;
  onPick: (plant: CatalogPlant) => void;
}) {
  const [query, setQuery] = useState("");
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
          <button
            key={p.key}
            type="button"
            onClick={() => onPick(p)}
            disabled={p.key === current.key}
            className="flex w-full items-center gap-3 border-b border-rule px-4 py-2 text-left transition hover:bg-ink/[0.04] disabled:opacity-40"
          >
            <Thumb plant={p} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{p.name}</span>
              <span className="block truncate text-xs text-muted">
                {p.sizes.length > 0 &&
                  `${p.sizes[0].size} ${currency.format(p.sizes[0].price)}`}
                {p.key === current.key && " · current"}
              </span>
            </span>
          </button>
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
