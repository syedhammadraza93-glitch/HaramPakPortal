import { ExternalLink, FileText, ImagePlus, Star, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../../components/Toast";
import { Badge, Button, EmptyState } from "../../../components/ui";
import { api, errorMessage } from "../../../utils/api";
import type { PackageDetail, TabProps } from "./types";
import { useSave } from "./useSave";

export function MediaTab({ pkg, onSaved, readOnly }: TabProps) {
  const toast = useToast();
  const { run } = useSave(onSaved);
  const [uploading, setUploading] = useState<"images" | "brochure" | null>(null);

  const upload = async (kind: "images" | "brochure", files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    if (kind === "images") Array.from(files).forEach((f) => fd.append("files", f));
    else fd.append("file", files[0]!);
    setUploading(kind);
    try {
      const res = await api.postForm<PackageDetail>(`/admin/packages/${pkg.id}/${kind === "images" ? "images" : "brochure"}`, fd);
      onSaved(res.data);
      toast("success", res.message ?? "Uploaded");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Images <span className="text-sm font-normal text-slate-500">(up to 10; the first is the cover)</span></h3>
          {!readOnly && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              <ImagePlus className="size-4" /> {uploading === "images" ? "Uploading…" : "Add images"}
              <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={!!uploading} onChange={(e) => void upload("images", e.target.files)} />
            </label>
          )}
        </div>
        {pkg.images.length === 0 ? (
          <EmptyState icon={ImagePlus} title="No images">JPG, PNG or WebP, up to 5 MB each.</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {pkg.images.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-xl border border-slate-200">
                <img src={img.url} alt={img.fileName} className="aspect-[4/3] w-full object-cover" />
                {img.isCover && <Badge tone="green" className="absolute top-2 left-2">Cover</Badge>}
                {!readOnly && (
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    {!img.isCover && (
                      <button className="rounded bg-white/90 p-1.5 text-slate-700 hover:bg-white" title="Make cover" onClick={() => run(() => api.post(`/admin/packages/${pkg.id}/images/${img.id}/cover`))}>
                        <Star className="size-4" />
                      </button>
                    )}
                    <button className="rounded bg-white/90 p-1.5 text-accent-600 hover:bg-white" title="Delete" onClick={() => window.confirm("Delete this image?") && run(() => api.del(`/admin/packages/${pkg.id}/images/${img.id}`))}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-slate-900">Brochure <span className="text-sm font-normal text-slate-500">(PDF, agents can download it)</span></h3>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-4">
          <FileText className="size-6 text-brand-600" />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{pkg.hasBrochure ? pkg.brochureName : "No brochure uploaded"}</span>
          {pkg.hasBrochure && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => api.openFile(`/admin/packages/${pkg.id}/brochure`).catch((e) => toast("error", errorMessage(e)))}>Open</Button>}
          {!readOnly && (
            <>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Upload className="size-4" /> {uploading === "brochure" ? "Uploading…" : pkg.hasBrochure ? "Replace" : "Upload PDF"}
                <input type="file" accept="application/pdf" className="sr-only" disabled={!!uploading} onChange={(e) => void upload("brochure", e.target.files)} />
              </label>
              {pkg.hasBrochure && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run(() => api.del(`/admin/packages/${pkg.id}/brochure`))}>Remove</Button>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
