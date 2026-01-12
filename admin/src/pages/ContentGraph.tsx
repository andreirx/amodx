import { useEffect, useState, useCallback } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import {
    ReactFlow,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    Position,
    MarkerType,
    type Node,
    type Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Card } from "@/components/ui/card";
import { Loader2, GitGraph, AlertTriangle, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Standard Node Size
const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

const getLayoutedElements = (nodes: any[], edges: any[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    // 'TB' = Top to Bottom, 'LR' = Left to Right
    dagreGraph.setGraph({ rankdir: 'TB' });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            targetPosition: Position.Top,
            sourcePosition: Position.Bottom,
            position: {
                x: nodeWithPosition.x - NODE_WIDTH / 2,
                y: nodeWithPosition.y - NODE_HEIGHT / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};

export default function ContentGraph() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [orphans, setOrphans] = useState<any[]>([]);

    // FIX 1: Provide Generic Types <Node> and <Edge>
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    useEffect(() => {
        if (currentTenant) loadGraph();
    }, [currentTenant?.id]);

    async function loadGraph() {
        setLoading(true);
        try {
            // Inside loadGraph()
            const res = await apiRequest("/audit/graph");
            // Safety check
            if (!res || !res.nodes) {
                console.error("Invalid graph response", res);
                setLoading(false);
                return;
            }
            // Transform API data to React Flow Format
            const flowNodes: Node[] = res.nodes.map((n: any) => ({
                id: n.id,
                data: { label: n.label, slug: n.slug, status: n.status },
                position: { x: 0, y: 0 },
                style: {
                    border: n.status === 'Published' ? '1px solid #22c55e' : '1px solid #f59e0b',
                    background: n.status === 'Published' ? '#f0fdf4' : '#fffbeb',
                    borderRadius: '8px',
                    padding: '10px',
                    fontSize: '12px',
                    fontWeight: '500',
                    width: NODE_WIDTH,
                    cursor: 'pointer'
                }
            }));

            const flowEdges: Edge[] = res.edges.map((e: any) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                type: 'smoothstep',
                animated: true,
                markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
                style: { stroke: '#94a3b8' }
            }));

            const layouted = getLayoutedElements(flowNodes, flowEdges);

            // FIX 2: Cast the result if dagre types conflict, but usually explicit Node[] above fixes it
            setNodes(layouted.nodes as Node[]);
            setEdges(layouted.edges as Edge[]);
            setOrphans(res.orphans || []);

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    // FIX 3: Remove unused 'event' or prefix with underscore
    const onNodeClick = useCallback((_: any, node: Node) => {
        if(node.id) navigate(`/content/${node.id}`);
    }, [navigate]);

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex h-[calc(100vh-64px)]">
            {/* Main Graph Area */}
            <div className="flex-1 h-full bg-slate-50 relative">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={onNodeClick}
                    fitView
                    attributionPosition="bottom-right"
                >
                    <Controls />
                    <Background color="#cbd5e1" gap={20} size={1} />
                </ReactFlow>

                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur p-4 rounded-xl border shadow-sm z-10 pointer-events-none">
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <GitGraph className="w-5 h-5 text-primary" />
                        Content Map
                    </h1>
                    <div className="flex gap-4 mt-2 text-xs">
                        <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-full bg-green-100 border border-green-500"></div> Published
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-full bg-amber-100 border border-amber-500"></div> Draft
                        </div>
                    </div>
                </div>
            </div>

            {/* Sidebar: Orphans & Stats */}
            <div className="w-80 border-l bg-background p-6 overflow-y-auto">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Orphaned Pages
                </h2>
                <p className="text-xs text-muted-foreground mb-6">
                    These pages have 0 internal links pointing to them. They may be invisible to Google.
                </p>

                {orphans.length === 0 ? (
                    <div className="p-4 bg-green-50 text-green-700 rounded-lg text-sm text-center">
                        Good job! No orphans found.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {orphans.map((page) => (
                            <Card
                                key={page.id}
                                className="p-3 hover:bg-muted/50 cursor-pointer transition-colors group"
                                onClick={() => navigate(`/content/${page.id}`)}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="font-medium text-sm truncate w-full">{page.title}</div>
                                    <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                                </div>
                                <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                                    {page.slug}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
