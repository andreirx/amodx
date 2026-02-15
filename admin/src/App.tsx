import { useEffect, useState } from "react";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { getCurrentUser } from 'aws-amplify/auth';
import LoginPage from "@/pages/Login";
import StrategyBoard from "@/pages/StrategyBoard";
import StrategyEditor from "@/pages/StrategyEditor";
import ContentList from "@/pages/ContentList";
import ContentEditor from "@/pages/ContentEditor";
import SettingsPage from "@/pages/Settings";
import AdminLayout from "@/components/layout/AdminLayout";
import { TenantProvider } from "@/context/TenantContext";
import MediaLibrary from "@/pages/MediaLibrary";
import AuditLog from "@/pages/AuditLog";
import Resources from "@/pages/Resources";
import Leads from "@/pages/Leads";
import Products from "@/pages/Products";
import ProductEditor from "@/pages/ProductEditor";
import UsersPage from "@/pages/Users";
import Comments from "@/pages/Comments";
import ContentGraph from "@/pages/ContentGraph";
import Signals from "@/pages/Signals";
import Categories from "@/pages/Categories";
import CategoryEditor from "@/pages/CategoryEditor";

// 1. Create a Shell Component to handle Auth & Context
// This replaces the old "ProtectedRoute" wrapper logic inside the routes
function AppShell() {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

    useEffect(() => {
        checkAuth();
    }, []);

    async function checkAuth() {
        try {
            await getCurrentUser();
            setIsAuthenticated(true);
        } catch {
            setIsAuthenticated(false);
        }
    }

    if (isAuthenticated === null) {
        return <div className="flex h-screen items-center justify-center">Loading...</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return (
        <TenantProvider>
            {/* AdminLayout renders <Outlet /> for the child routes */}
            <AdminLayout />
        </TenantProvider>
    );
}

// 2. Define the Router Configuration
const router = createBrowserRouter([
    {
        path: "/login",
        element: <LoginPage />,
    },
    {
        path: "/",
        element: <AppShell />, // Acts as the layout + auth guard
        children: [
            { index: true, element: <ContentList /> },
            { path: "graph", element: <ContentGraph /> },
            { path: "content/:id", element: <ContentEditor /> },
            { path: "products", element: <Products /> },
            { path: "products/:id", element: <ProductEditor /> },
            { path: "categories", element: <Categories /> },
            { path: "categories/:id", element: <CategoryEditor /> },
            { path: "strategy", element: <StrategyBoard /> },
            { path: "strategy/:id", element: <StrategyEditor /> },
            { path: "media", element: <MediaLibrary /> },
            { path: "leads", element: <Leads /> },
            { path: "comments", element: <Comments /> },
            { path: "audit", element: <AuditLog /> },
            { path: "resources", element: <Resources /> },
            { path: "users", element: <UsersPage /> },
            { path: "signals", element: <Signals /> },
            { path: "settings", element: <SettingsPage /> },
        ],
    },
]);

// 3. Export the App
export default function App() {
    return <RouterProvider router={router} />;
}
