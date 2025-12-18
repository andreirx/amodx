"use client";
import Script from "next/script";

export function PaddleLoader({ config }: { config: any }) {
    if (!config?.clientToken) return null;

    const environment = config.environment === 'production' ? 'production' : 'sandbox';

    return (
        <Script
            src="https://cdn.paddle.com/paddle/v2/paddle.js"
            onLoad={() => {
                // @ts-ignore
                if (window.Paddle) {
                    // @ts-ignore
                    window.Paddle.Environment.set(environment);
                    // @ts-ignore
                    window.Paddle.Setup({ token: config.clientToken });
                }
            }}
        />
    );
}
