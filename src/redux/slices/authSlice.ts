import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { api, refreshSession, setSession, type Me, type Session } from "../../utils/api";

interface AuthState {
  user: Me | null;
  /** "loading" until the first refresh attempt finishes on page load. */
  status: "loading" | "authenticated" | "anonymous";
}

const initialState: AuthState = { user: null, status: "loading" };

type LoginResponse = Session | { mfaRequired: true; mfaToken: string; sentTo: string };

/** On page load: use the refresh cookie (if any) to restore the session. */
export const restoreSession = createAsyncThunk("auth/restore", async () => {
  await refreshSession();
});

/** Step 1: email + password. Returns { mfa } when an emailed code is needed next. */
export const login = createAsyncThunk("auth/login", async (credentials: { email: string; password: string }) => {
  const res = await api.post<LoginResponse>("/auth/login", credentials);
  if ("mfaRequired" in res.data) return { mfa: { token: res.data.mfaToken, sentTo: res.data.sentTo }, user: null };
  setSession(res.data);
  return { mfa: null, user: res.data.user };
});

/** Step 2 (two-factor login): the 6-digit code from the email. */
export const loginMfa = createAsyncThunk("auth/loginMfa", async (body: { mfaToken: string; code: string }) => {
  const res = await api.post<Session>("/auth/login/mfa", body);
  setSession(res.data);
  return res.data.user;
});

/** Reloads the logged-in user (e.g. after turning 2FA on). */
export const refreshMe = createAsyncThunk("auth/refreshMe", async (_: void, { dispatch }) => {
  const me = await api.get<Me>("/auth/me");
  dispatch(sessionChanged(me));
  return me;
});

export const logout = createAsyncThunk("auth/logout", async () => {
  await api.post("/auth/logout").catch(() => undefined);
  setSession(null);
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    sessionChanged(state, action: PayloadAction<Me | null>) {
      state.user = action.payload;
      state.status = action.payload ? "authenticated" : "anonymous";
    },
  },
  extraReducers: (builder) => {
    builder.addCase(restoreSession.fulfilled, (state) => {
      if (state.status === "loading") state.status = state.user ? "authenticated" : "anonymous";
    });
  },
});

export const { sessionChanged } = authSlice.actions;
export default authSlice.reducer;
