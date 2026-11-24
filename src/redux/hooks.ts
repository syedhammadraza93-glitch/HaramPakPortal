import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./index";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/** The logged-in user (null when logged out). */
export const useMe = () => useAppSelector((s) => s.auth.user);

/** True when the logged-in user holds every listed permission. */
export function useCan(...permissions: string[]): boolean {
  const user = useMe();
  return !!user && permissions.every((p) => user.permissions.includes(p));
}
