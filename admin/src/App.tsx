import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentUser } from 'aws-amplify/auth';
import LoginPage from "@/pages/Login";
import ContentList from "@/pages/ContentList";
import ContentEditor from "@/pages/ContentEditor";

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
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <ContentList />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/content/:id"
                    element={
                        <ProtectedRoute>
                            <ContentEditor />
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </BrowserRouter>
    );
}
