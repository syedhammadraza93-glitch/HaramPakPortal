import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../utils/api";

const ids = {
  appId: "Meta app ID", businessId: "Business portfolio ID", pageId: "Facebook Page ID", adAccountId: "Ad account ID",
  whatsappAccountId: "WhatsApp Business Account ID", phoneNumberId: "WhatsApp phone number ID", instagramAccountId: "Instagram professional account ID",
};
const credentials = {
  appSecret: "Meta app secret", accessToken: "WhatsApp access token", pageAccessToken: "Facebook Page access token",
  instagramAccessToken: "Instagram access token", webhookVerifyToken: "Webhook verification token",
};
type Settings = { version: number; ids: Partial<Record<keyof typeof ids, string>>; configured: string[] };
const field = "w-full rounded-md border bg-white p-2";
const problem = (error: unknown) => error instanceof Error ? error.message : "Could not load or save Meta settings.";

export function MetaSettings() {
  const [data, setData] = useState<Settings>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api.get<Settings>("/admin/meta-settings").then(result => { if (active) setData(result); })
      .catch(error => { if (active) setError(problem(error)); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    const fields = new FormData(event.currentTarget);
    const secrets: Record<string, string | null> = {};
    for (const key of Object.keys(credentials)) {
      const value = String(fields.get(key) ?? "").trim();
      if (fields.has("clear-" + key) && value) {
        setError("Choose either to replace or remove a credential.");
        return;
      }
      if (fields.has("clear-" + key)) secrets[key] = null;
      else if (value) secrets[key] = value;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await api.put<Settings>("/admin/meta-settings", {
        version: data.version, ids: Object.fromEntries(Object.keys(ids).map(key => [key, fields.get(key)])), secrets,
      });
      setData(result.data);
      setSaved(true);
    } catch (error) { setError(problem(error)); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-4xl space-y-4">
    <header><h1 className="text-2xl font-bold">Meta integration</h1>
      <p className="text-sm text-slate-600">Manage account IDs and credentials. Saving settings does not activate messaging or lead imports.</p></header>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {saved && <p role="status" className="text-green-800">Meta settings saved.</p>}
    {data && <form key={data.version} onSubmit={save} autoComplete="off" className="space-y-4">
      <fieldset disabled={busy} className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2">
        <legend className="font-semibold">Account IDs</legend>
        {(Object.keys(ids) as (keyof typeof ids)[]).map(key => <label key={key} className="grid gap-1 text-sm">{ids[key]}
          <input name={key} className={field} inputMode="numeric" pattern="[0-9]*" maxLength={32} defaultValue={data.ids[key] ?? ""} />
        </label>)}
      </fieldset>
      <fieldset disabled={busy} className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2">
        <legend className="font-semibold">Credentials</legend>
        {Object.entries(credentials).map(([key, label]) => <div key={key} className="space-y-1">
          <label className="grid gap-1 text-sm">{label}
            <input name={key} className={field} type="password" autoComplete="new-password" maxLength={4096} placeholder={data.configured.includes(key) ? "Configured. Leave blank to keep" : "Not configured"} />
          </label>
          {data.configured.includes(key) && <label className="flex gap-2 text-sm"><input type="checkbox" name={"clear-" + key} />Remove saved credential</label>}
        </div>)}
      </fieldset>
      <button disabled={busy} className="rounded-md bg-brand-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Saving…" : "Save Meta settings"}</button>
    </form>}
  </section>;
}
