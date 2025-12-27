import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import Resources from "./pages/Resources";
import Leads from "@/pages/Leads";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
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

    if (isAuthenticated === null) return <div>Loading Auth...</div>;
    if (!isAuthenticated) return <Navigate to="/login" replace />;

    return <>{children}</>;
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<LoginPage />} />

                {/* Wrap all internal pages with the Admin Layout */}
                <Route
                    element={
                        <ProtectedRoute>
                            {/* Provider lives inside Auth protection */}
                            <TenantProvider>
                                <AdminLayout />
                            </TenantProvider>
                        </ProtectedRoute>
                    }
                >
                    <Route path="/" element={<ContentList />} />
                    <Route path="/content/:id" element={<ContentEditor />} />
                    <Route path="/strategy" element={<StrategyBoard />} />
                    <Route path="/strategy/:id" element={<StrategyEditor />} />
                    <Route path="/media" element={<MediaLibrary />} />
                    <Route path="/leads" element={<Leads />} />
                    <Route path="/audit" element={<AuditLog />} />
                    <Route path="/resources" element={<Resources />} />
                    <Route path="/settings" element={<SettingsPage />} />
                </Route>

            </Routes>
        </BrowserRouter>
    );
}
