import { useEffect, useState } from "react";
import { useMe } from "../../redux/hooks";
import { api } from "../../utils/api";
import defaults from "./website-defaults.json";

export type ContentValue = string | number | boolean | ContentValue[] | { [key: string]: ContentValue };
type SectionKey = keyof typeof defaults;
const siteDefaults = defaults as unknown as Record<SectionKey, ContentValue>;
type Section = { key: SectionKey; version: number; draft: ContentValue | null; publishedAt: string | null };
const labels: Record<Section["key"], string> = {
  pageBanners: "Page headings", packages: "Umrah packages", homepage: "Homepage", faqs: "FAQs", offices: "Office directory",
  clients: "Our Clients", ziarat: "Ziarat tours", visas: "Visa assistance", contact: "Contact details",
};
const templates: Record<string, ContentValue> = {
  clients: { name: "", logo: "" },
  faqs: { question: "", answer: "" },
  visas: { title: "", copy: "" },
  ziarat: { key: "iraq-ziarat", title: "", description: "", stops: "" },
  packages: { id: "", title: "", category: "Group", label: "", image: "/images/makkah-golden-hour.webp", imageAlt: "", summary: "", duration: "", departure: "", stay: "", hotels: [], itinerary: [] },
  itinerary: { city: "", nights: 1, hotel: "", note: "" },
  hotels: { city: "", name: "", note: "" },
  offices: { city: "", address: "", sample: false },
  featuredPackageIds: "",
};
const field = "w-full rounded-md border bg-white p-2 text-sm";
const button = "rounded-md border border-brand-700 px-3 py-2 text-sm font-medium text-brand-800 disabled:opacity-50";
const message = (error: unknown) => error instanceof Error ? error.message : "The request failed.";

function empty(value: ContentValue): ContentValue {
  if (Array.isArray(value)) return [];
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, empty(val)]));
  if (typeof value === "string") return "";
  if (typeof value === "number") return 0;
  return false;
}

function ContentFields({ value, name, onChange, readonly = false }: { value: ContentValue; name: string; onChange: (value: ContentValue) => void; readonly?: boolean }) {
  const title = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (Array.isArray(value)) {
    const template = name === labels.offices ? { country: "", code: "", phones: [], offices: [] }
      : Object.entries(labels).find(([, label]) => label === name)?.[0];
    const blueprint = (typeof template === "object" ? template : templates[template || name]) ?? (value[0] !== undefined ? empty(value[0]) : "");
    return <fieldset className="space-y-3"><legend className="mb-1 text-sm font-semibold capitalize">{title}</legend>
      {value.map((item, index) => <div key={index} className="space-y-2 rounded-md border bg-white/60 p-3">
        <ContentFields value={item} name={String(index + 1)} readonly={readonly} onChange={next => onChange(value.map((previous, i) => index === i ? next : previous))} />
        {!readonly && <button type="button" className={button} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove row {index + 1}</button>}
      </div>)}
      {!readonly && <button type="button" className={button} onClick={() => onChange([...value, structuredClone(blueprint)])}>Add row</button>}
    </fieldset>;
  }
  if (typeof value === "object") {
    return <div className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key, item]) =>
      <div key={key} className={typeof item === "object" ? "sm:col-span-2" : ""}>
        <ContentFields value={item} name={key} readonly={readonly} onChange={next => onChange({ ...value, [key]: next })} />
      </div>)}</div>;
  }
  if (typeof value === "boolean") return <label className="flex gap-2 text-sm"><input disabled={readonly} type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />{title}</label>;
  const large = ["description", "summary", "copy", "answer", "note", "address"].includes(name);
  return <label className="grid gap-1 text-sm capitalize">{title}
    {large ? <textarea readOnly={readonly} className={field} value={value} onChange={event => onChange(event.target.value)} /> :
      <input readOnly={readonly} className={field} type={typeof value === "number" ? "number" : "text"} value={value}
        onChange={event => onChange(typeof value === "number" ? Number(event.target.value) : event.target.value)} />}
  </label>;
}

