import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { useAuth } from "@/context/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Loader2, Plus, User, Shield, MoreHorizontal, ShieldCheck, UserX, UserCheck, Trash2, Mail } from "lucide-react";

const DEFAULT_INVITE_SUBJECT = "You've been invited to {{siteName}}";
const DEFAULT_INVITE_BODY = `Hello,

You have been invited to manage {{siteName}} as {{role}}.

Your login credentials:
Email: {{email}}
Temporary password: {{password}}

Sign in at: ${window.location.origin}

You will be asked to set a new password on your first login.

Best regards,
The {{siteName}} Team`;

// --- Role hierarchy ---
const ROLE_HIERARCHY: Record<string, number> = {
    GLOBAL_ADMIN: 3,
    TENANT_ADMIN: 2,
    EDITOR: 1,
};

const ROLE_LABELS: Record<string, string> = {
    GLOBAL_ADMIN: "Global Admin",
    TENANT_ADMIN: "Site Admin",
    EDITOR: "Editor",
};

function canManageUser(actorRole: string, actorEmail: string, targetUser: any): boolean {
    if ((ROLE_HIERARCHY[actorRole] || 0) < 2) return false; // EDITORs can't manage
    if (actorEmail === targetUser.email) return false; // Can't manage self
    const actorLevel = ROLE_HIERARCHY[actorRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    return actorLevel >= targetLevel;
}

function getAllowedRoles(actorRole: string): string[] {
    if (actorRole === "GLOBAL_ADMIN") return ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"];
    if (actorRole === "TENANT_ADMIN") return ["TENANT_ADMIN", "EDITOR"];
    return [];
}

export default function UsersPage() {
    const { tenants } = useTenant();
    const { userRole, userEmail } = useAuth();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Invite Form
    const [isOpen, setIsOpen] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState("EDITOR");
    const [targetTenant, setTargetTenant] = useState("GLOBAL");
    const [emailSubject, setEmailSubject] = useState(DEFAULT_INVITE_SUBJECT);
    const [emailBody, setEmailBody] = useState(DEFAULT_INVITE_BODY);

    // Action state
    const [actionUser, setActionUser] = useState<any>(null);
    const [actionType, setActionType] = useState<"role" | "disable" | "enable" | "delete" | null>(null);
    const [selectedRole, setSelectedRole] = useState("");
    const [actionLoading, setActionLoading] = useState(false);

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
            const tid = targetTenant === "GLOBAL" ? "" : targetTenant;
            const t = tenants.find(t => t.id === tid);
            await apiRequest("/users", {
                method: "POST",
                body: JSON.stringify({
                    email: newEmail,
                    role: newRole,
                    tenantId: tid,
                    emailSubject,
                    emailBody,
                    siteName: t?.name || "AMODX",
                })
            });
            setIsOpen(false);
            setNewEmail("");
            setEmailSubject(DEFAULT_INVITE_SUBJECT);
            setEmailBody(DEFAULT_INVITE_BODY);
            loadUsers();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setInviting(false);
        }
    }

    async function handleRoleChange() {
        if (!actionUser || !selectedRole) return;
        setActionLoading(true);
        try {
            await apiRequest(`/users/${encodeURIComponent(actionUser.username)}`, {
                method: "PUT",
                body: JSON.stringify({ role: selectedRole }),
            });
            closeAction();
            loadUsers();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleToggleStatus(enable: boolean) {
        if (!actionUser) return;
        setActionLoading(true);
        try {
            await apiRequest(`/users/${encodeURIComponent(actionUser.username)}/status`, {
                method: "PUT",
                body: JSON.stringify({ enabled: enable }),
            });
            closeAction();
            loadUsers();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDeleteUser() {
        if (!actionUser) return;
        setActionLoading(true);
        try {
            await apiRequest(`/users/${encodeURIComponent(actionUser.username)}`, {
                method: "DELETE",
            });
            closeAction();
            loadUsers();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    }

    function closeAction() {
        setActionUser(null);
        setActionType(null);
        setSelectedRole("");
    }

    const getTenantName = (id: string) => {
        if (id === 'GLOBAL' || !id) return <span className="text-purple-600 font-bold text-xs bg-purple-50 px-2 py-1 rounded">All Sites</span>;
        const t = tenants.find(t => t.id === id);
        return t ? t.name : id;
    };

    const allowedRoles = getAllowedRoles(userRole);
    const canInvite = allowedRoles.length > 0;

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

                {canInvite && (
                    <Dialog open={isOpen} onOpenChange={(open) => {
                        setIsOpen(open);
                        if (!open) { setEmailSubject(DEFAULT_INVITE_SUBJECT); setEmailBody(DEFAULT_INVITE_BODY); setNewEmail(""); }
                    }}>
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
                                            {allowedRoles.map(r => (
                                                <SelectItem key={r} value={r}>
                                                    {ROLE_LABELS[r] || r}
                                                </SelectItem>
                                            ))}
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
                                <div className="border-t pt-4 space-y-3">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        <Mail className="h-4 w-4" />
                                        Invite Email
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Subject</Label>
                                        <Input
                                            value={emailSubject}
                                            onChange={e => setEmailSubject(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Body</Label>
                                        <textarea
                                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            rows={8}
                                            value={emailBody}
                                            onChange={e => setEmailBody(e.target.value)}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Available placeholders: {"{{email}}"}, {"{{password}}"}, {"{{role}}"}, {"{{siteName}}"}
                                    </p>
                                </div>
                                <Button onClick={handleInvite} disabled={inviting} className="w-full">
                                    {inviting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : "Send Invitation"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </div>

            <div className="border rounded-md bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Status</TableHead>
                            {canInvite && <TableHead className="w-12" />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => (
                            <TableRow key={user.username} className={!user.enabled ? "opacity-60" : ""}>
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
                                        <span className="text-sm font-medium">{ROLE_LABELS[user.role] || user.role}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {getTenantName(user.tenantId)}
                                </TableCell>
                                <TableCell>
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                        !user.enabled
                                            ? 'bg-red-100 text-red-700'
                                            : user.status === 'CONFIRMED'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        {!user.enabled ? 'DISABLED' : user.status}
                                    </span>
                                </TableCell>
                                {canInvite && (
                                    <TableCell>
                                        {canManageUser(userRole, userEmail, user) && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => {
                                                        setActionUser(user);
                                                        setActionType("role");
                                                        setSelectedRole(user.role);
                                                    }}>
                                                        <ShieldCheck className="mr-2 h-4 w-4" />
                                                        Change Role
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    {user.enabled ? (
                                                        <DropdownMenuItem
                                                            onClick={() => { setActionUser(user); setActionType("disable"); }}
                                                            className="text-destructive focus:text-destructive"
                                                        >
                                                            <UserX className="mr-2 h-4 w-4" />
                                                            Disable User
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem onClick={() => { setActionUser(user); setActionType("enable"); }}>
                                                            <UserCheck className="mr-2 h-4 w-4" />
                                                            Enable User
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => { setActionUser(user); setActionType("delete"); }}
                                                        className="text-destructive focus:text-destructive"
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Delete User
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Role Change Dialog */}
            <Dialog open={actionType === "role"} onOpenChange={(open) => { if (!open) closeAction(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Change Role for {actionUser?.email}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>New Role</Label>
                            <Select value={selectedRole} onValueChange={setSelectedRole}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {allowedRoles.map(r => (
                                        <SelectItem key={r} value={r}>
                                            {ROLE_LABELS[r] || r}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            onClick={handleRoleChange}
                            disabled={actionLoading || selectedRole === actionUser?.role}
                            className="w-full"
                        >
                            {actionLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : "Confirm Role Change"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Disable/Enable/Delete Confirmation Dialog */}
            <Dialog open={actionType === "disable" || actionType === "enable"} onOpenChange={(open) => { if (!open) closeAction(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {actionType === "disable" ? "Disable" : "Enable"} {actionUser?.email}?
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            {actionType === "disable"
                                ? "This user will lose access immediately. They will not be deleted and can be re-enabled later."
                                : "This will restore the user's access to the platform."}
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={closeAction} className="flex-1">
                                Cancel
                            </Button>
                            <Button
                                variant={actionType === "disable" ? "destructive" : "default"}
                                onClick={() => handleToggleStatus(actionType === "enable")}
                                disabled={actionLoading}
                                className="flex-1"
                            >
                                {actionLoading
                                    ? <Loader2 className="animate-spin mr-2 h-4 w-4" />
                                    : actionType === "disable" ? "Disable User" : "Enable User"
                                }
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            {/* Delete Confirmation Dialog */}
            <Dialog open={actionType === "delete"} onOpenChange={(open) => { if (!open) closeAction(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete {actionUser?.email}?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            This will permanently remove the user from the system. This action cannot be undone. You can re-invite them later if needed.
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={closeAction} className="flex-1">
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDeleteUser}
                                disabled={actionLoading}
                                className="flex-1"
                            >
                                {actionLoading
                                    ? <Loader2 className="animate-spin mr-2 h-4 w-4" />
                                    : "Delete User"
                                }
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
