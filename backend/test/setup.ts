import * as dotenv from 'dotenv';
import * as path from 'path';

// Load the .env.test file from root
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

if (!process.env.TABLE_NAME) {
    throw new Error("Missing TABLE_NAME. Run 'npx tsx scripts/post-deploy.ts AmodxStack-staging' first.");
}

console.log(`🧪 Testing against table: ${process.env.TABLE_NAME}`);
