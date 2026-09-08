import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";
import { Layout, RequireOwner } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { AdminsPage } from "./pages/Admins";
import { AdminDetailPage } from "./pages/AdminDetail";
import { SpendEventsPage } from "./pages/SpendEvents";
import { SpendersPage, SpenderDetailPage } from "./pages/Spenders";
import { PayoutsPage } from "./pages/Payouts";
import { ConfigPage } from "./pages/Config";
import { AuditPage } from "./pages/Audit";
import { PublicAdminPage } from "./pages/PublicAdmin";
import { FlowPage } from "./pages/Flow";
import { AdminHomePage, AdminLoginPage, AdminRegisterPage } from "./pages/AdminPortal";
import { LandingPage } from "./pages/Landing";
import { RiskPage } from "./pages/Risk";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/a/:token", element: <PublicAdminPage /> },
  { path: "/admin", element: <AdminHomePage /> },
  { path: "/admin/login", element: <AdminLoginPage /> },
  { path: "/admin/register", element: <AdminRegisterPage /> },
  {
    path: "/dashboard",
    element: <RequireOwner><Layout /></RequireOwner>,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "flow", element: <FlowPage /> },
      { path: "admins", element: <AdminsPage /> },
      { path: "admins/:id", element: <AdminDetailPage /> },
      { path: "spend", element: <SpendEventsPage /> },
      { path: "spenders", element: <SpendersPage /> },
      { path: "spenders/:id", element: <SpenderDetailPage /> },
      { path: "payouts", element: <PayoutsPage /> },
      { path: "risk", element: <RiskPage /> },
      { path: "config", element: <ConfigPage /> },
      { path: "audit", element: <AuditPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>
  </React.StrictMode>,
);
