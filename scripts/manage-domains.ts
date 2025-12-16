import { ACMClient, RequestCertificateCommand, DescribeCertificateCommand, CertificateStatus, DomainStatus } from "@aws-sdk/client-acm";
import * as fs from "fs";
import * as path from "path";

// CloudFront Certs MUST be in us-east-1
const acm = new ACMClient({ region: "us-east-1" });
const configPath = path.join(__dirname, "../amodx.config.json");

async function main() {
    if (!fs.existsSync(configPath)) {
        console.error("❌ amodx.config.json not found. Run 'npm run setup-config' first.");
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const domains = [
        config.domains.root,
        `*.${config.domains.root}`,
        ...(config.domains.tenants || [])
    ];

    // Deduplicate
    const uniqueDomains = Array.from(new Set(domains));

    console.log(`🔒 Requesting Certificate for: ${uniqueDomains.join(", ")}`);

    // 1. Request Cert
    const req = await acm.send(new RequestCertificateCommand({
        DomainName: uniqueDomains[0],
        SubjectAlternativeNames: uniqueDomains.slice(1),
        ValidationMethod: "DNS",
    }));

    const certArn = req.CertificateArn;
    if (!certArn) {
        throw new Error("Certificate ARN not returned from AWS");
    }
    console.log(`✅ Certificate Created: ${certArn}`);
    console.log(`⏳ Fetching DNS Validation Records...`);

    // 2. Poll for CNAMEs and Validation
    let validated = false;
    let attempts = 0;

    while (!validated && attempts < 60) { // Timeout after 5 minutes
        await new Promise(r => setTimeout(r, 5000)); // Wait 5s

        const desc = await acm.send(new DescribeCertificateCommand({ CertificateArn: certArn }));
        const cert = desc.Certificate;

        if (cert?.Status === CertificateStatus.ISSUED) {
            validated = true;
            console.log("🎉 Certificate ISSUED!");
            break;
        }

        const options = cert?.DomainValidationOptions || [];

        // Filter for records that still need validation
        // FIXED: Use the correct Enum string
        const pendingOptions = options.filter(o => o.ValidationStatus === DomainStatus.PENDING_VALIDATION);

        if (pendingOptions.length > 0 && pendingOptions[0].ResourceRecord) {
            console.clear();
            console.log("---------------------------------------------------------------");
            console.log("🛑 ACTION REQUIRED: Add/Verify these CNAME records in your DNS");
            console.log("---------------------------------------------------------------");

            pendingOptions.forEach(o => {
                console.log(`Domain: ${o.DomainName}`);
                console.log(`   Name:  ${o.ResourceRecord?.Name}`);
                console.log(`   Value: ${o.ResourceRecord?.Value}`);
                console.log("");
            });

            console.log("---------------------------------------------------------------");
            console.log(`Waiting for validation... Attempt ${attempts + 1}/60 (Ctrl+C to stop)`);
        } else {
            console.log(`Waiting for certificate to be issued... Status: ${cert?.Status}. Attempt ${attempts + 1}/60`);
        }

        attempts++;
    }

    if (!validated) {
        console.error("❌ Certificate validation timed out. Please check your DNS records.");
        process.exit(1);
    }

    // 3. Save ARN to Config
    config.domains.globalCertArn = certArn;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("✅ amodx.config.json updated. You can now run 'npx cdk deploy'.");
}

main().catch(console.error);
