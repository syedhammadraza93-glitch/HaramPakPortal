import { useEffect } from "react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { BrandingProvider } from "./branding/BrandingProvider";
import { ToastProvider } from "./components/Toast";
import { store } from "./redux";
import { restoreSession } from "./redux/slices/authSlice";
import { AppRoutes } from "./routes/AppRoutes";

export default function App() {
  useEffect(() => {
    void store.dispatch(restoreSession());
  }, []);

  return (
    <Provider store={store}>
      <BrandingProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </BrandingProvider>
    </Provider>
  );
}
