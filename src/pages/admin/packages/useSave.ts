import { useState } from "react";
import { useToast } from "../../../components/Toast";
import { api, errorMessage, fieldErrors, type Envelope } from "../../../utils/api";
import type { PackageDetail } from "./types";

/** Runs a save request that returns the updated package, shows a toast and collects field errors. */
export function useSave(onSaved: (pkg: PackageDetail) => void) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const run = async (request: () => Promise<Envelope<PackageDetail>>) => {
    setSaving(true);
    setErrors({});
    try {
      const res = await request();
      if (res.data) onSaved(res.data);
      toast("success", res.message ?? "Saved");
      return true;
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { saving, errors, run, api };
}
