import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// 1. Configuration
const apiUrl = process.argv[2];

if (!apiUrl) {
    console.error("Usage: npm run setup <API_URL>");
    process.exit(1);
}

// 2. Determine Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FIX: Point to the 'dist' folder relative to THIS script (setup.ts is in tools/mcp-server/)
const serverScriptPath = path.resolve(__dirname, 'dist/index.js');

// Verify it exists
if (!fs.existsSync(serverScriptPath)) {
    console.error(`❌ Error: Could not find build artifact at: ${serverScriptPath}`);
    console.error("Did you run 'npm run build' first?");
    process.exit(1);
}

// 3. Locate Claude Config
let configPath = '';
const platform = os.platform();

if (platform === 'darwin') {
    configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
} else if (platform === 'win32') {
    configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
} else {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
}

console.log(`📍 Targeting Claude Config: ${configPath}`);
console.log(`🔗 Linking MCP Script: ${serverScriptPath}`);
console.log(`🔑 Setting API URL: ${apiUrl}`);

// 4. Update the Config
try {
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    let config: any = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    if (!config.mcpServers) config.mcpServers = {};

    // Inject AMODX configuration
    config.mcpServers['amodx'] = {
        command: 'node',
        args: [serverScriptPath],
        env: {
            AMODX_API_URL: apiUrl,
            PATH: process.env.PATH // Pass PATH so node can find tools if needed
        }
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("✅ Claude Desktop configuration updated successfully.");
    console.log("👉 Please RESTART Claude Desktop for changes to take effect.");

} catch (error: any) {
    console.error("Failed to update config:", error.message);
    process.exit(1);
}
