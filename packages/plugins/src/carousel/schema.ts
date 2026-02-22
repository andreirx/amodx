import { z } from 'zod';

const CarouselItem = z.object({
    id: z.string(),
    title: z.string().default("Card Title"),
    description: z.string().default("Short description here."),
    image: z.string().optional(),
    link: z.string().default("#"),
    linkText: z.string().default("Learn More")
});

export const CarouselSchema = z.object({
    headline: z.string().default("Featured Collection"),
    items: z.array(CarouselItem).default([
        { id: '1', title: "Item 1", description: "Description 1", link: "#", linkText: "View" },
        { id: '2', title: "Item 2", description: "Description 2", link: "#", linkText: "View" },
        { id: '3', title: "Item 3", description: "Description 3", link: "#", linkText: "View" },
    ]),
    height: z.enum(["small", "medium", "large"]).default("medium"),
    style: z.enum(["standard", "coverflow"]).default("coverflow"),
    blockWidth: z.enum(["content", "wide", "full"]).default("full"),
});
