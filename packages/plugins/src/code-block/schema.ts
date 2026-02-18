import { z } from 'zod';

export const LANGUAGES = [
    "plaintext", "javascript", "typescript", "python", "html", "css", "json",
    "bash", "sql", "go", "rust", "java", "csharp", "php", "ruby", "yaml",
    "xml", "markdown", "diff"
] as const;

export const CodeBlockSchema = z.object({
    code: z.string().default(""),
    language: z.string().default("plaintext"),
    filename: z.string().optional(),
    showLineNumbers: z.boolean().default(false),
});
