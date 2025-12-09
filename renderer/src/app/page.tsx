import Page from "./[...slug]/page";

export default function HomePage() {
    // Wrap the object in a Promise to satisfy the Next.js 15 interface
    return <Page params={Promise.resolve({ slug: ["home"] })} />;
}
