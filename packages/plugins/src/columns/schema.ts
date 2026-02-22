import { z } from 'zod';

const ColumnSchema = z.object({
    id: z.string(),
    width: z.enum(["1/4", "1/3", "1/2", "2/3", "3/4", "full"]).default("1/2"),
    content: z.string().default(""), // Raw text content for each column
});

export const ColumnsSchema = z.object({
    columnCount: z.enum(["2", "3", "4"]).default("2"),
    gap: z.enum(["sm", "md", "lg"]).default("md"),
    columns: z.array(ColumnSchema).default([
        { id: "1", width: "1/2", content: "Column 1 content" },
        { id: "2", width: "1/2", content: "Column 2 content" }
    ]),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
