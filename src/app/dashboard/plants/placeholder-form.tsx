"use client";

// Create / edit a placeholder plant. Everything the estimate and the
// headset need for a plant we have no mesh for: a name, a stand-in form,
// real mature dimensions, priced container sizes, and optionally a photo
// so the client still sees what it actually looks like.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  SYMBOLS,
  SymbolGlyph,
  INSTALLED_HEIGHT_FT,
  plantKey,
  type PlaceholderSymbol,
} from "@/lib/placeholder-symbols";
import type { CustomPlant, CustomPlantSize } from "@/lib/custom-plants";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type SizeDraft = { size: string; on: boolean; price: string; installed: string };

export function PlaceholderForm({
  sizeOptions,
  userId,
  existing,
  onClose,
}: {
  sizeOptions: string[];
  userId: string;
  existing: CustomPlant | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [botanical, setBotanical] = useState(existing?.botanical_name ?? "");
  const [symbol, setSymbol] = useState<PlaceholderSymbol>(
    (existing?.symbol as PlaceholderSymbol) ?? "shrub"
  );
  const [height, setHeight] = useState(
    existing?.mature_height_ft != null ? String(existing.mature_height_ft) : ""
  );
  const [width, setWidth] = useState(
    existing?.mature_width_ft != null ? String(existing.mature_width_ft) : ""
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [sizes, setSizes] = useState<SizeDraft[]>(() =>
    sizeOptions.map((size) => {
      const saved = existing?.sizes?.find((s) => s.size === size);
      return {
        size,
        on: !!saved,
        price: saved?.price != null ? String(saved.price) : "",
        installed:
          saved?.installedHeightFt != null
            ? String(saved.installedHeightFt)
            : String(INSTALLED_HEIGHT_FT[size] ?? ""),
      };
    })
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Picking a symbol prefills typical dimensions, but only while both
  // fields are untouched — never clobber a number the designer typed.
  function chooseSymbol(next: PlaceholderSymbol) {
    setSymbol(next);
    if (height === "" && width === "") {
      const meta = SYMBOLS.find((s) => s.id === next)!;
      setHeight(String(meta.defaultHeightFt));
      setWidth(String(meta.defaultWidthFt));
    }
  }

  // Object URL is minted on selection rather than in an effect, so the
  // preview never lags a render behind the chosen file.
  function choosePhoto(file: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = file ? URL.createObjectURL(file) : null;
    setPhotoFile(file);
    setPhotoPreview(previewRef.current);
  }

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const chosen = sizes.filter((s) => s.on);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the plant a name.");
    if (chosen.length === 0)
      return setError("Pick at least one container size — the estimate needs one.");
    const badPrice = chosen.find(
      (s) => s.price.trim() === "" || Number.isNaN(Number(s.price)) || Number(s.price) < 0
    );
    if (badPrice) return setError(`Enter a price for ${badPrice.size}.`);
    const h = Number(height);
    const w = Number(width);
    if (!(h > 0) || !(w > 0))
      return setError("Mature height and width drive the stand-in's size — both are needed.");

    setBusy(true);
    setError(null);
    const supabase = createClient();

    try {
      let photo_path = existing?.photo_path ?? null;
      if (photoFile) {
        if (photoFile.size > MAX_IMAGE_BYTES) throw new Error("Image is over 20 MB.");
        const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${userId}/placeholders/${plantKey(trimmed).replace(/ /g, "-")}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("project-media")
          .upload(path, photoFile, { contentType: photoFile.type });
        if (upErr) throw new Error(upErr.message);
        photo_path = path;
      }

      const payload = {
        name: trimmed,
        botanical_name: botanical.trim() || null,
        key: plantKey(trimmed),
        symbol,
        mature_height_ft: h,
        mature_width_ft: w,
        sizes: chosen.map<CustomPlantSize>((s) => ({
          size: s.size,
          price: Number(s.price),
          installedHeightFt: s.installed.trim() === "" ? null : Number(s.installed),
        })),
        photo_path,
        notes: notes.trim() || null,
        status: "ready" as const,
      };

      const { error: saveErr } = existing
        ? await supabase.from("custom_plants").update(payload).eq("id", existing.id)
        : await supabase.from("custom_plants").insert(payload);

      if (saveErr) {
        // The (org_id, key) unique index — a placeholder for this plant
        // already exists, so editing it is the right move, not a second row.
        throw new Error(
          saveErr.code === "23505"
            ? `Your team already has a placeholder named "${trimmed}". Open it from the library to edit it.`
            : saveErr.message
        );
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-[9px] border border-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";
  const label =
    "text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-[2px]"
      onClick={() => !busy && onClose()}
    >
      <div
        className="my-auto w-full max-w-2xl rounded-[14px] border border-edge bg-card p-6 shadow-[0_30px_80px_-30px_rgba(28,42,33,0.6)]"
        onClick={(e) => e.stopPropagation()}
        onChange={() => error && setError(null)}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-clay">
              {existing ? "Edit placeholder" : "New placeholder"}
            </p>
            <h2 className="mt-1 font-serif text-2xl text-ink">
              {existing ? existing.name : "A plant we don't model yet"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              It places, prices, and orders like any other plant — the client
              sees a correctly-sized stand-in instead of a photoreal mesh.
            </p>
          </div>
          <button
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="rounded-full border border-edge px-2.5 py-1 text-sm text-muted hover:bg-card-hover"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="ph-name">Plant name</label>
            <input
              id="ph-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bougainvillea"
              className={`mt-1 ${field}`}
            />
          </div>
          <div>
            <label className={label} htmlFor="ph-botanical">
              Botanical name <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="ph-botanical"
              value={botanical}
              onChange={(e) => setBotanical(e.target.value)}
              placeholder="Bougainvillea glabra"
              className={`mt-1 ${field}`}
            />
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className={label}>Stand-in form</legend>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {SYMBOLS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => chooseSymbol(s.id)}
                title={s.hint}
                aria-pressed={symbol === s.id}
                className={`flex flex-col items-center gap-1 rounded-[10px] border px-1.5 py-2 transition-colors ${
                  symbol === s.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-edge bg-paper text-ink/60 hover:bg-card-hover"
                }`}
              >
                <SymbolGlyph symbol={s.id} className="h-9 w-9" />
                <span className="text-center text-[0.62rem] leading-tight">
                  {s.label}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="ph-h">Mature height (ft)</label>
            <input
              id="ph-h"
              inputMode="decimal"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className={`mt-1 ${field}`}
            />
          </div>
          <div>
            <label className={label} htmlFor="ph-w">Mature width (ft)</label>
            <input
              id="ph-w"
              inputMode="decimal"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className={`mt-1 ${field}`}
            />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          These drive how big the stand-in draws, so the client can judge
          what it fills and blocks. Mature mode grows it to this size.
        </p>

        <fieldset className="mt-5">
          <legend className={label}>Container sizes &amp; installed price</legend>
          <div className="mt-2 overflow-hidden rounded-[10px] border border-edge">
            <table className="w-full text-sm">
              <thead className="bg-paper text-[0.66rem] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Size</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Price</th>
                  <th className="px-3 py-1.5 text-left font-semibold">
                    Height at install (ft)
                  </th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((s, i) => (
                  <tr key={s.size} className="border-t border-edge">
                    <td className="px-3 py-1.5">
                      <label className="flex items-center gap-2 text-ink">
                        <input
                          type="checkbox"
                          checked={s.on}
                          onChange={(e) =>
                            setSizes((prev) =>
                              prev.map((p, j) =>
                                j === i ? { ...p, on: e.target.checked } : p
                              )
                            )
                          }
                          className="accent-accent"
                        />
                        {s.size}
                      </label>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        inputMode="decimal"
                        value={s.price}
                        disabled={!s.on}
                        placeholder="—"
                        onChange={(e) =>
                          setSizes((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, price: e.target.value } : p
                            )
                          )
                        }
                        className="w-24 rounded-[7px] border border-edge bg-paper px-2 py-1 text-ink disabled:opacity-40"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        inputMode="decimal"
                        value={s.installed}
                        disabled={!s.on}
                        onChange={(e) =>
                          setSizes((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, installed: e.target.value } : p
                            )
                          )
                        }
                        className="w-24 rounded-[7px] border border-edge bg-paper px-2 py-1 text-ink disabled:opacity-40"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Install height is what the client sees on day one — prefilled
            from typical nursery stock, override it if you know better.
          </p>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-[auto_1fr]">
          <div>
            <span className={label}>Reference photo</span>
            <div className="mt-1 flex items-center gap-3">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[10px] border border-edge bg-paper">
                {photoPreview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <SymbolGlyph symbol={symbol} className="h-10 w-10 text-accent/40" />
                )}
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-[9px] border border-edge bg-paper px-3 py-1.5 text-sm text-ink hover:bg-card-hover"
                >
                  {photoFile || existing?.photo_path ? "Replace" : "Choose photo"}
                </button>
                <p className="mt-1 max-w-[16rem] text-xs text-muted">
                  A nursery shot beside a right-sized form covers most of
                  what the missing model would have shown.
                </p>
              </div>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="ph-notes">
              Notes <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="ph-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Where to source it, substitutions, anything the crew needs."
              className={`mt-1 ${field} resize-none`}
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-clay">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="rounded-[9px] px-3.5 py-2 text-sm text-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-[9px] bg-accent px-4 py-2 text-sm font-medium text-card transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            {busy ? "Saving…" : existing ? "Save changes" : "Add to library"}
          </button>
        </div>
      </div>
    </div>
  );
}
