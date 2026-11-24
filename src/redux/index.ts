import { configureStore } from "@reduxjs/toolkit";
import { onSessionChange } from "../utils/api";
import authReducer, { sessionChanged } from "./slices/authSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
  },
});

// Every login, refresh or logout (including silent refreshes inside API calls) updates the store.
onSessionChange((session) => store.dispatch(sessionChanged(session?.user ?? null)));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
