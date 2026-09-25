"use client";

// The design editor. LivingBlueprint stays a renderer — it reports which
// plant was clicked and draws the selection and the ghosts; all the edit
// state lives here.
//
// Edits are a list, not a mutated design: it keeps undo trivial, lets a
// delete stay visible as a ghost until it's published, and makes the draft
// one derived value rather than a pile of in-place mutations.

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LivingBlueprint, type LivingBlueprintProps } from "@/lib/viewer/LivingBlueprint";
import { createClient } from "@/lib/supabase/client";
import {
  PLANTS,
  applyEdits,
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
      // The dev fixture is a sample scene with no row behind it; editing it
      // is for looking at the UI, not for persisting anything.
      if (projectId === "fixture") return;
      setSaveState("idle");
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

  const undoFor = useCallback(
    (id: string, kind: DesignEdit["kind"]) => {
      setEdits((prev) => {
        const list = prev.filter((e) => !(e.id === id && e.kind === kind));
        saveDraft(applyEdits(base, list));
        return list;
      });
    },
    [base, saveDraft]
  );

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
          selectedModel={selected?.plantModelName ?? null}
          editorFullColumn={picking}
          onSelectSpecies={(model) => {
            // The rail is grouped by species; clicking a row selects one of
            // that kind, and clicking again walks to the next — which is how
            // you find the third of four hopseeds.
            const of = (shown.placements ?? []).filter(
              (p) => p.plantModelName === model
            );
            if (of.length === 0) return;
            const at = of.findIndex((p) => p.id === selectedId);
            setSelectedId(of[(at + 1) % of.length].id);
            setPicking(false);
          }}
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
                undoFor(selectedId, "delete");
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
                onClick={saveNow}
                disabled={publishing || saveState === "saving"}
                className="rounded-lg border border-rule-strong bg-paper-deep px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-card-hover disabled:opacity-50"
              >
                Save draft
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

function EditorPanel({
  selected,
  staged,
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
      <p className="px-4 py-3 text-sm text-muted">
        Click a plant — on the plan or in the list below — to replace it,
        change its size, or remove it.
      </p>
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
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
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
        <div className="flex flex-col gap-3 px-4 pb-4">
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
          </div>
        </>
      )}
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
