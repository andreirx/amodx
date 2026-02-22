import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

interface AuthContextType {
    userRole: string;
    userEmail: string;
    userSub: string;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [userRole, setUserRole] = useState("EDITOR");
    const [userEmail, setUserEmail] = useState("");
    const [userSub, setUserSub] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadAuth();
    }, []);

    async function loadAuth() {
        try {
            const session = await fetchAuthSession();
            const payload = session.tokens?.idToken?.payload;
            if (payload) {
                setUserRole((payload["custom:role"] as string) || "EDITOR");
                setUserEmail((payload["email"] as string) || "");
                setUserSub((payload["sub"] as string) || "");
            }
        } catch (e) {
            console.error("Failed to load auth context", e);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <AuthContext.Provider value={{ userRole, userEmail, userSub, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within AuthProvider");
    return context;
}
