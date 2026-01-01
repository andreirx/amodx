import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, User, Shield } from "lucide-react";

export default function UsersPage() {
    const { tenants } = useTenant();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Invite Form
    const [isOpen, setIsOpen] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState("EDITOR");
    const [targetTenant, setTargetTenant] = useState("GLOBAL");

    useEffect(() => {
        loadUsers();
    }, []);

    async function loadUsers() {
        setLoading(true);
        try {
            const res = await apiRequest("/users");
            setUsers(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleInvite() {
        if (!newEmail) return;
        setInviting(true);
        try {
            await apiRequest("/users", {
                method: "POST",
                body: JSON.stringify({
                    email: newEmail,
                    role: newRole,
                    tenantId: targetTenant === "GLOBAL" ? "" : targetTenant
                })
            });
            setIsOpen(false);
            setNewEmail("");
            loadUsers();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setInviting(false);
        }
    }

    // Resolve Tenant Name helper
    const getTenantName = (id: string) => {
        if (id === 'GLOBAL' || !id) return <span className="text-purple-600 font-bold text-xs bg-purple-50 px-2 py-1 rounded">All Sites</span>;
        const t = tenants.find(t => t.id === id);
        return t ? t.name : id;
    };

    if (loading) {
        return (
            <div className="p-8 flex justify-center items-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Team & Users</h1>
                    <p className="text-muted-foreground">Manage access to the platform.</p>
                </div>

                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" /> Invite User</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Invite Team Member</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Email Address</Label>
                                <Input
                                    placeholder="colleague@agency.com"
                                    value={newEmail}
                                    onChange={e => setNewEmail(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Role</Label>
                                <Select value={newRole} onValueChange={setNewRole}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="GLOBAL_ADMIN">Global Admin (God Mode)</SelectItem>
                                        <SelectItem value="TENANT_ADMIN">Site Admin (Specific Site)</SelectItem>
                                        <SelectItem value="EDITOR">Editor (Can't change settings)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Access Scope</Label>
                                <Select value={targetTenant} onValueChange={setTargetTenant}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="GLOBAL">Global (All Sites)</SelectItem>
                                        {tenants.map(t => (
                                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    If Global Admin, this MUST be "All Sites".
                                </p>
                            </div>
                            <Button onClick={handleInvite} disabled={inviting} className="w-full">
                                {inviting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : "Send Invitation"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="border rounded-md bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => (
                            <TableRow key={user.username}>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                            <User className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{user.email}</span>
                                            <span className="text-xs text-muted-foreground">Created: {new Date(user.created).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1">
                                        <Shield className="h-3 w-3 text-muted-foreground" />
                                        <span className="text-sm font-medium">{user.role}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {getTenantName(user.tenantId)}
                                </TableCell>
                                <TableCell>
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                        user.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        {user.status}
                                    </span>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
