import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { Amplify } from 'aws-amplify';

const loadConfig = async () => {
    // In Dev, use Env
    if (import.meta.env.DEV) {
        return {
            userPoolId: import.meta.env.VITE_USER_POOL_ID,
            clientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
        };
    }

    // In Prod, fetch JSON
    try {
        const res = await fetch('/config.json');
        const config = await res.json();
        // @ts-ignore
        window.AMODX_CONFIG = config; // Save for other files
        return {
            userPoolId: config.VITE_USER_POOL_ID,
            clientId: config.VITE_USER_POOL_CLIENT_ID,
        };
    } catch (e) {
        console.error("Failed to load config.json", e);
        return {};
    }
};

loadConfig().then((config) => {
    Amplify.configure({
        Auth: {
            Cognito: {
                userPoolId: config.userPoolId,
                userPoolClientId: config.clientId,
                loginWith: { email: true }
            }
        }
    });

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
});
