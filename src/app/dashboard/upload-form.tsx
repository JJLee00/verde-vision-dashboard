"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

export function UploadForm({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStatus(null);

    try {
      // Count data rows in the first sheet so the dashboard can show a summary.
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);
      const rowCount = rows.length;

      const supabase = createClient();
      const filePath = `${userId}/${projectId}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("estimates")
        .upload(filePath, file);

      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase
        .from("plant_estimates")
        .insert({
          project_id: projectId,
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
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleUpload}
        disabled={uploading}
        className="hidden"
        id={`upload-${projectId}`}
      />
      <label
        htmlFor={`upload-${projectId}`}
        className={`inline-block cursor-pointer rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 ${
          uploading ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {uploading ? "Uploading…" : "Upload plant estimate (.xlsx)"}
      </label>
      {status && <p className="mt-2 text-sm text-stone-600">{status}</p>}
    </div>
  );
}
