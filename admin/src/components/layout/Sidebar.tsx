import { Link, useLocation, useNavigate } from "react-router-dom";
import { signOut } from 'aws-amplify/auth';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    LayoutDashboard,
    Target,
    Settings,
    LogOut
} from "lucide-react";

interface SidebarProps {
    className?: string;
    onNavigate?: () => void; // <--- New Prop
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
    const location = useLocation();
    const navigate = useNavigate();

    const navItems = [
        { name: "Content", href: "/", icon: LayoutDashboard },
        { name: "Strategy", href: "/strategy", icon: Target },
        { name: "Settings", href: "/settings", icon: Settings },
    ];

    async function handleLogout() {
        try {
            await signOut();
            navigate("/login");
        } catch (e) {
            console.error(e);
        }
    }

    return (
        <div className={cn("pb-12 min-h-screen bg-card", className)}>
            <div className="space-y-4 py-4">
                <div className="px-4 py-2">
                    <h2 className="mb-2 px-2 text-lg font-semibold tracking-tight text-primary">
                        AMODX
                    </h2>
                    <div className="space-y-1">
                        {navItems.map((item) => {
                            const isActive = location.pathname === item.href ||
                                (item.href !== "/" && location.pathname.startsWith(item.href));

                            return (
                                <Link
                                    key={item.href}
                                    to={item.href}
                                    onClick={onNavigate} // <--- Close drawer on click
                                >
                                    <Button
                                        variant={isActive ? "secondary" : "ghost"}
                                        className="w-full justify-start mb-1"
                                    >
                                        <item.icon className="mr-2 h-4 w-4" />
                                        {item.name}
                                    </Button>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                <div className="px-4 py-2 mt-auto border-t">
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={handleLogout}
                    >
                        <LogOut className="mr-2 h-4 w-4" />
                        Logout
                    </Button>
                </div>
            </div>
        </div>
    );
}