export function WebsiteContentPage() {
  const me = useMe();
  const edit = !!me?.permissions.includes("website.edit");
  const publish = !!me?.permissions.includes("website.publish");
  const [sections, setSections] = useState<Section[]>([]);
  const [current, setCurrent] = useState<Section["key"]>("packages");
  const [draft, setDraft] = useState<ContentValue>(structuredClone(siteDefaults.packages));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>();
  const active = sections.find(section => section.key === current);

  function choose(section: Section) {
    setCurrent(section.key);
    const content = structuredClone(section.draft ?? siteDefaults[section.key]);
    setDraft(Array.isArray(content) && ["clients", "packages"].includes(section.key) ? content.map(row => {
      if (typeof row !== "object" || Array.isArray(row)) return row;
      return section.key === "clients" ? { logo: "", ...row } : { itinerary: [], hotels: [], ...row };
    }) : content);
    setDirty(false);
    setNotice(undefined);
  }
  useEffect(() => {
    let active = true;
    void api.get<Section[]>("/admin/website").then(rows => {
      if (!active) return;
      setSections(rows);
      if (rows[0]) choose(rows[0]);
    }).catch(error => { if (active) setNotice({ message: message(error), error: true }); });
    return () => { active = false; };
  }, []);

  async function apply(action: "save" | "publish") {
    if (!active) return;
    setBusy(true);
    setNotice(undefined);
    try {
      let payload = draft;
      if (current === "clients" && Array.isArray(payload)) {
        payload = payload.map(row => typeof row === "object" && !Array.isArray(row) && row.logo === "" ? { name: row.name } : row);
      }
      const result = action === "save"
        ? await api.put<Section>("/admin/website/" + current, { version: active.version, payload })
        : await api.post<Section>("/admin/website/" + current + "/publish", { version: active.version });
      setSections(rows => rows.map(row => row.key === current ? result.data : row));
      choose(result.data);
      setNotice({ message: action === "save" ? "Draft saved for review." : "Published to the website." });
    } catch (error) {
      const fields = typeof error === "object" && error && "errors" in error ? error.errors : undefined;
      const issue = Array.isArray(fields) ? fields.map(field => [field.path, field.message].filter(Boolean).join(" ")).slice(0, 3).join(". ") : "";
      setNotice({ message: issue || message(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return <section className="mx-auto max-w-5xl space-y-5">
    <header><h1 className="text-2xl font-bold">Website content</h1><p className="mt-1 text-sm text-slate-600">Prepare drafts, review the content and publish approved changes.</p></header>
    <nav aria-label="Website sections" className="flex flex-wrap gap-2">{sections.map(section =>
      <button type="button" key={section.key} className={button} aria-pressed={current === section.key}
        disabled={busy || dirty && current !== section.key} onClick={() => choose(section)}>{labels[section.key]}</button>)}</nav>
    {active && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{labels[current]}</h2>
        <p className="text-sm text-slate-600">{active.publishedAt ? "Published " + new Date(active.publishedAt).toLocaleString() : "Using current website defaults"}</p>
      </div>
      <ContentFields value={draft} name={labels[current]} readonly={!edit || busy} onChange={value => { setDraft(value); setDirty(true); }} />
      <div className="flex flex-wrap gap-2">
        {edit && <button type="button" className={button} disabled={busy || (!dirty && active.version > 0)} onClick={() => void apply("save")}>Save draft</button>}
        {dirty && <button type="button" className={button} disabled={busy} onClick={() => choose(active)}>Discard unsaved changes</button>}
        {publish && <button type="button" className={button} disabled={busy || dirty || !active.version} onClick={() => void apply("publish")}>Publish to website</button>}
      </div>
    </>}
    {notice && <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-red-700" : "text-brand-700"}>{notice.message}</p>}
  </section>;
}
