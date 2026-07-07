"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import type { PriceSheet } from "./page";

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function PriceSheets({
  sheets,
  userId,
}: {
  sheets: PriceSheet[];
  userId: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rowCount = XLSX.utils.sheet_to_json(firstSheet).length;

      const supabase = createClient();
      const filePath = `${userId}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("price-sheets")
        .upload(filePath, file);
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from("price_sheets").insert({
        file_name: file.name,
        file_path: filePath,
        row_count: rowCount,
      });
      if (insertError) throw new Error(insertError.message);

      setStatus(`Uploaded ${file.name} (${rowCount} rows).`);
      router.refresh();
    } catch (err) {
      setStatus(
        `Upload failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(sheet: PriceSheet) {
    setBusy(true);
    setStatus(null);
    try {
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("price_sheets")
        .delete()
        .eq("id", sheet.id);
      if (dbError) throw new Error(dbError.message);

      await supabase.storage.from("price-sheets").remove([sheet.file_path]);
      router.refresh();
    } catch (err) {
      setStatus(
        `Delete failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {sheets.length === 0 ? (
        <p className="text-sm text-muted">No price sheets uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {sheets.map((sheet) => (
            <li
              key={sheet.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-body">
                  {sheet.file_name}
                </p>
                <p className="text-xs text-faint">
                  {sheet.row_count != null ? `${sheet.row_count} rows · ` : ""}
                  {shortDate.format(new Date(sheet.created_at))}
                </p>
              </div>
              <span className="flex items-center gap-4 text-sm">
                {sheet.signedUrl && (
                  <a
                    href={sheet.signedUrl}
                    className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                  >
                    Download
                  </a>
                )}
                <button
                  onClick={() => handleDelete(sheet)}
                  disabled={busy}
                  className="font-medium text-clay transition hover:opacity-75 disabled:opacity-40"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-rule pt-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleUpload}
          disabled={busy}
          className="hidden"
          id="price-sheet-upload"
        />
        <label
          htmlFor="price-sheet-upload"
          className={`inline-block cursor-pointer rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper shadow-[0_10px_22px_-10px_rgba(35,74,53,0.45)] transition hover:-translate-y-0.5 hover:bg-accent-bright ${
            busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {busy ? "Working…" : "Upload price sheet"}
        </label>
        {status && <p className="mt-2 text-sm text-muted">{status}</p>}
      </div>
    </div>
  );
}
