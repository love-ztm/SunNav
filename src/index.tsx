import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { LanguageProvider } from "./contexts/LanguageContext";
import { queryClient } from "./services/queries";
import { AdminGuard } from "./components/admin/AdminGuard";
import { useDesignTokens } from "./hooks/useDesignTokens";

const AdminLayout = React.lazy(() => import("./components/admin/AdminLayout"));
const AdminAuthPage = React.lazy(() => import("./components/admin/AdminAuthPage"));
const ContentPage = React.lazy(() => import("./components/admin/ContentPage"));
const GeneralPage = React.lazy(() => import("./components/admin/GeneralPage"));
const AppearancePage = React.lazy(() => import("./components/admin/AppearancePage"));
const DataPage = React.lazy(() => import("./components/admin/DataPage"));
const StatsPage = React.lazy(() => import("./components/admin/StatsPage"));

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/**
 * Applies the saved theme color globally across all routes (dashboard + admin),
 * so theme-color changes take effect immediately everywhere.
 */
const ThemeColorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useDesignTokens();
  return <>{children}</>;
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <BrowserRouter>
          <ThemeColorProvider>
            <Routes>
              <Route path="/" element={<App />} />
              <Route
                path="/admin/auth"
                element={
                  <Suspense>
                    <AdminAuthPage />
                  </Suspense>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminGuard>
                    <Suspense>
                      <AdminLayout />
                    </Suspense>
                  </AdminGuard>
                }
              >
                <Route index element={<Navigate to="content" replace />} />
                <Route
                  path="content"
                  element={
                    <Suspense>
                      <ContentPage />
                    </Suspense>
                  }
                />
                <Route
                  path="general"
                  element={
                    <Suspense>
                      <GeneralPage />
                    </Suspense>
                  }
                />
                <Route
                  path="appearance"
                  element={
                    <Suspense>
                      <AppearancePage />
                    </Suspense>
                  }
                />
                <Route
                  path="data"
                  element={
                    <Suspense>
                      <DataPage />
                    </Suspense>
                  }
                />
                <Route
                  path="stats"
                  element={
                    <Suspense>
                      <StatsPage />
                    </Suspense>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ThemeColorProvider>
        </BrowserRouter>
      </LanguageProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
