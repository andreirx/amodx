import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Loader2, Users, Eye, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Customers() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [customers, setCustomers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (currentTenant) loadCustomers();
    }, [currentTenant?.id]);

    async function loadCustomers() {
        setLoading(true);
        try {
            const res = await apiRequest("/customers");
            setCustomers(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    const filtered = customers.filter((c) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            (c.name || "").toLowerCase().includes(q) ||
            (c.email || "").toLowerCase().includes(q)
        );
    });

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
                    <p className="text-muted-foreground">View customer information.</p>
                </div>
            </div>

            <div className="flex gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead>Orders</TableHead>
                                <TableHead>Total Spent</TableHead>
                                <TableHead>Last Order</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((c) => (
                                <TableRow
                                    key={c.email}
                                    className="cursor-pointer"
                                    onClick={() => navigate(`/customers/${encodeURIComponent(c.email)}`)}
                                >
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                                <Users className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                            <span className="font-medium">{c.name || "-"}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">{c.email}</TableCell>
                                    <TableCell className="text-sm">{c.phone || "-"}</TableCell>
                                    <TableCell className="text-sm">{c.orderCount || 0}</TableCell>
                                    <TableCell className="text-sm font-medium">
                                        {(c.totalSpent || 0).toLocaleString(currentTenant?.locale || "ro-RO", { minimumFractionDigits: 2 })} {currentTenant?.currency || "RON"}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {c.lastOrderAt
                                            ? new Date(c.lastOrderAt).toLocaleDateString(currentTenant?.locale || "ro-RO")
                                            : "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/customers/${encodeURIComponent(c.email)}`);
                                            }}
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filtered.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        {customers.length === 0
                                            ? "No customers yet. Customers are created automatically when orders are placed."
                                            : "No customers match your search."}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
