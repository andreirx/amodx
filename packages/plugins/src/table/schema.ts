import { z } from 'zod';

const CellSchema = z.object({
    id: z.string(),
    content: z.string().default(""),
});

const RowSchema = z.object({
    id: z.string(),
    cells: z.array(CellSchema),
});

export const TableSchema = z.object({
    headers: z.array(z.string()).default(["Column 1", "Column 2", "Column 3"]),
    rows: z.array(RowSchema).default([
        {
            id: "1",
            cells: [
                { id: "1-1", content: "" },
                { id: "1-2", content: "" },
                { id: "1-3", content: "" }
            ]
        },
        {
            id: "2",
            cells: [
                { id: "2-1", content: "" },
                { id: "2-2", content: "" },
                { id: "2-3", content: "" }
            ]
        }
    ]),
    striped: z.boolean().default(true),
    bordered: z.boolean().default(true),
});
