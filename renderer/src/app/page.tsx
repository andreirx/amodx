import Page from "./[...slug]/page";

// Re-use the same logic, just pass a "fake" slug for home
export default function HomePage() {
    return <Page params={{ slug: ["home"] }} />;
}
