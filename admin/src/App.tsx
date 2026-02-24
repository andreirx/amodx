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
import { AuthProvider } from "@/context/AuthContext";
import MediaLibrary from "@/pages/MediaLibrary";
import AuditLog from "@/pages/AuditLog";
import Resources from "@/pages/Resources";
import Leads from "@/pages/Leads";
import Products from "@/pages/Products";
import ProductEditor from "@/pages/ProductEditor";
import DigitalProducts from "@/pages/DigitalProducts";
import DigitalProductEditor from "@/pages/DigitalProductEditor";
import UsersPage from "@/pages/Users";
import Comments from "@/pages/Comments";
import ContentGraph from "@/pages/ContentGraph";
import Signals from "@/pages/Signals";
import Categories from "@/pages/Categories";
import CategoryEditor from "@/pages/CategoryEditor";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import DeliverySettings from "@/pages/DeliverySettings";
import Coupons from "@/pages/Coupons";
import CouponEditor from "@/pages/CouponEditor";
import Reviews from "@/pages/Reviews";
import Popups from "@/pages/Popups";
import PopupEditor from "@/pages/PopupEditor";
import Forms from "@/pages/Forms";
import FormEditor from "@/pages/FormEditor";
import FormSubmissions from "@/pages/FormSubmissions";
import OrderEmails from "@/pages/OrderEmails";
import Labels from "@/pages/Labels";
import Reports from "@/pages/Reports";
import MigrationPage from "@/pages/Migration";

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
        <AuthProvider>
            <TenantProvider>
                {/* AdminLayout renders <Outlet /> for the child routes */}
                <AdminLayout />
            </TenantProvider>
        </AuthProvider>
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
            { path: "digital-products", element: <DigitalProducts /> },
            { path: "digital-products/:id", element: <DigitalProductEditor /> },
            { path: "categories", element: <Categories /> },
            { path: "categories/:id", element: <CategoryEditor /> },
            { path: "reports", element: <Reports /> },
            { path: "orders", element: <Orders /> },
            { path: "orders/:id", element: <OrderDetail /> },
            { path: "customers", element: <Customers /> },
            { path: "customers/:email", element: <CustomerDetail /> },
            { path: "delivery", element: <DeliverySettings /> },
            { path: "order-emails", element: <OrderEmails /> },
            { path: "labels", element: <Labels /> },
            { path: "coupons", element: <Coupons /> },
            { path: "coupons/:id", element: <CouponEditor /> },
            { path: "reviews", element: <Reviews /> },
            { path: "popups", element: <Popups /> },
            { path: "popups/:id", element: <PopupEditor /> },
            { path: "forms", element: <Forms /> },
            { path: "forms/:id", element: <FormEditor /> },
            { path: "forms/:id/submissions", element: <FormSubmissions /> },
            { path: "strategy", element: <StrategyBoard /> },
            { path: "strategy/:id", element: <StrategyEditor /> },
            { path: "media", element: <MediaLibrary /> },
            { path: "leads", element: <Leads /> },
            { path: "comments", element: <Comments /> },
            { path: "audit", element: <AuditLog /> },
            { path: "resources", element: <Resources /> },
            { path: "users", element: <UsersPage /> },
            { path: "signals", element: <Signals /> },
            { path: "migration", element: <MigrationPage /> },
            { path: "settings", element: <SettingsPage /> },
        ],
    },
]);

// 3. Export the App
export default function App() {
    return <RouterProvider router={router} />;
}
