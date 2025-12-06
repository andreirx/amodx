import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentUser } from 'aws-amplify/auth';
import LoginPage from "@/pages/Login";
import StrategyBoard from "@/pages/StrategyBoard";
import ContentList from "@/pages/ContentList";
import ContentEditor from "@/pages/ContentEditor";
import AdminLayout from "@/components/layout/AdminLayout"; // <--- Import

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
                            <AdminLayout />
                        </ProtectedRoute>
                    }
                >
                    <Route path="/" element={<ContentList />} />
                    <Route path="/content/:id" element={<ContentEditor />} />
                    <Route path="/strategy" element={<StrategyBoard />} />
                    {/* Add Settings later */}
                </Route>

            </Routes>
        </BrowserRouter>
    );
}
